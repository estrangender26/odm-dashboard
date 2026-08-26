/**
 * Slide 1 milestone rail renderer.
 *
 * Makes the per-facility M1..M9 milestone status symbols fully data-driven
 * using the approved four visual states:
 *
 *   achieved (and achieved ahead of plan) → green dot + white ✓
 *   in_progress (authoritative backend evidence, customPct 0..100) → yellow
 *       dot + navy … (activity started, not yet complete)
 *   gap ("planned by now — still open")   → light dot + red outline + red !
 *   upcoming                              → light dot + gray outline, no icon
 *
 * The "achieved ahead of plan" state keeps its underlying milestone truth
 * (the status is never recalculated) but maps to the achieved visual
 * treatment; the cyan "ahead" visual state and its legend entry are removed.
 * The yellow in-progress visual is only produced when the backend supplies
 * authoritative progress evidence (0 < customPct < 100 without completion) —
 * calendar position alone never renders yellow.
 *
 * Rendering guarantees:
 * - every marker is placed at its canonical M1..M9 column x, centered
 *   vertically on the facility rail;
 * - markers are re-appended to the end of the shape tree so they always paint
 *   ABOVE the rail (the rail never paints a stripe across a marker);
 * - unused template shapes (including all "ahead" shapes) are hidden so no
 *   stale or duplicate symbol leaks through.
 */

import { NS, getShapeName, setShapeText } from "../../framework";
import type { XmlDocument, XmlElement } from "../../framework";
import type { FacilityData, MilestoneStatus } from "../../../governance-v3/types";
import {
  FACILITY_RAIL_DOT_YS,
  RAIL_MILESTONE_XS,
  SYMBOL_DX,
  SYMBOL_DY,
  appendShapeToEnd,
  cloneShape,
  findShapesByName,
  getShapeOff,
  setRunTextColor,
  setShapeOff,
  setShapeSolidFill,
  setShapeVisible,
} from "./slideLayout";

const MILESTONE_CODES = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"] as const;

/** Yellow "in progress" visual: amber filled dot with a navy ellipsis. */
const IN_PROGRESS = {
  dotFill: "FFC000",
  symbolFill: "071B3D",
  glyph: "…",
} as const;

/**
 * Approved four-state visual mapping. "achieved_ahead" keeps its milestone
 * truth but renders with the achieved visual; "in_progress" is built from the
 * achieved dot/symbol shapes and recolored to the yellow treatment.
 */
const STATUS_TO_SHAPE: Record<MilestoneStatus, { dot: string; symbol: string | null }> = {
  achieved: { dot: "Milestone achieved Dot", symbol: "Milestone achieved Symbol" },
  achieved_ahead: { dot: "Milestone achieved Dot", symbol: "Milestone achieved Symbol" },
  in_progress: { dot: "Milestone achieved Dot", symbol: "Milestone achieved Symbol" },
  gap: { dot: "Milestone gap Dot", symbol: "Milestone gap Symbol" },
  upcoming: { dot: "Milestone upcoming Dot", symbol: null },
};

interface RailShape {
  el: XmlElement;
  status: MilestoneStatus;
  kind: "dot" | "symbol";
  rowY: number;
  colX: number;
  used: boolean;
}

const DOT_ROW_YS = Object.values(FACILITY_RAIL_DOT_YS);

/**
 * Parse a rail shape name into (status, kind). "ahead" shapes are excluded
 * from the pool entirely — they are hidden explicitly by the renderer.
 */
function parseStatusShapeName(
  name: string
): { status: MilestoneStatus; kind: "dot" | "symbol" } | null {
  const m = /^Milestone (achieved|ahead|gap|upcoming) (Dot|Symbol)$/.exec(name);
  if (!m) return null;
  if (m[1] === "ahead") return null;
  const status: MilestoneStatus =
    m[1] === "achieved" ? "achieved" : m[1] === "gap" ? "gap" : "upcoming";
  return { status, kind: m[2] === "Dot" ? "dot" : "symbol" };
}

function nearestColumnX(x: number): number {
  let best: number = RAIL_MILESTONE_XS[0];
  let bestDist = Infinity;
  for (const colX of RAIL_MILESTONE_XS) {
    const dist = Math.abs(colX - x);
    if (dist < bestDist) {
      bestDist = dist;
      best = colX;
    }
  }
  return best;
}

/**
 * Collect every milestone status shape that sits on one of the four facility
 * rails. Legend shapes (separate bottom row) and "ahead" shapes are excluded
 * by row/name filters.
 */
function collectRailShapes(doc: XmlDocument): RailShape[] {
  const pool: RailShape[] = [];
  const shapes = doc.getElementsByTagNameNS(NS.p, "sp");
  for (let i = 0; i < shapes.length; i++) {
    const el = shapes[i] as XmlElement;
    const parsed = parseStatusShapeName(getShapeName(el));
    if (!parsed) continue;
    const off = getShapeOff(el);
    const dotY = parsed.kind === "dot" ? off.y : off.y - SYMBOL_DY;
    if (!DOT_ROW_YS.includes(dotY)) continue;
    pool.push({
      el,
      status: parsed.status,
      kind: parsed.kind,
      rowY: dotY,
      colX: nearestColumnX(off.x),
      used: false,
    });
  }
  return pool;
}

function takeShape(
  doc: XmlDocument,
  pool: RailShape[],
  status: MilestoneStatus,
  kind: "dot" | "symbol",
  colX: number,
  rowY: number,
  cloneCounter: { n: number }
): RailShape | null {
  // 1) Reuse the shape already sitting at this exact column in this row.
  let found = pool.find(
    (s) => !s.used && s.status === status && s.kind === kind && s.colX === colX && s.rowY === rowY
  );
  // 2) Reuse any other unused shape of the same status (same row first).
  found =
    found ||
    pool.find((s) => !s.used && s.status === status && s.kind === kind && s.rowY === rowY) ||
    pool.find((s) => !s.used && s.status === status && s.kind === kind);
  if (found) return found;

  // 3) The status pool is exhausted for this kind: clone the archetype.
  const archetype = pool.find((s) => s.status === status && s.kind === kind);
  if (!archetype) return null;
  const kindLabel = kind === "dot" ? "Dot" : "Symbol";
  const clone = cloneShape(doc, archetype.el, `Milestone ${status} ${kindLabel} Clone ${++cloneCounter.n}`);
  const shape: RailShape = { el: clone, status, kind, rowY, colX, used: false };
  pool.push(shape);
  return shape;
}

/**
 * Milestone statuses are canonical, data-driven values produced by the
 * governance adapter (automatic derivation with the optional manual
 * ready_status override). The rail renderer only consumes them — no
 * facility-specific hard-coding lives here.
 */
function milestoneStatusesFor(facility: FacilityData): MilestoneStatus[] {
  return MILESTONE_CODES.map((code) => {
    const m = facility.milestones.find((mm) => mm.code === code);
    return m ? m.status : "upcoming";
  });
}

/**
 * Completely remove every residual "ahead" visual shape (rail markers and the
 * legend dot/symbol/strip) so no "Achieved ahead of plan" shape or text remains
 * anywhere in the generated slide.
 */
function removeAheadVisualState(doc: XmlDocument): void {
  for (const name of ["Milestone ahead Dot", "Milestone ahead Symbol", "Legend ahead"]) {
    for (const shape of findShapesByName(doc, name)) {
      shape.parentNode?.removeChild(shape);
    }
  }
}

/** Find a shape by name at a specific row y (legend row). */
function legendShape(doc: XmlDocument, name: string, targetY: number): XmlElement | undefined {
  return findShapesByName(doc, name).find((s) => getShapeOff(s).y === targetY);
}

/**
 * Update the Slide 1 legend to the approved four states in lifecycle order:
 *
 *   Achieved | In progress | Planned by now — still open | Upcoming milestone
 *
 * The "Planned by now" entry moves into the slot freed by the removed
 * "Achieved ahead of plan" entry; the new "In progress" entry is built from
 * the achieved legend visuals recolored to the yellow treatment (amber dot,
 * navy ellipsis) and takes the vacated "gap" slot.
 */
function renderInProgressLegend(doc: XmlDocument): void {
  const stripY = 5486400;
  const dotY = 5476875;

  const achievedStrip = legendShape(doc, "Legend achieved", stripY);
  const achievedDot = legendShape(doc, "Milestone achieved Dot", dotY);
  const achievedSymbol = legendShape(doc, "Milestone achieved Symbol", stripY);
  const gapStrip = legendShape(doc, "Legend gap", stripY);
  const gapDot = legendShape(doc, "Milestone gap Dot", dotY);
  const gapSymbol = legendShape(doc, "Milestone gap Symbol", stripY);
  if (!achievedStrip || !achievedDot || !achievedSymbol || !gapStrip || !gapDot || !gapSymbol) {
    return;
  }

  // 1) Move the "Planned by now — still open" entry into the freed "ahead" slot.
  setShapeOff(gapStrip, 6496050, stripY);
  setShapeOff(gapDot, 6153150, dotY);
  setShapeOff(gapSymbol, 6181725, stripY);

  // 2) Build the "In progress" entry from the achieved visuals, recolored to
  //    the yellow treatment, in the vacated "gap" slot.
  const inProgressStrip = cloneShape(doc, achievedStrip, "Legend in progress");
  setShapeText(inProgressStrip, "In progress");
  setShapeOff(inProgressStrip, 3543300, stripY);

  const inProgressDot = cloneShape(doc, achievedDot, "Milestone in_progress Dot");
  setShapeSolidFill(inProgressDot, IN_PROGRESS.dotFill);
  setShapeOff(inProgressDot, 3200400, dotY);

  const inProgressSymbol = cloneShape(doc, achievedSymbol, "Milestone in_progress Symbol");
  setShapeText(inProgressSymbol, IN_PROGRESS.glyph);
  setRunTextColor(inProgressSymbol, IN_PROGRESS.symbolFill);
  setShapeOff(inProgressSymbol, 3228975, stripY);

  for (const shape of [inProgressStrip, inProgressDot, inProgressSymbol]) {
    setShapeVisible(shape, true);
  }
}

/**
 * Render the data-driven milestone symbols for every facility rail on slide 1.
 * Shapes that are not needed for the current state (including all "ahead"
 * shapes) are hidden so no stale template symbol leaks into the deck.
 */
export function renderMilestoneSymbols(doc: XmlDocument, facilities: FacilityData[]): void {
  const pool = collectRailShapes(doc);
  const cloneCounter = { n: 0 };

  for (const facility of facilities) {
    const dotY = FACILITY_RAIL_DOT_YS[facility.slug];
    if (dotY === undefined) continue;
    const symbolY = dotY + SYMBOL_DY;
    const statuses = milestoneStatusesFor(facility);

    for (let col = 0; col < MILESTONE_CODES.length; col++) {
      const status = statuses[col];
      // Visual treatment: achieved_ahead and in_progress keep their milestone
      // truth but source their shapes from the achieved visuals. in_progress is
      // recolored to the yellow treatment after placement.
      const visualStatus: MilestoneStatus =
        status === "achieved_ahead" || status === "in_progress" ? "achieved" : status;
      const colX = RAIL_MILESTONE_XS[col];
      const need = STATUS_TO_SHAPE[visualStatus];

      const dot = takeShape(doc, pool, visualStatus, "dot", colX, dotY, cloneCounter);
      if (dot) {
        setShapeOff(dot.el, colX, dotY);
        setShapeVisible(dot.el, true);
        dot.used = true;
        dot.rowY = dotY;
        dot.colX = colX;
        // Paint above the facility rail: prevents the rail bar from striping
        // markers that were repositioned from an earlier z-order slot.
        appendShapeToEnd(dot.el);
        if (status === "in_progress") {
          setShapeSolidFill(dot.el, IN_PROGRESS.dotFill);
        }
      }

      if (need.symbol) {
        const symbol = takeShape(doc, pool, visualStatus, "symbol", colX, symbolY, cloneCounter);
        if (symbol) {
          setShapeOff(symbol.el, colX + SYMBOL_DX, symbolY);
          setShapeVisible(symbol.el, true);
          symbol.used = true;
          symbol.rowY = dotY;
          symbol.colX = colX;
          appendShapeToEnd(symbol.el);
          if (status === "in_progress") {
            setShapeText(symbol.el, IN_PROGRESS.glyph);
            setRunTextColor(symbol.el, IN_PROGRESS.symbolFill);
          }
        }
      }
    }
  }

  for (const shape of pool) {
    if (!shape.used) {
      setShapeVisible(shape.el, false);
    }
  }

  removeAheadVisualState(doc);
  renderInProgressLegend(doc);
}
