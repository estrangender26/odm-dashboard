/**
 * Governance V3 Data Adapter
 * Fetches production data from database tables
 */

import { db } from "@db/connection";
import { governanceFacilities, governanceMilestoneState, governanceUploads } from "@db/schema";
import { inArray } from "drizzle-orm";
import type { FacilityData, FacilityDocumentation, PortfolioSummary, MilestoneData, MilestoneStatus, PhaseType, FacilityPhaseStatus } from "./types";
import { MILESTONES, GOVERNANCE_TOC_ITEMS } from "./theme";
import type { MilestoneCode } from "./theme";

// PPP start dates by facility slug - TODO: move to database configuration
const PPP_START_DATES: Record<string, string> = {
  aglipay: "2025-03-13",
  htt: "2025-03-13",
  eastbay: "2026-09-01",
  kaysakat: "2026-09-01",
};

interface FacilityDBRow {
  slug: string;
  name: string;
  shortName: string;
}

interface MilestoneStateRow {
  facilitySlug: string;
  milestoneId: string;
  compDate: string | null;
  pppDate: string | null;
}

interface UploadRow {
  facilitySlug: string;
  tocItem: string | null;
  milestoneId: string;
}

async function fetchFacilitiesFromDB(): Promise<FacilityDBRow[]> {
  const rows = await db.select({
    slug: governanceFacilities.slug,
    name: governanceFacilities.name,
    shortName: governanceFacilities.shortName,
  }).from(governanceFacilities);
  
  return rows.map(r => ({
    slug: r.slug,
    name: r.name,
    shortName: r.shortName || r.name,
  }));
}

async function fetchMilestoneStates(facilitySlugs: string[]): Promise<MilestoneStateRow[]> {
  if (facilitySlugs.length === 0) return [];
  
  const rows = await db.select({
    facilitySlug: governanceMilestoneState.facilitySlug,
    milestoneId: governanceMilestoneState.milestoneId,
    compDate: governanceMilestoneState.compDate,
    pppDate: governanceMilestoneState.pppDate,
  })
  .from(governanceMilestoneState)
  .where(inArray(governanceMilestoneState.facilitySlug, facilitySlugs));
  
  return rows;
}

async function fetchUploads(facilitySlugs: string[]): Promise<UploadRow[]> {
  if (facilitySlugs.length === 0) return [];
  
  const rows = await db.select({
    facilitySlug: governanceUploads.facilitySlug,
    tocItem: governanceUploads.tocItem,
    milestoneId: governanceUploads.milestoneId,
  })
  .from(governanceUploads)
  .where(inArray(governanceUploads.facilitySlug, facilitySlugs));
  
  return rows;
}

function determineMilestoneStatus(
  _milestoneId: string,
  compDate: string | null,
  pppDate: string | null,
  reportingDate: Date
): MilestoneStatus {
  if (compDate) {
    const completion = new Date(compDate);
    const planned = pppDate ? new Date(pppDate) : null;
    if (planned && completion < planned) {
      return "achieved_ahead";
    }
    return "achieved";
  }
  
  if (pppDate) {
    const planned = new Date(pppDate);
    if (planned < reportingDate) {
      return "gap";
    }
  }
  
  return "upcoming";
}

function determinePhase(milestones: MilestoneData[]): PhaseType {
  const m1m2m3Complete = milestones
    .filter(m => ["M1", "M2", "M3"].includes(m.code))
    .every(m => m.status === "achieved" || m.status === "achieved_ahead");
  
  const m4m5m6Complete = milestones
    .filter(m => ["M4", "M5", "M6"].includes(m.code))
    .every(m => m.status === "achieved" || m.status === "achieved_ahead");
  
  if (m1m2m3Complete && m4m5m6Complete) return "POST-PPP";
  if (m1m2m3Complete) return "PPP";
  return "PRE-PPP";
}

function determinePhaseStatus(
  phase: PhaseType,
  milestones: MilestoneData[]
): string {
  if (phase === "PRE-PPP") {
    const prePppMilestones = milestones.filter(m => ["M1", "M2", "M3"].includes(m.code));
    const complete = prePppMilestones.filter(m => m.status === "achieved" || m.status === "achieved_ahead").length;
    
    if (complete === 3) return "PRE-PPP • GATE READY";
    if (complete <= 1) return "PRE-PPP • RECOVERY";
    return "PRE-PPP • IN PROGRESS";
  }
  
  if (phase === "PPP") return "PPP ACTIVE";
  return "POST-PPP • SUSTAINMENT";
}

function generateExecutiveObservation(
  facilityName: string,
  milestones: MilestoneData[],
  phase: PhaseType
): string {
  const achieved = milestones.filter(m => m.status === "achieved" || m.status === "achieved_ahead").length;
  const gaps = milestones.filter(m => m.status === "gap").length;
  
  if (phase === "PRE-PPP") {
    if (gaps >= 2) {
      return `${facilityName} must close ${gaps} Pre-PPP milestones before gate.`;
    }
    if (achieved >= 3) {
      return `All Pre-PPP milestones complete for ${facilityName}; prepare PPP transition.`;
    }
  }
  
  if (phase === "PPP") {
    const m4m5m6 = milestones.filter(m => ["M4", "M5", "M6"].includes(m.code));
    const pppComplete = m4m5m6.filter(m => m.status === "achieved" || m.status === "achieved_ahead").length;
    if (gaps > 0) {
      return `SAP-PM task lists and training remain open for ${facilityName}.`;
    }
    return `Execution started; ${pppComplete}/3 PPP milestones on track.`;
  }
  
  return `${facilityName} is progressing through ${phase} phase.`;
}

export async function fetchPresentationData(
  reportingDate: Date = new Date()
): Promise<{ facilities: FacilityData[]; summary: PortfolioSummary; facilityDocumentation: FacilityDocumentation[] }> {
  const dbFacilities = await fetchFacilitiesFromDB();
  const facilitySlugs = dbFacilities.map(f => f.slug);
  
  const [milestoneStates, uploads] = await Promise.all([
    fetchMilestoneStates(facilitySlugs),
    fetchUploads(facilitySlugs),
  ]);
  
  const milestoneStatesByFacility = new Map<string, MilestoneStateRow[]>();
  for (const state of milestoneStates) {
    const existing = milestoneStatesByFacility.get(state.facilitySlug) || [];
    existing.push(state);
    milestoneStatesByFacility.set(state.facilitySlug, existing);
  }
  
  const uploadsByFacility = new Map<string, UploadRow[]>();
  for (const upload of uploads) {
    const existing = uploadsByFacility.get(upload.facilitySlug) || [];
    existing.push(upload);
    uploadsByFacility.set(upload.facilitySlug, existing);
  }
  
  const facilities: FacilityData[] = [];
  const facilityDocumentation: FacilityDocumentation[] = [];
  
  let prePppCount = 0, pppCount = 0, postPppCount = 0;
  let gateReadyCount = 0, recoveryCount = 0;
  let totalSubmitted = 0;
  
  const facilityColors = ["#f97316", "#3b82f6", "#10b981", "#8b5cf6"];
  
  for (let i = 0; i < dbFacilities.length; i++) {
    const dbf = dbFacilities[i];
    const states = milestoneStatesByFacility.get(dbf.slug) || [];
    const facilityUploads = uploadsByFacility.get(dbf.slug) || [];
    const pppStartDate = PPP_START_DATES[dbf.slug] || "2026-01-01";
    
    const milestones: MilestoneData[] = Object.entries(MILESTONES).map(([code, config]) => {
      const state = states.find(s => s.milestoneId === code);
      return {
        code: code as MilestoneCode,
        name: config.name,
        phase: config.phase as PhaseType,
        status: determineMilestoneStatus(code, state?.compDate || null, state?.pppDate || null, reportingDate),
        plannedDate: state?.pppDate || undefined,
        actualDate: state?.compDate || undefined,
      };
    });
    
    const phase = determinePhase(milestones);
    const phaseStatus = determinePhaseStatus(phase, milestones);
    
    if (phase === "PRE-PPP") prePppCount++;
    else if (phase === "PPP") pppCount++;
    else postPppCount++;
    
    if (phaseStatus === "PRE-PPP • GATE READY") gateReadyCount++;
    if (phaseStatus === "PRE-PPP • RECOVERY") recoveryCount++;
    
    const submissions = GOVERNANCE_TOC_ITEMS.map(tocId => {
      const hasUpload = facilityUploads.some(u => u.tocItem === tocId);
      return { tocId, submitted: hasUpload, documentCount: hasUpload ? 1 : 0 };
    });
    
    const submittedCount = submissions.filter(s => s.submitted).length;
    totalSubmitted += submittedCount;
    
    facilities.push({
      slug: dbf.slug,
      name: dbf.name,
      shortName: dbf.shortName,
      color: facilityColors[i % facilityColors.length],
      pppStartDate,
      currentPhase: phase,
      phaseStatus: phaseStatus as FacilityPhaseStatus,
      milestones,
      executiveObservation: generateExecutiveObservation(dbf.shortName, milestones, phase),
    });
    
    facilityDocumentation.push({
      facilitySlug: dbf.slug,
      facilityName: dbf.shortName,
      submissions,
      submittedCount,
      requiredCount: GOVERNANCE_TOC_ITEMS.length,
      compliancePercent: Math.round((submittedCount / GOVERNANCE_TOC_ITEMS.length) * 100),
    });
  }
  
  const summary: PortfolioSummary = {
    totalFacilities: facilities.length,
    facilitiesInPrePpp: prePppCount,
    facilitiesInPpp: pppCount,
    facilitiesInPostPpp: postPppCount,
    gateReadyCount,
    recoveryCount,
    totalDocumentsSubmitted: totalSubmitted,
    totalDocumentsRequired: facilities.length * GOVERNANCE_TOC_ITEMS.length,
    portfolioCompliancePercent: facilities.length > 0 
      ? Math.round((totalSubmitted / (facilities.length * GOVERNANCE_TOC_ITEMS.length)) * 100)
      : 0,
  };
  
  return { facilities, summary, facilityDocumentation };
}
