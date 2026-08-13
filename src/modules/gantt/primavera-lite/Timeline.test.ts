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
    expect(html).toContain('data-testid="planned-bar"');
    expect(html).toContain('data-testid="actual-bar"');
    expect(html).toContain('data-testid="planned-milestone"');
    expect(html).toContain('aria-label="Project data date marker"');
    expect(html).toContain('<g aria-hidden="true" class="text-slate-600">');
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
    expect(html.match(/data-testid="planned-bar"/g)).toHaveLength(1);
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
    expect(html).toContain('data-testid="planned-bar"');
    expect(html).toContain('data-testid="actual-bar"');
    // Planned bar is blue, actual bar is emerald (distinct colors)
    expect(html).toContain("bg-blue-600");
    expect(html).toContain("bg-emerald-600");
    expect(html).toContain("Shaded = % complete");
    expect(html).toContain('data-testid="completion-shading"');
  });

  it("renders an actual-start-only activity as an open marker, never a closed bar", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: null },
    ] }));
    expect(html).toContain('data-testid="open-actual-caret"');
    expect(html).not.toContain('data-testid="actual-bar"');
  });

  it("renders 100% complete with a null Actual Finish without implying a finish date", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { dataDate: "2026-08-13", activities: [
      { ...base, percentComplete: 100, plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: null },
    ] }));
    expect(html).toContain('aria-label="Highlight Foundations; 100% complete, Actual Start recorded and no Actual Finish"');
    expect(html).toContain("100% · Actual Finish open");
    expect(html).not.toContain('data-testid="actual-bar"');
    // Planned bar keeps its exact 5-day span despite 100% progress and the Data Date.
    expect(html).toContain('data-testid="planned-bar"');
    expect(html).toContain('data-testid="unresolved-completion-treatment"');
    expect(html).not.toContain('data-testid="completion-shading"');
  });

  it("keeps the planned bar intact when the Data Date equals Planned Start", () => {
    const withDataDate = renderToStaticMarkup(createElement(Timeline, { dataDate: "2026-08-13", activities: [
      { ...base, plannedStart: "2026-08-13", plannedFinish: "2026-08-17" },
    ] }));
    const widthWith = /data-testid="planned-bar"[^>]*style="left:(\d+)px;width:(\d+)px"/.exec(withDataDate);
    expect(withDataDate).toContain("Data date");
    // The Data Date is a marker only: it neither clips nor collapses the bar.
    expect(widthWith).not.toBeNull();
    expect(Number(widthWith![2])).toBe(5 * 16);
  });

  it("draws a CPM-only bar distinctly from a planned bar", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, id: 1, earlyStart: "2026-08-18", earlyFinish: "2026-08-22", totalFloatDays: 0 },
    ] }));
    // CPM geometry is never passed off as a planned commitment.
    expect(html).toContain('data-testid="cpm-bar"');
    expect(html).not.toContain('data-testid="planned-bar"');
    expect(html).toContain("border-dashed");
  });

  it("keeps planned and actual semantics recognizable on critical activities", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, id: 1, totalFloatDays: 0, earlyStart: "2026-08-13", earlyFinish: "2026-08-17",
        plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: "2026-08-16" },
    ] }));
    // Critical red styling must not erase the planned/actual distinction.
    expect(html).toContain("bg-red-600");
    expect(html).toContain('data-testid="planned-bar"');
    expect(html).toContain('data-testid="actual-bar"');
    expect(html).toContain("bg-emerald-600");
  });

  it("keeps dependency connector geometry unchanged for planned activities", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { dependencies: [
      { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 0 },
    ], activities: [
      { ...base, id: 1, plannedStart: "2026-08-13", plannedFinish: "2026-08-17" },
      { ...base, id: 2, sortOrder: 1, activityName: "Second", plannedStart: "2026-08-18", plannedFinish: "2026-08-19" },
    ] }));
    expect(html).toContain('<g aria-hidden="true" class="text-slate-600">');
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
    expect(html).toContain('data-testid="planned-bar"');
    expect(html).toContain('data-testid="unresolved-completion-treatment"');
    expect(html).not.toContain('data-testid="completion-shading"');
    expect(html).toContain('data-testid="open-actual-caret"');
    expect(html).toContain('data-testid="open-finish-warning-chip"');
    // No closed actual bar is fabricated anywhere in the reproduction.
    expect(html).not.toContain('data-testid="actual-bar"');
    // B and C are CPM-only and must not masquerade as planned bars.
    expect((html.match(/data-testid="cpm-bar"/g) || []).length).toBe(2);
    expect((html.match(/data-testid="planned-bar"/g) || []).length).toBe(1);
    // Data Date remains a project marker only.
    expect(html).toContain("Data date");
  });

  it("composes anomalous warnings above dependency lines without changing connector geometry", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { dependencies: [
      { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 0 },
    ], activities: [
      { ...base, id: 1, percentComplete: 100, plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: null },
      { ...base, id: 2, sortOrder: 1, activityName: "Successor", plannedStart: "2026-08-18", plannedFinish: "2026-08-19" },
    ] }));
    // Status chips are in the row's status lane above connector paint (z-40 > SVG z-10).
    expect(html).toContain('data-testid="open-finish-warning-chip"');
    expect(html).toContain('top-0 z-40');
    expect(html).toContain('absolute inset-0 z-10');
    // The path is the exact pre-composition FS path; no dependency model input changed.
    expect(html).toContain('d="M 112 20 H 120 V 60 H 112"');
  });

  it("uses one combined readable label when Today equals the Data Date", () => {
    const today = new Date().toISOString().slice(0, 10);
    const html = renderToStaticMarkup(createElement(Timeline, { dataDate: today, activities: [
      { ...base, plannedStart: today, plannedFinish: today },
    ] }));
    expect(html).toContain('aria-label="Today and Project data date marker"');
    expect(html).toContain('Today · Data date');
    expect(html).not.toContain('aria-label="Today marker"');
    expect(html).not.toContain('aria-label="Project data date marker"');
  });

  it("renders the open-actual affordance as a non-metric caret at every zoom", () => {
    for (const initialZoom of ["day", "week", "month", "quarter"] as const) {
      const html = renderToStaticMarkup(createElement(Timeline, { initialZoom, activities: [
        { ...base, plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: null },
      ] }));
      expect(html, initialZoom).toContain('data-testid="open-actual-caret"');
      expect(html, initialZoom).toContain('>▸</span>');
      expect(html, initialZoom).not.toContain('bg-gradient-to-r');
      expect(html, initialZoom).not.toContain('w-6');
    }
  });

  it("renders the two 100% no-finish anomaly states distinctly without normal completion shading", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, id: 1, percentComplete: 100, plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: null },
      { ...base, id: 2, sortOrder: 1, activityName: "No actuals", percentComplete: 100, plannedStart: "2026-08-18", plannedFinish: "2026-08-22", actualStart: null, actualFinish: null },
    ] }));
    expect(html).toContain('data-testid="open-finish-warning-chip"');
    expect(html).toContain('100% · Actual Finish open');
    expect(html).toContain('data-testid="no-actual-dates-warning-chip"');
    expect(html).toContain('100% · no actual dates');
    expect((html.match(/data-testid="unresolved-completion-treatment"/g) || [])).toHaveLength(2);
    expect(html).not.toContain('data-testid="completion-shading"');
  });

  /**
   * M1 regression: a milestone must stay a diamond whatever its span source.
   * Before this fix a CPM-only milestone was rendered as a dashed duration bar.
   */
  it("M1. renders a planned milestone as a solid diamond", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, activityName: "Gate", activityType: "milestone", plannedStart: "2026-08-20", plannedFinish: "2026-08-20" },
    ] }));
    expect(html).toContain('data-testid="planned-milestone"');
    expect(html).toContain("rotate-45");
    expect(html).toContain("bg-blue-500");
    expect(html).not.toContain('data-testid="cpm-milestone"');
    // A milestone is never widened into a duration bar.
    expect(html).not.toContain('data-testid="planned-bar"');
  });

  it("M1. renders an explicit CPM-only milestone as a distinct hollow diamond", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, activityName: "GateCPM", activityType: "milestone", earlyStart: "2026-08-20", earlyFinish: "2026-08-20" },
    ] }));
    expect(html).toContain('data-testid="cpm-milestone"');
    expect(html).toContain("rotate-45");
    // Hollow + dashed keeps it readable as CPM output, not a planned commitment.
    expect(html).toContain("border-dashed");
    expect(html).toContain("bg-transparent");
    expect(html).not.toContain('data-testid="planned-milestone"');
    // It must not regress into a CPM duration bar.
    expect(html).not.toContain('data-testid="cpm-bar"');
  });

  it("M1. renders a zero-duration CPM span as a milestone diamond, not a bar", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, activityName: "ZeroDur", activityType: "task", originalDurationDays: 0, earlyStart: "2026-08-20", earlyFinish: "2026-08-20" },
    ] }));
    expect(html).toContain('data-testid="cpm-milestone"');
    expect(html).not.toContain('data-testid="cpm-bar"');
  });

  it("M1. keeps a critical CPM milestone identifiable as CPM, critical and milestone", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, activityName: "CritGate", activityType: "milestone", earlyStart: "2026-08-20", earlyFinish: "2026-08-20", totalFloatDays: 0 },
    ] }));
    expect(html).toContain('data-testid="cpm-milestone"');   // milestone
    expect(html).toContain("border-red-600");                // critical
    expect(html).toContain("border-dashed");                 // CPM, not planned
    expect(html).toContain("bg-transparent");
    expect(html).toContain("rotate-45");
    expect(html).toContain("(CPM early dates)");
    expect(html).toContain("(Critical)");
    // Critical styling must not promote it to a solid planned diamond.
    expect(html).not.toContain("bg-red-500");
  });

  /**
   * M2 regression: a valid Actual Start must keep rendering even when the
   * Actual Finish beside it is unusable. No finish may be fabricated.
   */
  it("M2. preserves the open Actual Start marker for every unusable finish", () => {
    for (const actualFinish of [null, "", "   ", "not-a-date", "2026-08-13"]) {
      const html = renderToStaticMarkup(createElement(Timeline, { activities: [
        { ...base, activityName: "Open", plannedStart: "2026-08-13", plannedFinish: "2026-08-17",
          actualStart: "2026-08-14", actualFinish },
      ] }));
      expect(html, `finish=${JSON.stringify(actualFinish)}`)
        .toContain('data-testid="open-actual-caret"');
      // Never a closed actual bar, because no usable Actual Finish exists.
      expect(html, `finish=${JSON.stringify(actualFinish)}`).not.toContain('data-testid="actual-bar"');
      // Planned geometry stays exactly 5 days at week zoom.
      expect(html).toContain("width:80px");
    }
  });

  it("M2. still renders a closed actual bar for a valid finish pair", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, activityName: "Closed", plannedStart: "2026-08-13", plannedFinish: "2026-08-17",
        actualStart: "2026-08-14", actualFinish: "2026-08-16" },
    ] }));
    expect(html).toContain('data-testid="actual-bar"');
    expect(html).not.toContain('data-testid="open-actual-caret"');
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
