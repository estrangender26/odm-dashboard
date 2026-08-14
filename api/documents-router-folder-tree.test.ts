import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "api/documents-router.ts"),
  "utf8",
);
const folderTreeProcedure = source.slice(
  source.indexOf("getFolderTree: publicQuery"),
  source.indexOf("getFolderContents: publicQuery"),
);

describe("documents.getFolderTree", () => {
  it("selects only destination folder metadata and never scans document file rows", () => {
    expect(folderTreeProcedure).toContain(".from(docFolders)");
    expect(folderTreeProcedure).toContain("id: docFolders.id");
    expect(folderTreeProcedure).toContain("parentId: docFolders.parentId");
    expect(folderTreeProcedure).not.toContain("docFiles");
    expect(folderTreeProcedure).not.toContain("fileData");
  });
});
