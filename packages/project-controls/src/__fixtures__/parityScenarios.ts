/**
 * Frozen parity oracle for the Lihok Project Controls extraction (M0/M1).
 *
 * Everything here is PURE: it imports only the project-controls domain modules
 * and touches no database, no React and no ODM infrastructure. The scenarios
 * are compiled against the authoritative pre-extraction implementation to
 * produce `parityGolden.json`; after extraction the same scenarios must
 * reproduce that golden byte-for-byte, proving the move changed nothing.
 *
 * Determinism: every array is sorted by a stable key and every value is a
 * string/number/boolean/null, so JSON serialisation is order-stable.
 */
import {
  addWorkingDays,
  calendarDayToDate,
  countWorkingDays,
  dateToCalendarDay,
  getWorkingDuration,
  isWorkingDay,
  runScheduleEngine,
  subWorkingDays,
  type ScheduleActivityInput,
  type ScheduleCalendarInput,
  type ScheduleDependencyInput,
} from "../schedulingEngine";
import {
  autoActualFinishFromDataDate,
  deriveProgressState,
  deriveRemainingDuration,
  normalizeIsoDate,
  percentAfterClearingActualFinish,
  resolveProgress,
  type ProgressFields,
} from "../progressModel";
import { summarizeStatusing, activityLifecycle, forecastRemainingDays } from "../statusingModel";
import { compareActivityToBaseline, buildProjectComparison, currentDurationDays } from "../baselineVariance";
import { isCpmDrivingEvent, isScheduleOutOfDate } from "../scheduleStaleness";
import {
  calendarAffectsActiveSchedule,
  formatWorkingDays,
  normalizeWorkingDays,
  validateWorkingDays,
  workingDaysEqual,
} from "../calendarModel";

const DATA_DATE = "2026-09-10";

const MON_FRI: ScheduleCalendarInput = { id: 1, name: "Project default", workingDays: [1, 2, 3, 4, 5] };
const SIX_DAY: ScheduleCalendarInput = { id: 2, name: "Six-day week", workingDays: [1, 2, 3, 4, 5, 6] };
const WITH_HOLIDAY: ScheduleCalendarInput = {
  id: 3,
  name: "Mon-Fri with holiday",
  workingDays: [1, 2, 3, 4, 5],
  exceptions: [{ exceptionDate: "2026-09-14", isWorking: false }],
};

/** The representative 10-activity / 11-dependency network used for #441 A/B. */
export function buildNetwork(): ScheduleActivityInput[] {
  return [
    { id: 1, wbsNodeId: 1, activityName: "A start", activityType: "task", originalDurationDays: 5, remainingDurationDays: 0, percentComplete: 0, calendarId: MON_FRI.id, sortOrder: 1 },
    { id: 2, wbsNodeId: 1, activityName: "B left", activityType: "task", originalDurationDays: 4, remainingDurationDays: 0, percentComplete: 0, calendarId: MON_FRI.id, sortOrder: 2 },
    { id: 3, wbsNodeId: 1, activityName: "C right", activityType: "task", originalDurationDays: 7, remainingDurationDays: 0, percentComplete: 0, calendarId: MON_FRI.id, sortOrder: 3 },
    { id: 4, wbsNodeId: 1, activityName: "D diamond join", activityType: "task", originalDurationDays: 3, remainingDurationDays: 0, percentComplete: 0, calendarId: SIX_DAY.id, sortOrder: 4 },
    { id: 5, wbsNodeId: 1, activityName: "E zero duration", activityType: "task", originalDurationDays: 0, remainingDurationDays: 0, percentComplete: 0, calendarId: MON_FRI.id, sortOrder: 5 },
    { id: 6, wbsNodeId: 1, activityName: "F milestone", activityType: "milestone", originalDurationDays: 0, remainingDurationDays: 0, percentComplete: 0, calendarId: MON_FRI.id, sortOrder: 6 },
    { id: 7, wbsNodeId: 1, activityName: "G completed", activityType: "task", originalDurationDays: 4, remainingDurationDays: 0, percentComplete: 100, actualStart: "2026-09-10", actualFinish: "2026-09-15", calendarId: MON_FRI.id, sortOrder: 7 },
    { id: 8, wbsNodeId: 1, activityName: "H in progress", activityType: "task", originalDurationDays: 6, remainingDurationDays: 4, percentComplete: 40, actualStart: "2026-09-10", calendarId: WITH_HOLIDAY.id, sortOrder: 8 },
    { id: 9, wbsNodeId: 1, activityName: "I successor of many", activityType: "task", originalDurationDays: 2, remainingDurationDays: 0, percentComplete: 0, calendarId: MON_FRI.id, sortOrder: 9 },
    // Legacy row: a foreign stored status that the engine must never read.
    { id: 10, wbsNodeId: 1, activityName: "J legacy row", activityType: "task", originalDurationDays: 3, remainingDurationDays: 0, percentComplete: 0, status: "in_progress", calendarId: null, sortOrder: 10 },
  ];
}

export function buildDependencies(): ScheduleDependencyInput[] {
  return [
    { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 0 },
    { id: 2, predecessorActivityId: 1, successorActivityId: 3, dependencyType: "FS", lagDays: 0 },
    { id: 3, predecessorActivityId: 2, successorActivityId: 4, dependencyType: "FS", lagDays: 2 },
    { id: 4, predecessorActivityId: 3, successorActivityId: 4, dependencyType: "FS", lagDays: 0 },
    { id: 5, predecessorActivityId: 2, successorActivityId: 5, dependencyType: "SS", lagDays: 1 },
    { id: 6, predecessorActivityId: 3, successorActivityId: 6, dependencyType: "FF", lagDays: 3 },
    { id: 7, predecessorActivityId: 4, successorActivityId: 8, dependencyType: "SF", lagDays: 1 },
    { id: 8, predecessorActivityId: 5, successorActivityId: 9, dependencyType: "FS", lagDays: -1 },
    { id: 9, predecessorActivityId: 6, successorActivityId: 9, dependencyType: "FS", lagDays: 0 },
    { id: 10, predecessorActivityId: 7, successorActivityId: 9, dependencyType: "FS", lagDays: 0 },
    { id: 11, predecessorActivityId: 8, successorActivityId: 9, dependencyType: "FS", lagDays: 0 },
  ];
}

const round = (rows: Array<Record<string, unknown>>) => rows;

export function buildParitySnapshot(): Record<string, unknown> {
  // ── scheduling: the full network with three calendars (default, six-day, holiday) ──
  const scheduled = runScheduleEngine(DATA_DATE, DATA_DATE, [MON_FRI, SIX_DAY, WITH_HOLIDAY], MON_FRI.id, buildNetwork(), buildDependencies());
  const scheduling = round(
    scheduled
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((r) => ({ id: r.id, es: r.earlyStart, ef: r.earlyFinish, ls: r.lateStart, lf: r.lateFinish, tf: r.totalFloatDays, ff: r.freeFloatDays, crit: r.isCritical }))
  );

  // ── calendars: working-day arithmetic, weekends and an exception day ──
  const calendars = {
    calendarDay: [dateToCalendarDay("2026-09-10"), dateToCalendarDay("2026-09-14"), dateToCalendarDay("1970-01-01")],
    addWorking: [
      calendarDayToDate(addWorkingDays(dateToCalendarDay("2026-09-10"), 1, MON_FRI)),
      calendarDayToDate(addWorkingDays(dateToCalendarDay("2026-09-10"), 5, MON_FRI)),
      calendarDayToDate(addWorkingDays(dateToCalendarDay("2026-09-10"), 5, SIX_DAY)),
      calendarDayToDate(addWorkingDays(dateToCalendarDay("2026-09-10"), 5, WITH_HOLIDAY)),
      calendarDayToDate(addWorkingDays(dateToCalendarDay("2026-09-10"), 0, MON_FRI)),
    ],
    subWorking: [calendarDayToDate(subWorkingDays(dateToCalendarDay("2026-09-16"), 5, MON_FRI))],
    countWorking: [
      countWorkingDays(dateToCalendarDay("2026-09-10"), dateToCalendarDay("2026-09-16"), MON_FRI),
      countWorkingDays(dateToCalendarDay("2026-09-10"), dateToCalendarDay("2026-09-16"), SIX_DAY),
      countWorkingDays(dateToCalendarDay("2026-09-10"), dateToCalendarDay("2026-09-16"), WITH_HOLIDAY),
      countWorkingDays(dateToCalendarDay("2026-09-16"), dateToCalendarDay("2026-09-10"), MON_FRI),
      countWorkingDays(dateToCalendarDay("2026-09-12"), dateToCalendarDay("2026-09-12"), MON_FRI),
    ],
    isWorking: [
      isWorkingDay(dateToCalendarDay("2026-09-12"), MON_FRI),
      isWorkingDay(dateToCalendarDay("2026-09-12"), SIX_DAY),
      isWorkingDay(dateToCalendarDay("2026-09-14"), WITH_HOLIDAY),
    ],
    workingDaysHelpers: {
      normalized7: normalizeWorkingDays([7, 1, 2, 2]),
      formatted: formatWorkingDays([1, 2, 3, 4, 5]),
      formattedWithSaturday: formatWorkingDays([6, 7]),
      equal: workingDaysEqual([1, 2, 3, 4, 5], [7, 1, 2, 3, 4, 5]),
      unequal: workingDaysEqual([1, 2, 3, 4, 5], [1, 2, 3, 4]),
      affectsActive: [
        calendarAffectsActiveSchedule(MON_FRI.id, MON_FRI.id, []),
        calendarAffectsActiveSchedule(MON_FRI.id, SIX_DAY.id, []),
        calendarAffectsActiveSchedule(MON_FRI.id, SIX_DAY.id, [SIX_DAY.id]),
        calendarAffectsActiveSchedule(MON_FRI.id, SIX_DAY.id, [null]),
      ],
      validated: validateWorkingDays([7, 3, 1]),
    },
  };

  // ── duration semantics: engine duration per activity, plus milestone/zero and exceptions ──
  const durations = buildNetwork()
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((a) => ({
      id: a.id,
      name: a.activityName,
      engineDuration: getWorkingDuration(a),
      currentDurationMonFri: currentDurationDays({ id: a.id, percentComplete: a.percentComplete, originalDurationDays: a.originalDurationDays, remainingDurationDays: a.remainingDurationDays, earlyStart: a.actualStart ?? "2026-09-10", earlyFinish: a.actualFinish ?? "2026-09-16" }, MON_FRI),
      currentDurationSixDay: currentDurationDays({ id: a.id, percentComplete: a.percentComplete, originalDurationDays: a.originalDurationDays, remainingDurationDays: a.remainingDurationDays, earlyStart: a.actualStart ?? "2026-09-10", earlyFinish: a.actualFinish ?? "2026-09-16" }, SIX_DAY),
    }));

  // ── progress / Data Date (the #440 contract) ──
  const base: ProgressFields = { percentComplete: 0, actualStart: null, actualFinish: null, status: null, remainingDurationDays: 0, originalDurationDays: 10 };
  const progressCases: Array<{ name: string; current: ProgressFields; changes: Partial<ProgressFields>; mode?: "create" | "update" }> = [
    { name: "unchanged-noop", current: base, changes: {} },
    { name: "explicit-zero-percent", current: base, changes: { percentComplete: 0 } },
    { name: "forty-percent", current: base, changes: { percentComplete: 40 } },
    { name: "hundred-derives-finish", current: base, changes: { percentComplete: 100 } },
    { name: "hundred-with-start", current: { ...base, actualStart: "2026-09-10" }, changes: { percentComplete: 100 } },
    { name: "in-progress-explicit-zero-remaining-V10", current: { ...base, percentComplete: 40, actualStart: "2026-09-10" }, changes: { remainingDurationDays: 0 } },
    { name: "in-progress-positive-remaining", current: { ...base, percentComplete: 40, actualStart: "2026-09-10" }, changes: { remainingDurationDays: 3 } },
    { name: "completed-with-positive-remaining-V4", current: { ...base, percentComplete: 100, actualFinish: "2026-09-15" }, changes: { remainingDurationDays: 2 } },
    { name: "clear-finish-T2b", current: { ...base, percentComplete: 100, actualStart: "2026-09-10", actualFinish: "2026-09-15" }, changes: { actualFinish: null } },
    { name: "uncomplete-T2", current: { ...base, percentComplete: 100, actualFinish: "2026-09-15" }, changes: { percentComplete: 60 } },
    { name: "percent-with-finish-error", current: base, changes: { percentComplete: 50, actualFinish: "2026-09-15" } },
    { name: "reversed-actuals-error", current: base, changes: { percentComplete: 100, actualStart: "2026-09-20", actualFinish: "2026-09-15" } },
    { name: "unknown-status-V5", current: base, changes: { status: "in_progress" } },
    { name: "status-mismatch-V9", current: base, changes: { status: "completed" } },
    { name: "not-started-with-dates-error", current: base, changes: { status: "not-started", percentComplete: 10 } },
    { name: "out-of-range-percent", current: base, changes: { percentComplete: 101 } },
    { name: "negative-remaining", current: base, changes: { remainingDurationDays: -1 } },
    { name: "create-mode-finish-only", current: base, changes: { actualFinish: "2026-09-15" }, mode: "create" },
  ];
  const progress = progressCases.map((c) => {
    const r = resolveProgress({ current: c.current, changes: c.changes, dataDate: DATA_DATE, mode: c.mode ?? "update" });
    return { name: c.name, ok: r.ok, error: r.ok ? null : r.error, noop: r.ok ? r.noop ?? false : null, values: r.ok ? (r.values ?? {}) : null };
  });
  const derived = {
    states: [
      deriveProgressState(0, null, null),
      deriveProgressState(40, "2026-09-10", null),
      deriveProgressState(100, null, "2026-09-15"),
      deriveProgressState(100, "2026-09-10", "2026-09-15"),
    ],
    remaining: [
      deriveRemainingDuration(10, 0),
      deriveRemainingDuration(10, 40),
      deriveRemainingDuration(10, 100),
      deriveRemainingDuration(10, 40, 3),
      deriveRemainingDuration(0, 0),
    ],
    autoFinish: [autoActualFinishFromDataDate(DATA_DATE, null), autoActualFinishFromDataDate(DATA_DATE, "2026-09-01"), autoActualFinishFromDataDate(null, null), autoActualFinishFromDataDate(DATA_DATE, "2026-09-20")],
    clearedPercent: [percentAfterClearingActualFinish("2026-09-10", null), percentAfterClearingActualFinish(null, null), percentAfterClearingActualFinish("2026-09-10", 60)],
    normalized: [normalizeIsoDate("2026-09-10T00:00:00.000Z"), normalizeIsoDate("  2026-09-10  "), normalizeIsoDate(""), normalizeIsoDate(null), normalizeIsoDate("garbage"), normalizeIsoDate(new Date("2026-09-10T00:00:00.000Z"))],
  };

  // ── statusing roll-up ──
  const currentActivities = buildNetwork().map((a) => ({
    id: a.id,
    wbsNodeId: a.wbsNodeId,
    activityName: a.activityName,
    activityType: a.activityType ?? null,
    originalDurationDays: a.originalDurationDays,
    remainingDurationDays: a.remainingDurationDays ?? 0,
    percentComplete: a.percentComplete ?? 0,
    actualStart: a.actualStart ?? null,
    actualFinish: a.actualFinish ?? null,
    earlyFinish: scheduled.find((s) => s.id === a.id)?.earlyFinish ?? null,
    status: a.status ?? null,
    archivedAt: null,
  }));
  const statusing = { summary: summarizeStatusing(currentActivities, DATA_DATE), lifecycles: currentActivities.map((a) => ({ id: a.id, lifecycle: activityLifecycle(a), forecastRemaining: forecastRemainingDays(a) })) };

  // ── baseline variance (§12 matrix) ──
  const snap = (o: Partial<Parameters<typeof compareActivityToBaseline>[0]["snapshot"]> & { activityId: number }) => ({
    snapshotId: o.activityId * 10,
    activityId: o.activityId,
    activityCode: `A-${o.activityId}`,
    activityName: `Approved ${o.activityId}`,
    wbsNodeId: 1,
    wbsCode: null,
    wbsName: null,
    calendarId: MON_FRI.id,
    calendarName: "Project default",
    originalDurationDays: 5,
    scheduledStart: "2026-09-10",
    scheduledFinish: "2026-09-16",
    ...o,
  });
  const cur = (o: Record<string, unknown> & { id: number }) => ({ id: o.id, activityType: "task", originalDurationDays: 5, remainingDurationDays: 0, percentComplete: 0, earlyStart: "2026-09-10", earlyFinish: "2026-09-16", archivedAt: null, ...o });
  const varianceRows = [
    ["unchanged", snap({ activityId: 101 }), cur({ id: 101 }), MON_FRI],
    ["ahead", snap({ activityId: 102 }), cur({ id: 102, earlyFinish: "2026-09-14" }), MON_FRI],
    ["late", snap({ activityId: 103 }), cur({ id: 103, earlyFinish: "2026-09-21" }), MON_FRI],
    ["duration-longer", snap({ activityId: 104 }), cur({ id: 104, originalDurationDays: 9 }), MON_FRI],
    ["duration-shorter", snap({ activityId: 105 }), cur({ id: 105, originalDurationDays: 2 }), MON_FRI],
    ["completed-calendar-change", snap({ activityId: 106 }), cur({ id: 106, percentComplete: 100, actualStart: "2026-09-10", actualFinish: "2026-09-16", earlyStart: "2026-09-10", earlyFinish: "2026-09-16" }), SIX_DAY],
    ["completed-calendar-exception", snap({ activityId: 107 }), cur({ id: 107, percentComplete: 100, actualStart: "2026-09-10", actualFinish: "2026-09-16", earlyStart: "2026-09-10", earlyFinish: "2026-09-16" }), WITH_HOLIDAY],
    ["unfinished-calendar-change", snap({ activityId: 108 }), cur({ id: 108, calendarId: SIX_DAY.id }), SIX_DAY],
    ["new-since-baseline", null, cur({ id: 109 }), MON_FRI],
    ["removed-since-baseline", snap({ activityId: 110 }), null, MON_FRI],
    ["archived-since-baseline", snap({ activityId: 111 }), cur({ id: 111, archivedAt: "2026-09-20T00:00:00.000Z" }), MON_FRI],
    ["undated-baseline", snap({ activityId: 112, scheduledFinish: null }), cur({ id: 112 }), MON_FRI],
    ["milestone", snap({ activityId: 113, originalDurationDays: 0, scheduledStart: "2026-09-10", scheduledFinish: "2026-09-10" }), cur({ id: 113, activityType: "milestone", originalDurationDays: 0, earlyStart: "2026-09-10", earlyFinish: "2026-09-10" }), MON_FRI],
  ] as const;
  const rows = varianceRows.map(([name, s, c, cal]) => ({ name, ...compareActivityToBaseline({ snapshot: s as never, current: c as never, calendar: cal as ScheduleCalendarInput }) }));
  const variance = {
    rows,
    project: buildProjectComparison({ rows: rows as never, baselineActivityCount: 12, currentProjectFinish: "2026-09-21" }),
    projectEarlier: buildProjectComparison({ rows: rows as never, baselineActivityCount: 12, currentProjectFinish: "2026-09-11" }),
    projectUndated: buildProjectComparison({ rows: rows as never, baselineActivityCount: 12, currentProjectFinish: null }),
  };

  // ── schedule staleness ──
  const events = [
    { entityType: "activity", action: "update", beforeData: { originalDurationDays: 3 }, afterData: { originalDurationDays: 5 }, projectRevision: 5 },
    { entityType: "activity", action: "update", beforeData: { plannedStart: "2026-09-01" }, afterData: { plannedStart: "2026-09-02" }, projectRevision: 5 },
    { entityType: "activity", action: "update", beforeData: { status: "not-started" }, afterData: { status: "in-progress" }, projectRevision: 5 },
    { entityType: "activity", action: "create", beforeData: null, afterData: {}, projectRevision: 5 },
    { entityType: "dependency", action: "update", beforeData: {}, afterData: {}, projectRevision: 5 },
    { entityType: "project", action: "update", beforeData: { dataDate: "2026-09-10" }, afterData: { dataDate: "2026-09-11" }, projectRevision: 5 },
    { entityType: "project", action: "update", beforeData: { description: "a" }, afterData: { description: "b" }, projectRevision: 5 },
    { entityType: "calendar", action: "update", beforeData: { affectsActiveSchedule: true, workingDays: [1, 2, 3, 4, 5] }, afterData: { affectsActiveSchedule: true, workingDays: [1, 2, 3, 4, 5, 6] }, projectRevision: 5 },
    { entityType: "calendarException", action: "create", beforeData: null, afterData: { affectsActiveSchedule: true, exceptionDate: "2026-09-14", isWorking: false }, projectRevision: 5 },
    { entityType: "baseline", action: "capture", beforeData: null, afterData: {}, projectRevision: 5 },
  ];
  const staleness = {
    driving: events.map((e) => ({ ...e, drives: isCpmDrivingEvent(e as never) })),
    outOfDate: [
      isScheduleOutOfDate(4, events as never),
      isScheduleOutOfDate(5, events as never),
      isScheduleOutOfDate(null, events as never),
      isScheduleOutOfDate(5, [{ entityType: "baseline", action: "capture", beforeData: null, afterData: {}, projectRevision: 6 }] as never),
    ],
  };

  return { scheduling, calendars, durations, progress, derived, statusing, variance, staleness };
}
