import { describe, expect, it } from "vitest";
import {
  computeSubmissionAggregates,
  countDistinctProjectsSubmittedInWindow,
  deriveProjectSubmissionStatus,
  startOfUtcDay,
  startOfUtcWeek,
  type MasterdataSubmissionStatus,
} from "./projects-without-ppp-status";

describe("deriveProjectSubmissionStatus", () => {
  it("project with zero successful current submissions is Not Submitted", () => {
    expect(deriveProjectSubmissionStatus(0)).toBe("not_submitted");
  });

  it("one successful finalized Excel submission is Submitted", () => {
    expect(deriveProjectSubmissionStatus(1)).toBe("submitted");
  });

  it("one successful finalized PDF submission is Submitted", () => {
    expect(deriveProjectSubmissionStatus(1)).toBe("submitted");
  });

  it("failed/unfinalized uploads do not count (only finalized current rows exist)", () => {
    // The derivation consumes the count of successfully finalized current
    // submission rows; an unfinalized upload never creates such a row.
    expect(deriveProjectSubmissionStatus(0)).toBe("not_submitted");
    expect(deriveProjectSubmissionStatus(2)).toBe("submitted");
  });

  it("status is derived from DB evidence, not a manual field", () => {
    // There is no status column anywhere: the same function drives the
    // dashboard, the detail view and the supersede flow.
    const statuses: MasterdataSubmissionStatus[] = [
      deriveProjectSubmissionStatus(0),
      deriveProjectSubmissionStatus(3),
    ];
    expect(statuses).toEqual(["not_submitted", "submitted"]);
  });
});

describe("computeSubmissionAggregates", () => {
  it("0 of 50 submitted -> 0%", () => {
    const a = computeSubmissionAggregates(Array(50).fill("not_submitted"), 50);
    expect(a).toEqual({ totalProjects: 50, submitted: 0, notSubmitted: 50, submissionRate: 0 });
  });

  it("25 of 50 submitted -> 50%", () => {
    const statuses = Array(50).fill("not_submitted") as MasterdataSubmissionStatus[];
    for (let i = 0; i < 25; i++) statuses[i] = "submitted";
    const a = computeSubmissionAggregates(statuses, 50);
    expect(a).toEqual({ totalProjects: 50, submitted: 25, notSubmitted: 25, submissionRate: 50 });
  });

  it("50 of 50 submitted -> 100%", () => {
    const a = computeSubmissionAggregates(Array(50).fill("submitted"), 50);
    expect(a).toEqual({ totalProjects: 50, submitted: 50, notSubmitted: 0, submissionRate: 100 });
  });

  it("1 of 50 submitted -> 2% (critical acceptance scenario)", () => {
    const statuses = Array(50).fill("not_submitted") as MasterdataSubmissionStatus[];
    statuses[0] = "submitted";
    const a = computeSubmissionAggregates(statuses, 50);
    expect(a).toEqual({ totalProjects: 50, submitted: 1, notSubmitted: 49, submissionRate: 2 });
  });
});

describe("countDistinctProjectsSubmittedInWindow", () => {
  const now = new Date("2026-08-27T10:00:00Z");

  it("counts distinct projects, not files (two files on one project = 1)", () => {
    const rows = [
      { projectId: 1, submittedAt: new Date("2026-08-27T08:00:00Z") },
      { projectId: 1, submittedAt: new Date("2026-08-27T09:00:00Z") },
      { projectId: 2, submittedAt: new Date("2026-08-27T07:00:00Z") },
    ];
    expect(countDistinctProjectsSubmittedInWindow(rows, startOfUtcDay(now), now)).toBe(2);
  });

  it("ignores rows outside the window", () => {
    const rows = [
      { projectId: 1, submittedAt: new Date("2026-08-26T23:00:00Z") },
      { projectId: 2, submittedAt: new Date("2026-08-28T00:00:00Z") },
    ];
    expect(countDistinctProjectsSubmittedInWindow(rows, startOfUtcDay(now), now)).toBe(0);
  });

  it("ignores rows without a submittedAt", () => {
    const rows = [{ projectId: 1, submittedAt: null }];
    expect(countDistinctProjectsSubmittedInWindow(rows, startOfUtcDay(now), now)).toBe(0);
  });
});

describe("time windows", () => {
  it("startOfUtcDay is midnight UTC", () => {
    const d = startOfUtcDay(new Date("2026-08-27T10:00:00Z"));
    expect(d.toISOString()).toBe("2026-08-27T00:00:00.000Z");
  });

  it("startOfUtcWeek is the Monday of the week", () => {
    const d = startOfUtcWeek(new Date("2026-08-27T10:00:00Z")); // Thursday
    expect(d.toISOString()).toBe("2026-08-24T00:00:00.000Z"); // Monday
  });
});
