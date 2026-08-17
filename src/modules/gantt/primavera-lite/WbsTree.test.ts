import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WbsNode } from "./wbsTreeModel";

const h = vi.hoisted(() => ({
  lastReorder: null as { nodeId: number; newSortOrder: number } | null,
  lastMove: null as { nodeId: number; newParentNodeId: number } | null,
}));

vi.mock("@/providers/trpc", () => {
  const queryStub = () => ({ data: undefined, isLoading: false, error: null, refetch: async () => ({}) });
  const mutationStub = () => ({
    isPending: false,
    error: null,
    mutate: () => undefined,
    mutateAsync: async () => ({}),
  });
  return {
    trpc: {
      primaveraLite: new Proxy(
        {},
        {
          get() {
            return { useQuery: queryStub, useMutation: mutationStub };
          },
        }
      ),
      useUtils: () => ({
        primaveraLite: {
          load: { setData: () => undefined, getData: () => undefined, cancel: async () => undefined },
        },
      }),
    },
  };
});

import WbsTree, { type WbsTreeProps } from "./WbsTree";

function makeNode(
  id: number,
  parentNodeId: number | null,
  sortOrder: number,
  code: string,
  name: string,
  opts?: Partial<WbsNode>
): WbsNode {
  return { id, parentNodeId, sortOrder, code, name, isLeaf: true, archivedAt: null, ...opts };
}

const NODES: WbsNode[] = [
  makeNode(1, null, 0, "1", "Engineering", { isLeaf: false }),
  makeNode(2, 1, 0, "1.1", "Civil"),
  makeNode(3, 1, 1, "1.2", "Mechanical"),
  makeNode(4, null, 1, "2", "Procurement"),
  makeNode(5, null, 2, "3", "Construction", { isLeaf: false }),
  makeNode(6, 5, 0, "3.1", "Foundation"),
  makeNode(7, 5, 1, "3.2", "Structure"),
];

function textContent(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function renderWbsTree(role: WbsTreeProps["role"], defaultExpanded?: number[]) {
  return renderToStaticMarkup(
    createElement(WbsTree, {
      slug: "test-project",
      access: "admin-token",
      role,
      expectedRevision: 1,
      nodes: NODES,
      onRevisionChange: () => undefined,
      onRefresh: async () => undefined,
      defaultExpanded,
    })
  );
}

function controlDisabledAfterCode(html: string, code: string, controlTitle: string): boolean {
  const codeIdx = html.indexOf(`title="${code}">${code}</span>`);
  expect(codeIdx, `expected row with code ${code}`).toBeGreaterThan(-1);
  const controlIdx = html.indexOf(`title="${controlTitle}"`, codeIdx + 1);
  expect(controlIdx, `expected ${controlTitle} after code ${code}`).toBeGreaterThan(-1);
  const buttonStart = html.lastIndexOf("<button", controlIdx);
  return buttonStart > -1 && html.slice(buttonStart, controlIdx).includes("disabled");
}

describe("WbsTree hierarchy UI", () => {
  beforeEach(() => {
    h.lastReorder = null;
    h.lastMove = null;
  });

  it("renders parent-child hierarchy with correct WBS codes", () => {
    const html = renderWbsTree("admin", [1, 5]);
    const text = textContent(html);
    expect(text).toContain("1 Engineering");
    expect(text).toContain("1.1 Civil");
    expect(text).toContain("1.2 Mechanical");
    expect(text).toContain("2 Procurement");
    expect(text).toContain("3 Construction");
    expect(text).toContain("3.1 Foundation");
    expect(text).toContain("3.2 Structure");
  });

  it("exposes Add child WBS action for editors/admins", () => {
    const html = renderWbsTree("editor");
    expect(html).toContain('title="Add child WBS"');
  });

  it("renders Move Up and Move Down controls", () => {
    const html = renderWbsTree("admin", [1, 5]);
    expect(html).toContain('title="Move up"');
    expect(html).toContain('title="Move down"');
  });

  it("renders a Move to parent dropdown when valid targets exist", () => {
    const html = renderWbsTree("admin", [1, 5]);
    expect(html).toContain("Move to…");
  });

  it("does not expose mutation controls to viewers", () => {
    const html = renderWbsTree("viewer");
    expect(html).not.toContain('title="Add child WBS"');
    expect(html).not.toContain('title="Move up"');
    expect(html).not.toContain('title="Move down"');
    expect(html).not.toContain("Move to…");
    expect(html).not.toContain('title="Archive"');
    expect(html).not.toContain('title="Rename"');
  });

  it("exposes archive and restore controls only for admin", () => {
    const activeHtml = renderWbsTree("admin");
    expect(activeHtml).toContain('title="Archive"');

    const editorHtml = renderWbsTree("editor");
    expect(editorHtml).not.toContain('title="Archive"');
    expect(editorHtml).not.toContain('title="Restore"');

    const viewerHtml = renderWbsTree("viewer");
    expect(viewerHtml).not.toContain('title="Restore"');
  });

  it("disables Move Up for the first sibling", () => {
    // Civil (1.1) is the first child of Engineering; its Move Up should be disabled.
    const html = renderWbsTree("admin", [1, 5]);
    expect(controlDisabledAfterCode(html, "1.1", "Move up")).toBe(true);
  });

  it("disables Move Down for the last sibling", () => {
    // Mechanical (1.2) is the last child of Engineering; its Move Down should be disabled.
    const html = renderWbsTree("admin", [1, 5]);
    expect(controlDisabledAfterCode(html, "1.2", "Move down")).toBe(true);
  });
});
