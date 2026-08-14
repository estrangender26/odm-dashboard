import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/pages/OmManualsLibrary.tsx"),
  "utf8",
);

/**
 * Extracts the options object literal passed to a `.useQuery(...)` call, using
 * brace balancing so the slice stops at the query's own closing brace instead
 * of running on into unrelated statements that follow it.
 */
function extractQueryOptions(procedure: string): string {
  const callIndex = source.indexOf(`${procedure}.useQuery`);
  if (callIndex === -1) throw new Error(`Query call not found: ${procedure}.useQuery`);

  const optionsStart = source.indexOf("{", callIndex);
  if (optionsStart === -1) throw new Error(`Options object not found: ${procedure}.useQuery`);

  let depth = 0;
  for (let index = optionsStart; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(optionsStart, index + 1);
    }
  }

  throw new Error(`Unbalanced options object: ${procedure}.useQuery`);
}

/** Returns just the `enabled:` expression from a query options object. */
function extractEnabledExpression(options: string): string {
  const match = /^[ \t]*enabled:[ \t]*(.+?),?[ \t]*$/m.exec(options);
  if (!match) throw new Error("No enabled option found in query options");
  return match[1];
}

describe("O&M move dialog queries", () => {
  const fullTreeOptions = extractQueryOptions("trpc.documents.getTree");
  const fullTreeEnabled = extractEnabledExpression(fullTreeOptions);
  const destinationFolderOptions = extractQueryOptions("trpc.documents.getFolderTree");

  it("does not enable documents.getTree when Move File opens", () => {
    expect(fullTreeEnabled).toBe("debouncedSearch.length > 2");
    expect(fullTreeEnabled).not.toContain("moveFile");
    expect(fullTreeOptions).not.toContain("moveFile");
  });

  it("does not enable documents.getTree when Move Folder opens", () => {
    expect(fullTreeEnabled).toBe("debouncedSearch.length > 2");
    expect(fullTreeEnabled).not.toContain("moveFolder");
    expect(fullTreeOptions).not.toContain("moveFolder");
  });

  it("keeps the documents.getTree enabled condition search-only", () => {
    expect(fullTreeEnabled).not.toContain("isMoveDialogOpen");
    expect(fullTreeEnabled).not.toContain("modal");
    expect(fullTreeEnabled).not.toMatch(/\|\||&&/);
  });

  it("loads the folder-only destination query for both move dialogs", () => {
    expect(extractEnabledExpression(destinationFolderOptions)).toBe("isMoveDialogOpen");
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
