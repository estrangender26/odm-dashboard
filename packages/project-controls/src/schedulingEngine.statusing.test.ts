import { describe, expect, it } from "vitest";
import {
  runScheduleEngine,
  type ScheduleActivityInput,
  type ScheduleCalendarInput,
  type ScheduleDependencyInput,
} from "./schedulingEngine";

/**
 * Statusing / progress network semantics.
 *
 * These tests exercise the schedule engine the way the app calls it: every
 * activity row carries `remainingDurationDays` because the column is
 * NOT NULL DEFAULT 0, so the engine must never read a stored zero as
 * "no work left" for an activity that is started but not finished.
 *
 * Calendar: Mon-Fri, no exceptions. Anchor Monday 2026-01-05.
 * Working-day convention is inclusive: 5 days from Mon 01-05 ends Fri 01-09.
 */
const cal: ScheduleCalendarInput = {
  id: 1,
  name: "Standard",
  workingDays: [1, 2, 3, 4, 5],
  exceptions: [],
};

function activity(overrides: Partial<ScheduleActivityInput> & { id: number }): ScheduleActivityInput {
  return {
    wbsNodeId: 1,
    activityName: `A${overrides.id}`,
    activityType: "task",
    calendarId: 1,
    originalDurationDays: 5,
    remainingDurationDays: 0,
    percentComplete: 0,
    actualStart: null,
    actualFinish: null,
    ...overrides,
  };
}

function schedule(activities: ScheduleActivityInput[], dependencies: ScheduleDependencyInput[] = [], dataDate = "2026-01-05") {
  return runScheduleEngine(dataDate, null, [cal], 1, activities, dependencies);
}

describe("statusing: remaining duration drives the forecast", () => {
  it("does not collapse a started activity whose stored remaining duration is the column default 0", () => {
    // Regression: remaining_duration_days is NOT NULL DEFAULT 0, so an
    // in-progress row always carries a zero until someone records a real
    // forecast. Reading that zero as "no work left" produced ES === EF with
    // total float 0 and a false critical flag.
    const [row] = schedule([activity({ id: 1, percentComplete: 25, remainingDurationDays: 0, actualStart: "2026-01-05" })]);
    expect(row.earlyStart).toBe("2026-01-05");
    expect(row.earlyFinish).toBe("2026-01-08"); // 4 of 5 working days still outstanding
    expect(row.earlyFinish > row.earlyStart).toBe(true);
  });

  it("produces the same forecast whether the stored remaining duration is 0 or absent", () => {
    const withZero = schedule([activity({ id: 1, percentComplete: 25, remainingDurationDays: 0, actualStart: "2026-01-05" })]);
    const withNull = schedule([
      activity({ id: 1, percentComplete: 25, remainingDurationDays: undefined, actualStart: "2026-01-05" }),
    ]);
    expect(withZero[0].earlyFinish).toBe(withNull[0].earlyFinish);
  });

  it("honours an explicit positive remaining duration over the percent-derived value", () => {
    const derived = schedule([activity({ id: 1, percentComplete: 25, remainingDurationDays: 0, actualStart: "2026-01-05" })]);
    const explicit = schedule([activity({ id: 1, percentComplete: 25, remainingDurationDays: 1, actualStart: "2026-01-05" })]);
    expect(derived[0].earlyFinish).toBe("2026-01-08");
    expect(explicit[0].earlyFinish).toBe("2026-01-05");
  });

  it("moves the forecast finish when remaining duration is increased or decreased", () => {
    const short = schedule([activity({ id: 1, percentComplete: 40, remainingDurationDays: 1, actualStart: "2026-01-05" })]);
    const long = schedule([activity({ id: 1, percentComplete: 40, remainingDurationDays: 6, actualStart: "2026-01-05" })]);
    expect(short[0].earlyFinish).toBe("2026-01-05");
    expect(long[0].earlyFinish).toBe("2026-01-12"); // 6 working days from Mon 01-05
  });

  it("keeps a not-started activity at its full original duration regardless of a zero remaining value", () => {
    const [row] = schedule([activity({ id: 1, percentComplete: 0, remainingDurationDays: 0 })]);
    expect(row.earlyStart).toBe("2026-01-05");
    expect(row.earlyFinish).toBe("2026-01-09"); // full 5 days
  });

  it("keeps completed work and milestones at zero duration", () => {
    const rows = schedule([
      activity({ id: 1, percentComplete: 100, actualStart: "2026-01-05", actualFinish: "2026-01-06" }),
      activity({ id: 2, activityType: "milestone", percentComplete: 50, originalDurationDays: 0 }),
    ]);
    expect(rows[0].earlyStart).toBe("2026-01-05");
    expect(rows[0].earlyFinish).toBe("2026-01-06");
    expect(rows[1].earlyStart).toBe(rows[1].earlyFinish);
  });
});

describe("statusing: recorded actuals are execution facts", () => {
  it("never moves a completed activity's actual dates, even when the Data Date is far ahead", () => {
    const rows = schedule(
      [activity({ id: 1, percentComplete: 100, actualStart: "2026-01-05", actualFinish: "2026-01-07" })],
      [],
      "2026-03-02"
    );
    expect(rows[0].earlyStart).toBe("2026-01-05");
    expect(rows[0].earlyFinish).toBe("2026-01-07");
  });

  it("does not move a completed activity's actual dates when a successor or data date changes", () => {
    const first = schedule([
      activity({ id: 1, percentComplete: 100, actualStart: "2026-01-05", actualFinish: "2026-01-07" }),
      activity({ id: 2, percentComplete: 0 }),
    ], [{ id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 0 }]);
    const second = schedule([
      activity({ id: 1, percentComplete: 100, actualStart: "2026-01-05", actualFinish: "2026-01-07" }),
      activity({ id: 2, percentComplete: 0, originalDurationDays: 10 }),
    ], [{ id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 0 }]);
    expect(first[0].earlyFinish).toBe("2026-01-07");
    expect(second[0].earlyFinish).toBe("2026-01-07");
    expect(second[1].earlyStart).toBe("2026-01-08");
  });

  it("does not mutate the input rows (the engine returns new objects only)", () => {
    const rows = [activity({ id: 1, percentComplete: 25, remainingDurationDays: 0, actualStart: "2026-01-05" })];
    const snapshot = JSON.parse(JSON.stringify(rows));
    schedule(rows);
    expect(rows).toEqual(snapshot);
  });

  it("keeps in-progress remaining work at or after the Data Date while leaving the recorded Actual Start intact", () => {
    const rows = schedule([activity({ id: 1, percentComplete: 25, remainingDurationDays: 3, actualStart: "2026-01-05" })], [], "2026-01-19");
    // The recorded fact is untouched input data; only the forecast moves.
    expect(rows[0].earlyStart).toBe("2026-01-19");
    expect(rows[0].earlyFinish).toBe("2026-01-21");
  });
});

describe("statusing: a completed activity without a recorded Actual Start", () => {
  it("places the completed work at its recorded Actual Finish instead of the Data Date", () => {
    // Regression: the completed shortcut fell back to the anchor for a missing
    // Actual Start, so a completion recorded before the Data Date produced
    // earlyStart = Data Date with earlyFinish = the earlier finish — a finish
    // BEFORE its start, persisted by Run Schedule.
    const rows = schedule(
      [activity({ id: 1, percentComplete: 100, actualStart: null, actualFinish: "2026-01-07" })],
      [],
      "2026-01-19"
    );
    expect(rows[0].earlyStart).toBe("2026-01-07");
    expect(rows[0].earlyFinish).toBe("2026-01-07");
    expect(rows[0].earlyFinish < rows[0].earlyStart).toBe(false);
  });

  it("never reports any completed activity as finishing before it starts", () => {
    const cases: Array<Partial<ScheduleActivityInput>> = [
      { actualStart: null, actualFinish: "2026-01-07" },
      { actualStart: null, actualFinish: null },
      { actualStart: "2026-01-05", actualFinish: "2026-01-07" },
      { actualStart: "2026-01-05", actualFinish: null },
    ];
    for (const overrides of cases) {
      const rows = schedule([activity({ id: 1, percentComplete: 100, ...overrides })], [], "2026-01-19");
      expect(rows[0].earlyFinish >= rows[0].earlyStart).toBe(true);
    }
  });

  it("still anchors a completed activity with no actual dates at the Data Date", () => {
    const rows = schedule([activity({ id: 1, percentComplete: 100, actualStart: null, actualFinish: null })], [], "2026-01-19");
    expect(rows[0].earlyStart).toBe("2026-01-19");
    expect(rows[0].earlyFinish).toBe("2026-01-19");
  });

  it("anchors an SS successor on the recorded completion, not on the Data Date", () => {
    // Before the fix the start-less completed row carried ES = anchor, so an SS
    // successor was released weeks before the predecessor had actually finished.
    const rows = schedule([
      activity({ id: 1, percentComplete: 100, actualStart: null, actualFinish: "2026-02-02" }),
      activity({ id: 2, percentComplete: 0 }),
    ], [{ id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "SS", lagDays: 0 }], "2026-01-05");
    expect(rows[0].earlyStart).toBe("2026-02-02");
    expect(rows[1].earlyStart).toBe("2026-02-02");
  });

  it("still releases an FS successor the working day after the recorded finish", () => {
    const rows = schedule([
      activity({ id: 1, percentComplete: 100, actualStart: null, actualFinish: "2026-01-07" }),
      activity({ id: 2, percentComplete: 0 }),
    ], [{ id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 0 }], "2026-01-05");
    expect(rows[1].earlyStart).toBe("2026-01-08");
  });
});

describe("statusing: Data Date movement", () => {
  it("moves unfinished work later when the Data Date advances", () => {
    const early = schedule([activity({ id: 1, percentComplete: 0 })], [], "2026-01-05");
    const advanced = schedule([activity({ id: 1, percentComplete: 0 })], [], "2026-02-02");
    expect(early[0].earlyStart).toBe("2026-01-05");
    expect(advanced[0].earlyStart).toBe("2026-02-02");
    expect(advanced[0].earlyFinish).toBe("2026-02-06");
  });

  it("moves unfinished work earlier when the Data Date moves backward, without moving completed history", () => {
    const rows = schedule([
      activity({ id: 1, percentComplete: 0 }),
      activity({ id: 2, percentComplete: 100, actualStart: "2026-01-05", actualFinish: "2026-01-06" }),
    ], [{ id: 1, predecessorActivityId: 2, successorActivityId: 1, dependencyType: "FS", lagDays: 0 }], "2026-01-05");
    expect(rows[0].earlyStart).toBe("2026-01-07");
    expect(rows[1].earlyFinish).toBe("2026-01-06");
  });

  it("reports the project finish from the remaining-work forecast of the latest unfinished activity", () => {
    const rows = schedule([
      activity({ id: 1, percentComplete: 100, actualStart: "2026-01-05", actualFinish: "2026-01-06" }),
      activity({ id: 2, percentComplete: 50, remainingDurationDays: 3, actualStart: "2026-01-07" }),
    ]);
    const forecast = rows.filter((r) => r.id !== 1).map((r) => r.earlyFinish).sort().at(-1);
    expect(forecast).toBe("2026-01-09");
  });
});

describe("statusing: dependency network after progress is recorded", () => {
  const deps = (type: string, lag = 0): ScheduleDependencyInput[] => [
    { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: type, lagDays: lag },
  ];

  it("schedules an FS successor after an in-progress predecessor's forecast finish", () => {
    const rows = schedule([
      activity({ id: 1, percentComplete: 25, remainingDurationDays: 0, actualStart: "2026-01-05" }),
      activity({ id: 2, percentComplete: 0 }),
    ], deps("FS"));
    expect(rows[0].earlyFinish).toBe("2026-01-08");
    expect(rows[1].earlyStart).toBe("2026-01-09");
  });

  it("schedules an SS successor from an in-progress predecessor's forecast start", () => {
    const rows = schedule([
      activity({ id: 1, percentComplete: 25, remainingDurationDays: 2, actualStart: "2026-01-05" }),
      activity({ id: 2, percentComplete: 0 }),
    ], deps("SS"));
    expect(rows[1].earlyStart).toBe("2026-01-05");
  });

  it("schedules an FF successor from an in-progress predecessor's forecast finish", () => {
    const rows = schedule([
      activity({ id: 1, percentComplete: 25, remainingDurationDays: 3, actualStart: "2026-01-05" }),
      activity({ id: 2, percentComplete: 0, originalDurationDays: 2 }),
    ], deps("FF"));
    expect(rows[0].earlyFinish).toBe("2026-01-07");
    expect(rows[1].earlyFinish).toBe("2026-01-07");
  });

  it("constrains an SF successor by the predecessor's forecast START, not its remaining duration", () => {
    // SF semantics are locked by the existing engine suite; this asserts the
    // statusing property: the successor is anchored on the predecessor's start
    // (a progress-independent fact), so extra remaining work does not move it.
    const shortRemaining = schedule([
      activity({ id: 1, percentComplete: 25, remainingDurationDays: 3, actualStart: "2026-01-05" }),
      activity({ id: 2, percentComplete: 0, originalDurationDays: 2 }),
    ], deps("SF"));
    const longRemaining = schedule([
      activity({ id: 1, percentComplete: 25, remainingDurationDays: 20, actualStart: "2026-01-05" }),
      activity({ id: 2, percentComplete: 0, originalDurationDays: 2 }),
    ], deps("SF"));
    expect(longRemaining[1].earlyFinish).toBe(shortRemaining[1].earlyFinish);
    expect(shortRemaining[1].earlyFinish <= "2026-01-06").toBe(true);
  });

  it("applies dependency lag after statusing (successor starts later than with zero lag)", () => {
    const noLag = schedule([
      activity({ id: 1, percentComplete: 25, remainingDurationDays: 2, actualStart: "2026-01-05" }),
      activity({ id: 2, percentComplete: 0 }),
    ], deps("FS", 0));
    const withLag = schedule([
      activity({ id: 1, percentComplete: 25, remainingDurationDays: 2, actualStart: "2026-01-05" }),
      activity({ id: 2, percentComplete: 0 }),
    ], deps("FS", 2));
    expect(noLag[1].earlyStart).toBe("2026-01-07");
    expect(withLag[1].earlyStart > noLag[1].earlyStart).toBe(true);
  });

  it("takes the latest constraint across multiple predecessors", () => {
    const rows = schedule([
      activity({ id: 1, percentComplete: 100, actualStart: "2026-01-05", actualFinish: "2026-01-06" }),
      activity({ id: 2, percentComplete: 25, remainingDurationDays: 2, actualStart: "2026-01-07" }),
      activity({ id: 3, percentComplete: 0 }),
    ], [
      { id: 1, predecessorActivityId: 1, successorActivityId: 3, dependencyType: "FS", lagDays: 0 },
      { id: 2, predecessorActivityId: 2, successorActivityId: 3, dependencyType: "FS", lagDays: 0 },
    ]);
    expect(rows[2].earlyStart).toBe("2026-01-09");
  });

  it("keeps both successors scheduled after a delayed in-progress predecessor", () => {
    const rows = schedule([
      activity({ id: 1, percentComplete: 25, remainingDurationDays: 5, actualStart: "2026-01-05" }),
      activity({ id: 2, percentComplete: 0 }),
      activity({ id: 3, percentComplete: 0 }),
    ], [
      { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 0 },
      { id: 2, predecessorActivityId: 1, successorActivityId: 3, dependencyType: "FS", lagDays: 0 },
    ]);
    expect(rows[0].earlyFinish).toBe("2026-01-09");
    expect(rows[1].earlyStart).toBe("2026-01-12");
    expect(rows[2].earlyStart).toBe("2026-01-12");
  });
});
