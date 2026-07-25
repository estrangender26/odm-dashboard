/**
 * O&M Manual Governance Configuration
 * 
 * This module provides shared configuration for the Governance module,
 * used by both the Governance UI and the presentation generator.
 * 
 * All milestone definitions, weights, and deliverable requirements are defined here
 * to ensure consistency across the application.
 */

/**
 * Milestone configuration with weights
 * 
 * NOTE: These weights are currently defined as equal (weight: 1) because the
 * Governance module does not yet have a configured weighting system. This is an
 * explicit equal-weight fallback.
 * 
 * When milestone weights are configured in the future, update this array
 * with the canonical weights from the Governance configuration.
 */
export interface MilestoneConfig {
  id: string;
  label: string;
  /** 
   * Weight for progress calculations.
   * Currently using equal-weight fallback (all weights = 1).
   * @deprecated Will be replaced by configured weights when available
   */
  weight: number;
  /**
   * Whether this milestone has configurable deliverable requirements
   */
  hasDeliverables: boolean;
}

/**
 * Canonical milestone definitions for O&M Manual Governance
 * Source: Derived from GovernanceDashboard.tsx milestone structure
 * 
 * Weight Source: Equal-weight fallback (all milestones weighted equally)
 * Data Quality Flag: weightSource = "equal-fallback"
 */
export const GOVERNANCE_MILESTONES: readonly MilestoneConfig[] = [
  { id: "M1", label: "M1 - Technical Audit", weight: 1, hasDeliverables: true },
  { id: "M2", label: "M2 - Design Validation & Basis of Design", weight: 1, hasDeliverables: true },
  { id: "M3", label: "M3 - Construction Completion / O&M Transition", weight: 1, hasDeliverables: true },
  { id: "M4", label: "M4 - P1 Acceptance", weight: 1, hasDeliverables: true },
  { id: "M5", label: "M5 - P1 Defects Rectification", weight: 1, hasDeliverables: true },
  { id: "M6", label: "M6 - P2 Acceptance", weight: 1, hasDeliverables: true },
  { id: "M7", label: "M7 - P2 Defects Rectification", weight: 1, hasDeliverables: true },
  { id: "M8", label: "M8 - TOC Performance Certificate", weight: 1, hasDeliverables: true },
  { id: "M9", label: "M9 - Final TOC / Project Close-out", weight: 1, hasDeliverables: true },
] as const;

/**
 * Weight calculation metadata
 * Documents the weight source for transparency in reports
 */
export const WEIGHT_CALCULATION_META = {
  /** 
   * Current weight source
   * - "equal-fallback": All milestones weighted equally (current)
   * - "configured": Weights from Governance configuration (future)
   */
  source: "equal-fallback" as const,
  /** 
   * Equal weight value applied to all milestones
   */
  equalWeightValue: 1,
  /**
   * Total weight for percentage calculations
   */
  get totalWeight(): number {
    return GOVERNANCE_MILESTONES.reduce((sum, m) => sum + m.weight, 0);
  },
};

/**
 * Document category classification
 * These are document types, NOT workflow statuses
 */
export type DocumentCategory = 
  | "TOC-01" | "TOC-02" | "TOC-03" | "TOC-04" | "TOC-05"
  | "TOC-06" | "TOC-07" | "TOC-08" | "TOC-09" | "TOC-10"
  | "TOC-11" | "TOC-12" | "TOC-13" | "TOC-14"
  | "references"
  | "OTHER";

/**
 * Workflow status values
 * 
 * NOTE: The current governance_uploads table stores document categories (TOC-XX),
 * not workflow statuses. Workflow status tracking is not yet implemented in the
 * Governance schema.
 * 
 * When workflow status is available, it should be stored in a dedicated field
 * with these values:
 */
export type WorkflowStatus = 
  | "accepted" 
  | "pending_review" 
  | "returned" 
  | "rejected" 
  | "missing"
  | "overdue";

/**
 * Workflow status configuration
 * Documents the current state of workflow status tracking
 */
export const WORKFLOW_STATUS_META = {
  /**
   * Whether workflow status is tracked in the database
   * Currently false - status is not available in governance_uploads
   */
  isTracked: false,
  /**
   * Database field that would store workflow status
   * Currently not implemented
   */
  databaseField: null as string | null,
  /**
   * Fallback metric when workflow status is unavailable
   * Uses submitted-document count instead of approval status
   */
  fallbackMetric: "submitted-document-count" as const,
  /**
   * Values that would represent each status when implemented
   */
  values: {
    accepted: ["ACCEPTED", "approved", "verified"],
    pending_review: ["PENDING", "pending_review", "under_review"],
    returned: ["RETURNED", "returned", "revision_required"],
    rejected: ["REJECTED", "rejected", "denied"],
    missing: ["MISSING"],
    overdue: ["OVERDUE"],
  } as Record<WorkflowStatus, string[]>,
};

/**
 * Deliverable requirement configuration
 * 
 * NOTE: The Governance module currently does not have a requirement matrix
 * defining required vs optional deliverables per facility/milestone.
 * 
 * Current implementation uses milestone count as a proxy for required deliverables.
 * This is a simplification that assumes one deliverable per milestone.
 * 
 * When a requirement matrix is available, this should be replaced with:
 * - Required deliverables per facility
 * - Required deliverables per milestone
 * - Optional vs required distinction
 * - Document type/category requirements
 */
export const DELIVERABLE_REQUIREMENT_META = {
  /**
   * Whether a requirement matrix exists
   * Currently false - no requirement matrix available
   */
  hasRequirementMatrix: false,
  /**
   * Current proxy for required deliverables
   * Uses milestone count as simplification
   */
  requiredDeliverablesProxy: "milestone-count" as const,
  /**
   * Categories excluded from deliverable counts
   */
  excludedCategories: ["references"] as const,
};

/**
 * Color palette for facility assignment
 * Deterministic assignment based on facility index
 */
export const FACILITY_COLORS = [
  "#f97316", // Orange
  "#3b82f6", // Blue
  "#10b981", // Green
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#f59e0b", // Amber
  "#6366f1", // Indigo
] as const;

/**
 * Get color for facility by index
 */
export function getFacilityColor(index: number): string {
  return FACILITY_COLORS[index % FACILITY_COLORS.length];
}

/**
 * Get milestone by ID
 */
export function getMilestoneById(id: string): MilestoneConfig | undefined {
  return GOVERNANCE_MILESTONES.find(m => m.id === id);
}

/**
 * Get total milestone weight
 */
export function getTotalMilestoneWeight(): number {
  return WEIGHT_CALCULATION_META.totalWeight;
}
