/**
 * Executive Content Generator
 * Automatically generates headlines, observations, and recommendations
 */

import type { FacilityData, PortfolioSummary, FacilityDocumentation, ExecutiveContent } from "./types";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
}

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
  
  const prePppFacilities = facilitiesWithCorrectedStatus.filter(f => f.effectivePhase === "PRE-PPP");
  const pppActiveFacilities = facilitiesWithCorrectedStatus.filter(f => f.effectivePhase === "PPP");
  const futurePppFacilities = facilitiesWithCorrectedStatus.filter(f => f.isFuturePpp);
  
  // Slide 1: Concise portfolio-level headline
  const headline = "Portfolio PPP Status";
  
  // Dynamic subtitle based on facility distribution
  let subtitleDetail = "";
  if (pppActiveFacilities.length > 0 && prePppFacilities.length > 0) {
    subtitleDetail = `${pppActiveFacilities.length} in PPP execution; ${prePppFacilities.length} in pre-PPP readiness`;
  } else if (pppActiveFacilities.length > 0) {
    subtitleDetail = `${pppActiveFacilities.length} facility${pppActiveFacilities.length > 1 ? 'ies' : 'y'} in PPP execution`;
  } else if (prePppFacilities.length > 0) {
    subtitleDetail = `${prePppFacilities.length} facility${prePppFacilities.length > 1 ? 'ies' : 'y'} preparing for PPP`;
  }
  
  // Identify critical path facility
  const sortedByRisk = [...facilitiesWithCorrectedStatus].sort((a, b) => {
    const aDoc = facilityDocs.find(d => d.facilitySlug === a.slug);
    const bDoc = facilityDocs.find(d => d.facilitySlug === b.slug);
    const aScore = (aDoc?.compliancePercent ?? 0) + (a.isFuturePpp ? -20 : 0);
    const bScore = (bDoc?.compliancePercent ?? 0) + (b.isFuturePpp ? -20 : 0);
    return aScore - bScore;
  });
  const criticalFacility = sortedByRisk[0];
  
  // Slide 1: Next Gate with specific actionable detail
  let nextGateAction = "Next Gate: Continue milestone progression | Status: On Schedule";
  
  const facilityNeedingAttention = facilitiesWithCorrectedStatus.find(f => {
    const incompleteMs = f.milestones.filter(m => 
      m.status !== "achieved" && m.status !== "achieved_ahead"
    );
    return incompleteMs.length > 0 && !f.isFuturePpp;
  });
  
  if (facilityNeedingAttention) {
    const incompleteMs = facilityNeedingAttention.milestones.filter(m => 
      m.status !== "achieved" && m.status !== "achieved_ahead"
    );
    const nextMs = incompleteMs[0];
    const shortName = facilityNeedingAttention.shortName.split(" ")[0];
    const msName = getShortMilestoneName(nextMs?.code || "M1");
    
    if (criticalFacility && criticalFacility.slug === facilityNeedingAttention.slug) {
      nextGateAction = `Next Gate: ${msName} for ${shortName} | Status: Critical Path`;
    } else {
      nextGateAction = `Next Gate: ${msName} for ${shortName} | Status: On Schedule`;
    }
  }
  
  // Slide 2: Gate Implication
  let gateImplication = "Complete Pre-PPP milestones before gate.";
  
  if (futurePppFacilities.length > 0) {
    const names = futurePppFacilities.map(f => f.shortName.split(" ")[0]).join(" and ");
    const pppDates = [...new Set(futurePppFacilities.map(f => 
      new Date(f.pppStartDate).toLocaleDateString("en-US", { month: "short" })
    ))].join(" and ");
    gateImplication = `${names} must complete pre-PPP readiness before ${pppDates} PPP start.`;
  } else if (pppActiveFacilities.length > 0 && prePppFacilities.length > 0) {
    const activeNames = pppActiveFacilities.map(f => f.shortName.split(" ")[0]).join(" and ");
    const preNames = prePppFacilities.map(f => f.shortName.split(" ")[0]).join(" and ");
    gateImplication = `${activeNames} are in active PPP; ${preNames} must complete readiness milestones.`;
  } else if (pppActiveFacilities.length > 0) {
    gateImplication = "All facilities are in active PPP execution. Focus on milestone completion and documentation.";
  }
  
  // Slide 3: Documentation Headline
  const portfolioPct = summary.portfolioCompliancePercent;
  let docHeadline = "";
  if (portfolioPct >= 70) {
    docHeadline = `Documentation readiness is ${portfolioPct}%; portfolio is on track`;
  } else if (portfolioPct >= 50) {
    docHeadline = `Documentation readiness is ${portfolioPct}%; acceleration required`;
  } else {
    docHeadline = `Documentation readiness is ${portfolioPct}%; significant gaps remain`;
  }
  
  // Slide 3: Tightened Portfolio Observation
  const sorted = [...facilityDocs].sort((a, b) => b.compliancePercent - a.compliancePercent);
  const leader = sorted[0];
  const laggard = sorted[sorted.length - 1];
  
  let portfolioObservation = "Documentation submission ongoing across all facilities.";
  
  if (leader && laggard && leader !== laggard) {
    const parts: string[] = [];
    parts.push(`Portfolio documentation readiness is ${portfolioPct}% (${summary.totalDocumentsSubmitted} of ${summary.totalDocumentsRequired} deliverables).`);
    
    if (laggard.compliancePercent === 0) {
      parts.push(`${laggard.facilityName} has no approved submissions and remains the highest onboarding risk.`);
      parts.push("A recovery plan is required before the next governance review.");
    } else if (laggard.compliancePercent <= 20) {
      parts.push(`${laggard.facilityName} requires acceleration with only ${laggard.compliancePercent}% completion.`);
    }
    
    if (parts.length > 0) {
      portfolioObservation = parts.join(" ");
    }
  }
  
  // Facility-specific observations - shortened to one line
  const facilityObservations: Record<string, string> = {};
  for (const facility of facilitiesWithCorrectedStatus) {
    const doc = facilityDocs.find(d => d.facilitySlug === facility.slug);
    const isPppStarted = !facility.isFuturePpp;
    
    if (!doc) continue;
    
    // Generate concise single-line observation
    if (doc.compliancePercent === 0 && isPppStarted) {
      facilityObservations[facility.slug] = `${facility.shortName}: Active PPP with 0% documentation - governance exception.`;
    } else if (doc.compliancePercent >= 70) {
      facilityObservations[facility.slug] = `${facility.shortName} leads documentation at ${doc.compliancePercent}%.`;
    } else if (doc.compliancePercent >= 50) {
      facilityObservations[facility.slug] = `${facility.shortName} is building momentum (${doc.compliancePercent}%).`;
    } else if (doc.compliancePercent >= 30) {
      facilityObservations[facility.slug] = `Accelerate ${facility.shortName} documentation (${doc.compliancePercent}%).`;
    } else {
      facilityObservations[facility.slug] = `${facility.shortName} documentation is critical path (${doc.compliancePercent}%).`;
    }
  }
  
  return {
    headline,
    subtitle: subtitleDetail || "Milestone progress versus the sequence planned from each facility's PPP start date",
    nextGateAction,
    timelineSubtitle: `Calendar-based phase timeline | ${formatDate(reportingDateObj)}`,
    gateImplication,
    documentationHeadline: docHeadline,
    documentationSubtitle: "Final acceptance requires a fully compliant O&M Manual under the Standard Governance Framework",
    portfolioObservation,
    facilityObservations,
  };
}

// Helper function to get short milestone names
function getShortMilestoneName(code: string): string {
  const names: Record<string, string> = {
    M1: "T&C Complete",
    M2: "Commissioning",
    M3: "Punchlist",
    M4: "PM Setup",
    M5: "PM Execution",
    M6: "Training",
    M7: "Optimization",
    M8: "SLA Active",
    M9: "BAU Ready",
  };
  return names[code] || code;
}
