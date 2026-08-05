import { format } from "date-fns";
import { describe, expect, it } from "vitest";
import { actualDates, headerTicks, isMilestone, plannedDates, timelinePosition, timelineRange, timelineSpan } from "./timelineModel";

const activity = { id: 1, wbsNodeId: 1, sortOrder: 0, activityId: "A1", activityName: "Foundations", originalDurationDays: 3, calendarId: null, percentComplete: 25 };

describe("timelineModel", () => {
  it("prioritizes complete planned dates over early dates", () => {
    const dates = plannedDates({ ...activity, plannedStart: "2026-08-01", plannedFinish: "2026-08-03", earlyStart: "2026-09-01", earlyFinish: "2026-09-03" });
    expect(dates?.source).toBe("planned");
    expect(format(dates!.start, "yyyy-MM-dd")).toBe("2026-08-01");
  });
  it("falls back only to a complete early date pair", () => {
    expect(plannedDates({ ...activity, plannedStart: "2026-08-01", earlyStart: "2026-08-04", earlyFinish: "2026-08-05" })?.source).toBe("early");
    expect(plannedDates({ ...activity, earlyStart: "2026-08-04" })).toBeNull();
  });
  it("uses only complete actual date pairs", () => {
    expect(actualDates({ ...activity, actualStart: "2026-08-01" })).toBeNull();
    expect(actualDates({ ...activity, actualStart: "2026-08-01", actualFinish: "2026-08-02" })).not.toBeNull();
  });
  it("recognizes explicit milestone activity types", () => {
    expect(isMilestone({ ...activity, activityType: "milestone" })).toBe(true);
    expect(isMilestone({ ...activity, activityType: "task" })).toBe(false);
  });
  it("builds a padded project range without calculating missing dates", () => {
    const range = timelineRange([{ ...activity, plannedStart: "2026-08-10", plannedFinish: "2026-08-12" }], "2026-08-11", new Date("2026-08-11T12:00:00Z"));
    expect(range?.days).toBe(7);
    expect(timelineRange([activity])).toBeNull();
    expect(timelineRange([activity], "2026-08-11")).toBeNull();
  });
  it("maps dates and inclusive spans to pixels", () => {
    const start = new Date("2026-08-01T00:00:00Z");
    expect(timelinePosition(new Date("2026-08-03T00:00:00Z"), start, 10)).toBe(20);
    expect(timelineSpan(start, new Date("2026-08-03T00:00:00Z"), 10)).toBe(30);
  });
  it("creates headers for every supported zoom cadence", () => {
    const start = new Date("2026-08-01T00:00:00Z");
    expect(headerTicks(start, 10, "day")).toHaveLength(10);
    expect(headerTicks(start, 10, "week")).toHaveLength(2);
    expect(headerTicks(start, 100, "month")).toHaveLength(4);
    expect(headerTicks(start, 100, "quarter")).toHaveLength(2);
  });
});
