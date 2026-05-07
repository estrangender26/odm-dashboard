import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { db, cacheGet, cacheSet, cacheInvalidate } from "./queries/connection";
import { mwInspections } from "@db/schema";
import { eq } from "drizzle-orm";

export const mwRouter = createRouter({
  // Import Excel data — batch inserts with dedup by submissionId
  importExcel: publicQuery
    .input(z.object({
      rows: z.array(z.object({
        submissionId: z.string().nullable().optional(),
        facilityId: z.string(),
        inspector: z.string(),
        inspectionDate: z.string().nullable().optional(),
        assetTag: z.string().nullable().optional(),
        assetName: z.string().nullable().optional(),
        equipmentType: z.string().nullable().optional(),
        category: z.string(),
        task: z.string().nullable().optional(),
        capture1Label: z.string().nullable().optional(),
        capture1Response: z.string().nullable().optional(),
        escalationTrigger: z.string().nullable().optional(),
        entryNotes: z.string().nullable().optional(),
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
      let skipped = 0;

      // Build set of existing submissionIds for fast dedup
      const existingIds = new Set<string>();
      const hasSubmissionIds = input.rows.some(r => r.submissionId);
      if (hasSubmissionIds) {
        const dbRows = await db.select({ submissionId: mwInspections.submissionId })
          .from(mwInspections)
          .where(eq(mwInspections.submissionId, input.rows[0].submissionId || ""));
        // Simpler: fetch all non-null submissionIds
        const allDbIds = await db.select({ submissionId: mwInspections.submissionId })
          .from(mwInspections);
        allDbIds.forEach(r => { if (r.submissionId) existingIds.add(r.submissionId); });
      }

      // Filter out duplicates before inserting
      const newRows = input.rows.filter(row => {
        if (row.submissionId && existingIds.has(row.submissionId)) {
          skipped++;
          return false;
        }
        if (row.submissionId) existingIds.add(row.submissionId);
        return true;
      });

      // Batch insert in chunks of 500 for speed
      for (let i = 0; i < newRows.length; i += BATCH_SIZE) {
        const batch = newRows.slice(i, i + BATCH_SIZE).map(row => ({
          submissionId: row.submissionId ?? null,
          facilityId: row.facilityId,
          inspector: row.inspector,
          inspectionDate: row.inspectionDate ?? null,
          assetTag: row.assetTag ?? null,
          assetName: row.assetName ?? null,
          equipmentType: row.equipmentType ?? null,
          category: row.category,
          task: row.task ?? null,
          capture1Label: row.capture1Label ?? null,
          capture1Response: row.capture1Response ?? null,
          escalationTrigger: row.escalationTrigger ?? null,
          entryNotes: row.entryNotes ?? null,
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

      return { success: true, inserted, skipped, total: input.rows.length };
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
