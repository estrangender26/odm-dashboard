import { describe, expect, it } from "vitest";
import {
  buildStatusDatePreview,
  formatVarianceDays,
  statusDateExpectedProgress,
} from "./updateProjectEngine";

describe("updateProjectEngine Phase 1 status-date preview", () => {
  it("calculates expected progress, remaining duration, variance, overdue, and behind-schedule metrics", () => {
    const preview = buildStatusDatePreview([
      {
        id: 1,
        text: "Design",
        owner: "Planner",
        plannedStart: "2026-06-01",
        plannedEnd: "2026-06-10",
        progress: 30,
        duration: 10,
        status: "In Progress",
      },
      {
        id: 2,
        text: "Procurement",
        owner: "Buyer",
        plannedStart: "2026-05-20",
        plannedEnd: "2026-05-25",
        progress: 80,
        duration: 6,
        status: "In Progress",
      },
      {
        id: 3,
        text: "Complete",
        owner: "Ops",
        plannedStart: "2026-06-01",
        plannedEnd: "2026-06-05",
        progress: 100,
        duration: 5,
        status: "Completed",
      },
    ], "2026-06-05");

    expect(preview.summary).toEqual({
      totalTasks: 3,
      overdue: 1,
      behindSchedule: 2,
      avgExpectedProgress: 83,
      avgActualProgress: 70,
      totalRemainingDuration: 9,
      avgVarianceDays: -1,
    });
    expect(preview.rows[0]).toMatchObject({
      text: "Design",
      expectedProgress: 50,
      actualProgress: 30,
      remainingDuration: 7,
      varianceDays: -2,
      overdue: false,
      behindSchedule: true,
    });
    expect(preview.rows[1]).toMatchObject({
      text: "Procurement",
      expectedProgress: 100,
      actualProgress: 80,
      remainingDuration: 2,
      varianceDays: -1,
      overdue: true,
      behindSchedule: true,
    });
    expect(preview.rows[2]).toMatchObject({
      text: "Complete",
      expectedProgress: 100,
      actualProgress: 100,
      remainingDuration: 0,
      varianceDays: 0,
      overdue: false,
      behindSchedule: false,
    });
  });

  it("is a read-only Phase 1 preview and does not move dates, reschedule, propagate, or mutate input tasks", () => {
    const tasks = [
      {
        id: 10,
        text: "Parent",
        parent: 0,
        plannedStart: "2026-06-01",
        plannedEnd: "2026-06-20",
        progress: 20,
      },
      {
        id: 11,
        text: "Child",
        parent: 10,
        predecessorTaskId: 99,
        dependencyType: "FS",
        plannedStart: "2026-06-01",
        plannedEnd: "2026-06-10",
        progress: 20,
      },
    ];
    const before = structuredClone(tasks);

    const preview = buildStatusDatePreview(tasks, "2026-06-15");

    expect(tasks).toEqual(before);
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]).toMatchObject({
      id: 11,
      plannedStart: "2026-06-01",
      plannedEnd: "2026-06-10",
      overdue: true,
      behindSchedule: true,
    });
  });

  it("supports common backend field aliases", () => {
    const preview = buildStatusDatePreview([
      {
        id: 20,
        task_name: "Alias task",
        planned_start: "2026-07-01",
        planned_finish: "2026-07-04",
        progress_percent: 25,
        plannedDuration: 4,
      },
    ], "2026-07-02");

    expect(preview.rows[0]).toMatchObject({
      text: "Alias task",
      plannedStart: "2026-07-01",
      plannedEnd: "2026-07-04",
      expectedProgress: 50,
      actualProgress: 25,
      remainingDuration: 3,
      varianceDays: -1,
      behindSchedule: true,
    });
  });

  it("formats variance days consistently for preview UI", () => {
    expect(formatVarianceDays(0)).toBe("0d");
    expect(formatVarianceDays(3)).toBe("+3d");
    expect(formatVarianceDays(-2)).toBe("-2d");
  });

  it("bounds expected progress before, during, and after the planned window", () => {
    expect(statusDateExpectedProgress("2026-08-10", "2026-08-14", "2026-08-01")).toBe(0);
    expect(statusDateExpectedProgress("2026-08-10", "2026-08-14", "2026-08-12")).toBe(60);
    expect(statusDateExpectedProgress("2026-08-10", "2026-08-14", "2026-08-20")).toBe(100);
  });
});
