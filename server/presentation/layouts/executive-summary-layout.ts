/**
 * Executive Summary Layout
 * 
 * Slide 1: Portfolio-level executive summary with KPIs and narrative.
 */

import type { GovernancePresentationModel } from "../governance/governance-presentation-model";

/**
 * Renders Slide 1: Executive Summary.
 * 
 * @param model - The complete presentation model
 * @returns Slide content structure
 */
export function renderExecutiveSummarySlide(
  model: GovernancePresentationModel
): {
  slideNumber: number;
  title: string;
  content: {
    reportTitle: string;
    reportSubtitle: string;
    reportingPeriod: string;
    kpis: {
      overallActualProgress: number | null;
      overallPlannedProgress: number | null;
      overallVariance: number | null;
      facilityCount: number;
      totalApplicableDeliverables: number;
      overallCompliancePercent: number | null;
    };
    statusCounts: {
      "on-track": number;
      "attention": number;
      "delayed": number;
      "not-started": number;
      "complete": number;
    };
    narrative: string;
    disclosures: string[];
  };
} {
  const { executiveSummary } = model;
  
  return {
    slideNumber: 1,
    title: "Executive Summary",
    content: {
      reportTitle: model.reportTitle,
      reportSubtitle: model.reportSubtitle,
      reportingPeriod: model.reportingPeriod,
      kpis: {
        overallActualProgress: executiveSummary.overallActualProgress,
        overallPlannedProgress: executiveSummary.overallPlannedProgress,
        overallVariance: executiveSummary.overallVariance,
        facilityCount: executiveSummary.facilityCount,
        totalApplicableDeliverables: executiveSummary.totalApplicableDeliverables,
        overallCompliancePercent: executiveSummary.overallCompliancePercent,
      },
      statusCounts: executiveSummary.facilityStatusCounts,
      narrative: executiveSummary.narrative,
      disclosures: model.disclosures
        .filter(d => d.type === "mode" || d.type === "data-quality")
        .map(d => d.text),
    },
  };
}

/**
 * Validates executive summary slide requirements.
 * 
 * @param model - The presentation model
 * @returns Validation result
 */
export function validateExecutiveSummarySlide(
  model: GovernancePresentationModel
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!model.reportTitle) {
    errors.push("Missing report title");
  }
  
  if (!model.reportingPeriod) {
    errors.push("Missing reporting period");
  }
  
  if (!model.executiveSummary.narrative) {
    errors.push("Missing executive narrative");
  }
  
  if (model.executiveSummary.facilityCount === 0) {
    errors.push("No facilities in executive summary");
  }
  
  // Check KPI values are reasonable
  const { overallActualProgress, overallPlannedProgress } = model.executiveSummary;
  
  if (overallActualProgress !== null && (overallActualProgress < 0 || overallActualProgress > 100)) {
    errors.push(`Invalid actual progress: ${overallActualProgress}`);
  }
  
  if (overallPlannedProgress !== null && (overallPlannedProgress < 0 || overallPlannedProgress > 100)) {
    errors.push(`Invalid planned progress: ${overallPlannedProgress}`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
