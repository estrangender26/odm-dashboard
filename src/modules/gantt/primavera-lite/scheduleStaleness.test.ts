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

  it("does not treat unused calendar mutations as CPM-driving", () => {
    expect(isCpmDrivingEvent({
      entityType: "calendar", action: "create",
      afterData: { name: "Unused", workingDays: [1, 2, 3], affectsActiveSchedule: false },
    })).toBe(false);
    expect(isCpmDrivingEvent({
      entityType: "calendar", action: "update",
      beforeData: { name: "A", workingDays: [1, 2, 3, 4, 5] },
      afterData: { name: "B", workingDays: [1, 2, 3, 4, 5], affectsActiveSchedule: true },
    })).toBe(false);
    expect(isCpmDrivingEvent({
      entityType: "calendar", action: "update",
      beforeData: { workingDays: [1, 2, 3, 4, 5] },
      afterData: { workingDays: [1, 2, 3, 4, 5, 6], affectsActiveSchedule: false },
    })).toBe(false);
  });

  it("treats schedule-relevant workingDays and exception date/isWorking changes as CPM-driving", () => {
    expect(isCpmDrivingEvent({
      entityType: "calendar", action: "update",
      beforeData: { workingDays: [1, 2, 3, 4, 5] },
      afterData: { workingDays: [1, 2, 3, 4, 5, 6], affectsActiveSchedule: true },
    })).toBe(true);
    expect(isCpmDrivingEvent({
      entityType: "calendarException", action: "create",
      afterData: { exceptionDate: "2026-08-17", isWorking: false, affectsActiveSchedule: true },
    })).toBe(true);
    expect(isCpmDrivingEvent({
      entityType: "calendarException", action: "update",
      beforeData: { exceptionDate: "2026-08-17", isWorking: false, description: "old" },
      afterData: { exceptionDate: "2026-08-17", isWorking: false, description: "new", affectsActiveSchedule: true },
    })).toBe(false);
    expect(isCpmDrivingEvent({
      entityType: "calendarException", action: "update",
      beforeData: { exceptionDate: "2026-08-17", isWorking: false },
      afterData: { exceptionDate: "2026-08-18", isWorking: false, affectsActiveSchedule: true },
    })).toBe(true);
    expect(isCpmDrivingEvent({
      entityType: "project", action: "update",
      beforeData: { defaultCalendarId: 1 },
      afterData: { defaultCalendarId: 2 },
    })).toBe(true);
  });
});
