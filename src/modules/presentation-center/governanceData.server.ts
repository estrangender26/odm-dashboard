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
 * Fetch governance data from database
 * Uses real facility data from governance_facilities table
 */
export async function fetchGovernanceDataFromDB(): Promise<{
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
    const milestones: GovernanceMilestone[] = GOVERNANCE_MILESTONES.map(m => {
      const state = milestoneStates.find((s: MilestoneStateRow) => s.milestoneId === m.id);
      
      return {
        milestoneId: m.id,
        milestoneName: m.label,
        weight: m.weight,
        plannedDate: state?.pppDate ?? null,
        actualDate: state?.compDate ?? null,
        actualProgress: state?.customPct ?? (state?.compDate ? 100 : null),
        status: state?.readyStatus ?? null,
      };
    });
    
    // Fetch uploads for document summary
    const uploads: UploadRow[] = await db
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
    
    // Categorize by workflow status using category field
    const byCategory: Record<string, number> = {};
    uploads.forEach((u: UploadRow) => {
      byCategory[u.category] = (byCategory[u.category] || 0) + 1;
    });
    
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
    
    facilities.push({
      facility: facilityInfo,
      pppStartDate,
      milestones,
      documentSummary: docSummary,
      governanceMetrics: {
        governanceReadiness: 0,
        riskLevel: "Low",
        milestones: { complete: 0, total: milestones.length },
        progress: { planned: null, actual: 0, variance: null },
        ragStatus: "gray",
      },
    });
  }
  
  const totalDocs = facilities.reduce((sum, f) => sum + f.documentSummary.totalDocuments, 0);
  
  const summary: GovernancePortfolioSummary = {
    totalFacilities: facilities.length,
    totalDocuments: totalDocs,
    documentsByFacility: Object.fromEntries(
      facilities.map(f => [f.facility.slug, f.documentSummary.totalDocuments])
    ),
    milestonesComplete: 0,
    milestonesTotal: facilities.length * GOVERNANCE_MILESTONES.length,
  };
  
  return { facilities, summary };
}
