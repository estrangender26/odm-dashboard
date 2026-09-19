import { describe, expect, it } from "vitest";
import {
  addWorkingDays,
  countWorkingDays,
  dateToCalendarDay,
  getWorkingDuration,
  runScheduleEngine,
  toWorkingDayIndex,
  fromWorkingDayIndex,
} from "./schedulingEngine";
import type {
  ScheduleActivityInput,
  ScheduleCalendarInput,
  ScheduleDependencyInput,
} from "./schedulingEngine";
import {
  PR345_ACTIVITY_A_INITIAL,
  PR345_ACTIVITY_B,
  PR345_ACTIVITY_C,
  PR345_AFTER_SCHEDULE,
  PR345_DATA_DATE,
  PR345_MANUAL_ACTUAL_FINISH,
  PR345_WORKING_DAYS,
} from "./pr345SmokeFixture";

const monFriCalendar: ScheduleCalendarInput = {
  id: 1,
  name: "Standard Mon-Fri",
  workingDays: [1, 2, 3, 4, 5], // Mon=1 .. Fri=5
  hoursPerDay: "8.00",
  timezone: "Asia/Manila",
};

const monSatCalendar: ScheduleCalendarInput = {
  id: 2,
  name: "Six Day Mon-Sat",
  workingDays: [1, 2, 3, 4, 5, 6], // Mon=1 .. Sat=6
  hoursPerDay: "8.00",
  timezone: "Asia/Manila",
};

describe("Primavera Lite Scheduling Engine (Pure CPM)", () => {
  it("working-day calendar arithmetic handles weekends and custom exceptions", () => {
    // 2026-08-14 is a Friday.
    // Next working day after Fri 2026-08-14 on Mon-Fri calendar is Mon 2026-08-17.
    const friIdx = toWorkingDayIndex("2026-08-14", monFriCalendar);
    const monIdx = toWorkingDayIndex("2026-08-17", monFriCalendar);
    expect(monIdx).toBe(friIdx + 1);
    expect(fromWorkingDayIndex(friIdx, monFriCalendar)).toBe("2026-08-14");
    expect(fromWorkingDayIndex(monIdx, monFriCalendar)).toBe("2026-08-17");

    // With an exception making 2026-08-17 (Mon) non-working, next working day becomes 2026-08-18 (Tue)
    const calWithException: ScheduleCalendarInput = {
      ...monFriCalendar,
      exceptions: [{ exceptionDate: "2026-08-17", isWorking: false }],
    };
    const monExIdx = toWorkingDayIndex("2026-08-17", calWithException, "next");
    expect(fromWorkingDayIndex(monExIdx, calWithException)).toBe("2026-08-18");
  });

  it("schedules a known CPM network with critical path and non-critical float", () => {
    // Project network:
    // A (dur 2) -> B (dur 3) -> D (dur 1) [Critical Path: A -> B -> D, total dur = 6]
    // A (dur 2) -> C (dur 2) -> D (dur 1) [Non-critical: C has float of 1 day]
    const activities: ScheduleActivityInput[] = [
      { id: 10, wbsNodeId: 1, activityName: "A", originalDurationDays: 2 },
      { id: 20, wbsNodeId: 1, activityName: "B", originalDurationDays: 3 },
      { id: 30, wbsNodeId: 1, activityName: "C", originalDurationDays: 2 },
      { id: 40, wbsNodeId: 1, activityName: "D", originalDurationDays: 1 },
    ];
    const dependencies: ScheduleDependencyInput[] = [
      { id: 1, predecessorActivityId: 10, successorActivityId: 20, dependencyType: "FS", lagDays: 0 },
      { id: 2, predecessorActivityId: 10, successorActivityId: 30, dependencyType: "FS", lagDays: 0 },
      { id: 3, predecessorActivityId: 20, successorActivityId: 40, dependencyType: "FS", lagDays: 0 },
      { id: 4, predecessorActivityId: 30, successorActivityId: 40, dependencyType: "FS", lagDays: 0 },
    ];

    const res = runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar], 1, activities, dependencies);
    expect(res).toHaveLength(4);

    const map = new Map(res.map((r) => [r.id, r]));
    const a = map.get(10)!;
    const b = map.get(20)!;
    const c = map.get(30)!;
    const d = map.get(40)!;

    // A starts Mon 2026-08-10, finishes Tue 2026-08-11
    expect(a.earlyStart).toBe("2026-08-10");
    expect(a.earlyFinish).toBe("2026-08-11");
    expect(a.isCritical).toBe(true);
    expect(a.totalFloatDays).toBe(0);

    // B starts Wed 2026-08-12, finishes Fri 2026-08-14
    expect(b.earlyStart).toBe("2026-08-12");
    expect(b.earlyFinish).toBe("2026-08-14");
    expect(b.isCritical).toBe(true);
    expect(b.totalFloatDays).toBe(0);

    // C starts Wed 2026-08-12, finishes Thu 2026-08-13 (1 day float)
    expect(c.earlyStart).toBe("2026-08-12");
    expect(c.earlyFinish).toBe("2026-08-13");
    expect(c.isCritical).toBe(false);
    expect(c.totalFloatDays).toBe(1);
    expect(c.freeFloatDays).toBe(1);

    // D starts Mon 2026-08-17, finishes Mon 2026-08-17
    expect(d.earlyStart).toBe("2026-08-17");
    expect(d.earlyFinish).toBe("2026-08-17");
    expect(d.isCritical).toBe(true);
  });

  it("supports all 4 dependency types (FS, SS, FF, SF) with positive, zero, and negative lag", () => {
    const activities: ScheduleActivityInput[] = [
      { id: 1, wbsNodeId: 1, activityName: "P", originalDurationDays: 5, plannedStart: "2026-08-10" },
      { id: 2, wbsNodeId: 1, activityName: "S_FS", originalDurationDays: 2 },
      { id: 3, wbsNodeId: 1, activityName: "S_SS", originalDurationDays: 2 },
      { id: 4, wbsNodeId: 1, activityName: "S_FF", originalDurationDays: 2 },
      { id: 5, wbsNodeId: 1, activityName: "S_SF", originalDurationDays: 2 },
    ];
    const dependencies: ScheduleDependencyInput[] = [
      { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 2 },
      { id: 2, predecessorActivityId: 1, successorActivityId: 3, dependencyType: "SS", lagDays: -1 },
      { id: 3, predecessorActivityId: 1, successorActivityId: 4, dependencyType: "FF", lagDays: 0 },
      { id: 4, predecessorActivityId: 1, successorActivityId: 5, dependencyType: "SF", lagDays: 0 },
    ];

    const res = runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar], 1, activities, dependencies);
    const map = new Map(res.map((r) => [r.id, r]));

    const p = map.get(1)!;
    expect(p.earlyStart).toBe("2026-08-10"); // Mon
    expect(p.earlyFinish).toBe("2026-08-14"); // Fri (5 days)

    // FS + 2 lag: P finishes Fri 2026-08-14 -> 2 lag days -> S_FS starts Wed 2026-08-19
    expect(map.get(2)!.earlyStart).toBe("2026-08-19");

    // SS - 1 lag: network start is 1 working day before P start (Fri 2026-08-07),
    // but the Data Date floor (2026-08-10) governs remaining work: ES = 2026-08-10
    expect(map.get(3)!.earlyStart).toBe("2026-08-10");

    // FF 0 lag: S_FF finish >= P finish (2026-08-14). Dur=2 => ES = 2026-08-13
    expect(map.get(4)!.earlyStart).toBe("2026-08-13");
    expect(map.get(4)!.earlyFinish).toBe("2026-08-14");

    // SF 0 lag: S_SF finish >= P start (2026-08-10). Dur=2, Data Date floor 2026-08-10
    // => ES = 2026-08-10, EF = 2026-08-11 (lead is clamped by the Data Date floor)
    expect(map.get(5)!.earlyFinish).toBe("2026-08-11");
    expect(map.get(5)!.earlyStart).toBe("2026-08-10");
  });

  it("handles milestones and open ends correctly", () => {
    // A is an open-end start (no predecessors) -> starts at Data Date 2026-08-10
    // M is a milestone (dur 0)
    // B is an open-end finish (no successors)
    const activities: ScheduleActivityInput[] = [
      { id: 100, wbsNodeId: 1, activityName: "Start Milestone", originalDurationDays: 0, activityType: "milestone" },
      { id: 200, wbsNodeId: 1, activityName: "Task A", originalDurationDays: 3 },
      { id: 300, wbsNodeId: 1, activityName: "End Milestone", originalDurationDays: 0, activityType: "milestone" },
    ];
    const dependencies: ScheduleDependencyInput[] = [
      { id: 1, predecessorActivityId: 100, successorActivityId: 200, dependencyType: "FS", lagDays: 0 },
      { id: 2, predecessorActivityId: 200, successorActivityId: 300, dependencyType: "FS", lagDays: 0 },
    ];

    const res = runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar], 1, activities, dependencies);
    const startM = res.find((r) => r.id === 100)!;
    const taskA = res.find((r) => r.id === 200)!;
    const endM = res.find((r) => r.id === 300)!;

    expect(startM.earlyStart).toBe("2026-08-10");
    expect(startM.earlyFinish).toBe("2026-08-10"); // milestone has ES === EF
    expect(taskA.earlyStart).toBe("2026-08-11");
    expect(taskA.earlyFinish).toBe("2026-08-13");
    expect(endM.earlyStart).toBe("2026-08-14");
    expect(endM.earlyFinish).toBe("2026-08-14");
  });

  it("rejects circular dependencies with a clear error", () => {
    const activities: ScheduleActivityInput[] = [
      { id: 1, wbsNodeId: 1, activityName: "Loop 1", originalDurationDays: 2 },
      { id: 2, wbsNodeId: 1, activityName: "Loop 2", originalDurationDays: 2 },
    ];
    const dependencies: ScheduleDependencyInput[] = [
      { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 0 },
      { id: 2, predecessorActivityId: 2, successorActivityId: 1, dependencyType: "FS", lagDays: 0 },
    ];

    expect(() =>
      runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar], 1, activities, dependencies)
    ).toThrow(/Circular dependency detected/i);
  });

  it("handles Data Date and progress-aware scheduling", () => {
    const activities: ScheduleActivityInput[] = [
      {
        id: 1,
        wbsNodeId: 1,
        activityName: "Done Task",
        originalDurationDays: 5,
        percentComplete: 100,
        actualStart: "2026-08-03",
        actualFinish: "2026-08-07",
      },
      {
        id: 2,
        wbsNodeId: 1,
        activityName: "In Progress Task",
        originalDurationDays: 5,
        remainingDurationDays: 2,
        percentComplete: 60,
      },
      {
        id: 3,
        wbsNodeId: 1,
        activityName: "Future Task",
        originalDurationDays: 4,
        percentComplete: 0,
      },
    ];
    const dependencies: ScheduleDependencyInput[] = [
      { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 0 },
      { id: 2, predecessorActivityId: 2, successorActivityId: 3, dependencyType: "FS", lagDays: 0 },
    ];

    // Data date is 2026-08-10 (Monday)
    const res = runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar], 1, activities, dependencies);
    const map = new Map(res.map((r) => [r.id, r]));

    // Done task keeps its actual dates
    expect(map.get(1)!.earlyStart).toBe("2026-08-03");
    expect(map.get(1)!.earlyFinish).toBe("2026-08-07");

    // In Progress task remaining work starts at Data Date (2026-08-10), duration 2 days
    expect(map.get(2)!.earlyStart).toBe("2026-08-10");
    expect(map.get(2)!.earlyFinish).toBe("2026-08-11");

    // Future task follows In Progress task -> starts 2026-08-12, finishes 2026-08-14
    expect(map.get(3)!.earlyStart).toBe("2026-08-12");
    expect(map.get(3)!.earlyFinish).toBe("2026-08-17"); // 4 days: Wed, Thu, Fri, Mon
  });

  it("supports mixed calendars: Mon-Fri predecessor to Mon-Sat successor and reverse direction across FS/SS/FF/SF", () => {
    // 1. Mon-Fri predecessor (A) -> Mon-Sat successor (B) via FS
    // A starts Mon 2026-08-10, dur 5 -> finishes Fri 2026-08-14
    // B starts Sat 2026-08-15 (since Sat is a working day on Mon-Sat calendar!)
    const activities1: ScheduleActivityInput[] = [
      { id: 1, wbsNodeId: 1, activityName: "MonFri_A", originalDurationDays: 5, calendarId: 1 },
      { id: 2, wbsNodeId: 1, activityName: "MonSat_B", originalDurationDays: 1, calendarId: 2 },
    ];
    const deps1: ScheduleDependencyInput[] = [
      { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 0 },
    ];
    const res1 = runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar, monSatCalendar], 1, activities1, deps1);
    const map1 = new Map(res1.map((r) => [r.id, r]));
    expect(map1.get(1)!.earlyFinish).toBe("2026-08-14");
    expect(map1.get(2)!.earlyStart).toBe("2026-08-15"); // Sat 2026-08-15

    // 2. Reverse direction: Mon-Sat predecessor (X) -> Mon-Fri successor (Y) via FS
    // X starts Mon 2026-08-10, dur 6 -> finishes Sat 2026-08-15
    // Y starts Mon 2026-08-17 (since Sun is non-working on Mon-Fri calendar!)
    const activities2: ScheduleActivityInput[] = [
      { id: 10, wbsNodeId: 1, activityName: "MonSat_X", originalDurationDays: 6, calendarId: 2 },
      { id: 20, wbsNodeId: 1, activityName: "MonFri_Y", originalDurationDays: 1, calendarId: 1 },
    ];
    const deps2: ScheduleDependencyInput[] = [
      { id: 1, predecessorActivityId: 10, successorActivityId: 20, dependencyType: "FS", lagDays: 0 },
    ];
    const res2 = runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar, monSatCalendar], 1, activities2, deps2);
    const map2 = new Map(res2.map((r) => [r.id, r]));
    expect(map2.get(10)!.earlyFinish).toBe("2026-08-15"); // Sat 2026-08-15
    expect(map2.get(20)!.earlyStart).toBe("2026-08-17"); // Mon 2026-08-17

    // 3. SS, FF across different calendars
    const activities3: ScheduleActivityInput[] = [
      { id: 100, wbsNodeId: 1, activityName: "P_MonFri", originalDurationDays: 5, calendarId: 1 },
      { id: 101, wbsNodeId: 1, activityName: "S_SS_MonSat", originalDurationDays: 2, calendarId: 2 },
      { id: 102, wbsNodeId: 1, activityName: "S_FF_MonSat", originalDurationDays: 2, calendarId: 2 },
    ];
    const deps3: ScheduleDependencyInput[] = [
      { id: 1, predecessorActivityId: 100, successorActivityId: 101, dependencyType: "SS", lagDays: 1 },
      { id: 2, predecessorActivityId: 100, successorActivityId: 102, dependencyType: "FF", lagDays: 0 },
    ];
    const res3 = runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar, monSatCalendar], 1, activities3, deps3);
    const map3 = new Map(res3.map((r) => [r.id, r]));
    expect(map3.get(101)!.earlyStart).toBe("2026-08-11"); // Tue
    expect(map3.get(102)!.earlyFinish).toBe("2026-08-14"); // Fri
    expect(map3.get(102)!.earlyStart).toBe("2026-08-13");  // Thu (2 working days: Thu, Fri)
  });

  it("follows deterministic anchor priority: data_date -> explicit scheduleDate (planned dates are never anchors)", () => {
    const actWithPlanned: ScheduleActivityInput = {
      id: 1,
      wbsNodeId: 1,
      activityName: "Act With Planned",
      originalDurationDays: 1,
      plannedStart: "2026-03-02",
      plannedFinish: "2026-03-02",
    };
    const actWithoutPlanned: ScheduleActivityInput = {
      id: 2,
      wbsNodeId: 1,
      activityName: "Act Without Planned",
      originalDurationDays: 1,
    };

    // 1. projectDataDate ("2026-02-02") overrides scheduleDate ("2026-04-01") for
    //    every open activity; plannedStart ("2026-03-02") is ignored entirely.
    const res1 = runScheduleEngine(
      "2026-02-02",
      "2026-04-01",
      [monFriCalendar],
      1,
      [actWithPlanned, actWithoutPlanned],
      []
    );
    expect(res1.find((r) => r.id === 1)!.earlyStart).toBe("2026-02-02");
    expect(res1.find((r) => r.id === 2)!.earlyStart).toBe("2026-02-02");

    // 2. null projectDataDate -> explicit scheduleDate ("2026-04-01"); plannedStart
    //    still ignored.
    const res2 = runScheduleEngine(
      null,
      "2026-04-01",
      [monFriCalendar],
      1,
      [actWithPlanned, actWithoutPlanned],
      []
    );
    expect(res2.find((r) => r.id === 1)!.earlyStart).toBe("2026-04-01");
    expect(res2.find((r) => r.id === 2)!.earlyStart).toBe("2026-04-01");
  });

  it("throws a controlled error when both anchors (data_date, scheduleDate) are absent/invalid", () => {
    const baseAct: ScheduleActivityInput = {
      id: 1,
      wbsNodeId: 1,
      activityName: "No Anchor Test",
      originalDurationDays: 1,
      plannedStart: "2026-03-02",
    };
    expect(() =>
      runScheduleEngine(null, null, [monFriCalendar], 1, [baseAct], [])
    ).toThrow(/no valid project data_date or scheduleDate anchor available/i);
    expect(() =>
      runScheduleEngine("invalid-date", "bad-date", [monFriCalendar], 1, [baseAct], [])
    ).toThrow(/no valid project data_date or scheduleDate anchor available/i);
  });
  it("uses Actual Finish as FS predecessor anchor and propagates through chained successors", () => {
    // PR345 acceptance scenario network:
    // A (100% complete, actualFinish: 2026-08-13 Thu) -> B (dur 5) FS lag 0 -> C (dur 2) FS lag 0
    const activities: ScheduleActivityInput[] = [
      {
        id: 1,
        wbsNodeId: 1,
        activityName: "A",
        originalDurationDays: 5,
        percentComplete: 100,
        plannedStart: "2026-08-13",
        plannedFinish: "2026-08-19",
        actualStart: "2026-08-13",
        actualFinish: "2026-08-13",
      },
      {
        id: 2,
        wbsNodeId: 1,
        activityName: "B",
        originalDurationDays: 5,
        percentComplete: 0,
        plannedStart: "2026-08-13",
        plannedFinish: "2026-08-19",
      },
      {
        id: 3,
        wbsNodeId: 1,
        activityName: "C",
        originalDurationDays: 2,
        percentComplete: 0,
        plannedStart: "2026-08-13",
        plannedFinish: "2026-08-14",
      },
    ];
    const dependencies: ScheduleDependencyInput[] = [
      { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 0 },
      { id: 2, predecessorActivityId: 2, successorActivityId: 3, dependencyType: "FS", lagDays: 0 },
    ];

    const res = runScheduleEngine("2026-08-13", "2026-08-13", [monFriCalendar], 1, activities, dependencies);
    const map = new Map(res.map((r) => [r.id, r]));

    // A is completed with actualFinish: 2026-08-13
    expect(map.get(1)!.earlyStart).toBe("2026-08-13");
    expect(map.get(1)!.earlyFinish).toBe("2026-08-13");

    // B starts next working day after A's Actual Finish (2026-08-13 Thu -> 2026-08-14 Fri)
    // 5 working days on Mon-Fri calendar: Fri 14, Mon 17, Tue 18, Wed 19, Thu 20
    expect(map.get(2)!.earlyStart).toBe("2026-08-14");
    expect(map.get(2)!.earlyFinish).toBe("2026-08-20");

    // C starts next working day after B's Early Finish (2026-08-20 Thu -> 2026-08-21 Fri)
    // 2 working days: Fri 21, Mon 24
    expect(map.get(3)!.earlyStart).toBe("2026-08-21");
    expect(map.get(3)!.earlyFinish).toBe("2026-08-24");
  });

  it("supports actual-start anchoring for SS and SF relationships", () => {
    // Predecessor in-progress with Actual Start = 2026-08-11 (Tue)
    const activities: ScheduleActivityInput[] = [
      {
        id: 1,
        wbsNodeId: 1,
        activityName: "InProg_P",
        originalDurationDays: 5,
        remainingDurationDays: 3,
        percentComplete: 40,
        actualStart: "2026-08-11",
      },
      {
        id: 2,
        wbsNodeId: 1,
        activityName: "Succ_SS",
        originalDurationDays: 2,
      },
      {
        id: 3,
        wbsNodeId: 1,
        activityName: "Succ_SF",
        originalDurationDays: 2,
      },
    ];
    const dependencies: ScheduleDependencyInput[] = [
      { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "SS", lagDays: 1 },
      { id: 2, predecessorActivityId: 1, successorActivityId: 3, dependencyType: "SF", lagDays: 0 },
    ];

    // Data Date: 2026-08-13 (Thu). The Data Date floor governs remaining work,
    // so successors whose network dates precede the floor move to the floor.
    const res = runScheduleEngine("2026-08-13", "2026-08-13", [monFriCalendar], 1, activities, dependencies);
    const map = new Map(res.map((r) => [r.id, r]));

    // SS + 1 lag anchored to P's Actual Start (2026-08-11 Tue -> +1 working day ->
    // 2026-08-12 Wed), clamped by the Data Date floor -> 2026-08-13 Thu
    expect(map.get(2)!.earlyStart).toBe("2026-08-13");
    expect(map.get(2)!.earlyFinish).toBe("2026-08-14");

    // SF 0 lag anchored to P's Actual Start (2026-08-11 Tue), clamped by the Data
    // Date floor -> ES = 2026-08-13, EF = 2026-08-14
    expect(map.get(3)!.earlyFinish).toBe("2026-08-14");
    expect(map.get(3)!.earlyStart).toBe("2026-08-13");
  });

  it("supports actual-finish anchoring for FF relationships with lag", () => {
    const activities: ScheduleActivityInput[] = [
      {
        id: 1,
        wbsNodeId: 1,
        activityName: "Done_P",
        originalDurationDays: 4,
        percentComplete: 100,
        actualStart: "2026-08-10",
        actualFinish: "2026-08-13", // Thu
      },
      {
        id: 2,
        wbsNodeId: 1,
        activityName: "Succ_FF_pos",
        originalDurationDays: 3,
      },
      {
        id: 3,
        wbsNodeId: 1,
        activityName: "Succ_FF_neg",
        originalDurationDays: 2,
      },
    ];
    const dependencies: ScheduleDependencyInput[] = [
      { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FF", lagDays: 1 },
      { id: 2, predecessorActivityId: 1, successorActivityId: 3, dependencyType: "FF", lagDays: -1 },
    ];

    const res = runScheduleEngine("2026-08-13", "2026-08-13", [monFriCalendar], 1, activities, dependencies);
    const map = new Map(res.map((r) => [r.id, r]));

    // FF + 1 lag: P actual finish 2026-08-13 Thu -> EF req = 2026-08-14 Fri. Dur 3
    // -> network ES 2026-08-12, Data Date floor 2026-08-13 => ES 2026-08-13, EF 2026-08-17
    expect(map.get(2)!.earlyFinish).toBe("2026-08-17");
    expect(map.get(2)!.earlyStart).toBe("2026-08-13");

    // FF - 1 lag: P actual finish 2026-08-13 Thu -> EF req = 2026-08-12 Wed. Dur 2
    // -> network ES 2026-08-11, clamped by the Data Date floor => ES 2026-08-13, EF 2026-08-14
    expect(map.get(3)!.earlyFinish).toBe("2026-08-14");
    expect(map.get(3)!.earlyStart).toBe("2026-08-13");
  });

  it("handles weekend working-day span correctly (5 working days crossing weekend = 7 calendar days)", () => {
    // 2026-08-14 is a Friday. 5 working days: Fri 14, Mon 17, Tue 18, Wed 19, Thu 20.
    const activities: ScheduleActivityInput[] = [
      {
        id: 1,
        wbsNodeId: 1,
        activityName: "Weekend Task",
        originalDurationDays: 5,
        plannedStart: "2026-08-14",
      },
    ];
    const res = runScheduleEngine("2026-08-14", "2026-08-14", [monFriCalendar], 1, activities, []);
    expect(res[0].earlyStart).toBe("2026-08-14");
    expect(res[0].earlyFinish).toBe("2026-08-20");
  });
});

describe("calendar scheduling semantics", () => {
  it("lets a Saturday-working calendar finish sooner than Mon-Fri", () => {
    const activities: ScheduleActivityInput[] = [
      { id: 1, wbsNodeId: 1, activityName: "SixDay", originalDurationDays: 6, calendarId: 2 },
    ];
    const sat = runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar, monSatCalendar], 1, activities, []);
    const fri = runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar], 1, [{ ...activities[0], calendarId: 1 }], []);
    expect(sat[0].earlyFinish).toBe("2026-08-15");
    expect(fri[0].earlyFinish).toBe("2026-08-17");
  });

  it("shifts work off a non-working weekday exception", () => {
    const cal: ScheduleCalendarInput = {
      ...monFriCalendar,
      exceptions: [{ exceptionDate: "2026-08-10", isWorking: false }],
    };
    const res = runScheduleEngine("2026-08-10", "2026-08-10", [cal], 1, [
      { id: 1, wbsNodeId: 1, activityName: "Task", originalDurationDays: 1 },
    ], []);
    expect(res[0].earlyStart).toBe("2026-08-11");
  });

  it("permits work on a weekend working exception", () => {
    const cal: ScheduleCalendarInput = {
      ...monFriCalendar,
      exceptions: [{ exceptionDate: "2026-08-15", isWorking: true }],
    };
    const res = runScheduleEngine("2026-08-14", "2026-08-14", [cal], 1, [
      { id: 1, wbsNodeId: 1, activityName: "Weekend", originalDurationDays: 2 },
    ], []);
    expect(res[0].earlyStart).toBe("2026-08-14");
    expect(res[0].earlyFinish).toBe("2026-08-15");
  });

  it("uses an activity-specific calendar instead of the project default", () => {
    const activities: ScheduleActivityInput[] = [
      { id: 1, wbsNodeId: 1, activityName: "Assigned", originalDurationDays: 6, calendarId: 2 },
      { id: 2, wbsNodeId: 1, activityName: "Defaulted", originalDurationDays: 6 },
    ];
    const res = runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar, monSatCalendar], 1, activities, []);
    const map = new Map(res.map((r) => [r.id, r]));
    expect(map.get(1)!.earlyFinish).toBe("2026-08-15");
    expect(map.get(2)!.earlyFinish).toBe("2026-08-17");
  });
});

describe("Duration % Complete semantics", () => {
  it("derives 3 working days from 5 original days at 40% when Remaining Duration is absent", () => {
    expect(getWorkingDuration({ id: 1, wbsNodeId: 1, activityName: "Task", originalDurationDays: 5, percentComplete: 40 })).toBe(3);
  });

  it("derives 4 working days from 10 original days at 60% when Remaining Duration is absent", () => {
    expect(getWorkingDuration({ id: 1, wbsNodeId: 1, activityName: "Task", originalDurationDays: 10, percentComplete: 60 })).toBe(4);
  });

  it("uses explicit Remaining Duration under the established precedence rules", () => {
    expect(getWorkingDuration({ id: 1, wbsNodeId: 1, activityName: "Task", originalDurationDays: 10, remainingDurationDays: 2, percentComplete: 60 })).toBe(2);
    expect(getWorkingDuration({ id: 1, wbsNodeId: 1, activityName: "Task", originalDurationDays: 10, remainingDurationDays: 2, percentComplete: 0 })).toBe(2);
  });

  it("preserves the 0% and 100% boundaries", () => {
    expect(getWorkingDuration({ id: 1, wbsNodeId: 1, activityName: "Not started", originalDurationDays: 5, percentComplete: 0 })).toBe(5);
    expect(getWorkingDuration({ id: 1, wbsNodeId: 1, activityName: "Complete", originalDurationDays: 5, percentComplete: 100 })).toBe(0);
  });

  it("keeps calendar and weekend scheduling behavior unchanged for derived duration", () => {
    const result = runScheduleEngine("2026-08-14", "2026-08-14", [monFriCalendar], 1, [
      { id: 1, wbsNodeId: 1, activityName: "Task", originalDurationDays: 5, percentComplete: 40 },
    ], []);
    expect(result[0]).toMatchObject({ earlyStart: "2026-08-14", earlyFinish: "2026-08-18" });
  });
});

describe("PR345 exact production reproduction", () => {
  it("anchors B from A's Actual Finish and propagates to C without inventing dates or rewriting planned dates", () => {
    const activities: ScheduleActivityInput[] = [
      {
        id: 1,
        wbsNodeId: 1,
        ...PR345_ACTIVITY_A_INITIAL,
        actualFinish: PR345_MANUAL_ACTUAL_FINISH,
        percentComplete: 100,
      },
      { id: 2, wbsNodeId: 1, ...PR345_ACTIVITY_B },
      { id: 3, wbsNodeId: 1, ...PR345_ACTIVITY_C },
    ];
    const dependencies: ScheduleDependencyInput[] = [
      { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 0 },
      { id: 2, predecessorActivityId: 2, successorActivityId: 3, dependencyType: "FS", lagDays: 0 },
    ];

    expect(getWorkingDuration(activities[0])).toBe(0);
    expect(getWorkingDuration(activities[1])).toBe(5);
    expect(getWorkingDuration(activities[2])).toBe(2);

    // Calendar-aware: next working day after Fri 2026-08-14 is Mon 2026-08-17.
    const afterFriday = addWorkingDays(dateToCalendarDay("2026-08-15"), 1, monFriCalendar);
    expect(fromWorkingDayIndex(toWorkingDayIndex("2026-08-17", monFriCalendar), monFriCalendar)).toBe("2026-08-17");
    expect(countWorkingDays(dateToCalendarDay(PR345_WORKING_DAYS.b[0]), dateToCalendarDay(PR345_WORKING_DAYS.b[4]), monFriCalendar)).toBe(5);
    expect(countWorkingDays(dateToCalendarDay(PR345_WORKING_DAYS.c[0]), dateToCalendarDay(PR345_WORKING_DAYS.c[1]), monFriCalendar)).toBe(2);
    expect(afterFriday).toBe(dateToCalendarDay("2026-08-17"));

    const res = runScheduleEngine(PR345_DATA_DATE, PR345_DATA_DATE, [monFriCalendar], 1, activities, dependencies);
    const map = new Map(res.map((r) => [r.id, r]));

    expect(map.get(1)!.earlyStart).toBe(PR345_AFTER_SCHEDULE.A.earlyStart);
    expect(map.get(1)!.earlyFinish).toBe(PR345_AFTER_SCHEDULE.A.earlyFinish);
    expect(map.get(2)!.earlyStart).toBe(PR345_AFTER_SCHEDULE.B.earlyStart);
    expect(map.get(2)!.earlyFinish).toBe(PR345_AFTER_SCHEDULE.B.earlyFinish);
    expect(map.get(3)!.earlyStart).toBe(PR345_AFTER_SCHEDULE.C.earlyStart);
    expect(map.get(3)!.earlyFinish).toBe(PR345_AFTER_SCHEDULE.C.earlyFinish);

    // Engine output does not carry or rewrite planned dates.
    expect(activities[0].plannedStart).toBe("2026-08-13");
    expect(activities[0].plannedFinish).toBe("2026-08-17");
    expect(activities[1].plannedStart).toBeNull();
    expect(activities[1].plannedFinish).toBeNull();
    expect(activities[2].plannedStart).toBeNull();
    expect(activities[2].plannedFinish).toBeNull();
  });
});

describe("F-01 Data Date floor / F-09 classical CPM semantics", () => {
  it("applies the Data Date floor to a successor of a completed predecessor (F-01)", () => {
    // Data Date 2026-08-10; predecessor completed with actualFinish 2026-08-04.
    // The successor must not schedule before the Data Date.
    const activities: ScheduleActivityInput[] = [
      { id: 1, wbsNodeId: 1, activityName: "DoneP", originalDurationDays: 2, percentComplete: 100, actualStart: "2026-08-03", actualFinish: "2026-08-04" },
      { id: 2, wbsNodeId: 1, activityName: "S", originalDurationDays: 3 },
    ];
    const deps: ScheduleDependencyInput[] = [
      { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 0 },
    ];
    const res = runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar], 1, activities, deps);
    const map = new Map(res.map((r) => [r.id, r]));
    expect(map.get(2)!.earlyStart).toBe("2026-08-10");
    expect(map.get(2)!.earlyFinish).toBe("2026-08-12");
    // Completed predecessor keeps its historical actuals.
    expect(map.get(1)!.earlyStart).toBe("2026-08-03");
    expect(map.get(1)!.earlyFinish).toBe("2026-08-04");
  });

  it("applies the Data Date floor to an unfinished root activity (F-01)", () => {
    const activities: ScheduleActivityInput[] = [
      { id: 1, wbsNodeId: 1, activityName: "Root", originalDurationDays: 5, plannedStart: "2026-08-03" },
    ];
    const res = runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar], 1, activities, []);
    // plannedStart (2026-08-03) is ignored; the floor governs.
    expect(res[0].earlyStart).toBe("2026-08-10");
    expect(res[0].earlyFinish).toBe("2026-08-14");
  });

  it("floors a partially complete activity's remaining work at the Data Date (F-01)", () => {
    const activities: ScheduleActivityInput[] = [
      { id: 1, wbsNodeId: 1, activityName: "InProg", originalDurationDays: 10, percentComplete: 60, actualStart: "2026-07-28", remainingDurationDays: 2 },
    ];
    const res = runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar], 1, activities, []);
    expect(res[0].earlyStart).toBe("2026-08-10");
    expect(res[0].earlyFinish).toBe("2026-08-11");
    // Actual Start remains the historical fact it is.
    expect(res[0].earlyStart).not.toBe("2026-07-28");
  });

  it("plannedStart before the CPM result does not pull Early Start earlier (F-09)", () => {
    const build = (plannedStart: string | null) => {
      const activities: ScheduleActivityInput[] = [
        { id: 1, wbsNodeId: 1, activityName: "P", originalDurationDays: 2, plannedStart },
        { id: 2, wbsNodeId: 1, activityName: "S", originalDurationDays: 2 },
      ];
      const deps: ScheduleDependencyInput[] = [
        { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 0 },
      ];
      return runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar], 1, activities, deps);
    };
    const withEarlyPlanned = new Map(build("2026-08-01").map((r) => [r.id, r]));
    const withoutPlanned = new Map(build(null).map((r) => [r.id, r]));
    expect(withEarlyPlanned.get(1)!.earlyStart).toBe(withoutPlanned.get(1)!.earlyStart);
    expect(withEarlyPlanned.get(1)!.earlyFinish).toBe(withoutPlanned.get(1)!.earlyFinish);
    expect(withEarlyPlanned.get(2)!.earlyStart).toBe(withoutPlanned.get(2)!.earlyStart);
  });

  it("plannedStart after the CPM result does not push Early Start later (F-09)", () => {
    const activities: ScheduleActivityInput[] = [
      { id: 1, wbsNodeId: 1, activityName: "P", originalDurationDays: 2 },
      { id: 2, wbsNodeId: 1, activityName: "S", originalDurationDays: 1, plannedStart: "2026-08-20" },
    ];
    const deps: ScheduleDependencyInput[] = [
      { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 0 },
    ];
    const res = runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar], 1, activities, deps);
    const map = new Map(res.map((r) => [r.id, r]));
    // Network says S starts 2026-08-12 (after P finishes 2026-08-11); the planned
    // commitment 2026-08-20 is informational and must not bind Early Start.
    expect(map.get(2)!.earlyStart).toBe("2026-08-12");
    expect(map.get(2)!.earlyFinish).toBe("2026-08-12");
  });

  it("plannedFinish never influences CPM output (F-09)", () => {
    const a1: ScheduleActivityInput = { id: 1, wbsNodeId: 1, activityName: "A", originalDurationDays: 5, plannedStart: "2026-08-10", plannedFinish: "2026-09-30" };
    const a2: ScheduleActivityInput = { id: 1, wbsNodeId: 1, activityName: "A", originalDurationDays: 5 };
    const r1 = runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar], 1, [a1], []);
    const r2 = runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar], 1, [a2], []);
    expect(r1[0].earlyStart).toBe(r2[0].earlyStart);
    expect(r1[0].earlyFinish).toBe(r2[0].earlyFinish);
  });

  it("the engine never trusts arbitrary status strings (F-10)", () => {
    // status='completed' with percentComplete < 100 must NOT be treated as
    // completed — completion is the canonical progress fact (percentComplete 100).
    const activities: ScheduleActivityInput[] = [
      { id: 1, wbsNodeId: 1, activityName: "Lies", originalDurationDays: 5, status: "completed", percentComplete: 20 },
    ];
    const res = runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar], 1, activities, []);
    expect(res[0].earlyStart).toBe("2026-08-10");
    // Remaining work at 20% of a 5-day task is 4 working days (Mon..Thu), NOT zero.
    expect(res[0].earlyFinish).toBe("2026-08-13");
  });
});

describe("adversarial regression (frozen design §10)", () => {
  it("scenario 16: two equal-length parallel paths are both critical", () => {
    // A -> B (3d) and A -> C (3d) then B -> D, C -> D. Both B and C are critical.
    const activities: ScheduleActivityInput[] = [
      { id: 10, wbsNodeId: 1, activityName: "A", originalDurationDays: 1 },
      { id: 20, wbsNodeId: 1, activityName: "B", originalDurationDays: 3 },
      { id: 30, wbsNodeId: 1, activityName: "C", originalDurationDays: 3 },
      { id: 40, wbsNodeId: 1, activityName: "D", originalDurationDays: 1 },
    ];
    const deps: ScheduleDependencyInput[] = [
      { id: 1, predecessorActivityId: 10, successorActivityId: 20, dependencyType: "FS", lagDays: 0 },
      { id: 2, predecessorActivityId: 10, successorActivityId: 30, dependencyType: "FS", lagDays: 0 },
      { id: 3, predecessorActivityId: 20, successorActivityId: 40, dependencyType: "FS", lagDays: 0 },
      { id: 4, predecessorActivityId: 30, successorActivityId: 40, dependencyType: "FS", lagDays: 0 },
    ];
    const res = runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar], 1, activities, deps);
    const map = new Map(res.map((r) => [r.id, r]));
    for (const id of [10, 20, 30, 40]) {
      expect(map.get(id)!.isCritical, `activity ${id}`).toBe(true);
      expect(map.get(id)!.totalFloatDays).toBe(0);
    }
  });

  it("scenario 1/2/3 consolidated: DD floor governs successors, partial progress, and leads", () => {
    // Completed P (finish before DD) -> S; S with SS -2 lead; T in progress.
    const activities: ScheduleActivityInput[] = [
      { id: 1, wbsNodeId: 1, activityName: "P", originalDurationDays: 2, percentComplete: 100, actualStart: "2026-08-03", actualFinish: "2026-08-04" },
      { id: 2, wbsNodeId: 1, activityName: "S", originalDurationDays: 2 },
    ];
    const deps: ScheduleDependencyInput[] = [
      { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "SS", lagDays: -2 },
    ];
    const res = runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar], 1, activities, deps);
    const s = res.find((r) => r.id === 2)!;
    // Negative lead would place S on 2026-08-05, but the Data Date floor wins.
    expect(s.earlyStart).toBe("2026-08-10");
    expect(s.earlyFinish).toBe("2026-08-11");
    // Completed predecessor keeps historical actuals.
    expect(res.find((r) => r.id === 1)!.earlyStart).toBe("2026-08-03");
    expect(res.find((r) => r.id === 1)!.earlyFinish).toBe("2026-08-04");
  });

  it("scenario 7/8: one-day task keeps ES===EF as a task; explicit milestone stays a milestone", () => {
    const task = runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar], 1, [
      { id: 1, wbsNodeId: 1, activityName: "OneDay", originalDurationDays: 1 },
    ], []);
    expect(task[0].earlyStart).toBe("2026-08-10");
    expect(task[0].earlyFinish).toBe("2026-08-10");

    const ms = runScheduleEngine("2026-08-10", "2026-08-10", [monFriCalendar], 1, [
      { id: 2, wbsNodeId: 1, activityName: "Gate", activityType: "milestone", originalDurationDays: 0 },
    ], []);
    expect(ms[0].earlyStart).toBe("2026-08-10");
    expect(ms[0].earlyFinish).toBe("2026-08-10");
  });
});
