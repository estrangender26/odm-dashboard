import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { db } from "./queries/connection";
import { governanceFacilities, governanceMilestoneState, governanceUploads } from "@db/schema";
import { eq, and } from "drizzle-orm";

export const governanceRouter = createRouter({
  // Get all facilities
  facilities: publicQuery.query(async () => {
    // db is already imported
    return db.select().from(governanceFacilities);
  }),

  // Get milestone state for a facility
  milestoneState: publicQuery
    .input(z.object({ facilitySlug: z.string() }))
    .mutation(async ({ input }) => {
      // db is already imported
      return db
        .select()
        .from(governanceMilestoneState)
        .where(eq(governanceMilestoneState.facilitySlug, input.facilitySlug));
    }),

  // Save milestone state
  saveMilestone: publicQuery
    .input(
      z.object({
        facilitySlug: z.string(),
        milestoneId: z.string(),
        pppDate: z.string().nullable().optional(),
        compDate: z.string().nullable().optional(),
        customPct: z.number().nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // db is already imported
      const user = ctx.user;

      // Check if record exists
      const existing = await db
        .select()
        .from(governanceMilestoneState)
        .where(
          and(
            eq(governanceMilestoneState.facilitySlug, input.facilitySlug),
            eq(governanceMilestoneState.milestoneId, input.milestoneId)
          )
        )
        .limit(1);

      const updateData: Record<string, unknown> = {
        updatedBy: user?.name || null,
      };
      if (input.pppDate !== undefined) updateData.pppDate = input.pppDate;
      if (input.compDate !== undefined) updateData.compDate = input.compDate;
      if (input.customPct !== undefined) updateData.customPct = input.customPct;

      if (existing.length > 0) {
        await db
          .update(governanceMilestoneState)
          .set(updateData)
          .where(eq(governanceMilestoneState.id, existing[0].id));
        return { success: true, id: existing[0].id };
      } else {
        const result = await db.insert(governanceMilestoneState).values({
          facilitySlug: input.facilitySlug,
          milestoneId: input.milestoneId,
          pppDate: input.pppDate || null,
          compDate: input.compDate || null,
          customPct: input.customPct || null,
          updatedBy: user?.name || null,
        });
        return { success: true, id: Number(result[0].insertId) };
      }
    }),

  // Get uploads for a facility
  uploads: publicQuery
    .input(z.object({ facilitySlug: z.string() }))
    .mutation(async ({ input }) => {
      // db is already imported
      return db
        .select()
        .from(governanceUploads)
        .where(eq(governanceUploads.facilitySlug, input.facilitySlug))
        .orderBy(governanceUploads.uploadedAt);
    }),

  // Add upload record
  addUpload: publicQuery
    .input(
      z.object({
        facilitySlug: z.string(),
        milestoneId: z.string(),
        category: z.string(),
        tocItem: z.string().nullable().optional(),
        fileName: z.string(),
        fileUrl: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // db is already imported
      const user = ctx.user;

      const result = await db.insert(governanceUploads).values({
        facilitySlug: input.facilitySlug,
        milestoneId: input.milestoneId,
        category: input.category,
        tocItem: input.tocItem || null,
        fileName: input.fileName,
        fileUrl: input.fileUrl,
        uploadedBy: user?.name || null,
      });

      return { success: true, id: Number(result[0].insertId) };
    }),

  // Delete upload
  deleteUpload: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      // db is already imported
      await db.delete(governanceUploads).where(eq(governanceUploads.id, input.id));
      return { success: true };
    }),
});
