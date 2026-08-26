/**
 * Slide 1 milestone rail renderer.
 *
 * Makes the per-facility M1..M9 milestone status symbols fully data-driven.
 * The approved template ships one status shape per rail column; when the real
 * milestone state differs from the template's static state, shapes are
 * repositioned and, only when the status pool is exhausted, cloned so every
 * column always shows exactly the symbol its current status requires:
 *
 *   achieved        → green ✓ on a green dot
 *   achieved_ahead  → cyan ✓ on a cyan dot
 *   gap             → red ! on a light-red dot
 *   upcoming        → gray ○ (dot only, no symbol text)
 */

import { NS, getShapeName } from "../../framework";
import type { XmlDocument, XmlElement } from "../../framework";
import type { FacilityData, MilestoneStatus } from "../../../governance-v3/types";
import {
  FACILITY_RAIL_DOT_YS,
  RAIL_MILESTONE_XS,
  SYMBOL_DX,
  SYMBOL_DY,
  cloneShape,
  getShapeOff,
  setShapeOff,
  setShapeVisible,
} from "./slideLayout";

const MILESTONE_CODES = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"] as const;

const STATUS_TO_SHAPE: Record<MilestoneStatus, { dot: string; symbol: string | null }> = {
  achieved: { dot: "Milestone achieved Dot", symbol: "Milestone achieved Symbol" },
  achieved_ahead: { dot: "Milestone ahead Dot", symbol: "Milestone ahead Symbol" },
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

function parseStatusShapeName(
  name: string
): { status: MilestoneStatus; kind: "dot" | "symbol" } | null {
  const m = /^Milestone (achieved|ahead|gap|upcoming) (Dot|Symbol)$/.exec(name);
  if (!m) return null;
  const status: MilestoneStatus =
    m[1] === "achieved"
      ? "achieved"
      : m[1] === "ahead"
        ? "achieved_ahead"
        : m[1] === "gap"
          ? "gap"
          : "upcoming";
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
 * rails. Legend shapes (separate bottom row) are excluded by row filter.
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
  const label = status === "achieved_ahead" ? "ahead" : status;
  const kindLabel = kind === "dot" ? "Dot" : "Symbol";
  const clone = cloneShape(doc, archetype.el, `Milestone ${label} ${kindLabel} Clone ${++cloneCounter.n}`);
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
 * Render the data-driven milestone symbols for every facility rail on slide 1.
 * Shapes that are not needed for the current state are hidden so no stale
 * template symbol leaks into the generated deck.
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
      const colX = RAIL_MILESTONE_XS[col];
      const need = STATUS_TO_SHAPE[status];

      const dot = takeShape(doc, pool, status, "dot", colX, dotY, cloneCounter);
      if (dot) {
        setShapeOff(dot.el, colX, dotY);
        setShapeVisible(dot.el, true);
        dot.used = true;
        dot.rowY = dotY;
        dot.colX = colX;
      }

      if (need.symbol) {
        const symbol = takeShape(doc, pool, status, "symbol", colX, symbolY, cloneCounter);
        if (symbol) {
          setShapeOff(symbol.el, colX + SYMBOL_DX, symbolY);
          setShapeVisible(symbol.el, true);
          symbol.used = true;
          symbol.rowY = dotY;
          symbol.colX = colX;
        }
      }
    }
  }

  for (const shape of pool) {
    if (!shape.used) {
      setShapeVisible(shape.el, false);
    }
  }
}
