import { describe, expect, it } from "vitest";
import {
  runScheduleEngine,
  toWorkingDayIndex,
  fromWorkingDayIndex,
} from "./schedulingEngine";
import type {
  ScheduleActivityInput,
  ScheduleCalendarInput,
  ScheduleDependencyInput,
} from "./schedulingEngine";

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

    // SS - 1 lag: S_SS starts 1 working day before P start -> Fri 2026-08-07
    expect(map.get(3)!.earlyStart).toBe("2026-08-07");

    // FF 0 lag: S_FF finish >= P finish (2026-08-14). Dur=2 => ES = 2026-08-13
    expect(map.get(4)!.earlyStart).toBe("2026-08-13");
    expect(map.get(4)!.earlyFinish).toBe("2026-08-14");

    // SF 0 lag: S_SF finish >= P start (2026-08-10). Dur=2 => ES = 2026-08-07
    expect(map.get(5)!.earlyFinish).toBe("2026-08-10");
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

  it("follows deterministic anchor priority: data_date -> earliest plannedStart -> explicit scheduleDate", () => {
    const actWithPlanned: ScheduleActivityInput = {
      id: 1,
      wbsNodeId: 1,
      activityName: "Act With Planned",
      originalDurationDays: 1,
      plannedStart: "2026-03-02",
    };
    const actWithoutPlanned: ScheduleActivityInput = {
      id: 2,
      wbsNodeId: 1,
      activityName: "Act Without Planned",
      originalDurationDays: 1,
    };

    // 1. projectDataDate ("2026-02-02") overrides both plannedStart ("2026-03-02") and scheduleDate ("2026-04-01") for actWithoutPlanned
    const res1 = runScheduleEngine(
      "2026-02-02",
      "2026-04-01",
      [monFriCalendar],
      1,
      [actWithPlanned, actWithoutPlanned],
      []
    );
    expect(res1.find((r) => r.id === 2)!.earlyStart).toBe("2026-02-02");

    // 2. null projectDataDate -> earliest plannedStart ("2026-03-02") overrides explicit scheduleDate ("2026-04-01") for actWithoutPlanned
    const res2 = runScheduleEngine(
      null,
      "2026-04-01",
      [monFriCalendar],
      1,
      [actWithPlanned, actWithoutPlanned],
      []
    );
    expect(res2.find((r) => r.id === 2)!.earlyStart).toBe("2026-03-02");

    // 3. null projectDataDate and null plannedStart -> explicit scheduleDate ("2026-04-01") is used for actWithoutPlanned
    const res3 = runScheduleEngine(
      null,
      "2026-04-01",
      [monFriCalendar],
      1,
      [actWithoutPlanned],
      []
    );
    expect(res3[0].earlyStart).toBe("2026-04-01");
  });

  it("throws a controlled error when all three anchors (data_date, plannedStart, scheduleDate) are absent/invalid", () => {
    const baseAct: ScheduleActivityInput = {
      id: 1,
      wbsNodeId: 1,
      activityName: "No Anchor Test",
      originalDurationDays: 1,
    };
    expect(() =>
      runScheduleEngine(null, null, [monFriCalendar], 1, [baseAct], [])
    ).toThrow(/no valid project data_date, plannedStart, or scheduleDate anchor available/i);
    expect(() =>
      runScheduleEngine("invalid-date", "bad-date", [monFriCalendar], 1, [baseAct], [])
    ).toThrow(/no valid project data_date, plannedStart, or scheduleDate anchor available/i);
  });
});
