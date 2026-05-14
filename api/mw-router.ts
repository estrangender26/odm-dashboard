import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { db, cacheGet, cacheSet, cacheInvalidate } from "./queries/connection";
import { mwInspections } from "@db/schema";
import { eq, sql } from "drizzle-orm";

export const mwRouter = createRouter({
  // Import Excel data — UPSERT: insert new, update existing on conflict
  // Unique key: (asset_tag, task, date, submitted_at)
  // Same file re-uploaded = existing rows UPDATE with new data
  importExcel: publicQuery
    .input(z.object({
      rows: z.array(z.object({
        submissionId: z.any().optional(),
        facilityId: z.any(),
        inspector: z.any(),
        inspectionDate: z.any().optional(),
        assetTag: z.any().optional(),
        assetName: z.any().optional(),
        equipmentType: z.any().optional(),
        category: z.any(),
        task: z.any().optional(),
        capture1Label: z.any().optional(),
        capture1Response: z.any().optional(),
        escalationTrigger: z.any().optional(),
        entryNotes: z.any().optional(),
        status: z.any().optional(),
        score: z.any().optional(),
        findings: z.any().optional(),
        date: z.any().optional(),
        submittedAt: z.any().optional(),
        frequency: z.any().optional(),
      })),
      filename: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.user;

      // Map input rows to DB rows
      const dbRows = input.rows.map(row => ({
        submissionId: row.submissionId ? String(row.submissionId) : null,
        facilityId: String(row.facilityId || ''),
        inspector: String(row.inspector || ''),
        inspectionDate: row.inspectionDate ? String(row.inspectionDate) : null,
        assetTag: row.assetTag ? String(row.assetTag) : null,
        assetName: row.assetName ? String(row.assetName) : null,
        equipmentType: row.equipmentType ? String(row.equipmentType) : null,
        category: String(row.category || ''),
        task: row.task ? String(row.task) : null,
        capture1Label: row.capture1Label ? String(row.capture1Label) : null,
        capture1Response: row.capture1Response ? String(row.capture1Response) : null,
        escalationTrigger: row.escalationTrigger ? String(row.escalationTrigger) : null,
        entryNotes: row.entryNotes ? String(row.entryNotes) : null,
        status: row.status ? String(row.status) : "pending",
        score: row.score != null ? Number(row.score) || null : null,
        findings: row.findings ? String(row.findings) : null,
        date: row.date ? String(row.date) : null,
        submittedAt: row.submittedAt ? String(row.submittedAt) : null,
        frequency: row.frequency ? String(row.frequency) : null,
        updatedBy: user?.name ?? "system",
      }));

      // UPSERT: ON CONFLICT DO UPDATE — re-uploading same file updates existing records
      const result = await db.insert(mwInspections)
        .values(dbRows)
        .onConflictDoUpdate({
          target: [mwInspections.assetTag, mwInspections.task, mwInspections.date, mwInspections.submittedAt],
          set: {
            submissionId: sql`EXCLUDED.${sql.raw(mwInspections.submissionId.name)}`,
            facilityId: sql`EXCLUDED.${sql.raw(mwInspections.facilityId.name)}`,
            inspector: sql`EXCLUDED.${sql.raw(mwInspections.inspector.name)}`,
            inspectionDate: sql`EXCLUDED.${sql.raw(mwInspections.inspectionDate.name)}`,
            assetName: sql`EXCLUDED.${sql.raw(mwInspections.assetName.name)}`,
            equipmentType: sql`EXCLUDED.${sql.raw(mwInspections.equipmentType.name)}`,
            category: sql`EXCLUDED.${sql.raw(mwInspections.category.name)}`,
            task: sql`EXCLUDED.${sql.raw(mwInspections.task.name)}`,
            capture1Label: sql`EXCLUDED.${sql.raw(mwInspections.capture1Label.name)}`,
            capture1Response: sql`EXCLUDED.${sql.raw(mwInspections.capture1Response.name)}`,
            escalationTrigger: sql`EXCLUDED.${sql.raw(mwInspections.escalationTrigger.name)}`,
            entryNotes: sql`EXCLUDED.${sql.raw(mwInspections.entryNotes.name)}`,
            status: sql`EXCLUDED.${sql.raw(mwInspections.status.name)}`,
            score: sql`EXCLUDED.${sql.raw(mwInspections.score.name)}`,
            findings: sql`EXCLUDED.${sql.raw(mwInspections.findings.name)}`,
            frequency: sql`EXCLUDED.${sql.raw(mwInspections.frequency.name)}`,
            updatedBy: user?.name ?? "system",
            updatedAt: new Date(),
          }
        });

      // With onConflictDoUpdate, result.length includes both inserted and updated
      const processed = input.rows.length;

      // Invalidate cache so next read fetches fresh data
      cacheInvalidate("mw_inspections");

      return { success: true, processed, total: input.rows.length };
    }),

  // List all inspections — uses cache for read-after-write consistency
  listInspections: publicQuery
    .input(z.object({ facilityId: z.string().optional() }).optional())
    .query(async ({ input }) => {
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
      facilityId: z.any().optional(),
      inspector: z.any().optional(),
      category: z.any().optional(),
      status: z.any().optional(),
      score: z.any().optional(),
      findings: z.any().optional(),
      date: z.any().optional(),
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
