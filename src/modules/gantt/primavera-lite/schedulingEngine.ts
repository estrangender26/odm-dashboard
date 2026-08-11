/**
 * Pure server module for Primavera Lite Critical Path Method (CPM) Scheduling Engine.
 *
 * Implements:
 * - Working-day calendar arithmetic (with custom working days & exceptions)
 * - FS / SS / FF / SF dependencies with positive / zero / negative lag
 * - Forward pass (Early Start / Early Finish)
 * - Backward pass (Late Start / Late Finish)
 * - Total float and Free float calculation
 * - Critical activity / Critical path identification
 * - Milestones (0-duration activities)
 * - Open ends (default start at Data Date / default finish at Project Finish)
 * - Data Date handling & basic progress-aware scheduling
 * - Graph cycle detection
 */

export interface ScheduleActivityInput {
  id: number;
  wbsNodeId: number;
  activityName: string;
  activityType?: string | null; // "task" | "milestone" | string
  calendarId?: number | null;
  originalDurationDays: number;
  remainingDurationDays?: number;
  plannedStart?: string | null; // YYYY-MM-DD
  plannedFinish?: string | null;
  earlyStart?: string | null;
  earlyFinish?: string | null;
  lateStart?: string | null;
  lateFinish?: string | null;
  totalFloatDays?: number;
  freeFloatDays?: number;
  actualStart?: string | null;
  actualFinish?: string | null;
  percentComplete?: number;
  status?: string | null;
  sortOrder?: number;
}

export interface ScheduleDependencyInput {
  id: number;
  predecessorActivityId: number;
  successorActivityId: number;
  dependencyType: "FS" | "SS" | "FF" | "SF" | string;
  lagDays: number;
}

export interface ScheduleCalendarInput {
  id: number;
  name: string;
  workingDays: number[]; // 1=Mon .. 5=Fri, 6=Sat, 0 or 7=Sun
  hoursPerDay?: string | number;
  timezone?: string;
  exceptions?: Array<{
    exceptionDate: string; // YYYY-MM-DD
    isWorking: boolean;
  }>;
}

export interface ScheduledActivityOutput {
  id: number;
  earlyStart: string; // YYYY-MM-DD
  earlyFinish: string;
  lateStart: string;
  lateFinish: string;
  totalFloatDays: number;
  freeFloatDays: number;
  isCritical: boolean;
}

const REF_UTC_MS = Date.UTC(2000, 0, 3); // 2000-01-03 is a Monday (epoch)
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BASE_CAL_DAY = -10000; // ~1972
const MAX_CAL_DAY = 30000;   // ~2082
const RANGE_SIZE = MAX_CAL_DAY - BASE_CAL_DAY + 1;

interface CalendarIndexCache {
  nextWorkIdx: Int32Array;
  prevWorkIdx: Int32Array;
  workToCalDay: Int32Array;
}

const calendarCache = new WeakMap<ScheduleCalendarInput, CalendarIndexCache>();

function isValidISOString(dateStr: string | null | undefined): boolean {
  if (!dateStr || typeof dateStr !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim());
}

function dateToCalendarDay(dateStr: string): number {
  const trimmed = dateStr.trim();
  const [y, m, d] = trimmed.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d);
  return Math.round((utc - REF_UTC_MS) / MS_PER_DAY);
}

function calendarDayToDate(calDay: number): string {
  const utc = REF_UTC_MS + calDay * MS_PER_DAY;
  const dt = new Date(utc);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeWorkingDays(workingDays: number[]): Set<number> {
  const set = new Set<number>();
  if (!workingDays || workingDays.length === 0) {
    // Default Mon-Fri
    for (const d of [1, 2, 3, 4, 5]) set.add(d);
    return set;
  }
  for (const d of workingDays) {
    if (d === 7) set.add(0);
    else set.add(d);
  }
  return set;
}

function isWorkingDayOnCalendar(calDay: number, workingSet: Set<number>, exMap: Map<number, boolean>): boolean {
  if (exMap.has(calDay)) {
    return exMap.get(calDay)!;
  }
  // Compute JS day of week (0=Sun, 1=Mon .. 6=Sat)
  // calDay 0 is Monday (1)
  const jsDay = (((calDay + 1) % 7) + 7) % 7;
  return workingSet.has(jsDay);
}

function getCalendarCache(cal: ScheduleCalendarInput): CalendarIndexCache {
  let cached = calendarCache.get(cal);
  if (cached) return cached;

  const workingSet = normalizeWorkingDays(cal.workingDays);
  const exMap = new Map<number, boolean>();
  if (cal.exceptions && cal.exceptions.length > 0) {
    for (const ex of cal.exceptions) {
      if (isValidISOString(ex.exceptionDate)) {
        exMap.set(dateToCalendarDay(ex.exceptionDate), ex.isWorking);
      }
    }
  }

  const nextWorkIdx = new Int32Array(RANGE_SIZE);
  const prevWorkIdx = new Int32Array(RANGE_SIZE);
  const workToCalDay = new Int32Array(RANGE_SIZE);

  let workCount = 0;
  for (let idx = 0; idx < RANGE_SIZE; idx++) {
    const calDay = BASE_CAL_DAY + idx;
    if (isWorkingDayOnCalendar(calDay, workingSet, exMap)) {
      workToCalDay[workCount] = calDay;
      workCount++;
    }
  }

  let nextPtr = 0;
  for (let idx = 0; idx < RANGE_SIZE; idx++) {
    const calDay = BASE_CAL_DAY + idx;
    while (nextPtr < workCount && workToCalDay[nextPtr] < calDay) {
      nextPtr++;
    }
    const safeNext = nextPtr < workCount ? nextPtr : workCount - 1;
    nextWorkIdx[idx] = safeNext;
  }

  let prevPtr = 0;
  for (let idx = 0; idx < RANGE_SIZE; idx++) {
    const calDay = BASE_CAL_DAY + idx;
    while (prevPtr + 1 < workCount && workToCalDay[prevPtr + 1] <= calDay) {
      prevPtr++;
    }
    prevWorkIdx[idx] = prevPtr;
  }

  cached = { nextWorkIdx, prevWorkIdx, workToCalDay };
  calendarCache.set(cal, cached);
  return cached;
}

export function toWorkingDayIndex(
  dateStr: string | null | undefined,
  cal: ScheduleCalendarInput,
  mode: "next" | "prev" = "next"
): number {
  if (!isValidISOString(dateStr)) return 0;
  const calDay = dateToCalendarDay(dateStr!);
  const cache = getCalendarCache(cal);
  const offset = Math.max(0, Math.min(RANGE_SIZE - 1, calDay - BASE_CAL_DAY));
  return mode === "next" ? cache.nextWorkIdx[offset] : cache.prevWorkIdx[offset];
}

export function fromWorkingDayIndex(workIdx: number, cal: ScheduleCalendarInput): string {
  const cache = getCalendarCache(cal);
  const safeIdx = Math.max(0, Math.min(cache.workToCalDay.length - 1, workIdx));
  const calDay = cache.workToCalDay[safeIdx];
  return calendarDayToDate(calDay);
}

export function getWorkingDuration(act: ScheduleActivityInput): number {
  if (act.activityType?.toLowerCase() === "milestone") return 0;
  if (act.percentComplete === 100 || act.status?.toLowerCase() === "completed") return 0;
  if (
    act.remainingDurationDays !== undefined &&
    act.remainingDurationDays !== null &&
    act.remainingDurationDays >= 0
  ) {
    if (act.percentComplete && act.percentComplete > 0) {
      return act.remainingDurationDays;
    }
    if (act.remainingDurationDays > 0) {
      return act.remainingDurationDays;
    }
  }
  if (
    act.originalDurationDays !== undefined &&
    act.originalDurationDays !== null &&
    act.originalDurationDays >= 0
  ) {
    const orig = act.originalDurationDays;
    if (act.percentComplete && act.percentComplete > 0 && act.percentComplete < 100) {
      return Math.max(1, Math.round(orig * (1 - act.percentComplete / 100)));
    }
    return orig;
  }
  return 1;
}

export function topologicalSort(
  activities: ScheduleActivityInput[],
  dependencies: ScheduleDependencyInput[]
): ScheduleActivityInput[] {
  const inDegree = new Map<number, number>();
  const adj = new Map<number, number[]>();
  const actMap = new Map<number, ScheduleActivityInput>();

  for (const act of activities) {
    inDegree.set(act.id, 0);
    adj.set(act.id, []);
    actMap.set(act.id, act);
  }

  for (const dep of dependencies) {
    if (!actMap.has(dep.predecessorActivityId) || !actMap.has(dep.successorActivityId)) continue;
    if (dep.predecessorActivityId === dep.successorActivityId) {
      throw new Error("Circular dependency detected in schedule");
    }
    adj.get(dep.predecessorActivityId)!.push(dep.successorActivityId);
    inDegree.set(dep.successorActivityId, (inDegree.get(dep.successorActivityId) || 0) + 1);
  }

  const queue: number[] = [];
  const zeroDeg = Array.from(actMap.values())
    .filter((a) => (inDegree.get(a.id) || 0) === 0)
    .sort((a, b) => (a.wbsNodeId - b.wbsNodeId) || ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || (a.id - b.id));

  for (const a of zeroDeg) {
    queue.push(a.id);
  }

  const order: ScheduleActivityInput[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    const act = actMap.get(u)!;
    order.push(act);

    const neighbors = (adj.get(u) || []).slice().sort((a, b) => a - b);
    for (const v of neighbors) {
      const d = (inDegree.get(v) || 0) - 1;
      inDegree.set(v, d);
      if (d === 0) {
        queue.push(v);
        queue.sort((aId, bId) => {
          const a = actMap.get(aId)!;
          const b = actMap.get(bId)!;
          return (a.wbsNodeId - b.wbsNodeId) || ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || (a.id - b.id);
        });
      }
    }
  }

  if (order.length < activities.length) {
    throw new Error("Circular dependency detected in schedule");
  }
  return order;
}

export function resolveDefaultCalendar(
  calendars: ScheduleCalendarInput[],
  defaultCalendarId?: number | null
): ScheduleCalendarInput {
  if (defaultCalendarId != null) {
    const found = calendars.find((c) => c.id === defaultCalendarId);
    if (found) return found;
  }
  if (calendars.length > 0) return calendars[0];
  return {
    id: 0,
    name: "Default Calendar",
    workingDays: [1, 2, 3, 4, 5],
    hoursPerDay: "8.00",
    timezone: "Asia/Manila",
  };
}

export function runScheduleEngine(
  projectDataDate: string | null | undefined,
  calendars: ScheduleCalendarInput[],
  defaultCalendarId: number | null | undefined,
  activities: ScheduleActivityInput[],
  dependencies: ScheduleDependencyInput[]
): ScheduledActivityOutput[] {
  if (activities.length === 0) return [];

  const defaultCal = resolveDefaultCalendar(calendars, defaultCalendarId);
  const calMap = new Map<number, ScheduleCalendarInput>();
  for (const c of calendars) {
    calMap.set(c.id, c);
  }

  const actMap = new Map<number, ScheduleActivityInput>();
  for (const act of activities) {
    actMap.set(act.id, act);
  }

  // 1. Validate against cycles and determine topological processing order
  const order = topologicalSort(activities, dependencies);

  // 2. Determine default project reference Data Date index
  let defaultDateStr = "2026-08-11";
  if (isValidISOString(projectDataDate)) {
    defaultDateStr = projectDataDate!.trim();
  } else {
    // Earliest planned start among activities if available
    let earliest: string | null = null;
    for (const act of activities) {
      if (isValidISOString(act.plannedStart)) {
        if (!earliest || act.plannedStart! < earliest) {
          earliest = act.plannedStart!.trim();
        }
      }
    }
    if (earliest) defaultDateStr = earliest;
  }

  const ES_map = new Map<number, number>();
  const EF_map = new Map<number, number>();
  const LS_map = new Map<number, number>();
  const LF_map = new Map<number, number>();

  // Build incoming/outgoing adjacency maps
  const incomingMap = new Map<number, ScheduleDependencyInput[]>();
  const outgoingMap = new Map<number, ScheduleDependencyInput[]>();
  for (const act of activities) {
    incomingMap.set(act.id, []);
    outgoingMap.set(act.id, []);
  }
  for (const dep of dependencies) {
    if (!actMap.has(dep.predecessorActivityId) || !actMap.has(dep.successorActivityId)) continue;
    incomingMap.get(dep.successorActivityId)!.push(dep);
    outgoingMap.get(dep.predecessorActivityId)!.push(dep);
  }

  // 3. Forward Pass (ES & EF)
  for (const act of order) {
    const cal = act.calendarId != null && calMap.has(act.calendarId) ? calMap.get(act.calendarId)! : defaultCal;
    const dur = getWorkingDuration(act);
    const dataDateIdx = toWorkingDayIndex(defaultDateStr, cal, "next");
    const incoming = incomingMap.get(act.id) || [];

    if (act.percentComplete === 100 || act.status?.toLowerCase() === "completed") {
      const es = isValidISOString(act.actualStart)
        ? toWorkingDayIndex(act.actualStart, cal, "next")
        : isValidISOString(act.plannedStart)
        ? toWorkingDayIndex(act.plannedStart, cal, "next")
        : dataDateIdx;
      const ef = isValidISOString(act.actualFinish)
        ? toWorkingDayIndex(act.actualFinish, cal, "next")
        : isValidISOString(act.plannedFinish)
        ? toWorkingDayIndex(act.plannedFinish, cal, "next")
        : es;
      ES_map.set(act.id, es);
      EF_map.set(act.id, ef);
      continue;
    }

    let baseES_idx = dataDateIdx;
    if (incoming.length === 0) {
      if (isValidISOString(act.plannedStart)) {
        baseES_idx = Math.max(dataDateIdx, toWorkingDayIndex(act.plannedStart, cal, "next"));
      } else {
        baseES_idx = dataDateIdx;
      }
    } else {
      if (isValidISOString(act.plannedStart)) {
        baseES_idx = toWorkingDayIndex(act.plannedStart, cal, "next");
      } else {
        baseES_idx = -Infinity;
      }
    }

    let ES_idx = baseES_idx;
    for (const dep of incoming) {
      const pred = actMap.get(dep.predecessorActivityId)!;
      const predEF = EF_map.get(pred.id)!;
      const predES = ES_map.get(pred.id)!;
      const lag = dep.lagDays || 0;

      let constrIdx = baseES_idx;
      if (dep.dependencyType === "FS") {
        constrIdx = predEF + 1 + lag;
      } else if (dep.dependencyType === "SS") {
        constrIdx = predES + lag;
      } else if (dep.dependencyType === "FF") {
        const efReq = predEF + lag;
        constrIdx = dur === 0 ? efReq : (efReq - dur + 1);
      } else if (dep.dependencyType === "SF") {
        const efReq = predES + lag;
        constrIdx = dur === 0 ? efReq : (efReq - dur + 1);
      }
      if (constrIdx > ES_idx) {
        ES_idx = constrIdx;
      }
    }
    if (ES_idx === -Infinity) ES_idx = dataDateIdx;

    const EF_idx = dur === 0 ? ES_idx : (ES_idx + dur - 1);
    ES_map.set(act.id, ES_idx);
    EF_map.set(act.id, EF_idx);
  }

  // 4. Backward Pass (LS & LF)
  let projectFinishIdx = -Infinity;
  for (const ef of EF_map.values()) {
    if (ef > projectFinishIdx) projectFinishIdx = ef;
  }
  if (projectFinishIdx === -Infinity) projectFinishIdx = 0;

  for (let i = order.length - 1; i >= 0; i--) {
    const act = order[i];
    const dur = getWorkingDuration(act);
    const ef = EF_map.get(act.id)!;
    const es = ES_map.get(act.id)!;

    if (act.percentComplete === 100 || act.status?.toLowerCase() === "completed") {
      LF_map.set(act.id, ef);
      LS_map.set(act.id, es);
      continue;
    }

    const outgoing = outgoingMap.get(act.id) || [];

    let LF_idx = projectFinishIdx;
    if (outgoing.length > 0) {
      LF_idx = Infinity;
      for (const dep of outgoing) {
        const succ = actMap.get(dep.successorActivityId)!;
        const sLS = LS_map.get(succ.id)!;
        const sLF = LF_map.get(succ.id)!;
        const lag = dep.lagDays || 0;

        let constrLf = projectFinishIdx;
        if (dep.dependencyType === "FS") {
          constrLf = sLS - 1 - lag;
        } else if (dep.dependencyType === "SS") {
          const esMax = sLS - lag;
          constrLf = dur === 0 ? esMax : (esMax + dur - 1);
        } else if (dep.dependencyType === "FF") {
          constrLf = sLF - lag;
        } else if (dep.dependencyType === "SF") {
          const esMax = sLF - lag;
          constrLf = dur === 0 ? esMax : (esMax + dur - 1);
        }
        if (constrLf < LF_idx) {
          LF_idx = constrLf;
        }
      }
    }

    if (LF_idx < ef) {
      LF_idx = ef;
    }

    const LS_idx = dur === 0 ? LF_idx : (LF_idx - dur + 1);
    LF_map.set(act.id, LF_idx);
    LS_map.set(act.id, LS_idx);
  }

  // 5. Total Float, Free Float, and Critical Path
  const result: ScheduledActivityOutput[] = [];
  for (const act of activities) {
    const cal = act.calendarId != null && calMap.has(act.calendarId) ? calMap.get(act.calendarId)! : defaultCal;
    const esIdx = ES_map.get(act.id)!;
    const efIdx = EF_map.get(act.id)!;
    const lsIdx = LS_map.get(act.id)!;
    const lfIdx = LF_map.get(act.id)!;

    const totalFloatDays = lsIdx - esIdx;
    let freeFloatDays = totalFloatDays;
    const outgoing = outgoingMap.get(act.id) || [];
    if (outgoing.length > 0) {
      let minSlack = Infinity;
      for (const dep of outgoing) {
        const succ = actMap.get(dep.successorActivityId)!;
        const sES = ES_map.get(succ.id)!;
        const sEF = EF_map.get(succ.id)!;
        const lag = dep.lagDays || 0;

        let slack = Infinity;
        if (dep.dependencyType === "FS") {
          slack = sES - (efIdx + 1 + lag);
        } else if (dep.dependencyType === "SS") {
          slack = sES - (esIdx + lag);
        } else if (dep.dependencyType === "FF") {
          slack = sEF - (efIdx + lag);
        } else if (dep.dependencyType === "SF") {
          slack = sEF - (esIdx + lag);
        }
        if (slack < minSlack) minSlack = slack;
      }
      freeFloatDays = Math.max(0, Math.min(totalFloatDays, minSlack));
    } else {
      freeFloatDays = totalFloatDays;
    }

    const isCritical = totalFloatDays <= 0;

    result.push({
      id: act.id,
      earlyStart: fromWorkingDayIndex(esIdx, cal),
      earlyFinish: fromWorkingDayIndex(efIdx, cal),
      lateStart: fromWorkingDayIndex(lsIdx, cal),
      lateFinish: fromWorkingDayIndex(lfIdx, cal),
      totalFloatDays,
      freeFloatDays,
      isCritical,
    });
  }

  return result;
}
