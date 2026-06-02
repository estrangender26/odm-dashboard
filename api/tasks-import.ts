import { and, eq, sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
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
  familiarity?: string | null;
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

export interface MaintenanceImportUpdateMetrics {
  total_rows: number;
  initial_rows_per_chunk: number;
  min_rows_per_chunk: number;
  chunk_count: number;
  statement_count: number;
  sequential_fallback_count: number;
  retry_count: number;
  avg_chunk_time_ms: number;
  total_update_time_ms: number;
  max_parameter_count: number;
  max_generated_sql_length: number;
}

export interface MaintenanceImportFailurePayload {
  success: false;
  kind: MaintenanceImportFailureKind;
  message: string;
  rejected: number;
  skipped: MaintenanceImportSkippedRow[];
  diagnostics: MaintenanceImportRowDiagnostics[];
  timings?: MaintenanceImportTimings;
  metrics?: MaintenanceImportUpdateMetrics;
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
  metrics: MaintenanceImportUpdateMetrics;
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

export type MaintenanceImportFieldUpdateCounts = Record<MaintenanceUpdateField, number>;

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
  readonly metrics?: MaintenanceImportUpdateMetrics;
  readonly statusCode = 400;

  constructor(
    kind: MaintenanceImportFailureKind,
    message: string,
    skipped: MaintenanceImportSkippedRow[],
    diagnostics: MaintenanceImportRowDiagnostics[] = [],
    timings?: MaintenanceImportTimings,
    metrics?: MaintenanceImportUpdateMetrics,
  ) {
    super(message);
    this.name = "MaintenanceImportError";
    this.kind = kind;
    this.skipped = skipped;
    this.diagnostics = diagnostics;
    this.timings = timings;
    this.metrics = metrics;
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
      metrics: this.metrics,
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
    const procedureFamiliarity = cleanOptional(rawRow.procedureFamiliarity ?? rawRow.familiarity);

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

const TASK_SET_TARGET_BY_UPDATE_FIELD: Record<MaintenanceUpdateField, SQL> = {
  frequency: sql.raw('"frequency"'),
  responsiblePersonnel: sql.raw('"responsible_personnel"'),
  operations: sql.raw('"operations"'),
  amd: sql.raw('"amd"'),
  ard: sql.raw('"ard"'),
  procedureFamiliarity: sql.raw('"procedure_familiarity"'),
};

const TASK_VALUE_COLUMN_BY_UPDATE_FIELD: Record<MaintenanceUpdateField, SQL> = {
  frequency: sql`${tasks.frequency}`,
  responsiblePersonnel: sql`${tasks.responsiblePersonnel}`,
  operations: sql`${tasks.operations}`,
  amd: sql`${tasks.amd}`,
  ard: sql`${tasks.ard}`,
  procedureFamiliarity: sql`${tasks.procedureFamiliarity}`,
};

const TASK_SQL_COLUMN_BY_UPDATE_FIELD: Record<MaintenanceUpdateField, string> = {
  frequency: "frequency",
  responsiblePersonnel: "responsible_personnel",
  operations: "operations",
  amd: "amd",
  ard: "ard",
  procedureFamiliarity: "procedure_familiarity",
};

export function summarizeMaintenancePlanUpdateCounts(matches: MaintenanceTaskMatch[]): MaintenanceImportFieldUpdateCounts {
  return IMPORT_UPDATE_FIELDS.reduce((counts, field) => {
    counts[field] = matches.filter((match) => Object.prototype.hasOwnProperty.call(match.updateData, field)).length;
    return counts;
  }, {} as MaintenanceImportFieldUpdateCounts);
}

function logMaintenancePlanUpdateCounts(matches: MaintenanceTaskMatch[], hasFamiliarityColumn: boolean): void {
  const updateCounts = summarizeMaintenancePlanUpdateCounts(matches);
  console.info("[tasks/import] update planning counts by field", {
    frequency: updateCounts.frequency,
    operations: updateCounts.operations,
    amd: updateCounts.amd,
    ard: updateCounts.ard,
    procedureFamiliarity: updateCounts.procedureFamiliarity,
    responsiblePersonnel: updateCounts.responsiblePersonnel,
  });
  console.info("[tasks/import] update planner editable fields", {
    editable_fields: IMPORT_UPDATE_FIELDS.map((field) => ({
      field,
      sql_column: TASK_SQL_COLUMN_BY_UPDATE_FIELD[field],
      editable: field !== "procedureFamiliarity" || hasFamiliarityColumn,
    })),
    hasFamiliarityColumn,
    procedureFamiliarityIncludedInPlanner: IMPORT_UPDATE_FIELDS.includes("procedureFamiliarity"),
    procedureFamiliarityUpdateCount: updateCounts.procedureFamiliarity,
  });
}

const IMPORT_UPDATE_INITIAL_CHUNK_SIZE = 25;
const IMPORT_UPDATE_MIN_CHUNK_SIZE = 1;
const IMPORT_DIAGNOSTIC_LIMIT = process.env.NODE_ENV === "production" ? 5 : 20;

interface MaintenanceFieldUpdateStatement {
  field: MaintenanceUpdateField;
  chunkNumber: number;
  rowsPerChunk: number;
  parameterCount: number;
  generatedSqlLength: number;
  query: SQL;
  rows: Array<{
    row: number;
    taskId: number;
    value: string | null;
  }>;
}

interface RenderedSqlDiagnostics {
  sql: string;
  params: unknown[];
}

interface DatabaseErrorDiagnostics {
  name?: string;
  code?: string;
  message: string;
  detail?: string;
  hint?: string;
  severity?: string;
  schema_name?: string;
  table_name?: string;
  column_name?: string;
  data_type_name?: string;
  constraint_name?: string;
  where?: string;
}

interface FrequencySchemaDiagnostics {
  columns: unknown[];
  enumValues: string[];
  checkConstraints: unknown[];
  notNull: boolean | null;
}

const pgDialect = new PgDialect();

const SQL_RENDER_CONFIG = {
  casing: { getColumnCasing: (column: { name: string }) => column.name },
  escapeName: pgDialect.escapeName.bind(pgDialect),
  escapeParam: pgDialect.escapeParam.bind(pgDialect),
  escapeString: pgDialect.escapeString.bind(pgDialect),
};

interface MaintenanceUpdateExecutionMetrics extends MaintenanceImportUpdateMetrics {
  chunkTimes: number[];
}

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

function createEmptyUpdateMetrics(totalRows: number): MaintenanceUpdateExecutionMetrics {
  return {
    total_rows: totalRows,
    initial_rows_per_chunk: IMPORT_UPDATE_INITIAL_CHUNK_SIZE,
    min_rows_per_chunk: IMPORT_UPDATE_MIN_CHUNK_SIZE,
    chunk_count: 0,
    statement_count: 0,
    sequential_fallback_count: 0,
    retry_count: 0,
    avg_chunk_time_ms: 0,
    total_update_time_ms: 0,
    max_parameter_count: 0,
    max_generated_sql_length: 0,
    chunkTimes: [],
  };
}

function finalizeUpdateMetrics(metrics: MaintenanceUpdateExecutionMetrics, totalUpdateTimeMs: number): MaintenanceImportUpdateMetrics {
  metrics.total_update_time_ms = totalUpdateTimeMs;
  metrics.avg_chunk_time_ms = metrics.chunkTimes.length > 0
    ? Math.round(metrics.chunkTimes.reduce((sum, value) => sum + value, 0) / metrics.chunkTimes.length)
    : 0;
  const { chunkTimes: _chunkTimes, ...publicMetrics } = metrics;
  void _chunkTimes;
  return publicMetrics;
}

function updateMaxDiagnostics(metrics: MaintenanceUpdateExecutionMetrics, statement: Pick<MaintenanceFieldUpdateStatement, "parameterCount" | "generatedSqlLength">): void {
  metrics.max_parameter_count = Math.max(metrics.max_parameter_count, statement.parameterCount);
  metrics.max_generated_sql_length = Math.max(metrics.max_generated_sql_length, statement.generatedSqlLength);
}

function getResultRows(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown[] }).rows)) return (result as { rows: unknown[] }).rows;
  return [];
}

function renderSqlDiagnostics(query: SQL): RenderedSqlDiagnostics {
  const rendered = query.toQuery(SQL_RENDER_CONFIG as unknown as Parameters<SQL["toQuery"]>[0]);
  return { sql: rendered.sql, params: rendered.params };
}

function pickErrorString(error: Record<string, unknown>, key: string): string | undefined {
  const value = error[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function extractDatabaseErrorDiagnostics(err: unknown): DatabaseErrorDiagnostics {
  const error = err instanceof Error ? err : new Error(String(err));
  const record = error as unknown as Record<string, unknown>;
  const cause = record.cause as unknown;
  const causeRecord = cause && typeof cause === "object" ? cause as Record<string, unknown> : undefined;
  const source = causeRecord ?? record;

  return {
    name: error.name || pickErrorString(source, "name"),
    code: pickErrorString(source, "code"),
    message: pickErrorString(source, "message") ?? error.message,
    detail: pickErrorString(source, "detail"),
    hint: pickErrorString(source, "hint"),
    severity: pickErrorString(source, "severity"),
    schema_name: pickErrorString(source, "schema_name"),
    table_name: pickErrorString(source, "table_name"),
    column_name: pickErrorString(source, "column_name"),
    data_type_name: pickErrorString(source, "data_type_name"),
    constraint_name: pickErrorString(source, "constraint_name"),
    where: pickErrorString(source, "where"),
  };
}

function formatDatabaseErrorDiagnostics(details: DatabaseErrorDiagnostics): string {
  const parts = [
    details.code ? `Postgres code ${details.code}` : null,
    `message: ${details.message}`,
    details.detail ? `detail: ${details.detail}` : null,
    details.constraint_name ? `constraint: ${details.constraint_name}` : null,
    details.column_name ? `column: ${details.column_name}` : null,
  ].filter(Boolean);
  return parts.join("; ");
}

function normalizeFrequencyForComparison(value: unknown): string {
  return normalizeImportKey(value).replace(/[^a-z0-9]/g, "");
}

async function loadFrequencySchemaDiagnostics(db: MaintenanceDbLike): Promise<FrequencySchemaDiagnostics | null> {
  if (!db.execute) return null;

  const [columnResult, checkResult] = await Promise.all([
    db.execute(sql`
      SELECT
        c.data_type,
        c.udt_name,
        c.is_nullable,
        c.character_maximum_length,
        pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type,
        COALESCE(array_remove(array_agg(e.enumlabel ORDER BY e.enumsortorder), NULL), ARRAY[]::text[]) AS enum_values
      FROM information_schema.columns c
      JOIN pg_catalog.pg_class cls ON cls.relname = c.table_name
      JOIN pg_catalog.pg_namespace ns ON ns.oid = cls.relnamespace AND ns.nspname = c.table_schema
      JOIN pg_catalog.pg_attribute a ON a.attrelid = cls.oid AND a.attname = c.column_name
      LEFT JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
      LEFT JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
      WHERE c.table_schema = current_schema()
        AND c.table_name = 'tasks'
        AND c.column_name = 'frequency'
      GROUP BY c.data_type, c.udt_name, c.is_nullable, c.character_maximum_length, a.atttypid, a.atttypmod
    `),
    db.execute(sql`
      SELECT conname AS constraint_name, pg_catalog.pg_get_constraintdef(oid, true) AS constraint_definition
      FROM pg_catalog.pg_constraint
      WHERE conrelid = 'tasks'::regclass
        AND contype = 'c'
        AND pg_catalog.pg_get_constraintdef(oid, true) ILIKE '%frequency%'
      ORDER BY conname
    `),
  ]);

  const columns = getResultRows(columnResult);
  const checkConstraints = getResultRows(checkResult);
  const firstColumn = columns[0] as Record<string, unknown> | undefined;
  const rawEnumValues = firstColumn?.enum_values;
  const enumValues = Array.isArray(rawEnumValues) ? rawEnumValues.map(String) : [];
  const isNullable = typeof firstColumn?.is_nullable === "string" ? firstColumn.is_nullable : null;

  return {
    columns,
    enumValues,
    checkConstraints,
    notNull: isNullable === null ? null : isNullable === "NO",
  };
}

function logFrequencySchemaDiagnostics(schema: FrequencySchemaDiagnostics | null, matches: MaintenanceTaskMatch[]): void {
  if (!schema) {
    console.info("[tasks/import] frequency schema diagnostics unavailable", { reason: "db.execute unavailable" });
    return;
  }

  const importedFrequencyValues = Array.from(new Set(matches
    .map((match) => match.updateData.frequency)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)));
  const enumLookup = new Set(schema.enumValues.map(normalizeFrequencyForComparison));
  const invalidAgainstEnum = enumLookup.size === 0 ? [] : importedFrequencyValues.filter((value) => !enumLookup.has(normalizeFrequencyForComparison(value)));

  console.info("[tasks/import] frequency schema diagnostics", {
    column: schema.columns[0] ?? null,
    check_constraints: schema.checkConstraints,
    not_null: schema.notNull,
    enum_values: schema.enumValues,
    imported_frequency_values: importedFrequencyValues,
    invalid_imported_frequency_values_against_enum: invalidAgainstEnum,
  });
}

async function logFrequencySchemaDiagnosticsForImport(db: MaintenanceDbLike, matches: MaintenanceTaskMatch[]): Promise<void> {
  if (process.env.NODE_ENV === "test") return;

  try {
    logFrequencySchemaDiagnostics(await loadFrequencySchemaDiagnostics(db), matches);
  } catch (err: unknown) {
    console.warn("[tasks/import] frequency schema diagnostics failed", {
      error: extractDatabaseErrorDiagnostics(err),
    });
  }
}

async function logPostImportFamiliarityDiagnostics(db: MaintenanceDbLike, dataset: MaintenanceDataset, taskIds: number[]): Promise<void> {
  if (!db.execute || process.env.NODE_ENV === "test") return;

  try {
    const httCounts = getResultRows(await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE procedure_familiarity IS NOT NULL) AS populated,
        COUNT(*) AS total
      FROM tasks
      WHERE dataset='htt'
    `));

    console.info("[tasks/import] Post-import HTT procedure_familiarity population count", {
      sql: "SELECT COUNT(*) FILTER (WHERE procedure_familiarity IS NOT NULL) AS populated, COUNT(*) AS total FROM tasks WHERE dataset='htt';",
      rows: httCounts,
    });

    const httRows = getResultRows(await db.execute(sql`
      SELECT id,
             procedure_familiarity
      FROM tasks
      WHERE dataset = 'htt'
      ORDER BY id
      LIMIT 20
    `));

    console.info("[tasks/import] Post-import HTT familiarity DB sample", {
      sql: "SELECT id, procedure_familiarity FROM tasks WHERE dataset='htt' ORDER BY id LIMIT 20;",
      rows: httRows,
    });

    const envTraceIds = String(process.env.TASK_IMPORT_TRACE_IDS ?? "")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isSafeInteger(value) && value > 0);
    const traceIds = Array.from(new Set([...envTraceIds, ...taskIds])).slice(0, 20);
    if (traceIds.length > 0) {
      const traceRows = getResultRows(await db.execute(sql`
        SELECT id,
               procedure_familiarity
        FROM tasks
        WHERE dataset = ${dataset}
          AND id IN (${sql.join(traceIds.map((id) => sql`${id}`), sql.raw(", "))})
        ORDER BY id
      `));

      console.info("[tasks/import] Post-import traced familiarity DB values", {
        dataset,
        sql: "SELECT id, procedure_familiarity FROM tasks WHERE dataset=$1 AND id IN (...) ORDER BY id;",
        taskIds: traceIds,
        rows: traceRows,
      });
    }
  } catch (err: unknown) {
    console.warn("[tasks/import] post-import familiarity diagnostics failed", {
      dataset,
      taskIds: taskIds.slice(0, 20),
      error: extractDatabaseErrorDiagnostics(err),
    });
  }
}

function estimateFieldUpdateDiagnostics(rowCount: number, uniqueIdCount: number): { parameterCount: number; generatedSqlLength: number } {
  // Per split-field statement: each CASE arm binds task id + value, the WHERE binds dataset + id list.
  const parameterCount = rowCount * 2 + uniqueIdCount + 1;
  const caseArmLength = rowCount * " WHEN $0000 THEN $0000".length;
  const idListLength = Math.max(1, uniqueIdCount) * ", $0000".length;
  const generatedSqlLength = 170 + caseArmLength + idListLength;
  return { parameterCount, generatedSqlLength };
}

function buildFieldUpdateStatement(
  chunk: MaintenanceTaskMatch[],
  dataset: MaintenanceDataset,
  field: MaintenanceUpdateField,
  chunkNumber: number,
): MaintenanceFieldUpdateStatement | null {
  const fieldRows = chunk.filter((match) => Object.prototype.hasOwnProperty.call(match.updateData, field));
  if (fieldRows.length === 0) return null;

  const setTarget = TASK_SET_TARGET_BY_UPDATE_FIELD[field];
  const valueColumn = TASK_VALUE_COLUMN_BY_UPDATE_FIELD[field];
  const ids = Array.from(new Set(fieldRows.map((match) => match.taskId)));
  const arms = fieldRows.map((match) => sql`WHEN ${match.taskId} THEN ${match.updateData[field]}`);
  const diagnostics = estimateFieldUpdateDiagnostics(fieldRows.length, ids.length);

  return {
    field,
    chunkNumber,
    rowsPerChunk: fieldRows.length,
    parameterCount: diagnostics.parameterCount,
    generatedSqlLength: diagnostics.generatedSqlLength,
    query: sql`
      UPDATE ${tasks}
      SET ${setTarget} = CASE ${tasks.id} ${sql.join(arms, sql.raw(" "))} ELSE ${valueColumn} END
      WHERE ${tasks.dataset} = ${dataset}
        AND ${tasks.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql.raw(", "))})
    `,
    rows: fieldRows.map((match) => ({ row: match.row, taskId: match.taskId, value: match.updateData[field] ?? null })),
  };
}

function buildFieldUpdateStatements(chunk: MaintenanceTaskMatch[], dataset: MaintenanceDataset, chunkNumber: number): MaintenanceFieldUpdateStatement[] {
  return IMPORT_UPDATE_FIELDS.flatMap((field) => {
    const statement = buildFieldUpdateStatement(chunk, dataset, field, chunkNumber);
    return statement ? [statement] : [];
  });
}

function sanitizeDatabaseErrorMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim() || "Database rejected an import update batch.";
}

function batchFailureMessage(chunkNumber: number, rowsPerChunk: number, err: unknown): string {
  return `Import update batch failed on chunk ${chunkNumber} (${rowsPerChunk} rows). ${formatDatabaseErrorDiagnostics(extractDatabaseErrorDiagnostics(err))}`;
}

async function executeFieldStatements(tx: MaintenanceDbLike, statements: MaintenanceFieldUpdateStatement[], metrics: MaintenanceUpdateExecutionMetrics): Promise<void> {
  if (!tx.execute) throw new Error("Batch update execution is unavailable");

  for (const statement of statements) {
    const rendered = renderSqlDiagnostics(statement.query);
    console.info("[tasks/import] update batch statement", {
      chunk: statement.chunkNumber,
      field: statement.field,
      sql_column: TASK_SQL_COLUMN_BY_UPDATE_FIELD[statement.field],
      rows_per_chunk: statement.rowsPerChunk,
      parameter_count: statement.parameterCount,
      generated_sql_length: statement.generatedSqlLength,
    });
    console.info("[tasks/import] generated SQL batch by field", {
      chunk: statement.chunkNumber,
      field: statement.field,
      sql_column: TASK_SQL_COLUMN_BY_UPDATE_FIELD[statement.field],
      label: `${TASK_SQL_COLUMN_BY_UPDATE_FIELD[statement.field]} batch`,
      sql: rendered.sql,
      parameters: rendered.params,
      rows: statement.rows,
      contains_procedure_familiarity_update: statement.field === "procedureFamiliarity" && rendered.sql.includes("procedure_familiarity"),
    });
    updateMaxDiagnostics(metrics, statement);
    try {
      await tx.execute(statement.query);
      metrics.statement_count += 1;
    } catch (err: unknown) {
      console.error("[tasks/import] update batch statement failed", {
        chunk: statement.chunkNumber,
        field: statement.field,
        rows_per_chunk: statement.rowsPerChunk,
        parameter_count: statement.parameterCount,
        generated_sql_length: statement.generatedSqlLength,
        task_frequency_values: statement.field === "frequency" ? statement.rows.map((row) => ({ row: row.row, task_id: row.taskId, frequency: row.value })) : undefined,
        sql: rendered.sql,
        parameters: rendered.params,
        postgres_error: extractDatabaseErrorDiagnostics(err),
      });
      throw err;
    }
  }
}

async function executeSequentialUpdates(tx: MaintenanceDbLike, chunk: MaintenanceTaskMatch[], dataset: MaintenanceDataset, metrics: MaintenanceUpdateExecutionMetrics): Promise<void> {
  for (const match of chunk) {
    try {
      await tx.update(tasks).set(match.updateData).where(and(eq(tasks.id, match.taskId), eq(tasks.dataset, dataset)));
      metrics.statement_count += 1;
      metrics.sequential_fallback_count += 1;
      metrics.max_parameter_count = Math.max(metrics.max_parameter_count, Object.keys(match.updateData).length + 2);
    } catch (err: unknown) {
      console.error("[tasks/import] direct single-row update failed", {
        row: match.row,
        task_id: match.taskId,
        frequency: match.updateData.frequency ?? null,
        update_data: match.updateData,
        dataset,
        postgres_error: extractDatabaseErrorDiagnostics(err),
      });
      throw err;
    }
  }
}

async function runInOptionalTransaction(db: MaintenanceDbLike, action: (tx: MaintenanceDbLike) => Promise<void>): Promise<void> {
  if (db.transaction) await db.transaction(action);
  else await action(db);
}

async function applyAdaptiveChunk(
  db: MaintenanceDbLike,
  chunk: MaintenanceTaskMatch[],
  dataset: MaintenanceDataset,
  metrics: MaintenanceUpdateExecutionMetrics,
  chunkNumber: number,
): Promise<void> {
  const chunkStartedAt = performance.now();
  try {
    if (!db.execute) {
      await runInOptionalTransaction(db, (tx) => executeSequentialUpdates(tx, chunk, dataset, metrics));
    } else {
      await runInOptionalTransaction(db, async (tx) => {
        const statements = buildFieldUpdateStatements(chunk, dataset, chunkNumber);
        await executeFieldStatements(tx, statements, metrics);
      });
    }
    metrics.chunk_count += 1;
    metrics.chunkTimes.push(elapsedSince(chunkStartedAt));
  } catch (err: unknown) {
    metrics.retry_count += 1;
    console.warn("[tasks/import] update chunk failed", {
      chunk: chunkNumber,
      rows_per_chunk: chunk.length,
      message: batchFailureMessage(chunkNumber, chunk.length, err),
    });

    if (chunk.length > IMPORT_UPDATE_MIN_CHUNK_SIZE) {
      const midpoint = Math.ceil(chunk.length / 2);
      await applyAdaptiveChunk(db, chunk.slice(0, midpoint), dataset, metrics, chunkNumber);
      await applyAdaptiveChunk(db, chunk.slice(midpoint), dataset, metrics, chunkNumber);
      return;
    }

    try {
      await runInOptionalTransaction(db, (tx) => executeSequentialUpdates(tx, chunk, dataset, metrics));
      metrics.chunk_count += 1;
      metrics.chunkTimes.push(elapsedSince(chunkStartedAt));
    } catch (sequentialErr: unknown) {
      const failure = new Error(batchFailureMessage(chunkNumber, chunk.length, sequentialErr));
      (failure as { cause?: unknown }).cause = sequentialErr;
      throw failure;
    }
  }
}

async function applyMaintenanceUpdates(db: MaintenanceDbLike, matches: MaintenanceTaskMatch[], dataset: MaintenanceDataset): Promise<MaintenanceImportUpdateMetrics> {
  const updateStartedAt = performance.now();
  const metrics = createEmptyUpdateMetrics(matches.length);
  if (matches.length === 0) return finalizeUpdateMetrics(metrics, 0);

  for (let offset = 0; offset < matches.length; offset += IMPORT_UPDATE_INITIAL_CHUNK_SIZE) {
    const chunk = matches.slice(offset, offset + IMPORT_UPDATE_INITIAL_CHUNK_SIZE);
    const chunkNumber = Math.floor(offset / IMPORT_UPDATE_INITIAL_CHUNK_SIZE) + 1;
    await applyAdaptiveChunk(db, chunk, dataset, metrics, chunkNumber);
  }

  return finalizeUpdateMetrics(metrics, elapsedSince(updateStartedAt));
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
  logMaintenancePlanUpdateCounts(plan.matches, hasFamiliarityColumn);

  console.info("[tasks/import] import comparison field coverage", {
    hasFamiliarityColumn,
    compared_or_planned_fields: IMPORT_UPDATE_FIELDS.map((field) => ({
      field,
      sql_column: TASK_SQL_COLUMN_BY_UPDATE_FIELD[field],
      included: field !== "procedureFamiliarity" || hasFamiliarityColumn,
      planned_updates: summarizeMaintenancePlanUpdateCounts(plan.matches)[field],
    })),
    note: "The import planner builds updateData from non-empty import values; it does not currently skip rows by comparing imported values against existing DB values.",
  });

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

  console.info("[tasks/import] DB update payload familiarity trace", {
    dataset: input.dataset,
    firstPayloads: plan.matches.slice(0, 10).map((match) => ({
      task_id: match.taskId,
      procedureFamiliarity: Object.prototype.hasOwnProperty.call(match.updateData, "procedureFamiliarity")
        ? match.updateData.procedureFamiliarity ?? null
        : undefined,
    })),
  });

  let metrics = createEmptyUpdateMetrics(plan.matches.length) as MaintenanceImportUpdateMetrics;
  const updateStartedAt = performance.now();
  try {
    await logFrequencySchemaDiagnosticsForImport(db, plan.matches);
    metrics = await applyMaintenanceUpdates(db, plan.matches, input.dataset);
    await logPostImportFamiliarityDiagnostics(db, input.dataset, plan.matches.map((match) => match.taskId));
  } catch (err: unknown) {
    const updateMs = elapsedSince(updateStartedAt);
    const diagnostics = buildImportDiagnostics(input.rows);
    const timings = createTimings({ parseMs, validateMs, matchMs, updateMs, totalMs: elapsedSince(startedAt) });
    const error = err instanceof Error ? err : new Error(String(err));
    const safeMessage = sanitizeDatabaseErrorMessage(error.message);
    console.error("[tasks/import] transaction failed", {
      dataset: input.dataset,
      rows: input.rows.length,
      matched: plan.matches.length,
      chunk_count: metrics.chunk_count,
      statement_count: metrics.statement_count,
      retry_count: metrics.retry_count,
      timings,
      postgres_error: extractDatabaseErrorDiagnostics(err),
      message: safeMessage,
    });
    throw new MaintenanceImportError("transaction", `Import database transaction failed: ${safeMessage}`, [], diagnostics, timings, metrics);
  }
  const updateMs = elapsedSince(updateStartedAt);

  const resultBase = {
    success: true as const,
    updated: plan.matches.length,
    unchanged: plan.unchanged,
    total: input.rows.length,
    skipped: [],
    message: `${plan.matches.length} row${plan.matches.length === 1 ? "" : "s"} updated; ${plan.unchanged} row${plan.unchanged === 1 ? "" : "s"} unchanged; 0 rows rejected.`,
    metrics,
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
    metrics,
    timings,
  });
  return result;
}
