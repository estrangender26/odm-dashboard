import { describe, expect, it } from "vitest";
import {
  calculateDependencyPlannedDates,
  autoSchedule,
} from "@/modules/gantt/engine/dependencyEngine";
import { buildHierarchyPayload } from "@/modules/gantt/engine/hierarchyEngine";
import {
  buildManualHierarchyOrder,
  sortTasksForHierarchyDisplay,
} from "@/modules/gantt/engine/taskReorderEngine";

function applyTaskPatch(
  tasks: any[],
  taskId: number,
  patch: Record<string, any>
) {
  return tasks.map(task => (task.id === taskId ? { ...task, ...patch } : task));
}

function applyReorder(
  tasks: any[],
  updates: { id: number; sort_order: number }[]
) {
  const updateMap = new Map(
    updates.map(update => [update.id, update.sort_order])
  );
  return tasks.map(task => ({
    ...task,
    sortorder: updateMap.get(task.id) ?? task.sortorder,
    sortOrder: updateMap.get(task.id) ?? task.sortOrder,
  }));
}

function taskNames(tasks: any[]) {
  return sortTasksForHierarchyDisplay(tasks).map(task => task.text);
}

function baseTasks() {
  return [
    {
      id: 1,
      text: "A",
      parent: 0,
      parentTaskId: 0,
      sortorder: 1,
      sortOrder: 1,
      wbs_level: 1,
      wbsLevel: 1,
      plannedStart: "2026-01-01",
      plannedEnd: "2026-01-03",
      duration: 3,
    },
    {
      id: 2,
      text: "B",
      parent: 0,
      parentTaskId: 0,
      sortorder: 2,
      sortOrder: 2,
      wbs_level: 1,
      wbsLevel: 1,
      plannedStart: "2026-01-04",
      plannedEnd: "2026-01-06",
      duration: 3,
    },
    {
      id: 3,
      text: "C",
      parent: 0,
      parentTaskId: 0,
      sortorder: 3,
      sortOrder: 3,
      wbs_level: 1,
      wbsLevel: 1,
      plannedStart: "2026-01-07",
      plannedEnd: "2026-01-09",
      duration: 3,
    },
  ];
}

describe("Gantt Planner audit-stabilization validation", () => {
  it("keeps dependency setup, relationship None, and lag changes isolated from row order and hierarchy", () => {
    let tasks = baseTasks();
    expect(taskNames(tasks)).toEqual(["A", "B", "C"]);

    const scheduledFsLag2 = calculateDependencyPlannedDates({
      predecessor: tasks[0],
      successor: tasks[1],
      type: "FS",
      lagDays: 2,
    });
    expect(scheduledFsLag2).toMatchObject({
      plannedStart: "2026-01-05",
      plannedEnd: "2026-01-07",
      duration: 3,
      anchorSource: "planned",
    });
    tasks = applyTaskPatch(tasks, 2, {
      predecessorTaskId: 1,
      dependencyType: "FS",
      lagDays: 2,
      plannedStart: scheduledFsLag2.plannedStart,
      plannedEnd: scheduledFsLag2.plannedEnd,
      duration: scheduledFsLag2.duration,
    });

    expect(taskNames(tasks)).toEqual(["A", "B", "C"]);
    expect(tasks.find(task => task.id === 2)).toMatchObject({
      sortorder: 2,
      parent: 0,
      wbs_level: 1,
      predecessorTaskId: 1,
      dependencyType: "FS",
      lagDays: 2,
      plannedStart: "2026-01-05",
      plannedEnd: "2026-01-07",
    });

    tasks = applyTaskPatch(tasks, 2, {
      predecessorTaskId: null,
      dependencyType: null,
      lagDays: 0,
    });
    expect(taskNames(tasks)).toEqual(["A", "B", "C"]);
    expect(tasks.find(task => task.id === 2)).toMatchObject({
      sortorder: 2,
      parent: 0,
      wbs_level: 1,
      predecessorTaskId: null,
      dependencyType: null,
      lagDays: 0,
    });

    const scheduledFsLag5 = calculateDependencyPlannedDates({
      predecessor: tasks[0],
      successor: tasks[1],
      type: "FS",
      lagDays: 5,
    });
    expect(scheduledFsLag5).toMatchObject({
      plannedStart: "2026-01-08",
      plannedEnd: "2026-01-10",
      duration: 3,
      anchorSource: "planned",
    });
    tasks = applyTaskPatch(tasks, 2, {
      predecessorTaskId: 1,
      dependencyType: "FS",
      lagDays: 5,
      plannedStart: scheduledFsLag5.plannedStart,
      plannedEnd: scheduledFsLag5.plannedEnd,
      duration: scheduledFsLag5.duration,
    });

    expect(taskNames(tasks)).toEqual(["A", "B", "C"]);
    expect(tasks.find(task => task.id === 2)).toMatchObject({
      sortorder: 2,
      parent: 0,
      wbs_level: 1,
      predecessorTaskId: 1,
      dependencyType: "FS",
      lagDays: 5,
      plannedStart: "2026-01-08",
      plannedEnd: "2026-01-10",
    });
  });

  it("moves B down without changing dependency fields or hierarchy", () => {
    const tasks = applyTaskPatch(baseTasks(), 2, {
      predecessorTaskId: 1,
      dependencyType: "FS",
      lagDays: 5,
      plannedStart: "2026-01-08",
      plannedEnd: "2026-01-10",
    });

    const updates = buildManualHierarchyOrder(tasks, 2, "down");
    expect(updates).toEqual([
      { id: 1, sort_order: 1, parent: 0 },
      { id: 3, sort_order: 2, parent: 0 },
      { id: 2, sort_order: 3, parent: 0 },
    ]);

    const reordered = applyReorder(tasks, updates!);
    expect(taskNames(reordered)).toEqual(["A", "C", "B"]);
    expect(reordered.find(task => task.id === 2)).toMatchObject({
      parent: 0,
      parentTaskId: 0,
      wbs_level: 1,
      predecessorTaskId: 1,
      dependencyType: "FS",
      lagDays: 5,
    });
  });

  it("indents B under A with only hierarchy fields changed", () => {
    const tasks = applyTaskPatch(baseTasks(), 2, {
      predecessorTaskId: 1,
      dependencyType: "FS",
      lagDays: 5,
      plannedStart: "2026-01-08",
      plannedEnd: "2026-01-10",
    });
    const bBefore = tasks.find(task => task.id === 2)!;

    const hierarchyPayload = buildHierarchyPayload(bBefore, 1, tasks);
    expect(hierarchyPayload).toEqual({
      id: 2,
      parent: 1,
      parent_task_id: 1,
      wbs_level: 2,
      parent_frontend_uid: null,
    });

    const indented = applyTaskPatch(tasks, 2, {
      parent: hierarchyPayload.parent,
      parentTaskId: hierarchyPayload.parent_task_id,
      wbs_level: hierarchyPayload.wbs_level,
      wbsLevel: hierarchyPayload.wbs_level,
    });
    expect(taskNames(indented)).toEqual(["A", "B", "C"]);
    expect(indented.find(task => task.id === 2)).toMatchObject({
      predecessorTaskId: bBefore.predecessorTaskId,
      dependencyType: bBefore.dependencyType,
      lagDays: bBefore.lagDays,
      plannedStart: bBefore.plannedStart,
      plannedEnd: bBefore.plannedEnd,
      parent: 1,
      wbs_level: 2,
    });
  });

  it("auto-schedules successor dates after predecessor finish changes without changing row position", () => {
    const tasks = applyTaskPatch(baseTasks(), 2, {
      predecessorTaskId: 1,
      dependencyType: "FS",
      lagDays: 5,
      plannedStart: "2026-01-08",
      plannedEnd: "2026-01-10",
    });
    const changedPredecessor = applyTaskPatch(tasks, 1, {
      plannedEnd: "2026-01-10",
    });
    const updates = autoSchedule(
      changedPredecessor as any,
      [{ id: 10, source: 1, target: 2, type: "FS", lag: 5 }],
      1
    );

    expect(updates.get(2)).toMatchObject({
      plannedStart: "2026-01-15",
      plannedEnd: "2026-01-17",
      duration: 3,
      anchorSource: "planned",
    });
    expect(taskNames(changedPredecessor)).toEqual(["A", "B", "C"]);
    expect(changedPredecessor.find(task => task.id === 2)).toMatchObject({
      sortorder: 2,
      parent: 0,
    });
  });

  it("auto-schedules FS successors from predecessor Actual Finish when available", () => {
    const tasks = applyTaskPatch(baseTasks(), 1, { endDate: "2026-01-12" });
    const updates = autoSchedule(
      tasks as any,
      [{ id: 10, source: 1, target: 2, type: "FS", lag: 1 }],
      1
    );

    expect(updates.get(2)).toMatchObject({
      plannedStart: "2026-01-13",
      plannedEnd: "2026-01-15",
      duration: 3,
      anchorSource: "actual",
    });
  });

  it("preserves hierarchy, order, dependency, lag, and planned dates through save-refresh-reopen shaped data", () => {
    const savedRows = [
      { ...baseTasks()[0], projectId: 42 },
      {
        ...baseTasks()[1],
        projectId: 42,
        parent: 1,
        parentTaskId: 1,
        wbs_level: 2,
        wbsLevel: 2,
        predecessorTaskId: 1,
        dependencyType: "FS",
        lagDays: 5,
        plannedStart: "2026-01-08",
        plannedEnd: "2026-01-10",
      },
      { ...baseTasks()[2], projectId: 42 },
    ];
    const savedLinks = [
      { id: 100, source: 1, target: 2, type: "FS", lag: 5, projectId: 42 },
    ];

    const reopenedTasks = JSON.parse(JSON.stringify(savedRows));
    const reopenedLinks = JSON.parse(JSON.stringify(savedLinks));

    expect(reopenedTasks).toHaveLength(3);
    expect(new Set(reopenedTasks.map((task: any) => task.id)).size).toBe(3);
    expect(taskNames(reopenedTasks)).toEqual(["A", "B", "C"]);
    expect(reopenedTasks.find((task: any) => task.id === 2)).toMatchObject({
      parentTaskId: 1,
      parent: 1,
      wbs_level: 2,
      predecessorTaskId: 1,
      dependencyType: "FS",
      lagDays: 5,
      plannedStart: "2026-01-08",
      plannedEnd: "2026-01-10",
    });
    expect(reopenedLinks).toEqual(savedLinks);
  });
});
