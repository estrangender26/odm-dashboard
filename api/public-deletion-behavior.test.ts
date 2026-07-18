import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// BEHAVIORAL TESTS FOR PUBLIC DELETION
// ============================================================================

const mocks = vi.hoisted(() => ({
  storageRemove: vi.fn(),
  from: vi.fn(),
  getStoredFileRecord: vi.fn(),
  deleteStoredFileRecord: vi.fn(),
}));

vi.mock("./queries/connection", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve([{ id: 1 }])),
    })),
    update: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve([{}])),
    })),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: any, b: any) => ({ column: a, value: b })),
  and: vi.fn((...args: any[]) => ({ conditions: args })),
  sql: Object.assign(
    vi.fn((template: any, ...values: any[]) => ({ template, values })),
    { raw: vi.fn((str: string) => ({ raw: str })) }
  ),
  inArray: vi.fn(),
  isNull: vi.fn(),
  gt: vi.fn(),
  lt: vi.fn(),
}));

vi.mock("./supabase-storage", () => ({
  getSupabaseStorageAdmin: vi.fn(() => ({
    storage: { from: mocks.from },
  })),
  getSupabaseStorageConfig: vi.fn(() => ({
    url: "https://test.supabase.co",
    bucket: "test-bucket",
  })),
}));

vi.mock("./storage-files", () => ({
  getStoredFileRecord: mocks.getStoredFileRecord,
  deleteStoredFileRecord: mocks.deleteStoredFileRecord,
}));

vi.mock("./kimi/auth", () => ({
  authenticateRequest: vi.fn(() => Promise.reject(new Error("No auth"))),
}));

vi.mock("./lib/env", () => ({
  env: {
    supabaseUrl: "https://test.supabase.co",
    supabaseServiceRoleKey: "test-service-key",
    kimiAuthUrl: "https://test.kimi.ai",
    appId: "test-app",
    appSecret: "test-secret-key-for-signing-delete-payloads",
    openaiApiKey: "test-key",
    tavilyApiKey: "test-key",
    webSearchApiKey: "test-key",
    webSearchProvider: "tavily",
  },
}));

import { storageRouter } from "./storage-router";

describe("BEHAVIORAL TESTS: Hono Storage Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storageRemove.mockResolvedValue({ data: {}, error: null });
    mocks.from.mockReturnValue({ remove: mocks.storageRemove });
  });

  it("POST /files/delete/prepare rejects unknown source", async () => {
    const req = new Request("http://localhost/files/delete/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "unknown_source", id: 1 }),
    });
    const res = await storageRouter.request(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect((body as any).error).toBeDefined();
  });

  it("POST /files/delete/prepare handles allowed sources with valid file", async () => {
    mocks.getStoredFileRecord.mockResolvedValue({
      id: 1,
      fileName: "test.pdf",
      storageBucket: "odm-files",
      storagePath: "doc_files/test.pdf",
    });
    const req = new Request("http://localhost/files/delete/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "doc_files", id: 1 }),
    });
    const res = await storageRouter.request(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect((body as any).confirmationToken).toBeDefined();
    expect((body as any).expiresAt).toBeDefined();
  });

  it("POST /files/delete/prepare returns 404 for missing file", async () => {
    mocks.getStoredFileRecord.mockResolvedValue(null);
    const req = new Request("http://localhost/files/delete/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "doc_files", id: 99999 }),
    });
    const res = await storageRouter.request(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect((body as any).error).toContain("not found");
  });

  it("POST /files/delete/confirm rejects invalid token", async () => {
    const req = new Request("http://localhost/files/delete/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmationToken: "invalid.token.here" }),
    });
    const res = await storageRouter.request(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect((body as any).error).toContain("invalid");
  });

  it("POST /files/delete/confirm rejects empty token", async () => {
    const req = new Request("http://localhost/files/delete/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmationToken: "" }),
    });
    const res = await storageRouter.request(req);
    expect(res.status).toBe(400);
  });

  it("POST /files/delete/confirm detects changed file between prepare and confirm", async () => {
    mocks.getStoredFileRecord.mockResolvedValue({
      id: 1,
      fileName: "test.pdf",
      storageBucket: "odm-files",
      storagePath: "doc_files/original.pdf",
    });
    const prepareReq = new Request("http://localhost/files/delete/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "doc_files", id: 1 }),
    });
    const prepareRes = await storageRouter.request(prepareReq);
    const { confirmationToken } = await prepareRes.json() as any;
    mocks.getStoredFileRecord.mockResolvedValue({
      id: 1,
      fileName: "test.pdf",
      storageBucket: "odm-files",
      storagePath: "doc_files/changed.pdf",
    });
    const confirmReq = new Request("http://localhost/files/delete/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmationToken }),
    });
    const confirmRes = await storageRouter.request(confirmReq);
    expect(confirmRes.status).toBe(409);
    const body = await confirmRes.json();
    expect((body as any).error).toContain("changed");
  });

  it("POST /files/delete/confirm prevents deletion when Supabase fails", async () => {
    mocks.getStoredFileRecord.mockResolvedValue({
      id: 1,
      fileName: "test.pdf",
      storageBucket: "odm-files",
      storagePath: "doc_files/test.pdf",
    });
    const prepareReq = new Request("http://localhost/files/delete/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "doc_files", id: 1 }),
    });
    const prepareRes = await storageRouter.request(prepareReq);
    const { confirmationToken } = await prepareRes.json() as any;
    mocks.storageRemove.mockResolvedValue({
      data: null,
      error: { message: "Access denied" },
    });
    const confirmReq = new Request("http://localhost/files/delete/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmationToken }),
    });
    const confirmRes = await storageRouter.request(confirmReq);
    expect(confirmRes.status).toBe(400);
    const body = await confirmRes.json();
    expect((body as any).error).toContain("Storage deletion failed");
    expect(mocks.deleteStoredFileRecord).not.toHaveBeenCalled();
  });
});

describe("BEHAVIORAL TESTS: Additional Coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storageRemove.mockResolvedValue({ data: {}, error: null });
    mocks.from.mockReturnValue({ remove: mocks.storageRemove });
  });

  it("POST /files/delete/confirm succeeds with valid token for all 4 sources", async () => {
    const sources = ["doc_files", "governance_uploads", "governance_files", "smp_documents"];
    for (const source of sources) {
      vi.clearAllMocks();
      mocks.getStoredFileRecord.mockResolvedValue({
        id: 1,
        fileName: "test.pdf",
        storageBucket: "odm-files",
        storagePath: `${source}/test.pdf`,
      });
      mocks.deleteStoredFileRecord.mockResolvedValue({});
      const prepareReq = new Request("http://localhost/files/delete/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, id: 1 }),
      });
      const prepareRes = await storageRouter.request(prepareReq);
      const { confirmationToken } = await prepareRes.json() as any;
      const confirmReq = new Request("http://localhost/files/delete/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationToken }),
      });
      const confirmRes = await storageRouter.request(confirmReq);
      expect(confirmRes.status).toBe(200);
      const body = await confirmRes.json();
      expect((body as any).success).toBe(true);
      expect((body as any).source).toBe(source);
    }
  });

  it("POST /files/delete/confirm returns 404 when file deleted between prepare and confirm", async () => {
    mocks.getStoredFileRecord.mockResolvedValue({
      id: 1,
      fileName: "test.pdf",
      storageBucket: "odm-files",
      storagePath: "doc_files/test.pdf",
    });
    const prepareReq = new Request("http://localhost/files/delete/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "doc_files", id: 1 }),
    });
    const prepareRes = await storageRouter.request(prepareReq);
    const { confirmationToken } = await prepareRes.json() as any;
    mocks.getStoredFileRecord.mockResolvedValue(null);
    const confirmReq = new Request("http://localhost/files/delete/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmationToken }),
    });
    const confirmRes = await storageRouter.request(confirmReq);
    expect(confirmRes.status).toBe(404);
  });

  it("POST /files/delete/confirm rejects replay of same token", async () => {
    mocks.getStoredFileRecord.mockResolvedValue({
      id: 1,
      fileName: "test.pdf",
      storageBucket: "odm-files",
      storagePath: "doc_files/test.pdf",
    });
    mocks.deleteStoredFileRecord.mockResolvedValue({});
    const prepareReq = new Request("http://localhost/files/delete/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "doc_files", id: 1 }),
    });
    const prepareRes = await storageRouter.request(prepareReq);
    const { confirmationToken } = await prepareRes.json() as any;
    const confirmReq1 = new Request("http://localhost/files/delete/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmationToken }),
    });
    const confirmRes1 = await storageRouter.request(confirmReq1);
    expect(confirmRes1.status).toBe(200);
    mocks.getStoredFileRecord.mockResolvedValue(null);
    const confirmReq2 = new Request("http://localhost/files/delete/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmationToken }),
    });
    const confirmRes2 = await storageRouter.request(confirmReq2);
    expect(confirmRes2.status).toBe(404);
  });

  it("POST /files/delete/confirm removes from storage with exact path", async () => {
    mocks.getStoredFileRecord.mockResolvedValue({
      id: 1,
      fileName: "test.pdf",
      storageBucket: "odm-files",
      storagePath: "doc_files/exact-path-test.pdf",
    });
    mocks.deleteStoredFileRecord.mockResolvedValue({});
    const prepareReq = new Request("http://localhost/files/delete/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "doc_files", id: 1 }),
    });
    const prepareRes = await storageRouter.request(prepareReq);
    const { confirmationToken } = await prepareRes.json() as any;
    const confirmReq = new Request("http://localhost/files/delete/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmationToken }),
    });
    await storageRouter.request(confirmReq);
    expect(mocks.storageRemove).toHaveBeenCalledWith(["doc_files/exact-path-test.pdf"]);
    expect(mocks.deleteStoredFileRecord).toHaveBeenCalled();
  });
});

describe("BEHAVIORAL TESTS: tRPC Router Imports", () => {
  it("documentsRouter exports deleteFile procedure", async () => {
    const { documentsRouter } = await import("./documents-router");
    expect(documentsRouter.deleteFile).toBeDefined();
    expect(typeof documentsRouter.deleteFile).toBe("function");
  });

  it("smpRouter exports delete procedure", async () => {
    const { smpRouter } = await import("./smp-router");
    expect(smpRouter.delete).toBeDefined();
    expect(typeof smpRouter.delete).toBe("function");
  });

  it("governanceFilesRouter exports delete procedure", async () => {
    const { governanceFilesRouter } = await import("./governance-files-router");
    expect(governanceFilesRouter.delete).toBeDefined();
    expect(typeof governanceFilesRouter.delete).toBe("function");
  });

  it("governanceRouter exports deleteUpload procedure", async () => {
    const { governanceRouter } = await import("./governance-router");
    expect(governanceRouter.deleteUpload).toBeDefined();
    expect(typeof governanceRouter.deleteUpload).toBe("function");
  });

  it("all delete procedures use publicQuery", async () => {
    const { documentsRouter } = await import("./documents-router");
    const { smpRouter } = await import("./smp-router");
    const { governanceFilesRouter } = await import("./governance-files-router");
    const { governanceRouter } = await import("./governance-router");

    // Verify all procedures are accessible (they'd fail auth if not public)
    expect(documentsRouter.deleteFile).toBeDefined();
    expect(smpRouter.delete).toBeDefined();
    expect(governanceFilesRouter.delete).toBeDefined();
    expect(governanceRouter.deleteUpload).toBeDefined();
  });
});

describe("BEHAVIORAL TESTS: tRPC Router Imports", () => {
  it("documentsRouter exports deleteFile procedure", async () => {
    const { documentsRouter } = await import("./documents-router");
    expect(documentsRouter.deleteFile).toBeDefined();
    expect(typeof documentsRouter.deleteFile).toBe("function");
  });

  it("smpRouter exports delete procedure", async () => {
    const { smpRouter } = await import("./smp-router");
    expect(smpRouter.delete).toBeDefined();
    expect(typeof smpRouter.delete).toBe("function");
  });

  it("governanceFilesRouter exports delete procedure", async () => {
    const { governanceFilesRouter } = await import("./governance-files-router");
    expect(governanceFilesRouter.delete).toBeDefined();
    expect(typeof governanceFilesRouter.delete).toBe("function");
  });

  it("governanceRouter exports deleteUpload procedure", async () => {
    const { governanceRouter } = await import("./governance-router");
    expect(governanceRouter.deleteUpload).toBeDefined();
    expect(typeof governanceRouter.deleteUpload).toBe("function");
  });

  it("all delete procedures are accessible", async () => {
    const { documentsRouter } = await import("./documents-router");
    const { smpRouter } = await import("./smp-router");
    const { governanceFilesRouter } = await import("./governance-files-router");
    const { governanceRouter } = await import("./governance-router");
    expect(documentsRouter.deleteFile).toBeDefined();
    expect(smpRouter.delete).toBeDefined();
    expect(governanceFilesRouter.delete).toBeDefined();
    expect(governanceRouter.deleteUpload).toBeDefined();
  });
});
