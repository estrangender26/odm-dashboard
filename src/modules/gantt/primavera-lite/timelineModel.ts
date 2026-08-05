import { addDays, differenceInCalendarDays, format, parseISO, startOfDay } from "date-fns";
import type { ActivityGridRow } from "./activityGridModel";

export type TimelineZoom = "day" | "week" | "month" | "quarter";
export type TimelineDate = string | null | undefined;
export type TimelineActivity = ActivityGridRow;

export const ZOOM_PIXELS_PER_DAY: Record<TimelineZoom, number> = {
  day: 44,
  week: 16,
  month: 5,
  quarter: 2,
};

export function parseTimelineDate(value: TimelineDate): Date | null {
  if (!value) return null;
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? null : startOfDay(parsed);
}

export function plannedDates(activity: TimelineActivity) {
  const plannedStart = parseTimelineDate(activity.plannedStart);
  const plannedFinish = parseTimelineDate(activity.plannedFinish);
  if (plannedStart && plannedFinish) return { start: plannedStart, finish: plannedFinish, source: "planned" as const };
  const earlyStart = parseTimelineDate(activity.earlyStart);
  const earlyFinish = parseTimelineDate(activity.earlyFinish);
  return earlyStart && earlyFinish ? { start: earlyStart, finish: earlyFinish, source: "early" as const } : null;
}

export function actualDates(activity: TimelineActivity) {
  const start = parseTimelineDate(activity.actualStart);
  const finish = parseTimelineDate(activity.actualFinish);
  return start && finish ? { start, finish } : null;
}

export function isMilestone(activity: TimelineActivity): boolean {
  return activity.activityType === "milestone";
}

export function timelineRange(activities: TimelineActivity[], dataDate?: TimelineDate, today = new Date()) {
  const dates: Date[] = [];
  for (const activity of activities) {
    const planned = plannedDates(activity);
    const actual = actualDates(activity);
    if (planned) dates.push(planned.start, planned.finish);
    if (actual) dates.push(actual.start, actual.finish);
  }
  if (dates.length === 0) return null;
  const projectDataDate = parseTimelineDate(dataDate);
  if (projectDataDate) dates.push(projectDataDate);
  const min = new Date(Math.min(...dates.map((date) => date.getTime())));
  const max = new Date(Math.max(...dates.map((date) => date.getTime())));
  const current = startOfDay(today);
  const start = addDays(min, -2);
  const finish = addDays(max, 2);
  return { start, finish, today: current, days: differenceInCalendarDays(finish, start) + 1 };
}

export function timelinePosition(date: Date, rangeStart: Date, pixelsPerDay: number): number {
  return differenceInCalendarDays(date, rangeStart) * pixelsPerDay;
}

export function timelineSpan(start: Date, finish: Date, pixelsPerDay: number): number {
  return Math.max(pixelsPerDay, (differenceInCalendarDays(finish, start) + 1) * pixelsPerDay);
}

export function headerTicks(start: Date, days: number, zoom: TimelineZoom) {
  const step = zoom === "day" ? 1 : zoom === "week" ? 7 : zoom === "month" ? 30 : 90;
  return Array.from({ length: Math.ceil(days / step) }, (_, index) => {
    const date = addDays(start, index * step);
    const label = zoom === "day" ? format(date, "MMM d") : zoom === "week" ? format(date, "MMM d") : format(date, "MMM yyyy");
    return { date, label, spanDays: Math.min(step, days - index * step) };
  });
}
