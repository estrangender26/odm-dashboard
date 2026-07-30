/**
 * Governance Status Mapper
 * 
 * Centralized mapping functions that convert Governance source data
 * to presentation statuses. All status interpretation happens here,
 * not spread across slide-rendering code.
 * 
 * Presentation Statuses:
 * - "approved"           : Fully approved and accepted
 * - "submitted-review"   : Submitted, currently under review
 * - "outstanding"        : Required but not yet submitted
 * - "not-applicable"     : Not required for this facility
 */

import type { DocumentStatus } from "../core/presentation-types";

/**
 * Maps a Governance record to one of four presentation statuses.
 * 
 * Business Rules:
 * 1. If document has explicit approval status → "approved"
 * 2. If document is uploaded/submitted → "submitted-review"  
 * 3. If document is required but not uploaded → "outstanding"
 * 4. If document is not required for this facility → "not-applicable"
 * 
 * @param record - The governance record to map
 * @returns The presentation status
 */
export function mapGovernanceRecordToPresentationStatus(
  record: {
    isApproved?: boolean;
    isSubmitted?: boolean;
    isRequired?: boolean;
    isApplicable?: boolean;
  }
): DocumentStatus {
  // Not applicable takes precedence
  if (record.isApplicable === false) {
    return "not-applicable";
  }
  
  // Explicitly approved
  if (record.isApproved === true) {
    return "approved";
  }
  
  // Submitted but not yet approved
  if (record.isSubmitted === true) {
    return "submitted-review";
  }
  
  // Required but nothing submitted
  if (record.isRequired !== false) {
    return "outstanding";
  }
  
  // Default: not applicable
  return "not-applicable";
}

/**
 * Maps database upload status to presentation status.
 * 
 * @param workflowStatus - Raw workflow status from database
 * @returns Presentation status
 */
export function mapWorkflowStatusToPresentationStatus(
  workflowStatus: string | null | undefined
): DocumentStatus {
  if (!workflowStatus) {
    return "outstanding";
  }
  
  const normalized = workflowStatus.toLowerCase().trim();
  
  switch (normalized) {
    case "approved":
    case "accepted":
    case "verified":
      return "approved";
      
    case "submitted":
    case "pending":
    case "under review":
    case "in review":
      return "submitted-review";
      
    case "rejected":
    case "returned":
      // Returned documents are treated as outstanding
      return "outstanding";
      
    case "not applicable":
    case "na":
    case "n/a":
      return "not-applicable";
      
    default:
      return "outstanding";
  }
}

/**
 * Maps milestone completion status to facility status.
 * 
 * @param plannedProgress - Planned progress percentage (0-100)
 * @param actualProgress - Actual progress percentage (0-100)
 * @param variance - Calculated variance (actual - planned)
 * @param hasBaselineSchedule - Whether facility has a baseline schedule
 * @returns Facility status for traffic-light reporting
 */
export function mapProgressToFacilityStatus(
  plannedProgress: number | null,
  actualProgress: number | null,
  variance: number | null,
  hasBaselineSchedule: boolean
): "on-track" | "attention" | "delayed" | "not-started" | "complete" {
  // No baseline schedule = not started
  if (!hasBaselineSchedule || plannedProgress === null) {
    return "not-started";
  }
  
  // Complete
  if (actualProgress !== null && actualProgress >= 100) {
    return "complete";
  }
  
  // Not started yet
  if (actualProgress === null || actualProgress === 0) {
    // Check if we should have started
    if (plannedProgress > 0) {
      return "delayed";
    }
    return "not-started";
  }
  
  // Calculate variance if not provided
  const actualVariance = variance !== null 
    ? variance 
    : (actualProgress !== null && plannedProgress !== null)
      ? actualProgress - plannedProgress 
      : 0;
  
  // On track: within 5% of planned
  if (Math.abs(actualVariance) <= 5) {
    return "on-track";
  }
  
  // Ahead of plan but not complete
  if (actualVariance > 5) {
    return "on-track";
  }
  
  // Behind plan
  if (actualVariance >= -15) {
    return "attention";
  }
  
  return "delayed";
}

/**
 * Counts documents by presentation status.
 * 
 * @param statuses - Array of document statuses
 * @returns Aggregated counts
 */
export function countDocumentsByStatus(
  statuses: DocumentStatus[]
): {
  approved: number;
  submittedReview: number;
  outstanding: number;
  notApplicable: number;
  totalApplicable: number;
  totalAll: number;
} {
  const counts = {
    approved: 0,
    submittedReview: 0,
    outstanding: 0,
    notApplicable: 0,
    totalApplicable: 0,
    totalAll: statuses.length,
  };
  
  for (const status of statuses) {
    switch (status) {
      case "approved":
        counts.approved++;
        counts.totalApplicable++;
        break;
      case "submitted-review":
        counts.submittedReview++;
        counts.totalApplicable++;
        break;
      case "outstanding":
        counts.outstanding++;
        counts.totalApplicable++;
        break;
      case "not-applicable":
        counts.notApplicable++;
        break;
    }
  }
  
  return counts;
}

/**
 * Calculates compliance percentage.
 * 
 * Business Rule: Not Applicable is EXCLUDED from denominator.
 * Compliance = Approved / (Approved + Submitted + Outstanding)
 * 
 * @param approved - Count of approved documents
 * @param submittedReview - Count of submitted documents under review
 * @param outstanding - Count of outstanding documents
 * @returns Compliance percentage (0-100) or null if no applicable documents
 */
export function calculateCompliancePercentage(
  approved: number,
  submittedReview: number,
  outstanding: number
): number | null {
  const applicable = approved + submittedReview + outstanding;
  
  if (applicable === 0) {
    return null;
  }
  
  // Only approved documents count toward compliance
  return Math.round((approved / applicable) * 100);
}

/**
 * Determines if a document is applicable to a facility.
 * 
 * @param tocId - TOC deliverable identifier
 * @param facilitySlug - Facility identifier
 * @param mappings - Optional explicit applicability mappings
 * @returns Whether the document is applicable
 */
export function isDocumentApplicableToFacility(
  tocId: string,
  facilitySlug: string,
  mappings?: Map<string, Set<string>>
): boolean {
  // If no mappings provided, assume all documents apply to all facilities
  if (!mappings) {
    return true;
  }
  
  const facilityDocuments = mappings.get(facilitySlug);
  if (!facilityDocuments) {
    return false;
  }
  
  return facilityDocuments.has(tocId);
}

/**
 * Status mapping documentation for transparency.
 * Returns markdown describing all status mappings.
 */
export function getStatusMappingDocumentation(): string {
  return `
# Governance Status Mapping

## Source Status → Presentation Status

| Source Status | Presentation Status | Notes |
|--------------|---------------------|-------|
| isApproved = true | approved | Fully approved and accepted |
| isSubmitted = true, not approved | submitted-review | Under review |
| isRequired = true, not submitted | outstanding | Required but missing |
| isApplicable = false | not-applicable | Not required |

## Workflow Status Mapping

| Workflow Status | Presentation Status |
|-----------------|---------------------|
| "approved", "accepted", "verified" | approved |
| "submitted", "pending", "under review", "in review" | submitted-review |
| "rejected", "returned" | outstanding |
| "not applicable", "na", "n/a" | not-applicable |
| (empty/null) | outstanding |

## Facility Status Rules

| Condition | Facility Status |
|-----------|-----------------|
| No baseline schedule | not-started |
| Actual progress >= 100% | complete |
| Variance within ±5% | on-track |
| Variance -15% to -5% | attention |
| Variance < -15% | delayed |

## Compliance Calculation

\`\`\`
Compliance % = (Approved) / (Approved + Submitted + Outstanding) × 100
\`\`\`

**Important:** Not Applicable documents are EXCLUDED from the denominator.

## Mode A vs Mode B

- **Mode A**: Requirement matrix available, compliance is authoritative
- **Mode B**: Requirement matrix unavailable, using proxy metrics

Mode is determined by \`hasRequirementMatrix\` flag in presentation model.
`;
}
