/**
 * Exact PR #345 production smoke data.
 *
 * Data Date = 2026-08-13 (Thursday)
 * Activity A: Planned 2026-08-13..2026-08-17, Actual Start 2026-08-14, Actual Finish null, % < 100, OD 5
 * Activity B: no complete planned date pair, OD 5
 * Activity C: no planned dates, OD 2
 * Dependencies: A -> B FS lag 0, B -> C FS lag 0
 *
 * After a rejected 100% edit (Data Date precedes Actual Start) the user may
 * manually enter Actual Finish = 2026-08-14, which sets A = 100%.
 * Run Schedule then anchors B from A's Actual Finish on the Mon-Fri calendar:
 *   Fri 2026-08-14 + FS 0 -> Mon 2026-08-17
 *   B 5 working days: 17, 18, 19, 20, 21
 *   Fri 2026-08-21 + FS 0 -> Mon 2026-08-24
 *   C 2 working days: 24, 25
 * Planned dates are never rewritten by the schedule run.
 */

export const PR345_DATA_DATE = "2026-08-13";
export const PR345_MANUAL_ACTUAL_FINISH = "2026-08-14";

export const PR345_ACTIVITY_A_INITIAL = {
  activityName: "Activity A",
  plannedStart: "2026-08-13",
  plannedFinish: "2026-08-17",
  actualStart: "2026-08-14",
  actualFinish: null as string | null,
  percentComplete: 25,
  originalDurationDays: 5,
};

export const PR345_ACTIVITY_B = {
  activityName: "Activity B",
  plannedStart: null as string | null,
  plannedFinish: null as string | null,
  actualStart: null as string | null,
  actualFinish: null as string | null,
  percentComplete: 0,
  originalDurationDays: 5,
};

export const PR345_ACTIVITY_C = {
  activityName: "Activity C",
  plannedStart: null as string | null,
  plannedFinish: null as string | null,
  actualStart: null as string | null,
  actualFinish: null as string | null,
  percentComplete: 0,
  originalDurationDays: 2,
};

export const PR345_AFTER_SCHEDULE = {
  A: {
    plannedStart: "2026-08-13",
    plannedFinish: "2026-08-17",
    actualStart: "2026-08-14",
    actualFinish: "2026-08-14",
    percentComplete: 100,
    originalDurationDays: 5,
    earlyStart: "2026-08-14",
    earlyFinish: "2026-08-14",
  },
  B: {
    plannedStart: null as string | null,
    plannedFinish: null as string | null,
    actualStart: null as string | null,
    actualFinish: null as string | null,
    percentComplete: 0,
    originalDurationDays: 5,
    earlyStart: "2026-08-17",
    earlyFinish: "2026-08-21",
  },
  C: {
    plannedStart: null as string | null,
    plannedFinish: null as string | null,
    actualStart: null as string | null,
    actualFinish: null as string | null,
    percentComplete: 0,
    originalDurationDays: 2,
    earlyStart: "2026-08-24",
    earlyFinish: "2026-08-25",
  },
};

/** Mon-Fri working-day span used by the reproduction. */
export const PR345_WORKING_DAYS = {
  b: ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"],
  c: ["2026-08-24", "2026-08-25"],
};
