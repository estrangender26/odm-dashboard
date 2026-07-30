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
  const gateReady = facilities.filter(f => f.phaseStatus === "PRE-PPP • GATE READY");
  const recovery = facilities.filter(f => f.phaseStatus === "PRE-PPP • RECOVERY");
  const pppActive = facilities.filter(f => f.phaseStatus === "PPP ACTIVE");
  
  // Slide 1: Headline
  let headline = "Governance Onboarding Progress";
  if (recovery.length > 0) {
    const names = recovery.map(f => f.shortName.split(" ")[0]).join(" and ");
    headline = `${names} must close Pre-PPP milestones`;
  } else if (gateReady.length > 0) {
    const names = gateReady.map(f => f.shortName.split(" ")[0]).join(" and ");
    headline = gateReady.length === 1 
      ? `${gateReady[0].shortName} is gate-ready`
      : `${names} are gate-ready`;
  } else if (pppActive.length > 0) {
    headline = `${pppActive[0].shortName} is in PPP execution`;
  }
  
  // Slide 1: Next Gate
  let nextGateAction = "All facilities progressing through governance milestones";
  if (recovery.length > 0) {
    const names = recovery.map(f => f.shortName.split(" ")[0]).join(" and ");
    nextGateAction = `${names}: Complete commissioning check sheets before gate.`;
  } else if (gateReady.length > 0) {
    const names = gateReady.map(f => f.shortName.split(" ")[0]).join(" and ");
    const dates = [...new Set(gateReady.map(f => 
      new Date(f.pppStartDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    ))].join(" and ");
    nextGateAction = `${names} reach PPP on ${dates}`;
  }
  
  // Slide 2: Gate Implication
  let gateImplication = "Complete Pre-PPP milestones before gate.";
  if (gateReady.length > 0) {
    const names = gateReady.map(f => f.shortName.split(" ")[0]).join(" and ");
    const pppStart = new Date(gateReady[0].pppStartDate).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const isAre = gateReady.length === 1 ? " is" : " are";
    gateImplication = `${names} reach PPP on ${pppStart}. ${names}${isAre} ready to transition.`;
  } else if (recovery.length > 0) {
    const names = recovery.map(f => f.shortName.split(" ")[0]).join(" and ");
    const pppDates = [...new Set(recovery.map(f => 
      new Date(f.pppStartDate).toLocaleDateString("en-US", { month: "short" })
    ))].join(" and ");
    gateImplication = `${names} must complete Pre-PPP before ${pppDates} PPP start.`;
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
  
  // Slide 3: Portfolio Observation
  const sorted = [...facilityDocs].sort((a, b) => b.compliancePercent - a.compliancePercent);
  const leader = sorted[0];
  const laggard = sorted[sorted.length - 1];
  
  let portfolioObservation = "Documentation submission ongoing across all facilities.";
  if (leader && laggard && leader !== laggard) {
    const parts: string[] = [];
    if (leader.compliancePercent >= 60) {
      parts.push(`${leader.facilityName} leads at ${leader.compliancePercent}%.`);
    }
    if (laggard.compliancePercent <= 30) {
      parts.push(`${laggard.facilityName} requires acceleration.`);
    }
    if (parts.length > 0) {
      portfolioObservation = parts.join(" ");
    }
  }
  
  // Facility-specific observations
  const facilityObservations: Record<string, string> = {};
  for (const doc of facilityDocs) {
    if (doc.compliancePercent >= 70) {
      facilityObservations[doc.facilitySlug] = `${doc.facilityName} leads at ${doc.compliancePercent}%.`;
    } else if (doc.compliancePercent >= 50) {
      facilityObservations[doc.facilitySlug] = `${doc.facilityName} is building momentum.`;
    } else if (doc.compliancePercent >= 30) {
      facilityObservations[doc.facilitySlug] = `Accelerate ${doc.facilityName}.`;
    } else {
      facilityObservations[doc.facilitySlug] = `${doc.facilityName} is critical path.`;
    }
  }
  
  return {
    headline,
    subtitle: "Milestone progress versus the sequence planned from each facility's PPP start date",
    nextGateAction,
    timelineSubtitle: `Calendar-based phase timeline | ${formatDate(reportingDate)}`,
    gateImplication,
    documentationHeadline: docHeadline,
    documentationSubtitle: "Final acceptance requires a fully compliant O&M Manual under the Standard Governance Framework",
    portfolioObservation,
    facilityObservations,
  };
}
