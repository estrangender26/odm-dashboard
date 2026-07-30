/**
 * Governance Presentation Generator
 * 
 * Orchestrates the generation of a complete Governance executive presentation.
 * Coordinates the adapter, layouts, and PowerPoint export.
 */

import { generateGovernancePresentationAutomizer } from "../../../src/modules/presentation-center/governanceAutomizer";
import { adaptGovernanceDataToPresentationModel } from "./governance-presentation-adapter";
import { renderExecutiveSummarySlide } from "../layouts/executive-summary-layout";
import { renderFacilityDashboardSlide } from "../layouts/facility-dashboard-layout";
import { renderProgressPanelSlide } from "../layouts/progress-panel-layout";
import { renderComplianceMatrixSlide } from "../layouts/compliance-matrix-layout";
import { validateGovernancePresentation } from "./governance-presentation-validation";
import type { GovernancePresentationModel } from "./governance-presentation-model";
import type { FacilityGovernanceData } from "../../../src/modules/presentation-center/governanceTypes";

/**
 * Complete presentation generation options.
 */
export interface PresentationGenerationOptions {
  /** Reporting date for the presentation */
  reportingDate: Date;
  
  /** Whether requirement matrix is available */
  hasRequirementMatrix?: boolean;
  
  /** Generator version */
  generatorVersion?: string;
  
  /** Enable validation before generation */
  validate?: boolean;
}

/**
 * Generates a complete Governance executive presentation.
 * 
 * @param facilitiesData - Source data from database
 * @param options - Generation options
 * @returns Generated PPTX buffer
 */
export async function generateGovernancePresentationNew(
  facilitiesData: FacilityGovernanceData[],
  options: PresentationGenerationOptions
): Promise<Buffer> {
  const { 
    reportingDate, 
    hasRequirementMatrix = false,
    generatorVersion = "2.0.0",
    validate = true
  } = options;
  
  // Step 1: Adapt source data to presentation model
  const model = adaptGovernanceDataToPresentationModel(
    facilitiesData,
    reportingDate,
    { hasRequirementMatrix, generatorVersion }
  );
  
  // Step 2: Validate the model (optional but recommended)
  if (validate) {
    const validation = validateGovernancePresentation(model);
    
    if (!validation.valid) {
      throw new Error(
        `Presentation validation failed: ${validation.errors.join("; ")}`
      );
    }
    
    if (validation.warnings.length > 0) {
      console.warn("Presentation validation warnings:", validation.warnings);
    }
  }
  
  // Step 3: Generate slides via layouts
  const slideData = generateSlideData(model);
  
  // Step 4: Export to PowerPoint
  const buffer = await exportToPowerPoint(model, slideData);
  
  return buffer;
}

/**
 * Generates slide data from all layouts.
 */
function generateSlideData(model: GovernancePresentationModel) {
  return {
    slide1: renderExecutiveSummarySlide(model),
    slide2: renderFacilityDashboardSlide(model),
    slide3: renderProgressPanelSlide(model),
    slide4: renderComplianceMatrixSlide(model),
  };
}

/**
 * Exports presentation model to PowerPoint.
 * 
 * Uses the existing automizer-based generator with the new model.
 */
async function exportToPowerPoint(
  model: GovernancePresentationModel,
  slideData: ReturnType<typeof generateSlideData>
): Promise<Buffer> {
  // Build the report structure expected by the automizer
  const report = {
    generatedAt: model.generatedAt,
    reportingDate: model.reportingPeriod,
    portfolio: {
      totalFacilities: model.executiveSummary.facilityCount,
      overallProgress: model.executiveSummary.overallActualProgress ?? 0,
      overallCompliance: model.executiveSummary.overallCompliancePercent ?? 0,
      submissionCoverageProxy: 0,
      requiredMilestoneSubmissionProxy: 0,
      totalSubmitted: model.facilities.reduce((sum, f) => 
        sum + f.approvedDeliverables + f.submittedDeliverables, 0),
      totalApproved: model.facilities.reduce((sum, f) => sum + f.approvedDeliverables, 0),
      totalUnmappedDocuments: 0,
      outstandingMilestoneSubmissionProxy: model.facilities.reduce(
        (sum, f) => sum + f.outstandingDeliverables, 0
      ),
    },
    facilities: model.facilities.map(f => ({
      facility: {
        slug: f.facilityId,
        name: f.facilityName,
        shortName: f.facilityShortName,
        color: f.color,
      },
      progress: f.actualProgress ?? 0,
      deliverablesCompliance: f.compliancePercent ?? 0,
      submissionCoverageProxy: 0,
      required: f.totalApplicableDeliverables,
      submitted: f.approvedDeliverables + f.submittedDeliverables,
      approved: f.approvedDeliverables,
      outstanding: f.outstandingDeliverables,
      unmappedDocuments: 0,
      hasRequirementBaseline: f.totalApplicableDeliverables > 0,
      dataQualityWarning: null,
      scheduleVariance: f.variance,
      status: f.status,
      sCurve: f.progressSeries.map(p => ({
        date: p.periodDate,
        planned: p.planned,
        actual: p.actual,
        forecast: null,
      })),
      hasBaselineSchedule: f.hasBaselineSchedule,
      dataQuality: {
        weightSource: "equal-fallback" as const,
        hasWorkflowStatus: true,
        hasRequirementMatrix: model.hasRequirementMatrix,
      },
      deliverableStatuses: f.deliverableStatuses.map(d => ({
        tocId: d.tocId,
        tocLabel: d.tocLabel,
        status: d.status === "approved" ? "Submitted" : 
               d.status === "submitted-review" ? "Submitted" :
               d.status === "outstanding" ? "Missing" : "Not Required",
        rawFileCount: d.fileCount,
      })),
    })),
    deliverableCompliance: [],
    executiveActions: [],
    risks: [],
    dataQuality: {
      weightSource: "equal-fallback" as const,
      hasWorkflowStatus: true,
      hasRequirementMatrix: model.hasRequirementMatrix,
    },
  };
  
  // Use the existing automizer generator
  return generateGovernancePresentationAutomizer(report as any);
}

/**
 * Generates presentation metadata for inspection.
 */
export function generatePresentationMetadata(
  model: GovernancePresentationModel
): {
  presentationId: string;
  type: string;
  generatedAt: string;
  slideCount: number;
  facilities: string[];
  hasRequirementMatrix: boolean;
  mode: string;
} {
  return {
    presentationId: model.presentationId,
    type: model.presentationType,
    generatedAt: model.generatedAt,
    slideCount: 4,
    facilities: model.facilities.map(f => f.facilityName),
    hasRequirementMatrix: model.hasRequirementMatrix,
    mode: model.mode,
  };
}
