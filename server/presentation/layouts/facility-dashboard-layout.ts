/**
 * Facility Dashboard Layout
 * 
 * Slide 2: Four facility cards showing progress and document status.
 */

import type { 
  GovernancePresentationModel,
  GovernanceFacilityPresentationData 
} from "../governance/governance-presentation-model";

/**
 * Renders Slide 2: Facility Dashboard.
 * 
 * @param model - The complete presentation model
 * @returns Slide content structure
 */
export function renderFacilityDashboardSlide(
  model: GovernancePresentationModel
): {
  slideNumber: number;
  title: string;
  content: {
    facilities: {
      id: string;
      name: string;
      color: string;
      status: string;
      progress: {
        planned: number | null;
        actual: number | null;
        variance: number | null;
      };
      documents: {
        approved: number;
        submitted: number;
        outstanding: number;
        total: number;
      };
      compliancePercent: number | null;
    }[];
  };
} {
  return {
    slideNumber: 2,
    title: "Facility Progress Dashboard",
    content: {
      facilities: model.facilities.map(f => ({
        id: f.facilityId,
        name: f.facilityName,
        color: f.color,
        status: f.status,
        progress: {
          planned: f.plannedProgress,
          actual: f.actualProgress,
          variance: f.variance,
        },
        documents: {
          approved: f.approvedDeliverables,
          submitted: f.submittedDeliverables,
          outstanding: f.outstandingDeliverables,
          total: f.totalApplicableDeliverables,
        },
        compliancePercent: f.compliancePercent,
      })),
    },
  };
}

/**
 * Validates facility dashboard slide requirements.
 * 
 * @param model - The presentation model
 * @returns Validation result
 */
export function validateFacilityDashboardSlide(
  model: GovernancePresentationModel
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Must have exactly 4 facilities
  if (model.facilities.length !== 4) {
    errors.push(`Expected 4 facilities, got ${model.facilities.length}`);
  }
  
  // Each facility must have required fields
  for (const facility of model.facilities) {
    if (!facility.facilityId) {
      errors.push(`Facility missing ID`);
    }
    
    if (!facility.facilityName) {
      errors.push(`Facility ${facility.facilityId} missing name`);
    }
    
    if (!facility.color) {
      errors.push(`Facility ${facility.facilityId} missing color`);
    }
    
    if (facility.actualProgress === null) {
      errors.push(`Facility ${facility.facilityId} missing actual progress`);
    }
  }
  
  // Check for duplicate facilities
  const ids = model.facilities.map(f => f.facilityId);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    errors.push("Duplicate facility IDs detected");
  }
  
  // Check all required facilities present
  const requiredFacilities = ["aglipay", "htt", "eastbay", "kaysakat"];
  for (const required of requiredFacilities) {
    if (!ids.includes(required)) {
      errors.push(`Missing required facility: ${required}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
