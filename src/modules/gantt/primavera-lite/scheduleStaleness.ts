import { workingDaysEqual } from "./calendarModel";

export type ScheduleAuditEvent = {
  entityType: string;
  action: string;
  beforeData?: unknown;
  afterData?: unknown;
  projectRevision?: number | null;
};

const CPM_ACTIVITY_FIELDS = new Set([
  "activityType", "calendarId", "originalDurationDays", "remainingDurationDays",
  "plannedStart", "plannedFinish", "actualStart", "actualFinish", "percentComplete", "status",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function affectsActiveSchedule(data: unknown): boolean {
  return isRecord(data) && data.affectsActiveSchedule === true;
}

/** True only for audited changes that can alter a CPM calculation. */
export function isCpmDrivingEvent(event: ScheduleAuditEvent): boolean {
  if (event.entityType === "dependency") return ["create", "update", "archive", "restore"].includes(event.action);
  if (event.entityType === "activity") {
    if (["create", "archive", "restore"].includes(event.action)) return true;
    if (event.action !== "update" || !isRecord(event.afterData)) return false;
    const before: Record<string, unknown> = isRecord(event.beforeData) ? event.beforeData : {};
    const after: Record<string, unknown> = event.afterData;
    return [...CPM_ACTIVITY_FIELDS].some((field) => before[field] !== after[field]);
  }
  if (event.entityType === "project" && event.action === "update" && isRecord(event.afterData)) {
    const before = isRecord(event.beforeData) ? event.beforeData : {};
    return before.dataDate !== event.afterData.dataDate || before.defaultCalendarId !== event.afterData.defaultCalendarId;
  }
  if (event.entityType === "calendar") {
    if (event.action !== "update" || !isRecord(event.afterData)) return false;
    if (!affectsActiveSchedule(event.afterData)) return false;
    const before = isRecord(event.beforeData) ? event.beforeData : {};
    return !workingDaysEqual(before.workingDays, event.afterData.workingDays);
  }
  if (event.entityType === "calendarException") {
    if (event.action === "create") return affectsActiveSchedule(event.afterData);
    if (event.action === "delete") return affectsActiveSchedule(event.beforeData) || affectsActiveSchedule(event.afterData);
    if (event.action !== "update" || !isRecord(event.afterData)) return false;
    if (!affectsActiveSchedule(event.afterData)) return false;
    const before = isRecord(event.beforeData) ? event.beforeData : {};
    return (
      String(before.exceptionDate ?? "") !== String(event.afterData.exceptionDate ?? "") ||
      before.isWorking !== event.afterData.isWorking
    );
  }
  return false;
}

/**
 * A project is stale only after a successful schedule and a later CPM-driving
 * audit event.  A never-scheduled project has no computed schedule to mark stale.
 */
export function isScheduleOutOfDate(lastScheduledRevision: number | null | undefined, events: ScheduleAuditEvent[]): boolean {
  if (lastScheduledRevision == null) return false;
  return events.some((event) => (event.projectRevision ?? 0) > lastScheduledRevision && isCpmDrivingEvent(event));
}
