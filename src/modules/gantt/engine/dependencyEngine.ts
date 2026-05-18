/* ─── Gantt Dependency Engine — MS Project-style FS/SS/FF/SF + Auto-Scheduling ─── */
import { GanttTask, GanttLink, parseDate, addDays, daysBetween, depTypeName } from "./schedulingEngine";

export { depTypeName };

/* Apply a dependency constraint: return required successor planned dates */
export function applyDependency(
  pred: GanttTask,
  succ: GanttTask,
  type: string,
  lag: number
): { plannedStart: string; plannedEnd: string } | null {
  const pStart = parseDate(pred.plannedStart);
  const pEnd = parseDate(pred.plannedEnd);
  if (!pStart || !pEnd) return null;

  let reqStart: Date | null = null;
  let reqEnd: Date | null = null;

  switch (type) {
    case "0": case "FS": // Finish-to-Start
      reqStart = addDays(pEnd, lag);
      break;
    case "1": case "SS": // Start-to-Start
      reqStart = addDays(pStart, lag);
      break;
    case "2": case "FF": // Finish-to-Finish
      reqEnd = addDays(pEnd, lag);
      break;
    case "3": case "SF": // Start-to-Finish
      reqEnd = addDays(pStart, lag);
      break;
  }

  if (!reqStart && !reqEnd) return null;

  const dur = succ.duration || 1;
  if (reqStart && !reqEnd) {
    reqEnd = addDays(reqStart, dur);
  } else if (reqEnd && !reqStart) {
    reqStart = addDays(reqEnd, -dur);
  }

  if (reqStart && reqEnd) {
    return {
      plannedStart: reqStart.toISOString().slice(0, 10),
      plannedEnd: reqEnd.toISOString().slice(0, 10),
    };
  }
  return null;
}

/* Auto-schedule: recalculate successor planned dates from dependencies */
export function autoSchedule(
  tasks: GanttTask[],
  links: GanttLink[],
  changedTaskId?: number
): Map<number, { plannedStart: string; plannedEnd: string }> {
  const taskMap = new Map<number, GanttTask>();
  tasks.forEach(t => taskMap.set(t.id, t));

  const updates = new Map<number, { plannedStart: string; plannedEnd: string }>();
  const visited = new Set<number>();

  // Build adjacency: predecessor → successor links
  const successors = new Map<number, GanttLink[]>();
  links.forEach(lk => {
    if (!successors.has(lk.source)) successors.set(lk.source, []);
    successors.get(lk.source)!.push(lk);
  });

  function visit(taskId: number) {
    if (visited.has(taskId)) return;
    visited.add(taskId);

    const myLinks = successors.get(taskId) || [];
    for (const lk of myLinks) {
      const pred = taskMap.get(lk.source);
      const succ = taskMap.get(lk.target);
      if (!pred || !succ) continue;

      // Use already-updated predecessor dates
      const effPred = updates.has(lk.source)
        ? { ...pred, plannedStart: updates.get(lk.source)!.plannedStart, plannedEnd: updates.get(lk.source)!.plannedEnd }
        : pred;

      const result = applyDependency(effPred, succ, lk.type, lk.lag || 0);
      if (result) {
        const currStart = parseDate(succ.plannedStart);
        const newStart = parseDate(result.plannedStart);
        // Only push successor later (never earlier)
        if (!currStart || !newStart || newStart >= currStart) {
          updates.set(lk.target, result);
          visit(lk.target);
        }
      }
    }
  }

  if (changedTaskId) {
    visit(changedTaskId);
  } else {
    tasks.forEach(t => visit(t.id));
  }

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
