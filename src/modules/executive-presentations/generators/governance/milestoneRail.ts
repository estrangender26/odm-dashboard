/**
 * Slide 1 milestone rail renderer.
 *
 * Makes the per-facility M1..M9 milestone status symbols fully data-driven
 * using ONLY the approved three visual states:
 *
 *   achieved (and achieved ahead of plan) → green dot + white ✓
 *   gap ("planned by now — still open")   → light dot + red outline + red !
 *   upcoming                              → light dot + gray outline, no icon
 *
 * The "achieved ahead of plan" state keeps its underlying milestone truth
 * (the status is never recalculated) but maps to the achieved visual
 * treatment; the cyan "ahead" visual state and its legend entry are removed.
 *
 * Rendering guarantees:
 * - every marker is placed at its canonical M1..M9 column x, centered
 *   vertically on the facility rail;
 * - markers are re-appended to the end of the shape tree so they always paint
 *   ABOVE the rail (the rail never paints a stripe across a marker);
 * - unused template shapes (including all "ahead" shapes and the removed
 *   legend entry) are hidden so no stale or duplicate symbol leaks through.
 */

import { NS, getShapeName } from "../../framework";
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
  setShapeOff,
  setShapeVisible,
} from "./slideLayout";

const MILESTONE_CODES = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"] as const;

/**
 * Approved three-state visual mapping. "achieved_ahead" keeps its milestone
 * truth but renders with the achieved visual (green dot + white check).
 */
const STATUS_TO_SHAPE: Record<MilestoneStatus, { dot: string; symbol: string | null }> = {
  achieved: { dot: "Milestone achieved Dot", symbol: "Milestone achieved Symbol" },
  achieved_ahead: { dot: "Milestone achieved Dot", symbol: "Milestone achieved Symbol" },
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

function milestoneStatusesFor(facility: FacilityData): MilestoneStatus[] {
  return MILESTONE_CODES.map((code) => {
    const m = facility.milestones.find((mm) => mm.code === code);
    return m ? m.status : "upcoming";
  });
}

/**
 * Hide every "ahead" visual shape (rails and legend) plus the removed
 * "Achieved ahead of plan" legend entry.
 */
function hideAheadVisualState(doc: XmlDocument): void {
  for (const name of ["Milestone ahead Dot", "Milestone ahead Symbol", "Legend ahead"]) {
    for (const shape of findShapesByName(doc, name)) {
      setShapeVisible(shape, false);
    }
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
      // Three-state visual treatment: achieved_ahead keeps its milestone truth
      // but renders with the achieved visuals (green dot + white check).
      const visualStatus: MilestoneStatus = status === "achieved_ahead" ? "achieved" : status;
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
        }
      }
    }
  }

  for (const shape of pool) {
    if (!shape.used) {
      setShapeVisible(shape.el, false);
    }
  }

  hideAheadVisualState(doc);
}
