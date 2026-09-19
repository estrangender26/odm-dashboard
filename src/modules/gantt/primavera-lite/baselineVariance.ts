/**
 * Primavera Lite — Baseline schedule variance foundation.
 *
 * A baseline is the frozen, approved reference schedule. It is persisted as an
 * immutable snapshot pair (`gantt_baselines` + `gantt_baseline_activities`,
 * migration 0030) that is deliberately detached from live activities and WBS
 * nodes, so editing, archiving or deleting live rows can never rewrite approved
 * history.
 *
 * This module only DERIVES comparisons. It never mutates a baseline, a current
 * activity, or any progress/scheduling field: variance is always
 * "frozen baseline" + "current schedule output", never an input to scheduling.
 *
 * Locked semantics (each is covered by tests):
 *
 * 1. DATE variance is measured in CALENDAR days and is always
 *    `current - baseline`, so POSITIVE = LATER, NEGATIVE = EARLIER, ZERO = on
 *    baseline. This is the convention the shipped `compareBaseline` contract
 *    already uses, so it is preserved rather than re-invented.
 * 2. DURATION variance is measured in WORKING days, because durations in
 *    Primavera Lite are working-day quantities (the scheduling engine's
 *    `addWorkingDays` / `subWorkingDays` / `countWorkingDays`). Comparing a
 *    working-day duration against a calendar-day count would be a unit error.
 * 3. "Current" always means the CURRENT / FORECAST schedule (the CPM early
 *    dates the schedule engine produced). It is never the baseline and it is
 *    never called an actual: Actual Start / Actual Finish remain execution
 *    facts owned by the progress model.
 * 4. Variance is never fabricated. When a comparison cannot be made it is
 *    `null` ("not applicable") — never `0`. An activity added after the
 *    baseline has no baseline dates; an activity removed since the baseline has
 *    no current dates.
 * 5. Activity identity is the stable internal `activityId`. Names and activity
 *    codes are carried along for readability only and are never used to join a
 *    baseline row to a current row.
 * 6. The module is pure: no `Date.now()`, no clock reads, no locale-dependent
 *    formatting, so results are deterministic and testable.
 */

import {
  countWorkingDays,
  dateToCalendarDay,
  getWorkingDuration,
  type ScheduleCalendarInput,
} from "./schedulingEngine";
import { normalizeIsoDate } from "./progressModel";

/** How a current-schedule activity stands against the approved baseline. */
export type BaselineVarianceStatus =
  | "ahead"
  | "on-baseline"
  | "late"
  | "undated"
  | "removed"
  | "new-since-baseline";

/**
 * Human-readable status vocabulary. Status is always rendered as TEXT (plus a
 * symbol), never as colour alone.
 */
export const BASELINE_STATUS_LABELS: Record<BaselineVarianceStatus, string> = {
  ahead: "Ahead of baseline",
  "on-baseline": "On baseline",
  late: "Behind baseline",
  undated: "No comparable dates",
  removed: "Removed since baseline",
  "new-since-baseline": "New since baseline",
};

/** Non-colour indicator paired with every status label. */
export const BASELINE_STATUS_SYMBOLS: Record<BaselineVarianceStatus, string> = {
  ahead: "▼",
  "on-baseline": "=",
  late: "▲",
  undated: "–",
  removed: "×",
  "new-since-baseline": "+",
};

export interface BaselineSnapshotInput {
  snapshotId: number;
  activityId: number;
  activityCode: string | null;
  activityName: string;
  wbsNodeId: number;
  wbsCode?: string | null;
  wbsName?: string | null;
  calendarId?: number | null;
  calendarName?: string | null;
  /** Approved duration in working days, as stored when the baseline was captured. */
  originalDurationDays: number;
  scheduledStart?: unknown;
  scheduledFinish?: unknown;
}

export interface CurrentActivityInput {
  id: number;
  activityCode?: string | null;
  activityName?: string | null;
  wbsNodeId?: number | null;
  wbsCode?: string | null;
  wbsName?: string | null;
  activityType?: string | null;
  originalDurationDays?: number | null;
  remainingDurationDays?: number | null;
  percentComplete?: number | null;
  actualStart?: unknown;
  actualFinish?: unknown;
  earlyStart?: unknown;
  earlyFinish?: unknown;
  archivedAt?: Date | string | null;
}

export interface BaselineComparisonRow {
  snapshotId: number | null;
  activityId: number;
  activityCode: string | null;
  activityName: string;
  wbsNodeId: number | null;
  wbsCode: string | null;
  wbsName: string | null;
  calendarId: number | null;
  calendarName: string | null;

  /**
   * Approved (baseline) duration in working days. `originalDurationDays` is the
   * same value under its shipped name and is retained for backward
   * compatibility with existing compareBaseline consumers.
   */
  baselineDurationDays: number | null;
  originalDurationDays: number | null;

  baselineScheduledStart: string | null;
  baselineScheduledFinish: string | null;
  currentScheduledStart: string | null;
  currentScheduledFinish: string | null;

  /** Working-day duration carried by the current schedule. Never an actual. */
  currentDurationDays: number | null;

  /** Calendar days: current forecast minus baseline. Positive = later. */
  startVariance: number | null;
  finishVariance: number | null;
  /** Working days: current forecast duration minus approved duration. Positive = longer. */
  durationVariance: number | null;

  status: BaselineVarianceStatus;
  statusLabel: string;
  statusSymbol: string;

  /** True when this row is joined to a baseline snapshot. */
  hasBaseline: boolean;
  currentArchivedAt: Date | string | null;
  currentMissing: boolean;
}

/**
 * Calendar-day difference between a current/forecast date and a baseline date.
 * Positive = the current schedule is LATER than the approved baseline.
 */
export function calendarDayVariance(
  currentDate: unknown,
  baselineDate: unknown
): number | null {
  const current = normalizeIsoDate(currentDate);
  const baseline = normalizeIsoDate(baselineDate);
  if (!current || !baseline) return null;
  return dateToCalendarDay(current) - dateToCalendarDay(baseline);
}

export function durationDayVariance(
  currentDurationDays: number | null,
  baselineDurationDays: number | null
): number | null {
  if (currentDurationDays == null || baselineDurationDays == null) return null;
  return currentDurationDays - baselineDurationDays;
}

export function isMilestoneActivity(activityType: string | null | undefined): boolean {
  return (activityType ?? "").trim().toLowerCase() === "milestone";
}

function isCompleted(activity: CurrentActivityInput): boolean {
  return (activity.percentComplete ?? 0) === 100;
}

/**
 * The working-day duration the current schedule carries for an activity.
 *
 * - Unfinished work: exactly the duration the CPM forward pass places, taken
 *   from the engine itself (`getWorkingDuration`) so the baseline comparison can
 *   never disagree with Run Schedule. This also makes a zero-duration activity
 *   and a milestone report `0` instead of the `1` that a same-day date span
 *   would otherwise suggest.
 * - Completed work: the engine treats a completed activity as having no
 *   remaining work (duration `0`), which is NOT its duration. The observable
 *   span between its forecast dates (which are its actual dates) is reported
 *   instead, so a 5-day activity that actually ran 7 days shows 7.
 *
 * Returns `null` when the schedule has not produced both dates.
 */
export function currentDurationDays(
  activity: CurrentActivityInput,
  calendar: ScheduleCalendarInput
): number | null {
  const start = normalizeIsoDate(activity.earlyStart);
  const finish = normalizeIsoDate(activity.earlyFinish);
  if (!start || !finish) return null;

  if (!isCompleted(activity)) {
    return getWorkingDuration({
      id: activity.id,
      wbsNodeId: activity.wbsNodeId ?? 0,
      activityName: activity.activityName ?? "",
      activityType: activity.activityType ?? null,
      originalDurationDays: activity.originalDurationDays ?? 0,
      remainingDurationDays: activity.remainingDurationDays ?? undefined,
      percentComplete: activity.percentComplete ?? 0,
    });
  }

  const startDay = dateToCalendarDay(start);
  const finishDay = dateToCalendarDay(finish);
  if (finishDay < startDay) return 0;
  return countWorkingDays(startDay, finishDay, calendar);
}

export function statusForComparison(
  finishVariance: number | null,
  flags: { removed: boolean; added: boolean }
): BaselineVarianceStatus {
  if (flags.added) return "new-since-baseline";
  if (flags.removed) return "removed";
  if (finishVariance == null) return "undated";
  if (finishVariance > 0) return "late";
  if (finishVariance < 0) return "ahead";
  return "on-baseline";
}

/**
 * Compare one baseline snapshot with the current activity that carries the same
 * stable `activityId`.
 *
 * `snapshot === null` describes an activity ADDED after the baseline;
 * `current === null` describes a baseline activity REMOVED since the baseline.
 * Both are first-class states and produce `null` variances, never zeros.
 */
export function compareActivityToBaseline(params: {
  snapshot: BaselineSnapshotInput | null;
  current: CurrentActivityInput | null;
  calendar: ScheduleCalendarInput;
}): BaselineComparisonRow {
  const { snapshot, current, calendar } = params;

  // An archived activity is NOT part of the current schedule: Run Schedule
  // deliberately excludes archived rows, and archiving leaves the activity's
  // early dates behind as stale leftovers. Comparing those leftovers against
  // the approved baseline would report live variance for work that is no longer
  // in the plan, so an archived row is treated as removed from the current
  // schedule while its frozen baseline evidence is preserved in full.
  const isCurrentWorkRow = current != null && current.archivedAt == null;

  const baselineStart = normalizeIsoDate(snapshot?.scheduledStart);
  const baselineFinish = normalizeIsoDate(snapshot?.scheduledFinish);
  const currentStart = isCurrentWorkRow ? normalizeIsoDate(current.earlyStart) : null;
  const currentFinish = isCurrentWorkRow ? normalizeIsoDate(current.earlyFinish) : null;

  const baselineDuration = snapshot ? snapshot.originalDurationDays : null;
  const currentDuration = isCurrentWorkRow ? currentDurationDays(current, calendar) : null;

  const startVariance = calendarDayVariance(currentStart, baselineStart);
  const finishVariance = calendarDayVariance(currentFinish, baselineFinish);
  const durationVariance = durationDayVariance(currentDuration, baselineDuration);

  const status = statusForComparison(finishVariance, {
    removed: snapshot != null && !isCurrentWorkRow,
    added: snapshot == null,
  });

  return {
    snapshotId: snapshot?.snapshotId ?? null,
    // At least one side is always present; the fallback keeps the function
    // total instead of throwing on a caller mistake.
    activityId: snapshot?.activityId ?? current?.id ?? 0,
    activityCode: snapshot?.activityCode ?? current?.activityCode ?? null,
    activityName: snapshot?.activityName ?? current?.activityName ?? "",
    wbsNodeId: snapshot?.wbsNodeId ?? current?.wbsNodeId ?? null,
    wbsCode: snapshot?.wbsCode ?? current?.wbsCode ?? null,
    wbsName: snapshot?.wbsName ?? current?.wbsName ?? null,
    calendarId: snapshot?.calendarId ?? null,
    calendarName: snapshot?.calendarName ?? null,

    baselineDurationDays: baselineDuration,
    originalDurationDays: baselineDuration,

    baselineScheduledStart: baselineStart,
    baselineScheduledFinish: baselineFinish,
    currentScheduledStart: currentStart,
    currentScheduledFinish: currentFinish,

    currentDurationDays: currentDuration,

    startVariance,
    finishVariance,
    durationVariance,

    status,
    statusLabel: BASELINE_STATUS_LABELS[status],
    statusSymbol: BASELINE_STATUS_SYMBOLS[status],

    hasBaseline: snapshot != null,
    currentArchivedAt: current?.archivedAt ?? null,
    currentMissing: snapshot != null && current == null,
  };
}

export function minIso(values: Array<string | null>): string | null {
  let min: string | null = null;
  for (const value of values) {
    if (!value) continue;
    if (min === null || value < min) min = value;
  }
  return min;
}

export function maxIso(values: Array<string | null>): string | null {
  let max: string | null = null;
  for (const value of values) {
    if (!value) continue;
    if (max === null || value > max) max = value;
  }
  return max;
}

export interface BaselineProjectComparison {
  baselineStart: string | null;
  baselineFinish: string | null;
  currentStart: string | null;
  /**
   * Current project finish. Supplied by the caller from the statusing rollup
   * (`summarizeStatusing().projectFinish`) so the application keeps exactly one
   * definition of "project finish".
   */
  currentFinish: string | null;
  startVariance: number | null;
  finishVariance: number | null;
  baselineActivityCount: number;
  newSinceBaselineCount: number;
  removedSinceBaselineCount: number;
  statusCounts: Record<BaselineVarianceStatus, number>;
}

export function buildProjectComparison(params: {
  rows: BaselineComparisonRow[];
  baselineActivityCount: number;
  currentProjectFinish: string | null;
}): BaselineProjectComparison {
  const { rows, baselineActivityCount, currentProjectFinish } = params;

  const statusCounts: Record<BaselineVarianceStatus, number> = {
    ahead: 0,
    "on-baseline": 0,
    late: 0,
    undated: 0,
    removed: 0,
    "new-since-baseline": 0,
  };
  for (const row of rows) statusCounts[row.status] += 1;

  const baselineStart = minIso(rows.map((r) => r.baselineScheduledStart));
  const baselineFinish = maxIso(rows.map((r) => r.baselineScheduledFinish));
  const currentStart = minIso(
    rows.filter((r) => !r.currentMissing).map((r) => r.currentScheduledStart)
  );

  return {
    baselineStart,
    baselineFinish,
    currentStart,
    currentFinish: normalizeIsoDate(currentProjectFinish),
    startVariance: calendarDayVariance(currentStart, baselineStart),
    finishVariance: calendarDayVariance(currentProjectFinish, baselineFinish),
    baselineActivityCount,
    newSinceBaselineCount: rows.filter((r) => r.status === "new-since-baseline").length,
    removedSinceBaselineCount: rows.filter((r) => r.status === "removed").length,
    statusCounts,
  };
}

/**
 * Calendar date (YYYY-MM-DD) of a baseline `captured_at` value.
 *
 * `gantt_baselines.captured_at` is `timestamp WITHOUT time zone`, which the
 * driver materialises at LOCAL midnight. Round-tripping it through
 * `toISOString()` would shift the day backwards for any positive UTC offset
 * (for example 2026-02-16 00:30 in Asia/Manila would report 2026-02-15), so the
 * stored wall-clock date is read from the local components instead.
 */
export function baselineCapturedDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const raw = String(value).trim();
  if (raw === "") return null;
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

export interface ActiveBaselineInput {
  id: number;
  name: string;
  capturedAt?: unknown;
  capturedByName?: string | null;
}

export interface BaselineStateDescription {
  established: boolean;
  activeBaselineId: number | null;
  name: string | null;
  capturedDate: string | null;
  capturedByName: string | null;
  /** Project-level headline, e.g. "Baseline: Not established". */
  label: string;
}

/**
 * Project-level baseline state. The ACTIVE baseline is the most recently
 * captured one; capture is append-only, so replacing a baseline preserves the
 * previous one as history rather than overwriting it.
 */
export function describeBaselineState(
  active: ActiveBaselineInput | null | undefined
): BaselineStateDescription {
  if (!active) {
    return {
      established: false,
      activeBaselineId: null,
      name: null,
      capturedDate: null,
      capturedByName: null,
      label: "Baseline: Not established",
    };
  }
  const capturedDate = baselineCapturedDate(active.capturedAt);
  const suffix = capturedDate ? ` (${capturedDate})` : "";
  return {
    established: true,
    activeBaselineId: active.id,
    name: active.name,
    capturedDate,
    capturedByName: active.capturedByName ?? null,
    label: `Baseline: Established${suffix}`,
  };
}

/**
 * The active baseline of a project: the most recently captured baseline.
 * `gantt_baselines.id` is a serial, so it is the deterministic tiebreaker when
 * two baselines share a timestamp.
 */
export function selectActiveBaseline<T extends { id: number }>(
  baselines: T[]
): T | null {
  if (baselines.length === 0) return null;
  return baselines.reduce((latest, candidate) =>
    candidate.id > latest.id ? candidate : latest
  );
}
