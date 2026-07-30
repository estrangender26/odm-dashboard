/**
 * Governance V3 Presentation Generator (Server-only)
 * Includes database fetching - do not import in browser code
 */

export * from "./index";
export { fetchPresentationData } from "./adapter.server";
export { generateExecutiveContent } from "./executive";
export { generateGovernanceV3Presentation } from "./generator";

import { fetchPresentationData } from "./adapter.server";
import { generateExecutiveContent } from "./executive";
import { generateGovernanceV3Presentation } from "./generator";
import type { GovernanceV3Presentation, GenerationOptions } from "./types";

/**
 * Generate complete Governance V3 presentation with production data
 * Server-only: imports from @db/connection
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
