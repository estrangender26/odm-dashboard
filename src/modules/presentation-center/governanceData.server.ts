/**
 * O&M Manual Governance Data Fetching (Server-Only)
 * 
 * This module provides database access functions for the Governance
 * presentation generator. This file should only be imported by server-side code.
 * 
 * Query Structure (optimized to avoid N+1):
 * - 1 query for all facilities
 * - 1 query for all milestone states (filtered by facility slugs)
 * - 1 query for all uploads (filtered by facility slugs)
 * - In-memory grouping by facility
 * 
 * @server-only
 */

import { db } from "@db/connection";
import { governanceFacilities, governanceMilestoneState, governanceUploads } from "@db/schema";
import { inArray } from "drizzle-orm";
import {
  isPersistedMilestoneComplete,
  calculateMilestoneEffectiveProgress,
  calculateAggregateProgress,
  calculateFacilityCurrentProgress,

  GOVERNANCE_MILESTONES,
  getFacilityColor,

  determineRagStatus,

  type GovernanceFacility,
  type GovernanceMilestone,
  type FacilityGovernanceData,
  type GovernancePortfolioSummary,
  type DocumentSummary,
} from "./governanceTypes";

import {
  GOVERNANCE_TOC_DELIVERABLES,
  calculateDeliverableSubmissionSummary,
  type DeliverableUpload,
  type MilestoneTocMapping,
} from "@/modules/governance/governanceConfig";

/**
 * Canonical milestone-to-TOC mappings
 * Source: GovernanceDashboard.tsx MSD
 * Maps each milestone to its associated TOC deliverable IDs
 */
const GOVERNANCE_MILESTONE_TOC_MAPPINGS: MilestoneTocMapping[] = [
  { milestoneId: "M1", tocIds: ["1", "1A", "1C", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"] },
  { milestoneId: "M2", tocIds: ["1", "1A", "1C", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"] },
  { milestoneId: "M3", tocIds: ["1", "1A", "1C", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"] },
  { milestoneId: "M4", tocIds: ["1", "1A", "1C", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"] },
  { milestoneId: "M5", tocIds: ["1", "1A", "1C", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"] },
  { milestoneId: "M6", tocIds: ["1", "1A", "1C", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"] },
  { milestoneId: "M7", tocIds: ["1", "1A", "1C", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"] },
  { milestoneId: "M8", tocIds: ["1", "1A", "1C", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"] },
  { milestoneId: "M9", tocIds: ["1", "1A", "1C", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"] },
];

// Type definitions for DB results
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
  storageMimeType: string | null;
  storageSize: number | null;
  uploadedAt: Date | null;
  storageBucket: string | null;
}
/**
 * Fetch facilities from database - not hard-coded
 */
async function fetchFacilitiesFromDB(): Promise<GovernanceFacility[]> {
  const dbFacilities = await db.select({
    slug: governanceFacilities.slug,
    name: governanceFacilities.name,
    shortName: governanceFacilities.shortName,
  }).from(governanceFacilities);
  
  return dbFacilities.map((f, index) => ({
    slug: f.slug,
    name: f.name,
    shortName: f.shortName || f.name,
    color: getFacilityColor(index),
  }));
}

/**
 * Fetch governance data from database with reporting date cutoff
 * Uses optimized batch queries to avoid N+1 pattern
 * 
 * Query pattern:
 * - 1 query for all facilities
 * - 1 query for all milestone states (filtered by facility slugs)
 * - 1 query for all uploads (filtered by facility slugs)
 * - In-memory grouping by facility
 * 
 * @param reportingDate - The date for which to report (entire day is included)
 */
export async function fetchGovernanceDataForPresentation(
  reportingDate: Date
): Promise<{
  facilities: FacilityGovernanceData[];
  summary: GovernancePortfolioSummary;
}> {
  // Fetch all facilities in one query
  // Reporting date is metadata only - does not affect calculations
  void reportingDate;
  const dbFacilities = await fetchFacilitiesFromDB();
  
  if (dbFacilities.length === 0) {
    return {
      facilities: [],
      summary: {
        totalFacilities: 0,
        totalDocuments: 0,
        documentsByFacility: {},
        milestonesComplete: 0,
        milestonesTotal: 0,
      },
    };
  }
  
  const facilitySlugs = dbFacilities.map(f => f.slug);
  
  // Fetch all milestone states for all facilities in one query
  const allMilestoneStates: MilestoneStateRow[] = await db
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
  
  // Group milestone states by facility
  const milestoneStatesByFacility = new Map<string, MilestoneStateRow[]>();
  for (const state of allMilestoneStates) {
    const existing = milestoneStatesByFacility.get(state.facilitySlug) || [];
    existing.push(state);
    milestoneStatesByFacility.set(state.facilitySlug, existing);
  }
  
  // Fetch all uploads for all facilities in one query
  const allUploads: UploadRow[] = await db
    .select({
      facilitySlug: governanceUploads.facilitySlug,
      milestoneId: governanceUploads.milestoneId,
      tocItem: governanceUploads.tocItem,
      category: governanceUploads.category,
      fileName: governanceUploads.fileName,
      storageMimeType: governanceUploads.storageMimeType,
      storageSize: governanceUploads.storageSize,
      uploadedAt: governanceUploads.uploadedAt,
      storageBucket: governanceUploads.storageBucket,
    })
    .from(governanceUploads)
    .where(inArray(governanceUploads.facilitySlug, facilitySlugs));
  

  // Group uploads by facility (no reporting date filter - all persisted uploads included)
  const uploadsByFacility = new Map<string, UploadRow[]>();
  for (const upload of allUploads) {
    const existing = uploadsByFacility.get(upload.facilitySlug) || [];
    existing.push(upload);
    uploadsByFacility.set(upload.facilitySlug, existing);
  }
  
  const facilities: FacilityGovernanceData[] = [];
  
  for (const facilityInfo of dbFacilities) {
    const milestoneStates = milestoneStatesByFacility.get(facilityInfo.slug) || [];
    const uploads = uploadsByFacility.get(facilityInfo.slug) || [];
    
    // Get PPP start date from first milestone with pppDate
    const pppStartDate = milestoneStates.find(s => s.pppDate)?.pppDate || null;
    
    // Build milestones from canonical definitions + persisted DB state
    const milestones: GovernanceMilestone[] = GOVERNANCE_MILESTONES.map(m => {
      const state = milestoneStates.find((s: MilestoneStateRow) => s.milestoneId === m.id);
      
      // Use persisted completion date - milestone is complete if compDate exists (no reporting date cutoff)
      const completionDate = state?.compDate || null;
      const isCompleted = isPersistedMilestoneComplete(completionDate);
      
      // Effective progress uses Dashboard rule: customPct ?? (compDate ? 100 : 0)
      const effectiveProgress = calculateMilestoneEffectiveProgress(state?.customPct, state?.compDate);
      const actualProgress = effectiveProgress;
      
      return {
        milestoneId: m.id,
        milestoneName: m.label,
        weight: m.weight,
        plannedDate: state?.pppDate ?? null,
        actualDate: isCompleted ? completionDate : null,
        actualProgress,
        status: state?.readyStatus ?? null,
      };
    });
    
    // Categorize by workflow status using category field
    const byCategory: Record<string, number> = {};
    uploads.forEach((u: UploadRow) => {
      byCategory[u.category] = (byCategory[u.category] || 0) + 1;
    });
    
    // Build milestone progress map for aggregate calculation
    const milestoneProgress: Record<string, number> = {};
    for (const m of milestones) {
      milestoneProgress[m.milestoneId] = m.actualProgress ?? 0;
    }
    
    // Use shared aggregate helper for actual progress (includes partial completion)
    const actual = calculateAggregateProgress(milestoneProgress);
    
    // Planned progress: milestones whose planned date has passed (using current date)
    const today = new Date();
    const totalWeight = GOVERNANCE_MILESTONES.reduce((sum, m) => sum + m.weight, 0);
    const plannedWeight = milestones
      .filter(m => m.plannedDate && new Date(m.plannedDate) <= today)
      .reduce((sum, m) => sum + m.weight, 0);
    const hasBaseline = milestones.some(m => m.plannedDate);
    const planned = hasBaseline && totalWeight > 0 ? Math.round((plannedWeight / totalWeight) * 100) : null;
    const variance = planned !== null ? actual - planned : null;
    const progress = { actual, planned, variance, hasBaseline };
    
    // Workflow status is not tracked in schema - use approximations
    const docSummary: DocumentSummary = {
      totalDocuments: uploads.length,
      byCategory,
      byWorkflowStatus: {
        accepted: 0,
        pendingReview: uploads.length,
        returned: 0,
        missing: 0,
        overdue: 0,
        rejected: 0,
      },
      latestSubmissionDate: uploads.length > 0 
        ? [...uploads]
            .sort((a: UploadRow, b: UploadRow) => 
              (b.uploadedAt?.getTime() || 0) - (a.uploadedAt?.getTime() || 0)
            )[0].uploadedAt?.toISOString() || null
        : null,
    };
    
    // Calculate deliverable submission summary using shared helper
    // This counts deliverables (TOC items) with at least one upload,
    // not raw file uploads
    const deliverableUploads: DeliverableUpload[] = uploads.map(u => ({
      tocItem: u.tocItem,
      milestoneId: u.milestoneId,
      fileName: u.fileName,
    }));
    
    docSummary.deliverableSummary = calculateDeliverableSubmissionSummary(
      GOVERNANCE_TOC_DELIVERABLES,
      deliverableUploads,
      GOVERNANCE_MILESTONE_TOC_MAPPINGS
    );
    
    // Completed count uses persisted completion rule based on compDate
    const milestoneCompDates: Record<string, string | null | undefined> = {};
    for (const state of milestoneStates) {
      milestoneCompDates[state.milestoneId] = state.compDate;
    }
    const currentProgress = calculateFacilityCurrentProgress(milestoneCompDates);
    const completedMilestones = currentProgress.completed;
    
    facilities.push({
      facility: facilityInfo,
      pppStartDate,
      milestones,
      documentSummary: docSummary,
      governanceMetrics: {
        governanceReadiness: progress.actual,
        riskLevel: progress.variance && progress.variance < -20 ? "High" : 
                   progress.variance && progress.variance < -10 ? "Medium" : "Low",
        milestones: { complete: completedMilestones, total: milestones.length },
        progress,
        ragStatus: determineRagStatus(progress.variance, GOVERNANCE_MILESTONES.length - uploads.length, false, progress.hasBaseline),
      },
    });
  }
  
  const totalDocs = facilities.reduce((sum, f) => sum + f.documentSummary.totalDocuments, 0);
  const totalCompletedMilestones = facilities.reduce((sum, f) => sum + f.governanceMetrics.milestones.complete, 0);
  
  const summary: GovernancePortfolioSummary = {
    totalFacilities: facilities.length,
    totalDocuments: totalDocs,
    documentsByFacility: Object.fromEntries(
      facilities.map(f => [f.facility.slug, f.documentSummary.totalDocuments])
    ),
    milestonesComplete: totalCompletedMilestones,
    milestonesTotal: facilities.length * GOVERNANCE_MILESTONES.length,
  };
  
  return { facilities, summary };
}

/**
 * @deprecated Use fetchGovernanceDataForPresentation with reporting date
 * Fetch governance data from database (legacy, uses current date)
 */
export async function fetchGovernanceDataFromDB(): Promise<{
  facilities: FacilityGovernanceData[];
  summary: GovernancePortfolioSummary;
}> {
  return fetchGovernanceDataForPresentation(new Date());
}
