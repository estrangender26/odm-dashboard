/**
 * Governance deck slide layout helpers.
 *
 * Geometry constants are measured in EMU directly from the approved reference
 * deck "O&M Governance Onboarding Progress - 2026-08-26.pptx" (the committed
 * GovernanceExecutive.pptx template) so that data-driven markers, rails, and
 * phase segments land exactly where the approved reference places them.
 *
 * The module is split into pure geometry/date math (unit-testable without a
 * template) and small XML shape helpers used by the slide updaters.
 */

import { NS, getElementsByTagNameNS } from "../../framework";
import type { XmlDocument, XmlElement } from "../../framework";

// ---------------------------------------------------------------------------
// Slide 1 — milestone rail
// ---------------------------------------------------------------------------

/**
 * The nine milestone columns on each facility rail, in EMU x-offset, left to
 * right (M1..M9), and their planned month offset relative to the PPP start.
 */
export const RAIL_MILESTONE_XS = [
  2890838, 3890963, 4891088, 5891213, 6891338, 7891463, 8891588, 9891713, 10891838,
] as const;

export const RAIL_MONTH_OFFSETS = [-6, -4, -1, 2, 6, 11, 13, 16, 19] as const;

/** Dot y-position (EMU) of each facility's milestone rail. Symbol y = dot y + SYMBOL_DY. */
export const FACILITY_RAIL_DOT_YS: Record<string, number> = {
  aglipay: 2352675,
  htt: 3152775,
  eastbay: 3952875,
  kaysakat: 4752975,
};

/** Shape-name prefixes used by the template for per-facility markers/rails. */
export const FACILITY_SHAPE_PREFIX: Record<string, string> = {
  aglipay: "AGLIPAY STP",
  htt: "HTT STP",
  eastbay: "EASTBAY PH-2 TP",
  kaysakat: "KAYSAKAT TP",
};

/**
 * Milestone rail geometry. The rail is a thin horizontal bar that must pass
 * exactly through the vertical center of every milestone marker: rail center y
 * == dot center y. All four facility rows use identical geometry.
 */
export const RAIL = {
  x0: 2771775,
  width: 8505825,
  height: 38100,
  dotHeight: 266700,
} as const;

/** Horizontal/vertical offset of the status symbol text shape from its dot. */
export const SYMBOL_DX = 28575;
export const SYMBOL_DY = 9525;

// ---------------------------------------------------------------------------
// Slide 1 — mini phase bar (under each facility name)
// ---------------------------------------------------------------------------

/**
 * The mini phase bar under each facility name spans the full 28-month
 * lifecycle relative to the PPP start: PRE-PPP (8 months) + PPP (12 months) +
 * POST-PPP (8 months). The red TODAY marker sits on this bar.
 */
export const MINI_BAR = {
  x0: 685800,
  width: 1809750,
  preMonths: 8,
  pppMonths: 12,
  postMonths: 20, // post window ends at +20 months
} as const;

// ---------------------------------------------------------------------------
// Slide 2 — calendar timeline
// ---------------------------------------------------------------------------

/**
 * Fixed calendar ticks of the approved timeline, from grid-line x-positions in
 * the template. Dates are month starts; interpolation is linear.
 */
export const TIMELINE_TICKS = [
  { date: "2025-07-01", x: 2571750 },
  { date: "2026-01-01", x: 4052820 },
  { date: "2026-07-01", x: 5509743 },
  { date: "2027-01-01", x: 6990813 },
  { date: "2027-07-01", x: 8447736 },
  { date: "2028-01-01", x: 9928806 },
  { date: "2028-05-01", x: 10902771 },
] as const;

export const TIMELINE_MIN_X = TIMELINE_TICKS[0].x;
export const TIMELINE_MAX_X = TIMELINE_TICKS[TIMELINE_TICKS.length - 1].x;

/**
 * Approved phase windows relative to the PPP start date:
 * PRE-PPP = start − 8 months .. start; PPP = start .. start + 12 months;
 * POST-PPP = start + 12 .. start + 20 months.
 */
export const PHASE_WINDOWS = {
  preMonths: 8,
  pppMonths: 12,
  postMonths: 20,
} as const;

// ---------------------------------------------------------------------------
// Date math (pure)
// ---------------------------------------------------------------------------

/**
 * Add a number of months to an ISO date (YYYY-MM-DD), clamping the day to the
 * last valid day of the target month.
 */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const firstOfTarget = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const day = Math.min(d, lastDay);
  const dt = new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth(), day));
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

/**
 * Whole-month difference between two ISO dates (YYYY-MM-DD), ignoring the day
 * of month. Used to place the TODAY marker against month-based milestone rails.
 */
export function monthDiff(startIso: string, endIso: string): number {
  const [sy, sm] = startIso.split("-").map(Number);
  const [ey, em] = endIso.split("-").map(Number);
  if (!sy || !sm || !ey || !em) return 0;
  return (ey - sy) * 12 + (em - sm);
}

/**
 * Map an ISO date to an x-position on the Slide 2 calendar timeline by linear
 * interpolation between the nearest template ticks. Clamped to the timeline.
 */
export function timelineXForDate(isoDate: string): number {
  const t = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(t)) return TIMELINE_MIN_X;

  const first = Date.parse(`${TIMELINE_TICKS[0].date}T00:00:00Z`);
  const lastTick = TIMELINE_TICKS[TIMELINE_TICKS.length - 1];
  const last = Date.parse(`${lastTick.date}T00:00:00Z`);

  if (t <= first) return TIMELINE_MIN_X;
  if (t >= last) return TIMELINE_MAX_X;

  for (let i = 1; i < TIMELINE_TICKS.length; i++) {
    const a = TIMELINE_TICKS[i - 1];
    const b = TIMELINE_TICKS[i];
    const ta = Date.parse(`${a.date}T00:00:00Z`);
    const tb = Date.parse(`${b.date}T00:00:00Z`);
    if (t <= tb) {
      const frac = (t - ta) / (tb - ta);
      return Math.round(a.x + frac * (b.x - a.x));
    }
  }
  return TIMELINE_MAX_X;
}

/**
 * Map a milestone month offset (relative to PPP start) to an x-position on the
 * Slide 1 milestone rail (M1..M9 columns). Clamped to the rail.
 */
export function railXForMonthOffset(offset: number): number {
  const lo = RAIL_MONTH_OFFSETS[0];
  const hi = RAIL_MONTH_OFFSETS[RAIL_MONTH_OFFSETS.length - 1];
  const clamped = Math.max(lo, Math.min(hi, offset));
  const frac = (clamped - lo) / (hi - lo);
  return Math.round(
    RAIL_MILESTONE_XS[0] + frac * (RAIL_MILESTONE_XS[RAIL_MILESTONE_XS.length - 1] - RAIL_MILESTONE_XS[0])
  );
}

/**
 * Map a milestone month offset to an x-position on the Slide 1 mini phase bar
 * (spanning −8 .. +20 months relative to PPP start). Clamped to the bar.
 */
export function miniXForMonthOffset(offset: number): number {
  const lo = -MINI_BAR.preMonths;
  const hi = MINI_BAR.postMonths;
  const clamped = Math.max(lo, Math.min(hi, offset));
  const frac = (clamped - lo) / (hi - lo);
  return Math.round(MINI_BAR.x0 + frac * MINI_BAR.width);
}

// ---------------------------------------------------------------------------
// XML shape helpers
// ---------------------------------------------------------------------------

export function findShapesByName(doc: XmlDocument, name: string): XmlElement[] {
  const shapes = doc.getElementsByTagNameNS(NS.p, "sp");
  const result: XmlElement[] = [];
  for (let i = 0; i < shapes.length; i++) {
    const el = shapes[i] as XmlElement;
    const cNvPr = getElementsByTagNameNS(el, "p", "cNvPr")[0];
    if (cNvPr && cNvPr.getAttribute("name") === name) {
      result.push(el);
    }
  }
  return result;
}

export function getShapeOff(shape: XmlElement): { x: number; y: number } {
  const xfrm = getElementsByTagNameNS(shape, "a", "xfrm")[0];
  const off = xfrm ? getElementsByTagNameNS(xfrm, "a", "off")[0] : null;
  return {
    x: off ? Number(off.getAttribute("x")) || 0 : 0,
    y: off ? Number(off.getAttribute("y")) || 0 : 0,
  };
}

export function setShapeOff(shape: XmlElement, x: number, y: number): void {
  const xfrm = getElementsByTagNameNS(shape, "a", "xfrm")[0];
  if (!xfrm) return;
  const off = getElementsByTagNameNS(xfrm, "a", "off")[0];
  if (!off) return;
  off.setAttribute("x", String(Math.round(x)));
  off.setAttribute("y", String(Math.round(y)));
}

export function setShapeWidth(shape: XmlElement, cx: number): void {
  const xfrm = getElementsByTagNameNS(shape, "a", "xfrm")[0];
  if (!xfrm) return;
  const ext = getElementsByTagNameNS(xfrm, "a", "ext")[0];
  if (!ext) return;
  ext.setAttribute("cx", String(Math.max(0, Math.round(cx))));
}

export function setShapeVisible(shape: XmlElement, visible: boolean): void {
  const cNvPr = getElementsByTagNameNS(shape, "p", "cNvPr")[0];
  if (!cNvPr) return;
  if (visible) {
    cNvPr.removeAttribute("visible");
  } else {
    cNvPr.setAttribute("visible", "0");
  }
}

export function isShapeVisible(shape: XmlElement): boolean {
  const cNvPr = getElementsByTagNameNS(shape, "p", "cNvPr")[0];
  if (!cNvPr) return true;
  const visible = cNvPr.getAttribute("visible");
  return visible === null || visible !== "0";
}

/**
 * Move a shape to the end of its parent (the slide's shape tree) so it paints
 * above everything earlier in the tree. Used to guarantee milestone markers
 * always render above their facility's rail line regardless of where the
 * underlying template shape originally sat in the z-order.
 */
export function appendShapeToEnd(shape: XmlElement): void {
  if (shape.parentNode) {
    shape.parentNode.appendChild(shape);
  }
}

/**
 * Deterministically reposition every facility's milestone rail so the rail
 * passes exactly through the vertical center of its markers, with identical
 * geometry across all four rows (rail center y == dot center y).
 */
export function alignMilestoneRails(doc: XmlDocument): void {
  for (const [slug, dotY] of Object.entries(FACILITY_RAIL_DOT_YS)) {
    const prefix = FACILITY_SHAPE_PREFIX[slug];
    if (!prefix) continue;
    const rail = findShapesByName(doc, `${prefix} Milestone Rail`)[0];
    if (!rail) continue;
    const railY = dotY + RAIL.dotHeight / 2 - RAIL.height / 2;
    setShapeOff(rail, RAIL.x0, railY);
    setShapeWidth(rail, RAIL.width);
  }
}

/**
 * Deep-clone a shape, give it a unique id/name, and insert it immediately
 * after the source shape so the clone paints on top of it.
 */
export function cloneShape(doc: XmlDocument, source: XmlElement, newName: string): XmlElement {
  const clone = source.cloneNode(true) as XmlElement;

  let maxId = 0;
  const all = doc.getElementsByTagNameNS(NS.p, "cNvPr");
  for (let i = 0; i < all.length; i++) {
    const id = Number((all[i] as XmlElement).getAttribute("id"));
    if (Number.isFinite(id) && id > maxId) maxId = id;
  }

  const cNvPr = getElementsByTagNameNS(clone, "p", "cNvPr")[0];
  if (cNvPr) {
    cNvPr.setAttribute("id", String(maxId + 1));
    cNvPr.setAttribute("name", newName);
  }

  if (source.parentNode) {
    source.parentNode.insertBefore(clone, source.nextSibling);
  }
  return clone;
}
