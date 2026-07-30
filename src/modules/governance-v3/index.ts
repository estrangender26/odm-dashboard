/**
 * Governance V3 Presentation Generator
 * Entry point for the Manila Water branded 3-slide presentation
 */

export { MANILA_WATER_COLORS, SLIDE_DIMENSIONS, FONTS, MILESTONES, PHASES, GOVERNANCE_TOC_ITEMS } from "./theme";
export type { MilestoneCode } from "./theme";

export type {
  MilestoneStatus,
  PhaseType,
  FacilityPhaseStatus,
  MilestoneData,
  FacilityData,
  TocSubmission,
  FacilityDocumentation,
  PortfolioSummary,
  ExecutiveContent,
  GovernanceV3Presentation,
  GenerationOptions,
} from "./types";

export { fetchPresentationData } from "./adapter";
export { generateExecutiveContent } from "./executive";
export { generateGovernanceV3Presentation } from "./generator";

import { fetchPresentationData } from "./adapter";
import { generateExecutiveContent } from "./executive";
import { generateGovernanceV3Presentation } from "./generator";
import type { GovernanceV3Presentation, GenerationOptions } from "./types";

/**
 * Generate complete Governance V3 presentation with production data
 */
export async function generateGovernanceV3(
  options: GenerationOptions = {}
): Promise<{ blob: Blob; data: GovernanceV3Presentation }> {
  const reportingDate = options.reportingDate || new Date();
  
  // Fetch production data
  const { facilities, summary, facilityDocumentation } = await fetchPresentationData(reportingDate);
  
  // Generate executive content
  const executive = generateExecutiveContent(facilities, summary, facilityDocumentation, reportingDate);
  
  // Build presentation model
  const data: GovernanceV3Presentation = {
    generatedAt: new Date().toISOString(),
    reportingDate: reportingDate.toISOString().split("T")[0],
    facilities,
    facilityDocumentation,
    summary,
    executive,
  };
  
  // Generate presentation
  const blob = await generateGovernanceV3Presentation(data);
  
  return { blob, data };
}

export default generateGovernanceV3;
