/**
 * statusingModel.ts — deterministic project statusing roll-up for Primavera Lite.
 *
 * Answers, from authoritative stored facts only:
 *   - what has not started / is in progress / has completed;
 *   - what actually started and what actually finished;
 *   - how much forecast working duration remains;
 *   - what the remaining schedule forecasts after progress is entered.
 *
 * Design rules (frozen for this feature):
 *  - PURE: no I/O, no clock, no mutation. Every value is derived from the
 *    activity rows + the project Data Date, so the same inputs always produce
 *    the same summary.
 *  - NO DUPLICATED STATE: activity lifecycle is derived from the execution
 *    facts through progressModel.deriveProgressState (the single canonical
 *    rule shared with the server), never from the stored status string.
 *  - NO DUPLICATED DURATION LOGIC: remaining forecast days come from the
 *    scheduling engine's own getWorkingDuration, so what the panel reports is
 *    exactly what Run Schedule will place on the calendar.
 *  - NO CLOCK FALLBACK: a missing Data Date is reported as a warning, never
 *    silently replaced with today's date.
 *  - READ-ONLY: archiving an activity removes it from the roll-up because it
 *    is no longer current work.
 */
import {
  deriveProgressState,
  normalizeIsoDate,
  type ProgressStatus,
} from "./progressModel";
import { getWorkingDuration } from "./schedulingEngine";

/** Canonical activity lifecycle, identical to the server's derived status. */
export type ActivityLifecycle = ProgressStatus;

export const LIFECYCLE_LABELS: Record<ActivityLifecycle, string> = {
  "not-started": "Not started",
  "in-progress": "In progress",
  completed: "Completed",
};

/**
 * Status chip styling. Deliberately reuses the module's existing semantic
 * palette (slate = no execution fact, blue = work under way, emerald = the
 * same green the Timeline already uses for recorded actuals).
 */
export const LIFECYCLE_CHIP_CLASS: Record<ActivityLifecycle, string> = {
  "not-started": "border-slate-300 bg-slate-50 text-slate-600",
  "in-progress": "border-blue-300 bg-blue-50 text-blue-700",
  completed: "border-emerald-300 bg-emerald-50 text-emerald-700",
};

export interface StatusingActivityInput {
  id: number;
  wbsNodeId: number;
  activityName: string;
  activityType?: string | null;
  originalDurationDays?: number | null;
  remainingDurationDays?: number | null;
  percentComplete?: number | null;
  actualStart?: string | null;
  actualFinish?: string | null;
  earlyFinish?: string | null;
  status?: string | null;
  archivedAt?: string | Date | null;
}

/** Lifecycle derived from execution facts — never from the stored status. */
export function activityLifecycle(activity: StatusingActivityInput): ActivityLifecycle {
  return deriveProgressState(
    activity.percentComplete ?? 0,
    normalizeIsoDate(activity.actualStart),
    normalizeIsoDate(activity.actualFinish)
  );
}

/**
 * Forecast working duration the schedule will still place on the calendar for
 * this activity. Delegates to the engine so the panel and Run Schedule can
 * never disagree (completed = 0, explicit Remaining Duration wins, otherwise
 * derived from % complete, otherwise the original duration).
 */
export function forecastRemainingDays(activity: StatusingActivityInput): number {
  const days = getWorkingDuration({
    id: activity.id,
    wbsNodeId: activity.wbsNodeId,
    activityName: activity.activityName,
    activityType: activity.activityType ?? null,
    originalDurationDays: activity.originalDurationDays ?? 0,
    remainingDurationDays: activity.remainingDurationDays ?? undefined,
    percentComplete: activity.percentComplete ?? 0,
  });
  return Number.isFinite(days) && days > 0 ? days : 0;
}

/** True when the row is current work (archived rows are excluded everywhere). */
export function isCurrentWork(activity: StatusingActivityInput): boolean {
  return activity.archivedAt == null;
}

export type StatusingWarningCode =
  | "data-date-not-set"
  | "schedule-not-run"
  | "schedule-stale"
  | "progress-without-actual-start"
  | "completed-without-actual-start"
  | "actuals-after-data-date";

export interface StatusingWarning {
  code: StatusingWarningCode;
  message: string;
  /** Affected activities (empty for project-level warnings). */
  activityIds: number[];
}

export interface StatusingSummary {
  /** Stored project Data Date ('YYYY-MM-DD') or null when it was never set. */
  dataDate: string | null;
  /**
   * False when no Data Date is stored: the schedule then falls back to the
   * current date, so statusing is not yet repeatable across days.
   */
  dataDateIsSet: boolean;
  total: number;
  notStarted: number;
  inProgress: number;
  completed: number;
  /** Activities carrying an Actual Start / Actual Finish fact. */
  actualStarted: number;
  actualFinished: number;
  latestActualStart: string | null;
  latestActualFinish: string | null;
  /** Sum of forecast remaining working days across unfinished current work. */
  totalRemainingDays: number;
  /** Latest Early Finish of unfinished current work — the post-progress forecast. */
  forecastFinish: string | null;
  /** Latest Early Finish across all current work. */
  projectFinish: string | null;
  /** True when at least one current activity carries engine-computed dates. */
  scheduleCalculated: boolean;
  warnings: StatusingWarning[];
}

const isIso = (value: unknown): value is string => normalizeIsoDate(value) !== null;
const maxIso = (values: Array<string | null>): string | null =>
  values.reduce<string | null>((max, value) => (value != null && (max == null || value > max) ? value : max), null);

/**
 * Deterministic roll-up of the current (non-archived) activity set.
 *
 * Archived activities are excluded: they are retained for history and are not
 * part of what is left to do. The Data Date is reported exactly as stored.
 */
export function summarizeStatusing(
  activities: StatusingActivityInput[],
  dataDate: string | null | undefined
): StatusingSummary {
  const dd = normalizeIsoDate(dataDate);
  const current = activities.filter(isCurrentWork);

  let notStarted = 0;
  let inProgress = 0;
  let completed = 0;
  let actualStarted = 0;
  let actualFinished = 0;
  let totalRemainingDays = 0;
  let scheduleCalculated = false;

  const progressWithoutStart: number[] = [];
  const completedWithoutStart: number[] = [];
  const actualsAfterDataDate: number[] = [];
  const unfinishedEarlyFinish: Array<string | null> = [];
  const allEarlyFinish: Array<string | null> = [];

  for (const activity of current) {
    const lifecycle = activityLifecycle(activity);
    const actualStart = normalizeIsoDate(activity.actualStart);
    const actualFinish = normalizeIsoDate(activity.actualFinish);
    const earlyFinish = normalizeIsoDate(activity.earlyFinish);
    if (earlyFinish) scheduleCalculated = true;
    allEarlyFinish.push(earlyFinish);

    if (lifecycle === "completed") completed += 1;
    else if (lifecycle === "in-progress") inProgress += 1;
    else notStarted += 1;

    if (actualStart) actualStarted += 1;
    if (actualFinish) actualFinished += 1;

    if (lifecycle !== "completed") {
      totalRemainingDays += forecastRemainingDays(activity);
      unfinishedEarlyFinish.push(earlyFinish);
    }

    // Data-quality signals. These are reported, never silently repaired: the
    // stored facts are the owner's record and this panel must not rewrite them.
    if ((activity.percentComplete ?? 0) > 0 && !actualStart) {
      if (lifecycle === "completed") completedWithoutStart.push(activity.id);
      else progressWithoutStart.push(activity.id);
    }
    if (dd != null) {
      const startBeyond = actualStart != null && actualStart > dd;
      const finishBeyond = actualFinish != null && actualFinish > dd;
      if (startBeyond || finishBeyond) actualsAfterDataDate.push(activity.id);
    }
  }

  const warnings: StatusingWarning[] = [];
  if (!isIso(dd)) {
    warnings.push({
      code: "data-date-not-set",
      message:
        "No Data Date is stored, so the schedule is anchored on the current date and statusing is not repeatable across days. Set an explicit Data Date.",
      activityIds: [],
    });
  }
  if (current.length > 0 && !scheduleCalculated) {
    warnings.push({
      code: "schedule-not-run",
      message: "The schedule has not been calculated yet, so no forecast finish is available.",
      activityIds: [],
    });
  }
  if (progressWithoutStart.length > 0) {
    warnings.push({
      code: "progress-without-actual-start",
      message:
        progressWithoutStart.length === 1
          ? "1 activity has progress recorded but no Actual Start."
          : `${progressWithoutStart.length} activities have progress recorded but no Actual Start.`,
      activityIds: progressWithoutStart,
    });
  }
  if (completedWithoutStart.length > 0) {
    warnings.push({
      code: "completed-without-actual-start",
      message:
        completedWithoutStart.length === 1
          ? "1 completed activity has no recorded Actual Start."
          : `${completedWithoutStart.length} completed activities have no recorded Actual Start.`,
      activityIds: completedWithoutStart,
    });
  }
  if (actualsAfterDataDate.length > 0) {
    warnings.push({
      code: "actuals-after-data-date",
      message:
        actualsAfterDataDate.length === 1
          ? `1 activity has an actual date after the Data Date (${dd}).`
          : `${actualsAfterDataDate.length} activities have actual dates after the Data Date (${dd}).`,
      activityIds: actualsAfterDataDate,
    });
  }

  return {
    dataDate: dd,
    dataDateIsSet: dd != null,
    total: current.length,
    notStarted,
    inProgress,
    completed,
    actualStarted,
    actualFinished,
    latestActualStart: maxIso(current.map((a) => normalizeIsoDate(a.actualStart))),
    latestActualFinish: maxIso(current.map((a) => normalizeIsoDate(a.actualFinish))),
    totalRemainingDays,
    forecastFinish: maxIso(unfinishedEarlyFinish),
    projectFinish: maxIso(allEarlyFinish),
    scheduleCalculated,
    warnings,
  };
}
