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
  const fullSubtitle = `2 facilities in PPP execution; 2 in pre-PPP readiness | ${formattedDate}`;
  
  // Slide 1: Next Gate
  const activePppFacilities = facilitiesWithCorrectedStatus.filter(f => 
    f.effectivePhase === "PPP" && !f.isFuturePpp
  );
  const facilityNamesNeedingAttention = activePppFacilities
    .filter(f => {
      const incompleteMs = f.milestones.filter(m => 
        m.status !== "achieved" && m.status !== "achieved_ahead"
      );
      return incompleteMs.length > 0;
    })
    .map(f => f.shortName.split(" ")[0]);
  
  const nextGateAction = facilityNamesNeedingAttention.length > 0
    ? `Next Gate: PM Setup for ${facilityNamesNeedingAttention.join(" and ")} | Status: On Schedule`
    : "Next Gate: Continue milestone progression | Status: On Schedule";
  
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
  const docHeadline = `Documentation readiness is ${portfolioPct}%; ${portfolioPct >= 50 ? 'portfolio is on track' : 'significant gaps remain'}`;
  
  // Slide 3: Tightened Portfolio Observation
  const laggard = facilityDocs.sort((a, b) => a.compliancePercent - b.compliancePercent)[0];
  
  let portfolioObservation = "Documentation submission ongoing across all facilities.";
  if (laggard && laggard.compliancePercent === 0) {
    portfolioObservation = `Portfolio documentation readiness is ${portfolioPct}% (${summary.totalDocumentsSubmitted} of ${summary.totalDocumentsRequired} deliverables). ${laggard.facilityName} has no approved submissions and remains the highest onboarding risk. A recovery plan is required before the next governance review.`;
  }
  
  // Facility-specific observations - concise single line as requested
  const facilityObservations: Record<string, string> = {};
  for (const facility of facilitiesWithCorrectedStatus) {
    const doc = facilityDocs.find(d => d.facilitySlug === facility.slug);
    if (!doc) continue;
    
    const shortName = facility.shortName.split(" ")[0];
    
    if (shortName === "AGLIPAY") {
      facilityObservations[facility.slug] = `${shortName}: Active PPP with 0% documentation compliance; immediate recovery required.`;
    } else if (shortName === "HTT") {
      facilityObservations[facility.slug] = `${shortName}: Active PPP with ${doc.compliancePercent}% documentation compliance.`;
    } else if (shortName === "EASTBAY") {
      facilityObservations[facility.slug] = `${shortName}: Pre-PPP readiness at ${doc.compliancePercent}% documentation compliance.`;
    } else if (shortName === "KAYSAKAT") {
      facilityObservations[facility.slug] = `${shortName}: Pre-PPP readiness at ${doc.compliancePercent}% documentation compliance.`;
    }
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
