import type { GanttDependencyInput } from "@contracts/gantt";

export class GanttDomainError extends Error {
  readonly code: "ACCESS_DENIED" | "INVALID_HIERARCHY" | "INVALID_DEPENDENCY" | "CONFLICT";

  constructor(
    message: string,
    code: "ACCESS_DENIED" | "INVALID_HIERARCHY" | "INVALID_DEPENDENCY" | "CONFLICT",
  ) {
    super(message);
    this.code = code;
    this.name = "GanttDomainError";
  }
}

export type GanttHierarchyNode = { id: number; parentId: number | null };

export function validateHierarchyAssignment(
  nodes: GanttHierarchyNode[],
  taskId: number,
  parentId: number | null,
): void {
  if (!parentId) return;
  if (taskId === parentId) {
    throw new GanttDomainError("A task cannot be its own parent.", "INVALID_HIERARCHY");
  }
  const nodeIds = new Set(nodes.map(node => node.id));
  if (!nodeIds.has(parentId)) {
    throw new GanttDomainError("Parent task is unavailable in this project.", "INVALID_HIERARCHY");
  }

  const parentById = new Map(nodes.map(node => [node.id, node.parentId]));
  const visited = new Set<number>();
  let current: number | null = parentId;
  while (current) {
    if (current === taskId) {
      throw new GanttDomainError(
        "A task cannot be moved under one of its descendants.",
        "INVALID_HIERARCHY",
      );
    }
    if (visited.has(current)) {
      throw new GanttDomainError("The proposed hierarchy contains a cycle.", "INVALID_HIERARCHY");
    }
    visited.add(current);
    current = parentById.get(current) ?? null;
  }
}

export function validateDependencyGraph(
  taskIds: Iterable<number>,
  dependencies: Array<Pick<GanttDependencyInput, "predecessorTaskId" | "successorTaskId">>,
): void {
  const validTaskIds = new Set(taskIds);
  const uniqueEdges = new Set<string>();
  const successors = new Map<number, number[]>();

  for (const dependency of dependencies) {
    const { predecessorTaskId, successorTaskId } = dependency;
    if (!validTaskIds.has(predecessorTaskId) || !validTaskIds.has(successorTaskId)) {
      throw new GanttDomainError(
        "Dependency tasks must exist in the same accessible project.",
        "INVALID_DEPENDENCY",
      );
    }
    if (predecessorTaskId === successorTaskId) {
      throw new GanttDomainError("A task cannot depend on itself.", "INVALID_DEPENDENCY");
    }
    const key = `${predecessorTaskId}:${successorTaskId}`;
    if (uniqueEdges.has(key)) {
      throw new GanttDomainError("Duplicate dependencies are not allowed.", "INVALID_DEPENDENCY");
    }
    uniqueEdges.add(key);
    const targets = successors.get(predecessorTaskId) ?? [];
    targets.push(successorTaskId);
    successors.set(predecessorTaskId, targets);
  }

  const state = new Map<number, "visiting" | "visited">();
  const visit = (taskId: number): void => {
    const currentState = state.get(taskId);
    if (currentState === "visiting") {
      throw new GanttDomainError("Dependency cycle detected.", "INVALID_DEPENDENCY");
    }
    if (currentState === "visited") return;
    state.set(taskId, "visiting");
    for (const successorId of successors.get(taskId) ?? []) visit(successorId);
    state.set(taskId, "visited");
  };
  for (const taskId of validTaskIds) visit(taskId);
}

export function collectDescendantIds(nodes: GanttHierarchyNode[], rootId: number): number[] {
  const children = new Map<number, number[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const ids = children.get(node.parentId) ?? [];
    ids.push(node.id);
    children.set(node.parentId, ids);
  }
  const result = new Set<number>();
  const stack = [rootId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (result.has(current)) continue;
    result.add(current);
    stack.push(...(children.get(current) ?? []));
  }
  return Array.from(result);
}
