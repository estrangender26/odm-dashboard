import { and, eq, sql, type SQL } from "drizzle-orm";
import { equipment, tasks } from "../db/schema";

export type MaintenanceDataset = "htt" | "aglipay";

export interface MaintenanceImportRow {
  taskId?: number | string | null;
  taskCode?: string | null;
  facilityDataset?: string | null;
  equipmentType: string;
  taskList: string;
  frequency?: string | null;
  responsiblePersonnel?: string | null;
  operations?: string | null;
  amd?: string | null;
  ard?: string | null;
  procedureFamiliarity?: string | null;
  rowNumber?: number;
}

export interface MaintenanceImportInput {
  dataset: MaintenanceDataset;
  rows: MaintenanceImportRow[];
  clientTimings?: {
    parseMs?: number;
  };
}

export interface MaintenanceImportSkippedRow {
  row: number;
  eq: string;
  task: string;
  reason: string;
}

export type MaintenanceImportFailureKind = "validation" | "mapping" | "transaction" | "unexpected";

export interface MaintenanceImportTimings {
  parse_ms: number;
  validate_ms: number;
  match_ms: number;
  update_ms: number;
  response_serialization_ms: number;
  total_ms: number;
}

export interface MaintenanceImportFailurePayload {
  success: false;
  kind: MaintenanceImportFailureKind;
  message: string;
  rejected: number;
  skipped: MaintenanceImportSkippedRow[];
  diagnostics: MaintenanceImportRowDiagnostics[];
  timings?: MaintenanceImportTimings;
}

export interface MaintenanceImportRowDiagnostics {
  row: number;
  hasTaskId: boolean;
  hasTaskCode: boolean;
  hasFacilityDataset: boolean;
  hasEquipment: boolean;
  hasTaskDescription: boolean;
  matchingPath: "task_id" | "task_code" | "fallback text" | "none";
  rejectionReason?: string;
}

export interface MaintenanceImportResult {
  success: true;
  updated: number;
  unchanged: number;
  total: number;
  skipped: MaintenanceImportSkippedRow[];
  message: string;
  timings: MaintenanceImportTimings;
}

export interface MaintenanceTaskMatch {
  row: number;
  equipmentType: string;
  taskList: string;
  taskId: number;
  updateData: Record<string, string | null>;
}

export interface MaintenanceImportPlan {
  matches: MaintenanceTaskMatch[];
  skipped: MaintenanceImportSkippedRow[];
  unchanged: number;
}

export interface MaintenanceExistingRow {
  id: number;
  equipmentCode?: string | null;
  equipmentName: string;
  taskList: string;
  dataset?: MaintenanceDataset | string | null;
}

interface SelectBuilderLike {
  from: (table: unknown) => {
    innerJoin: (table: unknown, on: unknown) => {
      where: (condition: unknown) => Promise<MaintenanceExistingRow[]>;
    };
  };
}

interface UpdateBuilderLike {
  set: (values: Record<string, string | null>) => {
    where: (condition: unknown) => Promise<unknown>;
  };
}

export interface MaintenanceDbLike {
  select: (fields: unknown) => SelectBuilderLike;
  update: (table: unknown) => UpdateBuilderLike;
  execute?: (query: SQL) => Promise<unknown>;
  transaction?: <T>(fn: (tx: MaintenanceDbLike) => Promise<T>) => Promise<T>;
}

const MAX_VARCHAR: Record<"frequency" | "responsiblePersonnel" | "operations" | "amd" | "ard" | "procedureFamiliarity", number> = {
  frequency: 100,
  responsiblePersonnel: 100,
  operations: 100,
  amd: 100,
  ard: 100,
  procedureFamiliarity: 50,
};

const FIELD_LABELS: Record<keyof typeof MAX_VARCHAR, string> = {
  frequency: "Frequency",
  responsiblePersonnel: "Responsible Personnel",
  operations: "Operations",
  amd: "AMD",
  ard: "ARD",
  procedureFamiliarity: "Procedure Familiarity",
};

const DATASET_LABELS: Record<MaintenanceDataset, string> = {
  htt: "HTT STP",
  aglipay: "Aglipay STP",
};

function printable(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function normalizeImportKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function cleanOptional(value: string | null | undefined): string | null {
  const cleaned = String(value ?? "").trim();
  return cleaned ? cleaned : null;
}

function parseTaskId(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return Number.NaN;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
}

export function buildMaintenanceTaskCode(row: { id: number; equipmentCode?: string | null; dataset?: string | null }): string {
  return `${String(row.dataset ?? "").trim()}:${String(row.equipmentCode ?? "").trim()}:${row.id}`;
}

function normalizeTaskCode(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeDataset(value: unknown): MaintenanceDataset | null {
  const normalized = normalizeImportKey(value).replace(/[^a-z0-9]/g, "");
  if (!normalized) return null;
  if (normalized === "htt" || normalized === "httstp") return "htt";
  if (normalized === "aglipay" || normalized === "aglipaystp") return "aglipay";
  return null;
}

export function validateMaintenanceImportRows(rows: MaintenanceImportRow[], activeDataset?: MaintenanceDataset): MaintenanceImportSkippedRow[] {
  const errors: MaintenanceImportSkippedRow[] = [];

  rows.forEach((row, idx) => {
    const rowNumber = row.rowNumber ?? idx + 2;
    const eqName = String(row.equipmentType ?? "").trim();
    const taskList = String(row.taskList ?? "").trim();
    const taskId = parseTaskId(row.taskId);

    if (Number.isNaN(taskId)) {
      errors.push({ row: rowNumber, eq: printable(eqName), task: printable(taskList), reason: "Invalid task_id; expected a positive numeric task_id from the export" });
    }

    const rowDataset = normalizeDataset(row.facilityDataset);
    if (activeDataset && row.facilityDataset && !rowDataset) {
      errors.push({ row: rowNumber, eq: printable(eqName), task: printable(taskList), reason: `Unrecognized facility/dataset "${printable(String(row.facilityDataset).trim())}"` });
    }
    if (activeDataset && rowDataset && rowDataset !== activeDataset) {
      errors.push({
        row: rowNumber,
        eq: printable(eqName),
        task: printable(taskList),
        reason: `File facility/dataset ${DATASET_LABELS[rowDataset]} does not match active dataset ${DATASET_LABELS[activeDataset]}`,
      });
    }

    if (taskId === null && !cleanOptional(row.taskCode)) {
      if (!eqName) {
        errors.push({ row: rowNumber, eq: "", task: printable(taskList), reason: "Equipment Name is required when task_id/task_code are absent" });
      }
      if (!taskList) {
        errors.push({ row: rowNumber, eq: printable(eqName), task: "", reason: "Task Description is required when task_id/task_code are absent" });
      }
    }

    (Object.keys(MAX_VARCHAR) as Array<keyof typeof MAX_VARCHAR>).forEach((field) => {
      const value = cleanOptional(row[field]);
      if (value && value.length > MAX_VARCHAR[field]) {
        errors.push({
          row: rowNumber,
          eq: printable(eqName),
          task: printable(taskList),
          reason: `${FIELD_LABELS[field]} exceeds ${MAX_VARCHAR[field]} characters (${value.length})`,
        });
      }
    });
  });

  return errors;
}

export function maintenanceImportRequiredFix(reason: string): string {
  if (reason.includes("Invalid task_id")) return "Export a fresh file and keep the task_id column unchanged.";
  if (reason.includes("does not match active dataset")) return "Switch to the matching facility tab or export a fresh file for the active facility.";
  if (reason.includes("Unrecognized facility/dataset")) return "Use the Facility/Dataset value from a fresh export.";
  if (reason.includes("Equipment Name is required") || reason.includes("Task Description is required")) return "Import a fresh export with task_id/task_code, or include both Equipment Name and Task Description for legacy fallback.";
  if (reason.includes("Multiple matching tasks found")) return "Import a fresh export that includes task_id or task_code; legacy text matching is ambiguous.";
  if (reason.includes("No matching task found for task_id")) return "Export a fresh file from the active facility; the task_id does not exist in this dataset.";
  if (reason.includes("No matching task found for task_code")) return "Export a fresh file from the active facility; the task_code does not match this dataset.";
  if (reason.includes("No matching task found")) return "Import a fresh export with task_id/task_code, or verify the equipment and task description still exist.";
  if (reason.includes("exceeds")) return "Shorten the value to fit the allowed field length.";
  return "Review the row and retry with a fresh export if the problem remains.";
}

function summarizeSkipped(skipped: MaintenanceImportSkippedRow[], limit = 10): string {
  return skipped
    .slice(0, limit)
    .map((s) => `Row ${s.row} rejected${s.eq ? ` [${s.eq}]` : ""}${s.task ? ` "${s.task}"` : ""}: ${s.reason}. Required fix: ${maintenanceImportRequiredFix(s.reason)}`)
    .join("; ");
}

export function formatMaintenanceImportFailure(skipped: MaintenanceImportSkippedRow[], prefix = "Import validation failed"): string {
  if (skipped.length === 0) return prefix;
  const extra = skipped.length > 10 ? `; +${skipped.length - 10} more rejected row(s) in diagnostics` : "";
  return `${prefix}: ${summarizeSkipped(skipped)}${extra}`;
}

export function buildImportDiagnostics(rows: MaintenanceImportRow[], skipped: MaintenanceImportSkippedRow[] = []): MaintenanceImportRowDiagnostics[] {
  const skippedByRow = new Map(skipped.map((s) => [s.row, s.reason]));
  return rows.map((row, idx) => {
    const rowNumber = row.rowNumber ?? idx + 2;
    const hasTaskId = row.taskId !== null && row.taskId !== undefined && String(row.taskId).trim() !== "";
    const hasTaskCode = !!cleanOptional(row.taskCode);
    const hasEquipment = !!String(row.equipmentType ?? "").trim();
    const hasTaskDescription = !!String(row.taskList ?? "").trim();
    return {
      row: rowNumber,
      hasTaskId,
      hasTaskCode,
      hasFacilityDataset: !!cleanOptional(row.facilityDataset),
      hasEquipment,
      hasTaskDescription,
      matchingPath: hasTaskId ? "task_id" : hasTaskCode ? "task_code" : (hasEquipment && hasTaskDescription ? "fallback text" : "none"),
      rejectionReason: skippedByRow.get(rowNumber),
    };
  });
}


export class MaintenanceImportError extends Error {
  readonly kind: MaintenanceImportFailureKind;
  readonly skipped: MaintenanceImportSkippedRow[];
  readonly diagnostics: MaintenanceImportRowDiagnostics[];
  readonly timings?: MaintenanceImportTimings;
  readonly statusCode = 400;

  constructor(kind: MaintenanceImportFailureKind, message: string, skipped: MaintenanceImportSkippedRow[], diagnostics: MaintenanceImportRowDiagnostics[] = [], timings?: MaintenanceImportTimings) {
    super(message);
    this.name = "MaintenanceImportError";
    this.kind = kind;
    this.skipped = skipped;
    this.diagnostics = diagnostics;
    this.timings = timings;
  }

  toPayload(): MaintenanceImportFailurePayload {
    return {
      success: false,
      kind: this.kind,
      message: this.message,
      rejected: this.skipped.length,
      skipped: this.skipped,
      diagnostics: this.diagnostics,
      timings: this.timings,
    };
  }
}

export function buildMaintenanceImportPlan(
  inputRows: MaintenanceImportRow[],
  existingRows: MaintenanceExistingRow[],
  hasFamiliarityColumn: boolean,
): MaintenanceImportPlan {
  const byId = new Map<number, MaintenanceExistingRow>();
  const byTaskCode = new Map<string, MaintenanceExistingRow>();
  const byKey = new Map<string, MaintenanceExistingRow[]>();
  for (const existing of existingRows) {
    byId.set(existing.id, existing);
    byTaskCode.set(normalizeTaskCode(buildMaintenanceTaskCode(existing)), existing);
    const key = `${normalizeImportKey(existing.equipmentName)}\u0000${normalizeImportKey(existing.taskList)}`;
    const bucket = byKey.get(key) ?? [];
    bucket.push(existing);
    byKey.set(key, bucket);
  }

  const matches: MaintenanceTaskMatch[] = [];
  const skipped: MaintenanceImportSkippedRow[] = [];
  let unchanged = 0;

  inputRows.forEach((rawRow, idx) => {
    const row = rawRow.rowNumber ?? idx + 2;
    const equipmentType = String(rawRow.equipmentType ?? "").trim();
    const taskList = String(rawRow.taskList ?? "").trim();
    const taskId = parseTaskId(rawRow.taskId);
    const taskCode = cleanOptional(rawRow.taskCode);
    let matched: MaintenanceExistingRow | undefined;

    if (Number.isNaN(taskId)) return;

    if (taskId !== null) {
      matched = byId.get(taskId);
      if (!matched) {
        skipped.push({ row, eq: printable(equipmentType), task: printable(taskList), reason: `No matching task found for task_id ${taskId} in this dataset` });
        return;
      }
    } else if (taskCode) {
      matched = byTaskCode.get(normalizeTaskCode(taskCode));
      if (!matched) {
        skipped.push({ row, eq: printable(equipmentType), task: printable(taskList), reason: `No matching task found for task_code ${printable(taskCode)}` });
        return;
      }
    } else {
      if (!equipmentType || !taskList) return;
      const key = `${normalizeImportKey(equipmentType)}\u0000${normalizeImportKey(taskList)}`;
      const fallbackMatches = byKey.get(key) ?? [];
      if (fallbackMatches.length === 0) {
        skipped.push({ row, eq: printable(equipmentType), task: printable(taskList), reason: "No matching task found for this dataset/equipment/task" });
        return;
      }
      if (fallbackMatches.length > 1) {
        skipped.push({ row, eq: printable(equipmentType), task: printable(taskList), reason: "Multiple matching tasks found by equipment/task fallback; include task_id or task_code from a fresh export to disambiguate" });
        return;
      }
      matched = fallbackMatches[0];
    }

    const updateData: Record<string, string | null> = {};
    const frequency = cleanOptional(rawRow.frequency);
    const responsiblePersonnel = cleanOptional(rawRow.responsiblePersonnel);
    const operations = cleanOptional(rawRow.operations);
    const amd = cleanOptional(rawRow.amd);
    const ard = cleanOptional(rawRow.ard);
    const procedureFamiliarity = cleanOptional(rawRow.procedureFamiliarity);

    if (frequency !== null) updateData.frequency = frequency;
    if (responsiblePersonnel !== null) updateData.responsiblePersonnel = responsiblePersonnel;
    if (operations !== null) updateData.operations = operations;
    if (amd !== null) updateData.amd = amd;
    if (ard !== null) updateData.ard = ard;
    if (hasFamiliarityColumn && procedureFamiliarity !== null) updateData.procedureFamiliarity = procedureFamiliarity;

    if (Object.keys(updateData).length === 0) {
      unchanged++;
      return;
    }

    matches.push({ row, equipmentType: matched.equipmentName, taskList: matched.taskList, taskId: matched.id, updateData });
  });

  return { matches, skipped, unchanged };
}


const IMPORT_UPDATE_FIELDS = ["frequency", "responsiblePersonnel", "operations", "amd", "ard", "procedureFamiliarity"] as const;
type MaintenanceUpdateField = typeof IMPORT_UPDATE_FIELDS[number];

const TASK_COLUMN_BY_UPDATE_FIELD: Record<MaintenanceUpdateField, SQL> = {
  frequency: sql`${tasks.frequency}`,
  responsiblePersonnel: sql`${tasks.responsiblePersonnel}`,
  operations: sql`${tasks.operations}`,
  amd: sql`${tasks.amd}`,
  ard: sql`${tasks.ard}`,
  procedureFamiliarity: sql`${tasks.procedureFamiliarity}`,
};

const BATCH_UPDATE_SIZE = 250;
const IMPORT_DIAGNOSTIC_LIMIT = process.env.NODE_ENV === "production" ? 5 : 20;

function elapsedSince(start: number): number {
  return Math.max(0, Math.round(performance.now() - start));
}

function createTimings(input: { parseMs?: number; validateMs?: number; matchMs?: number; updateMs?: number; responseSerializationMs?: number; totalMs?: number }): MaintenanceImportTimings {
  return {
    parse_ms: Math.max(0, Math.round(input.parseMs ?? 0)),
    validate_ms: Math.max(0, Math.round(input.validateMs ?? 0)),
    match_ms: Math.max(0, Math.round(input.matchMs ?? 0)),
    update_ms: Math.max(0, Math.round(input.updateMs ?? 0)),
    response_serialization_ms: Math.max(0, Math.round(input.responseSerializationMs ?? 0)),
    total_ms: Math.max(0, Math.round(input.totalMs ?? 0)),
  };
}

function measureResponseSerializationMs(payload: unknown): number {
  const start = performance.now();
  JSON.stringify(payload);
  return elapsedSince(start);
}

function buildBatchUpdateStatements(matches: MaintenanceTaskMatch[], dataset: MaintenanceDataset, chunkSize = BATCH_UPDATE_SIZE): SQL[] {
  const statements: SQL[] = [];

  for (let offset = 0; offset < matches.length; offset += chunkSize) {
    const chunk = matches.slice(offset, offset + chunkSize);
    const ids = Array.from(new Set(chunk.map((match) => match.taskId)));
    const setFragments: SQL[] = [];

    for (const field of IMPORT_UPDATE_FIELDS) {
      const column = TASK_COLUMN_BY_UPDATE_FIELD[field];
      const arms = chunk
        .filter((match) => Object.prototype.hasOwnProperty.call(match.updateData, field))
        .map((match) => sql`WHEN ${match.taskId} THEN ${match.updateData[field]}`);

      if (arms.length > 0) {
        setFragments.push(sql`${column} = CASE ${tasks.id} ${sql.join(arms, sql.raw(" "))} ELSE ${column} END`);
      }
    }

    if (setFragments.length > 0 && ids.length > 0) {
      statements.push(sql`
        UPDATE ${tasks}
        SET ${sql.join(setFragments, sql.raw(", "))}
        WHERE ${tasks.dataset} = ${dataset}
          AND ${tasks.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql.raw(", "))})
      `);
    }
  }

  return statements;
}

async function applyMaintenanceUpdates(tx: MaintenanceDbLike, matches: MaintenanceTaskMatch[], dataset: MaintenanceDataset): Promise<number> {
  if (matches.length === 0) return 0;

  if (tx.execute) {
    const statements = buildBatchUpdateStatements(matches, dataset);
    for (const statement of statements) {
      await tx.execute(statement);
    }
    return statements.length;
  }

  for (const match of matches) {
    await tx.update(tasks).set(match.updateData).where(and(eq(tasks.id, match.taskId), eq(tasks.dataset, dataset)));
  }
  return matches.length;
}

export async function importMaintenancePlanningRows(
  db: MaintenanceDbLike,
  input: MaintenanceImportInput,
  hasFamiliarityColumn: boolean,
): Promise<MaintenanceImportResult> {
  const startedAt = performance.now();
  const parseMs = Math.max(0, Math.round(input.clientTimings?.parseMs ?? 0));
  console.info("[tasks/import] start", { dataset: input.dataset, rows: input.rows.length, hasFamiliarityColumn });

  const validationStartedAt = performance.now();
  const validationErrors = validateMaintenanceImportRows(input.rows, input.dataset);
  const validateMs = elapsedSince(validationStartedAt);

  if (validationErrors.length > 0) {
    const diagnostics = buildImportDiagnostics(input.rows, validationErrors);
    const timings = createTimings({
      parseMs,
      validateMs,
      responseSerializationMs: measureResponseSerializationMs({ validationErrors: validationErrors.slice(0, IMPORT_DIAGNOSTIC_LIMIT), diagnostics: diagnostics.slice(0, IMPORT_DIAGNOSTIC_LIMIT) }),
      totalMs: elapsedSince(startedAt),
    });
    console.warn("[tasks/import] row validation failed", {
      activeDataset: input.dataset,
      errors: validationErrors.slice(0, IMPORT_DIAGNOSTIC_LIMIT),
      diagnostics: diagnostics.slice(0, IMPORT_DIAGNOSTIC_LIMIT),
      timings,
    });
    throw new MaintenanceImportError("validation", formatMaintenanceImportFailure(validationErrors), validationErrors, diagnostics, timings);
  }

  const matchStartedAt = performance.now();
  const existingRows = await db
    .select({ id: tasks.id, equipmentCode: equipment.initials, equipmentName: equipment.name, taskList: tasks.taskList, dataset: tasks.dataset })
    .from(tasks)
    .innerJoin(equipment, eq(tasks.equipmentId, equipment.id))
    .where(eq(tasks.dataset, input.dataset));

  const plan = buildMaintenanceImportPlan(input.rows, existingRows, hasFamiliarityColumn);
  const matchMs = elapsedSince(matchStartedAt);

  console.info("[tasks/import] matching summary", {
    activeDataset: input.dataset,
    importedRows: input.rows.length,
    existingRows: existingRows.length,
    matches: plan.matches.length,
    unchanged: plan.unchanged,
    rejected: plan.skipped.length,
    diagnostics: buildImportDiagnostics(input.rows, plan.skipped).slice(0, IMPORT_DIAGNOSTIC_LIMIT),
  });

  if (plan.skipped.length > 0) {
    const diagnostics = buildImportDiagnostics(input.rows, plan.skipped);
    const timings = createTimings({
      parseMs,
      validateMs,
      matchMs,
      responseSerializationMs: measureResponseSerializationMs({ skipped: plan.skipped.slice(0, IMPORT_DIAGNOSTIC_LIMIT), diagnostics: diagnostics.slice(0, IMPORT_DIAGNOSTIC_LIMIT) }),
      totalMs: elapsedSince(startedAt),
    });
    console.warn("[tasks/import] mapping failed", {
      activeDataset: input.dataset,
      skipped: plan.skipped.slice(0, IMPORT_DIAGNOSTIC_LIMIT),
      diagnostics: diagnostics.slice(0, IMPORT_DIAGNOSTIC_LIMIT),
      timings,
    });
    throw new MaintenanceImportError("mapping", formatMaintenanceImportFailure(plan.skipped, "Import mapping failed"), plan.skipped, diagnostics, timings);
  }

  let updateStatements = 0;
  const updateStartedAt = performance.now();
  try {
    const applyUpdates = async (tx: MaintenanceDbLike) => {
      updateStatements = await applyMaintenanceUpdates(tx, plan.matches, input.dataset);
    };

    if (db.transaction) await db.transaction(applyUpdates);
    else await applyUpdates(db);
  } catch (err: unknown) {
    const updateMs = elapsedSince(updateStartedAt);
    const diagnostics = buildImportDiagnostics(input.rows);
    const timings = createTimings({ parseMs, validateMs, matchMs, updateMs, totalMs: elapsedSince(startedAt) });
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("[tasks/import] transaction failed", {
      dataset: input.dataset,
      rows: input.rows.length,
      matched: plan.matches.length,
      updateStatements,
      timings,
      message: error.message,
      stack: error.stack,
    });
    throw new MaintenanceImportError("transaction", `Import database transaction failed: ${error.message}`, [], diagnostics, timings);
  }
  const updateMs = elapsedSince(updateStartedAt);

  const resultBase = {
    success: true as const,
    updated: plan.matches.length,
    unchanged: plan.unchanged,
    total: input.rows.length,
    skipped: [],
    message: `${plan.matches.length} row${plan.matches.length === 1 ? "" : "s"} updated; ${plan.unchanged} row${plan.unchanged === 1 ? "" : "s"} unchanged; 0 rows rejected.`,
  };
  const responseSerializationMs = measureResponseSerializationMs(resultBase);
  const totalMs = elapsedSince(startedAt);
  const timings = createTimings({ parseMs, validateMs, matchMs, updateMs, responseSerializationMs, totalMs });
  const result: MaintenanceImportResult = { ...resultBase, timings };

  console.info("[tasks/import] complete", {
    dataset: input.dataset,
    rows: input.rows.length,
    updated: result.updated,
    unchanged: result.unchanged,
    updateStatements,
    timings,
  });
  return result;
}
