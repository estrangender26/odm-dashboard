import { format } from "date-fns";
import { describe, expect, it } from "vitest";
import { SCHEDULE_ROW_HEIGHT, sortActivities } from "./activityGridModel";
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
  it("recognizes explicit and valid same-day milestones", () => {
    expect(isMilestone({ ...activity, activityType: "milestone" })).toBe(true);
    expect(isMilestone({ ...activity, activityType: "task" })).toBe(false);
    const sameDay = plannedDates({ ...activity, plannedStart: "2026-08-04", plannedFinish: "2026-08-04" });
    expect(isMilestone({ ...activity, activityType: "task" }, sameDay)).toBe(true);
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
  it("uses real calendar boundaries with clipped first and last periods", () => {
    const start = new Date(2024, 1, 27);
    const weeks = headerTicks(start, 10, "week");
    expect(weeks.map((tick) => [format(tick.date, "yyyy-MM-dd"), tick.spanDays])).toEqual([["2024-02-26", 6], ["2024-03-04", 4]]);
    expect(headerTicks(start, 10, "day")).toHaveLength(10);
    const months = headerTicks(start, 10, "month");
    expect(months.map((tick) => [format(tick.date, "yyyy-MM-dd"), tick.spanDays])).toEqual([["2024-02-01", 3], ["2024-03-01", 7]]);
    const quarters = headerTicks(new Date(2024, 2, 30), 5, "quarter");
    expect(quarters.map((tick) => [format(tick.date, "yyyy-MM-dd"), tick.spanDays])).toEqual([["2024-01-01", 2], ["2024-04-01", 3]]);
  });
  it("rejects reversed planned, early and actual ranges from bars and bounds", () => {
    const invalid = { ...activity, plannedStart: "2026-08-10", plannedFinish: "2026-08-09", earlyStart: "2026-08-08", earlyFinish: "2026-08-07", actualStart: "2026-08-06", actualFinish: "2026-08-05" };
    expect(plannedDates(invalid)).toBeNull();
    expect(actualDates(invalid)).toBeNull();
    expect(timelineRange([invalid])).toBeNull();
  });
  it("shares a fixed row contract and stable ordering with the Activity Grid", () => {
    expect(SCHEDULE_ROW_HEIGHT).toBe(40);
    expect(sortActivities([{ ...activity, id: 2, sortOrder: 1 }, activity]).map((row) => row.id)).toEqual([1, 2]);
  });
});
