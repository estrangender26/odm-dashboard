import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Timeline from "./Timeline";

const base = { id: 1, wbsNodeId: 1, sortOrder: 0, activityId: "A1", activityName: "Foundations", originalDurationDays: 3, calendarId: null, percentComplete: 25 };

/** Pins `new Date()` while `fn` runs so Today/Data Date marker behaviour is
 *  deterministic regardless of the machine clock. */
function withFakeClock(iso: string, fn: () => void) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
  try {
    fn();
  } finally {
    vi.useRealTimers();
  }
}

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
    // Progress is announced once, by the planned bar's own aria-label; the
    // visual shading overlay is a decoration and must not repeat it.
    expect(html).not.toContain('aria-label="25% complete"');
    expect(html).toContain('aria-hidden="true"');
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
    withFakeClock("2026-09-01T12:00:00Z", () => {
      const withDataDate = renderToStaticMarkup(createElement(Timeline, { dataDate: "2026-08-13", activities: [
        { ...base, plannedStart: "2026-08-13", plannedFinish: "2026-08-17" },
      ] }));
      const widthWith = /aria-label="Planned bar[^"]*"[^>]*style="left:(\d+)px;width:(\d+)px"/.exec(withDataDate);
      expect(withDataDate).toContain('aria-label="Project data date marker"');
      // The Data Date is a marker only: it neither clips nor collapses the bar.
      expect(widthWith).not.toBeNull();
      expect(Number(widthWith![2])).toBe(5 * 16);
    });
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
    withFakeClock("2026-09-01T12:00:00Z", () => {
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
      // B: 100% with no actual dates at all gets the distinct anomaly label.
      expect(html).toContain('aria-label="100% complete, no actual dates recorded"');
      // No closed actual bar is fabricated anywhere in the reproduction.
      expect(html).not.toContain('aria-label="Actual bar"');
      // B and C are CPM-only and must not masquerade as planned bars.
      expect((html.match(/aria-label="CPM bar/g) || []).length).toBe(2);
      expect((html.match(/aria-label="Planned bar/g) || []).length).toBe(1);
      // Data Date remains a project marker only.
      expect(html).toContain('aria-label="Project data date marker"');
    });
  });

  /** ------------------------------------------------------------------------
   * PR346 forensic-review regressions: visual composition of the anomaly
   * states, marker collisions, non-metric open-actual affordance, unclosed
   * 100% shading, A/B anomaly distinction, legend truthfulness and duplicate
   * screen-reader announcements.
   * ---------------------------------------------------------------------- */

  it("keeps dependency lines clear of the 100% warning chips", () => {
    const html = renderToStaticMarkup(createElement(Timeline, {
      dependencies: [
        { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 0 },
      ],
      activities: [
        { ...base, id: 1, activityId: "A", activityName: "A", percentComplete: 100,
          plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: null },
        { ...base, id: 2, sortOrder: 1, activityName: "B", plannedStart: "2026-08-18", plannedFinish: "2026-08-19" },
      ],
    }));
    // Dependency geometry is unchanged: the FS connector runs at row centres
    // (y = 20 for row 0, y = 60 for row 1).
    expect(html).toContain('d="M 112 20 H 120 V 60 H 112"');
    const lineY = Number(/d="M \d+ (\d+) H/.exec(html)![1]);
    expect(lineY).toBe(20);
    // The warning chip is lifted above the z-10 dependency layer (z-20)...
    const chipStart = html.indexOf('aria-label="100% complete, no Actual Finish recorded"');
    const chip = html.slice(chipStart, html.indexOf(">", chipStart) + 1);
    expect(chip).toContain('class="absolute top-0 z-20 inline-flex h-[18px] items-center rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800"');
    expect(html).toContain('class="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible"');
    // ...and its vertical band (top-0 + h-[18px] = 0..18px) ends above the
    // connector line (y = 20px), so the chip is neither pierced nor crossed.
    expect(chip).toContain("top-0");
    expect(chip).toContain("h-[18px]");
    expect(0 + 18).toBeLessThan(lineY);
    // The chip also stays clear of the open-actual marker band (top-6 = 24px)
    // and of the adjacent row's geometry (which starts at y = 40px).
    expect(chip).toContain('style="left:116px"');
    expect(html).toContain('class="absolute top-6 flex h-2 items-center gap-0.5"');
  });

  it("renders one combined, readable marker when Today equals the Data Date", () => {
    withFakeClock("2026-08-13T10:00:00Z", () => {
      const html = renderToStaticMarkup(createElement(Timeline, { dataDate: "2026-08-13", activities: [
        { ...base, plannedStart: "2026-08-13", plannedFinish: "2026-08-17" },
      ] }));
      expect((html.match(/aria-label="Today and project data date marker"/g) || [])).toHaveLength(1);
      expect(html).toContain("Today · Data date");
      // The two separate labels must not be stacked on the same day.
      expect(html).not.toContain('aria-label="Today marker"');
      expect(html).not.toContain('aria-label="Project data date marker"');
      // The combined label must not wrap into stacked lines.
      expect(html).toContain("whitespace-nowrap");
    });
  });

  it("keeps Today and Data Date as separate markers on different dates", () => {
    withFakeClock("2026-08-13T10:00:00Z", () => {
      const html = renderToStaticMarkup(createElement(Timeline, { dataDate: "2026-08-15", activities: [
        { ...base, plannedStart: "2026-08-13", plannedFinish: "2026-08-17" },
      ] }));
      expect(html).toContain('aria-label="Today marker"');
      expect(html).toContain('aria-label="Project data date marker"');
      expect(html).not.toContain('aria-label="Today and project data date marker"');
      // Distinct offsets: Today at 08-13 (x=32), Data Date at 08-15 (x=64).
      expect(html).toContain('aria-label="Today marker" class="pointer-events-none absolute inset-y-0 z-10 w-px bg-red-500" style="left:32px"');
      expect(html).toContain('aria-label="Project data date marker" class="pointer-events-none absolute inset-y-0 z-10 border-l-2 border-dashed border-violet-600" style="left:64px"');
    });
  });

  it("renders the open-actual affordance as a fixed non-metric caret at every zoom", () => {
    const markers: string[] = [];
    const expectedLeft: Record<string, number> = { day: 132, week: 48, month: 15, quarter: 6 };
    for (const zoom of ["day", "week", "month", "quarter"] as const) {
      const html = renderToStaticMarkup(createElement(Timeline, { initialZoom: zoom, activities: [
        { ...base, activityName: "Open", plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: null },
      ] }));
      const markerStart = html.indexOf('aria-label="Actual start marker, in progress with no Actual Finish"');
      expect(markerStart).toBeGreaterThan(-1);
      // The affordance markup ends at the caret span (the container's last
      // child); search from the marker so the legend's identical swatch is
      // not picked up instead. The container's opening tag begins at the
      // `<span` before the title attribute.
      const caret = 'class="h-0 w-0 border-y-4 border-l-[6px] border-y-transparent border-l-emerald-600"';
      const spanStart = html.lastIndexOf("<span", markerStart);
      const container = html.slice(spanStart, html.indexOf(caret, markerStart) + caret.length);
      // Fixed-size dot + caret only: the container carries a left offset and
      // never a width, and no metric gradient tail exists at any zoom.
      expect(container).toMatch(/^<span title="Open: actual start 2026-08-14 \(in progress, no Actual Finish\)" aria-label="Actual start marker, in progress with no Actual Finish" class="absolute top-6 flex h-2 items-center gap-0\.5" style="left:\d+px">/);
      expect(container).not.toContain("width:");
      expect(container).not.toContain("bg-gradient-to-r");
      expect(container).toContain('class="h-2 w-2 rounded-full bg-emerald-600"');
      expect(container).toContain(caret);
      expect(container).toContain(`style="left:${expectedLeft[zoom]}px"`);
      // Apart from the day offset, the markup is byte-identical at every zoom:
      // the affordance is non-metric and cannot imply a duration.
      markers.push(container.replace(/left:\d+px/, "left:Npx"));
    }
    expect(new Set(markers).size).toBe(1);
  });

  it("never paints ordinary completion shading for 100% without an Actual Finish", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, activityName: "OpenDone", percentComplete: 100, plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: null },
    ] }));
    const barStart = html.indexOf('aria-label="Planned bar, 100% complete (no Actual Finish)"');
    const bar = html.slice(barStart, html.indexOf("</span>", barStart) + "</span>".length);
    // Endpoints are untouched: the planned span stays exactly 5 days at week zoom.
    expect(bar).toContain('style="left:32px;width:80px"');
    // The ordinary full-span % shading is replaced by the unresolved hatch.
    expect(bar).not.toContain("bg-white/55");
    expect(bar).not.toContain('style="width:100%"');
    expect(bar).toContain("repeating-linear-gradient");

    // A genuinely closed 100% activity keeps the ordinary completion shading.
    const closed = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, activityName: "ClosedDone", percentComplete: 100, plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: "2026-08-16" },
    ] }));
    const closedBarStart = closed.indexOf('aria-label="Planned bar, 100% complete"');
    const closedBar = closed.slice(closedBarStart, closed.indexOf("</span>", closedBarStart) + "</span>".length);
    expect(closedBar).toContain("bg-white/55");
    expect(closedBar).toContain('style="width:100%"');
    expect(closedBar).not.toContain("repeating-linear-gradient");
  });

  it("distinguishes the two 100% anomalies visually and verbally", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, id: 1, activityId: "A", activityName: "A", percentComplete: 100,
        plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: null },
      { ...base, id: 2, sortOrder: 1, activityId: "B", activityName: "B", percentComplete: 100,
        plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: null, actualFinish: null },
    ] }));
    // A: an Actual Start exists, only the finish is missing (amber, open).
    expect(html).toContain('aria-label="100% complete, no Actual Finish recorded"');
    expect(html).toContain("100% · no Actual Finish");
    expect(html).toContain("bg-amber-100");
    expect(html).toContain("text-amber-800");
    // B: no actual dates exist at all (rose, anomaly).
    expect(html).toContain('aria-label="100% complete, no actual dates recorded"');
    expect(html).toContain("100% · no actual dates");
    expect(html).toContain("bg-rose-100");
    expect(html).toContain("text-rose-700");
    // A keeps its open Actual Start marker; B renders none.
    expect((html.match(/aria-label="Actual start marker/g) || []).length).toBe(1);
    // Each bar carries a distinct, truthful progress label.
    expect(html).toContain('aria-label="Planned bar, 100% complete (no Actual Finish)"');
    expect(html).toContain('aria-label="Planned bar, 100% complete (no actual dates)"');
    // Both anomalies use the unresolved hatch; the only ordinary shading
    // swatch left is the legend's "% complete" key.
    expect((html.match(/repeating-linear-gradient/g) || []).length).toBe(2);
    expect((html.match(/bg-white\/55/g) || []).length).toBe(1);
  });

  it("legend matches the rendered semantics one-to-one", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, id: 1, earlyStart: "2026-08-01", earlyFinish: "2026-08-05", totalFloatDays: 0 },
      { ...base, id: 2, sortOrder: 1, earlyStart: "2026-08-01", earlyFinish: "2026-08-03", totalFloatDays: 5 },
    ] }));
    expect(html).toContain("bg-red-600");
    // Every rendered primitive has a legend key: planned bar, critical bar,
    // closed actual bar, open-actual dot+caret, CPM hollow bar, planned
    // milestone diamond, CPM milestone diamond and the % shading.
    expect(html).toContain("> Planned</span>");
    expect(html).toContain("> Critical</span>");
    expect(html).toContain("> Actual</span>");
    expect(html).toContain("> Open actual</span>");
    expect(html).toContain("> CPM</span>");
    expect(html).toContain("> Planned milestone</span>");
    expect(html).toContain("> CPM milestone</span>");
    expect(html).toContain("Shaded = % complete");
    // The old generic "Normal" legend label is gone.
    expect(html).not.toContain("Normal");
  });

  it("keeps dependency connector geometry unchanged when anomaly states are present", () => {
    withFakeClock("2026-09-01T12:00:00Z", () => {
      const html = renderToStaticMarkup(createElement(Timeline, {
        dataDate: "2026-08-13",
        dependencies: [
          { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS", lagDays: 0 },
          { id: 2, predecessorActivityId: 2, successorActivityId: 3, dependencyType: "FS", lagDays: 0 },
        ],
        activities: [
          { ...base, id: 1, activityId: "A", activityName: "A", percentComplete: 100,
            plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: null },
          { ...base, id: 2, sortOrder: 1, activityId: "B", activityName: "B", percentComplete: 100,
            earlyStart: "2026-08-18", earlyFinish: "2026-08-22", totalFloatDays: 0 },
          { ...base, id: 3, sortOrder: 2, activityId: "C", activityName: "C", percentComplete: 0,
            earlyStart: "2026-08-23", earlyFinish: "2026-08-24", totalFloatDays: 0 },
        ],
      }));
      // Byte-identical to the pre-fix PR345 reproduction connector geometry,
      // even with warning chips, hatch shading and open-actual carets present.
      expect(html).toContain('d="M 112 20 H 120 V 60 H 112"');
      expect(html).toContain('d="M 192 60 H 200 V 100 H 192"');
      expect((html.match(/aria-label="FS dependency"/g) || []).length).toBe(2);
      expect(html).toContain('marker-end="url(#dependency-arrow)"');
    });
  });

  /**
   * M1 regression: a milestone must stay a diamond whatever its span source.
   * Before this fix a CPM-only milestone was rendered as a dashed duration bar.
   */
  it("M1. renders a planned milestone as a solid diamond", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, activityName: "Gate", activityType: "milestone", plannedStart: "2026-08-20", plannedFinish: "2026-08-20" },
    ] }));
    expect(html).toContain('aria-label="Planned milestone"');
    expect(html).toContain("rotate-45");
    expect(html).toContain("bg-blue-500");
    expect(html).not.toContain('aria-label="CPM milestone"');
    // A milestone is never widened into a duration bar.
    expect(html).not.toContain('aria-label="Planned bar');
  });

  it("M1. renders an explicit CPM-only milestone as a distinct hollow diamond", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, activityName: "GateCPM", activityType: "milestone", earlyStart: "2026-08-20", earlyFinish: "2026-08-20" },
    ] }));
    expect(html).toContain('aria-label="CPM milestone"');
    expect(html).toContain("rotate-45");
    // Hollow + dashed keeps it readable as CPM output, not a planned commitment.
    expect(html).toContain("border-dashed");
    expect(html).toContain("bg-transparent");
    expect(html).not.toContain('aria-label="Planned milestone"');
    // It must not regress into a CPM duration bar.
    expect(html).not.toContain('aria-label="CPM bar');
  });

  it("M1. renders a zero-duration CPM span as a milestone diamond, not a bar", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, activityName: "ZeroDur", activityType: "task", originalDurationDays: 0, earlyStart: "2026-08-20", earlyFinish: "2026-08-20" },
    ] }));
    expect(html).toContain('aria-label="CPM milestone"');
    expect(html).not.toContain('aria-label="CPM bar');
  });

  it("M1. keeps a critical CPM milestone identifiable as CPM, critical and milestone", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, activityName: "CritGate", activityType: "milestone", earlyStart: "2026-08-20", earlyFinish: "2026-08-20", totalFloatDays: 0 },
    ] }));
    expect(html).toContain('aria-label="CPM milestone"');   // milestone
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
        .toContain('aria-label="Actual start marker, in progress with no Actual Finish"');
      // Never a closed actual bar, because no usable Actual Finish exists.
      expect(html, `finish=${JSON.stringify(actualFinish)}`).not.toContain('aria-label="Actual bar"');
      // Planned geometry stays exactly 5 days at week zoom.
      expect(html).toContain("width:80px");
    }
  });

  it("M2. still renders a closed actual bar for a valid finish pair", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, activityName: "Closed", plannedStart: "2026-08-13", plannedFinish: "2026-08-17",
        actualStart: "2026-08-14", actualFinish: "2026-08-16" },
    ] }));
    expect(html).toContain('aria-label="Actual bar"');
    expect(html).not.toContain('aria-label="Actual start marker, in progress with no Actual Finish"');
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
    expect(html).toContain("Planned");
  });
});
