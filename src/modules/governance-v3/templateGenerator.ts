/**
 * Governance V3 Template-Based Presentation Generator
 *
 * This module is a thin compatibility wrapper around the shared Executive
 * Presentation Framework generator. The shared framework owns all PPTX
 * XML manipulation so it is not duplicated between presentation modules.
 *
 * @deprecated prefer importing from @/modules/executive-presentations/generators/governanceGenerator
 */

import { generateGovernanceV3Presentation as frameworkGenerateGovernanceV3Presentation } from "@/modules/executive-presentations/generators/governanceGenerator";
import type { GovernanceV3Presentation } from "./types";

export { generateGovernanceV3Presentation };

async function generateGovernanceV3Presentation(
  data: GovernanceV3Presentation
): Promise<Blob> {
  return frameworkGenerateGovernanceV3Presentation(data);
}
