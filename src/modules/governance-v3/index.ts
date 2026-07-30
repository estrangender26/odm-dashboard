/**
 * Governance V3 Presentation Generator
 * Browser-safe exports (no database imports)
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

export { generateExecutiveContent } from "./executive";
export { generateGovernanceV3Presentation } from "./generator";

// Note: generateGovernanceV3 (with DB fetch) is in index.server.ts
