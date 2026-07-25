/**
 * O&M Manual Governance Data Fetching (Server-Only)
 * 
 * This module provides database access functions for the Governance
 * presentation generator. This file should only be imported by server-side code.
 * 
 * @server-only
 */

import { db } from "@db/connection";
import { governanceFacilities, governanceMilestoneState, governanceUploads } from "@db/schema";
import { eq } from "drizzle-orm";
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
  milestoneId: string;
  pppDate: string | null;
  compDate: string | null;
  customPct: number | null;
  readyStatus: string | null;
}

interface UploadRow {
  milestoneId: string;
  category: string;
  fileName: string;
  storageMimeType: string | null;
  storageSize: number | null;
  uploadedAt: Date | null;
  storageBucket: string | null;
}

/**
 * Check if a date string is on or before the cutoff date
 * Uses UTC comparison to ensure timezone-safe behavior
 */
function isOnOrBefore(dateStr: string | null, cutoffDate: Date): boolean {
  if (!dateStr) return false;
  const date = new Date(`${dateStr}T00:00:00Z`);
  return date.getTime() <= cutoffDate.getTime();
}

/**
 * Check if a date/time is on or before the cutoff date
 */
function isDateOnOrBefore(date: Date | null, cutoffDate: Date): boolean {
  if (!date) return false;
  return date.getTime() <= cutoffDate.getTime();
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
 * Uses real facility data from governance_facilities table
 * 
 * @param reportingDate - The cutoff date for filtering uploads and completions
 */
export async function fetchGovernanceDataForPresentation(
  reportingDate: Date
): Promise<{
  facilities: FacilityGovernanceData[];
  summary: GovernancePortfolioSummary;
}> {
  // Fetch facilities from database - NOT hard-coded
  const dbFacilities = await fetchFacilitiesFromDB();
  
  const facilities: FacilityGovernanceData[] = [];
  
  for (const facilityInfo of dbFacilities) {
    // Fetch milestone state for this facility
    const milestoneStates: MilestoneStateRow[] = await db
      .select({
        milestoneId: governanceMilestoneState.milestoneId,
        pppDate: governanceMilestoneState.pppDate,
        compDate: governanceMilestoneState.compDate,
        customPct: governanceMilestoneState.customPct,
        readyStatus: governanceMilestoneState.readyStatus,
      })
      .from(governanceMilestoneState)
      .where(eq(governanceMilestoneState.facilitySlug, facilityInfo.slug));
    
    // Get PPP start date from first milestone with pppDate
    const pppStartDate = milestoneStates.find(s => s.pppDate)?.pppDate || null;
    
    // Build milestones from canonical definitions + DB state
    // Filter completions by reporting date
    const milestones: GovernanceMilestone[] = GOVERNANCE_MILESTONES.map(m => {
      const state = milestoneStates.find((s: MilestoneStateRow) => s.milestoneId === m.id);
      
      // Filter completion dates by reporting date cutoff
      const completionDate = state?.compDate || null;
      const isCompleted = completionDate && isOnOrBefore(completionDate, reportingDate);
      
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
    
    // Fetch uploads for document summary - filter by reporting date
    const allUploads: UploadRow[] = await db
      .select({
        milestoneId: governanceUploads.milestoneId,
        category: governanceUploads.category,
        fileName: governanceUploads.fileName,
        storageMimeType: governanceUploads.storageMimeType,
        storageSize: governanceUploads.storageSize,
        uploadedAt: governanceUploads.uploadedAt,
        storageBucket: governanceUploads.storageBucket,
      })
      .from(governanceUploads)
      .where(eq(governanceUploads.facilitySlug, facilityInfo.slug));
    
    // Filter uploads by reporting date cutoff
    const uploads = allUploads.filter(u => isDateOnOrBefore(u.uploadedAt, reportingDate));
    
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
