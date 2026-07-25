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
  GOVERNANCE_MILESTONES,
  getFacilityColor,
  calculateFacilityProgress,
  determineRagStatus,
  type GovernanceFacility,
  type GovernanceMilestone,
  type FacilityGovernanceData,
  type GovernancePortfolioSummary,
  type DocumentSummary,
} from "./governanceTypes";

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
  category: string;
  fileName: string;
  storageMimeType: string | null;
  storageSize: number | null;
  uploadedAt: Date | null;
  storageBucket: string | null;
}

/**
 * Get the cutoff datetime for filtering.
 * The cutoff is the start of the NEXT day after the reporting date.
 * This ensures the ENTIRE reporting date is included.
 * 
 * Example:
 * - Reporting date: 2026-07-25
 * - Cutoff: 2026-07-26T00:00:00Z
 * - Included: 2026-07-25T00:00:00Z to 2026-07-25T23:59:59.999Z
 * - Excluded: 2026-07-26T00:00:00Z and later
 */
function getCutoffDate(reportingDate: Date): Date {
  // reportingDate is expected to be YYYY-MM-DDT00:00:00Z
  // We want to include the entire day, so we add 1 day
  const cutoff = new Date(reportingDate);
  cutoff.setUTCDate(cutoff.getUTCDate() + 1);
  cutoff.setUTCHours(0, 0, 0, 0);
  return cutoff;
}

/**
 * Check if a date string (YYYY-MM-DD) is strictly before the cutoff.
 * The entire reporting date is included (up to but not including next day).
 */
function isDateBeforeCutoff(dateStr: string | null, reportingDate: Date): boolean {
  if (!dateStr) return false;
  const cutoff = getCutoffDate(reportingDate);
  const date = new Date(`${dateStr}T00:00:00Z`);
  return date.getTime() < cutoff.getTime();
}

/**
 * Check if a datetime is strictly before the cutoff.
 * The entire reporting date is included (up to but not including next day).
 */
function isDateTimeBeforeCutoff(date: Date | null, reportingDate: Date): boolean {
  if (!date) return false;
  const cutoff = getCutoffDate(reportingDate);
  return date.getTime() < cutoff.getTime();
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
      category: governanceUploads.category,
      fileName: governanceUploads.fileName,
      storageMimeType: governanceUploads.storageMimeType,
      storageSize: governanceUploads.storageSize,
      uploadedAt: governanceUploads.uploadedAt,
      storageBucket: governanceUploads.storageBucket,
    })
    .from(governanceUploads)
    .where(inArray(governanceUploads.facilitySlug, facilitySlugs));
  
  // Filter uploads by reporting date cutoff and group by facility
  const uploadsByFacility = new Map<string, UploadRow[]>();
  for (const upload of allUploads) {
    // Only include uploads BEFORE the cutoff (entire reporting date is included)
    if (!isDateTimeBeforeCutoff(upload.uploadedAt, reportingDate)) {
      continue;
    }
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
    
    // Build milestones from canonical definitions + DB state
    // Filter completions by reporting date cutoff
    const milestones: GovernanceMilestone[] = GOVERNANCE_MILESTONES.map(m => {
      const state = milestoneStates.find((s: MilestoneStateRow) => s.milestoneId === m.id);
      
      // Filter completion dates by reporting date cutoff
      const completionDate = state?.compDate || null;
      const isCompleted = completionDate && isDateBeforeCutoff(completionDate, reportingDate);
      
      // Custom progress is only valid if set and completion is on/before cutoff
      const actualProgress = state?.customPct != null && isCompleted
        ? state.customPct 
        : (isCompleted ? 100 : null);
      
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
    
    // Calculate facility progress with reporting date
    const progress = calculateFacilityProgress(milestones, reportingDate);
    
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
    
    const completedMilestones = milestones.filter(m => m.actualProgress === 100).length;
    
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
