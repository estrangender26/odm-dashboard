/* ─── Gantt Hierarchy Engine — Indent / Outdent Calculations ─── */

export interface HierarchyResult {
  newParent: number;
  targetTask: any;
  aboveTask?: any;
  oldParentId?: number;
}

/* Calculate indent: find the new parent for a task */
export function calcIndent(taskId: number, allTasks: any[]): HierarchyResult | null {
  const idx = allTasks.findIndex((t: any) => t.id === taskId);
  if (idx <= 0) return null;
  const target = allTasks[idx];
  const above = allTasks[idx - 1];
  if (target.parent === above.id) return null; // Already indented under this task
  const newParent = above.type === "project" || above.parent === 0 ? above.id : above.parent || above.id;
  return { newParent, targetTask: target, aboveTask: above };
}

/* Calculate outdent: find the new parent when moving up a level */
export function calcOutdent(taskId: number, allTasks: any[]): HierarchyResult | null {
  const target = allTasks.find((t: any) => t.id === taskId);
  if (!target) return null;
  if (!target.parent || target.parent === 0) return null; // Already at root
  const parentTask = allTasks.find((t: any) => t.id === target.parent);
  const newParent = parentTask?.parent || 0;
  const oldParentId = target.parent;
  return { newParent, targetTask: target, oldParentId };
}

/* Build save payload for indent/outdent operation */
export function buildHierarchyPayload(target: any, newParent: number): any {
  return {
    id: target.id,
    text: target.text,
    owner: target.owner,
    start_date: target.startDate || null,
    end_date: target.endDate || null,
    planned_start: target.plannedStart || null,
    planned_end: target.plannedEnd || null,
    duration: target.duration || 1,
    progress: target.progress || 0,
    parent: newParent,
    type: target.type || "task",
    status: target.status || null,
    remarks: target.remarks || null,
    category: target.category || null,
    open: target.open ?? 1,
    sortorder: target.sortorder ?? 0,
  };
}
