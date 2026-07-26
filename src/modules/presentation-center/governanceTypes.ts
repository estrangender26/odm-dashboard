/**
 * O&M Manual Governance Types
 * 
 * This module provides types and calculation functions that are safe for
 * use in both frontend and backend code. No database imports here.
 * 
 * NOTE: This implementation uses PROXY metrics where formal data is unavailable:
 * - Milestone weights use equal-weight fallback (all = 1)
 * - Workflow approval status is NOT tracked in the database
 * - Deliverable requirements use milestone-count proxy (not a formal requirement matrix)
 */

import {
  GOVERNANCE_MILESTONES,
  WEIGHT_CALCULATION_META,
  WORKFLOW_STATUS_META,
  DELIVERABLE_REQUIREMENT_META,
  getFacilityColor,
} from "@/modules/governance/governanceConfig";

export const GOVERNANCE_SOURCE_LABEL = "O&M Manual Governance";
export const GOVERNANCE_DECK_TYPE = "Governance Onboarding Progress";

// Re-export configuration items for consumers
export { GOVERNANCE_MILESTONES, WORKFLOW_STATUS_META, DELIVERABLE_REQUIREMENT_META, getFacilityColor };

/**
 * Data quality disclosure text for generated presentations.
 * Must be displayed prominently on slides.
 */
export const DATA_QUALITY_DISCLOSURE = 
  "Submission coverage is based on a milestone-count proxy. Formal document approval workflow and a facility-specific deliverable requirement matrix are not currently available.";

/**
 * Proxy metric labels for accurate reporting.
 * Use these instead of authoritative compliance terms.
 */
export const PROXY_LABELS = {
  submissionCoverage: "Submission Coverage — Proxy",
  requiredMilestoneSubmissions: "Required Milestone Submissions — Proxy",
  submittedMilestoneRecords: "Submitted Milestone Records",
  outstandingMilestoneSubmissions: "Outstanding Milestone Submissions — Proxy",
  uploadedDocuments: "Uploaded Documents",
  baselineProgress: "Baseline Progress",
  actualMilestoneProgress: "Actual Milestone Progress",
  dataQuality: "DATA QUALITY: PROXY METRICS",
  // New labels for corrected compliance reporting
  documentSubmissionCompliance: "Document Submission Compliance",
  requiredDeliverables: "Required Deliverables",
  acceptedDeliverables: "Accepted/Approved Deliverables",
  outstandingDeliverables: "Outstanding Deliverables",
  unmappedDocuments: "Unmapped/Supplementary Documents",
  requirementBaselineUnavailable: "Requirement Baseline Unavailable",
  milestoneProgress: "Milestone Progress",
} as const;

export interface GovernanceFacility {
  slug: string;
  name: string;
  shortName: string;
  color: string;
}

export interface GovernanceMilestone {
  milestoneId: string;
  milestoneName: string;
  weight: number;
  plannedDate: string | null;
  actualDate: string | null;
  actualProgress: number | null;
  status: string | null;
}

export interface DocumentSummary {
  totalDocuments: number;
  byCategory: Record<string, number>;
  /**
   * Workflow status is NOT tracked in the database.
   * This structure exists for future implementation.
   * Currently all documents are shown as "pending" since we cannot determine approval state.
   */
  byWorkflowStatus: { 
    accepted: number; 
    pendingReview: number; 
    returned: number; 
    missing: number; 
    overdue: number;
    rejected: number;
  };
  latestSubmissionDate: string | null;
}

export interface GovernanceMetrics {
  governanceReadiness: number;
  riskLevel: string;
  milestones: { complete: number; total: number };
  progress: { planned: number | null; actual: number; variance: number | null };
  ragStatus: "green" | "amber" | "red" | "gray";
}

export interface FacilityGovernanceData {
  facility: GovernanceFacility;
  pppStartDate: string | null;
  governanceMetrics: GovernanceMetrics;
  milestones: GovernanceMilestone[];
  documentSummary: DocumentSummary;
}

export interface GovernancePortfolioSummary {
  totalFacilities: number;
  totalDocuments: number;
  documentsByFacility: Record<string, number>;
  milestonesComplete: number;
  milestonesTotal: number;
}

export interface SCurvePoint {
  date: string;
  planned: number | null;
  actual: number | null;
  forecast: number | null;
}

export interface ExecutiveActionItem {
  facility: string;
  action: string;
  priority: "critical" | "high" | "medium" | "low";
  dueDate: string | null;
  owner: string | null;
}

export interface PortfolioRisk {
  risk: string;
  impact: "high" | "medium" | "low";
  mitigation: string;
  facility: string | null;
}

export interface FacilityPresentationSummary {
  facility: GovernanceFacility;
  progress: number;
  /**
   * @deprecated Use submissionCoverageProxy instead. 
   * This is a proxy metric, not authoritative compliance.
   */
  deliverablesCompliance: number;
  /**
   * Proxy metric: Submission coverage based on requirement matrix or proxy.
   * Capped at 100%. Not authoritative deliverables compliance.
   */
  submissionCoverageProxy: number;
  required: number;
  submitted: number;
  /**
   * @deprecated Workflow approval status is not tracked.
   * All values will be 0.
   */
  approved: number;
  outstanding: number;
  /**
   * Documents that exceed the required count.
   * May be unmapped, supplementary, or duplicates.
   */
  unmappedDocuments: number;
  /**
   * Whether a requirement baseline exists for this facility.
   */
  hasRequirementBaseline: boolean;
  /**
   * Data quality warning if applicable.
   */
  dataQualityWarning: string | null;
  scheduleVariance: number | null;
  status: "green" | "amber" | "red" | "gray";
  sCurve: SCurvePoint[];
  hasBaselineSchedule: boolean;
  dataQuality: {
    weightSource: "equal-fallback" | "configured";
    hasWorkflowStatus: boolean;
    hasRequirementMatrix: boolean;
  };
}

export interface DeliverableComplianceRow {
  category: string;
  required: number;
  submitted: number;
  /**
   * @deprecated Workflow approval status is not tracked.
   * All values will be 0.
   */
  approved: number;
  /**
   * Compliance rate capped at 100%.
   * 0% indicates requirement baseline unavailable.
   */
  complianceRate: number;
  /**
   * Documents not mapped to a specific requirement.
   * May be supplementary, duplicates, or awaiting categorization.
   */
  unmapped?: number;
}

export interface GovernancePresentationReport {
  generatedAt: string;
  reportingDate: string;
  portfolio: {
    totalFacilities: number;
    overallProgress: number;
    /**
     * @deprecated Use submissionCoverageProxy instead.
     * This is a proxy metric, not authoritative compliance.
     */
    overallCompliance: number;
    /**
     * Proxy metric: Overall submission coverage.
     * Capped at 100%. Not authoritative compliance.
     */
    submissionCoverageProxy: number;
    /**
     * Proxy metric: Required milestone submissions.
     * Not a formal deliverable requirement matrix.
     * Zero when requirement baseline is unavailable.
     */
    requiredMilestoneSubmissionProxy: number;
    totalSubmitted: number;
    /**
     * @deprecated Workflow approval status is not tracked.
     * Use totalSubmitted instead.
     */
    totalApproved: number;
    /**
     * Documents that exceed the required count or have no requirement mapping.
     * May be supplementary, duplicates, or awaiting categorization.
     */
    totalUnmappedDocuments: number;
    /**
     * Proxy metric: Outstanding milestone submissions.
     * Not missing required documents.
     */
    outstandingMilestoneSubmissionProxy: number;
  };
  facilities: FacilityPresentationSummary[];
  deliverableCompliance: DeliverableComplianceRow[];
  executiveActions: ExecutiveActionItem[];
  risks: PortfolioRisk[];
  dataQuality: {
    weightSource: "equal-fallback" | "configured";
    hasWorkflowStatus: boolean;
    hasRequirementMatrix: boolean;
  };
}

// Calculation functions

function calculateCumulativePlannedProgress(
  milestones: GovernanceMilestone[],
  reportingDate: Date
): number | null {
  const hasPlannedDates = milestones.some(m => m.plannedDate);
  if (!hasPlannedDates) return null;
  
  const totalWeight = milestones.reduce((sum, m) => sum + m.weight, 0);
  if (totalWeight === 0) return null;
  
  const completedWeight = milestones
    .filter(m => m.plannedDate && new Date(m.plannedDate) <= reportingDate)
    .reduce((sum, m) => sum + m.weight, 0);
  
  return Math.round((completedWeight / totalWeight) * 100);
}

function calculateCumulativeActualProgress(
  milestones: GovernanceMilestone[],
  reportingDate: Date
): number {
  const totalWeight = milestones.reduce((sum, m) => sum + m.weight, 0);
  if (totalWeight === 0) return 0;
  
  const completedWeight = milestones
    .filter(m => {
      if (!m.actualDate) return false;
      const completionDate = new Date(m.actualDate);
      return completionDate <= reportingDate && (m.actualProgress === 100 || m.actualProgress === null);
    })
    .reduce((sum, m) => sum + m.weight, 0);
  
  return Math.round((completedWeight / totalWeight) * 100);
}

export function calculateFacilityProgress(
  milestones: GovernanceMilestone[],
  reportingDate: Date
): { actual: number; planned: number | null; variance: number | null; hasBaseline: boolean } {
  if (!milestones || milestones.length === 0) {
    return { actual: 0, planned: null, variance: null, hasBaseline: false };
  }

  const planned = calculateCumulativePlannedProgress(milestones, reportingDate);
  const actual = calculateCumulativeActualProgress(milestones, reportingDate);
  const hasBaseline = milestones.some(m => m.plannedDate);
  
  const variance = planned !== null ? actual - planned : null;
  
  return { actual, planned, variance, hasBaseline };
}

/**
 * Calculate submission coverage proxy.
 * 
 * NOTE: This is a PROXY calculation. Workflow approval status is not tracked
 * in the database, so we cannot determine actual approved deliverables.
 * This uses milestone count as a proxy for required submissions.
 * 
 * Do not present this as authoritative deliverables compliance.
 */
export interface RequirementMatrixResult {
  submissionCoverageProxy: number;
  requiredMilestoneSubmissionProxy: number;
  submittedCount: number;
  outstandingMilestoneSubmissionProxy: number;
  unmappedDocuments: number;
  hasRequirementBaseline: boolean;
  dataQualityWarning: string | null;
}

/**
 * Calculate submission coverage using proper requirement matrix or proxy.
 * 
 * CORRECTED BEHAVIOR:
 * - If no requirement matrix exists, reports "baseline unavailable" instead of fabricated percentage
 * - Caps coverage at 100% - excess documents reported as "unmapped/supplementary"
 * - Does NOT use milestone count as required document count
 */
export function calculateSubmissionCoverageProxy(
  docSummary: DocumentSummary,
  requiredDeliverables: number | null
): RequirementMatrixResult {
  const submittedCount = docSummary.totalDocuments;
  
  // If no requirement baseline exists, report unavailable
  if (requiredDeliverables === null || requiredDeliverables === undefined) {
    return {
      submissionCoverageProxy: 0,
      requiredMilestoneSubmissionProxy: 0,
      submittedCount,
      outstandingMilestoneSubmissionProxy: 0,
      unmappedDocuments: submittedCount,
      hasRequirementBaseline: false,
      dataQualityWarning: "Requirement baseline unavailable - cannot calculate compliance",
    };
  }
  
  const requiredMilestoneSubmissionProxy = requiredDeliverables;
  
  // Calculate coverage, capping at 100%
  let submissionCoverageProxy = requiredMilestoneSubmissionProxy > 0 
    ? Math.round((submittedCount / requiredMilestoneSubmissionProxy) * 100) 
    : 0;
  
  // Cap at 100% - excess documents are "unmapped/supplementary"
  submissionCoverageProxy = Math.min(submissionCoverageProxy, 100);
  
  // Calculate outstanding (cannot go below 0)
  const outstandingMilestoneSubmissionProxy = Math.max(0, requiredMilestoneSubmissionProxy - submittedCount);
  
  // Excess documents are unmapped/supplementary
  const unmappedDocuments = submittedCount > requiredMilestoneSubmissionProxy 
    ? submittedCount - requiredMilestoneSubmissionProxy 
    : 0;
  
  const dataQualityWarning = unmappedDocuments > 0 
    ? `${unmappedDocuments} document(s) exceed required count - may be unmapped, supplementary, or duplicates`
    : null;
  
  return {
    submissionCoverageProxy,
    requiredMilestoneSubmissionProxy,
    submittedCount,
    outstandingMilestoneSubmissionProxy,
    unmappedDocuments,
    hasRequirementBaseline: true,
    dataQualityWarning,
  };
}

export function determineRagStatus(
  progressVariance: number | null,
  outstandingItems: number,
  hasCriticalOverdue: boolean,
  hasBaseline: boolean
): "green" | "amber" | "red" | "gray" {
  if (!hasBaseline) return "gray";
  if (hasCriticalOverdue || (progressVariance !== null && progressVariance < -20)) return "red";
  if (progressVariance !== null && progressVariance < -10) return "amber";
  if (outstandingItems > 5) return "amber";
  if (progressVariance !== null && progressVariance >= 0 && outstandingItems <= 2) return "green";
  return outstandingItems > 0 ? "amber" : "green";
}

export function generateFacilitySCurve(
  milestones: GovernanceMilestone[],
  reportingDate: Date
): { points: SCurvePoint[]; hasBaseline: boolean } {
  if (!milestones || milestones.length === 0) {
    return { points: [], hasBaseline: false };
  }

  const totalWeight = milestones.reduce((sum, m) => sum + m.weight, 0);
  const hasBaseline = milestones.some(m => m.plannedDate);
  
  const dates = new Set<string>();
  milestones.forEach(m => {
    if (m.plannedDate) dates.add(m.plannedDate);
    if (m.actualDate) dates.add(m.actualDate);
  });
  dates.add(reportingDate.toISOString().split("T")[0]);
  
  const sortedDates = Array.from(dates).sort();
  
  const points: SCurvePoint[] = sortedDates.map(dateStr => {
    const date = new Date(dateStr);
    
    let planned: number | null = null;
    if (hasBaseline) {
      const plannedWeight = milestones
        .filter(m => m.plannedDate && new Date(m.plannedDate) <= date)
        .reduce((sum, m) => sum + m.weight, 0);
      planned = totalWeight > 0 ? Math.round((plannedWeight / totalWeight) * 100) : 0;
    }
    
    const actualWeight = milestones
      .filter(m => m.actualDate && new Date(m.actualDate) <= date)
      .reduce((sum, m) => sum + m.weight, 0);
    const actual = totalWeight > 0 ? Math.round((actualWeight / totalWeight) * 100) : 0;
    
    return { date: dateStr, planned, actual, forecast: null };
  });
  
  return { points, hasBaseline };
}

export function calculateForecastSCurve(
  points: SCurvePoint[],
  reportingDate: Date
): SCurvePoint[] {
  if (points.length === 0) return [];
  
  let lastActualIndex = -1;
  let lastActualValue = 0;
  let lastActualDate: Date | null = null;
  
  for (let i = points.length - 1; i >= 0; i--) {
    const pointDate = new Date(points[i].date);
    if (pointDate <= reportingDate && points[i].actual !== null) {
      lastActualIndex = i;
      lastActualValue = points[i].actual ?? 0;
      lastActualDate = pointDate;
      break;
    }
  }
  
  if (lastActualIndex === -1 || !lastActualDate) {
    return points.map(p => ({ ...p, forecast: null }));
  }
  
  let firstActualDate: Date | null = null;
  let firstActualValue = 0;
  for (const p of points) {
    if (p.actual !== null && p.actual > 0) {
      firstActualDate = new Date(p.date);
      firstActualValue = p.actual;
      break;
    }
  }
  
  if (!firstActualDate || lastActualValue === 0) {
    return points.map(p => ({ ...p, forecast: null }));
  }
  
  const daysElapsed = (lastActualDate.getTime() - firstActualDate.getTime()) / (1000 * 60 * 60 * 24);
  const progressMade = lastActualValue - firstActualValue;
  
  if (daysElapsed <= 0 || progressMade <= 0) {
    return points.map(p => ({ ...p, forecast: null }));
  }
  
  const velocity = progressMade / daysElapsed;
  
  return points.map((p) => {
    const pointDate = new Date(p.date);
    if (pointDate <= reportingDate) return { ...p, forecast: null };
    
    const daysFromLast = (pointDate.getTime() - lastActualDate.getTime()) / (1000 * 60 * 60 * 24);
    const forecast = Math.min(100, lastActualValue + velocity * daysFromLast);
    
    return { ...p, forecast: Math.round(forecast) };
  });
}

export function buildExecutiveActions(
  facilities: FacilityGovernanceData[]
): ExecutiveActionItem[] {
  const actions: ExecutiveActionItem[] = [];
  
  for (const facility of facilities) {
    const metrics = facility.governanceMetrics;
    const docs = facility.documentSummary;
    
    if (metrics.progress.variance !== null && metrics.progress.variance < -20) {
      const overdueMilestone = facility.milestones.find(m => 
        m.plannedDate && !m.actualDate && new Date(m.plannedDate) < new Date()
      );
      
      actions.push({
        facility: facility.facility.shortName,
        action: `Address significant schedule variance (${metrics.progress.variance}%)`,
        priority: "critical",
        dueDate: overdueMilestone?.plannedDate || null,
        owner: null,
      });
    }
    
    if (docs.totalDocuments > 10 && !WORKFLOW_STATUS_META.isTracked) {
      actions.push({
        facility: facility.facility.shortName,
        action: `Review ${docs.totalDocuments} submitted documents`,
        priority: "medium",
        dueDate: null,
        owner: null,
      });
    }
  }
  
  const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}

export function buildPortfolioRisks(
  facilities: FacilityGovernanceData[]
): PortfolioRisk[] {
  const risks: PortfolioRisk[] = [];
  
  const redFacilities = facilities.filter(f => f.governanceMetrics.ragStatus === "red");
  if (redFacilities.length > 0) {
    risks.push({
      risk: `${redFacilities.length} facility(ies) materially behind schedule`,
      impact: "high",
      mitigation: "Expedite document submissions and milestone completion",
      facility: redFacilities.map(f => f.facility.shortName).join(", ") || null,
    });
  }
  
  const noBaselineFacilities = facilities.filter(f => !f.governanceMetrics.progress.planned);
  if (noBaselineFacilities.length > 0) {
    risks.push({
      risk: "Insufficient baseline schedule data",
      impact: "medium",
      mitigation: "Establish project baselines for accurate tracking",
      facility: noBaselineFacilities.map(f => f.facility.shortName).join(", ") || null,
    });
  }
  
  if (!WORKFLOW_STATUS_META.isTracked || !DELIVERABLE_REQUIREMENT_META.hasRequirementMatrix) {
    risks.push({
      risk: "Report uses proxy data sources (see dataQuality flags)",
      impact: "low",
      mitigation: "Implement workflow status tracking and deliverable requirement matrix",
      facility: null,
    });
  }
  
  return risks;
}

/**
 * Build the governance report from fetched facility data.
 * 
 * @param facilities - Facility data fetched from database
 * @param reportingDate - Optional reporting date (defaults to current date)
 * @returns Complete presentation report model
 */
export function buildGovernanceReport(
  facilities: FacilityGovernanceData[],
  reportingDate?: Date
): GovernancePresentationReport {
  const now = reportingDate || new Date();
  const reportingDateStr = now.toISOString().split("T")[0];
  
  // CRITICAL: Requirement counts must come from actual requirement-matrix data
  // GOVERNANCE_MILESTONES.length must NEVER be used as document requirement count
  const hasRequirementMatrix = DELIVERABLE_REQUIREMENT_META.hasRequirementMatrix;
  
  // TODO: Load actual requirement matrix data when available
  // For now, requiredPerFacility is always null until real requirement rows are loaded
  const requiredPerFacility = null; // Must come from actual requirement matrix, not milestones
  
  // Calculate totals using corrected logic
  const totalSubmitted = facilities.reduce((sum, f) => sum + f.documentSummary.totalDocuments, 0);
  
  // Portfolio-level compliance only calculable with requirement matrix
  let requiredMilestoneSubmissionProxy = 0;
  let outstandingMilestoneSubmissionProxy = 0;
  let submissionCoverageProxy = 0;
  let portfolioUnmappedDocuments = 0;
  
  // Without actual requirement matrix data, compliance cannot be calculated
  // All documents are "awaiting requirement mapping" until matched to requirements
  requiredMilestoneSubmissionProxy = 0;
  outstandingMilestoneSubmissionProxy = 0;
  submissionCoverageProxy = 0;
  portfolioUnmappedDocuments = totalSubmitted;
  
  const overallProgress = facilities.length > 0
    ? Math.round(facilities.reduce((sum, f) => sum + f.governanceMetrics.progress.actual, 0) / facilities.length)
    : 0;
  
  const facilitySummaries: FacilityPresentationSummary[] = facilities.map(f => {
    const coverage = calculateSubmissionCoverageProxy(f.documentSummary, requiredPerFacility);
    const sCurveResult = generateFacilitySCurve(f.milestones, now);
    const sCurveWithForecast = calculateForecastSCurve(sCurveResult.points, now);
    
    return {
      facility: f.facility,
      progress: f.governanceMetrics.progress.actual,
      deliverablesCompliance: coverage.submissionCoverageProxy, // Deprecated: use submissionCoverageProxy
      submissionCoverageProxy: coverage.submissionCoverageProxy,
      required: coverage.requiredMilestoneSubmissionProxy,
      submitted: coverage.submittedCount,
      approved: 0, // Workflow status not tracked
      outstanding: coverage.outstandingMilestoneSubmissionProxy,
      unmappedDocuments: coverage.unmappedDocuments,
      hasRequirementBaseline: coverage.hasRequirementBaseline,
      dataQualityWarning: coverage.dataQualityWarning,
      scheduleVariance: f.governanceMetrics.progress.variance,
      status: f.governanceMetrics.ragStatus,
      sCurve: sCurveWithForecast,
      hasBaselineSchedule: sCurveResult.hasBaseline,
      dataQuality: {
        weightSource: WEIGHT_CALCULATION_META.source,
        hasWorkflowStatus: WORKFLOW_STATUS_META.isTracked,
        hasRequirementMatrix: DELIVERABLE_REQUIREMENT_META.hasRequirementMatrix,
      },
    };
  });
  
  // CORRECTED: Category compliance uses the same hasRequirementMatrix check from above
  
  const categoryCompliance: Record<string, { 
    required: number; 
    submitted: number; 
    approved: number;
    unmapped: number;
  }> = {};
  
  for (const f of facilities) {
    for (const [cat, count] of Object.entries(f.documentSummary.byCategory)) {
      if (cat === "references") continue;
      if (!categoryCompliance[cat]) {
        categoryCompliance[cat] = { required: 0, submitted: 0, approved: 0, unmapped: 0 };
      }
      // Without requirement matrix, all documents are "submitted" but "unmapped"
      categoryCompliance[cat].submitted += count;
      categoryCompliance[cat].unmapped += count;
    }
  }
  
  // Only calculate compliance rates if requirement matrix exists
  const deliverableCompliance: DeliverableComplianceRow[] = Object.entries(categoryCompliance)
    .map(([category, data]) => {
      if (hasRequirementMatrix) {
        // Normal compliance calculation
        const complianceRate = data.required > 0 
          ? Math.min(Math.round((data.submitted / data.required) * 100), 100) // Cap at 100%
          : 0;
        return {
          category,
          required: data.required,
          submitted: data.submitted,
          approved: 0, // Workflow status not tracked
          complianceRate,
        };
      } else {
        // No requirement matrix - compliance is unknown
        return {
          category,
          required: 0, // Unknown
          submitted: data.submitted,
          approved: 0,
          complianceRate: 0, // Cannot calculate without baseline
        };
      }
    })
    .sort((a, b) => b.complianceRate - a.complianceRate);
  
  const executiveActions = buildExecutiveActions(facilities);
  const risks = buildPortfolioRisks(facilities);
  
  return {
    generatedAt: new Date().toISOString(),
    reportingDate: reportingDateStr,
    portfolio: {
      totalFacilities: facilities.length,
      overallProgress,
      overallCompliance: submissionCoverageProxy, // Deprecated
      submissionCoverageProxy,
      requiredMilestoneSubmissionProxy,
      totalSubmitted,
      totalApproved: 0, // Deprecated: workflow status not tracked
      outstandingMilestoneSubmissionProxy,
      totalUnmappedDocuments: portfolioUnmappedDocuments,
    },
    facilities: facilitySummaries,
    deliverableCompliance,
    executiveActions,
    risks,
    dataQuality: {
      weightSource: WEIGHT_CALCULATION_META.source,
      hasWorkflowStatus: WORKFLOW_STATUS_META.isTracked,
      hasRequirementMatrix: DELIVERABLE_REQUIREMENT_META.hasRequirementMatrix,
    },
  };
}
