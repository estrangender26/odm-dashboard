/**
 * Governance Presentation Validation
 * 
 * Comprehensive validation rules for Governance presentations.
 * Returns structured validation results with PASS/FAIL status.
 */

import type { GovernancePresentationModel } from "./governance-presentation-model";
import { validateExecutiveSummarySlide } from "../layouts/executive-summary-layout";
import { validateFacilityDashboardSlide } from "../layouts/facility-dashboard-layout";
import { validateProgressPanelSlide } from "../layouts/progress-panel-layout";
import { validateComplianceMatrixSlide } from "../layouts/compliance-matrix-layout";

/**
 * Validation result structure.
 */
export interface GovernanceValidationResult {
  /** Overall validity */
  valid: boolean;
  
  /** Per-slide validation results */
  slides: {
    slide1: { valid: boolean; errors: string[] };
    slide2: { valid: boolean; errors: string[] };
    slide3: { valid: boolean; errors: string[] };
    slide4: { valid: boolean; errors: string[] };
  };
  
  /** Aggregated errors */
  errors: string[];
  
  /** Non-fatal warnings */
  warnings: string[];
  
  /** Summary statistics */
  stats: {
    facilityCount: number;
    hasRequirementMatrix: boolean;
    mode: "Mode A" | "Mode B";
  };
}

/**
 * Validates a complete Governance presentation.
 * 
 * @param model - The presentation model to validate
 * @returns Validation result
 */
export function validateGovernancePresentation(
  model: GovernancePresentationModel
): GovernanceValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Validate each slide
  const slide1Validation = validateExecutiveSummarySlide(model);
  const slide2Validation = validateFacilityDashboardSlide(model);
  const slide3Validation = validateProgressPanelSlide(model);
  const slide4Validation = validateComplianceMatrixSlide(model);
  
  // Collect errors
  errors.push(...slide1Validation.errors.map(e => `Slide 1: ${e}`));
  errors.push(...slide2Validation.errors.map(e => `Slide 2: ${e}`));
  errors.push(...slide3Validation.errors.map(e => `Slide 3: ${e}`));
  errors.push(...slide4Validation.errors.map(e => `Slide 4: ${e}`));
  
  // Cross-slide validations
  
  // Check facility consistency across slides
  const slide2Ids = new Set(model.facilities.map(f => f.facilityId));
  const slide4Ids = new Set(model.complianceMatrix.columns.map(c => c.facilityId));
  
  for (const id of slide2Ids) {
    if (!slide4Ids.has(id)) {
      errors.push(`Facility ${id} in Slide 2 but not in Slide 4`);
    }
  }
  
  for (const id of slide4Ids) {
    if (!slide2Ids.has(id)) {
      errors.push(`Facility ${id} in Slide 4 but not in Slide 2`);
    }
  }
  
  // Check all required facilities present
  const requiredFacilities = ["aglipay", "htt", "eastbay", "kaysakat"];
  for (const required of requiredFacilities) {
    if (!slide2Ids.has(required)) {
      errors.push(`Missing required facility: ${required}`);
    }
  }
  
  // Mode consistency
  if (model.mode === "Mode A" && !model.hasRequirementMatrix) {
    errors.push("Mode A selected but hasRequirementMatrix is false");
  }
  
  if (model.mode === "Mode B" && model.hasRequirementMatrix) {
    warnings.push("Mode B selected but hasRequirementMatrix is true");
  }
  
  // July 2026 fixture validation
  const facilityValues: Record<string, { planned: number; actual: number }> = {
    "aglipay": { planned: 44, actual: 44 },
    "htt": { planned: 44, actual: 44 },
    "eastbay": { planned: 22, actual: 11 },
    "kaysakat": { planned: 33, actual: 0 },
  };
  
  for (const facility of model.facilities) {
    const expected = facilityValues[facility.facilityId];
    if (expected) {
      if (facility.plannedProgress !== expected.planned) {
        errors.push(
          `${facility.facilityName}: Expected planned ${expected.planned}%, ` +
          `got ${facility.plannedProgress}%`
        );
      }
      if (facility.actualProgress !== expected.actual) {
        errors.push(
          `${facility.facilityName}: Expected actual ${expected.actual}%, ` +
          `got ${facility.actualProgress}%`
        );
      }
    }
  }
  
  // Forbidden content check
  const forbiddenTerms = [
    "PM:CM Ratio",
    "MTTR",
    "Notifications",
    "Reliability KPI",
    "KPI Scorecard",
    "PM Documents KPI",
    "TARGET",
  ];
  
  const modelJson = JSON.stringify(model).toUpperCase();
  for (const term of forbiddenTerms) {
    if (modelJson.includes(term.toUpperCase())) {
      errors.push(`Forbidden content detected: ${term}`);
    }
  }
  
  // Document totals consistency
  for (const facility of model.facilities) {
    const sum = facility.approvedDeliverables + 
                facility.submittedDeliverables + 
                facility.outstandingDeliverables +
                facility.notApplicableDeliverables;
    
    if (sum !== facility.totalApplicableDeliverables + facility.notApplicableDeliverables) {
      errors.push(
        `${facility.facilityName}: Document counts don't add up. ` +
        `Sum: ${sum}, Total: ${facility.totalApplicableDeliverables}`
      );
    }
  }
  
  const valid = errors.length === 0;
  
  return {
    valid,
    slides: {
      slide1: slide1Validation,
      slide2: slide2Validation,
      slide3: slide3Validation,
      slide4: slide4Validation,
    },
    errors,
    warnings,
    stats: {
      facilityCount: model.facilities.length,
      hasRequirementMatrix: model.hasRequirementMatrix,
      mode: model.mode,
    },
  };
}

/**
 * Validates that presentation is deterministic.
 * Running twice with same input should produce same output.
 */
export function validateDeterminism(
  model: GovernancePresentationModel,
  generateFn: (m: GovernancePresentationModel) => unknown
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  try {
    const result1 = JSON.stringify(generateFn(model));
    const result2 = JSON.stringify(generateFn(model));
    
    if (result1 !== result2) {
      errors.push("Presentation generation is non-deterministic");
    }
  } catch (e: any) {
    errors.push(`Determinism check failed: ${e.message}`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
