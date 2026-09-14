/**
 * Minimal stateful in-memory stand-in for the Drizzle client used by
 * `api/documents-router.ts`.
 *
 * Purpose: let the O&M Manuals Library rename authorization/validation/integrity
 * tests exercise the real procedure code (authorization middleware, input
 * validation, statements, data mutation) without a live PostgreSQL instance.
 *
 * Only the statement shapes used by `renameFolder`, `deleteFolder` and
 * `deleteFile` are implemented. Any other shape throws, so a test can never
 * silently pass against an unimplemented path.
 */
import { docFiles, docFolders } from "@db/schema";

export interface FakeFolderRow {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeFileRow {
  id: number;
  folderId: number;
  title: string;
  fileName: string;
  storageBucket: string | null;
  storagePath: string | null;
  updatedAt: Date;
}

export interface FakeDbState {
  folders: FakeFolderRow[];
  files: FakeFileRow[];
}

/** Condition shapes produced by the mocked `drizzle-orm` helpers. */
export interface FakeCondition {
  op: "eq" | "isNull" | "inArray";
  column: unknown;
  value?: unknown;
  values?: unknown[];
}

type Row = Record<string, unknown>;
type TableRef = unknown;
type Selection = Record<string, unknown>;

export const fakeDbState: FakeDbState = { folders: [], files: [] };

export function resetFakeDbState(): void {
  fakeDbState.folders.length = 0;
  fakeDbState.files.length = 0;
}

const FOLDER_COLUMNS = new Map<unknown, string>([
  [docFolders.id, "id"],
  [docFolders.parentId, "parentId"],
  [docFolders.name, "name"],
  [docFolders.sortOrder, "sortOrder"],
  [docFolders.createdAt, "createdAt"],
  [docFolders.updatedAt, "updatedAt"],
]);

const FILE_COLUMNS = new Map<unknown, string>([
  [docFiles.id, "id"],
  [docFiles.folderId, "folderId"],
  [docFiles.title, "title"],
  [docFiles.fileName, "fileName"],
  [docFiles.storageBucket, "storageBucket"],
  [docFiles.storagePath, "storagePath"],
  [docFiles.updatedAt, "updatedAt"],
]);

function columnsFor(table: TableRef): Map<unknown, string> {
  if (table === docFolders) return FOLDER_COLUMNS;
  if (table === docFiles) return FILE_COLUMNS;
  throw new Error("fake-db: unsupported table");
}

function rowsFor(table: TableRef): Row[] {
  if (table === docFolders) return fakeDbState.folders as unknown as Row[];
  if (table === docFiles) return fakeDbState.files as unknown as Row[];
  throw new Error("fake-db: unsupported table");
}

function matches(row: Row, condition: FakeCondition | null, columns: Map<unknown, string>): boolean {
  if (!condition) return true;
  const field = columns.get(condition.column);
  if (!field) throw new Error("fake-db: unmapped column used in where()");
  if (condition.op === "eq") return row[field] === condition.value;
  if (condition.op === "isNull") return row[field] === null || row[field] === undefined;
  return (condition.values ?? []).includes(row[field]);
}

function project(row: Row, selection: Selection | undefined, columns: Map<unknown, string>): Row {
  if (!selection) return { ...row };
  const projected: Row = {};
  for (const [key, column] of Object.entries(selection)) {
    const field = columns.get(column);
    if (!field) throw new Error(`fake-db: unmapped selected column "${key}"`);
    projected[key] = row[field];
  }
  return projected;
}

function createSelect(selection?: Selection) {
  let table: TableRef;
  let condition: FakeCondition | null = null;
  let limitCount: number | null = null;

  const resolveRows = (): Row[] => {
    const columns = columnsFor(table);
    let rows = rowsFor(table).filter((row) => matches(row, condition, columns));
    if (limitCount !== null) rows = rows.slice(0, limitCount);
    return rows.map((row) => project(row, selection, columns));
  };

  const chain = {
    from(nextTable: TableRef) {
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

function createUpdate(table: TableRef) {
  let condition: FakeCondition | null = null;
  let values: Row | null = null;
  const matched: Row[] = [];

  const resolveRows = (): Row[] => {
    const columns = columnsFor(table);
    const rows = rowsFor(table).filter((row) => matches(row, condition, columns));
    matched.length = 0;
    matched.push(...rows);
    for (const row of rows) Object.assign(row, values ?? {});
    return rows.map((row) => ({ ...row }));
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
    returning() {
      return Promise.resolve(resolveRows());
    },
    then(resolve: (rows: Row[]) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve().then(resolveRows).then(resolve, reject);
    },
  };

  return chain;
}

function createDelete(table: TableRef) {
  let condition: FakeCondition | null = null;

  const removeRows = (selection?: Selection): Row[] => {
    const columns = columnsFor(table);
    const rows = rowsFor(table);
    const matched = rows.filter((row) => matches(row, condition, columns));
    for (const row of matched) rows.splice(rows.indexOf(row), 1);
    return matched.map((row) => project(row, selection, columns));
  };

  const chain = {
    where(nextCondition: FakeCondition) {
      condition = nextCondition;
      return chain;
    },
    returning(selection?: Selection) {
      return Promise.resolve(removeRows(selection));
    },
    then(resolve: (rows: Row[]) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve().then(() => removeRows()).then(resolve, reject);
    },
  };

  return chain;
}

const transactionClient = {
  select: (selection?: Selection) => createSelect(selection),
  update: (table: TableRef) => createUpdate(table),
  delete: (table: TableRef) => createDelete(table),
};

function unsupported(statement: string): never {
  throw new Error(`fake-db: ${statement} is not implemented for these tests`);
}

export const fakeDb = {
  select: (selection?: Selection) => createSelect(selection),
  update: (table: TableRef) => createUpdate(table),
  delete: (table: TableRef) => createDelete(table),
  insert: () => unsupported("insert"),
  execute: () => unsupported("execute"),
  query: () => unsupported("query"),
  transaction: (callback: (tx: typeof transactionClient) => Promise<unknown>) => callback(transactionClient),
};
