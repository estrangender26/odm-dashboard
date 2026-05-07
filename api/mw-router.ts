import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { db } from "./queries/connection";
import { mwInspections } from "@db/schema";
import { eq, and } from "drizzle-orm";

export const mwRouter = createRouter({
  // Import Excel data — inserts each row, skips duplicates
  importExcel: publicQuery
    .input(z.object({
      rows: z.array(z.object({
        facilityId: z.string(),
        inspector: z.string(),
        category: z.string(),
        status: z.string().nullable().optional().default("pending"),
        score: z.number().nullable().optional(),
        findings: z.string().nullable().optional(),
        date: z.string().nullable().optional(),
      })),
      filename: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.user;
      let inserted = 0;
      let skipped = 0;

      for (const row of input.rows) {
        // Check for duplicate: same facility + inspector + category + date
        const existing = await db
          .select()
          .from(mwInspections)
          .where(
            and(
              eq(mwInspections.facilityId, row.facilityId),
              eq(mwInspections.inspector, row.inspector),
              eq(mwInspections.category, row.category),
              eq(mwInspections.date, row.date || "")
            )
          )
          .limit(1);

        if (existing.length > 0) {
          skipped++;
          continue; // Skip duplicate
        }

        // Insert new record
        await db.insert(mwInspections).values({
          facilityId: row.facilityId,
          inspector: row.inspector,
          category: row.category,
          status: row.status,
          score: row.score ?? null,
          findings: row.findings ?? null,
          date: row.date ?? null,
          updatedBy: user?.name ?? "system",
        });
        inserted++;
      }

      return { success: true, inserted, skipped, total: input.rows.length };
    }),

  // List all inspections from database
  listInspections: publicQuery
    .input(z.object({ facilityId: z.string().optional() }).optional())
    .mutation(async ({ input }) => {
      if (input?.facilityId) {
        return db
          .select()
          .from(mwInspections)
          .where(eq(mwInspections.facilityId, input.facilityId))
          .orderBy(mwInspections.date);
      }
      return db.select().from(mwInspections).orderBy(mwInspections.date);
    }),

  // Get single inspection
  getInspection: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const rows = await db
        .select()
        .from(mwInspections)
        .where(eq(mwInspections.id, input.id))
        .limit(1);
      return rows[0] || null;
    }),

  // Update inspection
  updateInspection: publicQuery
    .input(z.object({
      id: z.number(),
      facilityId: z.string().optional(),
      inspector: z.string().optional(),
      category: z.string().optional(),
      status: z.string().optional(),
      score: z.number().optional(),
      findings: z.string().optional(),
      date: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.user;
      const updates: any = { updatedBy: user?.name ?? "system", updatedAt: new Date() };
      if (input.facilityId !== undefined) updates.facilityId = input.facilityId;
      if (input.inspector !== undefined) updates.inspector = input.inspector;
      if (input.category !== undefined) updates.category = input.category;
      if (input.status !== undefined) updates.status = input.status;
      if (input.score !== undefined) updates.score = input.score;
      if (input.findings !== undefined) updates.findings = input.findings;
      if (input.date !== undefined) updates.date = input.date;

      await db.update(mwInspections).set(updates).where(eq(mwInspections.id, input.id));
      return { success: true };
    }),

  // Delete inspection
  deleteInspection: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(mwInspections).where(eq(mwInspections.id, input.id));
      return { success: true };
    }),

  // Reset all data
  resetAll: publicQuery
    .mutation(async () => {
      await db.delete(mwInspections);
      return { success: true };
    }),
});
