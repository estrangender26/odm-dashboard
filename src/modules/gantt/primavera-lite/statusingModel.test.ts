import { describe, expect, it } from "vitest";
import {
  activityLifecycle,
  forecastRemainingDays,
  LIFECYCLE_LABELS,
  summarizeStatusing,
  type StatusingActivityInput,
} from "./statusingModel";

function row(overrides: Partial<StatusingActivityInput> & { id: number }): StatusingActivityInput {
  return {
    wbsNodeId: 1,
    activityName: `A${overrides.id}`,
    activityType: "task",
    originalDurationDays: 5,
    remainingDurationDays: 0,
    percentComplete: 0,
    actualStart: null,
    actualFinish: null,
    earlyFinish: null,
    status: null,
    archivedAt: null,
    ...overrides,
  };
}

const notStarted = row({ id: 1, earlyFinish: "2026-01-09" });
const inProgress = row({
  id: 2,
  percentComplete: 40,
  actualStart: "2026-01-05",
  remainingDurationDays: 3,
  earlyFinish: "2026-01-07",
});
const completed = row({
  id: 3,
  percentComplete: 100,
  actualStart: "2026-01-05",
  actualFinish: "2026-01-06",
  earlyFinish: "2026-01-06",
});
const archived = row({ id: 4, archivedAt: "2026-01-01", percentComplete: 100, actualFinish: "2026-01-02" });

describe("statusingModel — lifecycle derivation", () => {
  it("derives the lifecycle from execution facts, never from the stored status string", () => {
    expect(activityLifecycle(row({ id: 1, status: "completed" }))).toBe("not-started");
    expect(activityLifecycle(inProgress)).toBe("in-progress");
    expect(activityLifecycle(completed)).toBe("completed");
  });

  it("treats 100% without an Actual Finish as still in progress", () => {
    expect(activityLifecycle(row({ id: 1, percentComplete: 100 }))).toBe("in-progress");
  });

  it("treats progress without an Actual Start as in progress (legacy-tolerant)", () => {
    expect(activityLifecycle(row({ id: 1, percentComplete: 30 }))).toBe("in-progress");
  });

  it("labels every lifecycle", () => {
    expect(LIFECYCLE_LABELS["not-started"]).toBe("Not started");
    expect(LIFECYCLE_LABELS["in-progress"]).toBe("In progress");
    expect(LIFECYCLE_LABELS.completed).toBe("Completed");
  });
});

describe("statusingModel — remaining forecast", () => {
  it("delegates to the scheduling engine so the panel and the schedule agree", () => {
    expect(forecastRemainingDays(row({ id: 1, originalDurationDays: 5, percentComplete: 25 }))).toBe(4);
    expect(forecastRemainingDays(row({ id: 1, originalDurationDays: 5, percentComplete: 25, remainingDurationDays: 0 }))).toBe(4);
    expect(forecastRemainingDays(row({ id: 1, originalDurationDays: 5, percentComplete: 25, remainingDurationDays: 2 }))).toBe(2);
  });

  it("reports zero for completed work and milestones, and the full duration for not-started work", () => {
    expect(forecastRemainingDays(completed)).toBe(0);
    expect(forecastRemainingDays(row({ id: 1, activityType: "milestone", originalDurationDays: 0 }))).toBe(0);
    expect(forecastRemainingDays(notStarted)).toBe(5);
  });
});

describe("statusingModel — roll-up", () => {
  it("counts current work only and excludes archived rows", () => {
    const summary = summarizeStatusing([notStarted, inProgress, completed, archived], "2026-01-07");
    expect(summary.total).toBe(3);
    expect(summary.notStarted).toBe(1);
    expect(summary.inProgress).toBe(1);
    expect(summary.completed).toBe(1);
  });

  it("reports what actually started and finished, with the latest actual finish", () => {
    const summary = summarizeStatusing([notStarted, inProgress, completed], "2026-01-07");
    expect(summary.actualStarted).toBe(2);
    expect(summary.actualFinished).toBe(1);
    expect(summary.latestActualStart).toBe("2026-01-05");
    expect(summary.latestActualFinish).toBe("2026-01-06");
  });

  it("totals the remaining forecast across unfinished work and forecasts the finish of remaining work", () => {
    const summary = summarizeStatusing([notStarted, inProgress, completed], "2026-01-07");
    expect(summary.totalRemainingDays).toBe(8); // 5 (not started) + 3 (in progress)
    expect(summary.forecastFinish).toBe("2026-01-09"); // latest unfinished early finish
    expect(summary.projectFinish).toBe("2026-01-09");
  });

  it("returns a deterministic, empty roll-up for a project with no activities", () => {
    const summary = summarizeStatusing([], "2026-01-07");
    expect(summary.total).toBe(0);
    expect(summary.totalRemainingDays).toBe(0);
    expect(summary.forecastFinish).toBeNull();
    expect(summary.scheduleCalculated).toBe(false);
    expect(summary.dataDate).toBe("2026-01-07");
    expect(summary.dataDateIsSet).toBe(true);
  });

  it("normalizes a date-shaped Data Date and reports an unset one", () => {
    expect(summarizeStatusing([], null).dataDateIsSet).toBe(false);
    expect(summarizeStatusing([], undefined).dataDateIsSet).toBe(false);
    expect(summarizeStatusing([], "2026-01-07T00:00:00.000Z").dataDate).toBe("2026-01-07");
  });
});

describe("statusingModel — notices", () => {
  it("warns when no Data Date is stored instead of substituting today", () => {
    const summary = summarizeStatusing([notStarted], null);
    const warning = summary.warnings.find((w) => w.code === "data-date-not-set");
    expect(warning).toBeDefined();
    expect(warning!.message).toMatch(/not repeatable across days/);
  });

  it("warns when the schedule has not been calculated yet", () => {
    const summary = summarizeStatusing([row({ id: 1 })], "2026-01-07");
    expect(summary.warnings.map((w) => w.code)).toContain("schedule-not-run");
    expect(summary.scheduleCalculated).toBe(false);
  });

  it("flags progress recorded without an Actual Start, with the affected ids", () => {
    const summary = summarizeStatusing([row({ id: 7, percentComplete: 30, earlyFinish: "2026-01-09" })], "2026-01-07");
    const warning = summary.warnings.find((w) => w.code === "progress-without-actual-start");
    expect(warning?.activityIds).toEqual([7]);
    expect(warning!.message).toMatch(/no Actual Start/);
  });

  it("flags a completed activity with no Actual Start separately", () => {
    const summary = summarizeStatusing([row({ id: 8, percentComplete: 100, actualFinish: "2026-01-06", earlyFinish: "2026-01-06" })], "2026-01-07");
    expect(summary.warnings.map((w) => w.code)).toContain("completed-without-actual-start");
  });

  it("flags actual dates that sit after the Data Date, naming the Data Date", () => {
    const summary = summarizeStatusing([row({ id: 9, percentComplete: 100, actualStart: "2026-02-02", actualFinish: "2026-02-03", earlyFinish: "2026-02-03" })], "2026-01-07");
    const warning = summary.warnings.find((w) => w.code === "actuals-after-data-date");
    expect(warning?.activityIds).toEqual([9]);
    expect(warning!.message).toContain("2026-01-07");
  });

  it("does not report actual-date notices when no Data Date is set", () => {
    const summary = summarizeStatusing([row({ id: 9, percentComplete: 100, actualStart: "2026-02-02", actualFinish: "2026-02-03" })], null);
    expect(summary.warnings.map((w) => w.code)).not.toContain("actuals-after-data-date");
  });

  it("is pure: repeated calls with the same input produce deep-equal summaries", () => {
    const activities = [notStarted, inProgress, completed, archived];
    expect(summarizeStatusing(activities, "2026-01-07")).toEqual(summarizeStatusing(activities, "2026-01-07"));
  });
});
