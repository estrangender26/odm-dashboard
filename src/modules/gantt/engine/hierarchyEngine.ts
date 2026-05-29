/* ─── Gantt Hierarchy Engine — Indent / Outdent / WBS Level ─── */

export interface HierarchyResult {
  newParent: number;
  targetTask: any;
  aboveTask?: any;
  oldParentId?: number;
}

export interface HierarchyValidation {
  valid: boolean;
  message?: string;
}

const taskParent = (task: any): number => Number(task?.parent ?? task?.parentTaskId ?? task?.parent_task_id ?? 0) || 0;
const taskUid = (task: any): string => task?.frontendTaskUid || task?.frontend_task_uid || "";

function findTask(taskId: number, allTasks: any[]): any | undefined {
  return allTasks.find((t: any) => t.id === taskId);
}

export function getAncestorIds(taskId: number, allTasks: any[]): Set<number> {
  const ancestors = new Set<number>();
  let current = taskParent(findTask(taskId, allTasks));
  while (current > 0) {
    if (ancestors.has(current)) break;
    ancestors.add(current);
    current = taskParent(findTask(current, allTasks));
  }
  return ancestors;
}

export function getDescendantIds(taskId: number, allTasks: any[]): Set<number> {
  const descendants = new Set<number>();
  const stack = allTasks.filter((t: any) => taskParent(t) === taskId).map((t: any) => t.id);
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (descendants.has(current)) continue;
    descendants.add(current);
    allTasks.forEach((t: any) => {
      if (taskParent(t) === current) stack.push(t.id);
    });
  }
  return descendants;
}

export function wouldCreateHierarchyCycle(taskId: number, newParent: number, allTasks: any[]): boolean {
  if (newParent <= 0) return false;
  if (taskId === newParent) return true;
  return getDescendantIds(taskId, allTasks).has(newParent);
}

export function validateParentAssignment(taskId: number, newParent: number, allTasks: any[]): HierarchyValidation {
  const target = findTask(taskId, allTasks);
  if (!target) return { valid: false, message: "Selected task no longer exists." };
  if (newParent < 0) return { valid: false, message: "Invalid parent assignment." };
  if (newParent > 0 && !findTask(newParent, allTasks)) return { valid: false, message: "Target parent no longer exists." };
  if (taskId === newParent) return { valid: false, message: "A task cannot be its own parent." };
  if (wouldCreateHierarchyCycle(taskId, newParent, allTasks)) {
    return { valid: false, message: "Invalid hierarchy change: a task cannot be moved under its own descendant." };
  }
  return { valid: true };
}

/* Compute WBS level from parent chain (1 = root, 2 = child, 3 = grandchild, ...) */
export function computeWbsLevel(taskId: number, allTasks: any[], parentId?: number): number {
  const effectiveParent = parentId !== undefined ? parentId : taskParent(findTask(taskId, allTasks));
  if (effectiveParent <= 0) return 1; // Root level
  let level = 1;
  let current = effectiveParent;
  const visited = new Set<number>();
  while (current > 0 && level < 20) {
    if (visited.has(current)) break; // Cycle guard
    visited.add(current);
    level++;
    const parent = findTask(current, allTasks);
    current = taskParent(parent);
  }
  return level;
}

/* Recompute WBS levels for all tasks after one or more hierarchy edits. */
export function computeWbsLevelMap(allTasks: any[]): Map<number, number> {
  const levels = new Map<number, number>();
  allTasks.forEach((t: any) => levels.set(t.id, computeWbsLevel(t.id, allTasks)));
  return levels;
}

/* Calculate indent: find the new parent for a task */
export function calcIndent(taskId: number, allTasks: any[]): HierarchyResult | null {
  const idx = allTasks.findIndex((t: any) => t.id === taskId);
  if (idx <= 0) return null;
  const target = allTasks[idx];
  const above = allTasks[idx - 1];
  if (taskParent(target) === above.id) return null; // Already indented under this task
  const newParent = above.id;
  const validation = validateParentAssignment(taskId, newParent, allTasks);
  if (!validation.valid) return null;
  return { newParent, targetTask: target, aboveTask: above, oldParentId: taskParent(target) };
}

/* Calculate outdent: find the new parent when moving up a level */
export function calcOutdent(taskId: number, allTasks: any[]): HierarchyResult | null {
  const target = findTask(taskId, allTasks);
  if (!target) return null;
  const oldParentId = taskParent(target);
  if (!oldParentId) return null; // Already at root
  const parentTask = findTask(oldParentId, allTasks);
  const newParent = taskParent(parentTask);
  const validation = validateParentAssignment(taskId, newParent, allTasks);
  if (!validation.valid) return null;
  return { newParent, targetTask: target, oldParentId };
}

/* Build save payload for indent/outdent operation.
   IMPORTANT: hierarchy edits are intentionally kept separate from scheduling dependencies.
   Do not include predecessor/dependency fields here. */
export function buildHierarchyPayload(target: any, newParent: number, allTasks?: any[]): any {
  const parentTask = allTasks?.find((t: any) => t.id === newParent);
  const nextTasks = allTasks
    ? allTasks.map((t: any) => t.id === target.id ? { ...t, parent: newParent, parentTaskId: newParent } : t)
    : undefined;
  const wbsLevel = nextTasks ? computeWbsLevel(target.id, nextTasks, newParent) : (newParent > 0 ? 2 : 1);
  return {
    id: target.id,
    parent: newParent,
    parent_task_id: newParent,
    wbs_level: wbsLevel,
    parent_frontend_uid: parentTask ? taskUid(parentTask) || null : null,
  };
}
