/**
 * Progress Panel Layout
 * 
 * Slide 3: Facility progress visualizations (S-curve or snapshot).
 */

import type { 
  GovernancePresentationModel,
  GovernanceFacilityPresentationData
} from "../governance/governance-presentation-model";

/**
 * Renders Slide 3: Progress Panel.
 * 
 * @param model - The complete presentation model
 * @returns Slide content structure
 */
export function renderProgressPanelSlide(
  model: GovernancePresentationModel
): {
  slideNumber: number;
  title: string;
  subtitle: string;
  content: {
    visualizationType: "s-curve" | "snapshot";
    disclosure: string | null;
    facilities: {
      id: string;
      name: string;
      color: string;
      hasHistoricalData: boolean;
      currentValues: {
        planned: number | null;
        actual: number | null;
      };
      series: {
        period: string;
        planned: number | null;
        actual: number | null;
      }[];
    }[];
  };
} {
  // Determine if we have true S-curve data or just snapshots
  const hasHistoricalData = model.facilities.some(
    f => f.progressSeries.length > 2
  );
  
  const visualizationType = hasHistoricalData ? "s-curve" : "snapshot";
  
  const disclosure = hasHistoricalData
    ? null
    : "Progress shown as snapshot values. Historical S-curve data requires additional milestone tracking.";
  
  return {
    slideNumber: 3,
    title: "Facility Progress",
    subtitle: visualizationType === "s-curve" 
      ? "S-Curve Progression" 
      : "Progress Snapshot",
    content: {
      visualizationType,
      disclosure,
      facilities: model.facilities.map(f => ({
        id: f.facilityId,
        name: f.facilityName,
        color: f.color,
        hasHistoricalData: f.progressSeries.length > 2,
        currentValues: {
          planned: f.plannedProgress,
          actual: f.actualProgress,
        },
        series: f.progressSeries.map(p => ({
          period: p.period,
          planned: p.planned,
          actual: p.actual,
        })),
      })),
    },
  };
}

/**
 * Validates progress panel slide requirements.
 * 
 * @param model - The presentation model
 * @returns Validation result
 */
export function validateProgressPanelSlide(
  model: GovernancePresentationModel
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Must have all 4 facilities
  if (model.facilities.length !== 4) {
    errors.push(`Expected 4 facilities, got ${model.facilities.length}`);
  }
  
  for (const facility of model.facilities) {
    // Check current values
    if (facility.plannedProgress === null) {
      errors.push(`${facility.facilityName}: Missing planned progress`);
    }
    
    if (facility.actualProgress === null) {
      errors.push(`${facility.facilityName}: Missing actual progress`);
    }
    
    // Validate progress ranges
    if (facility.plannedProgress !== null && 
        (facility.plannedProgress < 0 || facility.plannedProgress > 100)) {
      errors.push(`${facility.facilityName}: Planned progress out of range`);
    }
    
    if (facility.actualProgress !== null && 
        (facility.actualProgress < 0 || facility.actualProgress > 100)) {
      errors.push(`${facility.facilityName}: Actual progress out of range`);
    }
    
    // July 2026 fixture validation
    const expectedValues = getExpectedValues(facility.facilityId);
    if (expectedValues) {
      const actual = facility.actualProgress ?? 0;
      const planned = facility.plannedProgress ?? 0;
      
      if (actual !== expectedValues.actual) {
        errors.push(
          `${facility.facilityName}: Expected actual ${expectedValues.actual}%, got ${actual}%`
        );
      }
      
      if (planned !== expectedValues.planned) {
        errors.push(
          `${facility.facilityName}: Expected planned ${expectedValues.planned}%, got ${planned}%`
        );
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Gets expected values for July 2026 fixture validation.
 */
function getExpectedValues(facilityId: string): { planned: number; actual: number } | null {
  const expectations: Record<string, { planned: number; actual: number }> = {
    "aglipay": { planned: 44, actual: 44 },
    "htt": { planned: 44, actual: 44 },
    "eastbay": { planned: 22, actual: 11 },
    "kaysakat": { planned: 33, actual: 0 },
  };
  
  return expectations[facilityId] ?? null;
}
