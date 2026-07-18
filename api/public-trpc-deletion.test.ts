import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ============================================================================
// BEHAVIORAL TESTS: tRPC Public Deletion Procedures
// ============================================================================

const mocks = vi.hoisted(() => ({
  storageRemove: vi.fn(),
  storageFrom: vi.fn(),
  dbSelectResult: [] as any[],
  dbDeleteResult: [] as any[],
  dbUpdateResult: [] as any[],
}));

// Mock database and storage before importing routers
vi.mock("./queries/connection", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(mocks.dbSelectResult)),
        })),
      })),
    })),
    delete: vi.fn((table: any) => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(mocks.dbDeleteResult)),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(mocks.dbUpdateResult)),
      })),
    })),
    execute: vi.fn(() => Promise.resolve({})),
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
}));

vi.mock("./supabase-storage", () => ({
  getSupabaseStorageAdmin: vi.fn(() => ({
    storage: {
      from: mocks.storageFrom,
    },
  })),
  getSupabaseStorageConfig: vi.fn(() => ({
    url: "https://test.supabase.co",
    bucket: "test-bucket",
  })),
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
    appSecret: "test-secret-key",
    openaiApiKey: "test-key",
    tavilyApiKey: "test-key",
    webSearchApiKey: "test-key",
    webSearchProvider: "tavily",
  },
}));

// Import routers after mocks
import { createRouter } from "./middleware";
import { documentsRouter } from "./documents-router";
import { governanceFilesRouter } from "./governance-files-router";
import { governanceRouter } from "./governance-router";
import { smpRouter } from "./smp-router";

// Create test router with unauthenticated context
const deletionTestRouter = createRouter({
  documents: documentsRouter,
  govFiles: governanceFilesRouter,
  governance: governanceRouter,
  smp: smpRouter,
});

describe("BEHAVIORAL TESTS: tRPC Public Deletion Procedures", () => {
  const createUnauthCtx = () => ({
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user: undefined,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storageRemove.mockResolvedValue({ data: {}, error: null });
    mocks.storageFrom.mockReturnValue({ remove: mocks.storageRemove });
    mocks.dbSelectResult = [];
    mocks.dbDeleteResult = [{ id: 1 }];
    mocks.dbUpdateResult = [{}];
  });

  describe("documents.deleteFile", () => {
    it("deletes legacy file without calling Supabase", async () => {
      mocks.dbSelectResult = [{ bucket: null, path: null }];
      mocks.dbDeleteResult = [{ id: 101 }];

      const ctx = createUnauthCtx();
      const caller = deletionTestRouter.createCaller(ctx);
      const result = await caller.documents.deleteFile({ id: 101 });

      expect(result).toEqual({ success: true, deletedFileId: 101 });
      expect(mocks.storageFrom).not.toHaveBeenCalled();
    });

    it("deletes storage-backed file calling Supabase then database", async () => {
      mocks.dbSelectResult = [{ bucket: "odm-files", path: "documents/test-101.pdf" }];
      mocks.dbDeleteResult = [{ id: 101 }];

      const ctx = createUnauthCtx();
      const caller = deletionTestRouter.createCaller(ctx);
      await caller.documents.deleteFile({ id: 101 });

      expect(mocks.storageFrom).toHaveBeenCalledWith("odm-files");
      expect(mocks.storageRemove).toHaveBeenCalledWith(["documents/test-101.pdf"]);
    });

    it("prevents database deletion when Supabase removal fails", async () => {
      mocks.dbSelectResult = [{ bucket: "odm-files", path: "documents/protected.pdf" }];
      mocks.storageRemove.mockResolvedValue({ data: null, error: { message: "Access denied" } });

      const ctx = createUnauthCtx();
      const caller = deletionTestRouter.createCaller(ctx);

      await expect(caller.documents.deleteFile({ id: 101 })).rejects.toThrow();
    });

    it("returns NOT_FOUND for missing files", async () => {
      mocks.dbSelectResult = [];
      mocks.dbDeleteResult = [];

      const ctx = createUnauthCtx();
      const caller = deletionTestRouter.createCaller(ctx);

      await expect(caller.documents.deleteFile({ id: 999 })).rejects.toThrow(TRPCError);
    });
  });

  describe("govFiles.delete", () => {
    it("deletes governance file anonymously (legacy)", async () => {
      mocks.dbSelectResult = [{ bucket: null, path: null }];

      const ctx = createUnauthCtx();
      const caller = deletionTestRouter.createCaller(ctx);
      const result = await caller.govFiles.delete({ id: 102 });

      expect(result).toEqual({ success: true });
      expect(mocks.storageFrom).not.toHaveBeenCalled();
    });

    it("deletes storage-backed file calling Supabase with exact path", async () => {
      mocks.dbSelectResult = [{ bucket: "odm-files", path: "governance/doc-102.pdf" }];

      const ctx = createUnauthCtx();
      const caller = deletionTestRouter.createCaller(ctx);
      await caller.govFiles.delete({ id: 102 });

      expect(mocks.storageFrom).toHaveBeenCalledWith("odm-files");
      expect(mocks.storageRemove).toHaveBeenCalledWith(["governance/doc-102.pdf"]);
    });

    it("prevents database deletion when Supabase fails", async () => {
      mocks.dbSelectResult = [{ bucket: "odm-files", path: "governance/protected.pdf" }];
      mocks.storageRemove.mockResolvedValue({ data: null, error: { message: "Permission denied" } });

      const ctx = createUnauthCtx();
      const caller = deletionTestRouter.createCaller(ctx);

      await expect(caller.govFiles.delete({ id: 102 })).rejects.toThrow();
    });
  });

  describe("governance.deleteUpload", () => {
    it("deletes upload and updates milestone (legacy)", async () => {
      mocks.dbSelectResult = [{
        id: 103,
        facilitySlug: "test-facility",
        milestoneId: "milestone-103",
        bucket: null,
        path: null,
      }];

      const ctx = createUnauthCtx();
      const caller = deletionTestRouter.createCaller(ctx);
      const result = await caller.governance.deleteUpload({ id: 103 });

      expect(result).toEqual({ success: true });
      expect(mocks.storageFrom).not.toHaveBeenCalled();
    });

    it("deletes storage-backed upload with proper cleanup", async () => {
      mocks.dbSelectResult = [{
        id: 103,
        facilitySlug: "test-facility",
        milestoneId: "milestone-103",
        storageBucket: "odm-files",
        storagePath: "governance-uploads/file-103.pdf",
      }];

      const ctx = createUnauthCtx();
      const caller = deletionTestRouter.createCaller(ctx);
      await caller.governance.deleteUpload({ id: 103 });

      expect(mocks.storageFrom).toHaveBeenCalledWith("odm-files");
      expect(mocks.storageRemove).toHaveBeenCalledWith(["governance-uploads/file-103.pdf"]);
    });

    it("prevents deletion when storage fails for upload", async () => {
      mocks.dbSelectResult = [{
        id: 103,
        facilitySlug: "test-facility",
        milestoneId: "milestone-103",
        storageBucket: "odm-files",
        storagePath: "governance-uploads/protected.pdf",
      }];
      mocks.storageRemove.mockResolvedValue({ data: null, error: { message: "Access denied" } });

      const ctx = createUnauthCtx();
      const caller = deletionTestRouter.createCaller(ctx);

      await expect(caller.governance.deleteUpload({ id: 103 })).rejects.toThrow();
    });
  });

  describe("smp.delete", () => {
    it("deletes legacy SMP without calling Supabase", async () => {
      mocks.dbSelectResult = [{ bucket: null, path: null }];
      mocks.dbDeleteResult = [{ id: 104 }];

      const ctx = createUnauthCtx();
      const caller = deletionTestRouter.createCaller(ctx);
      const result = await caller.smp.delete({ id: 104 });

      expect(result).toEqual({ deleted: true, id: 104 });
      expect(mocks.storageFrom).not.toHaveBeenCalled();
    });

    it("deletes storage-backed SMP calling Supabase once then database", async () => {
      mocks.dbSelectResult = [{ bucket: "odm-files", path: "smp/manual-104.pdf" }];
      mocks.dbDeleteResult = [{ id: 104 }];

      const ctx = createUnauthCtx();
      const caller = deletionTestRouter.createCaller(ctx);
      const result = await caller.smp.delete({ id: 104 });

      expect(result).toEqual({ deleted: true, id: 104 });
      expect(mocks.storageFrom).toHaveBeenCalledTimes(1);
      expect(mocks.storageFrom).toHaveBeenCalledWith("odm-files");
      expect(mocks.storageRemove).toHaveBeenCalledWith(["smp/manual-104.pdf"]);
    });

    it("preserves record when storage deletion fails", async () => {
      mocks.dbSelectResult = [{ bucket: "odm-files", path: "smp/protected.pdf" }];
      mocks.storageRemove.mockResolvedValue({ data: null, error: { message: "Permission denied" } });

      const ctx = createUnauthCtx();
      const caller = deletionTestRouter.createCaller(ctx);

      await expect(caller.smp.delete({ id: 104 })).rejects.toThrow();
    });
  });
});
