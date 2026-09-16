/**
 * O&M Manuals Library — FILE MOVE authorization, integrity and boundary.
 *
 * Requirement under test:
 *   - moving a document between folders is non-destructive reorganization and
 *     must work WITHOUT LOGIN, like folder rename/move;
 *   - the file stays the same file: id, title, filename and every other field
 *     except the folder association (and bookkeeping `updatedAt`) are untouched;
 *   - no storage object is copied, moved or deleted;
 *   - deletion remains OWNER-only.
 *
 * Design note established from the schema: `doc_files.folder_id` is NOT NULL, so
 * a file always lives inside a folder and "root" is not a valid destination for
 * files (unlike folders, where `parent_id` is nullable).
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

const fileById = (id: number) => fakeDbState.files.find((row) => row.id === id);
const folderById = (id: number) => fakeDbState.folders.find((row) => row.id === id);

/** Stable description of the whole library used to prove nothing else changed. */
const librarySnapshot = () =>
  fakeDbState.folders
    .map((row) => `${row.id}|${row.parentId}|${row.name}`)
    .concat(fakeDbState.files.map((row) => `file:${row.id}|${row.folderId}|${row.fileName}|${row.title}`))
    .sort()
    .join("\n");

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDbState();
  seedLibrary();
  storageMocks.from.mockReturnValue({ remove: storageMocks.remove });
  storageMocks.remove.mockResolvedValue({ data: {}, error: null });
});

describe("A. no-login user moves a file between folders", () => {
  it("moves a file from one folder into another folder without any authentication", async () => {
    const result = await anonymousCaller().documents.moveFile({ id: 11, folderId: 4 });

    expect(result.success).toBe(true);
    expect(result.file).toMatchObject({ id: 11, folderId: 4 });
    expect(fileById(11)?.folderId).toBe(4);
  });

  it("moves a file into a different branch of the tree", async () => {
    const result = await anonymousCaller().documents.moveFile({ id: 12, folderId: 4 });

    expect(result.file).toMatchObject({ id: 12, folderId: 4 });
    expect(folderById(4)?.parentId).toBe(2);
  });

  it("never surfaces an authentication error", async () => {
    const failure = await anonymousCaller()
      .documents.moveFile({ id: 11, folderId: 3 })
      .then(() => null, (error: unknown) => error);

    expect(failure).toBeNull();
  });

  it("supports moving a file back to the folder it came from (idempotent re-association)", async () => {
    await anonymousCaller().documents.moveFile({ id: 11, folderId: 4 });
    const result = await anonymousCaller().documents.moveFile({ id: 11, folderId: 2 });

    expect(result.file).toMatchObject({ id: 11, folderId: 2 });
    expect(fileById(11)?.folderId).toBe(2);
  });

  it("does not accept a null destination, because a file always lives in a folder", async () => {
    // doc_files.folder_id is NOT NULL: root is a folder-only destination.
    await expect(
      anonymousCaller().documents.moveFile({ id: 11, folderId: null as unknown as number }),
    ).rejects.toThrow(TRPCError);
    expect(fileById(11)?.folderId).toBe(2);
  });
});

describe("B. file move persists and preserves identity/metadata", () => {
  it("changes only the folder association of the moved file", async () => {
    const before = { ...fileById(11)! };

    await anonymousCaller().documents.moveFile({ id: 11, folderId: 4 });

    const after = fileById(11)!;
    expect(after.id).toBe(before.id);
    expect(after.fileName).toBe(before.fileName);
    expect(after.title).toBe(before.title);
    expect(after.storageBucket).toBe(before.storageBucket);
    expect(after.storagePath).toBe(before.storagePath);
    expect(after.folderId).toBe(4);
    expect(after.folderId).not.toBe(before.folderId);
  });

  it("does not duplicate the file and does not change counts", async () => {
    await anonymousCaller().documents.moveFile({ id: 13, folderId: 3 });

    expect(fakeDbState.files).toHaveLength(3);
    expect(fakeDbState.files.map((row) => row.id).sort((a, b) => a - b)).toEqual([11, 12, 13]);
    expect(fakeDbState.folders).toHaveLength(4);
  });

  it("does not touch any other file or folder", async () => {
    const before = librarySnapshot();

    await anonymousCaller().documents.moveFile({ id: 11, folderId: 3 });

    expect(librarySnapshot()).toBe(before.replace("file:11|2|doc-11.pdf|doc-11", "file:11|3|doc-11.pdf|doc-11"));
    expect(fileById(12)?.folderId).toBe(2);
    expect(fileById(13)?.folderId).toBe(4);
    expect(fakeDbState.folders.map((row) => `${row.id}|${row.parentId}`)).toEqual(["1|null", "2|1", "3|null", "4|2"]);
  });

  it("performs no storage operation at all", async () => {
    await anonymousCaller().documents.moveFile({ id: 11, folderId: 3 });

    expect(storageMocks.from).not.toHaveBeenCalled();
    expect(storageMocks.remove).not.toHaveBeenCalled();
    // the storage object/path is unchanged: the move is a pure re-association
    expect(fileById(11)).toMatchObject({ storageBucket: "doc-files", storagePath: "documents/pump.pdf" });
  });

  it("keeps the file reachable in its new folder after the move", async () => {
    await anonymousCaller().documents.moveFile({ id: 11, folderId: 3 });

    expect(fakeDbState.files.filter((row) => row.folderId === 3).map((row) => row.id)).toEqual([11]);
    expect(fakeDbState.files.filter((row) => row.folderId === 2).map((row) => row.id)).toEqual([12]);
  });
});

describe("C. invalid destinations and malformed input are rejected without mutation", () => {
  it("rejects a nonexistent destination folder", async () => {
    await expect(anonymousCaller().documents.moveFile({ id: 11, folderId: 9999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Destination folder not found",
    });
    expect(fileById(11)?.folderId).toBe(2);
  });

  it("rejects a destination that is a file id, not a folder id", async () => {
    // 13 is a doc_files id: a file may only be re-associated to a library folder.
    await expect(anonymousCaller().documents.moveFile({ id: 11, folderId: 13 })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Destination folder not found",
    });
    expect(fileById(11)?.folderId).toBe(2);
  });

  it("rejects a nonexistent source file", async () => {
    await expect(anonymousCaller().documents.moveFile({ id: 9999, folderId: 3 })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "File not found",
    });
  });

  it("rejects malformed identifiers before any mutation", async () => {
    const before = librarySnapshot();
    const caller = anonymousCaller();

    for (const id of [0, -5, 1.5, Number.NaN]) {
      await expect(caller.documents.moveFile({ id, folderId: 3 })).rejects.toThrow(TRPCError);
    }
    for (const folderId of [0, -1, 1.5, Number.NaN]) {
      await expect(caller.documents.moveFile({ id: 11, folderId })).rejects.toThrow(TRPCError);
    }

    expect(librarySnapshot()).toBe(before);
  });

  it("leaves the library unchanged after every rejected move", async () => {
    const before = librarySnapshot();
    const caller = anonymousCaller();

    await expect(caller.documents.moveFile({ id: 9999, folderId: 3 })).rejects.toThrow(TRPCError);
    await expect(caller.documents.moveFile({ id: 11, folderId: 9999 })).rejects.toThrow(TRPCError);
    await expect(caller.documents.moveFile({ id: 11, folderId: 13 })).rejects.toThrow(TRPCError);

    expect(librarySnapshot()).toBe(before);
    expect(storageMocks.remove).not.toHaveBeenCalled();
  });
});

describe("D. permission boundary (anonymous)", () => {
  it("allows the public organization set and denies the protected one", async () => {
    const caller = anonymousCaller();

    // public organization
    await expect(caller.documents.moveFile({ id: 11, folderId: 3 })).resolves.toMatchObject({ success: true });
    await expect(caller.documents.moveFolder({ id: 4, parentId: 3 })).resolves.toMatchObject({ success: true });
    await expect(caller.documents.renameFolder({ id: 2, name: "Pump Station A" })).resolves.toMatchObject({ success: true });
    await expect(caller.documents.getFolderTree()).resolves.toMatchObject({ folders: expect.any(Array) });

    // protected
    await expect(caller.documents.deleteFolder({ id: 2 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.documents.deleteFile({ id: 12 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.documents.renameFile({ id: 12, title: "renamed.pdf" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.documents.getFile({ id: 12 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("keeps deferred/destructive work refused: nothing was deleted by the move", async () => {
    await anonymousCaller().documents.moveFile({ id: 11, folderId: 3 });
    await expect(anonymousCaller().documents.deleteFile({ id: 11 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect(fakeDbState.files).toHaveLength(3);
    expect(storageMocks.remove).not.toHaveBeenCalled();
  });
});

describe("E. authenticated behaviour is not regressed", () => {
  it("owner can still move a file between folders", async () => {
    const result = await ownerCaller().documents.moveFile({ id: 11, folderId: 4 });

    expect(result.file).toMatchObject({ id: 11, folderId: 4 });
  });

  it("owner is bound by the same validation", async () => {
    await expect(ownerCaller().documents.moveFile({ id: 11, folderId: 9999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(ownerCaller().documents.moveFile({ id: 9999, folderId: 3 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("owner delete capability is unchanged", async () => {
    await expect(ownerCaller().documents.deleteFile({ id: 12 })).resolves.toEqual({
      success: true,
      deletedFileId: 12,
    });
    expect(fakeDbState.files.map((row) => row.id)).toEqual([11, 13]);
  });
});

describe("F. permission boundary stays narrow (source level)", () => {
  const source = readFileSync(resolve(process.cwd(), "api/documents-router.ts"), "utf8");
  const middlewareSource = readFileSync(resolve(process.cwd(), "api/middleware.ts"), "utf8");

  it("declares moveFile as a public procedure", () => {
    expect(source).toContain("moveFile: publicQuery");
    expect(source).not.toContain("moveFile: authedQuery");
  });

  it("keeps the deletion and remaining mutations authenticated", () => {
    for (const procedure of ["deleteFolder:", "deleteFile:", "renameFile:", "getFile:"]) {
      const section = source.slice(source.indexOf(procedure), source.indexOf(procedure) + 200);
      expect(section, `${procedure} must stay authedQuery`).toContain("authedQuery");
    }
  });

  it("leaves the rest of the library surface public", () => {
    for (const procedure of [
      "getFolderTree: publicQuery",
      "getTree: publicQuery",
      "createFolder: publicQuery",
      "uploadFile: publicQuery",
      "renameFolder: publicQuery",
      "moveFolder: publicQuery",
    ]) {
      expect(source).toContain(procedure);
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
