/**
 * Pure server module for Primavera Lite Critical Path Method (CPM) Scheduling Engine.
 *
 * Implements:
 * - Working-day calendar arithmetic (with custom working days & exceptions)
 * - Mixed-calendar dependency arithmetic (operating on absolute calendar days while
 *   each activity calendar controls working-day add/subtract)
 * - FS / SS / FF / SF dependencies with positive / zero / negative lag
 * - Forward pass (Early Start / Early Finish)
 * - Backward pass (Late Start / Late Finish)
 * - Total float and Free float calculation
 * - Critical activity / Critical path identification
 * - Milestones (0-duration activities)
 * - Open ends (default start at Data Date / default finish at Project Finish)
 * - Data Date handling & basic progress-aware scheduling
 * - Anchor priority: valid project data_date -> explicit scheduleDate
 *   (plannedStart/plannedFinish are informational user commitments and are
 *   NEVER read by the engine — no ES clamp, no anchor, no completed fallback)
 * - Data Date floor: no remaining/unfinished work schedules before the first
 *   working day on or after the project Data Date (F-01). Completed historical
 *   actuals are never moved.
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
  isWorking: Int32Array;
  workCum: Int32Array;
  nextWorkDay: Int32Array;
  prevWorkDay: Int32Array;
  workToCalDay: Int32Array;
}

const calendarCache = new WeakMap<ScheduleCalendarInput, CalendarIndexCache>();

function isValidISOString(dateStr: string | null | undefined): boolean {
  if (!dateStr || typeof dateStr !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim());
}

export function dateToCalendarDay(dateStr: string): number {
  const trimmed = dateStr.trim();
  const [y, m, d] = trimmed.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d);
  return Math.round((utc - REF_UTC_MS) / MS_PER_DAY);
}

export function calendarDayToDate(calDay: number): string {
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

  const isWorking = new Int32Array(RANGE_SIZE);
  const workCum = new Int32Array(RANGE_SIZE);
  const nextWorkDay = new Int32Array(RANGE_SIZE);
  const prevWorkDay = new Int32Array(RANGE_SIZE);
  const workToCalDay = new Int32Array(RANGE_SIZE);

  let workCount = 0;
  for (let idx = 0; idx < RANGE_SIZE; idx++) {
    const calDay = BASE_CAL_DAY + idx;
    if (isWorkingDayOnCalendar(calDay, workingSet, exMap)) {
      isWorking[idx] = 1;
      workToCalDay[workCount] = calDay;
      workCount++;
    }
    workCum[idx] = workCount; // cumulative up to idx
  }

  let nextPtr = 0;
  for (let idx = 0; idx < RANGE_SIZE; idx++) {
    const calDay = BASE_CAL_DAY + idx;
    while (nextPtr < workCount && workToCalDay[nextPtr] < calDay) {
      nextPtr++;
    }
    const safeNext = nextPtr < workCount ? workToCalDay[nextPtr] : workToCalDay[workCount - 1];
    nextWorkDay[idx] = safeNext;
  }

  let prevPtr = 0;
  for (let idx = 0; idx < RANGE_SIZE; idx++) {
    const calDay = BASE_CAL_DAY + idx;
    while (prevPtr + 1 < workCount && workToCalDay[prevPtr + 1] <= calDay) {
      prevPtr++;
    }
    prevWorkDay[idx] = workToCalDay[prevPtr];
  }

  cached = { isWorking, workCum, nextWorkDay, prevWorkDay, workToCalDay };
  calendarCache.set(cal, cached);
  return cached;
}

export function isWorkingDay(calDay: number, cal: ScheduleCalendarInput): boolean {
  const cache = getCalendarCache(cal);
  const idx = Math.max(0, Math.min(RANGE_SIZE - 1, calDay - BASE_CAL_DAY));
  return cache.isWorking[idx] === 1;
}

export function nextWorkingDay(calDay: number, cal: ScheduleCalendarInput): number {
  const cache = getCalendarCache(cal);
  const idx = Math.max(0, Math.min(RANGE_SIZE - 1, calDay - BASE_CAL_DAY));
  return cache.nextWorkDay[idx];
}

export function prevWorkingDay(calDay: number, cal: ScheduleCalendarInput): number {
  const cache = getCalendarCache(cal);
  const idx = Math.max(0, Math.min(RANGE_SIZE - 1, calDay - BASE_CAL_DAY));
  return cache.prevWorkDay[idx];
}

export function addWorkingDays(startCalDay: number, durDays: number, cal: ScheduleCalendarInput): number {
  if (durDays <= 0) return startCalDay;
  const cache = getCalendarCache(cal);
  const sDay = nextWorkingDay(startCalDay, cal);
  const sIdx = Math.max(0, Math.min(RANGE_SIZE - 1, sDay - BASE_CAL_DAY));
  const workIdx = cache.workCum[sIdx] - 1; // 0-based work index of sDay
  const targetWorkIdx = Math.max(0, Math.min(cache.workToCalDay.length - 1, workIdx + durDays - 1));
  return cache.workToCalDay[targetWorkIdx];
}

export function subWorkingDays(finishCalDay: number, durDays: number, cal: ScheduleCalendarInput): number {
  if (durDays <= 0) return finishCalDay;
  const cache = getCalendarCache(cal);
  const fDay = prevWorkingDay(finishCalDay, cal);
  const fIdx = Math.max(0, Math.min(RANGE_SIZE - 1, fDay - BASE_CAL_DAY));
  const workIdx = cache.workCum[fIdx] - 1; // 0-based work index of fDay
  const targetWorkIdx = Math.max(0, Math.min(cache.workToCalDay.length - 1, workIdx - durDays + 1));
  return cache.workToCalDay[targetWorkIdx];
}

export function shiftWorkingDays(baseCalDay: number, shiftDays: number, cal: ScheduleCalendarInput): number {
  const cache = getCalendarCache(cal);
  if (shiftDays === 0) return nextWorkingDay(baseCalDay, cal);
  if (shiftDays > 0) {
    const sDay = nextWorkingDay(baseCalDay, cal);
    const sIdx = Math.max(0, Math.min(RANGE_SIZE - 1, sDay - BASE_CAL_DAY));
    const workIdx = cache.workCum[sIdx] - 1;
    const targetWorkIdx = Math.max(0, Math.min(cache.workToCalDay.length - 1, workIdx + shiftDays));
    return cache.workToCalDay[targetWorkIdx];
  } else {
    // shiftDays < 0
    const pDay = nextWorkingDay(baseCalDay, cal);
    const pIdx = Math.max(0, Math.min(RANGE_SIZE - 1, pDay - BASE_CAL_DAY));
    const workIdx = cache.workCum[pIdx] - 1;
    const targetWorkIdx = Math.max(0, Math.min(cache.workToCalDay.length - 1, workIdx + shiftDays));
    return cache.workToCalDay[targetWorkIdx];
  }
}

export function shiftWorkingDaysBackward(baseCalDay: number, shiftDays: number, cal: ScheduleCalendarInput): number {
  const cache = getCalendarCache(cal);
  if (shiftDays === 0) return prevWorkingDay(baseCalDay, cal);
  const pDay = prevWorkingDay(baseCalDay, cal);
  const pIdx = Math.max(0, Math.min(RANGE_SIZE - 1, pDay - BASE_CAL_DAY));
  const workIdx = cache.workCum[pIdx] - 1;
  const targetWorkIdx = Math.max(0, Math.min(cache.workToCalDay.length - 1, workIdx + shiftDays));
  return cache.workToCalDay[targetWorkIdx];
}

export function countWorkingDays(startCalDay: number, finishCalDay: number, cal: ScheduleCalendarInput): number {
  if (finishCalDay < startCalDay) return 0;
  const cache = getCalendarCache(cal);
  const sIdx = Math.max(0, Math.min(RANGE_SIZE - 1, startCalDay - BASE_CAL_DAY));
  const fIdx = Math.max(0, Math.min(RANGE_SIZE - 1, finishCalDay - BASE_CAL_DAY));
  const wStart = cache.workCum[sIdx] - cache.isWorking[sIdx];
  const wFinish = cache.workCum[fIdx];
  return Math.max(0, wFinish - wStart);
}

// Backward-compatible working day index helpers for any legacy callers
export function toWorkingDayIndex(
  dateStr: string | null | undefined,
  cal: ScheduleCalendarInput,
  mode: "next" | "prev" = "next"
): number {
  if (!isValidISOString(dateStr)) return 0;
  const calDay = dateToCalendarDay(dateStr!);
  const cache = getCalendarCache(cal);
  const offset = Math.max(0, Math.min(RANGE_SIZE - 1, calDay - BASE_CAL_DAY));
  const mappedDay = mode === "next" ? cache.nextWorkDay[offset] : cache.prevWorkDay[offset];
  const mappedOffset = Math.max(0, Math.min(RANGE_SIZE - 1, mappedDay - BASE_CAL_DAY));
  return cache.workCum[mappedOffset] - 1;
}

export function fromWorkingDayIndex(workIdx: number, cal: ScheduleCalendarInput): string {
  const cache = getCalendarCache(cal);
  const safeIdx = Math.max(0, Math.min(cache.workToCalDay.length - 1, workIdx));
  const calDay = cache.workToCalDay[safeIdx];
  return calendarDayToDate(calDay);
}

export function getWorkingDuration(act: ScheduleActivityInput): number {
  if (act.activityType?.toLowerCase() === "milestone") return 0;
  // Completion is a canonical progress fact: percentComplete === 100. Arbitrary
  // status strings never drive scheduling (F-10).
  if (act.percentComplete === 100) return 0;
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

/**
 * Run CPM scheduling engine.
 */
export function runScheduleEngine(
  projectDataDate: string | null | undefined,
  scheduleDate: string | null | undefined,
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

  // 2. Anchor priority (F-09): valid project data_date -> explicit scheduleDate.
  //    plannedStart/plannedFinish are informational and never anchor the schedule.
  let anchorDateStr: string | null = null;
  if (isValidISOString(projectDataDate)) {
    anchorDateStr = projectDataDate!.trim();
  } else if (isValidISOString(scheduleDate)) {
    anchorDateStr = scheduleDate!.trim();
  }

  if (!anchorDateStr) {
    throw new Error(
      "Cannot schedule project: no valid project data_date or scheduleDate anchor available"
    );
  }

  const anchorDay = dateToCalendarDay(anchorDateStr);

  const ES_day_map = new Map<number, number>();
  const EF_day_map = new Map<number, number>();
  const LS_day_map = new Map<number, number>();
  const LF_day_map = new Map<number, number>();

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

  // 3. Forward Pass (ES & EF) - using absolute calendar days & target calendar arithmetic
  for (const act of order) {
    const cal = act.calendarId != null && calMap.has(act.calendarId) ? calMap.get(act.calendarId)! : defaultCal;
    const dur = getWorkingDuration(act);
    const anchorWorkDay = nextWorkingDay(anchorDay, cal);
    const incoming = incomingMap.get(act.id) || [];

    // Completed activities are historical facts: ES/EF come from actual dates
    // (anchor fallback only when no actual start exists). plannedStart/
    // plannedFinish are NEVER read, and the Data Date floor never applies.
    if (act.percentComplete === 100) {
      const esStr = isValidISOString(act.actualStart) ? act.actualStart! : anchorDateStr;
      const efStr = isValidISOString(act.actualFinish) ? act.actualFinish! : esStr;
      const es = dateToCalendarDay(esStr);
      const ef = dateToCalendarDay(efStr);
      ES_day_map.set(act.id, es);
      EF_day_map.set(act.id, ef);
      continue;
    }

    // Network-derived Early Start (per-type FS/SS/FF/SF + lag math, unchanged).
    let ES_day = -Infinity;
    for (const dep of incoming) {
      const pred = actMap.get(dep.predecessorActivityId)!;
      const predEF = EF_day_map.get(pred.id)!;
      const predES = ES_day_map.get(pred.id)!;
      const lag = dep.lagDays || 0;

      const predActualFinishDay = isValidISOString(pred.actualFinish)
        ? dateToCalendarDay(pred.actualFinish!)
        : null;
      const predActualStartDay = isValidISOString(pred.actualStart)
        ? dateToCalendarDay(pred.actualStart!)
        : null;

      const predFinishAnchor = predActualFinishDay != null ? predActualFinishDay : predEF;
      const predStartAnchor = predActualStartDay != null ? predActualStartDay : predES;

      let constrDay = -Infinity;
      if (dep.dependencyType === "FS") {
        constrDay = shiftWorkingDays(predFinishAnchor + 1, lag, cal);
      } else if (dep.dependencyType === "SS") {
        constrDay = shiftWorkingDays(predStartAnchor, lag, cal);
      } else if (dep.dependencyType === "FF") {
        const efReq = shiftWorkingDays(predFinishAnchor, lag, cal);
        constrDay = dur === 0 ? efReq : subWorkingDays(efReq, dur, cal);
      } else if (dep.dependencyType === "SF") {
        const efReq = shiftWorkingDays(predStartAnchor, lag, cal);
        constrDay = dur === 0 ? efReq : subWorkingDays(efReq, dur, cal);
      }
      if (constrDay > ES_day) {
        ES_day = constrDay;
      }
    }

    // Data Date floor (F-01): no remaining work before the first working day on
    // or after the project Data Date. Applies to every unfinished activity,
    // including successors of completed predecessors and negative-lag leads.
    if (ES_day < anchorWorkDay) ES_day = anchorWorkDay;

    // Actual-progress floor: remaining work of an in-progress activity never
    // schedules before its recorded Actual Start.
    if (
      act.percentComplete != null &&
      act.percentComplete > 0 &&
      act.percentComplete < 100 &&
      isValidISOString(act.actualStart)
    ) {
      const actualStartDay = dateToCalendarDay(act.actualStart!);
      if (actualStartDay > ES_day) ES_day = actualStartDay;
    }

    const EF_day = dur === 0 ? ES_day : addWorkingDays(ES_day, dur, cal);
    ES_day_map.set(act.id, ES_day);
    EF_day_map.set(act.id, EF_day);
  }

  // 4. Backward Pass (LS & LF)
  let projectFinishDay = -Infinity;
  for (const ef of EF_day_map.values()) {
    if (ef > projectFinishDay) projectFinishDay = ef;
  }
  if (projectFinishDay === -Infinity) projectFinishDay = anchorDay;

  for (let i = order.length - 1; i >= 0; i--) {
    const act = order[i];
    const cal = act.calendarId != null && calMap.has(act.calendarId) ? calMap.get(act.calendarId)! : defaultCal;
    const dur = getWorkingDuration(act);
    const efDay = EF_day_map.get(act.id)!;
    const esDay = ES_day_map.get(act.id)!;

    if (act.percentComplete === 100) {
      LF_day_map.set(act.id, efDay);
      LS_day_map.set(act.id, esDay);
      continue;
    }

    const outgoing = outgoingMap.get(act.id) || [];

    let LF_day = projectFinishDay;
    if (outgoing.length > 0) {
      LF_day = Infinity;
      for (const dep of outgoing) {
        const succ = actMap.get(dep.successorActivityId)!;
        const sLS = LS_day_map.get(succ.id)!;
        const sLF = LF_day_map.get(succ.id)!;
        const lag = dep.lagDays || 0;

        let constrLf = projectFinishDay;
        if (dep.dependencyType === "FS") {
          constrLf = shiftWorkingDaysBackward(sLS - 1, -lag, cal);
        } else if (dep.dependencyType === "SS") {
          const reqLS = shiftWorkingDaysBackward(sLS, -lag, cal);
          constrLf = dur === 0 ? reqLS : addWorkingDays(reqLS, dur, cal);
        } else if (dep.dependencyType === "FF") {
          constrLf = shiftWorkingDaysBackward(sLF, -lag, cal);
        } else if (dep.dependencyType === "SF") {
          const reqLS = shiftWorkingDaysBackward(sLF, -lag, cal);
          constrLf = dur === 0 ? reqLS : addWorkingDays(reqLS, dur, cal);
        }
        if (constrLf < LF_day) {
          LF_day = constrLf;
        }
      }
    }

    if (LF_day < efDay) {
      LF_day = efDay;
    }

    const LS_day = dur === 0 ? LF_day : subWorkingDays(LF_day, dur, cal);
    LF_day_map.set(act.id, LF_day);
    LS_day_map.set(act.id, LS_day);
  }

  // 5. Total Float, Free Float, and Critical Path
  const result: ScheduledActivityOutput[] = [];
  for (const act of activities) {
    const cal = act.calendarId != null && calMap.has(act.calendarId) ? calMap.get(act.calendarId)! : defaultCal;
    const esDay = ES_day_map.get(act.id)!;
    const efDay = EF_day_map.get(act.id)!;
    const lsDay = LS_day_map.get(act.id)!;
    const lfDay = LF_day_map.get(act.id)!;

    const totalFloatDays = Math.max(0, countWorkingDays(esDay, lsDay, cal) - 1);
    let freeFloatDays = totalFloatDays;
    const outgoing = outgoingMap.get(act.id) || [];
    if (outgoing.length > 0) {
      let minSlack = Infinity;
      for (const dep of outgoing) {
        const succ = actMap.get(dep.successorActivityId)!;
        const sES = ES_day_map.get(succ.id)!;
        const sEF = EF_day_map.get(succ.id)!;
        const lag = dep.lagDays || 0;

        let reqLF = Infinity;
        if (dep.dependencyType === "FS") {
          reqLF = shiftWorkingDaysBackward(sES - 1, -lag, cal);
        } else if (dep.dependencyType === "SS") {
          const reqLS = shiftWorkingDaysBackward(sES, -lag, cal);
          reqLF = getWorkingDuration(act) === 0 ? reqLS : addWorkingDays(reqLS, getWorkingDuration(act), cal);
        } else if (dep.dependencyType === "FF") {
          reqLF = shiftWorkingDaysBackward(sEF, -lag, cal);
        } else if (dep.dependencyType === "SF") {
          const reqLS = shiftWorkingDaysBackward(sEF, -lag, cal);
          reqLF = getWorkingDuration(act) === 0 ? reqLS : addWorkingDays(reqLS, getWorkingDuration(act), cal);
        }

        const slack = Math.max(0, countWorkingDays(efDay, reqLF, cal) - 1);
        if (slack < minSlack) minSlack = slack;
      }
      freeFloatDays = Math.max(0, Math.min(totalFloatDays, minSlack));
    } else {
      freeFloatDays = totalFloatDays;
    }

    const isCritical = totalFloatDays <= 0;

    result.push({
      id: act.id,
      earlyStart: calendarDayToDate(esDay),
      earlyFinish: calendarDayToDate(efDay),
      lateStart: calendarDayToDate(lsDay),
      lateFinish: calendarDayToDate(lfDay),
      totalFloatDays,
      freeFloatDays,
      isCritical,
    });
  }

  return result;
}
