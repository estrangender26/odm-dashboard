import { describe, expect, it } from "vitest";
import {
  buildManualHierarchyOrder,
  getSiblingOrderState,
  sortTasksForHierarchyDisplay,
} from "@/modules/gantt/engine/taskReorderEngine";

function applyOrder(
  tasks: any[],
  updates: { id: number; sort_order: number }[]
) {
  const byId = new Map(updates.map(update => [update.id, update.sort_order]));
  return tasks
    .map(task => ({ ...task, sortorder: byId.get(task.id) ?? task.sortorder }))
    .sort((a, b) => a.sortorder - b.sortorder)
    .map(task => task.text);
}

describe("Gantt task adjacent reorder", () => {
  it("moves a selected child up and down one sibling position at a time", () => {
    const tasks = [
      { id: 1, text: "Parent", parent: 0, sortorder: 1, wbs_level: 0 },
      { id: 2, text: "Child A", parent: 1, sortorder: 2, wbs_level: 1 },
      { id: 3, text: "Child B", parent: 1, sortorder: 3, wbs_level: 1 },
      { id: 4, text: "Child C", parent: 1, sortorder: 4, wbs_level: 1 },
    ];

    const moveUp = buildManualHierarchyOrder(tasks, 3, "up");
    expect(moveUp).not.toBeNull();
    expect(applyOrder(tasks, moveUp!)).toEqual([
      "Parent",
      "Child B",
      "Child A",
      "Child C",
    ]);
    expect(moveUp!.find(update => update.id === 3)?.parent).toBe(1);

    const afterMoveUp = tasks.map(task => ({
      ...task,
      sortorder: moveUp!.find(update => update.id === task.id)?.sort_order,
    }));
    const moveDown = buildManualHierarchyOrder(afterMoveUp, 3, "down");
    expect(moveDown).not.toBeNull();
    expect(applyOrder(afterMoveUp, moveDown!)).toEqual([
      "Parent",
      "Child A",
      "Child B",
      "Child C",
    ]);

    const afterMoveDown = afterMoveUp.map(task => ({
      ...task,
      sortorder: moveDown!.find(update => update.id === task.id)?.sort_order,
    }));
    const moveDownAgain = buildManualHierarchyOrder(afterMoveDown, 3, "down");
    expect(moveDownAgain).not.toBeNull();
    expect(applyOrder(afterMoveDown, moveDownAgain!)).toEqual([
      "Parent",
      "Child A",
      "Child C",
      "Child B",
    ]);
  });

  it("keeps movement inside the selected task parent group", () => {
    const tasks = [
      { id: 1, text: "Root A", parent: 0, sortorder: 1 },
      { id: 2, text: "Child A", parent: 1, sortorder: 2 },
      { id: 3, text: "Child B", parent: 1, sortorder: 3 },
      { id: 4, text: "Root B", parent: 0, sortorder: 4 },
    ];

    const moveDown = buildManualHierarchyOrder(tasks, 3, "down");
    expect(moveDown).toBeNull();
    expect(getSiblingOrderState(tasks, 3)).toMatchObject({
      index: 1,
      count: 2,
      parentId: 1,
    });
  });

  it("returns updates only for direct siblings without changing parent ids", () => {
    const tasks = [
      { id: 1, text: "Root A", parent: 0, sortorder: 10 },
      { id: 2, text: "Child A", parent: 1, sortorder: 20 },
      { id: 3, text: "Child B", parent: 1, sortorder: 30 },
      { id: 4, text: "Root B", parent: 0, sortorder: 40 },
    ];

    const moveUp = buildManualHierarchyOrder(tasks, 3, "up");
    expect(moveUp).toEqual([
      { id: 3, sort_order: 1, parent: 1 },
      { id: 2, sort_order: 2, parent: 1 },
    ]);
    expect(moveUp?.map(update => update.id)).not.toContain(1);
    expect(moveUp?.map(update => update.id)).not.toContain(4);
  });
});

describe("Gantt task rendered order after refetch", () => {
  it("uses sort_order inside each sibling group after adjacent swaps", () => {
    const tasks = [
      { id: 1, text: "Parent", parent: 0, sortorder: 10 },
      { id: 2, text: "Child A", parent: 1, sortorder: 20 },
      { id: 3, text: "Child B", parent: 1, sortorder: 30 },
      { id: 4, text: "Child C", parent: 1, sortorder: 40 },
    ];

    const moveDown = buildManualHierarchyOrder(tasks, 3, "down");
    expect(moveDown).not.toBeNull();
    const refetchedAfterDown = tasks.map(task => ({
      ...task,
      sortorder:
        moveDown!.find(update => update.id === task.id)?.sort_order ??
        task.sortorder,
    }));
    expect(
      sortTasksForHierarchyDisplay(refetchedAfterDown).map(task => task.text)
    ).toEqual(["Parent", "Child A", "Child C", "Child B"]);

    const moveUp = buildManualHierarchyOrder(refetchedAfterDown, 3, "up");
    expect(moveUp).not.toBeNull();
    const refetchedAfterUp = refetchedAfterDown.map(task => ({
      ...task,
      sortorder:
        moveUp!.find(update => update.id === task.id)?.sort_order ??
        task.sortorder,
    }));
    expect(
      sortTasksForHierarchyDisplay(refetchedAfterUp).map(task => task.text)
    ).toEqual(["Parent", "Child A", "Child B", "Child C"]);
  });
});
