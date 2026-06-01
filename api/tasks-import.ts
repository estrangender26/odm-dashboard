import { and, eq } from "drizzle-orm";
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
}

export interface MaintenanceImportSkippedRow {
  row: number;
  eq: string;
  task: string;
  reason: string;
}

export interface MaintenanceImportResult {
  success: true;
  updated: number;
  unchanged: number;
  total: number;
  skipped: MaintenanceImportSkippedRow[];
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

function summarizeSkipped(skipped: MaintenanceImportSkippedRow[], limit = 5): string {
  return skipped
    .slice(0, limit)
    .map((s) => `row ${s.row}${s.eq ? ` [${s.eq}]` : ""}${s.task ? ` "${s.task}"` : ""}: ${s.reason}`)
    .join("; ");
}

export function formatMaintenanceImportFailure(skipped: MaintenanceImportSkippedRow[], prefix = "Import validation failed"): string {
  if (skipped.length === 0) return prefix;
  const extra = skipped.length > 5 ? `; +${skipped.length - 5} more` : "";
  return `${prefix}: ${summarizeSkipped(skipped)}${extra}`;
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

export async function importMaintenancePlanningRows(
  db: MaintenanceDbLike,
  input: MaintenanceImportInput,
  hasFamiliarityColumn: boolean,
): Promise<MaintenanceImportResult> {
  const startedAt = Date.now();
  console.info("[tasks/import] start", { dataset: input.dataset, rows: input.rows.length, hasFamiliarityColumn });

  const validationErrors = validateMaintenanceImportRows(input.rows, input.dataset);
  if (validationErrors.length > 0) {
    console.warn("[tasks/import] row validation failed", { dataset: input.dataset, errors: validationErrors.slice(0, 20) });
    throw new Error(formatMaintenanceImportFailure(validationErrors));
  }

  const existingRows = await db
    .select({ id: tasks.id, equipmentCode: equipment.initials, equipmentName: equipment.name, taskList: tasks.taskList, dataset: tasks.dataset })
    .from(tasks)
    .innerJoin(equipment, eq(tasks.equipmentId, equipment.id))
    .where(eq(tasks.dataset, input.dataset));

  const plan = buildMaintenanceImportPlan(input.rows, existingRows, hasFamiliarityColumn);
  if (plan.skipped.length > 0) {
    console.warn("[tasks/import] mapping failed", { dataset: input.dataset, skipped: plan.skipped.slice(0, 20) });
    throw new Error(formatMaintenanceImportFailure(plan.skipped, "Import mapping failed"));
  }

  const applyUpdates = async (tx: MaintenanceDbLike) => {
    for (const match of plan.matches) {
      console.info("[tasks/import] updating row", {
        dataset: input.dataset,
        row: match.row,
        taskId: match.taskId,
        equipment: match.equipmentType,
        task: printable(match.taskList),
        fields: Object.keys(match.updateData),
      });
      await tx.update(tasks).set(match.updateData).where(and(eq(tasks.id, match.taskId), eq(tasks.dataset, input.dataset)));
    }
  };

  try {
    if (db.transaction) await db.transaction(applyUpdates);
    else await applyUpdates(db);
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("[tasks/import] transaction failed", {
      dataset: input.dataset,
      rows: input.rows.length,
      matched: plan.matches.length,
      message: error.message,
      stack: error.stack,
    });
    throw new Error(`Import database transaction failed: ${error.message}`);
  }

  const result: MaintenanceImportResult = {
    success: true,
    updated: plan.matches.length,
    unchanged: plan.unchanged,
    total: input.rows.length,
    skipped: [],
  };
  console.info("[tasks/import] complete", { ...result, dataset: input.dataset, elapsedMs: Date.now() - startedAt });
  return result;
}
