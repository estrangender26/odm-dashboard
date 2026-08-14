import { describe, expect, it } from "vitest";
import { dependencyLineGeometry, dependencyPermissions, optimisticDependencyArchive, optimisticDependencyUpdate, type DependencyRow } from "./dependencyModel";

const activities = [
  { id: 1, wbsNodeId: 1, sortOrder: 0, activityId: "A", activityName: "A", originalDurationDays: 2, calendarId: null, percentComplete: 0, plannedStart: "2026-08-01", plannedFinish: "2026-08-02" },
  { id: 2, wbsNodeId: 1, sortOrder: 1, activityId: "B", activityName: "B", originalDurationDays: 2, calendarId: null, percentComplete: 0, plannedStart: "2026-08-04", plannedFinish: "2026-08-05" },
];
const dependency = (type: DependencyRow["dependencyType"], id: number): DependencyRow => ({ id, predecessorActivityId: 1, successorActivityId: 2, dependencyType: type, lagDays: 0 });

describe("dependencyModel", () => {
  it("maps FS, SS, FF and SF to clear start/finish anchors", () => {
    const lines = dependencyLineGeometry([dependency("FS", 1), dependency("SS", 2), dependency("FF", 3), dependency("SF", 4)], activities, new Date(2026, 7, 1), 10);
    expect(lines.map((line) => [line.type, line.startX, line.endX])).toEqual([
      ["FS", 20, 30], ["SS", 0, 30], ["FF", 20, 50], ["SF", 0, 50],
    ]);
    expect(lines.every((line) => line.path.includes(" V "))).toBe(true);
  });
  it("reacts to activity ordering and zoom", () => {
    const normal = dependencyLineGeometry([dependency("FS", 1)], activities, new Date(2026, 7, 1), 10)[0];
    const moved = dependencyLineGeometry([dependency("FS", 1)], [{ ...activities[0], sortOrder: 1 }, { ...activities[1], sortOrder: 0 }], new Date(2026, 7, 1), 20)[0];
    expect([normal.startY, normal.endY]).toEqual([20, 60]);
    expect([moved.startY, moved.endY]).toEqual([60, 20]);
    expect(moved.startX).toBe(normal.startX * 2);
  });
  it("omits links whose endpoint has no valid dates", () => {
    expect(dependencyLineGeometry([dependency("FS", 1)], [{ ...activities[0], plannedFinish: null }, activities[1]], new Date(2026, 7, 1), 10)).toEqual([]);
  });
  it("supports optimistic update/archive and viewer restrictions", () => {
    const rows = [dependency("FS", 1)];
    expect(optimisticDependencyUpdate(rows, 1, { lagDays: -2 })[0].lagDays).toBe(-2);
    expect(optimisticDependencyArchive(rows, 1)).toEqual([]);
    expect(dependencyPermissions("viewer")).toEqual({ canEdit: false, readOnly: true });
  });

  it("PR345: FS connectors exist when B and C only have CPM dates", () => {
    const smoke = [
      { id: 1, wbsNodeId: 1, sortOrder: 0, activityId: "A", activityName: "Activity A", originalDurationDays: 5, calendarId: null, percentComplete: 100, plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: "2026-08-14", earlyStart: "2026-08-14", earlyFinish: "2026-08-14" },
      { id: 2, wbsNodeId: 1, sortOrder: 1, activityId: "B", activityName: "Activity B", originalDurationDays: 5, calendarId: null, percentComplete: 0, plannedStart: null, plannedFinish: null, earlyStart: "2026-08-17", earlyFinish: "2026-08-21" },
      { id: 3, wbsNodeId: 1, sortOrder: 2, activityId: "C", activityName: "Activity C", originalDurationDays: 2, calendarId: null, percentComplete: 0, plannedStart: null, plannedFinish: null, earlyStart: "2026-08-24", earlyFinish: "2026-08-25" },
    ];
    const lines = dependencyLineGeometry(
      [
        { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 0 },
        { id: 2, predecessorActivityId: 2, successorActivityId: 3, dependencyType: "FS", lagDays: 0 },
      ],
      smoke,
      new Date(2026, 7, 13),
      10
    );
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.type)).toEqual(["FS", "FS"]);
  });
});
