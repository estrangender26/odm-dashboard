import { describe, it, expect } from "vitest";
import { buildForest } from "./wbsTreeModel";

function makeNode(id: number, parentId: number | null, sortOrder: number, name: string): any {
  return { id, parentNodeId: parentId, code: "1", name, sortOrder, isLeaf: true, archivedAt: null };
}

describe("buildForest", () => {
  it("builds root-only forest", () => {
    const forest = buildForest([makeNode(1, null, 0, "Root")]);
    expect(forest.length).toBe(1);
    expect(forest[0].node.id).toBe(1);
    expect(forest[0].children.length).toBe(0);
    expect(forest[0].depth).toBe(0);
  });

  it("nests children under parents", () => {
    const forest = buildForest([
      makeNode(1, null, 0, "Root"),
      makeNode(2, 1, 0, "A"),
      makeNode(3, 1, 1, "B"),
      makeNode(4, 3, 0, "B1"),
    ]);
    expect(forest[0].children.length).toBe(2);
    expect(forest[0].children[0].node.id).toBe(2);
    expect(forest[0].children[1].node.id).toBe(3);
    expect(forest[0].children[1].children[0].node.id).toBe(4);
    expect(forest[0].children[1].children[0].depth).toBe(2);
  });

  it("sorts by sortOrder", () => {
    const forest = buildForest([
      makeNode(1, null, 0, "Root"),
      makeNode(2, 1, 2, "Second"),
      makeNode(3, 1, 1, "First"),
    ]);
    expect(forest[0].children[0].node.id).toBe(3);
    expect(forest[0].children[1].node.id).toBe(2);
  });
});
