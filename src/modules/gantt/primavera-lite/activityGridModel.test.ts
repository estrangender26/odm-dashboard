import { describe, expect, it } from "vitest";
import {
  activityGridPermissions, formatDate, groupActivities, isActivityEditNoop, optimisticActivityArchive,
  optimisticActivityEdit, optimisticActivityReorder, optimisticActivityUpdate, preserveConflictAttempt,
  selectValidNewWbs, sortActivities, validateActivityEdit, validateDateField, validateDatePair,
  type ActivityGridRow,
} from "./activityGridModel";

const rows = [
  { id: 2, wbsNodeId: 1, sortOrder: 1 },
  { id: 1, wbsNodeId: 1, sortOrder: 0 },
  { id: 3, wbsNodeId: 2, sortOrder: 0 },
];

describe("activityGridModel", () => {
  it("sorts and groups activities", () => {
    expect(sortActivities(rows).map((row) => row.id)).toEqual([1, 2, 3]);
    expect(groupActivities(sortActivities(rows)).get(1)?.map((row) => row.id)).toEqual([1, 2]);
  });
  it("optimistically updates and rolls back from a snapshot", () => {
    const snapshot = structuredClone(rows);
    expect(optimisticActivityUpdate(rows, 1, { sortOrder: 9 }).find((row) => row.id === 1)?.sortOrder).toBe(9);
    expect(snapshot).toEqual(rows);
  });
  it("optimistically archives and normalizes only the source WBS", () => {
    const input = [
      { id: 1, wbsNodeId: 1, sortOrder: 0 },
      { id: 2, wbsNodeId: 1, sortOrder: 1 },
      { id: 4, wbsNodeId: 1, sortOrder: 2 },
      { id: 3, wbsNodeId: 2, sortOrder: 7 },
    ];
    expect(optimisticActivityArchive(input, 2)).toEqual([
      { id: 1, wbsNodeId: 1, sortOrder: 0 },
      { id: 4, wbsNodeId: 1, sortOrder: 1 },
      { id: 3, wbsNodeId: 2, sortOrder: 7 },
    ]);
  });
  it("optimistically reassigns WBS and normalizes source and target groups", () => {
    const input = [
      { id: 1, wbsNodeId: 1, sortOrder: 0 },
      { id: 2, wbsNodeId: 1, sortOrder: 1 },
      { id: 3, wbsNodeId: 1, sortOrder: 2 },
      { id: 4, wbsNodeId: 2, sortOrder: 0 },
    ];
    expect(optimisticActivityEdit(input, 2, { wbsNodeId: 2 })).toEqual([
      { id: 1, wbsNodeId: 1, sortOrder: 0 },
      { id: 3, wbsNodeId: 1, sortOrder: 1 },
      { id: 4, wbsNodeId: 2, sortOrder: 0 },
      { id: 2, wbsNodeId: 2, sortOrder: 1 },
    ]);
  });
  it("selects a valid leaf when the root becomes non-leaf", () => {
    expect(selectValidNewWbs(1, [1])).toBe(1);
    expect(selectValidNewWbs(1, [2])).toBe(2);
    expect(selectValidNewWbs(2, [])).toBeNull();
  });
  it("reorders within and across WBS groups", () => {
    expect(optimisticActivityReorder(rows, 2, 1, 0).filter((row) => row.wbsNodeId === 1).map((row) => row.id)).toEqual([2, 1]);
    expect(optimisticActivityReorder(rows, 2, 2, 1).map((row) => [row.id, row.wbsNodeId, row.sortOrder])).toEqual([[1, 1, 0], [3, 2, 0], [2, 2, 1]]);
  });
  it("preserves conflict retry state", () => expect(preserveConflictAttempt(3, "activityName", "Retry me")).toEqual({ activityId: 3, field: "activityName", attemptedValue: "Retry me" }));
  it("projects viewer permissions", () => expect(activityGridPermissions("viewer")).toEqual({ readOnly: true, canEdit: false }));
  it("validates editable values", () => {
    expect(validateActivityEdit("activityName", "")).toBeTruthy();
    expect(validateActivityEdit("originalDurationDays", -1)).toBeTruthy();
    expect(validateActivityEdit("percentComplete", 101)).toBeTruthy();
    expect(validateActivityEdit("percentComplete", 100)).toBeNull();
  });
  it("validates planned and actual date fields", () => {
    expect(validateActivityEdit("plannedStart", "2026-08-10")).toBeNull();
    expect(validateActivityEdit("plannedFinish", "2026-08-12")).toBeNull();
    expect(validateActivityEdit("actualStart", null)).toBeNull();
    expect(validateActivityEdit("actualFinish", "")).toBeNull();
    expect(validateActivityEdit("plannedStart", "not-a-date")).toBeTruthy();
    expect(validateActivityEdit("actualFinish", "2026-13-99")).toBeTruthy();
  });
  it("validates date field formats and ranges", () => {
    expect(validateDateField("2026-08-10")).toBeNull();
    expect(validateDateField("")).toBeNull();
    expect(validateDateField(null)).toBeNull();
    expect(validateDateField("08/10/2026")).toBeTruthy();
    expect(validateDateField("2026-02-30")).toBeTruthy();
    expect(validateDatePair("2026-08-10", "2026-08-12", "Planned")).toBeNull();
    expect(validateDatePair("2026-08-12", "2026-08-10", "Planned")).toBe("Planned start must be on or before planned finish");
    expect(validateDatePair("2026-08-12", "2026-08-10", "Actual")).toBe("Actual start must be on or before actual finish");
  });
  it("formats date values as YYYY-MM-DD", () => {
    expect(formatDate("2026-08-10")).toBe("2026-08-10");
    expect(formatDate(new Date("2026-08-10T00:00:00Z"))).toBe("2026-08-10");
    expect(formatDate(null)).toBe("");
    expect(formatDate("")).toBe("");
  });

  const baseRow: ActivityGridRow = {
    id: 1,
    wbsNodeId: 1,
    sortOrder: 0,
    activityId: "A1",
    activityName: "2026-08-13 Inspection A",
    originalDurationDays: 3,
    percentComplete: 25,
    calendarId: null,
    plannedStart: "2026-08-01",
    plannedFinish: "2026-08-03",
    actualStart: null,
    actualFinish: null,
  };

  it("allows changing an activity name that begins with a YYYY-MM-DD prefix", () => {
    // Regression: a name that looks like an ISO date must NOT be treated as a no-op.
    expect(isActivityEditNoop(baseRow, "activityName", "2026-08-13 Inspection A")).toBe(true);
    expect(isActivityEditNoop(baseRow, "activityName", "2026-08-13 Inspection B")).toBe(false);
    expect(isActivityEditNoop(baseRow, "activityName", "2026-08-14 Inspection A")).toBe(false);
  });

  it("treats identical date edits as no-op", () => {
    expect(isActivityEditNoop(baseRow, "plannedStart", "2026-08-01")).toBe(true);
    expect(isActivityEditNoop(baseRow, "plannedFinish", "2026-08-03")).toBe(true);
    expect(isActivityEditNoop(baseRow, "actualStart", null)).toBe(true);
    // A real date change is NOT a no-op
    expect(isActivityEditNoop(baseRow, "plannedStart", "2026-08-02")).toBe(false);
    expect(isActivityEditNoop(baseRow, "actualStart", "2026-08-01")).toBe(false);
  });

  it("treats identical numeric edits as no-op", () => {
    expect(isActivityEditNoop(baseRow, "originalDurationDays", 3)).toBe(true);
    expect(isActivityEditNoop(baseRow, "percentComplete", 25)).toBe(true);
    expect(isActivityEditNoop(baseRow, "percentComplete", "25")).toBe(true);
    // A real numeric change is NOT a no-op
    expect(isActivityEditNoop(baseRow, "originalDurationDays", 4)).toBe(false);
    expect(isActivityEditNoop(baseRow, "percentComplete", 30)).toBe(false);
  });

  it("does not suppress real text/numeric changes and handles calendarId by number/null", () => {
    expect(isActivityEditNoop(baseRow, "activityId", "A1")).toBe(true);
    expect(isActivityEditNoop(baseRow, "activityId", "A2")).toBe(false);
    expect(isActivityEditNoop(baseRow, "calendarId", null)).toBe(true);
    expect(isActivityEditNoop(baseRow, "calendarId", 5)).toBe(false);
  });

  it("optimistically applies % Complete and Actual Finish synchronization rules", () => {
    const row100WithStart: ActivityGridRow = {
      ...baseRow,
      id: 10,
      percentComplete: 100,
      actualStart: "2026-08-10",
      actualFinish: "2026-08-12",
    };
    const row100NoStart: ActivityGridRow = {
      ...baseRow,
      id: 20,
      percentComplete: 100,
      actualStart: null,
      actualFinish: "2026-08-12",
    };

    // Clearing Actual Finish with Actual Start present -> 99%
    const res1 = optimisticActivityEdit([row100WithStart], 10, { actualFinish: null });
    expect(res1[0].actualFinish).toBeNull();
    expect(res1[0].percentComplete).toBe(99);

    // Clearing Actual Finish with Actual Start null -> 0%
    const res2 = optimisticActivityEdit([row100NoStart], 20, { actualFinish: null });
    expect(res2[0].actualFinish).toBeNull();
    expect(res2[0].percentComplete).toBe(0);

    // Setting Actual Finish -> 100%
    const res3 = optimisticActivityEdit([baseRow], 1, { actualFinish: "2026-08-15" });
    expect(res3[0].actualFinish).toBe("2026-08-15");
    expect(res3[0].percentComplete).toBe(100);

    // Reducing % Complete below 100 -> clears Actual Finish
    const res4 = optimisticActivityEdit([row100WithStart], 10, { percentComplete: 50 });
    expect(res4[0].percentComplete).toBe(50);
    expect(res4[0].actualFinish).toBeNull();
  });
});
