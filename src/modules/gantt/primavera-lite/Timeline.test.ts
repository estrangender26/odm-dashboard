import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { addDays, format } from "date-fns";
import { describe, expect, it } from "vitest";
import { SCHEDULE_ROW_HEIGHT } from "./activityGridModel";
import Timeline, {
  MARKER_CHIP_COLLISION_PX, MILESTONE_CHIP_OFFSET_PX, OPEN_ACTUAL_AFFORDANCE_PX,
  WARNING_CHIP_BAND_BOTTOM_PX, WARNING_CHIP_MAX_HEIGHT_PX, WARNING_CHIP_TOP_PX,
} from "./Timeline";

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
    // The shading is a visual-only decoration: the parent bar's aria-label
    // already announces the percentage, so a second identical announcement
    // must not exist (single screen-reader announcement).
    expect(html).not.toContain('aria-label="25% complete"');
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

  it("legend matches the rendered semantics one-for-one", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [base] }));
    // Every drawable semantic has a legend entry — including the milestone
    // kinds and the open-actual affordance (previously undocumented).
    for (const entry of ["Planned", "Critical", "Actual", "CPM", "Planned milestone", "CPM milestone", "Open actual", "Shaded = % complete", "Striped = 100% unclosed"]) {
      expect(html).toContain(entry);
    }
    // The CPM swatch is hollow like the rendered bars, not a filled swatch.
    expect(html).toContain("border-dashed border-slate-500 bg-transparent");
  });
});

/**
 * Composite visual-scene regressions from the PR #346 forensic review.
 *
 * The element-level tests above prove each primitive is drawn truthfully.
 * These tests prove the COMPOSED scene stays readable: chips, connectors,
 * markers and bars are laid out so they cannot collide — structurally, at
 * every zoom — and that anomalous states keep distinct visual language.
 */
describe("Timeline visual composition (PR #346 forensic follow-up)", () => {
  const reproDeps = [
    { id: 1, predecessorActivityId: 1, successorActivityId: 2, dependencyType: "FS" as const, lagDays: 0 },
    { id: 2, predecessorActivityId: 2, successorActivityId: 3, dependencyType: "FS" as const, lagDays: 0 },
  ];
  const repro = [
    { ...base, id: 1, activityId: "A", activityName: "A", originalDurationDays: 5, percentComplete: 100,
      plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: null,
      earlyStart: "2026-08-13", earlyFinish: "2026-08-17", totalFloatDays: 0 },
    { ...base, id: 2, sortOrder: 1, activityId: "B", activityName: "B", originalDurationDays: 5, percentComplete: 100,
      actualStart: null, actualFinish: null, earlyStart: "2026-08-18", earlyFinish: "2026-08-22", totalFloatDays: 0 },
    { ...base, id: 3, sortOrder: 2, activityId: "C", activityName: "C", originalDurationDays: 2, percentComplete: 0,
      earlyStart: "2026-08-23", earlyFinish: "2026-08-24", totalFloatDays: 0 },
  ];
  const ZOOMS = ["day", "week", "month", "quarter"] as const;

  it("keeps dependency lines from ever intersecting the 100% warning chips, at every zoom", () => {
    // Structural invariant: chips live in the row-top band and connectors run
    // on row midlines. The band's worst-case bottom stays strictly above the
    // lane, so intersection is impossible by construction.
    expect(WARNING_CHIP_TOP_PX + WARNING_CHIP_MAX_HEIGHT_PX).toBe(WARNING_CHIP_BAND_BOTTOM_PX);
    expect(WARNING_CHIP_BAND_BOTTOM_PX).toBeLessThan(SCHEDULE_ROW_HEIGHT / 2);

    for (const zoom of ZOOMS) {
      const html = renderToStaticMarkup(createElement(Timeline, {
        initialZoom: zoom, dataDate: "2026-08-13", dependencies: reproDeps, activities: repro,
      }));
      // Both warning chips render in the row-top band...
      const chips = [...html.matchAll(/aria-label="100% complete[^"]*"[^>]*class="([^"]*)"[^>]*style="left:([\d.]+)px"/g)];
      expect(chips.length).toBe(2);
      for (const chip of chips) expect(chip[1]).toContain("top-0.5");
      // ...each strictly right of its own bar's far edge and of the connector
      // start circle at that edge (r=3), and...
      const bars = new Map([...html.matchAll(/title="([ABC]): [^"]*"[^>]*style="left:([\d.]+)px;width:([\d.]+)px"/g)]
        .map((m) => [m[1], { left: Number(m[2]), right: Number(m[2]) + Number(m[3]) }]));
      expect(bars.size).toBe(3);
      expect(Number(chips[0][2])).toBe(bars.get("A")!.right + 6);
      expect(Number(chips[1][2])).toBe(bars.get("B")!.right + 6);
      // ...every connector polyline segment stays on/below the row-midline lane.
      const paths = [...html.matchAll(/d="M ([\d.]+) ([\d.]+) H ([\d.]+) V ([\d.]+) H ([\d.]+)"/g)];
      expect(paths.length).toBe(2);
      for (const path of paths) {
        expect(Number(path[2]) % SCHEDULE_ROW_HEIGHT).toBe(SCHEDULE_ROW_HEIGHT / 2);
        expect(Number(path[4]) % SCHEDULE_ROW_HEIGHT).toBe(SCHEDULE_ROW_HEIGHT / 2);
        expect(Math.min(Number(path[2]), Number(path[4]))).toBeGreaterThanOrEqual(SCHEDULE_ROW_HEIGHT / 2);
      }
    }
  });

  it("renders one combined readable label when Today equals the Data Date", () => {
    const today = format(new Date(), "yyyy-MM-dd");
    const before = format(addDays(new Date(), -3), "yyyy-MM-dd");
    const after = format(addDays(new Date(), 3), "yyyy-MM-dd");
    const html = renderToStaticMarkup(createElement(Timeline, {
      dataDate: today,
      activities: [{ ...base, plannedStart: before, plannedFinish: after }],
    }));
    // Exactly one combined chip — no stacked "Today" over "Data date" chips.
    expect(html.match(/>Today · Data date</g)).toHaveLength(1);
    expect(html).not.toContain(">Today<");
    expect(html).not.toContain(">Data date<");
    // Both marker lines still exist with their own a11y identities.
    expect(html).toContain('aria-label="Today marker"');
    expect(html).toContain('aria-label="Project data date marker"');
  });

  it("keeps separate, vertically de-collided labels when Today and Data Date merely crowd each other", () => {
    const today = new Date();
    const dataDate = format(addDays(today, -3), "yyyy-MM-dd"); // 48px away at week zoom
    const html = renderToStaticMarkup(createElement(Timeline, {
      dataDate,
      activities: [{ ...base, plannedStart: format(addDays(today, -3), "yyyy-MM-dd"), plannedFinish: format(addDays(today, 3), "yyyy-MM-dd") }],
    }));
    expect(3 * 16).toBeLessThan(MARKER_CHIP_COLLISION_PX); // fixture really is the crowded case
    expect(html.match(/>Today</g)).toHaveLength(1);
    expect(html.match(/>Data date</g)).toHaveLength(1);
    expect(html).not.toContain(">Today · Data date<");
    // The Data Date chip is dropped to the lower slot instead of overlapping the Today chip.
    const ddChip = /class="([^"]*)"[^>]*>Data date</.exec(html);
    expect(ddChip).not.toBeNull();
    expect(ddChip![1]).toContain("top-6");
  });

  it("keeps the open-actual affordance non-metric at Day/Week/Month/Quarter zoom", () => {
    const fragments: string[] = [];
    for (const zoom of ZOOMS) {
      const html = renderToStaticMarkup(createElement(Timeline, {
        initialZoom: zoom,
        activities: [{ ...base, plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: null }],
      }));
      // The old metric gradient tail is gone.
      expect(html).not.toContain("bg-gradient-to-r");
      // The affordance: dot + right-pointing caret.
      const marker = /aria-label="Actual start marker, in progress with no Actual Finish"[^>]*style="([^"]*)"(.*?)<\/span><\/span>/.exec(html);
      expect(marker).not.toBeNull();
      // Position only: no width derives from pixelsPerDay, so size is constant at any zoom.
      expect(marker![1]).not.toContain("width");
      expect(marker![2]).toContain("rounded-full bg-emerald-600"); // exact-start dot
      expect(marker![2]).toContain("border-l-emerald-600");        // non-metric caret
      fragments.push(marker![2]);
    }
    // Byte-identical structure at every zoom: nothing about it measures time.
    expect(new Set(fragments).size).toBe(1);
    // ...and it always fits inside a single week-zoom day cell (16px).
    expect(OPEN_ACTUAL_AFFORDANCE_PX).toBeLessThanOrEqual(16);
  });

  it("never uses ordinary completion shading for 100% without an Actual Finish", () => {
    const open = renderToStaticMarkup(createElement(Timeline, { dataDate: "2026-08-13", activities: repro }));
    // One gradient belongs to the legend swatch; A's bar adds the second.
    expect(open.match(/repeating-linear-gradient/g)!.length).toBeGreaterThanOrEqual(2);
    expect(open).toContain("border-dashed border-amber-300"); // unclosed cap
    // No solid completion wash anywhere in the open-100% scene.
    expect(open).not.toContain("bg-white/55");

    // Control: 100% WITH a real Actual Finish keeps the ordinary solid wash.
    const closed = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, percentComplete: 100, plannedStart: "2026-08-13", plannedFinish: "2026-08-17", actualStart: "2026-08-14", actualFinish: "2026-08-16" },
    ] }));
    expect(closed).toContain("bg-white/55");
    expect(closed.match(/repeating-linear-gradient/g)).toHaveLength(1); // legend swatch only
    expect(closed).toContain('aria-label="Actual bar"');
  });

  it("renders the A/B 100% anomalies as visually and textually distinct states", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { dataDate: "2026-08-13", activities: repro }));
    // A: Actual Start exists, finish missing.
    expect(html).toContain(">100% · no Actual Finish<");
    expect(html).toContain('aria-label="100% complete, no Actual Finish recorded"');
    expect(html).toContain("bg-amber-100 text-amber-800");
    // B: 100% claimed with no actual dates at all — different text, different style.
    expect(html).toContain(">100% · no actual dates<");
    expect(html).toContain('aria-label="100% complete, no actual dates recorded"');
    expect(html).toContain("border-orange-400 bg-orange-50 text-orange-800");
  });

  it("leaves dependency connector geometry untouched in the production reproduction", () => {
    const html = renderToStaticMarkup(createElement(Timeline, {
      dataDate: "2026-08-13", dependencies: reproDeps, activities: repro,
    }));
    expect(html).toContain('d="M 112 20 H 120 V 60 H 112"');
    expect(html).toContain('d="M 192 60 H 200 V 100 H 192"');
    expect(html).toContain('aria-label="FS dependency"');
    expect(html).toContain('marker-end="url(#dependency-arrow)"');
  });

  it("keeps a warning chip clear of a milestone diamond's visual reach", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { activities: [
      { ...base, percentComplete: 100, activityType: "milestone", plannedStart: "2026-08-20", plannedFinish: "2026-08-20" },
    ] }));
    // Diamond: 16px square at left = pos-8, rotated ~45° -> visual reach ≈ pos+11.3px.
    const diamond = /aria-label="Planned milestone"[^>]*style="left:([\d.]+)px"/.exec(html);
    const chip = /aria-label="100% complete, no actual dates recorded"[^>]*style="left:([\d.]+)px"/.exec(html);
    expect(diamond).not.toBeNull();
    expect(chip).not.toBeNull();
    const pos = Number(diamond![1]) + 8;
    expect(Number(chip![1])).toBe(pos + MILESTONE_CHIP_OFFSET_PX);
    expect(Number(chip![1])).toBeGreaterThan(pos + 11.3);
  });
});
