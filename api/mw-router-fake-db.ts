/**
 * Minimal stateful in-memory stand-in for the Drizzle client used by
 * `api/mw-router.ts`.
 *
 * Purpose: let the Operator-Driven Maintenance authorization tests exercise the
 * real procedure code (authorization middleware, input validation, statements,
 * data mutation, audit writes, transactions) without a live PostgreSQL
 * instance, and prove that a rejected destructive call performs **zero**
 * database mutations.
 *
 * Only the statement shapes used by `mw-router.ts` are implemented. Any other
 * shape throws, so a test can never silently pass against an unimplemented
 * path. Follows the conventions of `api/documents-router-fake-db.ts`.
 *
 * `drizzle-orm` must be mocked by the test (see `mw-router-authorization.test.ts`)
 * so that `eq()` and `sql` produce the simple shapes interpreted here.
 */
import { mwInspectionAudit, mwInspections } from "@db/schema";

export interface FakeCondition {
  op: "eq";
  column: unknown;
  value: unknown;
}

export type FakeTableName = "mw_inspections" | "mw_inspection_audit";

export interface FakeCall {
  kind: "select" | "insert" | "update" | "delete";
  table: FakeTableName;
  affected: number;
}

export type Row = Record<string, unknown>;

export interface FakeDbState {
  inspections: Row[];
  audit: Row[];
  calls: FakeCall[];
  nextInspectionId: number;
  nextAuditId: number;
}

export const fakeDbState: FakeDbState = {
  inspections: [],
  audit: [],
  calls: [],
  nextInspectionId: 1,
  nextAuditId: 1,
};

export function resetFakeDbState(): void {
  fakeDbState.inspections.length = 0;
  fakeDbState.audit.length = 0;
  fakeDbState.calls.length = 0;
  fakeDbState.nextInspectionId = 1;
  fakeDbState.nextAuditId = 1;
}

/** Seeds one inspection row and returns it. */
export function seedInspection(partial: Partial<Row> & { id?: number } = {}): Row {
  const id = partial.id ?? fakeDbState.nextInspectionId++;
  if (id >= fakeDbState.nextInspectionId) fakeDbState.nextInspectionId = id + 1;
  const row: Row = {
    submissionId: null,
    facilityId: "Balara Water Pumping Station",
    inspector: "Operator A",
    inspectionDate: "2026-09-13",
    assetTag: `WS-WPS-BAL-${String(id).padStart(5, "0")}`,
    assetName: "Centrifugal Pump",
    equipmentType: "Centrifugal Pump",
    category: "Inspection",
    task: "Check for leaks",
    capture1Label: "Leak type",
    capture1Response: "None",
    escalationTrigger: "Escalate on active leak",
    entryNotes: "Okay",
    status: "Active",
    score: 0,
    findings: "",
    date: "2026-09-13",
    submittedAt: `2026-09-13T0${id % 10}:00:00.000Z`,
    frequency: "Daily",
    updatedBy: "system",
    updatedAt: new Date("2026-09-13T00:00:00.000Z"),
    ...partial,
    id,
  };
  fakeDbState.inspections.push(row);
  return row;
}

/** Mutating statements issued against mw_inspections (insert/update/delete). */
export function inspectionMutations(): FakeCall[] {
  return fakeDbState.calls.filter(
    (call) => call.table === "mw_inspections" && call.kind !== "select",
  );
}

const INSPECTION_COLUMNS = new Map<unknown, string>([
  [mwInspections.id, "id"],
  [mwInspections.submissionId, "submissionId"],
  [mwInspections.facilityId, "facilityId"],
  [mwInspections.inspector, "inspector"],
  [mwInspections.inspectionDate, "inspectionDate"],
  [mwInspections.assetTag, "assetTag"],
  [mwInspections.assetName, "assetName"],
  [mwInspections.equipmentType, "equipmentType"],
  [mwInspections.category, "category"],
  [mwInspections.task, "task"],
  [mwInspections.capture1Label, "capture1Label"],
  [mwInspections.capture1Response, "capture1Response"],
  [mwInspections.escalationTrigger, "escalationTrigger"],
  [mwInspections.entryNotes, "entryNotes"],
  [mwInspections.status, "status"],
  [mwInspections.score, "score"],
  [mwInspections.findings, "findings"],
  [mwInspections.date, "date"],
  [mwInspections.submittedAt, "submittedAt"],
  [mwInspections.frequency, "frequency"],
  [mwInspections.updatedBy, "updatedBy"],
  [mwInspections.updatedAt, "updatedAt"],
]);

const AUDIT_COLUMNS = new Map<unknown, string>([
  [mwInspectionAudit.id, "id"],
  [mwInspectionAudit.operation, "operation"],
  [mwInspectionAudit.actorId, "actorId"],
  [mwInspectionAudit.actorRole, "actorRole"],
  [mwInspectionAudit.resource, "resource"],
  [mwInspectionAudit.affectedCount, "affectedCount"],
  [mwInspectionAudit.correlationId, "correlationId"],
  [mwInspectionAudit.detail, "detail"],
  [mwInspectionAudit.createdAt, "createdAt"],
]);

/** DB column name (snake_case) -> row property name, used to resolve EXCLUDED.* in upserts. */
const INSPECTION_FIELDS_BY_DB_NAME = new Map<string, string>();
for (const [key, column] of Object.entries(mwInspections)) {
  const dbName = (column as { name?: unknown })?.name;
  if (typeof dbName === "string") INSPECTION_FIELDS_BY_DB_NAME.set(dbName, key);
}

function tableNameOf(table: unknown): FakeTableName {
  if (table === mwInspections) return "mw_inspections";
  if (table === mwInspectionAudit) return "mw_inspection_audit";
  throw new Error("fake-db: unsupported table");
}

function columnsFor(table: unknown): Map<unknown, string> {
  if (table === mwInspections) return INSPECTION_COLUMNS;
  if (table === mwInspectionAudit) return AUDIT_COLUMNS;
  throw new Error("fake-db: unsupported table");
}

function rowsFor(table: unknown): Row[] {
  if (table === mwInspections) return fakeDbState.inspections;
  if (table === mwInspectionAudit) return fakeDbState.audit;
  throw new Error("fake-db: unsupported table");
}

function matches(row: Row, condition: FakeCondition | null, columns: Map<unknown, string>): boolean {
  if (!condition) return true;
  if (condition.op !== "eq") throw new Error(`fake-db: unsupported condition ${condition.op}`);
  const field = columns.get(condition.column);
  if (!field) throw new Error("fake-db: unmapped column used in where()");
  return row[field] === condition.value;
}

function project(row: Row, selection: Record<string, unknown> | undefined): Row {
  if (!selection) return { ...row };
  const projected: Row = {};
  for (const [key, column] of Object.entries(selection)) {
    const field = INSPECTION_COLUMNS.get(column) ?? AUDIT_COLUMNS.get(column);
    if (!field) throw new Error(`fake-db: unmapped selected column "${key}"`);
    projected[key] = row[field];
  }
  return projected;
}

function createSelect(selection?: Record<string, unknown>) {
  let table: unknown;
  let condition: FakeCondition | null = null;
  let limitCount: number | null = null;

  const resolveRows = (): Row[] => {
    fakeDbState.calls.push({ kind: "select", table: tableNameOf(table), affected: 0 });
    const columns = columnsFor(table);
    let rows = rowsFor(table).filter((row) => matches(row, condition, columns));
    if (limitCount !== null) rows = rows.slice(0, limitCount);
    return rows.map((row) => project(row, selection));
  };

  const chain = {
    from(nextTable: unknown) {
      table = nextTable;
      return chain;
    },
    where(nextCondition: FakeCondition) {
      condition = nextCondition;
      return chain;
    },
    orderBy() {
      return chain;
    },
    limit(count: number) {
      limitCount = count;
      return Promise.resolve(resolveRows());
    },
    then(resolve: (rows: Row[]) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve().then(resolveRows).then(resolve, reject);
    },
  };

  return chain;
}

/** Resolves one upsert `set` entry: EXCLUDED.<column> comes from the incoming row. */
function resolveUpsertValue(value: unknown, incoming: Row): unknown {
  if (value && typeof value === "object" && "__sql" in (value as Row)) {
    const sqlValue = value as { values?: Array<{ raw?: unknown }> };
    const raw = sqlValue.values?.[0]?.raw;
    if (typeof raw !== "string") throw new Error("fake-db: unsupported sql template in set()");
    const field = INSPECTION_FIELDS_BY_DB_NAME.get(raw);
    if (!field) throw new Error(`fake-db: unmapped EXCLUDED column "${raw}" in set()`);
    return incoming[field];
  }
  return value;
}

function createInsert(table: unknown) {
  let incomingRows: Row[] = [];

  const applyUpsert = (config: { target?: unknown[]; set?: Row }): number => {
    const targetFields = (config.target ?? []).map((column) => {
      const field = INSPECTION_COLUMNS.get(column);
      if (!field) throw new Error("fake-db: unmapped onConflictDoUpdate target column");
      return field;
    });
    const existing = rowsFor(table);
    let touched = 0;
    for (const incoming of incomingRows) {
      const conflict = existing.find((row) =>
        targetFields.every((field) => row[field] === incoming[field]),
      );
      if (!conflict) {
        existing.push({ ...incoming, id: fakeDbState.nextInspectionId++ });
        touched += 1;
        continue;
      }
      for (const [field, value] of Object.entries(config.set ?? {})) {
        conflict[field] = resolveUpsertValue(value, incoming);
      }
      touched += 1;
    }
    return touched;
  };

  const insertRows = (): number => {
    if (tableNameOf(table) === "mw_inspection_audit") {
      for (const incoming of incomingRows) {
        fakeDbState.audit.push({ ...incoming, id: fakeDbState.nextAuditId++ });
      }
      return incomingRows.length;
    }
    return incomingRows.length;
  };

  const chain = {
    values(next: Row | Row[]) {
      incomingRows = Array.isArray(next) ? next : [next];
      return chain;
    },
    onConflictDoUpdate(config: { target?: unknown[]; set?: Row }) {
      const touched = applyUpsert(config);
      fakeDbState.calls.push({ kind: "insert", table: tableNameOf(table), affected: touched });
      return Promise.resolve();
    },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve()
        .then(() => {
          const inserted = insertRows();
          fakeDbState.calls.push({ kind: "insert", table: tableNameOf(table), affected: inserted });
          return inserted;
        })
        .then(resolve, reject);
    },
  };

  return chain;
}

function createUpdate(table: unknown) {
  let condition: FakeCondition | null = null;
  let values: Row | null = null;

  const resolveRows = (selection?: Record<string, unknown>): Row[] => {
    const columns = columnsFor(table);
    const rows = rowsFor(table).filter((row) => matches(row, condition, columns));
    for (const row of rows) Object.assign(row, values ?? {});
    fakeDbState.calls.push({ kind: "update", table: tableNameOf(table), affected: rows.length });
    return rows.map((row) => project(row, selection));
  };

  const chain = {
    set(nextValues: Row) {
      values = nextValues;
      return chain;
    },
    where(nextCondition: FakeCondition) {
      condition = nextCondition;
      return chain;
    },
    returning(selection?: Record<string, unknown>) {
      return Promise.resolve(resolveRows(selection));
    },
    then(resolve: (rows: Row[]) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve().then(() => resolveRows()).then(resolve, reject);
    },
  };

  return chain;
}

function createDelete(table: unknown) {
  let condition: FakeCondition | null = null;

  const removeRows = (selection?: Record<string, unknown>): Row[] => {
    const columns = columnsFor(table);
    const rows = rowsFor(table);
    const matched = rows.filter((row) => matches(row, condition, columns));
    for (const row of matched) rows.splice(rows.indexOf(row), 1);
    fakeDbState.calls.push({ kind: "delete", table: tableNameOf(table), affected: matched.length });
    return matched.map((row) => project(row, selection));
  };

  const chain = {
    where(nextCondition: FakeCondition) {
      condition = nextCondition;
      return chain;
    },
    returning(selection?: Record<string, unknown>) {
      return Promise.resolve(removeRows(selection));
    },
    then(resolve: (rows: Row[]) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve().then(() => removeRows()).then(resolve, reject);
    },
  };

  return chain;
}

function createClient() {
  return {
    select: (selection?: Record<string, unknown>) => createSelect(selection),
    insert: (table: unknown) => createInsert(table),
    update: (table: unknown) => createUpdate(table),
    delete: (table: unknown) => createDelete(table),
  };
}

function unsupported(statement: string): never {
  throw new Error(`fake-db: ${statement} is not implemented for these tests`);
}

export const fakeDb = {
  ...createClient(),
  execute: () => unsupported("execute"),
  query: () => unsupported("query"),
  transaction: (callback: (tx: ReturnType<typeof createClient>) => Promise<unknown>) =>
    callback(createClient()),
};
