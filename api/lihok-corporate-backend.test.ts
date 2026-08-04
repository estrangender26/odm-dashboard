import { describe, it, expect, vi, beforeEach } from "vitest";

// ----------------------------------------------------------------------------
// Dependency mocks
// ----------------------------------------------------------------------------

const routerMocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  categories: [
    { id: 1, code: "01", name: "Corporate Foundation", sortOrder: 1 },
    { id: 2, code: "02", name: "Legal & Compliance", sortOrder: 2 },
    { id: 3, code: "03", name: "Governance", sortOrder: 3 },
  ],
  documents: new Map<number, Record<string, unknown>>(),
  versions: new Map<number, Record<string, unknown>>(),
  audit: [] as Record<string, unknown>[],
  nextDocId: 100,
  nextVersionId: 200,
  insertedDocuments: [] as Record<string, unknown>[],
  insertedVersions: [] as Record<string, unknown>[],
  insertedAudit: [] as Record<string, unknown>[],
  updatedDocuments: [] as Array<{ id: number; values: Record<string, unknown> }>,
}));

vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
vi.stubEnv("APP_ID", "test-app");
vi.stubEnv("APP_SECRET", "test-app-secret");
vi.stubEnv("KIMI_AUTH_URL", "https://auth.example.test");
vi.stubEnv("KIMI_OPEN_URL", "https://open.example.test");

vi.mock("./kimi/auth", () => ({
  authenticateRequest: (...args: unknown[]) => routerMocks.authenticateRequest(...args),
}));

function snakeToCamel(name: string): string {
  return name.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
}

function getRowValue(row: Record<string, unknown>, dbName: string): unknown {
  const key = snakeToCamel(dbName);
  return row[key] ?? row[dbName];
}

function isRawSqlChunk(chunk: unknown): chunk is { value: string[] } {
  return typeof chunk === "object" && chunk !== null && Array.isArray((chunk as any).value);
}

function getRawText(chunk: unknown): string | null {
  if (isRawSqlChunk(chunk)) return (chunk as { value: string[] }).value.join("");
  return null;
}

function isColumnChunk(chunk: unknown): chunk is { name: string } {
  return typeof chunk === "object" && chunk !== null && "name" in chunk && typeof (chunk as any).name === "string";
}

function resolveParam(chunk: unknown): unknown {
  if (
    typeof chunk === "object" &&
    chunk !== null &&
    "value" in chunk &&
    !Array.isArray((chunk as any).value)
  ) {
    return (chunk as any).value;
  }
  return chunk;
}

function evaluateSqlFragment(text: string): (row: Record<string, unknown>) => boolean {
  const colMatch = text.match(/\$\{col\('(\w+)'\)\}/);
  const colName = colMatch ? colMatch[1] : null;
  if (!colName) return () => true;
  const lower = text.toLowerCase();
  if (lower.includes("is not null")) {
    return (row) => getRowValue(row, colName) != null;
  }
  if (lower.includes("is null")) {
    return (row) => getRowValue(row, colName) == null;
  }
  const eqMatch = text.match(/= ['\"](.+?)['\"]/);
  if (eqMatch) {
    return (row) => getRowValue(row, colName) === eqMatch[1];
  }
  return () => true;
}

function evaluateLeafGroup(chunks: unknown[]): (row: Record<string, unknown>) => boolean {
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (isColumnChunk(chunk)) {
      const colName = chunk.name;
      let j = i + 1;
      while (j < chunks.length && !isRawSqlChunk(chunks[j])) j++;
      const opChunk = chunks[j];
      if (!opChunk) break;
      const opText = getRawText(opChunk) ?? "";
      const opLower = opText.trim().toLowerCase();
      if (opLower === "=" || opLower.startsWith("=")) {
        const val = resolveParam(chunks[j + 1]);
        return (row) => getRowValue(row, colName) === val;
      }
      if (opLower.startsWith("like")) {
        const pattern = String(resolveParam(chunks[j + 1])).replace(/^%|%$/g, "");
        return (row) =>
          String(getRowValue(row, colName) ?? "").toLowerCase().includes(pattern.toLowerCase());
      }
      if (opLower === "is null") {
        return (row) => getRowValue(row, colName) == null;
      }
      if (opLower === "is not null") {
        return (row) => getRowValue(row, colName) != null;
      }
      return () => true;
    }
    const text = getRawText(chunk);
    if (text && !text.match(/^\s*\(?\s*\)?\s*$/)) {
      return evaluateSqlFragment(text);
    }
    if (typeof chunk === "object" && chunk !== null && Array.isArray((chunk as any).queryChunks)) {
      return parseCondition((chunk as any).queryChunks);
    }
  }
  return () => true;
}

function parseCondition(chunks: unknown[]): (row: Record<string, unknown>) => boolean {
  if (!chunks || chunks.length === 0) return () => true;
  const segments: Array<{ type: "group" | "op"; value: unknown[] | string }> = [];
  let current: unknown[] = [];
  for (const chunk of chunks) {
    const text = getRawText(chunk);
    if (text === " and " || text === " or ") {
      if (current.length) segments.push({ type: "group", value: current });
      current = [];
      segments.push({ type: "op", value: text });
    } else if (text === "(" || text === ")") {
      // ignore grouping markers at this level
    } else {
      current.push(chunk);
    }
  }
  if (current.length) segments.push({ type: "group", value: current });

  const groupPredicates = segments
    .filter((s): s is { type: "group"; value: unknown[] } => s.type === "group")
    .map((s) => evaluateLeafGroup(s.value));

  if (groupPredicates.length === 0) return () => true;

  let result = groupPredicates[0];
  let gi = 1;
  for (const seg of segments) {
    if (seg.type === "op" && typeof seg.value === "string" && gi < groupPredicates.length) {
      const next = groupPredicates[gi++];
      if (seg.value === " and ") {
        const prev = result;
        result = (row) => prev(row) && next(row);
      } else if (seg.value === " or ") {
        const prev = result;
        result = (row) => prev(row) || next(row);
      }
    }
  }
  return result;
}

function evaluateWhere(condition: unknown, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  if (!condition) return rows.slice();
  const chunks = (condition as any).queryChunks;
  if (!chunks) return rows.slice();
  const predicate = parseCondition(chunks);
  return rows.filter(predicate);
}

function tableName(table: any): string {
  return String(table?.[Symbol.for("drizzle:Name")] ?? table?.name ?? "");
}

function tableRows(table: any): Record<string, unknown>[] {
  const name = tableName(table);
  if (name === "lihok_corporate_document_categories") return routerMocks.categories;
  if (name === "lihok_corporate_documents") return Array.from(routerMocks.documents.values());
  if (name === "lihok_corporate_document_versions") return Array.from(routerMocks.versions.values());
  if (name === "lihok_corporate_document_audit") return routerMocks.audit;
  return [];
}

function isCountQuery(columns?: any): boolean {
  if (!columns || typeof columns !== "object") return false;
  const keys = Object.keys(columns);
  return keys.length === 1 && keys[0] === "count" && columns.count && typeof columns.count === "object" && Array.isArray(columns.count.queryChunks);
}

function mockDb() {
  routerMocks.insertedDocuments = [];
  routerMocks.insertedVersions = [];
  routerMocks.insertedAudit = [];
  routerMocks.updatedDocuments = [];
  routerMocks.documents.clear();
  routerMocks.versions.clear();
  routerMocks.audit = [];
  routerMocks.nextDocId = 100;
  routerMocks.nextVersionId = 200;

  routerMocks.documents.set(1, {
    id: 1,
    documentNumber: "LT-CORP-001",
    title: "Corporate Foundation Manual",
    description: null,
    categoryId: 1,
    defaultClassification: "internal",
    ownerName: "Office of the President",
    createdBy: 1,
    updatedBy: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
  });

  const selectImpl = (columns?: any) => {
    const ctx: any = { _table: null as any, _where: null as any, _limit: null as number | null, _offset: null as number | null };
    const chain: any = {
      from: (table: any) => { ctx._table = table; return chain; },
      where: (condition: any) => { ctx._where = condition; return chain; },
      orderBy: () => chain,
      groupBy: () => chain,
      limit: (n: number) => { ctx._limit = n; return chain; },
      offset: (n: number) => { ctx._offset = n; return chain; },
      then: (resolve: any) => resolve(executeSelect(ctx, columns)),
    };
    return chain;
  };

  const executeSelect = (ctx: any, columns?: any): any[] => {
    let rows = tableRows(ctx._table);
    if (ctx._where) {
      rows = evaluateWhere(ctx._where, rows);
    }
    if (ctx._offset) rows = rows.slice(ctx._offset);
    if (ctx._limit !== null) rows = rows.slice(0, ctx._limit);
    if (isCountQuery(columns)) {
      return [{ count: rows.length }];
    }
    return rows;
  };

  const db = {
    execute: vi.fn(() => {
      const activeCounts = new Map<number, number>();
      for (const doc of routerMocks.documents.values()) {
        if (!doc.archivedAt) {
          const catId = Number(doc.categoryId);
          activeCounts.set(catId, (activeCounts.get(catId) ?? 0) + 1);
        }
      }
      return Promise.resolve(
        routerMocks.categories.map((c) => ({
          ...c,
          activeDocumentCount: activeCounts.get(c.id) ?? 0,
        })),
      );
    }),
    select: vi.fn(selectImpl),
    insert: vi.fn((table: any) => {
      const name = tableName(table);
      const executeInsert = (values: Record<string, unknown>, returningColumns?: any) => {
        let inserted: any;
        if (name === "lihok_corporate_documents") {
          const id = routerMocks.nextDocId++;
          inserted = { ...values, id };
          routerMocks.documents.set(id, inserted);
          routerMocks.insertedDocuments.push(inserted);
        } else if (name === "lihok_corporate_document_versions") {
          const id = routerMocks.nextVersionId++;
          inserted = { ...values, id, status: values.status ?? "draft" };
          routerMocks.versions.set(id, inserted);
          routerMocks.insertedVersions.push(inserted);
        } else {
          inserted = { ...values, id: routerMocks.audit.length + 1 };
          routerMocks.audit.push(inserted);
          routerMocks.insertedAudit.push(inserted);
        }
        return Promise.resolve([{ id: inserted.id }]);
      };
      return {
        values: (values: Record<string, unknown>) => {
          const result = executeInsert(values);
          return {
            returning: vi.fn(() => result),
            then: (resolve: any, reject: any) => result.then(resolve, reject),
          };
        },
      };
    }),
    update: vi.fn((table: any) => {
      const name = tableName(table);
      const executeUpdate = (values: Record<string, unknown>, condition: any) => {
        const rows = tableRows(table);
        const matches = evaluateWhere(condition, rows);
        for (const row of matches) {
          Object.assign(row, values);
          if (name === "lihok_corporate_documents") {
            routerMocks.updatedDocuments.push({ id: row.id as number, values });
          }
        }
        return Promise.resolve(matches.map((row) => ({ id: row.id })));
      };
      return {
        set: (values: Record<string, unknown>) => ({
          where: (condition: any) => {
            const result = executeUpdate(values, condition);
            return {
              returning: vi.fn(() => result),
              then: (resolve: any, reject: any) => result.then(resolve, reject),
            };
          },
        }),
      };
    }),
    query: {},
    transaction: vi.fn((fn: (tx: any) => Promise<unknown>) => fn(db)),
  };

  return db;
}

vi.mock("./queries/connection", async () => {
  const db = mockDb();
  return { db, getDb: () => db };
});

import { lihokCorporateRouter } from "./lihok-corporate-router";
import { db } from "./queries/connection";

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("Lihok Corporate Library backend services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb();
    routerMocks.authenticateRequest.mockResolvedValue({ id: 1, name: "Admin User", role: "admin" } as any);
  });

  function asNonAdmin() {
    routerMocks.authenticateRequest.mockResolvedValue({ id: 2, name: "Regular User", role: "user" } as any);
  }

  function asAnonymous() {
    routerMocks.authenticateRequest.mockRejectedValue({ tag: "app_error", status: 403, message: "Invalid authentication token." } as any);
  }

  function seedDocument(id: number, overrides: Record<string, unknown> = {}) {
    routerMocks.documents.set(id, {
      id,
      documentNumber: `LT-CORP-${String(id).padStart(3, "0")}`,
      title: "Seeded Document",
      description: null,
      categoryId: 1,
      defaultClassification: "internal",
      ownerName: "Owner",
      createdBy: 1,
      updatedBy: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
      ...overrides,
    });
  }

  function seedVersion(id: number, overrides: Record<string, unknown> = {}) {
    routerMocks.versions.set(id, {
      id,
      documentId: 1,
      versionNumber: "1.0",
      title: "Seeded Version",
      description: null,
      status: "draft",
      classification: "internal",
      ownerName: null,
      effectiveDate: null,
      changeNotes: null,
      fileName: null,
      fileSize: null,
      mimeType: null,
      storageProvider: null,
      storageBucket: null,
      storagePath: null,
      storageEtag: null,
      storageUploadedAt: null,
      uploadedBy: 2,
      reviewedBy: null,
      reviewedAt: null,
      approvedBy: null,
      approvedAt: null,
      supersededByVersionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });
  }

  function withStorage(overrides: Record<string, unknown> = {}) {
    return {
      fileName: "manual.pdf",
      fileSize: 12345,
      mimeType: "application/pdf",
      storageProvider: "supabase",
      storageBucket: "lihok-corporate-library",
      storagePath: "documents/manual.pdf",
      storageUploadedAt: new Date(),
      ...overrides,
    };
  }

  describe("authentication", () => {
    it("rejects anonymous GET /categories", async () => {
      asAnonymous();
      const res = await lihokCorporateRouter.request("http://localhost/categories");
      expect(res.status).toBe(403);
    });

    it("rejects anonymous GET /documents", async () => {
      asAnonymous();
      const res = await lihokCorporateRouter.request("http://localhost/documents");
      expect(res.status).toBe(403);
    });

    it("rejects anonymous GET /documents/:id", async () => {
      asAnonymous();
      const res = await lihokCorporateRouter.request("http://localhost/documents/1");
      expect(res.status).toBe(403);
    });

    it("rejects anonymous GET /documents/:id/versions", async () => {
      asAnonymous();
      const res = await lihokCorporateRouter.request("http://localhost/documents/1/versions");
      expect(res.status).toBe(403);
    });

    it("rejects anonymous GET /versions/:id", async () => {
      seedVersion(1);
      asAnonymous();
      const res = await lihokCorporateRouter.request("http://localhost/versions/1");
      expect(res.status).toBe(403);
    });

    it("rejects anonymous GET /documents/:id/audit", async () => {
      asAnonymous();
      const res = await lihokCorporateRouter.request("http://localhost/documents/1/audit");
      expect(res.status).toBe(403);
    });
  });

  describe("categories", () => {
    it("lists categories with active document counts", async () => {
      const res = await lihokCorporateRouter.request("http://localhost/categories");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { categories: Array<{ name: string; activeDocumentCount: number }> };
      expect(body.categories.length).toBe(3);
      expect(body.categories[0]).toHaveProperty("activeDocumentCount");
    });

    it("counts active documents per category", async () => {
      seedDocument(2, { categoryId: 2, archivedAt: null });
      seedDocument(3, { categoryId: 3, archivedAt: new Date() });
      const res = await lihokCorporateRouter.request("http://localhost/categories");
      const body = (await res.json()) as { categories: Array<{ id: number; activeDocumentCount: number }> };
      expect(body.categories.find((c) => c.id === 1)?.activeDocumentCount).toBe(1);
      expect(body.categories.find((c) => c.id === 2)?.activeDocumentCount).toBe(1);
      expect(body.categories.find((c) => c.id === 3)?.activeDocumentCount).toBe(0);
    });
  });

  describe("documents", () => {
    it("creates a document and writes an audit entry", async () => {
      const transactionSpy = vi.spyOn(db, "transaction");
      const res = await lihokCorporateRouter.request("http://localhost/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentNumber: "LT-CORP-002",
          title: "Legal Manual",
          categoryId: 1,
          defaultClassification: "internal",
          ownerName: "Legal Counsel",
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { document: { id: number } };
      expect(body.document.id).toBeDefined();
      expect(routerMocks.insertedDocuments.length).toBe(1);
      expect(routerMocks.insertedAudit.length).toBe(1);
      expect(transactionSpy).toHaveBeenCalled();
    });

    it("rejects duplicate document numbers", async () => {
      const res = await lihokCorporateRouter.request("http://localhost/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentNumber: "LT-CORP-001",
          title: "Duplicate",
          categoryId: 1,
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toContain("already exists");
    });

    it("rejects create with unknown category", async () => {
      const res = await lihokCorporateRouter.request("http://localhost/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentNumber: "LT-CORP-099",
          title: "Bad Category",
          categoryId: 999,
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toContain("Category not found");
    });

    it("reads a document by id", async () => {
      const res = await lihokCorporateRouter.request("http://localhost/documents/1");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { document: { id: number } };
      expect(body.document.id).toBe(1);
    });

    it("updates document metadata atomically with audit", async () => {
      const transactionSpy = vi.spyOn(db, "transaction");
      const res = await lihokCorporateRouter.request("http://localhost/documents/1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Updated Title" }),
      });
      expect(res.status).toBe(200);
      expect(routerMocks.documents.get(1)?.title).toBe("Updated Title");
      expect(routerMocks.insertedAudit.length).toBe(1);
      expect(transactionSpy).toHaveBeenCalled();
    });

    it("archives and restores a document", async () => {
      const archiveRes = await lihokCorporateRouter.request("http://localhost/documents/1/archive", {
        method: "POST",
      });
      expect(archiveRes.status).toBe(200);
      expect(routerMocks.documents.get(1)?.archivedAt).not.toBeNull();

      const restoreRes = await lihokCorporateRouter.request("http://localhost/documents/1/restore", {
        method: "POST",
      });
      expect(restoreRes.status).toBe(200);
      expect(routerMocks.documents.get(1)?.archivedAt).toBeNull();
    });

    it("blocks edits on archived documents", async () => {
      seedDocument(1, { archivedAt: new Date() });
      const res = await lihokCorporateRouter.request("http://localhost/documents/1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Should Fail" }),
      });
      expect(res.status).toBe(409);
    });

    it("returns 500 for unexpected errors without leaking details", async () => {
      vi.spyOn(db, "select").mockImplementationOnce(() => {
        throw new Error("unexpected database failure");
      });
      const res = await lihokCorporateRouter.request("http://localhost/documents/1");
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Internal server error.");
    });
  });

  describe("search", () => {
    beforeEach(() => {
      seedDocument(2, {
        documentNumber: "LT-CORP-002",
        title: "Legal Compliance Guide",
        categoryId: 2,
        defaultClassification: "confidential",
        ownerName: "Legal Counsel",
        archivedAt: null,
      });
      seedDocument(3, {
        documentNumber: "LT-CORP-003",
        title: "Archived Handbook",
        categoryId: 1,
        defaultClassification: "internal",
        ownerName: "HR",
        archivedAt: new Date(),
      });
    });

    it("searches by title", async () => {
      const res = await lihokCorporateRouter.request("http://localhost/documents?title=Legal");
      const body = (await res.json()) as { items: Array<{ id: number }>; pagination: { total: number } };
      expect(body.items.map((i) => i.id)).toContain(2);
      expect(body.pagination.total).toBeGreaterThanOrEqual(1);
    });

    it("searches by document number", async () => {
      const res = await lihokCorporateRouter.request("http://localhost/documents?documentNumber=LT-CORP-002");
      const body = (await res.json()) as { items: Array<{ id: number }>; pagination: { total: number } };
      expect(body.items.map((i) => i.id)).toContain(2);
    });

    it("filters by classification", async () => {
      const res = await lihokCorporateRouter.request("http://localhost/documents?classification=confidential");
      const body = (await res.json()) as { items: Array<{ id: number }> };
      expect(body.items.map((i) => i.id)).toContain(2);
      expect(body.items.map((i) => i.id)).not.toContain(1);
    });

    it("filters archived documents", async () => {
      const res = await lihokCorporateRouter.request("http://localhost/documents?archived=true");
      const body = (await res.json()) as { items: Array<{ id: number }> };
      expect(body.items.map((i) => i.id)).toContain(3);
    });
  });

  describe("versions", () => {
    it("creates a version and writes an audit entry", async () => {
      const transactionSpy = vi.spyOn(db, "transaction");
      const res = await lihokCorporateRouter.request("http://localhost/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: 1,
          versionNumber: "1.0",
          title: "Version 1.0",
          classification: "internal",
        }),
      });
      expect(res.status).toBe(201);
      expect(routerMocks.insertedVersions.length).toBe(1);
      expect(routerMocks.insertedAudit.length).toBe(1);
      expect(routerMocks.insertedVersions[0].uploadedBy).toBe(1);
      expect(transactionSpy).toHaveBeenCalled();
    });

    it("rejects duplicate version number per document", async () => {
      seedVersion(1, { documentId: 1, versionNumber: "1.0" });
      const res = await lihokCorporateRouter.request("http://localhost/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: 1,
          versionNumber: "1.0",
          title: "Duplicate Version",
          classification: "internal",
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toContain("already exists");
    });

    it("rejects version for archived document", async () => {
      seedDocument(1, { archivedAt: new Date() });
      const res = await lihokCorporateRouter.request("http://localhost/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: 1,
          versionNumber: "1.0",
          title: "Orphan Version",
          classification: "internal",
        }),
      });
      expect(res.status).toBe(409);
    });

    it("lists versions for a document", async () => {
      seedVersion(1, { documentId: 1, versionNumber: "1.0" });
      const res = await lihokCorporateRouter.request("http://localhost/documents/1/versions");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[] };
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items.length).toBeGreaterThan(0);
    });

    it("prevents editing approved versions", async () => {
      seedVersion(1, { documentId: 1, versionNumber: "1.0", status: "approved" });
      const res = await lihokCorporateRouter.request("http://localhost/versions/1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: 1, title: "Changed" }),
      });
      expect(res.status).toBe(403);
    });

    it("prevents editing archived versions", async () => {
      seedVersion(1, { documentId: 1, versionNumber: "1.0", status: "archived" });
      const res = await lihokCorporateRouter.request("http://localhost/versions/1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: 1, title: "Changed" }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe("status transitions", () => {
    it("allows draft -> for_review with a completed file", async () => {
      seedVersion(1, { ...withStorage() });
      const res = await lihokCorporateRouter.request("http://localhost/versions/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: 1, documentId: 1, status: "for_review" }),
      });
      expect(res.status).toBe(200);
      expect(routerMocks.versions.get(1)?.status).toBe("for_review");
    });

    it("blocks draft -> for_review without a completed file", async () => {
      seedVersion(1);
      const res = await lihokCorporateRouter.request("http://localhost/versions/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: 1, documentId: 1, status: "for_review" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toContain("completed file upload");
    });

    it("blocks approval without a completed file", async () => {
      seedVersion(1, { status: "for_review" });
      const res = await lihokCorporateRouter.request("http://localhost/versions/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: 1, documentId: 1, status: "approved" }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects approval by a non-admin", async () => {
      asNonAdmin();
      seedVersion(1, { status: "for_review", ...withStorage() });
      const res = await lihokCorporateRouter.request("http://localhost/versions/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: 1, documentId: 1, status: "approved" }),
      });
      expect(res.status).toBe(403);
    });

    it("rejects self-approval", async () => {
      seedVersion(1, { status: "for_review", uploadedBy: 1, ...withStorage() });
      const res = await lihokCorporateRouter.request("http://localhost/versions/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: 1, documentId: 1, status: "approved" }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toContain("Uploaders cannot approve");
    });

    it("allows admin approval by a different user", async () => {
      seedVersion(1, { status: "for_review", uploadedBy: 2, ...withStorage() });
      const res = await lihokCorporateRouter.request("http://localhost/versions/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: 1, documentId: 1, status: "approved" }),
      });
      expect(res.status).toBe(200);
      expect(routerMocks.versions.get(1)?.status).toBe("approved");
      expect(routerMocks.versions.get(1)?.approvedBy).toBe(1);
    });

    it("rejects invalid transitions that break immutability", async () => {
      seedVersion(1, { status: "approved" });
      const res = await lihokCorporateRouter.request("http://localhost/versions/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: 1, documentId: 1, status: "draft" }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects manual supersede transition", async () => {
      seedVersion(1, { status: "approved", ...withStorage() });
      const res = await lihokCorporateRouter.request("http://localhost/versions/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: 1, documentId: 1, status: "superseded" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toContain("Supersession occurs automatically");
    });

    it("treats same-status transition as idempotent no-op", async () => {
      seedVersion(1, { status: "draft" });
      const before = routerMocks.insertedAudit.length;
      const res = await lihokCorporateRouter.request("http://localhost/versions/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: 1, documentId: 1, status: "draft" }),
      });
      expect(res.status).toBe(200);
      expect(routerMocks.insertedAudit.length).toBe(before);
    });

    it("allows approved -> archived", async () => {
      seedVersion(1, { status: "approved", ...withStorage() });
      const res = await lihokCorporateRouter.request("http://localhost/versions/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: 1, documentId: 1, status: "archived" }),
      });
      expect(res.status).toBe(200);
      expect(routerMocks.versions.get(1)?.status).toBe("archived");
    });

    it("blocks archived -> draft", async () => {
      seedVersion(1, { status: "archived" });
      const res = await lihokCorporateRouter.request("http://localhost/versions/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: 1, documentId: 1, status: "draft" }),
      });
      expect(res.status).toBe(400);
    });

    it("automatically supersedes the previous approved version on approval", async () => {
      seedVersion(1, { status: "for_review", uploadedBy: 2, versionNumber: "1.0", ...withStorage() });
      seedVersion(2, { status: "for_review", uploadedBy: 2, versionNumber: "2.0", ...withStorage() });

      const first = await lihokCorporateRouter.request("http://localhost/versions/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: 1, documentId: 1, status: "approved" }),
      });
      expect(first.status).toBe(200);

      const second = await lihokCorporateRouter.request("http://localhost/versions/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: 2, documentId: 1, status: "approved" }),
      });
      expect(second.status).toBe(200);
      expect(routerMocks.versions.get(1)?.status).toBe("superseded");
      expect(routerMocks.versions.get(1)?.supersededByVersionId).toBe(2);
      expect(routerMocks.versions.get(2)?.status).toBe("approved");
    });
  });

  describe("audit", () => {
    it("lists document audit entries", async () => {
      routerMocks.audit.push({
        id: 1,
        documentId: 1,
        versionId: null,
        action: "document.viewed",
        actorUserId: 1,
        actorName: "Test",
        createdAt: new Date(),
      });
      const res = await lihokCorporateRouter.request("http://localhost/documents/1/audit");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[]; pagination: { total: number } };
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items.length).toBe(1);
      expect(body.pagination.total).toBe(1);
    });

    it("lists version audit entries", async () => {
      routerMocks.audit.push({
        id: 1,
        documentId: 1,
        versionId: 1,
        action: "version.created",
        actorUserId: 1,
        actorName: "Test",
        createdAt: new Date(),
      });
      const res = await lihokCorporateRouter.request("http://localhost/documents/1/audit?versionId=1");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ versionId: number }> };
      expect(body.items.length).toBe(1);
      expect(body.items[0].versionId).toBe(1);
    });
  });
});
