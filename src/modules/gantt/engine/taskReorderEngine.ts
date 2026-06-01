export type TaskReorderDirection = "up" | "down";

export interface TaskReorderUpdate {
  id: number;
  sort_order: number;
  parent: number;
}

export function getTaskParentId(task: any): number {
  return Number(task?.parent ?? task?.parentTaskId ?? task?.parent_task_id ?? 0) || 0;
}

export function getTaskSortOrder(task: any, fallbackIndex: number): number {
  const raw = task?.sortorder ?? task?.sortOrder ?? task?.sort_order;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallbackIndex;
}

function compareTaskOrder(position: Map<number, number>, originalIndex: Map<number, number>) {
  return (a: any, b: any) => {
    const bySort = (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0);
    if (bySort !== 0) return bySort;
    return (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0);
  };
}

function buildSiblingGroups(tasks: any[]) {
  const position = new Map(tasks.map((task: any, index: number) => [task.id, getTaskSortOrder(task, index)]));
  const originalIndex = new Map(tasks.map((task: any, index: number) => [task.id, index]));
  const taskIds = new Set(tasks.map((task: any) => task.id));
  const childrenByParent = new Map<number, any[]>();

  for (const task of tasks) {
    const parentId = getTaskParentId(task);
    const siblings = childrenByParent.get(parentId) || [];
    siblings.push(task);
    childrenByParent.set(parentId, siblings);
  }

  const byOrder = compareTaskOrder(position, originalIndex);
  for (const siblings of childrenByParent.values()) siblings.sort(byOrder);

  const rootParentIds = Array.from(childrenByParent.keys())
    .filter((parentId) => parentId === 0 || !taskIds.has(parentId))
    .sort((a, b) => {
      const aFirst = childrenByParent.get(a)?.[0];
      const bFirst = childrenByParent.get(b)?.[0];
      return byOrder(aFirst, bFirst);
    });

  return { childrenByParent, position, originalIndex, rootParentIds };
}

export function getSiblingOrderState(tasks: any[], selectedTaskId: number | null) {
  if (!selectedTaskId) return { index: -1, count: 0, parentId: 0, task: null as any | null };
  const selected = tasks.find((task: any) => task.id === selectedTaskId) || null;
  if (!selected) return { index: -1, count: 0, parentId: 0, task: null as any | null };
  const parentId = getTaskParentId(selected);
  const { childrenByParent } = buildSiblingGroups(tasks);
  const siblings = childrenByParent.get(parentId) || [];
  return { index: siblings.findIndex((task: any) => task.id === selectedTaskId), count: siblings.length, parentId, task: selected };
}

export function buildManualHierarchyOrder(tasks: any[], selectedTaskId: number, direction: TaskReorderDirection): TaskReorderUpdate[] | null {
  const selected = tasks.find((task: any) => task.id === selectedTaskId);
  if (!selected) return null;

  const selectedParentId = getTaskParentId(selected);
  const { childrenByParent, position, originalIndex, rootParentIds } = buildSiblingGroups(tasks);
  const siblings = childrenByParent.get(selectedParentId) || [];
  const selectedIndex = siblings.findIndex((task: any) => task.id === selectedTaskId);
  const swapIndex = direction === "up" ? selectedIndex - 1 : selectedIndex + 1;
  if (selectedIndex < 0 || swapIndex < 0 || swapIndex >= siblings.length) return null;

  /* Only swap the selected task with its direct adjacent visible sibling. Do not
     touch parent IDs, WBS levels, indent/outdent state, or dependencies. */
  [siblings[selectedIndex], siblings[swapIndex]] = [siblings[swapIndex], siblings[selectedIndex]];
  childrenByParent.set(selectedParentId, siblings);

  const ordered: any[] = [];
  const seen = new Set<number>();
  const walk = (parentId: number) => {
    for (const task of childrenByParent.get(parentId) || []) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      ordered.push(task);
      walk(task.id);
    }
  };

  for (const parentId of rootParentIds) walk(parentId);

  for (const task of [...tasks].sort(compareTaskOrder(position, originalIndex))) {
    if (!seen.has(task.id)) {
      seen.add(task.id);
      ordered.push(task);
    }
  }

  return ordered.map((task, index) => ({
    id: task.id,
    sort_order: index + 1,
    parent: getTaskParentId(task),
  }));
}
