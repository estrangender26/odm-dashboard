import { describe, expect, it } from "vitest";
import { calcProjectCompletion, calcKpi, taskCompletionPercent } from "../src/modules/gantt/engine/uiUtilsEngine";

describe("Gantt completion and KPI rules", () => {
  it("Completed task with progress 0% should count as 100%", () => {
    expect(taskCompletionPercent({ status: "Completed", progress_percent: 0 })).toBe(100);
  });

  it("Completed task with progress 50% should count as 100%", () => {
    expect(taskCompletionPercent({ status: "Completed", progress_percent: 50 })).toBe(100);
  });

  it("In-progress task with 50% should count as 50%", () => {
    expect(taskCompletionPercent({ status: "In Progress", progress_percent: 50 })).toBe(50);
  });

  it("Overdue completed task should not be overdue", () => {
    const kpi = calcKpi([{ status: "Completed", endDate: "2024-01-01", duration: 4, progress_percent: 0 }]);
    expect(kpi.overdue).toBe(0);
  });

  it("Project % should match weighted task completion", () => {
    const completion = calcProjectCompletion([
      { status: "Completed", progress_percent: 0, duration_days: 2 },
      { status: "In Progress", progress_percent: 50, duration_days: 6 },
      { status: "Not Started", progress_percent: 100, duration_days: 2 },
    ]);
    expect(completion).toBe(50);
  });
});
