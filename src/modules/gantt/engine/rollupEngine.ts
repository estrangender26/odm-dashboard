/* ─── Gantt Rollup Engine — Bottom-up Parent Auto-Calculation ─── */
import type { GanttTask } from "./schedulingEngine";
import { daysBetween, normProgress, deriveStatus } from "./schedulingEngine";

export interface RollupResult {
  task: GanttTask;
  changed: boolean;
}

/* Recalculate all parent rollups — bottom-up through full descendant tree */
export function recalculateParentRollups(allTasks: GanttTask[]): GanttTask[] {
  const childMap = new Map<number, GanttTask[]>();
  allTasks.forEach(t => {
    if (!childMap.has(t.parent ?? -1)) childMap.set(t.parent ?? -1, []);
    childMap.get(t.parent ?? -1)!.push(t);
  });

  function getDescendants(taskId: number): GanttTask[] {
    const direct = childMap.get(taskId) || [];
    let result = [...direct];
    direct.forEach(c => { result = result.concat(getDescendants(c.id)); });
    return result;
  }

  let changed = false;
  const result = allTasks.map(t => ({ ...t }));

  result.forEach(parent => {
    const descendants = getDescendants(parent.id);
    if (descendants.length === 0) return;

    const directChildren = childMap.get(parent.id) || [];

    // ── Planned dates ──
    const pStarts = descendants.map(c => c.plannedStart || c.startDate).filter(Boolean);
    const pEnds = descendants.map(c => c.plannedEnd || c.endDate).filter(Boolean);
    const newPStart = pStarts.length > 0
      ? new Date(Math.min(...pStarts.map(s => new Date(s!).getTime()))).toISOString().slice(0, 10)
      : parent.plannedStart;
    const newPEnd = pEnds.length > 0
      ? new Date(Math.max(...pEnds.map(s => new Date(s!).getTime()))).toISOString().slice(0, 10)
      : parent.plannedEnd;

    // ── Actual dates ──
    const aStarts = descendants.map(c => c.startDate).filter(Boolean);
    const aEnds = descendants.map(c => c.endDate).filter(Boolean);
    const newAStart = aStarts.length > 0
      ? new Date(Math.min(...aStarts.map(s => new Date(s!).getTime()))).toISOString().slice(0, 10)
      : parent.startDate;
    const newAEnd = aEnds.length > 0
      ? new Date(Math.max(...aEnds.map(s => new Date(s!).getTime()))).toISOString().slice(0, 10)
      : parent.endDate;

    // ── Duration ──
    let newDuration = parent.duration || 1;
    if (newPStart && newPEnd) {
      const d = daysBetween(new Date(newPStart), new Date(newPEnd));
      if (d > 0) newDuration = d;
    }

    // ── Progress: weighted average by child duration ──
    const childrenWithDur = directChildren.filter(c => (c.duration || 1) > 0);
    const totalChildDur = childrenWithDur.reduce((sum, c) => sum + (c.duration || 1), 0);
    let newProgress = parent.progress || 0;
    if (totalChildDur > 0) {
      const weighted = childrenWithDur.reduce((sum, c) => {
        const childDur = c.duration || 1;
        const childProg = normProgress(c.progress);
        return sum + (childProg * childDur);
      }, 0);
      newProgress = Math.round(weighted / totalChildDur);
    }

    // ── Status ──
    const childStatuses = directChildren.map(c => c.status || deriveStatus(c));
    let newStatus: string;
    if (childStatuses.every(s => s === "Completed")) newStatus = "Completed";
    else if (childStatuses.some(s => s === "In Progress (Delayed)")) newStatus = "In Progress (Delayed)";
    else if (childStatuses.some(s => s === "In Progress")) newStatus = "In Progress";
    else newStatus = "Not Started";

    // Apply changes
    if (newPStart && newPStart !== parent.plannedStart) { parent.plannedStart = newPStart; changed = true; }
    if (newPEnd && newPEnd !== parent.plannedEnd) { parent.plannedEnd = newPEnd; changed = true; }
    if (newAStart && newAStart !== parent.startDate) { parent.startDate = newAStart; changed = true; }
    if (newAEnd && newAEnd !== parent.endDate) { parent.endDate = newAEnd; changed = true; }
    if (newDuration !== parent.duration) { parent.duration = newDuration; changed = true; }
    if (newProgress !== normProgress(parent.progress)) { parent.progress = newProgress; changed = true; }
    if (newStatus !== (parent.status || "Not Started")) { parent.status = newStatus; changed = true; }
  });

  return changed ? result : allTasks;
}

/* Get list of changed parents after rollup */
export function getChangedParents(rolled: GanttTask[], original: GanttTask[]): GanttTask[] {
  return rolled.filter(t => {
    const orig = original.find(o => o.id === t.id);
    if (!orig) return false;
    return t.plannedStart !== orig.plannedStart ||
      t.plannedEnd !== orig.plannedEnd ||
      t.startDate !== orig.startDate ||
      t.endDate !== orig.endDate ||
      t.duration !== orig.duration ||
      t.progress !== orig.progress ||
      t.status !== orig.status;
  });
}
