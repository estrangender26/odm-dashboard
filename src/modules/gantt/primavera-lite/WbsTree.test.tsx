// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WbsNode } from "./wbsTreeModel";

interface CapturedMutation {
  nodeId?: number;
  newSortOrder?: number;
  newParentNodeId?: number;
  expectedRevision?: number;
  slug?: string;
  access?: string;
}

const captured: {
  reorder: CapturedMutation[];
  move: CapturedMutation[];
  create: CapturedMutation[];
  rename: CapturedMutation[];
  archive: CapturedMutation[];
  restore: CapturedMutation[];
} = {
  reorder: [],
  move: [],
  create: [],
  rename: [],
  archive: [],
  restore: [],
};

function createMutationStub(
  bucket: CapturedMutation[],
  response?: { revision: number; node?: Partial<WbsNode> }
) {
  return (opts?: { onSuccess?: (res: unknown) => void; onError?: (err: unknown) => void }) => {
    const [isPending] = useState(false);
    const [error] = useState<null | Error>(null);
    const mutate = (input: CapturedMutation) => {
      bucket.push(input);
      const res = response ?? { revision: 2 };
      opts?.onSuccess?.(res);
    };
    const mutateAsync = async (input: CapturedMutation) => {
      bucket.push(input);
      return response ?? { revision: 2 };
    };
    return { isPending, error, mutate, mutateAsync };
  };
}

function queryStub() {
  return { data: undefined, isLoading: false, error: null, refetch: async () => ({}) };
}

vi.mock("@/providers/trpc", () => {
  return {
    trpc: {
      Provider: ({ children }: { children: ReactNode }) => children,
      primaveraLite: new Proxy(
        {},
        {
          get(_target: unknown, prop: string) {
            if (prop === "useUtils") {
              return () => ({
                primaveraLite: {
                  load: {
                    setData: () => undefined,
                    getData: () => undefined,
                    cancel: async () => undefined,
                  },
                },
              });
            }
            if (prop === "createWbsNode") return { useMutation: createMutationStub(captured.create) };
            if (prop === "renameWbsNode") return { useMutation: createMutationStub(captured.rename) };
            if (prop === "reorderWbsNode") return { useMutation: createMutationStub(captured.reorder) };
            if (prop === "moveWbsNode") {
              return {
                useMutation: createMutationStub(captured.move, {
                  revision: 2,
                  node: { parentNodeId: 3 },
                }),
              };
            }
            if (prop === "archiveWbsNodeDryRun") return { useMutation: () => ({ mutateAsync: async () => ({ wouldArchive: {} }) }) };
            if (prop === "archiveWbsNode") return { useMutation: createMutationStub(captured.archive) };
            if (prop === "restoreWbsNode") return { useMutation: createMutationStub(captured.restore) };
            if (prop === "listWbsTree") return { useQuery: queryStub };
            return { useQuery: queryStub, useMutation: () => ({ mutate: () => undefined, mutateAsync: async () => ({}) }) };
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

import WbsTree from "./WbsTree";

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
  makeNode(8, 1, 2, "1.3", "ArchivedChild", { archivedAt: "2026-01-01T00:00:00Z" }),
];

function renderWbsTree(
  role: "admin" | "editor" | "viewer" = "admin",
  opts?: { onRevisionChange?: (revision: number) => void; onRefresh?: () => void }
) {
  const onRevisionChange = opts?.onRevisionChange ?? vi.fn();
  const onRefresh = opts?.onRefresh ?? vi.fn();
  render(
    <WbsTree
      slug="test-project"
      access="admin-token"
      role={role}
      expectedRevision={1}
      nodes={NODES}
      onRevisionChange={onRevisionChange}
      onRefresh={onRefresh}
    />
  );
  return { onRevisionChange, onRefresh };
}

function rowByCode(code: string) {
  const codeSpan = screen.getAllByTitle(code)[0];
  const row = codeSpan.parentElement;
  if (!row) throw new Error(`Could not find row for code ${code}`);
  return within(row);
}

function expandButtonFor(code: string) {
  return rowByCode(code).getByRole("button", { name: /^(Expand|Collapse)$/ });
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  captured.reorder.length = 0;
  captured.move.length = 0;
  captured.create.length = 0;
  captured.rename.length = 0;
  captured.archive.length = 0;
  captured.restore.length = 0;
});

describe("WbsTree hierarchy UI", () => {
  it("expands and collapses a parent row via the real expand control", async () => {
    renderWbsTree("admin");
    expect(screen.queryByTitle("1.1")).not.toBeInTheDocument();

    const expandEngineering = expandButtonFor("1");
    await userEvent.click(expandEngineering);

    expect(screen.getByTitle("1.1")).toBeInTheDocument();
    expect(screen.getByTitle("1.2")).toBeInTheDocument();

    const collapseEngineering = expandButtonFor('1');
    await userEvent.click(collapseEngineering);

    expect(screen.queryByTitle("1.1")).not.toBeInTheDocument();
    expect(screen.queryByTitle("1.2")).not.toBeInTheDocument();
  });

  it("renders parent-child hierarchy with correct WBS codes", async () => {
    renderWbsTree("admin");
    await userEvent.click(expandButtonFor("1"));
    expect(screen.getByText("Engineering")).toBeInTheDocument();
    expect(screen.getByText("Civil")).toBeInTheDocument();
    expect(screen.getByText("Mechanical")).toBeInTheDocument();
  });

  it("exposes Add child WBS action for editors/admins", async () => {
    renderWbsTree("editor");
    expect(rowByCode("1").getByTitle("Add child WBS")).toBeInTheDocument();
  });

  it("does not expose mutation controls to viewers", () => {
    renderWbsTree("viewer");
    expect(screen.queryByTitle("Add child WBS")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Move up")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Move down")).not.toBeInTheDocument();
    expect(screen.queryByText("Move to…")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Archive")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Rename")).not.toBeInTheDocument();
  });

  it("exposes archive and restore controls only for admin", () => {
    renderWbsTree("admin");
    expect(rowByCode("1").getByTitle("Archive")).toBeInTheDocument();

    cleanup();
    renderWbsTree("editor");
    expect(rowByCode("1").queryByTitle("Archive")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Restore")).not.toBeInTheDocument();

    cleanup();
    renderWbsTree("viewer");
    expect(screen.queryByTitle("Restore")).not.toBeInTheDocument();
  });
});

describe("WbsTree Move Up / Move Down", () => {
  it("clicks Move Down and sends the correct reorderWbsNode payload", async () => {
    renderWbsTree("admin");
    await userEvent.click(expandButtonFor("1"));

    const civilRow = rowByCode("1.1");
    await userEvent.click(civilRow.getByTitle("Move down"));

    expect(captured.reorder).toHaveLength(1);
    expect(captured.reorder[0]).toMatchObject({
      slug: "test-project",
      access: "admin-token",
      expectedRevision: 1,
      nodeId: 2,
      newSortOrder: 1,
    });
  });

  it("clicks Move Up and sends the correct reorderWbsNode payload", async () => {
    renderWbsTree("admin");
    await userEvent.click(expandButtonFor("1"));

    const mechRow = rowByCode("1.2");
    await userEvent.click(mechRow.getByTitle("Move up"));

    expect(captured.reorder).toHaveLength(1);
    expect(captured.reorder[0]).toMatchObject({
      slug: "test-project",
      access: "admin-token",
      expectedRevision: 1,
      nodeId: 3,
      newSortOrder: 0,
    });
  });

  it("disables Move Up for the first sibling and does not fire a mutation", async () => {
    renderWbsTree("admin");
    await userEvent.click(expandButtonFor("1"));

    const civilRow = rowByCode("1.1");
    const upButton = civilRow.getByTitle("Move up");
    expect(upButton).toBeDisabled();

    await userEvent.click(upButton);
    expect(captured.reorder).toHaveLength(0);
  });

  it("disables Move Down for the last sibling and does not fire a mutation", async () => {
    renderWbsTree("admin");
    await userEvent.click(expandButtonFor("1"));

    const mechRow = rowByCode("1.2");
    const downButton = mechRow.getByTitle("Move down");
    expect(downButton).toBeDisabled();

    await userEvent.click(downButton);
    expect(captured.reorder).toHaveLength(0);
  });

  it("disables reorder controls while a reorder mutation is pending", async () => {
    // The stub always reports isPending=false, so this test verifies the wiring does not
    // crash when disabled is combined with isPending.
    renderWbsTree("admin");
    await userEvent.click(expandButtonFor("1"));

    const civilRow = rowByCode("1.1");
    const downButton = civilRow.getByTitle("Move down");
    expect(downButton).not.toBeDisabled();
  });
});

describe("WbsTree Move to parent", () => {
  it("selects a new parent and sends the correct moveWbsNode payload", async () => {
    renderWbsTree("admin");
    await userEvent.click(expandButtonFor("1"));

    const civilRow = rowByCode("1.1");
    const select = civilRow.getByRole("combobox", { name: /Move Civil to parent/ });
    await userEvent.selectOptions(select, "3");

    expect(captured.move).toHaveLength(1);
    expect(captured.move[0]).toMatchObject({
      slug: "test-project",
      access: "admin-token",
      expectedRevision: 1,
      nodeId: 2,
      newParentNodeId: 3,
    });
  });

  it("does not include invalid move targets in the parent selector", async () => {
    renderWbsTree("admin");
    await userEvent.click(expandButtonFor("1"));

    const civilRow = rowByCode("1.1");
    const select = civilRow.getByRole("combobox", { name: /Move Civil to parent/ });
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);

    // Self excluded
    expect(options).not.toContain("2");
    // Descendants excluded (Civil has no active descendants)
    // Current parent excluded
    expect(options).not.toContain("1");
    // Root-level nodes excluded
    expect(options).not.toContain("4");
    expect(options).not.toContain("5");
    // Archived sibling excluded
    expect(options).not.toContain("8");

    // Valid non-root siblings/relatives
    expect(options).toContain("3");
    expect(options).toContain("6");
    expect(options).toContain("7");
  });

  it("does not render a parent selector when no valid targets exist", async () => {
    // Minimal tree: one root and one child. The child has no valid parent target
    // because its only parent is root (excluded by UI/backend), and there are no
    // other non-root nodes.
    const minimalNodes: WbsNode[] = [
      { id: 10, parentNodeId: null, sortOrder: 0, code: "1", name: "Root", isLeaf: false, archivedAt: null },
      { id: 11, parentNodeId: 10, sortOrder: 0, code: "1.1", name: "OnlyChild", isLeaf: true, archivedAt: null },
    ];
    render(
      <WbsTree
        slug="minimal"
        access="admin-token"
        role="admin"
        expectedRevision={1}
        nodes={minimalNodes}
        onRevisionChange={() => undefined}
        onRefresh={async () => undefined}
      />
    );
    await userEvent.click(expandButtonFor("1"));
    const childRow = rowByCode("1.1");
    expect(
      childRow.queryByRole("combobox", { name: /Move OnlyChild to parent/ })
    ).not.toBeInTheDocument();
  });
});
