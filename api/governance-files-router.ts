import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { db } from "./queries/connection";
import { governanceFiles } from "@db/schema";
import { eq, and } from "drizzle-orm";

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
      fileData: z.string(), // base64
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await db.insert(governanceFiles).values({
        facilitySlug: input.facilitySlug,
        milestoneId: input.milestoneId,
        tocItem: input.tocItem || null,
        fileName: input.fileName,
        fileType: input.fileType,
        fileSize: input.fileSize || null,
        fileData: input.fileData,
        uploadedBy: ctx.user?.name || "anonymous",
      }).returning({ id: governanceFiles.id });

      return { success: true, id: result[0].id };
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

  // List all files for a facility (across all milestones)
  listByFacility: publicQuery
    .input(z.object({ facilitySlug: z.string() }))
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
          fileData: governanceFiles.fileData,
          uploadedBy: governanceFiles.uploadedBy,
          uploadedAt: governanceFiles.uploadedAt,
        })
        .from(governanceFiles)
        .where(eq(governanceFiles.facilitySlug, input.facilitySlug))
        .orderBy(governanceFiles.uploadedAt);
    }),
});
