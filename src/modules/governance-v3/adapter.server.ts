/**
 * Governance V3 Data Adapter (Server-Only)
 * 
 * Fetches production data from governance tables and transforms
 * into the canonical V3 presentation model.
 * 
 * @server-only
 */

import { db } from "@db/connection";
import { governanceFacilities, governanceMilestoneState, governanceUploads } from "@db/schema";
import { inArray } from "drizzle-orm";
import type { 
  FacilityData, 
  MilestoneData, 
  FacilityDocumentation,
  PortfolioSummary,
  GovernanceV3Presentation,
  MilestoneStatus,
  PhaseType,
  FacilityPhaseStatus,
} from "./types";
import { MILESTONES, GOVERNANCE_TOC_ITEMS, getFacilityColor } from "./theme";
import {
  calculateFacilityTocSubmissions,
  calculatePortfolioSubmittedFromDocumentations,
} from "./tocSubmission";
import { generateExecutiveContent } from "./executive";

/**
 * Derive PPP start date from milestone states
 * Returns the earliest pppDate found for the facility, or null if none exists
 */
function derivePppStartDate(facilitySlug: string, states: MilestoneStateRow[]): string | null {
  const facilityStates = states.filter(s => s.facilitySlug === facilitySlug);
  const dates = facilityStates
    .map(s => s.pppDate)
    .filter((d): d is string => d !== null && d !== undefined)
    .sort();
  return dates.length > 0 ? dates[0] : null;
}

// Milestone code mapping from DB to presentation model
const DB_MILESTONE_CODES = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"] as const;

interface MilestoneStateRow {
  facilitySlug: string;
  milestoneId: string;
  pppDate: string | null;
  compDate: string | null;
  customPct: number | null;
  readyStatus: string | null;
}

interface UploadRow {
  facilitySlug: string;
  milestoneId: string;
  tocItem: string | null;
  category: string;
  fileName: string;
  uploadedAt: Date | null;
}

/**
 * Determine milestone status based on dates and completion
 */
function determineMilestoneStatus(
  _milestoneId: string,
  state: MilestoneStateRow | undefined,
  reportingDate: Date
): MilestoneStatus {
  if (!state) return "upcoming";
  
  // Completed milestone
  if (state.compDate) {
    const completed = new Date(state.compDate);
    const planned = state.pppDate ? new Date(state.pppDate) : null;
    
    // If completed before planned date, it is ahead
    if (planned && completed < planned) {
      return "achieved_ahead";
    }
    return "achieved";
  }
  
  // Check if milestone is overdue (planned date passed, not completed)
  if (state.pppDate) {
    const planned = new Date(state.pppDate);
    if (planned <= reportingDate) {
      return "gap";
    }
  }
  
  return "upcoming";
}

/**
 * Determine facility phase status
 */
function determinePhaseStatus(
  milestones: MilestoneData[],
  phase: PhaseType
): FacilityPhaseStatus {
  const prePppComplete = milestones
    .filter(m => m.phase === "PRE-PPP")
    .every(m => m.status === "achieved" || m.status === "achieved_ahead");
  
  const hasGap = milestones.some(m => m.status === "gap");
  const inPpp = phase === "PPP";
  
  if (hasGap && !inPpp) return "PRE-PPP • RECOVERY";
  if (prePppComplete && !inPpp) return "PRE-PPP • GATE READY";
  if (phase === "PPP") return "PPP ACTIVE";
  return "PRE-PPP • IN PROGRESS";
}

/**
 * Fetch all facilities from database
 */
async function fetchFacilitiesFromDB() {
  return await db
    .select({
      id: governanceFacilities.id,
      slug: governanceFacilities.slug,
      name: governanceFacilities.name,
      shortName: governanceFacilities.shortName,
    })
    .from(governanceFacilities)
    .orderBy(governanceFacilities.name);
}

/**
 * Fetch milestone states for all facilities
 */
async function fetchMilestoneStates(facilitySlugs: string[]): Promise<MilestoneStateRow[]> {
  if (facilitySlugs.length === 0) return [];
  
  return await db
    .select({
      facilitySlug: governanceMilestoneState.facilitySlug,
      milestoneId: governanceMilestoneState.milestoneId,
      pppDate: governanceMilestoneState.pppDate,
      compDate: governanceMilestoneState.compDate,
      customPct: governanceMilestoneState.customPct,
      readyStatus: governanceMilestoneState.readyStatus,
    })
    .from(governanceMilestoneState)
    .where(inArray(governanceMilestoneState.facilitySlug, facilitySlugs));
}

/**
 * Fetch uploads for all facilities
 */
async function fetchUploads(facilitySlugs: string[]): Promise<UploadRow[]> {
  if (facilitySlugs.length === 0) return [];
  
  return await db
    .select({
      facilitySlug: governanceUploads.facilitySlug,
      milestoneId: governanceUploads.milestoneId,
      tocItem: governanceUploads.tocItem,
      category: governanceUploads.category,
      fileName: governanceUploads.fileName,
      uploadedAt: governanceUploads.uploadedAt,
    })
    .from(governanceUploads)
    .where(inArray(governanceUploads.facilitySlug, facilitySlugs));
}

/**
 * Calculate documentation compliance for a facility
 *
 * Uses the canonical TOC submission rules:
 * - normalizes raw TOC identifiers
 * - excludes supplementary uploads (OTHER / references / unknown TOC)
 * - counts each distinct facility + normalized TOC item once
 */
function calculateFacilityDocumentation(
  facilitySlug: string,
  facilityName: string,
  uploads: UploadRow[]
): FacilityDocumentation {
  const facilityUploads = uploads.filter(u => u.facilitySlug === facilitySlug);

  const { submittedTocIds, documentCounts } = calculateFacilityTocSubmissions(
    facilitySlug,
    facilityUploads
  );

  const submittedCount = submittedTocIds.size;
  const requiredCount = GOVERNANCE_TOC_ITEMS.length;

  const submissions = GOVERNANCE_TOC_ITEMS.map(tocId => ({
    tocId,
    submitted: submittedTocIds.has(tocId),
    documentCount: documentCounts.get(tocId) || 0,
  }));

  return {
    facilitySlug,
    facilityName,
    submissions,
    submittedCount,
    requiredCount,
    compliancePercent: Math.round((submittedCount / requiredCount) * 100),
  };
}

/**
 * Build facility milestone data
 */
function buildMilestones(
  facilitySlug: string,
  states: MilestoneStateRow[],
  reportingDate: Date
): MilestoneData[] {
  const stateMap = new Map(
    states
      .filter(s => s.facilitySlug === facilitySlug)
      .map(s => [s.milestoneId, s])
  );
  
  return DB_MILESTONE_CODES.map(code => {
    const definition = MILESTONES[code as keyof typeof MILESTONES];
    const state = stateMap.get(code);
    
    return {
      code: code as keyof typeof MILESTONES,
      name: definition.name,
      phase: definition.phase as PhaseType,
      status: determineMilestoneStatus(code, state, reportingDate),
      plannedDate: state?.pppDate ?? undefined,
      actualDate: state?.compDate ?? undefined,
    };
  });
}

/**
 * Determine current phase based on milestone completion
 */
function determineCurrentPhase(milestones: MilestoneData[]): PhaseType {
  const prePppComplete = milestones
    .filter(m => m.phase === "PRE-PPP")
    .every(m => m.status === "achieved" || m.status === "achieved_ahead");
  
  const pppComplete = milestones
    .filter(m => m.phase === "PPP")
    .every(m => m.status === "achieved" || m.status === "achieved_ahead");
  
  if (pppComplete) return "POST-PPP";
  if (prePppComplete) return "PPP";
  return "PRE-PPP";
}

/**
 * Fetch and transform governance data for V3 presentation
 */
export async function fetchGovernanceV3Data(
  reportingDate?: Date
): Promise<GovernanceV3Presentation> {
  const effectiveDate = reportingDate || new Date();
  const dateStr = effectiveDate.toISOString().split("T")[0];
  
  // Fetch all data from database
  const dbFacilities = await fetchFacilitiesFromDB();
  const facilitySlugs = dbFacilities.map(f => f.slug);
  
  const milestoneStates = await fetchMilestoneStates(facilitySlugs);
  const uploads = await fetchUploads(facilitySlugs);
  
  // Build facility data
  const facilities: FacilityData[] = dbFacilities.map((dbFacility, index) => {
    const milestones = buildMilestones(dbFacility.slug, milestoneStates, effectiveDate);
    const currentPhase = determineCurrentPhase(milestones);
    const phaseStatus = determinePhaseStatus(milestones, currentPhase);
    
    return {
      slug: dbFacility.slug,
      name: dbFacility.name,
      shortName: dbFacility.shortName || dbFacility.name,
      color: getFacilityColor(index),
      pppStartDate: derivePppStartDate(dbFacility.slug, milestoneStates) || "2026-01-01",
      currentPhase,
      phaseStatus,
      milestones,
      executiveObservation: "",
    };
  });
  
  // Calculate documentation for each facility
  const facilityDocumentation = dbFacilities.map(dbFacility => 
    calculateFacilityDocumentation(dbFacility.slug, dbFacility.name, uploads)
  );
  
  // Generate executive content
  const executive = generateExecutiveContent(facilities, 
    {
      totalFacilities: facilities.length,
      facilitiesInPrePpp: facilities.filter(f => f.currentPhase === "PRE-PPP").length,
      facilitiesInPpp: facilities.filter(f => f.currentPhase === "PPP").length,
      facilitiesInPostPpp: facilities.filter(f => f.currentPhase === "POST-PPP").length,
      gateReadyCount: facilities.filter(f => f.phaseStatus === "PRE-PPP • GATE READY").length,
      recoveryCount: facilities.filter(f => f.phaseStatus === "PRE-PPP • RECOVERY").length,
      totalDocumentsSubmitted: facilityDocumentation.reduce((sum, d) => sum + d.submittedCount, 0),
      totalDocumentsRequired: facilityDocumentation.reduce((sum, d) => sum + d.requiredCount, 0),
      portfolioCompliancePercent: Math.round(
        facilityDocumentation.reduce((sum, d) => sum + d.submittedCount, 0) /
        facilityDocumentation.reduce((sum, d) => sum + d.requiredCount, 0) * 100
      ) || 0,
    },
    facilityDocumentation,
    effectiveDate
  );
  
  // Attach executive observations to facilities
  facilities.forEach(f => {
    f.executiveObservation = executive.facilityObservations[f.slug] || "";
  });
  
  const summary: PortfolioSummary = {
    totalFacilities: facilities.length,
    facilitiesInPrePpp: facilities.filter(f => f.currentPhase === "PRE-PPP").length,
    facilitiesInPpp: facilities.filter(f => f.currentPhase === "PPP").length,
    facilitiesInPostPpp: facilities.filter(f => f.currentPhase === "POST-PPP").length,
    gateReadyCount: facilities.filter(f => f.phaseStatus === "PRE-PPP • GATE READY").length,
    recoveryCount: facilities.filter(f => f.phaseStatus === "PRE-PPP • RECOVERY").length,
    totalDocumentsSubmitted: facilityDocumentation.reduce((sum, d) => sum + d.submittedCount, 0),
    totalDocumentsRequired: facilityDocumentation.reduce((sum, d) => sum + d.requiredCount, 0),
    portfolioCompliancePercent: Math.round(
      facilityDocumentation.reduce((sum, d) => sum + d.submittedCount, 0) /
      Math.max(1, facilityDocumentation.reduce((sum, d) => sum + d.requiredCount, 0)) * 100
    ),
  };
  
  // Reconciliation assertion: portfolio summary must equal visible matrix checkmarks.
  // This guarantees that Executive summary, Portfolio counters, Facility readiness,
  // Matrix, and Percentages all use the same canonical calculation.
  const visibleMatrixSubmitted = calculatePortfolioSubmittedFromDocumentations(facilityDocumentation);
  if (visibleMatrixSubmitted !== summary.totalDocumentsSubmitted) {
    throw new Error(
      `[RECONCILIATION] Portfolio submitted (${summary.totalDocumentsSubmitted}) does not equal visible matrix checkmarks (${visibleMatrixSubmitted}). The canonical count must be used everywhere.`
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    reportingDate: dateStr,
    facilities,
    facilityDocumentation,
    summary,
    executive,
  };
}
