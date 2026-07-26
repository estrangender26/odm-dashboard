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

/**
 * Determine if a milestone is complete as of a specific reporting date.
 * 
 * This function is the single source of truth for milestone completion calculations
 * across both the Facility Dashboard and the Presentation Center.
 * 
 * Business Rules:
 * - A milestone is complete if it has a non-null completion date
 * - For "as-of" date calculations, the completion date must be BEFORE the cutoff
 * - The cutoff is inclusive: completion on the reporting date IS counted as complete
 *   for historical presentations (to match end-of-day semantics)
 * 
 * Usage:
 * - Facility Dashboard (current view): isMilestoneCompleteAsOf(compDate, null) - includes all completed
 * - Presentation Center (historical): isMilestoneCompleteAsOf(compDate, reportingDate) - as-of date
 * 
 * @param compDate - The milestone completion date (YYYY-MM-DD format or ISO string)
 * @param reportingDate - The reporting date to check against (YYYY-MM-DD format), or null for current view
 * @returns boolean indicating whether the milestone is complete as of the reporting date
 */
export function isMilestoneCompleteAsOf(
  compDate: string | null | undefined,
  reportingDate: string | null | undefined,
): boolean {
  if (!compDate) return false;
  
  // Current view: any completion date counts
  if (!reportingDate) return true;
  
  // Parse dates at UTC midnight for consistent comparison
  const completion = new Date(`${compDate.split('T')[0]}T00:00:00Z`);
  const cutoff = new Date(`${reportingDate}T00:00:00Z`);
  
  // Completion ON the reporting date IS counted as complete (inclusive)
  // Completion must be <= cutoff (not strictly before)
  return completion.getTime() <= cutoff.getTime();
}

/**
 * Calculate facility progress as of a specific reporting date.
 * 
 * @param milestoneCompDates - Map of milestone ID to completion date (or null if not complete)
 * @param reportingDate - The reporting date for the calculation, or null for current progress
 * @returns Object with completed count, total count, and percentage
 */

/**
 * Determine if a milestone is complete based on persisted database state.
 * 
 * This function is the business rule for current persisted completion.
 * A milestone is complete when its completion date is populated in the database.
 * 
 * This is used by the Presentation Center to match the Facility Dashboard's
 * saved progress values. Unlike isMilestoneCompleteAsOf(), this does NOT apply
 * a reporting date cutoff - it simply checks if the milestone has been marked
 * complete in the persisted database state.
 * 
 * @param compDate - The persisted completion date from the database
 * @returns boolean indicating whether the milestone is complete
 */

/**
 * Calculate effective progress for a single milestone.
 * 
 * This implements the canonical Dashboard rule:
 * - customPct takes precedence if set (even without compDate)
 * - if no customPct but compDate exists, progress is 100%
 * - if neither, progress is 0%
 * 
 * Formula: customPct ?? (compDate ? 100 : 0)
 * 
 * @param customPct - Custom progress percentage (0-100) or null/undefined
 * @param compDate - Completion date string or null/undefined
 * @returns Effective progress percentage (0-100)
 */
export function calculateMilestoneEffectiveProgress(
  customPct: number | null | undefined,
  compDate: string | null | undefined,
): number {
  return customPct ?? (compDate ? 100 : 0);
}

/**
 * Calculate aggregate facility progress from milestone effective progress values.
 * 
 * Uses equal weighting (current fallback). Each milestone contributes
 * its effectiveProgress / totalMilestones to the aggregate.
 * 
 * @param milestoneProgress - Map of milestone ID to effective progress (0-100)
 * @returns Aggregate progress percentage (0-100)
 */
export function calculateAggregateProgress(
  milestoneProgress: Record<string, number>,
): number {
  const total = GOVERNANCE_MILESTONES.length;
  if (total === 0) return 0;
  
  const sum = GOVERNANCE_MILESTONES.reduce(
    (acc, m) => acc + (milestoneProgress[m.id] ?? 0),
    0,
  );
  
  return Math.round(sum / total);
}

export function isPersistedMilestoneComplete(
  compDate: string | null | undefined,
): boolean {
  return !!compDate;
}

/**
 * Calculate facility progress based on current persisted database state.
 * 
 * This function mirrors how the Facility Dashboard shows saved progress.
 * It counts milestones as complete if they have a persisted completion date,
 * regardless of any reporting date. This ensures the Presentation Center
 * matches the Dashboard's saved values.
 *
 * @param milestoneCompDates - Map of milestone ID to persisted completion date
 * @returns Object with completed count, total count, and percentage
 */
export function calculateFacilityCurrentProgress(
  milestoneCompDates: Record<string, string | null | undefined>,
): { completed: number; total: number; percentage: number } {
  const total = GOVERNANCE_MILESTONES.length;
  let completed = 0;
  
  for (const milestone of GOVERNANCE_MILESTONES) {
    const compDate = milestoneCompDates[milestone.id];
    if (isPersistedMilestoneComplete(compDate)) {
      completed++;
    }
  }
  
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  
  return { completed, total, percentage };
}

export function calculateFacilityProgressAsOf(
  milestoneCompDates: Record<string, string | null | undefined>,
  reportingDate: string | null | undefined,
): { completed: number; total: number; percentage: number } {
  const total = GOVERNANCE_MILESTONES.length;
  let completed = 0;
  
  for (const milestone of GOVERNANCE_MILESTONES) {
    const compDate = milestoneCompDates[milestone.id];
    if (isMilestoneCompleteAsOf(compDate, reportingDate)) {
      completed++;
    }
  }
  
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  
  return { completed, total, percentage };
}

/**
 * Format a progress display string.
 * 
 * @param completed - Number of completed milestones
 * @param total - Total number of milestones
 * @returns Formatted string like "4/9" or "0/9"
 */
export function formatProgressDisplay(completed: number, total: number): string {
  return `${completed}/${total}`;
}

/**
 * Validation helper for reporting dates.
 * Rejects calendar-invalid dates like 2026-02-30.
 * 
 * @param dateStr - Date string to validate (YYYY-MM-DD format)
 * @returns boolean indicating whether the date is valid
 */
export function isValidReportingDate(dateStr: string): boolean {
  // Check format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  
  // Parse components
  const [year, month, day] = dateStr.split('-').map(Number);
  
  // Check ranges
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  
  // Create date and verify it doesn't shift (rejects invalid dates like Feb 30)
  const date = new Date(`${dateStr}T00:00:00Z`);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}
