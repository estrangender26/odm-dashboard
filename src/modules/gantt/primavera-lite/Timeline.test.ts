import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Timeline from "./Timeline";

const base = { id: 1, wbsNodeId: 1, sortOrder: 0, activityId: "A1", activityName: "Foundations", originalDurationDays: 3, calendarId: null, percentComplete: 25 };

describe("Timeline", () => {
  it("renders controls, planned/actual bars, milestones and markers read-only", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { dataDate: "2026-08-02", dependencies: [{ id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 0 }], activities: [
      { ...base, plannedStart: "2026-08-01", plannedFinish: "2026-08-03", actualStart: "2026-08-01", actualFinish: "2026-08-02" },
      { ...base, id: 2, sortOrder: 1, activityName: "Gate", activityType: "milestone", plannedStart: "2026-08-04", plannedFinish: "2026-08-04" },
    ] }));
    expect(html).toContain("Fit Project");
    expect(html).toContain('aria-label="Planned bar, 25% complete"');
    expect(html).toContain('aria-label="Actual bar"');
    expect(html).toContain('aria-label="Planned milestone"');
    expect(html).toContain('aria-label="Project data date marker"');
    expect(html).toContain('aria-label="FS dependency"');
    expect(html).toContain('marker-end="url(#dependency-arrow)"');
    expect(html).not.toContain("draggable");
  });
  it("renders the No dates state when no existing dates are available", () => {
    expect(renderToStaticMarkup(createElement(Timeline, { activities: [base] }))).toContain("No dates");
  });
  it("uses sorted activity rows and exposes matching highlight targets", () => {
    const dated = { plannedStart: "2026-08-01", plannedFinish: "2026-08-02" };
    const html = renderToStaticMarkup(createElement(Timeline, { highlightedActivityId: 1, activities: [{ ...base, ...dated, id: 2, sortOrder: 1, activityName: "Second" }, { ...base, ...dated, activityName: "First" }] }));
    expect(html.indexOf("Highlight First")).toBeLessThan(html.indexOf("Highlight Second"));
    expect(html).toContain("bg-blue-50");
    expect(html).toContain("height:40px");
    expect(html).toContain('data-testid="timeline-scroll-viewport"');
  });
  it("renders an invalid-range row as No dates without a bar", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, plannedStart: "2026-08-01", plannedFinish: "2026-08-03" },
      { ...base, id: 2, sortOrder: 1, activityName: "Invalid", plannedStart: "2026-08-10", plannedFinish: "2026-08-09" },
    ] }));
    expect(html.match(/aria-label="Planned bar, 25% complete"/g)).toHaveLength(1);
    expect(html).toContain("No dates");
  });
  it("renders a distinct planned bar and actual bar for the same activity", () => {
    const html = renderToStaticMarkup(
      createElement(Timeline, {
        activities: [{
          ...base,
          plannedStart: "2026-08-01",
          plannedFinish: "2026-08-05",
          actualStart: "2026-08-02",
          actualFinish: "2026-08-03",
        }],
      })
    );
    expect(html).toContain('aria-label="Planned bar, 25% complete"');
    expect(html).toContain('aria-label="Actual bar"');
    // Planned bar is blue, actual bar is emerald (distinct colors)
    expect(html).toContain("bg-blue-600");
    expect(html).toContain("bg-emerald-600");
    expect(html).toContain("Shaded = % complete");
    expect(html).toContain('aria-label="25% complete"');
  });

  it("renders an actual-start-only activity as an open marker, never a closed bar", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: null },
    ] }));
    expect(html).toContain('aria-label="Actual start marker, in progress with no Actual Finish"');
    expect(html).not.toContain('aria-label="Actual bar"');
  });

  it("renders 100% complete with a null Actual Finish without implying a finish date", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { dataDate: "2026-08-13", activities: [
      { ...base, percentComplete: 100, plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: null },
    ] }));
    expect(html).toContain('aria-label="100% complete, no Actual Finish recorded"');
    expect(html).toContain("100% · no Actual Finish");
    expect(html).not.toContain('aria-label="Actual bar"');
    // Planned bar keeps its exact 5-day span despite 100% progress and the Data Date.
    expect(html).toContain('aria-label="Planned bar, 100% complete (no Actual Finish)"');
  });

  it("keeps the planned bar intact when the Data Date equals Planned Start", () => {
    const withDataDate = renderToStaticMarkup(createElement(Timeline, { dataDate: "2026-08-13", activities: [
      { ...base, plannedStart: "2026-08-13", plannedFinish: "2026-08-17" },
    ] }));
    const widthWith = /aria-label="Planned bar[^"]*"[^>]*style="left:(\d+)px;width:(\d+)px"/.exec(withDataDate);
    expect(withDataDate).toContain('aria-label="Project data date marker"');
    // The Data Date is a marker only: it neither clips nor collapses the bar.
    expect(widthWith).not.toBeNull();
    expect(Number(widthWith![2])).toBe(5 * 16);
  });

  it("draws a CPM-only bar distinctly from a planned bar", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, id: 1, earlyStart: "2026-08-18", earlyFinish: "2026-08-22", totalFloatDays: 0 },
    ] }));
    // CPM geometry is never passed off as a planned commitment.
    expect(html).toContain('aria-label="CPM bar');
    expect(html).not.toContain('aria-label="Planned bar');
    expect(html).toContain("border-dashed");
  });

  it("keeps planned and actual semantics recognizable on critical activities", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, id: 1, totalFloatDays: 0, earlyStart: "2026-08-13", earlyFinish: "2026-08-17",
        plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: "2026-08-16" },
    ] }));
    // Critical red styling must not erase the planned/actual distinction.
    expect(html).toContain("bg-red-600");
    expect(html).toContain('aria-label="Planned bar, 25% complete"');
    expect(html).toContain('aria-label="Actual bar"');
    expect(html).toContain("bg-emerald-600");
  });

  it("keeps dependency connector geometry unchanged for planned activities", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { dependencies: [
      { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 0 },
    ], activities: [
      { ...base, id: 1, plannedStart: "2026-08-13", plannedFinish: "2026-08-17" },
      { ...base, id: 2, sortOrder: 1, activityName: "Second", plannedStart: "2026-08-18", plannedFinish: "2026-08-19" },
    ] }));
    expect(html).toContain('aria-label="FS dependency"');
    expect(html).toContain('marker-end="url(#dependency-arrow)"');
    // FS: predecessor planned finish edge (x=112) -> successor planned start edge (x=112),
    // identical to the pre-fix geometry.
    expect(html).toContain('d="M 112 20 H 120 V 60 H 112"');
  });

  it("renders the exact PR345 production reproduction truthfully", () => {
    const html = renderToStaticMarkup(createElement(Timeline, {
      dataDate: "2026-08-13",
      dependencies: [
        { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 0 },
        { id: 2, predecessorActivityId: 2, successorActivityId: 3, dependencyType: "FS", lagDays: 0 },
      ],
      activities: [
        { ...base, id: 1, activityId: "A", activityName: "A", originalDurationDays: 5, percentComplete: 100,
          plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: null,
          earlyStart: "2026-08-13", earlyFinish: "2026-08-17", totalFloatDays: 0 },
        { ...base, id: 2, sortOrder: 1, activityId: "B", activityName: "B", originalDurationDays: 5, percentComplete: 100,
          actualStart: null, actualFinish: null, earlyStart: "2026-08-18", earlyFinish: "2026-08-22", totalFloatDays: 0 },
        { ...base, id: 3, sortOrder: 2, activityId: "C", activityName: "C", originalDurationDays: 2, percentComplete: 0,
          earlyStart: "2026-08-23", earlyFinish: "2026-08-24", totalFloatDays: 0 },
      ],
    }));
    // A: planned span preserved, actual left open, 100% shown without a finish date.
    expect(html).toContain('aria-label="Planned bar, 100% complete (no Actual Finish)"');
    expect(html).toContain('aria-label="Actual start marker, in progress with no Actual Finish"');
    expect(html).toContain('aria-label="100% complete, no Actual Finish recorded"');
    // No closed actual bar is fabricated anywhere in the reproduction.
    expect(html).not.toContain('aria-label="Actual bar"');
    // B and C are CPM-only and must not masquerade as planned bars.
    expect((html.match(/aria-label="CPM bar/g) || []).length).toBe(2);
    expect((html.match(/aria-label="Planned bar/g) || []).length).toBe(1);
    // Data Date remains a project marker only.
    expect(html).toContain('aria-label="Project data date marker"');
  });

  it("visually identifies critical activities with red styling and legend", () => {
    const html = renderToStaticMarkup(
      createElement(Timeline, {
        activities: [
          { ...base, id: 1, earlyStart: "2026-08-01", earlyFinish: "2026-08-05", totalFloatDays: 0 },
          { ...base, id: 2, sortOrder: 1, earlyStart: "2026-08-01", earlyFinish: "2026-08-03", totalFloatDays: 5 },
        ],
      })
    );
    expect(html).toContain("bg-red-600");
    expect(html).toContain("Critical");
    expect(html).toContain("Normal");
  });
});
