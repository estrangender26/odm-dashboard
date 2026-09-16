import { z } from "zod";
import { createRouter, publicQuery, authedQuery, adminQuery } from "./middleware";
import { db, cacheGet, cacheSet, cacheInvalidate } from "./queries/connection";
import { mwInspections } from "@db/schema";
import { eq, sql } from "drizzle-orm";
import {
  MwAuditOperation,
  newMwCorrelationId,
  recordMwInspectionAudit,
} from "./mw-audit";

/**
 * Operator-Driven Maintenance — authorization boundaries.
 *
 * Incident context: on 2026-09-16 production `mw_inspections` lost ~14,171
 * historical rows (16,543 -> 2,372). Every mutating ODM procedure below was a
 * `publicQuery` (no authentication) and nothing recorded the operation. The
 * boundaries are now:
 *
 *   listInspections   publicQuery  anonymous read — the dashboard must open without login
 *   getInspection     publicQuery  anonymous read
 *   importExcel       publicQuery  operator data entry — retained anonymous BY EXPLICIT
 *                                  DECISION, see docs/odm-inspection-authorization.md.
 *                                  Upsert-only: it can never delete a row.
 *   updateInspection  authedQuery  authenticated write (matches docs/rls-deployment-plan.md)
 *   deleteInspection  adminQuery   OWNER-only; destroys inspection evidence
 *   resetAll          adminQuery   OWNER-only + typed confirmation; whole-dataset deletion
 *
 * Every write path writes an `mw_inspection_audit` row in the same transaction
 * as its mutation, so a mutation that cannot be attributed cannot commit.
 */
export const MW_RESET_ALL_CONFIRMATION = "DELETE ALL ODM INSPECTIONS" as const;

export const mwRouter = createRouter({
  // Import Excel data — UPSERT: insert new, update existing on conflict
  // Unique key: (asset_tag, task, date, submitted_at)
  // Same file re-uploaded = existing rows UPDATE with new data
  //
  // Authorization: intentionally anonymous (documents/odm-inspection-authorization.md).
  // The ODM dashboard is served without any login affordance and anonymous
  // importing is the module's only data-entry path; this procedure is additive
  // (INSERT ... ON CONFLICT DO UPDATE) and cannot remove a row. Every call is
  // attributed in `mw_inspection_audit` (actorId null => anonymous) so the
  // actor of a future dataset rewrite is knowable.
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

      // UPSERT: ON CONFLICT DO UPDATE — re-uploading same file updates existing records.
      // The audit row shares this transaction: an import that cannot be attributed
      // does not commit.
      const correlationId = newMwCorrelationId();
      await db.transaction(async (tx) => {
        await tx.insert(mwInspections)
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

        await recordMwInspectionAudit(tx, {
          operation: MwAuditOperation.importExcel,
          actor: user,
          resource: "mw_inspections",
          affectedCount: dbRows.length,
          detail: { filename: input.filename ?? null },
          correlationId,
        });
      });

      // With onConflictDoUpdate, processed count assumes all rows were inserted or updated
      const processed = input.rows.length;

      // Invalidate cache so next read fetches fresh data
      cacheInvalidate("mw_inspections");

      return { success: true, processed, total: input.rows.length, correlationId };
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

  // Update inspection — authenticated write (docs/rls-deployment-plan.md:
  // anonymous read-only, authenticated write). Audited in the same transaction.
  updateInspection: authedQuery
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

      const correlationId = newMwCorrelationId();
      const affected = await db.transaction(async (tx) => {
        const updated = await tx
          .update(mwInspections)
          .set(updates)
          .where(eq(mwInspections.id, input.id))
          .returning({ id: mwInspections.id });

        await recordMwInspectionAudit(tx, {
          operation: MwAuditOperation.updateInspection,
          actor: user,
          resource: `mw_inspections#${input.id}`,
          affectedCount: updated.length,
          detail: {
            fields: Object.keys(updates).filter(
              (field) => field !== "updatedBy" && field !== "updatedAt",
            ),
          },
          correlationId,
        });

        return updated.length;
      });

      cacheInvalidate("mw_inspections");
      return { success: true, affected, correlationId };
    }),

  // Delete inspection — OWNER-only: destroying inspection evidence requires an
  // admin session, and the deletion is audited in the same transaction.
  deleteInspection: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const correlationId = newMwCorrelationId();
      const removed = await db.transaction(async (tx) => {
        const deleted = await tx
          .delete(mwInspections)
          .where(eq(mwInspections.id, input.id))
          .returning({ id: mwInspections.id });

        await recordMwInspectionAudit(tx, {
          operation: MwAuditOperation.deleteInspection,
          actor: ctx.user,
          resource: `mw_inspections#${input.id}`,
          affectedCount: deleted.length,
          correlationId,
        });

        return deleted.length;
      });

      cacheInvalidate("mw_inspections");
      return { success: true, removed, correlationId };
    }),

  // Reset all data — OWNER-only and never part of the browser workflow.
  //
  // The ODM dashboard's "Clear" control no longer calls this (it now clears only
  // the browser's cached copy). Whole-dataset deletion remains available as an
  // explicitly guarded OWNER operation: admin session + the exact confirmation
  // phrase, and the deletion and its audit row commit together. Whole-dataset
  // deletion from an ordinary operational workflow is deliberately eliminated.
  resetAll: adminQuery
    .input(z.object({ confirm: z.literal(MW_RESET_ALL_CONFIRMATION) }))
    .mutation(async ({ ctx }) => {
      const correlationId = newMwCorrelationId();
      const removed = await db.transaction(async (tx) => {
        const deleted = await tx.delete(mwInspections).returning({ id: mwInspections.id });

        await recordMwInspectionAudit(tx, {
          operation: MwAuditOperation.resetAll,
          actor: ctx.user,
          resource: "mw_inspections",
          affectedCount: deleted.length,
          detail: { confirmationPhrase: MW_RESET_ALL_CONFIRMATION },
          correlationId,
        });

        return deleted.length;
      });

      cacheInvalidate("mw_inspections");
      return { success: true, removed, correlationId };
    }),
});
