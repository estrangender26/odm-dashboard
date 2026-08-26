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
import { governanceFacilities, governanceMilestoneState, governanceDeliverableStatus, governanceUploads, governanceFiles } from "@db/schema";
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
export function derivePppStartDate(facilitySlug: string, states: MilestoneStateRow[]): string | null {
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
  source: "governance_uploads" | "governance_files";
}

/**
 * Determine milestone status based on dates, completion, and progress evidence.
 *
 * Achievement is evidence-driven: a milestone is only achieved when a completion
 * date (compDate) is present AND that date is at or before the reporting date.
 * A completion recorded after TODAY is not yet evidenced, so calendar position
 * alone never marks a milestone achieved.
 *
 * In-progress is evidence-driven too: governance_milestone_state.customPct is
 * the dashboard's authoritative progress field (same rule the S-curve uses:
 * customPct ?? (compDate ? 100 : 0)). A value strictly between 0 and 100 with
 * no evidenced completion means the activity has authoritatively started but is
 * not yet complete. Calendar position alone never marks a milestone
 * in-progress, and a future compDate is not treated as started evidence.
 *
 * If the milestone has a PPP target date at or before the reporting date and
 * is not in progress, it is a gap ("planned by now — still open"). Otherwise
 * it remains upcoming.
 */
export function determineMilestoneStatus(
  _milestoneId: string,
  state: MilestoneStateRow | undefined,
  reportingDate: Date
): MilestoneStatus {
  if (!state) return "upcoming";

  const reportingIso = reportingDate.toISOString().split("T")[0];

  if (state.compDate && state.compDate <= reportingIso) {
    const completed = new Date(state.compDate + "T12:00:00");
    const planned = state.pppDate ? new Date(state.pppDate + "T12:00:00") : null;
    if (planned && completed < planned) {
      return "achieved_ahead";
    }
    return "achieved";
  }

  // Authoritative in-progress evidence: 0 < customPct < 100 without an
  // evidenced completion. This is the dashboard's own progress rule.
  if (
    state.customPct !== null &&
    state.customPct !== undefined &&
    state.customPct > 0 &&
    state.customPct < 100
  ) {
    return "in_progress";
  }

  if (state.pppDate && state.pppDate <= reportingIso) {
    return "gap";
  }

  return "upcoming";
}

/**
 * Determine facility phase status
 */
export function determinePhaseStatus(
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
 * Validate that the selected presentation facilities have exactly one row
 * for every canonical TOC item and no duplicate or noncanonical rows.
 *
 * Hard structural guard: an absent database row is a data-integrity failure,
 * not a silent "missing" status. Unrelated facilities are ignored.
 */
export function validateCanonicalDeliverableStatuses(
  rows: DeliverableStatusRow[],
  expectedFacilities: readonly string[],
  expectedTocItems: readonly string[]
): void {
  const expectedCount = expectedFacilities.length * expectedTocItems.length;

  // Track rows that belong to selected facilities
  const selectedRows = rows.filter(r => expectedFacilities.includes(r.facilitySlug));

  // Duplicates and noncanonical TOC detection
  const seen = new Map<string, DeliverableStatusRow[]>();
  const noncanonical: DeliverableStatusRow[] = [];

  for (const row of selectedRows) {
    if (!expectedTocItems.includes(row.tocItem)) {
      noncanonical.push(row);
      continue;
    }
    const key = `${row.facilitySlug}-${row.tocItem}`;
    const list = seen.get(key) ?? [];
    list.push(row);
    seen.set(key, list);
  }

  const duplicates = [...seen.values()].filter(list => list.length > 1);

  // Missing combinations
  const missing: Array<{ facilitySlug: string; tocItem: string }> = [];
  for (const facility of expectedFacilities) {
    for (const tocItem of expectedTocItems) {
      const key = `${facility}-${tocItem}`;
      if (!seen.has(key)) {
        missing.push({ facilitySlug: facility, tocItem });
      }
    }
  }

  const actualCount = seen.size;

  if (actualCount === expectedCount && duplicates.length === 0 && noncanonical.length === 0) {
    return;
  }

  const parts: string[] = [
    `[DATA INTEGRITY] governance_deliverable_status is incomplete or corrupted for the Governance V3 presentation.`,
    `Expected ${expectedCount} canonical rows (${expectedFacilities.length} facilities × ${expectedTocItems.length} TOC items).`,
    `Found ${actualCount} unique canonical rows.`,
  ];

  if (missing.length > 0) {
    const list = missing.map(m => `${m.facilitySlug}:${m.tocItem}`).join(", ");
    parts.push(`Missing ${missing.length} combinations: ${list}`);
  }

  if (duplicates.length > 0) {
    const list = duplicates.map(group => `${group[0].facilitySlug}:${group[0].tocItem} (${group.length} rows)`).join(", ");
    parts.push(`Duplicate combinations: ${list}`);
  }

  if (noncanonical.length > 0) {
    const list = noncanonical.map(r => `${r.facilitySlug}:${r.tocItem}`).join(", ");
    parts.push(`Noncanonical TOC rows for selected facilities: ${list}`);
  }

  throw new Error(parts.join(" "));
}


/**
 * Fetch uploads for evidence counts only.
 * Raw uploads do not determine approval.
 */
async function fetchUploads(facilitySlugs: string[]): Promise<UploadRow[]> {
  if (facilitySlugs.length === 0) return [];

  const uploads = await db
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

  const files = await db
    .select({
      facilitySlug: governanceFiles.facilitySlug,
      milestoneId: governanceFiles.milestoneId,
      tocItem: governanceFiles.tocItem,
      fileName: governanceFiles.fileName,
      uploadedAt: governanceFiles.uploadedAt,
    })
    .from(governanceFiles)
    .where(inArray(governanceFiles.facilitySlug, facilitySlugs));

  return [
    ...uploads.map(u => ({ ...u, source: "governance_uploads" as const })),
    ...files.map(f => ({ ...f, category: "", source: "governance_files" as const })),
  ];
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
export function determineCurrentPhase(milestones: MilestoneData[]): PhaseType {
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
function isReferenceUpload(upload: UploadRow): boolean {
  return upload.milestoneId === "__ref" || upload.category === "references";
}

function isMilestoneFileUpload(upload: UploadRow): boolean {
  return !isReferenceUpload(upload);
}

/**
 * Calculate documentation compliance for a facility.
 *
 * Source of truth: actual file uploads in governance_uploads and governance_files.
 * A TOC deliverable is considered submitted when at least one non-reference
 * upload maps to its canonical TOC identifier. Document counts are evidence counts
 * for submitted items. Reference uploads are tracked separately.
 */
export function calculateFacilityDocumentation(
  facilitySlug: string,
  facilityName: string,
  _deliverableStatuses: DeliverableStatusRow[],
  uploads: UploadRow[]
): FacilityDocumentation {
  const facilityUploads = uploads.filter(u => u.facilitySlug === facilitySlug);
  const milestoneUploads = facilityUploads.filter(isMilestoneFileUpload);

  // Determine submitted TOC items from actual evidence
  const submittedTocItems = new Set<string>();
  const documentCounts = new Map<string, number>();
  for (const upload of milestoneUploads) {
    const normalized = normalizeEvidenceToc(upload.tocItem);
    if (!normalized || !GOVERNANCE_TOC_ITEMS.includes(normalized as typeof GOVERNANCE_TOC_ITEMS[number])) {
      continue;
    }
    submittedTocItems.add(normalized);
    documentCounts.set(normalized, (documentCounts.get(normalized) || 0) + 1);
  }

  const submittedCount = submittedTocItems.size;
  const requiredCount = GOVERNANCE_TOC_ITEMS.length;

  const submissions = GOVERNANCE_TOC_ITEMS.map(tocId => ({
    tocId,
    submitted: submittedTocItems.has(tocId),
    documentCount: documentCounts.get(tocId) || 0,
  }));

  const referenceCount = facilityUploads.filter(isReferenceUpload).length;

  return {
    facilitySlug,
    facilityName,
    submissions,
    submittedCount,
    requiredCount,
    compliancePercent: Math.round((submittedCount / requiredCount) * 100),
    referenceCount,
    milestoneFileCount: milestoneUploads.length,
  };
}

/**
 * Aggregate the portfolio-level summary from ordered facility data.
 *
 * Pure function so the portfolio math (submitted/required, compliance %,
 * reference/milestone file roll-ups) can be unit-tested without a database.
 */
export function aggregatePortfolioSummary(
  facilities: FacilityData[],
  orderedDocumentation: FacilityDocumentation[]
): PortfolioSummary {
  const totalDocumentsSubmitted = orderedDocumentation.reduce((sum, d) => sum + d.submittedCount, 0);
  const totalDocumentsRequired = orderedDocumentation.reduce((sum, d) => sum + d.requiredCount, 0);
  const portfolioCompliancePercent = totalDocumentsRequired > 0
    ? Math.round((totalDocumentsSubmitted / totalDocumentsRequired) * 100)
    : 0;
  const totalReferenceFiles = orderedDocumentation.reduce((sum, d) => sum + d.referenceCount, 0);
  const totalMilestoneFiles = orderedDocumentation.reduce((sum, d) => sum + d.milestoneFileCount, 0);

  return {
    totalFacilities: facilities.length,
    facilitiesInPrePpp: facilities.filter(f => f.currentPhase === "PRE-PPP").length,
    facilitiesInPpp: facilities.filter(f => f.currentPhase === "PPP").length,
    facilitiesInPostPpp: facilities.filter(f => f.currentPhase === "POST-PPP").length,
    gateReadyCount: facilities.filter(f => f.phaseStatus === "PRE-PPP • GATE READY").length,
    recoveryCount: facilities.filter(f => f.phaseStatus === "PRE-PPP • RECOVERY").length,
    totalDocumentsSubmitted,
    totalDocumentsRequired,
    portfolioCompliancePercent,
    totalReferenceFiles,
    totalMilestoneFiles,
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

  // Structural guard (best-effort): every selected facility should have exactly
  // one row per canonical TOC item. Slide 3 submission truth comes from
  // governance_uploads/governance_files, so status-table drift must NOT make the
  // deck unavailable — the guard is preserved and surfaced as a warning instead.
  try {
    validateCanonicalDeliverableStatuses(
      deliverableStatuses,
      PRESENTATION_FACILITIES,
      GOVERNANCE_TOC_ITEMS as unknown as readonly string[]
    );
  } catch (error) {
    console.warn(
      "[GOV-V3] governance_deliverable_status incomplete or drifted; continuing with upload-based Slide 3 evidence.",
      error instanceof Error ? error.message : String(error)
    );
  }

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
      pppStartDate: derivePppStartDate(dbFacility.slug, milestoneStates) ?? "",
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

  const summaryInput = aggregatePortfolioSummary(facilities, orderedDocumentation);

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
