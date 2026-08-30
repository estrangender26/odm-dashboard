import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/providers/trpc";
import { ChevronRight, ChevronDown, Plus, Pencil, Archive, RotateCcw, ArrowUp, ArrowDown } from "lucide-react";
import { buildForest, type WbsNode, type TreeNode } from "./wbsTreeModel";

export interface WbsTreeProps {
  slug: string;
  access: string;
  role: "admin" | "editor" | "viewer";
  expectedRevision: number;
  nodes: WbsNode[];
  onRevisionChange: (revision: number) => void;
  onRefresh: () => void;
}
export default function WbsTree({
  slug,
  access,
  role,
  expectedRevision,
  nodes,
  onRevisionChange,
  onRefresh,
}: WbsTreeProps) {
  const canEdit = role === "admin" || role === "editor";
  const isAdmin = role === "admin";
  // Start with every parent node expanded so a freshly loaded (or hard
  // reloaded) hierarchy is fully visible instead of appearing collapsed. The
  // set is initialized once from the first `nodes` snapshot on purpose: later
  // polls/refetches must NOT re-expand a branch the user collapsed.
  const [expanded, setExpanded] = useState<Set<number>>(() => {
    const parents = new Set<number>();
    for (const node of nodes) {
      if (node.parentNodeId !== null) parents.add(node.parentNodeId);
    }
    return parents;
  });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [addingParentId, setAddingParentId] = useState<number | null>(null);
  const [newChildName, setNewChildName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Guards against duplicate create submissions from Enter + blur or a second
  // Enter while the first request is still in flight (same parent + name).
  const lastCreateKeyRef = useRef<string | null>(null);

  const createNode = trpc.primaveraLite.createWbsNode.useMutation({
    onSuccess: (res) => {
      onRevisionChange(res.revision);
      setAddingParentId(null);
      setNewChildName("");
      lastCreateKeyRef.current = null;
      // Expand the new node's parent — and the whole ancestor chain — so the
      // created child is visible once the refreshed tree renders.
      setExpanded((prev) => {
        const next = new Set(prev);
        if (res.node.parentNodeId === null) {
          next.add(res.node.id);
        } else {
          for (const id of ancestorIdsFrom(res.node.parentNodeId)) next.add(id);
        }
        return next;
      });
      setMessage(null);
      onRefresh();
    },
    onError: (err) => {
      lastCreateKeyRef.current = null;
      setMessage(err.message);
    },
  });

  const renameNode = trpc.primaveraLite.renameWbsNode.useMutation({
    onSuccess: (res) => {
      onRevisionChange(res.revision);
      setEditingId(null);
      setMessage(null);
      onRefresh();
    },
    onError: (err) => setMessage(err.message),
  });

  const archiveDryRun = trpc.primaveraLite.archiveWbsNodeDryRun.useMutation();
  const archiveNode = trpc.primaveraLite.archiveWbsNode.useMutation({
    onSuccess: (res) => {
      onRevisionChange(res.revision);
      setMessage(null);
      onRefresh();
    },
    onError: (err) => setMessage(err.message),
  });

  const restoreNode = trpc.primaveraLite.restoreWbsNode.useMutation({
    onSuccess: (res) => {
      onRevisionChange(res.revision);
      setMessage(null);
      onRefresh();
    },
    onError: (err) => setMessage(err.message),
  });

  const reorderNode = trpc.primaveraLite.reorderWbsNode.useMutation({
    onSuccess: (res) => {
      onRevisionChange(res.revision);
      setMessage(null);
      onRefresh();
    },
    onError: (err) => setMessage(err.message),
  });

  const moveNode = trpc.primaveraLite.moveWbsNode.useMutation({
    onSuccess: (res) => {
      onRevisionChange(res.revision);
      setExpanded((prev) => new Set(prev).add(res.node.parentNodeId ?? res.node.id));
      setMessage(null);
      onRefresh();
    },
    onError: (err) => setMessage(err.message),
  });

  const listWithArchived = trpc.primaveraLite.listWbsTree.useQuery(
    { slug, access, includeArchived: true },
    { enabled: showArchived && isAdmin }
  );

  const displayNodes = showArchived && isAdmin && listWithArchived.data
    ? listWithArchived.data.nodes
    : nodes;
  const forest = useMemo(() => buildForest(displayNodes), [displayNodes]);

  function toggleExpanded(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startRename(node: WbsNode) {
    setEditingId(node.id);
    setEditName(node.name);
  }

  function submitRename(nodeId: number) {
    const name = editName.trim();
    if (!name || renameNode.isPending) return;
    setMessage(null);
    renameNode.mutate({
      slug,
      access,
      expectedRevision,
      nodeId,
      name,
    });
  }

  function startAddChild(parentId: number) {
    setAddingParentId(parentId);
    setNewChildName("");
    setExpanded((prev) => new Set(prev).add(parentId));
  }

  function submitAddChild(parentId: number) {
    const name = newChildName.trim();
    if (!name) {
      setAddingParentId(null);
      return;
    }
    const key = `${parentId}:${name}`;
    if (createNode.isPending || lastCreateKeyRef.current === key) return;
    lastCreateKeyRef.current = key;
    setMessage(null);
    createNode.mutate({
      slug,
      access,
      expectedRevision,
      parentNodeId: parentId,
      name,
    });
  }

  async function handleArchive(nodeId: number) {
    setMessage(null);
    const dryRun = await archiveDryRun.mutateAsync({
      slug,
      access,
      expectedRevision,
      nodeId,
    });
    if (dryRun.wouldArchive.activities && dryRun.wouldArchive.activities > 0) {
      const ok = window.confirm(
        `Archiving this WBS node will also archive ${dryRun.wouldArchive.activities} activity(s). Continue?`
      );
      if (!ok) return;
    }
    await archiveNode.mutateAsync({
      slug,
      access,
      expectedRevision,
      nodeId,
      previewToken: dryRun.previewToken,
      confirmed: true,
    });
  }

  function handleRestore(nodeId: number) {
    setMessage(null);
    restoreNode.mutate({ slug, access, expectedRevision, nodeId, confirmed: true });
  }

  function handleReorder(nodeId: number, direction: "up" | "down") {
    const node = displayNodes.find((n) => n.id === nodeId);
    if (!node || node.parentNodeId === null) return;
    const siblings = displayNodes
      .filter((n) => n.parentNodeId === node.parentNodeId && !n.archivedAt)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    const currentIndex = siblings.findIndex((n) => n.id === nodeId);
    const newIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= siblings.length) return;
    setMessage(null);
    reorderNode.mutate({
      slug,
      access,
      expectedRevision,
      nodeId,
      newSortOrder: newIndex,
    });
  }

  function handleMove(nodeId: number, newParentId: number) {
    if (!newParentId) return;
    setMessage(null);
    moveNode.mutate({
      slug,
      access,
      expectedRevision,
      nodeId,
      newParentNodeId: newParentId,
    });
  }

  function descendantIds(nodeId: number): number[] {
    const result: number[] = [];
    const children = displayNodes.filter((n) => n.parentNodeId === nodeId);
    for (const child of children) {
      result.push(child.id);
      result.push(...descendantIds(child.id));
    }
    return result;
  }

  function validMoveTargets(nodeId: number): WbsNode[] {
    const node = displayNodes.find((n) => n.id === nodeId);
    if (!node) return [];
    const blocked = new Set([nodeId, ...descendantIds(nodeId)]);
    return displayNodes.filter(
      (n) =>
        !n.archivedAt &&
        !blocked.has(n.id) &&
        n.id !== node.parentNodeId &&
        n.id !== nodeId &&
        n.parentNodeId !== null
    );
  }

  // Walks from the given parent id up through the display tree and returns the
  // ids of every ancestor (including the parent itself).
  function ancestorIdsFrom(parentNodeId: number): number[] {
    const ids: number[] = [];
    let currentId: number | null = parentNodeId;
    while (currentId !== null) {
      ids.push(currentId);
      const parent = displayNodes.find((n) => n.id === currentId);
      if (!parent) break;
      currentId = parent.parentNodeId;
    }
    return ids;
  }

  function renderTreeNode(treeNode: TreeNode) {
    const { node, children, depth } = treeNode;
    const isExpanded = expanded.has(node.id);
    const isEditing = editingId === node.id;
    const isAdding = addingParentId === node.id;
    const isArchived = !!node.archivedAt;
    const hasChildren = children.length > 0;
    const siblings = node.parentNodeId === null
      ? forest.map((r) => r.node)
      : displayNodes
          .filter((n) => n.parentNodeId === node.parentNodeId && !n.archivedAt)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    const siblingIndex = siblings.findIndex((n) => n.id === node.id);
    const canMoveUp = siblingIndex > 0;
    const canMoveDown = siblingIndex >= 0 && siblingIndex < siblings.length - 1;
    const moveTargets = validMoveTargets(node.id);

    return (
      <div key={node.id} className="select-none">
        <div
          className={`flex items-center gap-2 py-1 pr-2 hover:bg-slate-100 rounded ${isArchived ? "opacity-60" : ""}`}
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
        >
          <button
            type="button"
            onClick={() => toggleExpanded(node.id)}
            className="h-4 w-4 text-slate-400"
            aria-label={isExpanded ? "Collapse" : "Expand"}
            disabled={!hasChildren}
          >
            {hasChildren ? (
              isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
            ) : (
              <span className="h-4 w-4" />
            )}
          </button>

          <span className="text-xs font-mono text-slate-500 w-16 truncate" title={node.code}>
            {node.code}
          </span>

          {isEditing ? (
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => submitRename(node.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename(node.id);
                if (e.key === "Escape") setEditingId(null);
              }}
              autoFocus
              className="h-7 flex-1 text-sm"
            />
          ) : (
            <span className="flex-1 text-sm truncate" title={node.name}>
              {node.name}
              {isArchived && <span className="ml-2 text-xs text-slate-400">(archived)</span>}
            </span>
          )}

          {canEdit && !isEditing && !isArchived && (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => startAddChild(node.id)}
                title="Add child WBS"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => startRename(node)}
                title="Rename"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={!canMoveUp || reorderNode.isPending}
                onClick={() => handleReorder(node.id, "up")}
                title="Move up"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={!canMoveDown || reorderNode.isPending}
                onClick={() => handleReorder(node.id, "down")}
                title="Move down"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              {moveTargets.length > 0 && (
                <select
                  aria-label={`Move ${node.name} to parent`}
                  className="h-7 rounded border px-1 text-xs"
                  value=""
                  disabled={moveNode.isPending}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (!value) return;
                    handleMove(node.id, value);
                    e.currentTarget.value = "";
                  }}
                >
                  <option value="">Move to…</option>
                  {moveTargets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.code} — {target.name}
                    </option>
                  ))}
                </select>
              )}
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive"
                  onClick={() => handleArchive(node.id)}
                  title="Archive"
                >
                  <Archive className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )}

          {isAdmin && isArchived && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => handleRestore(node.id)}
              title="Restore"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {isAdding && (
          <div
            className="flex items-center gap-2 py-1 pr-2"
            style={{ paddingLeft: `${(depth + 1) * 20 + 8}px` }}
          >
            <span className="h-4 w-4" />
            <Input
              value={newChildName}
              onChange={(e) => setNewChildName(e.target.value)}
              onBlur={() => {
                if (newChildName.trim()) submitAddChild(node.id);
                else setAddingParentId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitAddChild(node.id);
                if (e.key === "Escape") setAddingParentId(null);
              }}
              autoFocus
              disabled={createNode.isPending}
              placeholder="New WBS name"
              className="h-7 flex-1 text-sm"
            />
          </div>
        )}

        {isExpanded && children.map((child) => renderTreeNode(child))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">WBS Structure</span>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </Button>
        )}
      </div>

      {message && <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-2 text-sm">{message}</div>}

      {forest.length === 0 ? (
        <p className="text-sm text-muted-foreground">No WBS nodes found.</p>
      ) : (
        <div className="rounded border bg-white p-2">
          {forest.map((root) => renderTreeNode(root))}
        </div>
      )}
    </div>
  );
}
