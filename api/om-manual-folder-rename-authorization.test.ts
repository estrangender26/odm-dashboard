/**
 * O&M Manuals Library — folder rename authorization, validation and integrity.
 *
 * Mission invariant under test:
 *   - renaming a folder is a PUBLIC (no-login) operation for ordinary library
 *     users AND for the owner;
 *   - deleting a folder/file remains OWNER (authenticated) only;
 *   - rename stays server-side validated and cannot touch anything except the
 *     `name` of the requested folder.
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

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDbState();
  seedLibrary();
  storageMocks.from.mockReturnValue({ remove: storageMocks.remove });
  storageMocks.remove.mockResolvedValue({ data: {}, error: null });
});

describe("A. no-login user renames a top-level folder", () => {
  it("succeeds without any authentication", async () => {
    const result = await anonymousCaller().documents.renameFolder({ id: 3, name: "Electrical Systems" });

    expect(result.success).toBe(true);
    expect(result.folder).toMatchObject({ id: 3, name: "Electrical Systems" });
    expect(folderById(3)?.name).toBe("Electrical Systems");
  });

  it("never surfaces an authentication error", async () => {
    const failure = await anonymousCaller()
      .documents.renameFolder({ id: 3, name: "Electrical Systems" })
      .then(() => null, (error: unknown) => error);

    expect(failure).toBeNull();
  });

  it("keeps the folder id and does not create a duplicate", async () => {
    await anonymousCaller().documents.renameFolder({ id: 3, name: "Electrical Systems" });

    expect(fakeDbState.folders).toHaveLength(4);
    expect(fakeDbState.folders.map((row) => row.id).sort()).toEqual([1, 2, 3, 4]);
  });
});

describe("B. no-login user renames a nested folder", () => {
  it("succeeds for a child folder", async () => {
    const result = await anonymousCaller().documents.renameFolder({ id: 4, name: "Pump Performance Curves" });

    expect(result.folder).toMatchObject({ id: 4, name: "Pump Performance Curves", parentId: 2 });
    expect(folderById(4)?.name).toBe("Pump Performance Curves");
  });

  it("succeeds for a middle-level folder that has children", async () => {
    const result = await anonymousCaller().documents.renameFolder({ id: 2, name: "Pump Station (Rev B)" });

    expect(result.folder).toMatchObject({ id: 2, parentId: 1 });
    expect(folderById(4)?.parentId).toBe(2);
  });
});

describe("C. owner rename still succeeds", () => {
  it("renames a folder with owner credentials", async () => {
    const result = await ownerCaller().documents.renameFolder({ id: 2, name: "Pump Station — Owner" });

    expect(result.success).toBe(true);
    expect(folderById(2)?.name).toBe("Pump Station — Owner");
  });

  it("renames a top-level folder with owner credentials", async () => {
    const result = await ownerCaller().documents.renameFolder({ id: 1, name: "O&M Manuals (2026)" });

    expect(result.folder).toMatchObject({ id: 1, name: "O&M Manuals (2026)" });
  });
});

describe("D. security regression — delete stays owner-only WITHOUT login", () => {
  it("rejects anonymous folder delete with UNAUTHORIZED", async () => {
    await expect(anonymousCaller().documents.deleteFolder({ id: 1 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects anonymous file delete with UNAUTHORIZED", async () => {
    await expect(anonymousCaller().documents.deleteFile({ id: 11 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("leaves the library untouched after denied deletes", async () => {
    await expect(anonymousCaller().documents.deleteFolder({ id: 1 })).rejects.toThrow(TRPCError);
    await expect(anonymousCaller().documents.deleteFile({ id: 11 })).rejects.toThrow(TRPCError);

    expect(fakeDbState.folders).toHaveLength(4);
    expect(fakeDbState.files).toHaveLength(3);
    expect(storageMocks.remove).not.toHaveBeenCalled();
  });

  it("keeps every other mutation protected without login", async () => {
    const caller = anonymousCaller();

    // Folder rename is public (this suite). Folder move is also public by a
    // separate correction and is covered by om-manual-folder-move-authorization.
    // Everything else in the library stays protected.
    await expect(caller.documents.renameFile({ id: 11, title: "renamed.pdf" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.documents.moveFile({ id: 11, folderId: 3 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.documents.getFile({ id: 11 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("E. owner delete still works", () => {
  it("deletes a storage-backed file with owner credentials", async () => {
    const result = await ownerCaller().documents.deleteFile({ id: 11 });

    expect(result).toEqual({ success: true, deletedFileId: 11 });
    expect(storageMocks.from).toHaveBeenCalledWith("doc-files");
    expect(storageMocks.remove).toHaveBeenCalledWith(["documents/pump.pdf"]);
    expect(fakeDbState.files.map((row) => row.id)).toEqual([12, 13]);
  });

  it("deletes a folder with descendants and files with owner credentials", async () => {
    const result = await ownerCaller().documents.deleteFolder({ id: 1 });

    expect(result.success).toBe(true);
    expect([...result.deletedFolderIds].sort((a, b) => a - b)).toEqual([1, 2, 4]);
    expect([...result.deletedFileIds].sort((a, b) => a - b)).toEqual([11, 12, 13]);
    expect(fakeDbState.folders.map((row) => row.id)).toEqual([3]);
    expect(fakeDbState.files).toHaveLength(0);
  });
});

describe("F. invalid rename input is rejected server-side", () => {
  it("rejects an empty name", async () => {
    await expect(anonymousCaller().documents.renameFolder({ id: 3, name: "" })).rejects.toThrow(TRPCError);
    expect(folderById(3)?.name).toBe("Electrical");
  });

  it("rejects a whitespace-only name", async () => {
    await expect(anonymousCaller().documents.renameFolder({ id: 3, name: "   \t " })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Folder name is required",
    });
    expect(folderById(3)?.name).toBe("Electrical");
  });

  it("rejects a nonexistent folder", async () => {
    await expect(anonymousCaller().documents.renameFolder({ id: 9999, name: "Ghost" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Folder not found",
    });
  });

  it("rejects malformed folder identifiers", async () => {
    const caller = anonymousCaller();

    for (const id of [0, -5, 1.5, Number.NaN]) {
      await expect(caller.documents.renameFolder({ id, name: "Whatever" })).rejects.toThrow(TRPCError);
    }
    expect(fakeDbState.folders.map((row) => row.name)).toEqual([
      "O&M Manuals",
      "Pump Station",
      "Electrical",
      "Pump Curves",
    ]);
  });

  it("rejects a name longer than the column limit and accepts the limit itself", async () => {
    const caller = anonymousCaller();

    await expect(caller.documents.renameFolder({ id: 3, name: "x".repeat(256) })).rejects.toThrow(TRPCError);

    const maxLengthName = "y".repeat(255);
    const result = await caller.documents.renameFolder({ id: 3, name: maxLengthName });
    expect(result.folder.name).toBe(maxLengthName);
  });

  it("normalizes surrounding whitespace and keeps canonical name rules", async () => {
    const result = await anonymousCaller().documents.renameFolder({ id: 3, name: "  Electrical  " });

    expect(result.folder.name).toBe("Electrical");
  });

  it("allows a duplicate sibling name, matching the existing createFolder rule", async () => {
    // createFolder applies no sibling-name uniqueness constraint, so rename must
    // not invent a stricter rule that could reject legitimate library data.
    const result = await anonymousCaller().documents.renameFolder({ id: 4, name: "Pump Station" });

    expect(result.folder).toMatchObject({ id: 4, name: "Pump Station", parentId: 2 });
    expect(folderById(2)?.name).toBe("Pump Station");
  });
});

describe("G. rename preserves data integrity", () => {
  it("changes only the requested folder name", async () => {
    const result = await anonymousCaller().documents.renameFolder({ id: 2, name: "Pump Station (2026)" });

    const renamed = folderById(2);
    expect(renamed).toMatchObject({ id: 2, name: "Pump Station (2026)", parentId: 1 });
    expect(result.folder.id).toBe(2);

    // children keep their parent, files keep their folder, counts are unchanged
    expect(folderById(4)?.parentId).toBe(2);
    expect(fakeDbState.files.filter((row) => row.folderId === 2).map((row) => row.id)).toEqual([11, 12]);
    expect(fakeDbState.files.filter((row) => row.folderId === 4).map((row) => row.id)).toEqual([13]);
    expect(fakeDbState.folders).toHaveLength(4);
    expect(fakeDbState.files).toHaveLength(3);

    // no other folder was touched
    expect(folderById(1)?.name).toBe("O&M Manuals");
    expect(folderById(3)?.name).toBe("Electrical");
    expect(fakeDbState.folders.filter((row) => row.name === "Pump Station (2026)")).toHaveLength(1);
  });

  it("targets exactly one row, so no other resource can be altered by the request", async () => {
    await anonymousCaller().documents.renameFolder({ id: 3, name: "Electrical Systems" });

    expect(folderById(1)?.name).toBe("O&M Manuals");
    expect(folderById(2)?.name).toBe("Pump Station");
    expect(folderById(4)?.name).toBe("Pump Curves");
    expect(fakeDbState.files.map((row) => row.fileName)).toEqual([
      "doc-11.pdf",
      "doc-12.pdf",
      "doc-13.pdf",
    ]);
  });
});

describe("H. permission boundary stays narrow (source level)", () => {
  const source = readFileSync(resolve(process.cwd(), "api/documents-router.ts"), "utf8");

  it("declares renameFolder as a public procedure", () => {
    expect(source).toContain("renameFolder: publicQuery");
    expect(source).not.toContain("renameFolder: authedQuery");
  });

  it("keeps the destructive and unrelated mutations authenticated", () => {
    // renameFolder and moveFolder are the only intentionally public mutations;
    // moveFolder is covered by om-manual-folder-move-authorization.test.ts.
    for (const procedure of [
      "deleteFolder:",
      "deleteFile:",
      "renameFile:",
      "moveFile:",
      "getFile:",
    ]) {
      const section = source.slice(source.indexOf(procedure), source.indexOf(procedure) + 200);
      expect(section, `${procedure} must stay authedQuery`).toContain("authedQuery");
    }
  });

  it("did not add a blanket O&M mutation bypass", () => {
    expect(source).not.toMatch(/if\s*\(\s*.*O&M.*\)\s*(return\s+)?next\(/i);
    expect(source).not.toContain("requireAuth: false");
    expect(source).not.toContain("skipAuth");
  });
});
