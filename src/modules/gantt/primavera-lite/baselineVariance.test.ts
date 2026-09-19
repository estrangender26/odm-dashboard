import { describe, expect, it } from "vitest";
import {
  BASELINE_STATUS_LABELS,
  BASELINE_STATUS_SYMBOLS,
  baselineCapturedDate,
  buildProjectComparison,
  calendarDayVariance,
  compareActivityToBaseline,
  currentDurationDays,
  describeBaselineState,
  durationDayVariance,
  maxIso,
  minIso,
  selectActiveBaseline,
  type BaselineComparisonRow,
  type BaselineSnapshotInput,
  type CurrentActivityInput,
} from "./baselineVariance";
import type { ScheduleCalendarInput } from "./schedulingEngine";

/** Mon–Fri standard calendar. 2026-02-16 is a Monday. */
const CAL: ScheduleCalendarInput = {
  id: 1,
  name: "Standard",
  workingDays: [1, 2, 3, 4, 5],
};

function snapshot(overrides: Partial<BaselineSnapshotInput> = {}): BaselineSnapshotInput {
  return {
    snapshotId: 11,
    activityId: 501,
    activityCode: "A100",
    activityName: "Excavate",
    wbsNodeId: 7,
    wbsCode: "1.1",
    wbsName: "Civil",
    calendarId: 1,
    calendarName: "Standard",
    originalDurationDays: 5,
    scheduledStart: "2026-02-16",
    scheduledFinish: "2026-02-20",
    ...overrides,
  };
}

function current(overrides: Partial<CurrentActivityInput> = {}): CurrentActivityInput {
  return {
    id: 501,
    activityCode: "A100",
    activityName: "Excavate",
    wbsNodeId: 7,
    activityType: "task",
    originalDurationDays: 5,
    remainingDurationDays: 0,
    percentComplete: 0,
    earlyStart: "2026-02-16",
    earlyFinish: "2026-02-20",
    ...overrides,
  };
}

describe("calendarDayVariance — sign convention", () => {
  it("is 0 when the forecast matches the baseline", () => {
    expect(calendarDayVariance("2026-02-20", "2026-02-20")).toBe(0);
  });

  it("is POSITIVE when the forecast is later than the baseline", () => {
    expect(calendarDayVariance("2026-02-25", "2026-02-20")).toBe(5);
  });

  it("is NEGATIVE when the forecast is earlier than the baseline", () => {
    expect(calendarDayVariance("2026-02-17", "2026-02-20")).toBe(-3);
  });

  it("counts CALENDAR days, not working days (weekend is included)", () => {
    // Fri 2026-02-20 -> Mon 2026-02-23 is 3 calendar days but 1 working day.
    expect(calendarDayVariance("2026-02-23", "2026-02-20")).toBe(3);
  });

  it("is null (never 0) when either date is missing or unusable", () => {
    expect(calendarDayVariance(null, "2026-02-20")).toBeNull();
    expect(calendarDayVariance("2026-02-20", null)).toBeNull();
    expect(calendarDayVariance(undefined, undefined)).toBeNull();
    expect(calendarDayVariance("not-a-date", "2026-02-20")).toBeNull();
  });

  it("normalises Date values and timestamps without shifting the day", () => {
    expect(calendarDayVariance(new Date("2026-02-20T00:00:00.000Z"), "2026-02-16")).toBe(4);
    expect(calendarDayVariance("2026-02-20T15:00:00.000Z", "2026-02-16T00:00:00.000Z")).toBe(4);
  });
});

describe("currentDurationDays — working-day duration authority", () => {
  it("uses the engine duration for a not-started multi-day activity", () => {
    expect(currentDurationDays(current({ originalDurationDays: 5 }), CAL)).toBe(5);
  });

  it("reports 1 working day for a one-day activity whose start and finish coincide", () => {
    expect(
      currentDurationDays(
        current({ originalDurationDays: 1, earlyStart: "2026-02-16", earlyFinish: "2026-02-16" }),
        CAL
      )
    ).toBe(1);
  });

  it("reports 0 for a zero-duration activity instead of the 1 a same-day span suggests", () => {
    expect(
      currentDurationDays(
        current({ originalDurationDays: 0, earlyStart: "2026-02-16", earlyFinish: "2026-02-16" }),
        CAL
      )
    ).toBe(0);
  });

  it("reports 0 for a milestone", () => {
    expect(
      currentDurationDays(
        current({
          activityType: "milestone",
          originalDurationDays: 0,
          earlyStart: "2026-02-16",
          earlyFinish: "2026-02-16",
        }),
        CAL
      )
    ).toBe(0);
  });

  it("uses the remaining duration the CPM pass actually places for in-progress work", () => {
    expect(
      currentDurationDays(
        current({ percentComplete: 40, remainingDurationDays: 3, originalDurationDays: 10 }),
        CAL
      )
    ).toBe(3);
  });

  it("derives the outstanding duration from % complete when remaining is the 0 default", () => {
    expect(
      currentDurationDays(
        current({ percentComplete: 40, remainingDurationDays: 0, originalDurationDays: 10 }),
        CAL
      )
    ).toBe(6);
  });

  it("reports the elapsed ACTUAL span for completed work, not the engine's 0 remaining", () => {
    expect(
      currentDurationDays(
        current({
          percentComplete: 100,
          originalDurationDays: 5,
          actualStart: "2026-02-16",
          actualFinish: "2026-02-24",
          earlyStart: "2026-02-16",
          earlyFinish: "2026-02-24",
        }),
        CAL
      )
    ).toBe(7);
  });

  it("counts a completed span against the supplied calendar, excluding its non-working exception day", () => {
    // Mon-Fri calendar with Mon 2026-02-23 marked as a non-working holiday.
    const withHoliday: ScheduleCalendarInput = {
      ...CAL,
      exceptions: [{ exceptionDate: "2026-02-23", isWorking: false }],
    };
    // Actual span Mon 2026-02-16 .. Fri 2026-02-27 = 10 working days normally,
    // 9 once the holiday is excluded. This is the calendar the CALLER supplies,
    // which for current-duration must be the activity's own calendar.
    expect(
      currentDurationDays(
        current({
          percentComplete: 100,
          originalDurationDays: 10,
          actualStart: "2026-02-16",
          actualFinish: "2026-02-27",
          earlyStart: "2026-02-16",
          earlyFinish: "2026-02-27",
        }),
        withHoliday
      )
    ).toBe(9);
    // The same dates on a calendar without the holiday still count 10.
    expect(
      currentDurationDays(
        current({
          percentComplete: 100,
          originalDurationDays: 10,
          actualStart: "2026-02-16",
          actualFinish: "2026-02-27",
          earlyStart: "2026-02-16",
          earlyFinish: "2026-02-27",
        }),
        CAL
      )
    ).toBe(10);
  });

  it("is null when the current schedule has no dates for the activity", () => {
    expect(currentDurationDays(current({ earlyStart: null, earlyFinish: null }), CAL)).toBeNull();
    expect(currentDurationDays(current({ earlyStart: "2026-02-16", earlyFinish: null }), CAL)).toBeNull();
  });
});

describe("durationDayVariance", () => {
  it("is POSITIVE when the forecast duration is longer", () => {
    expect(durationDayVariance(7, 5)).toBe(2);
  });

  it("is NEGATIVE when the forecast duration is shorter", () => {
    expect(durationDayVariance(3, 5)).toBe(-2);
  });

  it("is 0 when unchanged and null when not comparable", () => {
    expect(durationDayVariance(5, 5)).toBe(0);
    expect(durationDayVariance(null, 5)).toBeNull();
    expect(durationDayVariance(5, null)).toBeNull();
  });
});

describe("compareActivityToBaseline", () => {
  it("reports zero variance for an unchanged activity", () => {
    const row = compareActivityToBaseline({ snapshot: snapshot(), current: current(), calendar: CAL });
    expect(row.startVariance).toBe(0);
    expect(row.finishVariance).toBe(0);
    expect(row.durationVariance).toBe(0);
    expect(row.status).toBe("on-baseline");
    expect(row.hasBaseline).toBe(true);
    expect(row.currentMissing).toBe(false);
  });

  it("keeps identical variances whether or not the activity was renamed or recoded", () => {
    const renamed = compareActivityToBaseline({
      snapshot: snapshot(),
      current: current({ activityName: "Excavate (revised)", activityCode: "A100-R1", wbsNodeId: 9 }),
      calendar: CAL,
    });
    // Identity is the stable activityId: a rename/recode/WBS move is not variance.
    expect(renamed.startVariance).toBe(0);
    expect(renamed.finishVariance).toBe(0);
    expect(renamed.status).toBe("on-baseline");
  });

  it("reports a late finish and an on-time start independently", () => {
    const row = compareActivityToBaseline({
      snapshot: snapshot(),
      current: current({ earlyStart: "2026-02-16", earlyFinish: "2026-02-25" }),
      calendar: CAL,
    });
    expect(row.startVariance).toBe(0);
    expect(row.finishVariance).toBe(5);
    expect(row.status).toBe("late");
  });

  it("reports an early finish as negative and Ahead", () => {
    const row = compareActivityToBaseline({
      snapshot: snapshot(),
      current: current({ earlyStart: "2026-02-16", earlyFinish: "2026-02-17" }),
      calendar: CAL,
    });
    expect(row.finishVariance).toBe(-3);
    expect(row.status).toBe("ahead");
  });

  it("reports a longer duration as a positive duration variance in working days", () => {
    const row = compareActivityToBaseline({
      snapshot: snapshot({ originalDurationDays: 5 }),
      current: current({ originalDurationDays: 8, earlyFinish: "2026-02-25" }),
      calendar: CAL,
    });
    expect(row.baselineDurationDays).toBe(5);
    expect(row.currentDurationDays).toBe(8);
    expect(row.durationVariance).toBe(3);
  });

  it("represents an activity ADDED after the baseline with null variances and no invented dates", () => {
    const row = compareActivityToBaseline({
      snapshot: null,
      current: current({ id: 900, activityName: "New scope" }),
      calendar: CAL,
    });
    expect(row.status).toBe("new-since-baseline");
    expect(row.hasBaseline).toBe(false);
    expect(row.snapshotId).toBeNull();
    expect(row.baselineScheduledStart).toBeNull();
    expect(row.baselineScheduledFinish).toBeNull();
    expect(row.baselineDurationDays).toBeNull();
    expect(row.startVariance).toBeNull();
    expect(row.finishVariance).toBeNull();
    expect(row.durationVariance).toBeNull();
    // The current schedule is still reported for the new activity.
    expect(row.currentScheduledFinish).toBe("2026-02-20");
  });

  it("represents a baseline activity REMOVED since the baseline with null variances", () => {
    const row = compareActivityToBaseline({ snapshot: snapshot(), current: null, calendar: CAL });
    expect(row.status).toBe("removed");
    expect(row.hasBaseline).toBe(true);
    expect(row.currentMissing).toBe(true);
    expect(row.currentScheduledStart).toBeNull();
    expect(row.currentDurationDays).toBeNull();
    expect(row.startVariance).toBeNull();
    expect(row.finishVariance).toBeNull();
    expect(row.durationVariance).toBeNull();
    // Approved history survives the removal.
    expect(row.baselineScheduledStart).toBe("2026-02-16");
    expect(row.baselineScheduledFinish).toBe("2026-02-20");
    expect(row.baselineDurationDays).toBe(5);
  });

  it("treats an archived activity as removed from the current schedule, keeping its baseline", () => {
    const row = compareActivityToBaseline({
      snapshot: snapshot(),
      // Archived activities are excluded from Run Schedule, so their stored
      // early dates are stale leftovers that must never be presented as the
      // current forecast.
      current: current({ archivedAt: new Date("2026-03-01T00:00:00.000Z"), earlyFinish: "2026-02-27" }),
      calendar: CAL,
    });
    expect(row.status).toBe("removed");
    expect(row.currentArchivedAt).not.toBeNull();
    // The shipped meaning of currentMissing is "the row is gone entirely".
    expect(row.currentMissing).toBe(false);
    expect(row.currentScheduledStart).toBeNull();
    expect(row.currentScheduledFinish).toBeNull();
    expect(row.currentDurationDays).toBeNull();
    expect(row.startVariance).toBeNull();
    expect(row.finishVariance).toBeNull();
    expect(row.durationVariance).toBeNull();
    // Approved history survives archiving.
    expect(row.baselineScheduledStart).toBe("2026-02-16");
    expect(row.baselineScheduledFinish).toBe("2026-02-20");
    expect(row.baselineDurationDays).toBe(5);
  });

  it("uses 'undated' when a baseline row has no comparable dates", () => {
    const row = compareActivityToBaseline({
      snapshot: snapshot({ scheduledFinish: null }),
      current: current(),
      calendar: CAL,
    });
    expect(row.finishVariance).toBeNull();
    expect(row.status).toBe("undated");
  });

  it("falls back to current identity for an added activity and snapshot identity otherwise", () => {
    const added = compareActivityToBaseline({
      snapshot: null,
      current: current({ id: 42, activityCode: null, activityName: "Added", wbsNodeId: 3 }),
      calendar: CAL,
    });
    expect(added.activityId).toBe(42);
    expect(added.activityName).toBe("Added");
    expect(added.wbsNodeId).toBe(3);

    const matched = compareActivityToBaseline({
      snapshot: snapshot({ activityName: "Excavate" }),
      current: current({ activityName: "Renamed later" }),
      calendar: CAL,
    });
    expect(matched.activityId).toBe(501);
    expect(matched.activityName).toBe("Excavate");
  });

  it("keeps originalDurationDays as a backward-compatible alias of the approved duration", () => {
    const withBaseline = compareActivityToBaseline({ snapshot: snapshot(), current: current(), calendar: CAL });
    expect(withBaseline.originalDurationDays).toBe(withBaseline.baselineDurationDays);
    const withoutBaseline = compareActivityToBaseline({ snapshot: null, current: current(), calendar: CAL });
    expect(withoutBaseline.originalDurationDays).toBeNull();
  });
});

describe("every status has text and a non-colour symbol", () => {
  it("covers the full vocabulary", () => {
    const statuses = ["ahead", "on-baseline", "late", "undated", "removed", "new-since-baseline"] as const;
    for (const status of statuses) {
      expect(BASELINE_STATUS_LABELS[status]).toBeTruthy();
      expect(BASELINE_STATUS_SYMBOLS[status]).toBeTruthy();
    }
  });
});

describe("buildProjectComparison", () => {
  function rows(): BaselineComparisonRow[] {
    return [
      compareActivityToBaseline({ snapshot: snapshot(), current: current(), calendar: CAL }),
      compareActivityToBaseline({
        snapshot: snapshot({ snapshotId: 12, activityId: 502, activityCode: "A200", originalDurationDays: 3, scheduledStart: "2026-02-23", scheduledFinish: "2026-02-25" }),
        current: current({ id: 502, activityCode: "A200", earlyStart: "2026-02-23", earlyFinish: "2026-02-27", originalDurationDays: 5 }),
        calendar: CAL,
      }),
      compareActivityToBaseline({ snapshot: null, current: current({ id: 503, activityName: "Added", earlyStart: "2026-03-02", earlyFinish: "2026-03-03" }), calendar: CAL }),
      compareActivityToBaseline({ snapshot: snapshot({ snapshotId: 13, activityId: 504, activityCode: "A300", scheduledStart: "2026-02-18", scheduledFinish: "2026-02-19" }), current: null, calendar: CAL }),
    ];
  }

  it("rolls approved start/finish from the snapshots and compares project finish", () => {
    const summary = buildProjectComparison({
      rows: rows(),
      baselineActivityCount: 3,
      currentProjectFinish: "2026-03-03",
    });
    expect(summary.baselineStart).toBe("2026-02-16");
    expect(summary.baselineFinish).toBe("2026-02-25");
    expect(summary.currentStart).toBe("2026-02-16");
    expect(summary.currentFinish).toBe("2026-03-03");
    expect(summary.finishVariance).toBe(6);
    expect(summary.startVariance).toBe(0);
    expect(summary.baselineActivityCount).toBe(3);
    expect(summary.newSinceBaselineCount).toBe(1);
    expect(summary.removedSinceBaselineCount).toBe(1);
  });

  it("counts each status and keeps project variance null when a side is missing", () => {
    const summary = buildProjectComparison({
      rows: rows(),
      baselineActivityCount: 3,
      currentProjectFinish: null,
    });
    expect(summary.statusCounts["on-baseline"]).toBe(1);
    expect(summary.statusCounts.late).toBe(1);
    expect(summary.statusCounts["new-since-baseline"]).toBe(1);
    expect(summary.statusCounts.removed).toBe(1);
    expect(summary.finishVariance).toBeNull();
  });

  it("reports project completion earlier as a negative finish variance", () => {
    const summary = buildProjectComparison({
      rows: rows(),
      baselineActivityCount: 3,
      currentProjectFinish: "2026-02-20",
    });
    expect(summary.finishVariance).toBe(-5);
  });
});

describe("minIso / maxIso", () => {
  it("ignore nulls and empty input", () => {
    expect(minIso([null, null])).toBeNull();
    expect(maxIso([])).toBeNull();
    expect(minIso(["2026-02-16", null, "2026-01-01"])).toBe("2026-01-01");
    expect(maxIso(["2026-02-16", null, "2026-01-01"])).toBe("2026-02-16");
  });
});

describe("baselineCapturedDate — naive timestamp day-shift guard", () => {
  it("reports the stored wall-clock date for a local midnight-adjacent timestamp", () => {
    // Local 2026-02-16 00:30. In any positive UTC offset toISOString() would be
    // 2026-02-15, which must NOT be what a baseline reports.
    expect(baselineCapturedDate(new Date(2026, 1, 16, 0, 30))).toBe("2026-02-16");
  });

  it("passes through ISO strings, including a DB driver string form", () => {
    expect(baselineCapturedDate("2026-02-16 00:30:00")).toBe("2026-02-16");
    expect(baselineCapturedDate("2026-02-16T00:30:00.000Z")).toBe("2026-02-16");
  });

  it("is null for missing or invalid input", () => {
    expect(baselineCapturedDate(null)).toBeNull();
    expect(baselineCapturedDate(undefined)).toBeNull();
    expect(baselineCapturedDate("")).toBeNull();
    expect(baselineCapturedDate(new Date("nonsense"))).toBeNull();
    expect(baselineCapturedDate("garbage")).toBeNull();
  });
});

describe("describeBaselineState / selectActiveBaseline", () => {
  it("reports the not-established state with a null baseline id", () => {
    const state = describeBaselineState(null);
    expect(state.established).toBe(false);
    expect(state.activeBaselineId).toBeNull();
    expect(state.label).toBe("Baseline: Not established");
  });

  it("reports established state with the captured date and actor", () => {
    const state = describeBaselineState({
      id: 3,
      name: "Approved Rev A",
      capturedAt: new Date(2026, 1, 16, 9, 0),
      capturedByName: "Gerald",
    });
    expect(state.established).toBe(true);
    expect(state.activeBaselineId).toBe(3);
    expect(state.label).toBe("Baseline: Established (2026-02-16)");
    expect(state.capturedByName).toBe("Gerald");
  });

  it("treats the most recently captured baseline as active, deterministically", () => {
    expect(selectActiveBaseline([])).toBeNull();
    const active = selectActiveBaseline([
      { id: 4, name: "Rev A" },
      { id: 9, name: "Rev B" },
      { id: 7, name: "Rev C" },
    ]);
    expect(active?.id).toBe(9);
    expect(active?.name).toBe("Rev B");
  });
});
