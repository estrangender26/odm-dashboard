/**
 * Governance Presentation Adapter
 * 
 * Converts Governance source data to the typed presentation model.
 * This is the single transformation layer between the database and
 * the presentation. All data mapping logic lives here.
 */

import type { GovernancePresentationModel, GovernanceFacilityPresentationData } from "./governance-presentation-model";
import type { GovernanceFacility, FacilityGovernanceData, GovernanceMilestone } from "../../../src/modules/presentation-center/governanceTypes";
import { calculateFacilityProgressAsOf, getFacilityColor } from "../../../src/modules/presentation-center/governanceTypes";
import { 
  mapProgressToFacilityStatus, 
  mapWorkflowStatusToPresentationStatus,
  countDocumentsByStatus,
  calculateCompliancePercentage,
  calculateLargestGap,
  countFacilitiesByStatus
} from "./governance-status-mapper";
import { generateExecutiveNarrative } from "./governance-narrative-generator";

/**
 * Admits Governance source data to a typed presentation model.
 * 
 * @param facilitiesData - Raw facility data from database
 * @param reportingDate - Date for which to generate the presentation
 * @param options - Optional configuration
 * @returns Complete presentation model
 */
export function adaptGovernanceDataToPresentationModel(
  facilitiesData: FacilityGovernanceData[],
  reportingDate: Date,
  options: {
    hasRequirementMatrix?: boolean;
    generatorVersion?: string;
  } = {}
): GovernancePresentationModel {
  const hasRequirementMatrix = options.hasRequirementMatrix ?? false;
  const generatorVersion = options.generatorVersion ?? "2.0.0";
  
  // Transform each facility
  const facilityPresentationData: GovernanceFacilityPresentationData[] = facilitiesData.map(
    (facilityData, index) => adaptFacilityData(facilityData, reportingDate, index)
  );
  
  // Calculate executive summary
  const executiveSummary = calculateExecutiveSummary(
    facilityPresentationData,
    reportingDate
  );
  
  // Build compliance matrix
  const complianceMatrix = buildComplianceMatrix(facilityPresentationData);
  
  // Generate disclosures
  const disclosures = generateDisclosures(hasRequirementMatrix);
  
  return {
    presentationId: `gov-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    presentationType: "governance-onboarding",
    reportTitle: "O&M Manual Governance",
    reportSubtitle: "New Facilities Onboarding",
    reportingPeriod: formatReportingPeriod(reportingDate),
    generatedAt: new Date().toISOString(),
    generatorVersion,
    hasRequirementMatrix,
    mode: hasRequirementMatrix ? "Mode A" : "Mode B",
    
    executiveSummary,
    facilities: facilityPresentationData,
    complianceMatrix,
    disclosures,
  };
}

/**
 * Adapts a single facility's data to presentation format.
 */
function adaptFacilityData(
  facilityData: FacilityGovernanceData,
  reportingDate: Date,
  index: number
): GovernanceFacilityPresentationData {
  // Calculate progress at reporting date
  const plannedProgress = calculateFacilityProgressAsOf(
    facilityData.milestones,
    reportingDate,
    "planned"
  );
  
  const actualProgress = calculateFacilityProgressAsOf(
    facilityData.milestones,
    reportingDate,
    "actual"
  );
  
  const variance = (actualProgress !== null && plannedProgress !== null)
    ? actualProgress - plannedProgress
    : null;
  
  // Get document counts
  const documentSummary = facilityData.documentSummary;
  const approved = documentSummary?.byWorkflowStatus?.accepted ?? 0;
  const submitted = documentSummary?.byWorkflowStatus?.pendingReview ?? 0;
  const returned = documentSummary?.byWorkflowStatus?.returned ?? 0;
  const outstanding = documentSummary?.byWorkflowStatus?.missing ?? 0;
  const totalDocs = documentSummary?.totalDocuments ?? 0;
  
  // Determine progress visualization type
  const progressSeries = extractProgressSeries(facilityData.milestones);
  const visualizationType = progressSeries.length > 2 ? "s-curve" : "snapshot";
  
  // Calculate compliance
  const totalApplicable = approved + submitted + outstanding + returned;
  const compliancePercent = calculateCompliancePercentage(
    approved,
    submitted + returned, // Treat returned as submitted
    outstanding
  );
  
  return {
    facilityId: facilityData.facility.slug,
    facilityName: facilityData.facility.name,
    facilityShortName: facilityData.facility.shortName,
    color: facilityData.facility.color,
    status: mapProgressToFacilityStatus(
      plannedProgress,
      actualProgress,
      variance,
      facilityData.hasBaselineSchedule
    ),
    
    plannedProgress,
    actualProgress,
    variance,
    hasBaselineSchedule: facilityData.hasBaselineSchedule,
    
    approvedDeliverables: approved,
    submittedDeliverables: submitted + returned,
    outstandingDeliverables: outstanding,
    notApplicableDeliverables: 0, // Will be calculated from TOC mappings
    totalApplicableDeliverables: totalApplicable,
    compliancePercent,
    
    progressVisualizationType: visualizationType,
    progressSeries,
    deliverableStatuses: [], // Would populate from TOC mappings
  };
}

/**
 * Calculates executive summary from facility data.
 */
function calculateExecutiveSummary(
  facilities: GovernanceFacilityPresentationData[],
  reportingDate: Date
): GovernancePresentationModel["executiveSummary"] {
  // Aggregate progress
  const applicableFacilities = facilities.filter(f => 
    f.plannedProgress !== null && f.actualProgress !== null
  );
  
  const avgPlanned = applicableFacilities.length 
    ? applicableFacilities.reduce((sum, f) => sum + (f.plannedProgress ?? 0), 0) / applicableFacilities.length
    : null;
    
  const avgActual = applicableFacilities.length
    ? applicableFacilities.reduce((sum, f) => sum + (f.actualProgress ?? 0), 0) / applicableFacilities.length
    : null;
    
  const variance = (avgActual !== null && avgPlanned !== null)
    ? avgActual - avgPlanned
    : null;
  
  // Count documents
  const totalApproved = facilities.reduce((sum, f) => sum + f.approvedDeliverables, 0);
  const totalSubmitted = facilities.reduce((sum, f) => sum + f.submittedDeliverables, 0);
  const totalOutstanding = facilities.reduce((sum, f) => sum + f.outstandingDeliverables, 0);
  const totalApplicable = totalApproved + totalSubmitted + totalOutstanding;
  
  const overallCompliance = calculateCompliancePercentage(
    totalApproved,
    totalSubmitted,
    totalOutstanding
  );
  
  // Status counts
  const statusCounts = countFacilitiesByStatus(facilities);
  
  // Largest gap
  const largestGap = calculateLargestGap(facilities);
  
  const summary: GovernancePresentationModel["executiveSummary"] = {
    overallPlannedProgress: avgPlanned,
    overallActualProgress: avgActual,
    overallVariance: variance,
    facilityCount: facilities.length,
    totalApplicableDeliverables: totalApplicable,
    overallCompliancePercent: overallCompliance,
    facilityStatusCounts: statusCounts,
    largestGap,
    narrative: "", // Will be populated after model creation
  };
  
  // Generate narrative
  const tempModel = {
    executiveSummary: summary,
    facilities,
    mode: "Mode B",
  } as GovernancePresentationModel;
  
  summary.narrative = generateExecutiveNarrative(tempModel);
  
  return summary;
}

/**
 * Builds compliance matrix for Slide 4.
 */
function buildComplianceMatrix(
  facilities: GovernanceFacilityPresentationData[]
): GovernancePresentationModel["complianceMatrix"] {
  // Create columns (facilities)
  const columns = facilities.map(f => ({
    facilityId: f.facilityId,
    facilityName: f.facilityShortName,
    color: f.color,
  }));
  
  // Calculate column totals
  const columnTotals = facilities.map(f => ({
    facilityId: f.facilityId,
    applicable: f.totalApplicableDeliverables,
    approved: f.approvedDeliverables,
    submitted: f.submittedDeliverables,
    outstanding: f.outstandingDeliverables,
    notApplicable: f.notApplicableDeliverables,
    compliancePercent: f.compliancePercent,
  }));
  
  // Calculate grand total
  const grandTotal = {
    facilityId: "grand",
    applicable: facilities.reduce((sum, f) => sum + f.totalApplicableDeliverables, 0),
    approved: facilities.reduce((sum, f) => sum + f.approvedDeliverables, 0),
    submitted: facilities.reduce((sum, f) => sum + f.submittedDeliverables, 0),
    outstanding: facilities.reduce((sum, f) => sum + f.outstandingDeliverables, 0),
    notApplicable: facilities.reduce((sum, f) => sum + f.notApplicableDeliverables, 0),
    compliancePercent: calculateCompliancePercentage(
      facilities.reduce((sum, f) => sum + f.approvedDeliverables, 0),
      facilities.reduce((sum, f) => sum + f.submittedDeliverables, 0),
      facilities.reduce((sum, f) => sum + f.outstandingDeliverables, 0)
    ),
  };
  
  return {
    rows: [], // Would populate from TOC definitions
    columns,
    cells: new Map(),
    columnTotals,
    grandTotal,
  };
}

/**
 * Extracts progress series from milestones.
 */
function extractProgressSeries(
  milestones: GovernanceMilestone[]
): { period: string; periodDate: string; planned: number | null; actual: number | null }[] {
  // Sort milestones by planned date
  const sorted = [...milestones].sort((a, b) => {
    if (!a.plannedDate) return 1;
    if (!b.plannedDate) return -1;
    return new Date(a.plannedDate).getTime() - new Date(b.plannedDate).getTime();
  });
  
  return sorted.map((m, index) => {
    const cumulativeWeight = sorted
      .slice(0, index + 1)
      .reduce((sum, ms) => sum + ms.weight, 0);
    
    const totalWeight = sorted.reduce((sum, ms) => sum + ms.weight, 0);
    const plannedPercent = totalWeight > 0 
      ? Math.round((cumulativeWeight / totalWeight) * 100)
      : null;
    
    const actualPercent = m.actualProgress !== null && m.actualProgress >= 100
      ? plannedPercent
      : null;
    
    return {
      period: m.plannedDate ?? `M${index + 1}`,
      periodDate: m.plannedDate ?? new Date().toISOString(),
      planned: plannedPercent,
      actual: actualPercent,
    };
  });
}

/**
 * Generates data quality disclosures.
 */
function generateDisclosures(
  hasRequirementMatrix: boolean
): GovernancePresentationModel["disclosures"] {
  const disclosures: GovernancePresentationModel["disclosures"] = [];
  
  if (!hasRequirementMatrix) {
    disclosures.push({
      type: "mode",
      label: "Mode B",
      text: "Requirement matrix unavailable. Using proxy metrics for compliance calculations.",
      severity: "warning",
      applicableModes: ["Mode B"],
    });
    
    disclosures.push({
      type: "proxy-metric",
      label: "Proxy Metrics",
      text: "Compliance calculated as Approved / (Approved + Submitted + Outstanding). Not Applicable excluded.",
      severity: "info",
      applicableModes: ["Mode B"],
    });
  } else {
    disclosures.push({
      type: "mode",
      label: "Mode A",
      text: "Formal Requirement Matrix active. Compliance calculations are authoritative.",
      severity: "info",
      applicableModes: ["Mode A"],
    });
  }
  
  return disclosures;
}

/**
 * Formats reporting period for display.
 */
function formatReportingPeriod(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Factory function for test fixtures.
 */
export function createGovernanceTestFixture(): FacilityGovernanceData[] {
  // Re-use existing fixture logic from governanceGenerator.ts
  const { createDeterministicTestFixture } = require("../../../src/modules/presentation-center/governanceGenerator");
  return createDeterministicTestFixture();
}
