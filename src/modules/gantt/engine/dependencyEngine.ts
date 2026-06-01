/* ─── Gantt Dependency Engine — MS Project-style FS/SS/FF/SF + Auto-Scheduling ─── */
import { GanttTask, GanttLink, parseDate, addDays, depTypeName } from "./schedulingEngine";

export { depTypeName };

export type DependencyType = "FS" | "SS" | "FF" | "SF" | "NONE";

export interface DependencyScheduleResult {
  plannedStart: string;
  plannedEnd: string;
  duration: number;
  skipped?: false;
}

export interface DependencyScheduleSkip {
  skipped: true;
  reason: string;
}

export type DependencyScheduleOutcome = DependencyScheduleResult | DependencyScheduleSkip;

export function normalizeDependencyType(type?: string | null): DependencyType {
  const typeMap: Record<string, DependencyType> = { "0": "FS", "1": "SS", "2": "FF", "3": "SF" };
  const raw = String(type || "NONE").toUpperCase();
  return typeMap[raw] || (["FS", "SS", "FF", "SF", "NONE"].includes(raw) ? raw as DependencyType : "NONE");
}

export function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function safeDuration(duration?: number | string | null): number {
  const n = typeof duration === "string" ? parseInt(duration, 10) : Number(duration);
  return Math.max(1, Number.isFinite(n) ? n : 1);
}

export function endFromStartAndDuration(start: string, duration?: number | string | null): string {
  const startDate = parseDate(start);
  if (!startDate) return "";
  return formatIsoDate(addDays(startDate, safeDuration(duration) - 1));
}

export function startFromEndAndDuration(end: string, duration?: number | string | null): string {
  const endDate = parseDate(end);
  if (!endDate) return "";
  return formatIsoDate(addDays(endDate, -(safeDuration(duration) - 1)));
}

function taskHasChildren(taskId: number, tasks: Pick<GanttTask, "id" | "parent">[]): boolean {
  return tasks.some(t => t.id !== taskId && t.parent === taskId);
}

/* One canonical dependency date calculator. Relationship logic is independent of hierarchy. */
export function calculateDependencyPlannedDates(input: {
  predecessor?: Pick<GanttTask, "plannedStart" | "plannedEnd"> | null;
  successor?: Pick<GanttTask, "duration" | "plannedStart" | "plannedEnd"> | null;
  type?: string | null;
  lagDays?: number | string | null;
}): DependencyScheduleOutcome {
  const type = normalizeDependencyType(input.type);
  if (type === "NONE") return { skipped: true, reason: "Relationship is None; dependency auto-scheduling is disabled." };
  if (!input.predecessor) return { skipped: true, reason: "Select a predecessor to auto-schedule planned dates." };
  if (!input.successor) return { skipped: true, reason: "Select a successor to auto-schedule planned dates." };

  const predecessorStart = parseDate(input.predecessor.plannedStart);
  const predecessorFinish = parseDate(input.predecessor.plannedEnd);
  const lagDays = Number.isFinite(Number(input.lagDays)) ? Number(input.lagDays) : 0;
  const duration = safeDuration(input.successor.duration);

  let plannedStart: Date | null = null;
  let plannedEnd: Date | null = null;

  switch (type) {
    case "FS":
      if (!predecessorFinish) return { skipped: true, reason: "Predecessor planned finish is required for FS scheduling." };
      plannedStart = addDays(predecessorFinish, lagDays);
      plannedEnd = addDays(plannedStart, duration - 1);
      break;
    case "SS":
      if (!predecessorStart) return { skipped: true, reason: "Predecessor planned start is required for SS scheduling." };
      plannedStart = addDays(predecessorStart, lagDays);
      plannedEnd = addDays(plannedStart, duration - 1);
      break;
    case "FF":
      if (!predecessorFinish) return { skipped: true, reason: "Predecessor planned finish is required for FF scheduling." };
      plannedEnd = addDays(predecessorFinish, lagDays);
      plannedStart = addDays(plannedEnd, -(duration - 1));
      break;
    case "SF":
      if (!predecessorStart) return { skipped: true, reason: "Predecessor planned start is required for SF scheduling." };
      plannedEnd = addDays(predecessorStart, lagDays);
      plannedStart = addDays(plannedEnd, -(duration - 1));
      break;
  }

  return {
    plannedStart: formatIsoDate(plannedStart),
    plannedEnd: formatIsoDate(plannedEnd),
    duration,
  };
}

/* Backward-compatible wrapper: return required successor planned dates or null. */
export function applyDependency(
  pred: GanttTask,
  succ: GanttTask,
  type: string,
  lag: number
): { plannedStart: string; plannedEnd: string } | null {
  const result = calculateDependencyPlannedDates({ predecessor: pred, successor: succ, type, lagDays: lag });
  return result.skipped ? null : { plannedStart: result.plannedStart, plannedEnd: result.plannedEnd };
}

export function wouldCreateDependencyCycle(source: number, target: number, links: Array<Pick<GanttLink, "source" | "target">>): boolean {
  if (!source || !target) return false;
  if (source === target) return true;
  const successors = new Map<number, number[]>();
  links.forEach(link => {
    if (link.source === source && link.target === target) return;
    if (!successors.has(link.source)) successors.set(link.source, []);
    successors.get(link.source)!.push(link.target);
  });

  const stack = [target];
  const seen = new Set<number>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === source) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(successors.get(current) || []));
  }
  return false;
}

/* Auto-schedule: recalculate successor planned dates from dependencies */
export function autoSchedule(
  tasks: GanttTask[],
  links: GanttLink[],
  changedTaskId?: number
): Map<number, { plannedStart: string; plannedEnd: string; duration: number }> {
  const taskMap = new Map<number, GanttTask>();
  tasks.forEach(t => taskMap.set(t.id, t));

  const updates = new Map<number, { plannedStart: string; plannedEnd: string; duration: number }>();

  const successors = new Map<number, GanttLink[]>();
  links.forEach(lk => {
    if (normalizeDependencyType(lk.type) === "NONE") return;
    if (!successors.has(lk.source)) successors.set(lk.source, []);
    successors.get(lk.source)!.push(lk);
  });

  const visiting = new Set<number>();
  const visited = new Set<number>();

  function visit(taskId: number) {
    if (visiting.has(taskId)) return;
    if (visited.has(taskId)) return;
    visiting.add(taskId);

    const myLinks = successors.get(taskId) || [];
    for (const lk of myLinks) {
      const pred = taskMap.get(lk.source);
      const succ = taskMap.get(lk.target);
      if (!pred || !succ) continue;
      if (taskHasChildren(succ.id, tasks)) continue;

      const predUpdate = updates.get(lk.source);
      const effPred = predUpdate ? { ...pred, plannedStart: predUpdate.plannedStart, plannedEnd: predUpdate.plannedEnd } : pred;
      const result = calculateDependencyPlannedDates({ predecessor: effPred, successor: succ, type: lk.type, lagDays: lk.lag || 0 });
      if (!result.skipped) {
        updates.set(lk.target, result);
        visit(lk.target);
      }
    }

    visiting.delete(taskId);
    visited.add(taskId);
  }

  if (changedTaskId) visit(changedTaskId);
  else tasks.forEach(t => visit(t.id));

  return updates;
}

/* Build connector points for SVG dependency lines */
export function buildConnectors(
  links: GanttLink[],
  taskPositions: Map<number, { left: number; width: number; row: number }>,
  headerHeight: number,
  rowHeight: number
): { x1: number; y1: number; x2: number; y2: number; type: string }[] {
  const connectors: { x1: number; y1: number; x2: number; y2: number; type: string }[] = [];
  for (const lk of links) {
    if (normalizeDependencyType(lk.type) === "NONE") continue;
    const from = taskPositions.get(lk.source);
    const to = taskPositions.get(lk.target);
    if (!from || !to) continue;

    const y1 = headerHeight + from.row * rowHeight + rowHeight / 2;
    const y2 = headerHeight + to.row * rowHeight + rowHeight / 2;

    let x1 = from.left + from.width;
    let x2 = to.left;

    if (from.row === to.row) {
      x1 = from.left + from.width;
      x2 = to.left;
    }

    connectors.push({ x1, y1, x2, y2, type: lk.type });
  }
  return connectors;
}
