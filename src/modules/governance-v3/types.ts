/**
 * Governance V3 Presentation Model
 * Canonical data structures for the 3-slide presentation
 */

import type { MilestoneCode } from "./theme";

// Milestone Status Types
export type MilestoneStatus = 
  | "achieved"      // ✓ navy - completed as planned
  | "achieved_ahead" // ✓ green - completed before planned
  | "gap"           // ! red - planned by now, still open
  | "upcoming";     // ○ gray - future milestone

// Phase Types
export type PhaseType = "PRE-PPP" | "PPP" | "POST-PPP";

// Facility Phase Status - exact from reference
export type FacilityPhaseStatus = 
  | "PRE-PPP • GATE READY"
  | "PRE-PPP • RECOVERY"
  | "PRE-PPP • IN PROGRESS"
  | "PPP ACTIVE"
  | "POST-PPP • SUSTAINMENT";

// Milestone Data
export interface MilestoneData {
  code: MilestoneCode;
  name: string;
  phase: PhaseType;
  status: MilestoneStatus;
  plannedDate?: string;  // ISO date YYYY-MM-DD
  actualDate?: string;   // ISO date YYYY-MM-DD
}

// Facility Data
export interface FacilityData {
  slug: string;
  name: string;
  shortName: string;
  color: string;
  pppStartDate: string;  // ISO date YYYY-MM-DD
  currentPhase: PhaseType;
  phaseStatus: FacilityPhaseStatus;
  milestones: MilestoneData[];
  executiveObservation: string;
}

// TOC Submission Status
export interface TocSubmission {
  tocId: string;
  submitted: boolean;
  documentCount: number;
}

// Facility Documentation Status
export interface FacilityDocumentation {
  facilitySlug: string;
  facilityName: string;
  submissions: TocSubmission[];
  submittedCount: number;
  requiredCount: number;
  compliancePercent: number;
}

// Portfolio Summary
export interface PortfolioSummary {
  totalFacilities: number;
  facilitiesInPrePpp: number;
  facilitiesInPpp: number;
  facilitiesInPostPpp: number;
  gateReadyCount: number;
  recoveryCount: number;
  // Documentation
  totalDocumentsSubmitted: number;
  totalDocumentsRequired: number;
  portfolioCompliancePercent: number;
}

// Executive Content - auto-generated
export interface ExecutiveContent {
  // Slide 1
  headline: string;
  subtitle: string;
  nextGateAction: string;
  
  // Slide 2
  timelineSubtitle: string;
  gateImplication: string;
  
  // Slide 3
  documentationHeadline: string;
  documentationSubtitle: string;
  portfolioObservation: string;
  facilityObservations: Record<string, string>;
}

// Complete Presentation Model
export interface GovernanceV3Presentation {
  generatedAt: string;
  reportingDate: string;
  facilities: FacilityData[];
  facilityDocumentation: FacilityDocumentation[];
  summary: PortfolioSummary;
  executive: ExecutiveContent;
}

// Generation Options
export interface GenerationOptions {
  reportingDate?: Date;
}
