import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/providers/trpc";
import { ChevronRight, ChevronDown, Plus, Pencil, Archive, RotateCcw } from "lucide-react";
import { buildForest, type WbsNode, type TreeNode } from "./wbsTreeModel";

interface WbsTreeProps {
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
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [addingParentId, setAddingParentId] = useState<number | null>(null);
  const [newChildName, setNewChildName] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const createNode = trpc.primaveraLite.createWbsNode.useMutation({
    onSuccess: (res) => {
      onRevisionChange(res.revision);
      setAddingParentId(null);
      setNewChildName("");
      setExpanded((prev) => new Set(prev).add(res.node.parentNodeId ?? res.node.id));
      onRefresh();
    },
  });

  const renameNode = trpc.primaveraLite.renameWbsNode.useMutation({
    onSuccess: (res) => {
      onRevisionChange(res.revision);
      setEditingId(null);
      onRefresh();
    },
  });

  const archiveDryRun = trpc.primaveraLite.archiveWbsNodeDryRun.useMutation();
  const archiveNode = trpc.primaveraLite.archiveWbsNode.useMutation({
    onSuccess: (res) => {
      onRevisionChange(res.revision);
      onRefresh();
    },
  });

  const restoreNode = trpc.primaveraLite.restoreWbsNode.useMutation({
    onSuccess: (res) => {
      onRevisionChange(res.revision);
      onRefresh();
    },
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
    if (!editName.trim()) return;
    renameNode.mutate({
      slug,
      access,
      expectedRevision,
      nodeId,
      name: editName.trim(),
    });
  }

  function startAddChild(parentId: number) {
    setAddingParentId(parentId);
    setNewChildName("");
    setExpanded((prev) => new Set(prev).add(parentId));
  }

  function submitAddChild(parentId: number) {
    if (!newChildName.trim()) return;
    createNode.mutate({
      slug,
      access,
      expectedRevision,
      parentNodeId: parentId,
      name: newChildName.trim(),
    });
  }

  async function handleArchive(nodeId: number) {
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
    restoreNode.mutate({
      slug,
      access,
      expectedRevision,
      nodeId,
      confirmed: true,
    });
  }

  function renderTreeNode(treeNode: TreeNode) {
    const { node, children, depth } = treeNode;
    const isExpanded = expanded.has(node.id);
    const isEditing = editingId === node.id;
    const isAdding = addingParentId === node.id;
    const isArchived = !!node.archivedAt;
    const hasChildren = children.length > 0;

    return (
      <div key={node.id} className="select-none">
        <div
          className={`flex items-center gap-2 py-1 pr-2 hover:bg-slate-100 rounded ${
            isArchived ? "opacity-60" : ""
          }`}
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
        >
          <button
            type="button"
            className="h-5 w-5 flex items-center justify-center text-slate-500"
            onClick={() => toggleExpanded(node.id)}
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
