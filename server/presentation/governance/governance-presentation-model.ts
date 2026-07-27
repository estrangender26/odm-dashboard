/**
 * Governance Presentation Model
 * 
 * Domain-specific model for O&M Manual Governance presentations.
 * Defines the complete data structure needed to render a Governance
 * executive presentation.
 */

import type { 
  BasePresentationModel, 
  BaseFacilityPresentationData,
  ProgressPoint,
  ProgressVisualizationType,
  DocumentStatus,
  ComplianceCell,
  PresentationDisclosure 
} from "../core/presentation-types";

/**
 * Complete Governance presentation model.
 * This is the single source of truth for all data displayed
 * in a Governance executive presentation.
 */
export interface GovernancePresentationModel extends BasePresentationModel {
  presentationType: "governance-onboarding";
  
  /** Executive summary data for Slide 1 */
  executiveSummary: GovernanceExecutiveSummary;
  
  /** Facility data for all slides */
  facilities: GovernanceFacilityPresentationData[];
  
  /** Deliverables compliance matrix for Slide 4 */
  complianceMatrix: GovernanceComplianceMatrix;
  
  /** Disclosures and data quality notices */
  disclosures: GovernancePresentationDisclosure[];
  
  /** Whether requirement matrix is available (Mode A vs Mode B) */
  hasRequirementMatrix: boolean;
  
  /** Mode indicator for display */
  mode: "Mode A" | "Mode B";
}

/**
 * Executive summary data for Slide 1.
 */
export interface GovernanceExecutiveSummary {
  /** Overall portfolio planned progress (0-100) */
  overallPlannedProgress: number | null;
  
  /** Overall portfolio actual progress (0-100) */
  overallActualProgress: number | null;
  
  /** Variance from planned (actual - planned) */
  overallVariance: number | null;
  
  /** Number of facilities in portfolio */
  facilityCount: number;
  
  /** Total applicable deliverables across all facilities */
  totalApplicableDeliverables: number;
  
  /** Overall compliance percentage (excluding Not Applicable) */
  overallCompliancePercent: number | null;
  
  /** Count of facilities by status */
  facilityStatusCounts: {
    "on-track": number;
    "attention": number;
    "delayed": number;
    "not-started": number;
    "complete": number;
  };
  
  /** Largest documentation gap (facility name + count) */
  largestGap: {
    facilityName: string;
    outstandingCount: number;
  } | null;
  
  /** Automatically generated management narrative */
  narrative: string;
}

/**
 * Facility-specific presentation data.
 * Used in Slides 2, 3, and 4.
 */
export interface GovernanceFacilityPresentationData extends BaseFacilityPresentationData {
  /** Planned progress for current period (0-100) */
  plannedProgress: number | null;
  
  /** Actual progress for current period (0-100) */
  actualProgress: number | null;
  
  /** Variance from planned */
  variance: number | null;
  
  /** Whether facility has a baseline schedule */
  hasBaselineSchedule: boolean;
  
  /** Count of approved deliverables */
  approvedDeliverables: number;
  
  /** Count of submitted (under review) deliverables */
  submittedDeliverables: number;
  
  /** Count of outstanding (required but not submitted) deliverables */
  outstandingDeliverables: number;
  
  /** Count of not applicable deliverables */
  notApplicableDeliverables: number;
  
  /** Total applicable (excludes Not Applicable) */
  totalApplicableDeliverables: number;
  
  /** Compliance percentage (approved / applicable) */
  compliancePercent: number | null;
  
  /** Progress visualization type */
  progressVisualizationType: ProgressVisualizationType;
  
  /** Progress data points (empty for snapshot) */
  progressSeries: ProgressPoint[];
  
  /** Deliverable status breakdown by TOC item */
  deliverableStatuses: GovernanceDeliverableStatus[];
}

/**
 * Individual deliverable/TOC item status.
 */
export interface GovernanceDeliverableStatus {
  /** TOC item identifier */
  tocId: string;
  
  /** Human-readable label */
  tocLabel: string;
  
  /** Presentation status */
  status: DocumentStatus;
  
  /** Number of files uploaded for this deliverable */
  fileCount: number;
}

/**
 * Compliance matrix for Slide 4.
 * Cross-tabulation of deliverables (rows) × facilities (columns).
 */
export interface GovernanceComplianceMatrix {
  /** Row definitions (deliverables) */
  rows: ComplianceMatrixRow[];
  
  /** Column definitions (facilities) */
  columns: ComplianceMatrixColumn[];
  
  /** Cell data: rowIndex → columnIndex → cell */
  cells: Map<string, ComplianceCell>;
  
  /** Totals by facility (column totals) */
  columnTotals: ComplianceMatrixTotal[];
  
  /** Grand total row */
  grandTotal: ComplianceMatrixTotal;
}

/**
 * Matrix row definition (deliverable).
 */
export interface ComplianceMatrixRow {
  /** Unique identifier (TOC ID) */
  rowId: string;
  
  /** Display label */
  label: string;
  
  /** Optional description */
  description?: string;
  
  /** Whether this deliverable is applicable to all facilities */
  universallyApplicable: boolean;
}

/**
 * Matrix column definition (facility).
 */
export interface ComplianceMatrixColumn {
  /** Facility identifier */
  facilityId: string;
  
  /** Display name */
  facilityName: string;
  
  /** Hex color for visual grouping */
  color: string;
}

/**
 * Column/facility totals.
 */
export interface ComplianceMatrixTotal {
  /** Facility identifier ("grand" for grand total) */
  facilityId: string;
  
  /** Total applicable deliverables */
  applicable: number;
  
  /** Approved count */
  approved: number;
  
  /** Submitted count */
  submitted: number;
  
  /** Outstanding count */
  outstanding: number;
  
  /** Not applicable count */
  notApplicable: number;
  
  /** Compliance percentage */
  compliancePercent: number | null;
}

/**
 * Governance-specific disclosures.
 */
export type GovernancePresentationDisclosure = PresentationDisclosure & {
  /** Governance-specific disclosure types */
  type: "data-quality" | "methodology" | "limitation" | "mode" | "proxy-metric";
  
  /** Applicable mode(s) */
  applicableModes?: ("Mode A" | "Mode B")[];
};

/**
 * Narrative section types.
 */
export type NarrativeSection = 
  | "executive-summary"
  | "on-track-facilities"
  | "behind-plan-facilities"
  | "not-started-facilities"
  | "documentation-gap"
  | "recommendations";

/**
 * Factory function to create empty model (for testing).
 */
export function createEmptyGovernanceModel(): GovernancePresentationModel {
  return {
    presentationId: `gov-${Date.now()}`,
    presentationType: "governance-onboarding",
    reportTitle: "O&M Manual Governance",
    reportSubtitle: "New Facilities Onboarding",
    reportingPeriod: "",
    generatedAt: new Date().toISOString(),
    generatorVersion: "2.0.0",
    hasRequirementMatrix: false,
    mode: "Mode B",
    
    executiveSummary: {
      overallPlannedProgress: null,
      overallActualProgress: null,
      overallVariance: null,
      facilityCount: 0,
      totalApplicableDeliverables: 0,
      overallCompliancePercent: null,
      facilityStatusCounts: {
        "on-track": 0,
        "attention": 0,
        "delayed": 0,
        "not-started": 0,
        "complete": 0,
      },
      largestGap: null,
      narrative: "",
    },
    
    facilities: [],
    
    complianceMatrix: {
      rows: [],
      columns: [],
      cells: new Map(),
      columnTotals: [],
      grandTotal: {
        facilityId: "grand",
        applicable: 0,
        approved: 0,
        submitted: 0,
        outstanding: 0,
        notApplicable: 0,
        compliancePercent: null,
      },
    },
    
    disclosures: [],
  };
}
