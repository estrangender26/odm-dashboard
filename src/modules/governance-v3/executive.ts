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
  // postPppFacilities not used currently
  // const postPppFacilities = facilitiesWithCorrectedStatus.filter(f => f.effectivePhase === "POST-PPP");
  const futurePppFacilities = facilitiesWithCorrectedStatus.filter(f => f.isFuturePpp);
  
  // Slide 1: Portfolio-level headline
  let headline = "Governance Onboarding Progress";
  
  if (pppActiveFacilities.length > 0 && prePppFacilities.length > 0) {
    const pppNames = pppActiveFacilities.map(f => f.shortName.split(" ")[0]).join(" and ");
    const prePppNames = prePppFacilities.map(f => f.shortName.split(" ")[0]).join(" and ");
    headline = `${pppNames} in PPP execution; ${prePppNames} in pre-PPP readiness`;
  } else if (pppActiveFacilities.length >= 2) {
    const names = pppActiveFacilities.map(f => f.shortName.split(" ")[0]).join(" and ");
    headline = `${names} are in PPP execution`;
  } else if (pppActiveFacilities.length === 1) {
    headline = `${pppActiveFacilities[0].shortName} is in PPP execution`;
  } else if (prePppFacilities.length > 0) {
    const names = prePppFacilities.map(f => f.shortName.split(" ")[0]).join(" and ");
    headline = `${names} preparing for PPP transition`;
  }
  
  // Identify actual critical path facility (lowest compliance or behind milestones)
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
  
  // Find facility with most urgent next milestone
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
      nextGateAction = `Next Gate: Complete ${msName} for ${shortName} | Status: Critical Path`;
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
  
  // Slide 3: Portfolio Observation with data-driven risk and action
  const sorted = [...facilityDocs].sort((a, b) => b.compliancePercent - a.compliancePercent);
  const leader = sorted[0];
  const laggard = sorted[sorted.length - 1];
  
  let portfolioObservation = "Documentation submission ongoing across all facilities.";
  
  if (leader && laggard && leader !== laggard) {
    const parts: string[] = [];
    
    // Portfolio summary first
    parts.push(`Only ${summary.totalDocumentsSubmitted} of ${summary.totalDocumentsRequired} required deliverables are complete.`);
    
    // Identify highest risk
    if (laggard.compliancePercent === 0) {
      parts.push(`${laggard.facilityName} has no approved submissions and is the highest onboarding risk; recovery plan required.`);
    } else if (laggard.compliancePercent <= 20) {
      parts.push(`${laggard.facilityName} requires acceleration with only ${laggard.compliancePercent}% completion.`);
    }
    
    if (parts.length > 0) {
      portfolioObservation = parts.join(" ");
    }
  }
  
  // Facility-specific observations
  const facilityObservations: Record<string, string> = {};
  for (const facility of facilitiesWithCorrectedStatus) {
    const doc = facilityDocs.find(d => d.facilitySlug === facility.slug);
    const isPppStarted = !facility.isFuturePpp;
    
    if (!doc) continue;
    
    // Generate specific observation based on phase and documentation
    if (doc.compliancePercent === 0 && isPppStarted) {
      facilityObservations[facility.slug] = `${facility.shortName}: Active PPP with 0% documentation compliance - governance exception requiring immediate attention.`;
    } else if (doc.compliancePercent >= 70) {
      facilityObservations[facility.slug] = `${facility.shortName} leads documentation at ${doc.compliancePercent}%.`;
    } else if (doc.compliancePercent >= 50) {
      facilityObservations[facility.slug] = `${facility.shortName} is building momentum at ${doc.compliancePercent}%.`;
    } else if (doc.compliancePercent >= 30) {
      facilityObservations[facility.slug] = `Accelerate ${facility.shortName} documentation (${doc.compliancePercent}%).`;
    } else {
      facilityObservations[facility.slug] = `${facility.shortName} documentation is critical path (${doc.compliancePercent}%).`;
    }
  }
  
  return {
    headline,
    subtitle: "Milestone progress versus the sequence planned from each facility's PPP start date",
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
    M3: "Punchlist Closed",
    M4: "PM Setup",
    M5: "PM Execution",
    M6: "Training",
    M7: "Optimization",
    M8: "SLA Active",
    M9: "BAU Ready",
  };
  return names[code] || code;
}
