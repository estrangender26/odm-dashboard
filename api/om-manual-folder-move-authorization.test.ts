/**
 * O&M Manuals Library — folder MOVE authorization, validation and integrity.
 *
 * Correction under test:
 *   - moving/reorganizing a folder (including moving a folder into another
 *     folder) is a PUBLIC, no-login operation;
 *   - the move is non-destructive, so destructive operations and the file-level
 *     mutations (deleteFolder, deleteFile, moveFile, renameFile) must remain
 *     OWNER-only;
 *   - the move stays server-side validated: source must exist, destination must
 *     be an existing library folder (or root), no self-parent and no move into
 *     own descendant, so the hierarchy can never become cyclic.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./context";

const storageMocks = vi.hoisted(() => ({ from: vi.fn(), remove: vi.fn() }));

// ── Mocks (hoisted before the routers are imported) ──
vi.mock("./queries/connection", async () => {
  const helper = await import("./documents-router-fake-db");
  return {
    db: helper.fakeDb,
    getDb: () => helper.fakeDb,
    ensureDbReady: async () => undefined,
  };
});

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ op: "eq", column, value }),
  isNull: (column: unknown) => ({ op: "isNull", column }),
  inArray: (column: unknown, values: unknown[]) => ({ op: "inArray", column, values }),
  and: (...conditions: unknown[]) => ({ op: "and", conditions }),
  sql: Object.assign(
    (template: unknown, ...values: unknown[]) => ({ template, values }),
    { raw: (value: string) => ({ raw: value }) },
  ),
}));

vi.mock("./supabase-storage", () => ({
  getSupabaseStorageAdmin: () => ({ storage: { from: storageMocks.from } }),
  getSupabaseStorageConfig: () => ({ url: "https://test.supabase.co", bucket: "doc-files" }),
}));

// ── Import routers after mocks ──
import { createRouter } from "./middleware";
import { documentsRouter } from "./documents-router";
import {
  fakeDbState,
  resetFakeDbState,
  type FakeFileRow,
  type FakeFolderRow,
} from "./documents-router-fake-db";

const router = createRouter({ documents: documentsRouter });

const SEEDED_AT = new Date("2026-01-01T00:00:00.000Z");

function folder(partial: Partial<FakeFolderRow> & { id: number; name: string }): FakeFolderRow {
  return { parentId: null, sortOrder: 0, createdAt: SEEDED_AT, updatedAt: SEEDED_AT, ...partial };
}

function file(partial: Partial<FakeFileRow> & { id: number; folderId: number }): FakeFileRow {
  return {
    title: `doc-${partial.id}`,
    fileName: `doc-${partial.id}.pdf`,
    storageBucket: null,
    storagePath: null,
    updatedAt: SEEDED_AT,
    ...partial,
  };
}

/**
 * Seeded library used by every test:
 *   1 "O&M Manuals" (top level)
 *   └ 2 "Pump Station"            → files 11 (storage-backed), 12
 *     └ 4 "Pump Curves"           → file 13
 *   3 "Electrical" (top level)
 */
function seedLibrary(): void {
  fakeDbState.folders.push(
    folder({ id: 1, name: "O&M Manuals" }),
    folder({ id: 2, name: "Pump Station", parentId: 1 }),
    folder({ id: 3, name: "Electrical" }),
    folder({ id: 4, name: "Pump Curves", parentId: 2 }),
  );
  fakeDbState.files.push(
    file({ id: 11, folderId: 2, storageBucket: "doc-files", storagePath: "documents/pump.pdf" }),
    file({ id: 12, folderId: 2 }),
    file({ id: 13, folderId: 4 }),
  );
}

const anonymousContext = (): TrpcContext => ({
  req: new Request("http://localhost/api/trpc"),
  resHeaders: new Headers(),
});

const ownerContext = (): TrpcContext => ({
  req: new Request("http://localhost/api/trpc"),
  resHeaders: new Headers(),
  user: { id: 1, email: "owner@example.com", role: "admin" } as unknown as TrpcContext["user"],
});

const anonymousCaller = () => router.createCaller(anonymousContext());
const ownerCaller = () => router.createCaller(ownerContext());

const folderById = (id: number) => fakeDbState.folders.find((row) => row.id === id);

/** Stable description of the whole hierarchy used to prove nothing else changed. */
const treeSnapshot = () =>
  fakeDbState.folders
    .map((row) => `${row.id}|${row.parentId}|${row.name}`)
    .concat(fakeDbState.files.map((row) => `file:${row.id}|${row.folderId}|${row.fileName}`))
    .sort()
    .join("\n");

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDbState();
  seedLibrary();
  storageMocks.from.mockReturnValue({ remove: storageMocks.remove });
  storageMocks.remove.mockResolvedValue({ data: {}, error: null });
});

describe("A. no-login user moves a folder", () => {
  it("moves a nested folder to the top level without any authentication", async () => {
    const result = await anonymousCaller().documents.moveFolder({ id: 4, parentId: null });

    expect(result.success).toBe(true);
    expect(result.folder).toMatchObject({ id: 4, parentId: null });
    expect(folderById(4)?.parentId).toBeNull();
  });

  it("never surfaces an authentication error", async () => {
    const failure = await anonymousCaller()
      .documents.moveFolder({ id: 4, parentId: null })
      .then(() => null, (error: unknown) => error);

    expect(failure).toBeNull();
  });

  it("moves a top-level folder and keeps its id", async () => {
    const result = await anonymousCaller().documents.moveFolder({ id: 3, parentId: null });

    expect(result.folder).toMatchObject({ id: 3, parentId: null });
    expect(fakeDbState.folders).toHaveLength(4);
    expect(fakeDbState.folders.map((row) => row.id).sort()).toEqual([1, 2, 3, 4]);
  });
});

describe("B. no-login user moves a folder into another folder", () => {
  it("re-parents a top-level folder under another folder", async () => {
    const result = await anonymousCaller().documents.moveFolder({ id: 3, parentId: 1 });

    expect(result.folder).toMatchObject({ id: 3, parentId: 1 });
    expect(folderById(3)?.parentId).toBe(1);
    expect(folderById(3)?.name).toBe("Electrical");
  });

  it("re-parents a nested folder under a different branch", async () => {
    const result = await anonymousCaller().documents.moveFolder({ id: 4, parentId: 3 });

    expect(result.folder).toMatchObject({ id: 4, parentId: 3 });
    expect(folderById(2)?.parentId).toBe(1);
  });
});

describe("C. move preserves data integrity", () => {
  it("keeps children, files and identities attached when moving a folder with a subtree", async () => {
    const before = treeSnapshot();

    await anonymousCaller().documents.moveFolder({ id: 2, parentId: 3 });

    expect(folderById(2)).toMatchObject({ id: 2, name: "Pump Station", parentId: 3 });
    // subtree stays attached to the moved folder
    expect(folderById(4)?.parentId).toBe(2);
    expect(fakeDbState.files.filter((row) => row.folderId === 2).map((row) => row.id)).toEqual([11, 12]);
    expect(fakeDbState.files.filter((row) => row.folderId === 4).map((row) => row.id)).toEqual([13]);
    // counts, names and file attachments unchanged: only parentId differs
    expect(fakeDbState.folders).toHaveLength(4);
    expect(fakeDbState.files).toHaveLength(3);
    expect(treeSnapshot()).not.toBe(before);
    expect(treeSnapshot().replace("2|3|Pump Station", "2|1|Pump Station")).toBe(before);
  });

  it("touches exactly one row, so no other resource can be altered by the request", async () => {
    await anonymousCaller().documents.moveFolder({ id: 4, parentId: 3 });

    expect(folderById(1)).toMatchObject({ parentId: null, name: "O&M Manuals" });
    expect(folderById(2)).toMatchObject({ parentId: 1, name: "Pump Station" });
    expect(folderById(3)).toMatchObject({ parentId: null, name: "Electrical" });
    expect(fakeDbState.files.map((row) => `${row.id}:${row.folderId}`)).toEqual(["11:2", "12:2", "13:4"]);
    expect(storageMocks.remove).not.toHaveBeenCalled();
  });
});

describe("D. invalid and cyclic moves are rejected server-side", () => {
  it("rejects a nonexistent source folder", async () => {
    await expect(anonymousCaller().documents.moveFolder({ id: 9999, parentId: 1 })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Folder not found",
    });
  });

  it("rejects a nonexistent destination folder", async () => {
    await expect(anonymousCaller().documents.moveFolder({ id: 2, parentId: 9999 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Parent folder not found",
    });
    expect(folderById(2)?.parentId).toBe(1);
  });

  it("rejects making a folder its own parent", async () => {
    await expect(anonymousCaller().documents.moveFolder({ id: 2, parentId: 2 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Cannot make a folder its own parent",
    });
    expect(folderById(2)?.parentId).toBe(1);
  });

  it("rejects moving a folder into its own direct child", async () => {
    await expect(anonymousCaller().documents.moveFolder({ id: 2, parentId: 4 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Cannot move a folder into its own descendant",
    });
    expect(folderById(2)?.parentId).toBe(1);
    expect(folderById(4)?.parentId).toBe(2);
  });

  it("rejects moving a folder into a deeper descendant (no cycles)", async () => {
    await expect(anonymousCaller().documents.moveFolder({ id: 1, parentId: 4 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Cannot move a folder into its own descendant",
    });
    expect(folderById(1)?.parentId).toBeNull();
  });

  it("rejects malformed folder identifiers before any mutation", async () => {
    const before = treeSnapshot();
    const caller = anonymousCaller();

    for (const id of [0, -5, 1.5, Number.NaN]) {
      await expect(caller.documents.moveFolder({ id, parentId: 1 })).rejects.toThrow(TRPCError);
    }
    for (const parentId of [0, -1, 1.5, Number.NaN]) {
      await expect(caller.documents.moveFolder({ id: 3, parentId })).rejects.toThrow(TRPCError);
    }

    expect(treeSnapshot()).toBe(before);
  });

  it("leaves the hierarchy unchanged after every rejected move", async () => {
    const before = treeSnapshot();
    const caller = anonymousCaller();

    await expect(caller.documents.moveFolder({ id: 9999, parentId: 1 })).rejects.toThrow(TRPCError);
    await expect(caller.documents.moveFolder({ id: 2, parentId: 9999 })).rejects.toThrow(TRPCError);
    await expect(caller.documents.moveFolder({ id: 2, parentId: 2 })).rejects.toThrow(TRPCError);
    await expect(caller.documents.moveFolder({ id: 2, parentId: 4 })).rejects.toThrow(TRPCError);

    expect(treeSnapshot()).toBe(before);
  });
});

describe("E. library boundary is preserved", () => {
  it("refuses to re-parent a folder onto a non-folder id from another entity set", async () => {
    // 11 is a doc_files id, not a doc_folders id: the destination must be a
    // folder inside this library, so a foreign/absent parent is rejected rather
    // than silently attaching the folder to another module's record.
    await expect(anonymousCaller().documents.moveFolder({ id: 3, parentId: 11 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Parent folder not found",
    });

    expect(folderById(3)?.parentId).toBeNull();
    expect(fakeDbState.folders.map((row) => row.id).sort()).toEqual([1, 2, 3, 4]);
  });

  it("cannot move a folder under itself through a foreign id", async () => {
    const before = treeSnapshot();

    await expect(anonymousCaller().documents.moveFolder({ id: 1, parentId: 42 })).rejects.toThrow(TRPCError);

    expect(treeSnapshot()).toBe(before);
  });
});

describe("F. destructive and file-level operations stay protected without login", () => {
  it("rejects anonymous folder and file deletion", async () => {
    await expect(anonymousCaller().documents.deleteFolder({ id: 2 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(anonymousCaller().documents.deleteFile({ id: 11 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(fakeDbState.folders).toHaveLength(4);
    expect(fakeDbState.files).toHaveLength(3);
    expect(storageMocks.remove).not.toHaveBeenCalled();
  });

  it("rejects the file-level mutations and file reads without login", async () => {
    const caller = anonymousCaller();

    await expect(caller.documents.moveFile({ id: 11, folderId: 3 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.documents.renameFile({ id: 11, title: "renamed.pdf" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.documents.getFile({ id: 11 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("keeps the public read surface working without login", async () => {
    const caller = anonymousCaller();

    await expect(caller.documents.getFolderTree()).resolves.toMatchObject({
      folders: expect.any(Array),
    });
    await expect(caller.documents.renameFolder({ id: 3, name: "Electrical Systems" })).resolves.toMatchObject({
      success: true,
    });
  });
});

describe("G. authenticated behaviour is not regressed", () => {
  it("owner can still move a folder into another folder", async () => {
    const result = await ownerCaller().documents.moveFolder({ id: 4, parentId: 3 });

    expect(result.folder).toMatchObject({ id: 4, parentId: 3 });
  });

  it("owner is bound by the same hierarchy validation", async () => {
    await expect(ownerCaller().documents.moveFolder({ id: 2, parentId: 4 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(ownerCaller().documents.moveFolder({ id: 2, parentId: 9999 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("owner delete capability is unchanged", async () => {
    await expect(ownerCaller().documents.deleteFile({ id: 11 })).resolves.toEqual({
      success: true,
      deletedFileId: 11,
    });
    expect(fakeDbState.files.map((row) => row.id)).toEqual([12, 13]);
  });
});

describe("H. permission boundary stays narrow (source level)", () => {
  const source = readFileSync(resolve(process.cwd(), "api/documents-router.ts"), "utf8");
  const middlewareSource = readFileSync(resolve(process.cwd(), "api/middleware.ts"), "utf8");

  it("declares moveFolder as a public procedure", () => {
    expect(source).toContain("moveFolder: publicQuery");
    expect(source).not.toContain("moveFolder: authedQuery");
  });

  it("leaves the historically public organization procedures public", () => {
    // The correction must not disturb the already-public library surface.
    expect(source).toContain("createFolder: publicQuery");
    expect(source).toContain("renameFolder: publicQuery");
    expect(source).toContain("uploadFile: publicQuery");
    expect(source).toContain("getFolderTree: publicQuery");
    expect(source).toContain("getTree: publicQuery");
  });

  it("keeps destructive and file-level procedures authenticated", () => {
    for (const procedure of ["deleteFolder:", "deleteFile:", "renameFile:", "moveFile:", "getFile:"]) {
      const section = source.slice(source.indexOf(procedure), source.indexOf(procedure) + 200);
      expect(section, `${procedure} must stay authedQuery`).toContain("authedQuery");
    }
  });

  it("does not weaken the shared authentication middleware", () => {
    expect(middlewareSource).toContain("requireAuth");
    expect(middlewareSource).toContain("export const authedQuery = t.procedure.use(requireAuth)");
    expect(middlewareSource).toContain("export const adminQuery = authedQuery.use(requireRole(\"admin\"))");
  });

  it("did not add a blanket O&M mutation bypass", () => {
    expect(source).not.toMatch(/if\s*\(\s*.*O&M.*\)\s*(return\s+)?next\(/i);
    expect(source).not.toContain("requireAuth: false");
    expect(source).not.toContain("skipAuth");
  });
});
