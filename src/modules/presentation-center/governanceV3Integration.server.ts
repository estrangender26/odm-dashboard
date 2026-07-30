/**
 * Governance V3 Integration
 * Adapter to integrate Governance V3 generator with Presentation Center
 */

import type { DeckGenerationContext, GeneratedPresentation } from "./types";
import { generateGovernanceV3 } from "../governance-v3/index.server";
import { blobToDataUrl } from "./storage";

/**
 * Generate Governance V3 presentation for Presentation Center
 * This wraps the V3 generator to match the DeckGenerator interface
 */
export async function generateGovernanceV3Presentation(
  context: DeckGenerationContext
): Promise<GeneratedPresentation> {
  const reportingDate = new Date();
  
  const { blob } = await generateGovernanceV3({ reportingDate });
  
  const dataUrl = await blobToDataUrl(blob);
  const now = new Date();
  const name = "Onboarding-Status-" + now.toISOString().split("T")[0] + ".pptx";
  
  return {
    id: crypto.randomUUID(),
    name,
    type: "O\u0026M Manual Governance Onboarding Progress Deck",
    generatedDate: now.toISOString(),
    generatedBy: context.generatedBy,
    size: blob.size,
    dataUrl,
    generatorId: "om-manual-governance",
    generatorName: "O\u0026M Manual Governance Onboarding Progress Deck",
    filename: name,
    generatedAt: now.toISOString(),
  };
}
