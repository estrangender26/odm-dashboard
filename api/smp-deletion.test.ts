import { describe, it, expect, vi, beforeEach } from "vitest";
import { smpDocuments, smpDocumentRevisions, smpDeletionRecords } from "@db/schema";

/**
 * Staged SMP deletion (prepare + confirm):
 *   - storage objects are removed first, the DB row after, with progress
 *     recorded in smp_deletion_records;
 *   - storage failure leaves the DB untouched and records progress;
 *   - DB failure after storage work is explicit and recorded;
 *   - confirmation is idempotent and retryable (no partial silent success,
 *     no claim of cross-system atomicity).
 */

const mocks = vi.hoisted(() => ({
  storageRemove: vi.fn(),
  storageFrom: vi.fn(),
  selectByTable: new Map<any, any[]>(),
  insertValues: [] as any[],
  insertReturning: [{ id: 1 }] as any[],
  updateSets: [] as any[],
  deleteTables: [] as any[],
  deleteReturning: [] as any[],
}));

vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
vi.stubEnv("APP_ID", "test-app");
vi.stubEnv("APP_SECRET", "test-secret-for-unit-tests-only");
vi.stubEnv("KIMI_AUTH_URL", "https://auth.example.test");
vi.stubEnv("KIMI_OPEN_URL", "https://open.example.test");

vi.mock("./queries/connection", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((table: any) => ({
        where: vi.fn(() => {
          const result = () => mocks.selectByTable.get(table) ?? [];
          const chain: any = {
            limit: vi.fn(async () => result()),
            then: (resolve: (value: any) => void) => resolve(result()),
          };
          return chain;
        }),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: any) => {
        mocks.insertValues.push(values);
        return { returning: vi.fn(async () => mocks.insertReturning) };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: any) => {
        mocks.updateSets.push(values);
        return { where: vi.fn(async () => []) };
      }),
    })),
    delete: vi.fn((table: any) => {
      mocks.deleteTables.push(table);
      return {
        where: vi.fn(() => ({
          returning: vi.fn(async () => mocks.deleteReturning),
        })),
      };
    }),
    execute: vi.fn(async () => []),
  },
}));

vi.mock("./supabase-storage", () => ({
  getSupabaseStorageAdmin: vi.fn(() => ({
    storage: { from: mocks.storageFrom },
  })),
  getSupabaseStorageConfig: vi.fn(() => ({
    url: "https://project-ref.supabase.co",
    directStorageUrl: "https://project-ref.storage.supabase.co",
    serviceRoleKey: "test-key",
  })),
}));

vi.mock("./lib/env", () => ({
  env: {
    supabaseUrl: "https://project-ref.supabase.co",
    supabaseServiceRoleKey: "test-key",
    appId: "test-app",
    appSecret: "test-secret-for-unit-tests-only",
  },
}));

vi.mock("./auth/authenticate", () => ({
  authenticateRequest: vi.fn(() => Promise.resolve({ id: 7, name: "Operator", role: "admin" })),
}));

import { smpRouter } from "./smp-router";

function caller() {
  return smpRouter.createCaller(testCtx);
}

const testCtx = {
  req: new Request("http://localhost/api/trpc"),
  resHeaders: new Headers(),
  user: { id: 7, name: "Operator", role: "admin" as const },
} as any;

function pendingRecord(overrides: any = {}) {
  return {
    id: 1,
    documentId: 104,
    tokenHash: "hash",
    status: "pending",
    objects: [
      { bucket: "smp-library", path: "v1/document-104/rev0.pdf" },
      { bucket: "smp-library", path: "v1/document-104/rev1.pdf" },
    ],
    removedObjects: [],
    failureReason: null,
    ...overrides,
  };
}

describe("SMP staged deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectByTable.clear();
    mocks.insertValues = [];
    mocks.updateSets = [];
    mocks.deleteTables = [];
    mocks.insertReturning = [{ id: 1 }];
    mocks.deleteReturning = [{ id: 104 }];
    mocks.storageFrom.mockReturnValue({ remove: mocks.storageRemove });
    mocks.storageRemove.mockResolvedValue({ data: [], error: null });
  });

  it("deletePrepare records the ledger and returns a confirmation token", async () => {
    mocks.selectByTable.set(smpDocuments, [{ id: 104, bucket: "smp-library", path: "v1/document-104/current.pdf" }]);
    mocks.selectByTable.set(smpDocumentRevisions, [
      { bucket: "smp-library", path: "v1/document-104/rev0.pdf" },
    ]);

    const result = await caller().deletePrepare({ id: 104 });

    expect(result).toMatchObject({ recordId: 1, objectCount: 2 });
    expect(typeof result.deletionToken).toBe("string");
    expect(result.deletionToken.length).toBeGreaterThan(16);
    const ledger = mocks.insertValues[0];
    expect(ledger).toMatchObject({
      documentId: 104,
      status: "pending",
      createdBy: "Operator",
    });
    expect(ledger.objects).toHaveLength(2);
    expect(ledger.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("deleteConfirm removes objects then deletes the DB row and completes the ledger", async () => {
    mocks.selectByTable.set(smpDeletionRecords, [pendingRecord()]);
    mocks.deleteReturning = [{ id: 104 }];

    const result = await caller().deleteConfirm({ recordId: 1, deletionToken: "any" });

    expect(result).toEqual({ status: "completed", documentId: 104 });
    expect(mocks.storageRemove).toHaveBeenCalledTimes(2);
    expect(mocks.deleteTables).toEqual([smpDocuments]);
    const completion = mocks.updateSets[mocks.updateSets.length - 1];
    expect(completion).toMatchObject({ status: "completed", removedObjects: [
      "v1/document-104/rev0.pdf",
      "v1/document-104/rev1.pdf",
    ] });
  });

  it("reports storage deletion failure, records progress, and leaves the DB row untouched", async () => {
    mocks.selectByTable.set(smpDeletionRecords, [pendingRecord()]);
    mocks.storageRemove
      .mockResolvedValueOnce({ data: [], error: null }) // rev0 removed
      .mockResolvedValueOnce({ data: [], error: new Error("permission denied") }); // rev1 fails

    await expect(
      caller().deleteConfirm({ recordId: 1, deletionToken: "any" }),
    ).rejects.toThrow(/permission denied/);

    // No database delete happened — no partial silent success.
    expect(mocks.deleteTables).toHaveLength(0);
    const failedState = mocks.updateSets[mocks.updateSets.length - 1];
    expect(failedState).toMatchObject({
      status: "storage_failed",
      removedObjects: ["v1/document-104/rev0.pdf"],
    });
    expect(failedState.failureReason).toContain("v1/document-104/rev1.pdf");
  });

  it("reports a DB failure after storage objects were removed and records db_failed", async () => {
    mocks.selectByTable.set(smpDeletionRecords, [pendingRecord()]);
    // Storage objects are removed, then the DB delete returns no row —
    // simulating a database failure after external storage work.
    mocks.deleteReturning = [];
    mocks.storageRemove.mockResolvedValue({ data: [], error: null });

    await expect(
      caller().deleteConfirm({ recordId: 1, deletionToken: "any" }),
    ).rejects.toThrow(/was not found during deletion/);

    const failedState = mocks.updateSets[mocks.updateSets.length - 1];
    expect(failedState.status).toBe("db_failed");
    expect(failedState.failureReason).toContain("Storage objects removed");
    // The storage objects WERE removed in this attempt — recorded for
    // reconciliation on retry.
    expect(failedState.removedObjects).toHaveLength(2);
  });

  it("is idempotent: confirming a completed deletion is a success with no side effects", async () => {
    mocks.selectByTable.set(smpDeletionRecords, [pendingRecord({ status: "completed" })]);

    const result = await caller().deleteConfirm({ recordId: 1, deletionToken: "any" });

    expect(result).toEqual({ status: "completed", documentId: 104 });
    expect(mocks.storageRemove).not.toHaveBeenCalled();
    expect(mocks.deleteTables).toHaveLength(0);
  });

  it("retries a storage_failed deletion removing only the remaining objects", async () => {
    mocks.selectByTable.set(smpDeletionRecords, [pendingRecord({
      status: "storage_failed",
      removedObjects: ["v1/document-104/rev0.pdf"],
    })]);
    mocks.deleteReturning = [{ id: 104 }];

    const result = await caller().deleteConfirm({ recordId: 1, deletionToken: "any" });

    expect(result).toEqual({ status: "completed", documentId: 104 });
    // Only the object that had not been removed yet is touched.
    expect(mocks.storageRemove).toHaveBeenCalledTimes(1);
    expect(mocks.storageRemove).toHaveBeenCalledWith(["v1/document-104/rev1.pdf"]);
  });
});
