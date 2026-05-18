/* ─── Gantt Parent Engine — Auto-calculate parent bars from children ─── */
import { parseDate, daysBetween, normProgress, deriveStatus } from "./schedulingEngine";

export interface ParentCalc {
  plannedStart: string;
  plannedEnd: string;
  startDate: string;
  endDate: string;
  duration: number;
  progress: number;
  status: string;
}

/* Check if a task is a parent (has children) */
export function isParent(taskId: number, allTasks: any[]): boolean {
  return allTasks.some((t: any) => t.parent === taskId && t.id !== taskId);
}

/* Get direct children of a task */
export function getChildren(taskId: number, allTasks: any[]): any[] {
  return allTasks.filter((t: any) => t.parent === taskId && t.id !== taskId);
}

/* Calculate parent values from children */
export function calculateParentFromChildren(parent: any, allTasks: any[]): ParentCalc {
  const children = getChildren(parent.id, allTasks);
  if (children.length === 0) {
    return {
      plannedStart: parent.plannedStart || "",
      plannedEnd: parent.plannedEnd || "",
      startDate: parent.startDate || "",
      endDate: parent.endDate || "",
      duration: parent.duration || 1,
      progress: normProgress(parent.progress),
      status: parent.status || "Planned",
    };
  }

  /* Collect child dates */
  const plannedStarts: Date[] = [];
  const plannedEnds: Date[] = [];
  const actualStarts: Date[] = [];
  const actualEnds: Date[] = [];
  let totalDuration = 0;
  let weightedProgress = 0;
  let completedCount = 0;
  let inProgressCount = 0;
  let delayedCount = 0;
  let notStartedCount = 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);

  for (const child of children) {
    const ps = parseDate(child.plannedStart);
    const pe = parseDate(child.plannedEnd);
    const as = parseDate(child.startDate);
    const ae = parseDate(child.endDate);
    const dur = child.duration || 1;
    const prog = normProgress(child.progress);
    const st = (child.status || "").toLowerCase();

    if (ps) plannedStarts.push(ps);
    if (pe) plannedEnds.push(pe);
    if (as) actualStarts.push(as);
    if (ae) actualEnds.push(ae);

    totalDuration += dur;
    weightedProgress += prog * dur;

    if (st.includes("complete")) completedCount++;
    else if (st.includes("delayed")) delayedCount++;
    else if (st.includes("progress")) inProgressCount++;
    else notStartedCount++;
  }

  /* ── PLANNED dates (from all children) ── */
  const minPlannedStart = plannedStarts.length > 0
    ? new Date(Math.min(...plannedStarts.map(d => d.getTime()))) : null;
  const maxPlannedEnd = plannedEnds.length > 0
    ? new Date(Math.max(...plannedEnds.map(d => d.getTime()))) : null;

  /* ── ACTUAL dates (from child actuals ONLY — no fallback to planned) ── */
  let minActualStart: Date | null = actualStarts.length > 0
    ? new Date(Math.min(...actualStarts.map(d => d.getTime()))) : null;
  let maxActualEnd: Date | null = null;

  if (actualEnds.length > 0) {
    /* Some children have actual finish — use latest */
    maxActualEnd = new Date(Math.max(...actualEnds.map(d => d.getTime())));
  } else if (actualStarts.length > 0 && inProgressCount > 0) {
    /* No child has actual finish, but some are in progress —
       extend actual to "current progress point" = today or latest child's progress endpoint */
    let latestProgressEnd = today;
    for (const child of children) {
      const as = parseDate(child.startDate);
      if (!as) continue;
      const dur = child.duration || 1;
      const prog = normProgress(child.progress);
      /* Progress endpoint = actual start + (duration * progress%) */
      const progressMs = as.getTime() + (dur * prog / 100) * 86400000;
      if (progressMs > latestProgressEnd.getTime()) latestProgressEnd = new Date(progressMs);
    }
    maxActualEnd = latestProgressEnd;
  }
  /* If no child has actual start → minActualStart stays null → no actual bar rendered */

  const fmt = (d: Date | null): string => {
    if (!d) return "";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const plannedStartStr = fmt(minPlannedStart);
  const plannedEndStr = fmt(maxPlannedEnd);
  /* Actual dates: ONLY from child actuals — NO fallback to planned */
  const startDateStr = fmt(minActualStart);
  const endDateStr = fmt(maxActualEnd);

  const duration = (minPlannedStart && maxPlannedEnd)
    ? Math.max(1, daysBetween(minPlannedStart, maxPlannedEnd))
    : totalDuration;

  const progress = totalDuration > 0 ? Math.round(weightedProgress / totalDuration) : 0;

  /* Derive status from children */
  let status: string;
  if (completedCount === children.length) status = "Completed";
  else if (delayedCount > 0) status = "Delayed";
  else if (inProgressCount > 0) status = "In Progress";
  else status = "Planned";

  return {
    plannedStart: plannedStartStr,
    plannedEnd: plannedEndStr,
    startDate: startDateStr,
    endDate: endDateStr,
    duration,
    progress,
    status,
  };
}

/* Recalculate ALL parent tasks in a tree */
export function recalculateAllParents(allTasks: any[]): any[] {
  const result = allTasks.map((t: any) => ({ ...t }));
  const parentIds = new Set<number>();
  for (const t of result) {
    if (isParent(t.id, result)) parentIds.add(t.id);
  }

  // Process parents bottom-up (deepest first) so grandparents get correct grandchild dates
  const processed = new Set<number>();
  const processParent = (pid: number) => {
    if (processed.has(pid)) return;
    const p = result.find((t: any) => t.id === pid);
    if (!p) return;

    // First process any child that is also a parent
    const children = getChildren(pid, result);
    for (const child of children) {
      if (isParent(child.id, result)) processParent(child.id);
    }

    const calc = calculateParentFromChildren(p, result);
    p.plannedStart = calc.plannedStart;
    p.plannedEnd = calc.plannedEnd;
    p.startDate = calc.startDate;
    p.endDate = calc.endDate;
    p.duration = calc.duration;
    p.progress = calc.progress;
    p.status = calc.status;
    p.type = "project"; // mark as summary/parent
    processed.add(pid);
  };

  for (const pid of parentIds) processParent(pid);
  return result;
}

/* Get changed parents after recalculation */
export function getChangedParents(recalculated: any[], original: any[]): any[] {
  const changed: any[] = [];
  for (const r of recalculated) {
    const orig = original.find((o: any) => o.id === r.id);
    if (!orig) continue;
    const isParent = r.type === "project" || isParent(r.id, recalculated);
    if (!isParent) continue;
    const datesChanged =
      r.plannedStart !== orig.plannedStart ||
      r.plannedEnd !== orig.plannedEnd ||
      r.startDate !== orig.startDate ||
      r.endDate !== orig.endDate ||
      r.duration !== orig.duration ||
      r.progress !== orig.progress ||
      r.status !== orig.status;
    if (datesChanged) changed.push(r);
  }
  return changed;
}

/* Parent bar visual style */
export function parentBarStyle(): {
  plannedColor: string; actualColor: string; borderColor: string;
  height: number; borderWidth: number; borderRadius: number;
} {
  return {
    plannedColor: "rgba(30,64,175,0.25)",
    actualColor: "rgba(30,64,175,0.6)",
    borderColor: "#1E3A8F",
    height: 20,
    borderWidth: 2,
    borderRadius: 4,
  };
}

/* Check if a field is editable for a given task */
export function isFieldEditable(task: any, allTasks: any[], field: "dates" | "duration" | "progress" | "name" | "owner" | "parent" | "predecessor" | "status" | "remarks"): boolean {
  const hasChildren = isParent(task?.id ?? 0, allTasks);
  if (!hasChildren) return true; // normal task — all fields editable

  // Parent task — only certain fields editable
  switch (field) {
    case "name":
    case "owner":
    case "parent":
    case "predecessor":
    case "status":
    case "remarks":
      return true;
    case "dates":
    case "duration":
    case "progress":
      return false; // auto-calculated
    default:
      return true;
  }
}
