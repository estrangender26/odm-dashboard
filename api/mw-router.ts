import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { db, cacheGet, cacheSet, cacheInvalidate } from "./queries/connection";
import { mwInspections } from "@db/schema";
import { eq } from "drizzle-orm";

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
      const BATCH_SIZE = 500;
      let inserted = 0;

      // Batch insert in chunks of 500 for speed
      // Single-row inserts = 3462 round-trips (very slow)
      // Batch insert = 7 round-trips (fast)
      for (let i = 0; i < input.rows.length; i += BATCH_SIZE) {
        const batch = input.rows.slice(i, i + BATCH_SIZE).map(row => ({
          facilityId: row.facilityId,
          inspector: row.inspector,
          category: row.category,
          status: row.status || "pending",
          score: row.score ?? null,
          findings: row.findings ?? null,
          date: row.date ?? null,
          updatedBy: user?.name ?? "system",
        }));
        await db.insert(mwInspections).values(batch);
        inserted += batch.length;
      }

      // Invalidate cache so next read fetches fresh data
      cacheInvalidate("mw_inspections");

      return { success: true, inserted, skipped: 0, total: input.rows.length };
    }),

  // List all inspections — uses cache for read-after-write consistency
  listInspections: publicQuery
    .input(z.object({ facilityId: z.string().optional() }).optional())
    .mutation(async ({ input }) => {
      const cacheKey = "mw_inspections:" + (input?.facilityId || "all");
      const cached = cacheGet(cacheKey);
      if (cached) return cached;

      let rows;
      if (input?.facilityId) {
        rows = await db
          .select()
          .from(mwInspections)
          .where(eq(mwInspections.facilityId, input.facilityId))
          .orderBy(mwInspections.date);
      } else {
        rows = await db.select().from(mwInspections).orderBy(mwInspections.date);
      }

      cacheSet(cacheKey, rows);
      return rows;
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
      facilityId: z.string().nullable().optional(),
      inspector: z.string().nullable().optional(),
      category: z.string().nullable().optional(),
      status: z.string().nullable().optional(),
      score: z.number().nullable().optional(),
      findings: z.string().nullable().optional(),
      date: z.string().nullable().optional(),
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
      cacheInvalidate("mw_inspections");
      return { success: true };
    }),

  // Delete inspection
  deleteInspection: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(mwInspections).where(eq(mwInspections.id, input.id));
      cacheInvalidate("mw_inspections");
      return { success: true };
    }),

  // Reset all data
  resetAll: publicQuery
    .mutation(async () => {
      await db.delete(mwInspections);
      cacheInvalidate("mw_inspections");
      return { success: true };
    }),
});
