import type { MilestoneCode } from './theme';

export type MilestoneStatus = 'achieved' | 'achieved_ahead' | 'gap' | 'upcoming';
export type PhaseType = 'PRE-PPP' | 'PPP' | 'POST-PPP';
export type FacilityPhaseStatus = 'PRE-PPP • GATE READY' | 'PRE-PPP • RECOVERY' | 'PPP ACTIVE' | 'POST-PPP • SUSTAINMENT';

export interface MilestoneData {
  code: MilestoneCode;
  name: string;
  phase: PhaseType;
  status: MilestoneStatus;
  plannedDate?: string;
  actualDate?: string;
}

export interface FacilityData {
  slug: string;
  name: string;
  shortName: string;
  color: string;
  pppStartDate: string;
  currentPhase: PhaseType;
  phaseStatus: FacilityPhaseStatus;
  milestones: MilestoneData[];
  executiveObservation: string;
}

export interface TocSubmission {
  tocId: string;
  submitted: boolean;
  documentCount: number;
}

export interface FacilityDocumentation {
  facilitySlug: string;
  facilityName: string;
  submissions: TocSubmission[];
  submittedCount: number;
  requiredCount: number;
  compliancePercent: number;
}

export interface PortfolioSummary {
  totalFacilities: number;
  facilitiesInPrePpp: number;
  facilitiesInPpp: number;
  facilitiesInPostPpp: number;
  gateReadyCount: number;
  recoveryCount: number;
  totalDocumentsSubmitted: number;
  totalDocumentsRequired: number;
  portfolioCompliancePercent: number;
}

export interface ExecutiveContent {
  headline: string;
  subtitle: string;
  nextGateAction: string;
  timelineSubtitle: string;
  gateImplication: string;
  documentationHeadline: string;
  documentationSubtitle: string;
  portfolioObservation: string;
  facilityObservations: Record<string, string>;
}

export interface GovernanceV3Presentation {
  generatedAt: string;
  reportingDate: string;
  facilities: FacilityData[];
  facilityDocumentation: FacilityDocumentation[];
  summary: PortfolioSummary;
  executive: ExecutiveContent;
}

export interface GenerationOptions {
  reportingDate?: Date;
}
