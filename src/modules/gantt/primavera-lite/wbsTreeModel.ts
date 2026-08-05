export interface WbsNode {
  id: number;
  parentNodeId: number | null;
  code: string;
  name: string;
  sortOrder: number;
  isLeaf: boolean;
  archivedAt: Date | string | null;
}

export interface TreeNode {
  node: WbsNode;
  children: TreeNode[];
  depth: number;
}

export function buildForest(nodes: WbsNode[]): TreeNode[] {
  const map = new Map<number, TreeNode>();
  const roots: TreeNode[] = [];
  const sorted = [...nodes].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.id - b.id;
  });
  for (const node of sorted) {
    map.set(node.id, { node, children: [], depth: 0 });
  }
  // Build parent-child links first. Depth cannot be computed in a single pass
  // because a child may be visited before its parent in sort order.
  for (const node of sorted) {
    const treeNode = map.get(node.id)!;
    if (node.parentNodeId === null) {
      roots.push(treeNode);
    } else {
      const parent = map.get(node.parentNodeId);
      if (parent) {
        parent.children.push(treeNode);
      } else {
        roots.push(treeNode);
      }
    }
  }
  // Compute depths via BFS from roots.
  const queue = roots.map((r) => ({ node: r, depth: 0 }));
  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;
    node.depth = depth;
    for (const child of node.children) {
      queue.push({ node: child, depth: depth + 1 });
    }
  }
  return roots;
}
