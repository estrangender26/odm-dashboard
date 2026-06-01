import { and, eq } from "drizzle-orm";
import { equipment, tasks } from "../db/schema";

export type MaintenanceDataset = "htt" | "aglipay";

export interface MaintenanceImportRow {
  equipmentType: string;
  taskList: string;
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

interface SelectBuilderLike {
  from: (table: unknown) => {
    innerJoin: (table: unknown, on: unknown) => {
      where: (condition: unknown) => Promise<Array<{ id: number; equipmentName: string; taskList: string }>>;
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

const MAX_VARCHAR: Record<"operations" | "amd" | "ard" | "procedureFamiliarity", number> = {
  operations: 100,
  amd: 100,
  ard: 100,
  procedureFamiliarity: 50,
};

const FIELD_LABELS: Record<keyof typeof MAX_VARCHAR, string> = {
  operations: "Operations",
  amd: "AMD",
  ard: "ARD",
  procedureFamiliarity: "Procedure Familiarity",
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

export function validateMaintenanceImportRows(rows: MaintenanceImportRow[]): MaintenanceImportSkippedRow[] {
  const errors: MaintenanceImportSkippedRow[] = [];

  rows.forEach((row, idx) => {
    const rowNumber = row.rowNumber ?? idx + 2;
    const eqName = String(row.equipmentType ?? "").trim();
    const taskList = String(row.taskList ?? "").trim();

    if (!eqName) {
      errors.push({ row: rowNumber, eq: "", task: printable(taskList), reason: "Equipment Name is required" });
    }
    if (!taskList) {
      errors.push({ row: rowNumber, eq: printable(eqName), task: "", reason: "Task Description is required" });
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
  existingRows: Array<{ id: number; equipmentName: string; taskList: string }>,
  hasFamiliarityColumn: boolean,
): MaintenanceImportPlan {
  const byKey = new Map<string, Array<{ id: number; equipmentName: string; taskList: string }>>();
  for (const existing of existingRows) {
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
    if (!equipmentType || !taskList) return;

    const key = `${normalizeImportKey(equipmentType)}\u0000${normalizeImportKey(taskList)}`;
    const matched = byKey.get(key) ?? [];
    if (matched.length === 0) {
      skipped.push({ row, eq: printable(equipmentType), task: printable(taskList), reason: "No matching task found for this dataset/equipment/task" });
      return;
    }
    if (matched.length > 1) {
      skipped.push({ row, eq: printable(equipmentType), task: printable(taskList), reason: "Multiple matching tasks found; import would be ambiguous" });
      return;
    }

    const updateData: Record<string, string | null> = {};
    const operations = cleanOptional(rawRow.operations);
    const amd = cleanOptional(rawRow.amd);
    const ard = cleanOptional(rawRow.ard);
    const procedureFamiliarity = cleanOptional(rawRow.procedureFamiliarity);

    if (operations !== null) updateData.operations = operations;
    if (amd !== null) updateData.amd = amd;
    if (ard !== null) updateData.ard = ard;
    if (hasFamiliarityColumn && procedureFamiliarity !== null) updateData.procedureFamiliarity = procedureFamiliarity;

    if (Object.keys(updateData).length === 0) {
      unchanged++;
      return;
    }

    matches.push({ row, equipmentType, taskList, taskId: matched[0].id, updateData });
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

  const validationErrors = validateMaintenanceImportRows(input.rows);
  if (validationErrors.length > 0) {
    console.warn("[tasks/import] row validation failed", { dataset: input.dataset, errors: validationErrors.slice(0, 20) });
    throw new Error(formatMaintenanceImportFailure(validationErrors));
  }

  const existingRows = await db
    .select({ id: tasks.id, equipmentName: equipment.name, taskList: tasks.taskList })
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
