import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Projects without PPP — SAFE FILE DELETION security
//  - Deletion requires a governed delete capability bound to exactly one file
//    + project (issued to the uploader at finalize/attach time), OR the
//    OWNER/admin path. File/project ID knowledge alone never authorizes it.
//  - Superseded (historical) evidence is protected from public deletion.
// ============================================================================

const mocks = vi.hoisted(() => ({
  fileRows: [] as any[],
  remainingRows: [] as any[],
  deleteCalls: [] as any[],
  removeResult: { data: [], error: null } as any,
  storageFrom: vi.fn(),
}));

vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
vi.stubEnv("APP_ID", "test-app");
vi.stubEnv("APP_SECRET", "test-secret-for-unit-tests-only");
vi.stubEnv("KIMI_AUTH_URL", "https://auth.example.test");
vi.stubEnv("KIMI_OPEN_URL", "https://open.example.test");

let selectCount = 0;
vi.mock("./queries/connection", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          selectCount += 1;
          const isFirst = selectCount === 1;
          return {
            limit: vi.fn(async () => (isFirst ? mocks.fileRows : mocks.remainingRows)),
            then: (resolve: any) => resolve(isFirst ? mocks.fileRows : mocks.remainingRows),
          };
        }),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async (cond: any) => {
        mocks.deleteCalls.push(cond);
      }),
    })),
  },
}));

vi.mock("./supabase-storage", () => ({
  getSupabaseStorageAdmin: vi.fn(() => ({
    storage: { from: mocks.storageFrom },
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

import { projectsWithoutPPPRouter } from "./projects-without-ppp-router";
import {
  generateDeleteCapabilityClaims,
  signDeleteCapability,
  verifyDeleteCapability,
  PWP_DELETE_CAPABILITY_OP,
  type DeleteCapabilityClaims,
} from "./upload-capability";

function makeCaller(user?: { id: number; name: string; role: string }) {
  return projectsWithoutPPPRouter.createCaller({
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user,
  } as never);
}

const anonymous = makeCaller(undefined);
const normalUser = makeCaller({ id: 1, name: "User", role: "user" });
const admin = makeCaller({ id: 1, name: "Admin", role: "admin" });

function cap(fileId: number, projectId: number, overrides: any = {}) {
  const claims = { ...generateDeleteCapabilityClaims(fileId, projectId), ...overrides };
  return signDeleteCapability(claims);
}

function currentFile(overrides: any = {}) {
  return {
    id: 1,
    projectId: 1,
    supersededAt: null,
    storageBucket: "projects-without-ppp",
    storagePath: "v1/project-1/abc",
    fileName: "masterdata.xlsx",
    ...overrides,
  };
}

describe("delete capability verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCount = 0;
    mocks.fileRows = [];
    mocks.remainingRows = [];
    mocks.deleteCalls = [];
    mocks.removeResult = { data: [], error: null };
    mocks.storageFrom.mockReset();
    mocks.storageFrom.mockReturnValue({ remove: vi.fn(async () => mocks.removeResult) });
  });

  it("accepts a valid capability bound to the exact file + project", () => {
    const token = cap(7, 3);
    const claims = verifyDeleteCapability(token, { fileId: 7, projectId: 3 });
    expect(claims?.fileId).toBe(7);
    expect(claims?.projectId).toBe(3);
    expect(claims?.op).toBe(PWP_DELETE_CAPABILITY_OP);
  });

  it("rejects a tampered capability", () => {
    const token = cap(7, 3);
    expect(verifyDeleteCapability(token.slice(0, -5) + "xxxxx", { fileId: 7, projectId: 3 })).toBeNull();
  });

  it("rejects an expired capability", () => {
    const token = cap(7, 3, { exp: Math.floor(Date.now() / 1000) - 10 });
    expect(verifyDeleteCapability(token, { fileId: 7, projectId: 3 })).toBeNull();
  });

  it("rejects a capability for a different file", () => {
    const token = cap(7, 3);
    expect(verifyDeleteCapability(token, { fileId: 8, projectId: 3 })).toBeNull();
  });

  it("rejects a capability for a different project", () => {
    const token = cap(7, 3);
    expect(verifyDeleteCapability(token, { fileId: 7, projectId: 4 })).toBeNull();
  });

  it("rejects a capability with the wrong operation", () => {
    const claims = { ...generateDeleteCapabilityClaims(7, 3), op: "pwp-upload" } as unknown as DeleteCapabilityClaims;
    expect(verifyDeleteCapability(signDeleteCapability(claims), { fileId: 7, projectId: 3 })).toBeNull();
  });
});

describe("deleteMasterdataFile (public, capability-gated)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCount = 0;
    mocks.fileRows = [];
    mocks.remainingRows = [];
    mocks.deleteCalls = [];
    mocks.removeResult = { data: [], error: null };
    mocks.storageFrom.mockReset();
    mocks.storageFrom.mockReturnValue({ remove: vi.fn(async () => mocks.removeResult) });
  });

  it("file ID alone cannot authorize deletion (no capability)", async () => {
    mocks.fileRows = [currentFile()];
    await expect(
      anonymous.deleteMasterdataFile({ fileId: 1, deleteCapability: "garbage" }),
    ).rejects.toThrow(/Delete authorization required/i);
    expect(mocks.deleteCalls.length).toBe(0);
  });

  it("a capability for File A cannot delete File B", async () => {
    mocks.fileRows = [currentFile({ id: 1 })];
    // Capability minted for file 2, used against file 1
    await expect(
      anonymous.deleteMasterdataFile({ fileId: 1, deleteCapability: cap(2, 1) }),
    ).rejects.toThrow(/Delete authorization required/i);
    expect(mocks.deleteCalls.length).toBe(0);
  });

  it("a capability cannot switch projects", async () => {
    mocks.fileRows = [currentFile({ id: 1, projectId: 1 })];
    // Capability bound to project 2, used against a file of project 1
    await expect(
      anonymous.deleteMasterdataFile({ fileId: 1, deleteCapability: cap(1, 2) }),
    ).rejects.toThrow(/Delete authorization required/i);
    expect(mocks.deleteCalls.length).toBe(0);
  });

  it("an expired capability is rejected", async () => {
    mocks.fileRows = [currentFile({ id: 1 })];
    const expired = cap(1, 1, { exp: Math.floor(Date.now() / 1000) - 10 });
    await expect(
      anonymous.deleteMasterdataFile({ fileId: 1, deleteCapability: expired }),
    ).rejects.toThrow(/Delete authorization required/i);
    expect(mocks.deleteCalls.length).toBe(0);
  });

  it("superseded (historical) evidence is protected from public deletion", async () => {
    mocks.fileRows = [currentFile({ id: 1, supersededAt: new Date("2026-08-01T00:00:00Z") })];
    await expect(
      anonymous.deleteMasterdataFile({ fileId: 1, deleteCapability: cap(1, 1) }),
    ).rejects.toThrow(/Superseded files cannot be deleted publicly/i);
    expect(mocks.deleteCalls.length).toBe(0);
  });

  it("a valid capability deletes the storage object and the record, deriving status", async () => {
    mocks.fileRows = [currentFile({ id: 1 })];
    mocks.remainingRows = [{ id: 9 }]; // one other current file remains

    const result = await anonymous.deleteMasterdataFile({
      fileId: 1,
      deleteCapability: cap(1, 1),
    });
    expect(result).toEqual({ fileId: 1, projectId: 1, status: "submitted" });
    // Storage object removed (no orphaned bucket object) then row deleted.
    const remove = mocks.storageFrom.mock.results[0].value.remove;
    expect(remove).toHaveBeenCalledWith(["v1/project-1/abc"]);
    expect(mocks.deleteCalls.length).toBe(1);
  });

  it("a valid capability on the last current file derives Not Submitted", async () => {
    mocks.fileRows = [currentFile({ id: 1 })];
    mocks.remainingRows = [];

    const result = await anonymous.deleteMasterdataFile({
      fileId: 1,
      deleteCapability: cap(1, 1),
    });
    expect(result.status).toBe("not_submitted");
  });

  it("an unrelated logged-in user cannot delete without a capability", async () => {
    mocks.fileRows = [currentFile({ id: 1 })];
    await expect(
      normalUser.deleteMasterdataFile({ fileId: 1, deleteCapability: "nope" }),
    ).rejects.toThrow(/Delete authorization required/i);
    expect(mocks.deleteCalls.length).toBe(0);
  });
});

describe("adminDeleteMasterdataFile (OWNER/admin path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCount = 0;
    mocks.fileRows = [];
    mocks.remainingRows = [];
    mocks.deleteCalls = [];
    mocks.removeResult = { data: [], error: null };
    mocks.storageFrom.mockReset();
    mocks.storageFrom.mockReturnValue({ remove: vi.fn(async () => mocks.removeResult) });
  });

  it("requires the admin role", async () => {
    mocks.fileRows = [currentFile({ id: 1 })];
    await expect(anonymous.adminDeleteMasterdataFile({ fileId: 1 })).rejects.toThrow(
      /Authentication required/i,
    );
    await expect(normalUser.adminDeleteMasterdataFile({ fileId: 1 })).rejects.toThrow(
      /Insufficient permissions/i,
    );
    expect(mocks.deleteCalls.length).toBe(0);
  });

  it("admin can delete a current file without any capability", async () => {
    mocks.fileRows = [currentFile({ id: 1 })];
    mocks.remainingRows = [];
    const result = await admin.adminDeleteMasterdataFile({ fileId: 1 });
    expect(result.status).toBe("not_submitted");
    expect(mocks.deleteCalls.length).toBe(1);
  });

  it("admin can delete superseded historical evidence", async () => {
    mocks.fileRows = [currentFile({ id: 1, supersededAt: new Date("2026-08-01T00:00:00Z") })];
    mocks.remainingRows = [];
    const result = await admin.adminDeleteMasterdataFile({ fileId: 1 });
    expect(result.status).toBe("not_submitted");
    expect(mocks.deleteCalls.length).toBe(1);
  });

  it("storage removal failure prevents the record deletion", async () => {
    mocks.fileRows = [currentFile({ id: 1 })];
    mocks.removeResult = { data: null, error: { message: "boom" } };
    await expect(admin.adminDeleteMasterdataFile({ fileId: 1 })).rejects.toThrow(
      /Storage deletion failed/i,
    );
    expect(mocks.deleteCalls.length).toBe(0);
  });
});
