import {
  addDays, addMonths, addQuarters, addWeeks, differenceInCalendarDays, format,
  parseISO, startOfDay, startOfMonth, startOfQuarter, startOfWeek,
} from "date-fns";
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
  if (plannedStart && plannedFinish && plannedFinish >= plannedStart) return { start: plannedStart, finish: plannedFinish, source: "planned" as const };
  const earlyStart = parseTimelineDate(activity.earlyStart);
  const earlyFinish = parseTimelineDate(activity.earlyFinish);
  return earlyStart && earlyFinish && earlyFinish >= earlyStart ? { start: earlyStart, finish: earlyFinish, source: "early" as const } : null;
}

export function actualDates(activity: TimelineActivity) {
  const start = parseTimelineDate(activity.actualStart);
  const finish = parseTimelineDate(activity.actualFinish);
  return start && finish && finish >= start ? { start, finish } : null;
}

/* ---------------------------------------------------------------------------
 * Explicit timeline render states.
 *
 * The timeline mixes four independent concepts: planned dates, actual dates,
 * CPM output and % complete.  Collapsing them into one "bar + shading"
 * primitive is what made the rendering lie (a CPM span drawn as a planned bar,
 * an actual-start-only activity drawn as nothing, and a 100% overlay stretched
 * across a planned span that has no Actual Finish behind it).
 *
 * Each concept below is resolved from its OWN fields only.  Nothing here
 * substitutes, infers or fabricates a date.
 * ------------------------------------------------------------------------ */

export type TimelineSpan = { start: Date; finish: Date };

/** Actual state is tri-state: unstarted, started-but-open, or closed. */
export type TimelineActualState =
  | { kind: "none" }
  | { kind: "open"; start: Date }
  | { kind: "closed"; start: Date; finish: Date };

export type TimelineProgress = {
  percent: number;
  isComplete: boolean;
  hasActualFinish: boolean;
  /** True only when a finish date genuinely exists; progress alone never implies one. */
  impliesFinish: boolean;
};

export type TimelineBarSource = "planned" | "cpm";

export type ActivityTimelineModel = {
  planned: TimelineSpan | null;
  cpm: TimelineSpan | null;
  /** The single dated bar to draw, tagged with what it actually represents. */
  primary: { span: TimelineSpan; source: TimelineBarSource } | null;
  actual: TimelineActualState;
  progress: TimelineProgress;
};

/** Planned geometry comes from the planned pair only — never from CPM. */
export function plannedSpan(activity: TimelineActivity): TimelineSpan | null {
  const start = parseTimelineDate(activity.plannedStart);
  const finish = parseTimelineDate(activity.plannedFinish);
  return start && finish && finish >= start ? { start, finish } : null;
}

/** CPM geometry comes from the CPM early pair only. */
export function cpmSpan(activity: TimelineActivity): TimelineSpan | null {
  const start = parseTimelineDate(activity.earlyStart);
  const finish = parseTimelineDate(activity.earlyFinish);
  return start && finish && finish >= start ? { start, finish } : null;
}

/**
 * Actual state.  An Actual Start with no usable Actual Finish stays OPEN: no
 * finish is borrowed from % complete, Data Date, planned finish or CPM finish.
 *
 * A valid Actual Start is a real, persisted fact and is never discarded because
 * the finish beside it is unusable.  Null, empty, whitespace-only, unparsable
 * and reversed finishes all degrade to `open` rather than `none`, so the start
 * keeps rendering.  A closed span requires two valid dates with finish >= start.
 */
export function actualState(activity: TimelineActivity): TimelineActualState {
  const start = parseTimelineDate(activity.actualStart);
  if (!start) return { kind: "none" };
  const rawFinish = typeof activity.actualFinish === "string" ? activity.actualFinish.trim() : activity.actualFinish;
  if (!rawFinish) return { kind: "open", start };
  const finish = parseTimelineDate(rawFinish);
  return finish && finish >= start ? { kind: "closed", start, finish } : { kind: "open", start };
}

/** % complete is progress only; it carries no date meaning of its own. */
export function progressState(activity: TimelineActivity): TimelineProgress {
  const percent = Math.min(100, Math.max(0, activity.percentComplete ?? 0));
  const hasActualFinish = actualState(activity).kind === "closed";
  return { percent, isComplete: percent >= 100, hasActualFinish, impliesFinish: hasActualFinish };
}

/**
 * Full render model for one row.  The primary bar prefers real planned dates
 * and only falls back to CPM when no planned pair exists — and when it does, it
 * is tagged `cpm` so the view can style and label it as CPM output rather than
 * passing it off as a planned bar.
 */
export function activityTimelineModel(activity: TimelineActivity): ActivityTimelineModel {
  const planned = plannedSpan(activity);
  const cpm = cpmSpan(activity);
  const primary = planned
    ? { span: planned, source: "planned" as const }
    : cpm ? { span: cpm, source: "cpm" as const } : null;
  return { planned, cpm, primary, actual: actualState(activity), progress: progressState(activity) };
}

export function isMilestone(
  activity: TimelineActivity,
  dates: { start: Date; finish: Date } | null | undefined = plannedDates(activity)
): boolean {
  return activity.activityType === "milestone" || Boolean(dates && differenceInCalendarDays(dates.finish, dates.start) === 0);
}

export function timelineRange(activities: TimelineActivity[], dataDate?: TimelineDate, today = new Date()) {
  const dates: Date[] = [];
  for (const activity of activities) {
    const { primary, actual } = activityTimelineModel(activity);
    if (primary) dates.push(primary.span.start, primary.span.finish);
    // An open actual start is a real, dated fact and must stay inside the range.
    if (actual.kind === "open") dates.push(actual.start);
    if (actual.kind === "closed") dates.push(actual.start, actual.finish);
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
  const finish = addDays(start, days - 1);
  const periodStart = zoom === "day" ? startOfDay : zoom === "week"
    ? (date: Date) => startOfWeek(date, { weekStartsOn: 1 })
    : zoom === "month" ? startOfMonth : startOfQuarter;
  const nextPeriod = zoom === "day" ? (date: Date) => addDays(date, 1) : zoom === "week"
    ? (date: Date) => addWeeks(date, 1)
    : zoom === "month" ? (date: Date) => addMonths(date, 1) : (date: Date) => addQuarters(date, 1);
  const labelFor = (date: Date) => zoom === "day" ? format(date, "MMM d")
    : zoom === "week" ? `Week of ${format(date, "MMM d")}`
    : zoom === "month" ? format(date, "MMM yyyy") : `Q${Math.floor(date.getMonth() / 3) + 1} ${format(date, "yyyy")}`;
  const ticks: Array<{ date: Date; label: string; offsetDays: number; spanDays: number }> = [];
  for (let period = periodStart(start); period <= finish; period = nextPeriod(period)) {
    const segmentStart = period < start ? start : period;
    const periodFinish = addDays(nextPeriod(period), -1);
    const segmentFinish = periodFinish > finish ? finish : periodFinish;
    ticks.push({
      date: period,
      label: labelFor(period),
      offsetDays: differenceInCalendarDays(segmentStart, start),
      spanDays: differenceInCalendarDays(segmentFinish, segmentStart) + 1,
    });
  }
  return ticks;
}
