import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ============================================================================
// BEHAVIORAL TESTS: tRPC destructive procedures require authentication
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

vi.mock("./auth/authenticate", () => ({
  authenticateRequest: vi.fn(),
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
import { authenticateRequest } from "./auth/authenticate";

const deletionTestRouter = createRouter({
  documents: documentsRouter,
  govFiles: governanceFilesRouter,
  governance: governanceRouter,
  smp: smpRouter,
});

const testUser = { id: 1, email: "test@example.com", role: "user" } as any;

describe("BEHAVIORAL TESTS: tRPC destructive procedures", () => {
  const createUnauthCtx = () => ({
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user: undefined,
  });

  const createAuthCtx = () => ({
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user: testUser,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storageRemove.mockResolvedValue({ data: {}, error: null });
    mocks.storageFrom.mockReturnValue({ remove: mocks.storageRemove });
    mocks.dbSelectResult = [];
    mocks.dbDeleteResult = [{ id: 1 }];
    mocks.dbUpdateResult = [{}];
    vi.mocked(authenticateRequest).mockReset();
  });

  describe("anonymous callers", () => {
    beforeEach(() => {
      vi.mocked(authenticateRequest).mockRejectedValue(new Error("No auth"));
    });

    it("documents.deleteFile rejects with UNAUTHORIZED", async () => {
      const ctx = createUnauthCtx();
      const caller = deletionTestRouter.createCaller(ctx);
      await expect(caller.documents.deleteFile({ id: 101 })).rejects.toThrow(
        new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" })
      );
    });

    it("documents.deleteFolder rejects with UNAUTHORIZED", async () => {
      const ctx = createUnauthCtx();
      const caller = deletionTestRouter.createCaller(ctx);
      await expect(caller.documents.deleteFolder({ id: 101 })).rejects.toThrow(TRPCError);
    });

    it("documents.renameFile rejects with UNAUTHORIZED", async () => {
      const ctx = createUnauthCtx();
      const caller = deletionTestRouter.createCaller(ctx);
      await expect(caller.documents.renameFile({ id: 101, title: "x.pdf" })).rejects.toThrow(TRPCError);
    });

    it("documents.renameFolder rejects with UNAUTHORIZED", async () => {
      const ctx = createUnauthCtx();
      const caller = deletionTestRouter.createCaller(ctx);
      await expect(caller.documents.renameFolder({ id: 101, name: "x" })).rejects.toThrow(TRPCError);
    });

    it("documents.moveFile rejects with UNAUTHORIZED", async () => {
      const ctx = createUnauthCtx();
      const caller = deletionTestRouter.createCaller(ctx);
      await expect(caller.documents.moveFile({ id: 101, folderId: 2 })).rejects.toThrow(TRPCError);
    });

    it("documents.moveFolder rejects with UNAUTHORIZED", async () => {
      const ctx = createUnauthCtx();
      const caller = deletionTestRouter.createCaller(ctx);
      await expect(caller.documents.moveFolder({ id: 101, parentId: 2 })).rejects.toThrow(TRPCError);
    });

    it("governance.deleteUpload rejects with UNAUTHORIZED", async () => {
      const ctx = createUnauthCtx();
      const caller = deletionTestRouter.createCaller(ctx);
      await expect(caller.governance.deleteUpload({ id: 103 })).rejects.toThrow(TRPCError);
    });

    it("smp.delete rejects with UNAUTHORIZED", async () => {
      const ctx = createUnauthCtx();
      const caller = deletionTestRouter.createCaller(ctx);
      await expect(caller.smp.delete({ id: 104 })).rejects.toThrow(TRPCError);
    });

    it("govFiles.delete rejects with UNAUTHORIZED", async () => {
      const ctx = createUnauthCtx();
      const caller = deletionTestRouter.createCaller(ctx);
      await expect(caller.govFiles.delete({ id: 102 })).rejects.toThrow(TRPCError);
    });
  });

  describe("authenticated callers", () => {
    beforeEach(() => {
      vi.mocked(authenticateRequest).mockResolvedValue(testUser);
    });

    describe("documents.deleteFile", () => {
      it("deletes legacy file without calling Supabase", async () => {
        mocks.dbSelectResult = [{ bucket: null, path: null }];
        mocks.dbDeleteResult = [{ id: 101 }];

        const ctx = createAuthCtx();
        const caller = deletionTestRouter.createCaller(ctx);
        const result = await caller.documents.deleteFile({ id: 101 });

        expect(result).toEqual({ success: true, deletedFileId: 101 });
        expect(mocks.storageFrom).not.toHaveBeenCalled();
      });

      it("deletes storage-backed file calling Supabase then database", async () => {
        mocks.dbSelectResult = [{ bucket: "odm-files", path: "documents/test-101.pdf" }];
        mocks.dbDeleteResult = [{ id: 101 }];

        const ctx = createAuthCtx();
        const caller = deletionTestRouter.createCaller(ctx);
        await caller.documents.deleteFile({ id: 101 });

        expect(mocks.storageFrom).toHaveBeenCalledWith("odm-files");
        expect(mocks.storageRemove).toHaveBeenCalledWith(["documents/test-101.pdf"]);
      });
    });

    describe("govFiles.delete", () => {
      it("deletes governance file", async () => {
        mocks.dbSelectResult = [{ bucket: null, path: null }];

        const ctx = createAuthCtx();
        const caller = deletionTestRouter.createCaller(ctx);
        const result = await caller.govFiles.delete({ id: 102 });

        expect(result).toEqual({ success: true });
      });
    });

    describe("governance.deleteUpload", () => {
      it("deletes upload and updates milestone", async () => {
        mocks.dbSelectResult = [{
          id: 103,
          facilitySlug: "test-facility",
          milestoneId: "milestone-103",
          bucket: null,
          path: null,
        }];

        const ctx = createAuthCtx();
        const caller = deletionTestRouter.createCaller(ctx);
        const result = await caller.governance.deleteUpload({ id: 103 });

        expect(result).toEqual({ success: true });
      });
    });

    describe("smp.delete", () => {
      it("deletes legacy SMP without calling Supabase", async () => {
        mocks.dbSelectResult = [{ bucket: null, path: null }];
        mocks.dbDeleteResult = [{ id: 104 }];

        const ctx = createAuthCtx();
        const caller = deletionTestRouter.createCaller(ctx);
        const result = await caller.smp.delete({ id: 104 });

        expect(result).toEqual({ deleted: true, id: 104 });
      });
    });
  });
});
