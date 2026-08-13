import { describe, expect, it } from "vitest";
import { isCpmDrivingEvent, isScheduleOutOfDate } from "./scheduleStaleness";

describe("schedule staleness", () => {
  it("only marks CPM-driving events after the successful schedule as stale", () => {
    const activityDurationEdit = { entityType: "activity", action: "update", projectRevision: 8, beforeData: { originalDurationDays: 3 }, afterData: { originalDurationDays: 4 } };
    expect(isCpmDrivingEvent(activityDurationEdit)).toBe(true);
    expect(isScheduleOutOfDate(7, [activityDurationEdit])).toBe(true);
    expect(isScheduleOutOfDate(8, [activityDurationEdit])).toBe(false);
  });

  it("does not mark cosmetic activity or project edits as stale", () => {
    expect(isCpmDrivingEvent({ entityType: "activity", action: "update", beforeData: { activityName: "Old" }, afterData: { activityName: "New" } })).toBe(false);
    expect(isCpmDrivingEvent({ entityType: "project", action: "update", beforeData: { name: "Old" }, afterData: { name: "New" } })).toBe(false);
    expect(isScheduleOutOfDate(null, [])).toBe(false);
  });
});
