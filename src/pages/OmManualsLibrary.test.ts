import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/pages/OmManualsLibrary.tsx"),
  "utf8",
);

describe("O&M move dialog queries", () => {
  const fullTreeQuery = source.slice(
    source.indexOf("trpc.documents.getTree.useQuery"),
    source.indexOf("trpc.documents.getFolderTree.useQuery"),
  );
  const destinationFolderQuery = source.slice(
    source.indexOf("trpc.documents.getFolderTree.useQuery"),
    source.indexOf("trpc.documents.getAiContext.useQuery"),
  );

  it("does not enable documents.getTree when Move File opens", () => {
    expect(fullTreeQuery).toContain("enabled: debouncedSearch.length > 2");
    expect(fullTreeQuery).not.toContain('modal?.type === "moveFile"');
  });

  it("does not enable documents.getTree when Move Folder opens", () => {
    expect(fullTreeQuery).toContain("enabled: debouncedSearch.length > 2");
    expect(fullTreeQuery).not.toContain('modal?.type === "moveFolder"');
  });

  it("loads the folder-only destination query for both move dialogs", () => {
    expect(destinationFolderQuery).toContain("enabled: isMoveDialogOpen");
    expect(source).toContain('modal?.type === "moveFolder" || modal?.type === "moveFile"');
    expect(source).toContain("buildDestinationFolderTree(destinationFolderData?.folders ?? [])");
    expect(source).toContain("getDestinationFolderOptions(");
  });
});

describe("O&M move pending guards", () => {
  it("guards and disables Move Folder destination submissions while pending", () => {
    expect(source).toContain("!moveFolderSubmissionGuard.current.tryStart()");
    expect(source).toContain("disabled={moveFolder.isPending}");
    expect(source).toContain("moveFolderSubmissionGuard.current.finish()");
  });

  it("guards and disables Move File destination submissions while pending", () => {
    expect(source).toContain("!moveFileSubmissionGuard.current.tryStart()");
    expect(source).toContain("disabled={moveFile.isPending}");
    expect(source).toContain("moveFileSubmissionGuard.current.finish()");
  });
});

describe("O&M move refresh scope", () => {
  it("routes routine move success through the trailing refresh coordinator without AI context invalidation", () => {
    const coordinator = source.slice(
      source.indexOf("const moveRefreshCoordinator"),
      source.indexOf("// ── Mutations ──"),
    );
    const moveMutations = source.slice(
      source.indexOf("const moveFolder ="),
      source.indexOf("useEffect(() =>", source.indexOf("const moveFile =")),
    );

    expect(coordinator).toContain("createTrailingAsyncCoordinator");
    expect(coordinator).toContain("invalidateAiContext: false");
    expect(coordinator).not.toContain("getAiContext");
    expect(moveMutations).toContain('refreshAfterMove("moveFolder")');
    expect(moveMutations).toContain('refreshAfterMove("moveFile")');
    expect(moveMutations).not.toContain("getAiContext");
  });
});
