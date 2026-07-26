/**
 * Governance Presentation Generator - Template-Based Architecture
 * 
 * This module provides corrected S-curve date selection and template-based
 * presentation generation for the Governance module.
 */

import type {
  FacilityPresentationSummary,
  SCurvePoint,
} from "./governanceTypes";

export const GOVERNANCE_SOURCE_LABEL = "O&M Manual Governance module";
export const GOVERNANCE_DECK_TITLE = "Governance Onboarding Progress";

/**
 * Find the S-curve point at or immediately before the reporting date.
 * This is the correct value to display - not the last point in the series.
 * 
 * CORRECTED: Previously used lastPoint which included future dates.
 * Now correctly filters to points at or before reporting date.
 */
export function getSCurveValueAtReportingDate(
  points: SCurvePoint[],
  reportingDate: Date,
  type: "planned" | "actual"
): number | null {
  // Filter points at or before reporting date
  const eligiblePoints = points
    .filter(p => new Date(p.date) <= reportingDate)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  if (eligiblePoints.length === 0) {
    return null;
  }
  
  // Return the latest point at or before reporting date
  const lastEligiblePoint = eligiblePoints[eligiblePoints.length - 1];
  return type === "planned" ? lastEligiblePoint.planned : lastEligiblePoint.actual;
}

/**
 * Calculate consolidated S-curve for portfolio view.
 * Weighted average of all facility S-curves at each date.
 */
export function calculateConsolidatedSCurve(
  facilities: FacilityPresentationSummary[]
): SCurvePoint[] {
  // Collect all unique dates from all facilities
  const allDates = new Set<string>();
  for (const f of facilities) {
    for (const p of f.sCurve) {
      allDates.add(p.date);
    }
  }
  
  const sortedDates = Array.from(allDates).sort();
  
  return sortedDates.map(date => {
    let totalPlanned = 0;
    let totalActual = 0;
    let plannedCount = 0;
    let actualCount = 0;
    
    for (const f of facilities) {
      const point = f.sCurve.find(p => p.date === date);
      if (point) {
        if (point.planned !== null) {
          totalPlanned += point.planned;
          plannedCount++;
        }
        if (point.actual !== null) {
          totalActual += point.actual;
          actualCount++;
        }
      }
    }
    
    return {
      date,
      planned: plannedCount > 0 ? Math.round(totalPlanned / plannedCount) : null,
      actual: actualCount > 0 ? Math.round(totalActual / actualCount) : null,
      forecast: null,
    };
  });
}
