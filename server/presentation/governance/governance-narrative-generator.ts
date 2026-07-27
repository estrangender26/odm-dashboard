/**
 * Governance Narrative Generator
 * 
 * Generates deterministic, data-driven executive narratives
 * based solely on the presentation model. No external AI services.
 * 
 * The narrative identifies:
 * - Facilities on track
 * - Facilities behind plan
 * - Facilities not started
 * - Largest documentation gap
 * 
 * It deliberately avoids unsupported recommendations.
 */

import type { 
  GovernancePresentationModel, 
  GovernanceFacilityPresentationData 
} from "./governance-presentation-model";

/**
 * Generates executive narrative for Slide 1.
 * 
 * @param model - The complete presentation model
 * @returns Deterministic narrative text
 */
export function generateExecutiveNarrative(
  model: GovernancePresentationModel
): string {
  const sections: string[] = [];
  
  // Section 1: Overview
  sections.push(generateOverviewSection(model));
  
  // Section 2: On-track facilities
  const onTrackSection = generateOnTrackSection(model);
  if (onTrackSection) sections.push(onTrackSection);
  
  // Section 3: Facilities behind plan
  const behindSection = generateBehindPlanSection(model);
  if (behindSection) sections.push(behindSection);
  
  // Section 4: Not started
  const notStartedSection = generateNotStartedSection(model);
  if (notStartedSection) sections.push(notStartedSection);
  
  // Section 5: Documentation gap (largest)
  const gapSection = generateGapSection(model);
  if (gapSection) sections.push(gapSection);
  
  // Section 6: Mode disclosure
  sections.push(generateModeDisclosure(model));
  
  return sections.filter(Boolean).join(" ");
}

/**
 * Generates overview sentence.
 */
function generateOverviewSection(model: GovernancePresentationModel): string {
  const { facilityCount, overallActualProgress, overallPlannedProgress } = model.executiveSummary;
  
  const actual = overallActualProgress ?? 0;
  const planned = overallPlannedProgress ?? 0;
  const variance = actual - planned;
  
  let statusPhrase: string;
  if (variance >= -5) {
    statusPhrase = "is on track";
  } else if (variance >= -15) {
    statusPhrase = "requires attention";
  } else {
    statusPhrase = "is significantly behind plan";
  }
  
  return `Portfolio of ${facilityCount} facilities ${statusPhrase} with overall progress at ${actual}%.`;
}

/**
 * Generates on-track facilities sentence.
 */
function generateOnTrackSection(model: GovernancePresentationModel): string | null {
  const onTrackFacilities = model.facilities.filter(
    f => f.status === "on-track" || f.status === "complete"
  );
  
  if (onTrackFacilities.length === 0) return null;
  
  const names = onTrackFacilities.map(f => f.facilityName).join(", ");
  
  if (onTrackFacilities.length === 1) {
    return `${names} is on track.`;
  }
  
  return `${names} are on track.`;
}

/**
 * Generates behind-plan facilities sentence.
 */
function generateBehindPlanSection(model: GovernancePresentationModel): string | null {
  const behindFacilities = model.facilities.filter(
    f => f.status === "attention" || f.status === "delayed"
  );
  
  if (behindFacilities.length === 0) return null;
  
  const names = behindFacilities.map(f => f.facilityName);
  
  if (names.length === 1) {
    return `${names[0]} is behind plan and requires attention.`;
  }
  
  const lastName = names.pop();
  return `${names.join(", ")} and ${lastName} are behind plan and require attention.`;
}

/**
 * Generates not-started facilities sentence.
 */
function generateNotStartedSection(model: GovernancePresentationModel): string | null {
  const notStartedFacilities = model.facilities.filter(f => f.status === "not-started");
  
  if (notStartedFacilities.length === 0) return null;
  
  const names = notStartedFacilities.map(f => f.facilityName);
  
  if (names.length === 1) {
    return `${names[0]} has not yet started documentation submission.`;
  }
  
  const lastName = names.pop();
  return `${names.join(", ")} and ${lastName} have not yet started documentation submission.`;
}

/**
 * Generates largest documentation gap sentence.
 */
function generateGapSection(model: GovernancePresentationModel): string | null {
  const { largestGap } = model.executiveSummary;
  
  if (!largestGap || largestGap.outstandingCount === 0) return null;
  
  return `The largest documentation gap is at ${largestGap.facilityName} with ${largestGap.outstandingCount} outstanding deliverables.`;
}

/**
 * Generates mode disclosure sentence.
 */
function generateModeDisclosure(model: GovernancePresentationModel): string {
  if (model.mode === "Mode B") {
    return "Compliance metrics use proxy calculations (Mode B) pending implementation of the formal Requirement Matrix.";
  }
  
  return "Compliance metrics calculated using formal Requirement Matrix (Mode A).";
}

/**
 * Calculates facility with largest documentation gap.
 * 
 * @param facilities - All facility presentation data
 * @returns Facility with most outstanding deliverables
 */
export function calculateLargestGap(
  facilities: GovernanceFacilityPresentationData[]
): { facilityName: string; outstandingCount: number } | null {
  if (facilities.length === 0) return null;
  
  const sorted = [...facilities].sort((a, b) => 
    b.outstandingDeliverables - a.outstandingDeliverables
  );
  
  const largest = sorted[0];
  
  if (largest.outstandingDeliverables === 0) return null;
  
  return {
    facilityName: largest.facilityName,
    outstandingCount: largest.outstandingDeliverables,
  };
}

/**
 * Counts facilities by status.
 * 
 * @param facilities - All facility presentation data
 * @returns Status counts
 */
export function countFacilitiesByStatus(
  facilities: GovernanceFacilityPresentationData[]
): {
  "on-track": number;
  "attention": number;
  "delayed": number;
  "not-started": number;
  "complete": number;
} {
  const counts = {
    "on-track": 0,
    "attention": 0,
    "delayed": 0,
    "not-started": 0,
    "complete": 0,
  };
  
  for (const facility of facilities) {
    if (facility.status in counts) {
      counts[facility.status]++;
    }
  }
  
  return counts;
}

/**
 * Validates that narrative is deterministic.
 * Same input model must produce same output.
 * 
 * @param model - Presentation model
 * @returns Whether narrative is valid
 */
export function validateNarrativeDeterminism(
  model: GovernancePresentationModel
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Generate twice and compare
  const narrative1 = generateExecutiveNarrative(model);
  const narrative2 = generateExecutiveNarrative(model);
  
  if (narrative1 !== narrative2) {
    errors.push("Narrative generation is non-deterministic");
  }
  
  // Check narrative contains expected sections
  if (!narrative1.includes(model.facilities.length.toString())) {
    errors.push("Narrative missing facility count");
  }
  
  // Check Mode B disclosure if applicable
  if (model.mode === "Mode B" && !narrative1.includes("Mode B")) {
    errors.push("Mode B disclosure missing");
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
