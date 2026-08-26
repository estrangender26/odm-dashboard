/**
 * Executive Content Generator
 * Automatically generates headlines, observations, and recommendations
 */

import type { FacilityData, PortfolioSummary, FacilityDocumentation, ExecutiveContent } from "./types";

export function generateExecutiveContent(
  facilities: FacilityData[],
  summary: PortfolioSummary,
  facilityDocs: FacilityDocumentation[],
  reportingDate: Date
): ExecutiveContent {
  const reportingDateObj = new Date(reportingDate);
  
  // Categorize facilities by actual status vs PPP start date
  const facilitiesWithCorrectedStatus = facilities.map(f => {
    const pppStart = new Date(f.pppStartDate);
    const isPppStarted = pppStart <= reportingDateObj;
    return {
      ...f,
      effectivePhase: isPppStarted ? f.currentPhase : "PRE-PPP" as const,
      effectiveStatus: isPppStarted ? f.phaseStatus : "PRE-PPP • IN PROGRESS" as const,
      isFuturePpp: !isPppStarted,
    };
  });
  
  // Slide 1: Concise portfolio-level headline
  const headline = "Portfolio PPP Status";
  
  // Dynamic subtitle with facility breakdown and date
  const formattedDate = reportingDateObj.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const pppCount = facilities.filter(f => f.currentPhase === "PPP" || f.currentPhase === "POST-PPP").length;
  const prePppCount = facilities.filter(f => f.currentPhase === "PRE-PPP").length;
  const fullSubtitle = `${pppCount} ${pppCount === 1 ? "facility" : "facilities"} in PPP execution; ${prePppCount} ${prePppCount === 1 ? "facility" : "facilities"} in pre-PPP readiness | ${formattedDate}`;
  
  // Slide 1: Next Gate
  // Build an action-oriented next-gate statement from current milestone/phase state.
  function buildNextGateAction(): string {
    const activePppFacilities = facilitiesWithCorrectedStatus.filter(f => f.effectivePhase === "PPP" && !f.isFuturePpp);
    const futurePppFacilities = facilitiesWithCorrectedStatus.filter(f => f.isFuturePpp);

    // PPP facilities with incomplete planned-now milestones drive the immediate next gate.
    const pppIncomplete = activePppFacilities.filter(f => {
      const incompleteMs = f.milestones.filter(m => m.status === "gap" || m.status === "upcoming");
      return incompleteMs.length > 0;
    });

    if (pppIncomplete.length > 0) {
      const names = pppIncomplete.map(f => f.shortName.split(" ")[0]).join(" and ");
      const incompleteCodes = [...new Set(pppIncomplete.flatMap(f => f.milestones.filter(m => m.status === "gap" || m.status === "upcoming").map(m => m.code)))];
      const task = incompleteCodes.includes("M4") || incompleteCodes.includes("M5")
        ? "complete SAP-PM task list setup"
        : incompleteCodes.includes("M1") || incompleteCodes.includes("M2") || incompleteCodes.includes("M3")
        ? "close remaining commissioning and defect milestones"
        : "complete outstanding PPP setup milestones";
      return `Next gate: ${task} for ${names} before the next review.`;
    }

    // Future-PPP facilities drive the pre-PPP readiness gate.
    if (futurePppFacilities.length > 0) {
      const names = futurePppFacilities.map(f => f.shortName.split(" ")[0]).join(" and ");
      const pppMonths = [...new Set(futurePppFacilities.map(f =>
        new Date(f.pppStartDate).toLocaleDateString("en-US", { month: "long" })
      ))].join(" and ");
      const anyRecovery = futurePppFacilities.some(f => f.phaseStatus.includes("RECOVERY"));
      const task = anyRecovery
        ? "close remaining Pre-PPP readiness gaps"
        : "finalise Pre-PPP commissioning readiness";
      return `Next gate: ${task} for ${names} before the ${pppMonths} 2026 PPP start.`;
    }

    return "Next gate: Continue milestone progression and maintain BAU governance.";
  }
  const nextGateAction = buildNextGateAction();
  
  // Slide 2: Gate Implication
  const futurePppFacilities = facilitiesWithCorrectedStatus.filter(f => f.isFuturePpp);
  let gateImplication = "Complete Pre-PPP milestones before gate.";
  
  if (futurePppFacilities.length > 0) {
    const names = futurePppFacilities.map(f => f.shortName.split(" ")[0]).join(" and ");
    const pppDates = [...new Set(futurePppFacilities.map(f => 
      new Date(f.pppStartDate).toLocaleDateString("en-US", { month: "long" })
    ))].join(" and ");
    gateImplication = `${names} must complete pre-PPP readiness before their ${pppDates} 2026 PPP start.`;
  }
  
  // Slide 3: Documentation Headline
  const portfolioPct = summary.portfolioCompliancePercent;
  const docHeadline = `Documentation readiness is ${portfolioPct}% (${summary.totalDocumentsSubmitted} of ${summary.totalDocumentsRequired} deliverables submitted)`;
  
  // Slide 3: Data-driven Portfolio Observation
  const laggard = [...facilityDocs].sort((a, b) => a.compliancePercent - b.compliancePercent)[0];
  const leader = [...facilityDocs].sort((a, b) => b.compliancePercent - a.compliancePercent)[0];

  const missingByFacility = facilityDocs.map(d => ({
    name: d.facilityName,
    missing: d.requiredCount - d.submittedCount,
    refs: d.referenceCount,
  }));
  const facilitiesWithGaps = missingByFacility.filter(f => f.missing > 0);

  let portfolioObservation = `Portfolio documentation readiness is ${portfolioPct}% (${summary.totalDocumentsSubmitted} of ${summary.totalDocumentsRequired} deliverables). `;
  if (facilitiesWithGaps.length > 0) {
    const gapText = facilitiesWithGaps
      .map(f => `${f.name}: ${f.missing} missing${f.refs > 0 ? `, ${f.refs} reference${f.refs === 1 ? "" : "s"}` : ""}`)
      .join("; ");
    portfolioObservation += `Outstanding gaps: ${gapText}. `;
  }
  if (laggard && laggard.compliancePercent === 0 && laggard.requiredCount > 0) {
    portfolioObservation += `${laggard.facilityName} has no submitted TOC deliverables and remains the highest onboarding risk. A recovery plan is required before the next governance review.`;
  } else if (leader && leader.compliancePercent >= 75 && facilitiesWithGaps.length < facilityDocs.length) {
    portfolioObservation += `${leader.facilityName} leads portfolio readiness at ${leader.compliancePercent}%.`;
  } else {
    portfolioObservation += "Focus on closing the remaining deliverables before the next review.";
  }
  
  // Facility-specific observations - data-driven from actual missing TOC items and file counts
  function buildFacilityObservation(facility: typeof facilitiesWithCorrectedStatus[0], doc: FacilityDocumentation): string {
    const shortName = facility.shortName.split(" ")[0];
    const pct = doc.compliancePercent;
    const phaseLabel = facility.effectivePhase === "PPP" ? "Active PPP" : "Pre-PPP readiness";
    const missingItems = doc.submissions.filter(s => !s.submitted).map(s => `TOC-${s.tocId}`);
    const missingClause = missingItems.length > 0
      ? `${missingItems.length} TOC deliverable${missingItems.length === 1 ? "" : "s"} missing`
      : "all TOC deliverables submitted";
    const fileClause = doc.milestoneFileCount > 0
      ? `${doc.milestoneFileCount} milestone file${doc.milestoneFileCount === 1 ? "" : "s"}`
      : "no milestone files";
    const refClause = doc.referenceCount > 0
      ? `${doc.referenceCount} reference${doc.referenceCount === 1 ? "" : "s"}`
      : "no references";
    return `${shortName}: ${phaseLabel} with ${pct}% documentation compliance; ${missingClause}; ${fileClause} and ${refClause} on record.`;
  }

  const facilityObservations: Record<string, string> = {};
  for (const facility of facilitiesWithCorrectedStatus) {
    const doc = facilityDocs.find(d => d.facilitySlug === facility.slug);
    if (!doc) continue;
    facilityObservations[facility.slug] = buildFacilityObservation(facility, doc);
  }
  
  return {
    headline,
    subtitle: fullSubtitle,
    nextGateAction,
    timelineSubtitle: `Calendar-based phase timeline | ${formattedDate}`,
    gateImplication,
    documentationHeadline: docHeadline,
    documentationSubtitle: "Final acceptance requires a fully compliant O&M Manual under the Standard Governance Framework",
    portfolioObservation,
    facilityObservations,
  };
}
