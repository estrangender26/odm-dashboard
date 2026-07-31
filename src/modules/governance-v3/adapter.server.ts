/**
 * Governance V3 Data Adapter (Server-Only)
 *
 * Fetches production data from governance tables and transforms
 * into the canonical V3 presentation model.
 *
 * Readiness source: governance_deliverable_status
 * Evidence source:  governance_uploads (does not determine approval)
 *
 * @server-only
 */

import { db } from "@db/connection";
import { governanceFacilities, governanceMilestoneState, governanceDeliverableStatus, governanceUploads } from "@db/schema";
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
import { MILESTONES, GOVERNANCE_TOC_ITEMS, PRESENTATION_FACILITIES, getFacilityColor } from "./theme";
import { generateExecutiveContent } from "./executive";

/**
 * Derive PPP start date from milestone states
 */
function derivePppStartDate(facilitySlug: string, states: MilestoneStateRow[]): string | null {
  const facilityStates = states.filter(s => s.facilitySlug === facilitySlug);
  const dates = facilityStates
    .map(s => s.pppDate)
    .filter((d): d is string => d !== null && d !== undefined)
    .sort();
  return dates.length > 0 ? dates[0] : null;
}

const DB_MILESTONE_CODES = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"] as const;

interface MilestoneStateRow {
  facilitySlug: string;
  milestoneId: string;
  pppDate: string | null;
  compDate: string | null;
  customPct: number | null;
  readyStatus: string | null;
}

interface DeliverableStatusRow {
  facilitySlug: string;
  tocItem: string;
  status: string;
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

  if (state.compDate) {
    const completed = new Date(state.compDate);
    const planned = state.pppDate ? new Date(state.pppDate) : null;
    if (planned && completed < planned) {
      return "achieved_ahead";
    }
    return "achieved";
  }

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
 * Fetch the four canonical presentation facilities in fixed order.
 */
async function fetchPresentationFacilities() {
  const rows = await db
    .select({
      id: governanceFacilities.id,
      slug: governanceFacilities.slug,
      name: governanceFacilities.name,
      shortName: governanceFacilities.shortName,
    })
    .from(governanceFacilities)
    .where(inArray(governanceFacilities.slug, [...PRESENTATION_FACILITIES]));

  const bySlug = new Map(rows.map(f => [f.slug, f]));

  // Map back to canonical order
  const ordered: typeof rows = [];
  for (const slug of PRESENTATION_FACILITIES) {
    const facility = bySlug.get(slug);
    if (!facility) {
      throw new Error(
        `[PRESENTATION SCOPE] Required facility "${slug}" is missing from governance_facilities. The Governance V3 deck requires exactly: ${PRESENTATION_FACILITIES.join(", ")}.`
      );
    }
    ordered.push(facility);
  }
  return ordered;
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
 * Fetch canonical deliverable statuses for all facilities.
 * This is the presentation readiness source.
 */
async function fetchDeliverableStatuses(facilitySlugs: string[]): Promise<DeliverableStatusRow[]> {
  if (facilitySlugs.length === 0) return [];

  return await db
    .select({
      facilitySlug: governanceDeliverableStatus.facilitySlug,
      tocItem: governanceDeliverableStatus.tocItem,
      status: governanceDeliverableStatus.status,
    })
    .from(governanceDeliverableStatus)
    .where(inArray(governanceDeliverableStatus.facilitySlug, facilitySlugs));
}

/**
 * Fetch uploads for evidence counts only.
 * Raw uploads do not determine approval.
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
 * Normalize raw TOC identifiers from upload evidence to the canonical format.
 */
function normalizeEvidenceToc(rawToc: string | null): string | null {
  if (!rawToc) return null;
  let normalized = rawToc.replace(/^TOC-/i, "");
  normalized = normalized.replace(/^0+(\d)/, "$1");
  if (/^[A-Za-z]\d+$/.test(normalized)) {
    const match = normalized.match(/\d+/);
    if (match) normalized = match[0];
  }
  return normalized;
}

/**
 * Calculate documentation compliance for a facility.
 *
 * Source of truth: governance_deliverable_status.
 * governance_uploads is used only for evidence document counts.
 */
function calculateFacilityDocumentation(
  facilitySlug: string,
  facilityName: string,
  deliverableStatuses: DeliverableStatusRow[],
  uploads: UploadRow[]
): FacilityDocumentation {
  const approvedTocItems = new Set(
    deliverableStatuses
      .filter(s => s.facilitySlug === facilitySlug && s.status === "approved")
      .map(s => s.tocItem)
  );

  const facilityUploads = uploads.filter(u => u.facilitySlug === facilitySlug);

  // Evidence count per approved TOC item (uploads are evidence only)
  const documentCounts = new Map<string, number>();
  for (const upload of facilityUploads) {
    const normalized = normalizeEvidenceToc(upload.tocItem);
    if (normalized && approvedTocItems.has(normalized)) {
      documentCounts.set(normalized, (documentCounts.get(normalized) || 0) + 1);
    }
  }

  const submittedCount = approvedTocItems.size;
  const requiredCount = GOVERNANCE_TOC_ITEMS.length;

  const submissions = GOVERNANCE_TOC_ITEMS.map(tocId => ({
    tocId,
    submitted: approvedTocItems.has(tocId),
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
 * Fetch and transform governance data for V3 presentation
 */
export async function fetchGovernanceV3Data(
  reportingDate?: Date
): Promise<GovernanceV3Presentation> {
  const effectiveDate = reportingDate || new Date();
  const dateStr = effectiveDate.toISOString().split("T")[0];

  const dbFacilities = await fetchPresentationFacilities();
  const facilitySlugs = dbFacilities.map(f => f.slug);

  const milestoneStates = await fetchMilestoneStates(facilitySlugs);
  const deliverableStatuses = await fetchDeliverableStatuses(facilitySlugs);
  const uploads = await fetchUploads(facilitySlugs);

  // Build facility data in canonical order
  const facilityBySlug = new Map(dbFacilities.map(f => [f.slug, f]));
  const facilities: FacilityData[] = PRESENTATION_FACILITIES.map((slug, index) => {
    const dbFacility = facilityBySlug.get(slug);
    if (!dbFacility) {
      throw new Error(`[DATA INTEGRITY] Facility "${slug}" missing from database results.`);
    }
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

  // Calculate documentation for each facility from canonical status table
  const orderedDocumentation = PRESENTATION_FACILITIES.map((slug) => {
    const dbFacility = facilityBySlug.get(slug);
    if (!dbFacility) {
      throw new Error(`[DATA INTEGRITY] Facility "${slug}" missing from database results.`);
    }
    const doc = calculateFacilityDocumentation(dbFacility.slug, dbFacility.name, deliverableStatuses, uploads);
    return doc;
  });

  const totalDocumentsSubmitted = orderedDocumentation.reduce((sum, d) => sum + d.submittedCount, 0);
  const totalDocumentsRequired = orderedDocumentation.reduce((sum, d) => sum + d.requiredCount, 0);
  const portfolioCompliancePercent = totalDocumentsRequired > 0
    ? Math.round((totalDocumentsSubmitted / totalDocumentsRequired) * 100)
    : 0;

  const summaryInput: PortfolioSummary = {
    totalFacilities: facilities.length,
    facilitiesInPrePpp: facilities.filter(f => f.currentPhase === "PRE-PPP").length,
    facilitiesInPpp: facilities.filter(f => f.currentPhase === "PPP").length,
    facilitiesInPostPpp: facilities.filter(f => f.currentPhase === "POST-PPP").length,
    gateReadyCount: facilities.filter(f => f.phaseStatus === "PRE-PPP • GATE READY").length,
    recoveryCount: facilities.filter(f => f.phaseStatus === "PRE-PPP • RECOVERY").length,
    totalDocumentsSubmitted,
    totalDocumentsRequired,
    portfolioCompliancePercent,
  };

  const executive = generateExecutiveContent(facilities, summaryInput, orderedDocumentation, effectiveDate);

  facilities.forEach(f => {
    f.executiveObservation = executive.facilityObservations[f.slug] || "";
  });

  const summary: PortfolioSummary = { ...summaryInput };

  // Structural reconciliation: portfolio approved must equal visible matrix approved checkmarks.
  const visibleMatrixApproved = orderedDocumentation.reduce(
    (sum, d) => sum + d.submissions.filter(s => s.submitted).length,
    0
  );
  if (visibleMatrixApproved !== summary.totalDocumentsSubmitted) {
    throw new Error(
      `[RECONCILIATION] Portfolio approved (${summary.totalDocumentsSubmitted}) does not equal visible matrix checkmarks (${visibleMatrixApproved}). The status-based count must be used everywhere.`
    );
  }

  // Structural guards: every selected facility must have exactly 14 canonical cells.
  for (const doc of orderedDocumentation) {
    if (doc.submissions.length !== GOVERNANCE_TOC_ITEMS.length) {
      throw new Error(
        `[DATA INTEGRITY] Facility ${doc.facilitySlug} has ${doc.submissions.length} TOC cells instead of ${GOVERNANCE_TOC_ITEMS.length}.`
      );
    }
  }

  // Required count must be facilities × 14.
  const expectedRequired = facilities.length * GOVERNANCE_TOC_ITEMS.length;
  if (summary.totalDocumentsRequired !== expectedRequired) {
    throw new Error(
      `[DATA INTEGRITY] Required count (${summary.totalDocumentsRequired}) does not match ${facilities.length} facilities × ${GOVERNANCE_TOC_ITEMS.length} deliverables (${expectedRequired}).`
    );
  }

  // Align returned facility arrays to canonical order
  const facilitiesBySlug = new Map(facilities.map(f => [f.slug, f]));
  const orderedFacilities = PRESENTATION_FACILITIES.map(slug => {
    const facility = facilitiesBySlug.get(slug);
    if (!facility) {
      throw new Error(`[DATA INTEGRITY] Facility "${slug}" missing from generated facilities.`);
    }
    return facility;
  });

  return {
    generatedAt: new Date().toISOString(),
    reportingDate: dateStr,
    facilities: orderedFacilities,
    facilityDocumentation: orderedDocumentation,
    summary,
    executive,
  };
}
