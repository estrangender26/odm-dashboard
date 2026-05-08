import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { db } from "./queries/connection";
import { governanceFiles } from "@db/schema";
import { eq, and, sql } from "drizzle-orm";

export const governanceFilesRouter = createRouter({
  // Upload a file
  upload: publicQuery
    .input(z.object({
      facilitySlug: z.string(),
      milestoneId: z.string(),
      tocItem: z.string().optional(),
      fileName: z.string(),
      fileType: z.string(),
      fileSize: z.number().optional(),
      fileData: z.string().max(50_000_000, "File too large — max ~37MB"),
    }))
    .mutation(async ({ input, ctx }) => {
      const dbSlug = input.facilitySlug.toLowerCase();
      const tocLabel = input.tocItem || null;
      const fileSizeMb = input.fileData ? (input.fileData.length / 1024 / 1024).toFixed(2) : 0;
      console.log("[GOV API] upload received:", input.fileName, "| facility:", dbSlug, "| ms:", input.milestoneId, "| toc:", tocLabel, "| size:", fileSizeMb + "MB", "| by:", ctx.user?.name || "anonymous");

      try {
        // Validate required fields before insert
        if (!input.fileData || input.fileData.length < 50) {
          console.error("[GOV API] upload rejected: fileData too small or empty");
          throw new Error("File data is empty or too small — file may be corrupted");
        }
        if (!dbSlug) {
          throw new Error("facilitySlug is required");
        }

        const result = await db.insert(governanceFiles).values({
          facilitySlug: dbSlug,
          milestoneId: input.milestoneId,
          tocItem: tocLabel,
          fileName: input.fileName,
          fileType: input.fileType,
          fileSize: input.fileSize || null,
          fileData: input.fileData,
          uploadedBy: ctx.user?.name || "anonymous",
        }).returning({ id: governanceFiles.id });

        console.log("[GOV API] upload saved successfully, id:", result[0].id);
        return { success: true, id: result[0].id };
      } catch (err) {
        console.error("[GOV API] upload FAILED:", {
          fileName: input.fileName,
          errorType: err.constructor?.name,
          errorMessage: err.message,
          errorCode: err.code,
          detail: err.detail,
        });
        throw new Error("Upload failed: " + (err.message || "Unknown database error"));
      }
    }),

  // List files for a milestone
  list: publicQuery
    .input(z.object({
      facilitySlug: z.string(),
      milestoneId: z.string(),
    }))
    .mutation(async ({ input }) => {
      return db
        .select({
          id: governanceFiles.id,
          facilitySlug: governanceFiles.facilitySlug,
          milestoneId: governanceFiles.milestoneId,
          tocItem: governanceFiles.tocItem,
          fileName: governanceFiles.fileName,
          fileType: governanceFiles.fileType,
          fileSize: governanceFiles.fileSize,
          uploadedBy: governanceFiles.uploadedBy,
          uploadedAt: governanceFiles.uploadedAt,
        })
        .from(governanceFiles)
        .where(
          and(
            eq(governanceFiles.facilitySlug, input.facilitySlug),
            eq(governanceFiles.milestoneId, input.milestoneId)
          )
        )
        .orderBy(governanceFiles.uploadedAt);
    }),

  // Download a file
  download: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const rows = await db
        .select()
        .from(governanceFiles)
        .where(eq(governanceFiles.id, input.id))
        .limit(1);

      if (rows.length === 0) return { success: false, error: "File not found" };

      return {
        success: true,
        fileName: rows[0].fileName,
        fileType: rows[0].fileType,
        fileData: rows[0].fileData,
      };
    }),

  // Delete a file
  delete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(governanceFiles).where(eq(governanceFiles.id, input.id));
      return { success: true };
    }),

  // List ALL files (debug — no filter)
  listAll: publicQuery
    .query(async () => {
      console.log("[GOV API] listAll called");
      const rows = await db
        .select({
          id: governanceFiles.id,
          facilitySlug: governanceFiles.facilitySlug,
          milestoneId: governanceFiles.milestoneId,
          tocItem: governanceFiles.tocItem,
          fileName: governanceFiles.fileName,
          fileType: governanceFiles.fileType,
          fileSize: governanceFiles.fileSize,
          uploadedBy: governanceFiles.uploadedBy,
          uploadedAt: governanceFiles.uploadedAt,
        })
        .from(governanceFiles)
        .orderBy(governanceFiles.uploadedAt);
      console.log("[GOV API] listAll total rows:", rows.length);
      return rows;
    }),

  // List all files for a facility (across all milestones)
  listByFacility: publicQuery
    .input(z.object({ facilitySlug: z.string() }))
    .mutation(async ({ input }) => {
      console.log("[GOV API] listByFacility input:", input.facilitySlug);
      // Case-insensitive match: DB stores lowercase like 'aglipay', frontend may send 'AGLIPAY'
      const rows = await db
        .select({
          id: governanceFiles.id,
          facilitySlug: governanceFiles.facilitySlug,
          milestoneId: governanceFiles.milestoneId,
          tocItem: governanceFiles.tocItem,
          fileName: governanceFiles.fileName,
          fileType: governanceFiles.fileType,
          fileSize: governanceFiles.fileSize,
          fileData: governanceFiles.fileData,
          uploadedBy: governanceFiles.uploadedBy,
          uploadedAt: governanceFiles.uploadedAt,
        })
        .from(governanceFiles)
        .where(sql`LOWER(${governanceFiles.facilitySlug}) = LOWER(${input.facilitySlug})`)
        .orderBy(governanceFiles.uploadedAt);
      console.log("[GOV API] listByFacility returning:", rows.length, "rows for", input.facilitySlug);
      if (rows.length > 0) {
        console.log("[GOV API] listByFacility first row:", { id: rows[0].id, milestoneId: rows[0].milestoneId, tocItem: rows[0].tocItem, fileName: rows[0].fileName, fileDataLen: rows[0].fileData?.length });
      }
      return rows;
    }),
});
