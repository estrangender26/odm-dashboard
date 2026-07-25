import { z } from "zod";
import { authedQuery, createRouter, publicQuery } from "./middleware";
import { db } from "./queries/connection";
import { governanceFacilities, governanceMilestoneState, governanceUploads } from "@db/schema";
import { eq, and, sql } from "drizzle-orm";
import {
  MAX_UPLOAD_ERROR_MESSAGE,
  isBase64UploadSizeAllowed,
} from "@contracts/upload-limits";
import { getSupabaseStorageAdmin } from "./supabase-storage";

export const governanceRouter = createRouter({
  // Get all facilities
  facilities: publicQuery.query(async () => {
    // db is already imported
    return db.select().from(governanceFacilities);
  }),

  // Get milestone state for a facility
  milestoneState: publicQuery
    .input(z.object({ facilitySlug: z.string() }))
    .query(async ({ input }) => {
      console.log("[GOV API] milestoneState query for:", input.facilitySlug);
      return db
        .select()
        .from(governanceMilestoneState)
        .where(eq(governanceMilestoneState.facilitySlug, input.facilitySlug));
    }),

  // Save milestone state (with all fields)
  saveMilestone: publicQuery
    .input(
      z.object({
        facilitySlug: z.string(),
        milestoneId: z.string(),
        pppDate: z.string().nullable().optional(),
        compDate: z.string().nullable().optional(),
        customPct: z.number().nullable().optional(),
        readyStatus: z.string().nullable().optional(),
        remarks: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const user = ctx.user;
      // Validate dates — reject garbage strings like "undefined"
      function validDate(v: unknown): v is string { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); }
      const cleanPP = validDate(input.pppDate) ? input.pppDate : (input.pppDate === null ? null : undefined);
      const cleanCD = validDate(input.compDate) ? input.compDate : (input.compDate === null ? null : undefined);
      if (input.pppDate !== undefined && cleanPP === undefined && input.pppDate !== null) {
        console.warn('[GOV API] Rejected invalid pppDate:', JSON.stringify(input.pppDate));
      }
      if (input.compDate !== undefined && cleanCD === undefined && input.compDate !== null) {
        console.warn('[GOV API] Rejected invalid compDate:', JSON.stringify(input.compDate));
      }

      const updateData: Record<string, unknown> = {
        updatedBy: user?.name || null,
        updatedAt: new Date(),
      };
      if (cleanPP !== undefined) updateData.pppDate = cleanPP;
      if (cleanCD !== undefined) updateData.compDate = cleanCD;
      if (input.customPct !== undefined) updateData.customPct = input.customPct;
      if (input.readyStatus !== undefined) updateData.readyStatus = input.readyStatus;
      if (input.remarks !== undefined) updateData.remarks = input.remarks;

      // Use ON CONFLICT for upsert — prevents duplicate rows
      await db
        .insert(governanceMilestoneState)
        .values({
          facilitySlug: input.facilitySlug,
          milestoneId: input.milestoneId,
          pppDate: cleanPP !== undefined ? cleanPP : null,
          compDate: cleanCD !== undefined ? cleanCD : null,
          customPct: input.customPct || null,
          readyStatus: input.readyStatus || null,
          remarks: input.remarks || null,
          updatedBy: user?.name || null,
        })
        .onConflictDoUpdate({
          target: [governanceMilestoneState.facilitySlug, governanceMilestoneState.milestoneId],
          set: updateData,
        });

      return { success: true };
    }),

  // Get upload count per milestone
  uploadCounts: publicQuery
    .input(z.object({ facilitySlug: z.string() }))
    .query(async ({ input }) => {
      const rows = await db
        .select({
          milestoneId: governanceUploads.milestoneId,
          tocItem: governanceUploads.tocItem,
          count: sql<number>`count(*)::int`,
        })
        .from(governanceUploads)
        .where(eq(governanceUploads.facilitySlug, input.facilitySlug))
        .groupBy(governanceUploads.milestoneId, governanceUploads.tocItem);

      return rows;
    }),

  // Get uploads for a facility
  uploads: publicQuery
    .input(z.object({ facilitySlug: z.string() }))
    .query(async ({ input }) => {
      console.log("[GOV API] uploads query for facility:", input.facilitySlug);
      const rows = await db
        .select({
          id: governanceUploads.id,
          facilitySlug: governanceUploads.facilitySlug,
          milestoneId: governanceUploads.milestoneId,
          category: governanceUploads.category,
          tocItem: governanceUploads.tocItem,
          fileName: governanceUploads.fileName,
          uploadedBy: governanceUploads.uploadedBy,
          uploadedAt: governanceUploads.uploadedAt,
          storagePath: governanceUploads.storagePath,
          storageSize: governanceUploads.storageSize,
          storageMimeType: governanceUploads.storageMimeType,
          source: sql<"governance_uploads">`'governance_uploads'`,
        })
        .from(governanceUploads)
        .where(eq(governanceUploads.facilitySlug, input.facilitySlug))
        .orderBy(governanceUploads.uploadedAt);
      console.log("[GOV API] uploads returned:", rows.length, "rows");
      return rows;
    }),

  // Add upload record
  addUpload: authedQuery
    .input(
      z.object({
        facilitySlug: z.string(),
        milestoneId: z.string(),
        category: z.string(),
        tocItem: z.string().nullable().optional(),
        fileName: z.string(),
        fileUrl: z.string().refine(isBase64UploadSizeAllowed, MAX_UPLOAD_ERROR_MESSAGE),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const user = ctx.user;
      const fileSizeKb = Math.round(input.fileUrl.length / 1024);
      console.log("[GOV API] addUpload:", input.fileName, "size:", fileSizeKb + "KB", "tocItem:", input.tocItem || "null", "for facility:", input.facilitySlug, "by:", user?.name || "anonymous");

      const result = await db.insert(governanceUploads).values({
        facilitySlug: input.facilitySlug,
        milestoneId: input.milestoneId,
        category: input.category,
        tocItem: input.tocItem || null,
        fileName: input.fileName,
        fileUrl: input.fileUrl,
        uploadedBy: user?.name || null,
      }).returning({ id: governanceUploads.id });

      console.log("[GOV API] addUpload success, id:", Number(result[0].id));
      return { success: true, id: Number(result[0].id) };
    }),

  // Delete upload — ALWAYS clears completion date (even if other files remain)
  deleteUpload: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      // Find the upload to get its milestone before deleting
      const uploadRows = await db
        .select()
        .from(governanceUploads)
        .where(eq(governanceUploads.id, input.id))
        .limit(1);

      const upload = uploadRows[0];

      // Delete the upload
      if (upload?.storageBucket && upload.storagePath) {
        const { error } = await getSupabaseStorageAdmin().storage.from(upload.storageBucket).remove([upload.storagePath]);
        if (error) throw new Error(`Storage deletion failed: ${error.message}`);
      }
      await db.delete(governanceUploads).where(eq(governanceUploads.id, input.id));

      // ALWAYS clear completion date for this milestone
      if (upload) {
        await db
          .update(governanceMilestoneState)
          .set({ compDate: null })
          .where(
            and(
              eq(governanceMilestoneState.facilitySlug, upload.facilitySlug),
              eq(governanceMilestoneState.milestoneId, upload.milestoneId)
            )
          );
        console.log(`[GOV API] deleteUpload: cleared compDate for ${upload.milestoneId}`);
      }

      return { success: true };
    }),

  // Get presentation data for report generation
  presentationData: publicQuery
    .input(
      z.object({
        reportingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
    )
    .query(async ({ input }) => {
      const reportingDateStr = input.reportingDate || new Date().toISOString().split("T")[0];
      const reportingDate = new Date(`${reportingDateStr}T00:00:00Z`);
      
      // Import the data fetching function from the presentation center module
      const { fetchGovernanceDataForPresentation } = await import("@/modules/presentation-center/governanceData.server");
      
      const { facilities, summary } = await fetchGovernanceDataForPresentation(reportingDate);
      
      return {
        reportingDate: reportingDateStr,
        facilities,
        summary,
      };
    }),
});
