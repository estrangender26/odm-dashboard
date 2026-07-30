/**
 * Governance V3 Presentation Module
 * Browser-safe exports (no server-only code)
 */

export { GovernancePPTX } from "./pptxWrapper";
export { generateGovernanceV3Presentation } from "./generator";
export { generateExecutiveContent } from "./executive";

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

export {
  MANILA_WATER_COLORS,
  SLIDE_DIMENSIONS,
  FONTS,
  LAYOUT,
  PHASES,
  MILESTONES,
  GOVERNANCE_TOC_ITEMS,
  TIMELINE,
  MILESTONE_X_POSITIONS,
  getFacilityColor,
} from "./theme";
