import { format } from "date-fns";
import { describe, expect, it } from "vitest";
import { SCHEDULE_ROW_HEIGHT, sortActivities } from "./activityGridModel";
import {
  activityTimelineModel, actualDates, actualState, cpmSpan, headerTicks, isMilestone,
  plannedDates, plannedSpan, progressState, timelinePosition, timelineRange, timelineSpan,
} from "./timelineModel";

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

/**
 * Representation-truth contract for the timeline model.
 *
 * Planned dates, actual dates, CPM output and % complete are four independent
 * facts. The model must never let one of them fabricate, move or close another.
 */
describe("timelineModel representation states", () => {
  const iso = (date: Date) => format(date, "yyyy-MM-dd");

  it("1. planned pair only renders the exact planned span and never substitutes CPM", () => {
    const model = activityTimelineModel({
      ...activity, plannedStart: "2026-08-13", plannedFinish: "2026-08-17",
      earlyStart: "2026-09-01", earlyFinish: "2026-09-30",
    });
    expect(model.primary?.source).toBe("planned");
    expect(iso(model.primary!.span.start)).toBe("2026-08-13");
    expect(iso(model.primary!.span.finish)).toBe("2026-08-17");
    // CPM stays available as its own fact, but never becomes the planned bar.
    expect(iso(model.cpm!.start)).toBe("2026-09-01");
  });

  it("2. a complete actual pair yields the exact actual span", () => {
    const state = actualState({ ...activity, actualStart: "2026-08-14", actualFinish: "2026-08-16" });
    expect(state.kind).toBe("closed");
    expect(state.kind === "closed" && iso(state.start)).toBe("2026-08-14");
    expect(state.kind === "closed" && iso(state.finish)).toBe("2026-08-16");
  });

  it("3. actual start only stays open instead of fabricating a closed bar", () => {
    const state = actualState({ ...activity, actualStart: "2026-08-14", actualFinish: null });
    expect(state.kind).toBe("open");
    expect(state.kind === "open" && iso(state.start)).toBe("2026-08-14");
    // The legacy closed-pair helper still refuses to invent a finish.
    expect(actualDates({ ...activity, actualStart: "2026-08-14", actualFinish: null })).toBeNull();
  });

  it("4. % complete = 100 with a null Actual Finish implies no finish date", () => {
    const progress = progressState({
      ...activity, percentComplete: 100, actualStart: "2026-08-14", actualFinish: null,
    });
    expect(progress.percent).toBe(100);
    expect(progress.isComplete).toBe(true);
    expect(progress.hasActualFinish).toBe(false);
    expect(progress.impliesFinish).toBe(false);
  });

  it("4b. % complete never fabricates, moves or closes any date", () => {
    const open = { ...activity, plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: null };
    const at0 = activityTimelineModel({ ...open, percentComplete: 0 });
    const at100 = activityTimelineModel({ ...open, percentComplete: 100 });
    // Identical geometry at 0% and 100%: progress is decoration, not a date.
    expect(iso(at100.planned!.finish)).toBe(iso(at0.planned!.finish));
    expect(iso(at100.planned!.start)).toBe(iso(at0.planned!.start));
    expect(at100.actual.kind).toBe("open");
    expect(at0.actual.kind).toBe("open");
  });

  it("5. planned pair plus actual-start-only keeps both semantics distinct", () => {
    const model = activityTimelineModel({
      ...activity, plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: null,
    });
    expect(iso(model.planned!.start)).toBe("2026-08-13");
    expect(iso(model.planned!.finish)).toBe("2026-08-17");
    expect(model.actual.kind).toBe("open");
    // The open actual start is its own date and never trims the planned span.
    expect(model.actual.kind === "open" && iso(model.actual.start)).toBe("2026-08-14");
  });

  it("6. planned pair plus a full actual pair keeps two independent spans", () => {
    const model = activityTimelineModel({
      ...activity, plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: "2026-08-19",
    });
    expect([iso(model.planned!.start), iso(model.planned!.finish)]).toEqual(["2026-08-13", "2026-08-17"]);
    expect(model.actual.kind === "closed" && [iso(model.actual.start), iso(model.actual.finish)])
      .toEqual(["2026-08-14", "2026-08-19"]);
  });

  it("7. a Data Date equal to Planned Start leaves the planned bar intact", () => {
    const row = { ...activity, plannedStart: "2026-08-13", plannedFinish: "2026-08-17" };
    const span = plannedSpan(row);
    const range = timelineRange([row], "2026-08-13", new Date("2026-08-13T12:00:00Z"));
    // Planned geometry is identical with and without a Data Date present.
    expect([iso(span!.start), iso(span!.finish)]).toEqual(["2026-08-13", "2026-08-17"]);
    expect(range).not.toBeNull();
    expect(iso(plannedSpan(row)!.finish)).toBe("2026-08-17");
  });

  it("8/9. critical status is metadata and does not alter planned or actual geometry", () => {
    const critical = {
      ...activity, totalFloatDays: 0, plannedStart: "2026-08-13", plannedFinish: "2026-08-17",
      actualStart: "2026-08-14", actualFinish: "2026-08-16", earlyStart: "2026-08-13", earlyFinish: "2026-08-17",
    };
    const model = activityTimelineModel(critical);
    expect(model.primary?.source).toBe("planned");
    expect([iso(model.planned!.start), iso(model.planned!.finish)]).toEqual(["2026-08-13", "2026-08-17"]);
    expect(model.actual.kind === "closed" && [iso(model.actual.start), iso(model.actual.finish)])
      .toEqual(["2026-08-14", "2026-08-16"]);
  });

  it("falls back to CPM only without a planned pair, and tags it as CPM", () => {
    const model = activityTimelineModel({ ...activity, earlyStart: "2026-08-18", earlyFinish: "2026-08-22" });
    expect(model.primary?.source).toBe("cpm");
    expect(model.planned).toBeNull();
    expect([iso(model.cpm!.start), iso(model.cpm!.finish)]).toEqual(["2026-08-18", "2026-08-22"]);
  });

  it("keeps an open actual start inside the computed project range", () => {
    const range = timelineRange(
      [{ ...activity, plannedStart: "2026-08-13", plannedFinish: "2026-08-14", actualStart: "2026-08-20", actualFinish: null }],
      null, new Date("2026-08-13T12:00:00Z")
    );
    // 2026-08-11 .. 2026-08-22 inclusive = 12 days of padded range.
    expect(range?.days).toBe(12);
  });

  it("treats an invalid actual pair as no actual rather than an invented one", () => {
    expect(actualState({ ...activity, actualStart: "2026-08-16", actualFinish: "2026-08-14" }).kind).toBe("none");
    expect(cpmSpan({ ...activity, earlyStart: "2026-08-16", earlyFinish: "2026-08-14" })).toBeNull();
    expect(plannedSpan({ ...activity, plannedStart: "2026-08-16" })).toBeNull();
  });

  it("11. exact production reproduction: A/B/C after Run Schedule", () => {
    const a = activityTimelineModel({
      ...activity, id: 1, activityName: "A", originalDurationDays: 5, percentComplete: 100,
      plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: null,
      earlyStart: "2026-08-13", earlyFinish: "2026-08-17", totalFloatDays: 0,
    });
    // Planned span is exactly the planned pair — not CPM, not Data-Date clipped.
    expect(a.primary?.source).toBe("planned");
    expect([iso(a.primary!.span.start), iso(a.primary!.span.finish)]).toEqual(["2026-08-13", "2026-08-17"]);
    // Actual Start 2026-08-14 with no Actual Finish stays open.
    expect(a.actual.kind).toBe("open");
    // 100% complete implies no finish date whatsoever.
    expect(a.progress.isComplete).toBe(true);
    expect(a.progress.impliesFinish).toBe(false);

    // B: 100% complete but no actual dates at all -> CPM-only bar, no actual.
    const b = activityTimelineModel({
      ...activity, id: 2, activityName: "B", originalDurationDays: 5, percentComplete: 100,
      actualStart: null, actualFinish: null, earlyStart: "2026-08-18", earlyFinish: "2026-08-22", totalFloatDays: 0,
    });
    expect(b.primary?.source).toBe("cpm");
    expect(b.actual.kind).toBe("none");
    expect(b.progress.impliesFinish).toBe(false);

    // C: not started, CPM-only geometry.
    const c = activityTimelineModel({
      ...activity, id: 3, activityName: "C", originalDurationDays: 2, percentComplete: 0,
      earlyStart: "2026-08-23", earlyFinish: "2026-08-24", totalFloatDays: 0,
    });
    expect(c.primary?.source).toBe("cpm");
    expect(c.actual.kind).toBe("none");
    expect(c.progress.percent).toBe(0);
  });
});
