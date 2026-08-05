import { describe, expect, it } from "vitest";
import {
  activityGridPermissions, groupActivities, optimisticActivityArchive,
  optimisticActivityEdit, optimisticActivityReorder, optimisticActivityUpdate, preserveConflictAttempt,
  selectValidNewWbs, sortActivities, validateActivityEdit,
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
});
