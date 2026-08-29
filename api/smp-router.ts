import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "./queries/connection";
import {
  smpDocuments,
  smpDocumentRevisions,
  smpDeletionRecords,
  smpFamilies,
  smpSections,
  smpTasks,
  smpTaskApplicability,
} from "@db/schema";
import { authedQuery, createRouter, publicQuery } from "./middleware";
import {
  buildSmpListWhere,
  normalizeSmpCodeKey,
  resolveSmpDetailRevision,
  type SmpListInput,
} from "./smp-logic";
import { getSupabaseStorageAdmin } from "./supabase-storage";

/**
 * SMP controlled-document repository.
 *
 * A row in `smp_documents` is one document SERIES identified by its reference
 * number (`code`); the database enforces uniqueness on the normalized
 * reference-number identity (migration 0034 `code_key` + unique index).
 * Approved PDF revisions are immutable rows in `smp_document_revisions`; the
 * file columns on the series row mirror the current revision. Structured
 * procedure data (`smp_sections`, `smp_tasks`) is scoped to a specific
 * revision so content from different revisions can never mix.
 *
 * Reads are public; every mutation requires authentication. Destructive
 * deletion is staged through the `smp_deletion_records` ledger (prepare +
 * confirm) so failures are explicit and retryable — no partial silent
 * success, and no claim of atomicity across Postgres and Supabase Storage.
 */

const applicabilitySchema = z.array(z.string().trim().min(1).max(100)).max(50).optional();

const listInputSchema = z.object({
  search: z.string().max(200).optional(),
  family: z.string().max(255).optional(),
  equipmentType: z.string().max(255).optional(),
  facilityType: z.string().max(255).optional(),
  criticality: z.string().max(20).optional(),
  revision: z.string().max(50).optional(),
  status: z.string().max(50).optional(),
});

const metadataSchema = {
  code: z.string().trim().min(1).max(50),
  title: z.string().trim().min(1).max(500),
  smpId: z.string().trim().max(100).optional(),
  // Literal family text as documented in the approved PDF (preserved verbatim).
  smpFamily: z.string().trim().max(255).optional(),
  // Optional canonical family catalog relation (separate from literal text).
  familyId: z.number().int().positive().optional(),
  assetName: z.string().trim().max(255).optional(),
  assetType: z.string().trim().max(255).optional(),
  equipmentType: z.string().trim().max(255).optional(),
  facilityType: z.string().trim().max(255).optional(),
  applicability: applicabilitySchema,
  criticality: z.string().trim().max(20).optional(),
  documentOwner: z.string().trim().max(255).optional(),
  preparedBy: z.string().trim().max(255).optional(),
  reviewedBy: z.string().trim().max(255).optional(),
  approvedBy: z.string().trim().max(255).optional(),
};

type SmpDocumentRow = typeof smpDocuments.$inferSelect;

function toNullableString(value: string | undefined | null): string | null {
  return value?.trim() ? value.trim() : null;
}

function toNullableStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type FamilyNameMap = Map<number, string>;

async function loadFamilyNameMap(): Promise<FamilyNameMap> {
  const rows = await db.select({ id: smpFamilies.id, name: smpFamilies.name }).from(smpFamilies);
  return new Map(rows.map((r) => [r.id, r.name]));
}

function mapDocumentRow(row: SmpDocumentRow, familyNames: FamilyNameMap, extra?: {
  revisionCount?: number;
  hasCurrentRevision?: boolean;
}) {
  return {
    id: row.id,
    code: row.code,
    smpId: row.smpId,
    title: row.title,
    // Literal family text as documented (never rewritten).
    smpFamily: row.smpFamily,
    familyId: row.familyId,
    canonicalFamily: row.familyId != null ? (familyNames.get(row.familyId) ?? null) : null,
    assetName: row.assetName,
    assetType: row.assetType,
    equipmentType: row.equipmentType,
    facilityType: row.facilityType,
    applicability: toNullableStringArray(row.applicability),
    criticality: row.criticality,
    documentOwner: row.documentOwner,
    preparedBy: row.preparedBy,
    reviewedBy: row.reviewedBy,
    approvedBy: row.approvedBy,
    effectivityDate: row.effectivityDate,
    revision: row.revision,
    status: row.status,
    system: row.system,
    dateIssued: row.dateIssued,
    nextReview: row.nextReview,
    responsibleParty: row.responsibleParty,
    hasFile: Boolean(row.fileName),
    fileName: row.fileName,
    fileType: row.fileType,
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revisionCount: extra?.revisionCount ?? 0,
    hasCurrentRevision: extra?.hasCurrentRevision ?? false,
  };
}

export const smpRouter = createRouter({
  /* ── Library list with search + filters (public read) ── */
  list: publicQuery
    .input(listInputSchema)
    .query(async ({ input }) => {
      const where = buildSmpListWhere(input as SmpListInput);
      const rows = await db.select().from(smpDocuments)
        .where(where)
        .orderBy(smpDocuments.code);

      const ids = rows.map((r) => r.id);
      const revisionSummary: Map<number, { count: number; hasCurrent: boolean }> = new Map();
      if (ids.length > 0) {
        const grouped = await db.select({
          documentId: smpDocumentRevisions.documentId,
          count: smpDocumentRevisions.id,
          status: smpDocumentRevisions.status,
        }).from(smpDocumentRevisions).where(inArray(smpDocumentRevisions.documentId, ids));
        for (const g of grouped) {
          const prev = revisionSummary.get(g.documentId) ?? { count: 0, hasCurrent: false };
          prev.count += 1;
          if (g.status === "current") prev.hasCurrent = true;
          revisionSummary.set(g.documentId, prev);
        }
      }

      const familyNames = await loadFamilyNameMap();
      const items = rows.map((row) => {
        const summary = revisionSummary.get(row.id);
        return mapDocumentRow(row, familyNames, {
          revisionCount: summary?.count ?? 0,
          hasCurrentRevision: summary?.hasCurrent ?? false,
        });
      });

      // Data-driven filter options derived from ALL persisted records (not the
      // filtered subset) so filters remain usable while one is active.
      const filterRows = await db.select({
        family: smpDocuments.smpFamily,
        equipmentType: smpDocuments.equipmentType,
        facilityType: smpDocuments.facilityType,
        criticality: smpDocuments.criticality,
        revision: smpDocuments.revision,
        status: smpDocuments.status,
      }).from(smpDocuments);

      const unique = (values: Array<string | null>) => [...new Set(values.filter((v): v is string => Boolean(v)))].sort();
      const filters = {
        families: unique(filterRows.map((r) => r.family)),
        equipmentTypes: unique(filterRows.map((r) => r.equipmentType)),
        facilityTypes: unique(filterRows.map((r) => r.facilityType)),
        criticalities: unique(filterRows.map((r) => r.criticality)),
        revisions: unique(filterRows.map((r) => r.revision)),
        // Controlled-document lifecycle states plus any legacy persisted values.
        statuses: [...new Set(["current", "superseded", ...unique(filterRows.map((r) => r.status))])],
      };

      return { items, count: items.length, total: filterRows.length, filters };
    }),

  /* ── Single document detail (public read).
     Structured procedure data is scoped to one revision: `revisionId` selects
     a specific revision; otherwise the CURRENT revision (or the latest when
     no revision is current) is used. Legacy documents without revisions have
     no structured data. ── */
  get: publicQuery
    .input(z.object({
      id: z.number().int().positive(),
      revisionId: z.number().int().positive().optional(),
    }))
    .query(async ({ input }) => {
      const rows = await db.select().from(smpDocuments).where(eq(smpDocuments.id, input.id)).limit(1);
      const document = rows[0];
      if (!document) return null;

      const revisions = (await db.select().from(smpDocumentRevisions)
        .where(eq(smpDocumentRevisions.documentId, input.id))
        .orderBy(desc(smpDocumentRevisions.revisionNumber), desc(smpDocumentRevisions.id)))
        .map((r) => ({ ...r, hasFile: Boolean(r.originalFileName) }));

      const resolvedRevision = resolveSmpDetailRevision(revisions, input.revisionId);
      if (input.revisionId != null && !resolvedRevision) {
        throw new Error(`Revision ${input.revisionId} does not belong to this SMP document.`);
      }
      const resolvedRevisionId = resolvedRevision?.id ?? null;

      // Structured content is ALWAYS scoped to the resolved revision so data
      // from different revisions can never mix.
      const sections = resolvedRevision
        ? await db.select().from(smpSections)
            .where(and(
              eq(smpSections.documentId, input.id),
              eq(smpSections.revisionId, resolvedRevision.id),
            ))
            .orderBy(smpSections.position, smpSections.id)
        : [];

      const taskRows = resolvedRevision
        ? await db.select().from(smpTasks)
            .where(and(
              eq(smpTasks.documentId, input.id),
              eq(smpTasks.revisionId, resolvedRevision.id),
            ))
            .orderBy(smpTasks.category, smpTasks.displayOrder, smpTasks.id)
        : [];

      const tagMap: Map<number, string[]> = new Map();
      if (taskRows.length > 0) {
        const tags = await db.select().from(smpTaskApplicability)
          .where(inArray(smpTaskApplicability.taskId, taskRows.map((t) => t.id)));
        for (const tag of tags) {
          const list = tagMap.get(tag.taskId) ?? [];
          list.push(tag.tag);
          tagMap.set(tag.taskId, list);
        }
      }

      const tasks = taskRows.map((task) => ({
        ...task,
        applicabilityTags: tagMap.get(task.id) ?? [],
        fieldCaptureData: task.fieldCaptureData == null ? null : task.fieldCaptureData,
      }));

      const familyNames = await loadFamilyNameMap();
      return {
        document: mapDocumentRow(document, familyNames, {
          revisionCount: revisions.length,
          hasCurrentRevision: revisions.some((r) => r.status === "current"),
        }),
        revisions,
        resolvedRevisionId,
        sections,
        tasks,
      };
    }),

  /* ── Data-driven family catalog (public read) ── */
  families: publicQuery.query(async () => {
    const rows = await db.select().from(smpFamilies).orderBy(smpFamilies.sortOrder, smpFamilies.name);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      typicalEquipment: toNullableStringArray(row.typicalEquipment),
      suggestedTags: toNullableStringArray(row.suggestedTags),
      sortOrder: row.sortOrder,
    }));
  }),

  /* ── Create a document series (authenticated, metadata only).
     The new-document UPLOAD flow does NOT use this procedure: it creates the
     series atomically with its first revision at storage finalize, so a
     failed upload leaves no orphan series behind. ── */
  create: authedQuery
    .input(z.object(metadataSchema))
    .mutation(async ({ input, ctx }) => {
      const existing = await db.select({ id: smpDocuments.id })
        .from(smpDocuments)
        .where(eq(smpDocuments.codeKey, normalizeSmpCodeKey(input.code)))
        .limit(1);
      if (existing.length > 0) {
        throw new Error(`An SMP with reference number "${input.code}" already exists.`);
      }
      const now = new Date();
      const result = await db.insert(smpDocuments).values({
        code: input.code,
        codeKey: normalizeSmpCodeKey(input.code),
        title: input.title,
        smpId: toNullableString(input.smpId),
        smpFamily: toNullableString(input.smpFamily),
        familyId: input.familyId ?? null,
        assetName: toNullableString(input.assetName),
        assetType: toNullableString(input.assetType),
        equipmentType: toNullableString(input.equipmentType),
        facilityType: toNullableString(input.facilityType),
        applicability: input.applicability?.length ? input.applicability : null,
        criticality: toNullableString(input.criticality),
        documentOwner: toNullableString(input.documentOwner),
        preparedBy: toNullableString(input.preparedBy),
        reviewedBy: toNullableString(input.reviewedBy),
        approvedBy: toNullableString(input.approvedBy),
        status: "Active",
        uploadedBy: ctx.user?.name ?? null,
        uploadedAt: now,
        createdAt: now,
        updatedAt: now,
      }).returning();
      const familyNames = await loadFamilyNameMap();
      return mapDocumentRow(result[0], familyNames);
    }),

  /* ── Update metadata (authenticated). File/revision/status changes are NOT
     accepted here: they happen only through governed revision uploads. ── */
  update: authedQuery
    .input(z.object({
      id: z.number().int().positive(),
      code: metadataSchema.code.optional(),
      title: metadataSchema.title.optional(),
      smpId: metadataSchema.smpId,
      smpFamily: metadataSchema.smpFamily,
      familyId: metadataSchema.familyId,
      assetName: metadataSchema.assetName,
      assetType: metadataSchema.assetType,
      equipmentType: metadataSchema.equipmentType,
      facilityType: metadataSchema.facilityType,
      applicability: metadataSchema.applicability,
      criticality: metadataSchema.criticality,
      documentOwner: metadataSchema.documentOwner,
      preparedBy: metadataSchema.preparedBy,
      reviewedBy: metadataSchema.reviewedBy,
      approvedBy: metadataSchema.approvedBy,
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      if (data.code !== undefined) {
        const dup = await db.select({ id: smpDocuments.id })
          .from(smpDocuments)
          .where(and(
            eq(smpDocuments.codeKey, normalizeSmpCodeKey(data.code)),
            ne(smpDocuments.id, id),
          ))
          .limit(1);
        if (dup.length > 0) {
          throw new Error(`An SMP with reference number "${data.code}" already exists.`);
        }
      }
      const clean: Record<string, unknown> = { updatedAt: new Date() };
      if (data.code !== undefined) {
        clean.code = data.code;
        clean.codeKey = normalizeSmpCodeKey(data.code);
      }
      if (data.title !== undefined) clean.title = data.title;
      if (data.smpId !== undefined) clean.smpId = toNullableString(data.smpId);
      if (data.smpFamily !== undefined) clean.smpFamily = toNullableString(data.smpFamily);
      if (data.familyId !== undefined) clean.familyId = data.familyId ?? null;
      if (data.assetName !== undefined) clean.assetName = toNullableString(data.assetName);
      if (data.assetType !== undefined) clean.assetType = toNullableString(data.assetType);
      if (data.equipmentType !== undefined) clean.equipmentType = toNullableString(data.equipmentType);
      if (data.facilityType !== undefined) clean.facilityType = toNullableString(data.facilityType);
      if (data.applicability !== undefined) clean.applicability = data.applicability?.length ? data.applicability : null;
      if (data.criticality !== undefined) clean.criticality = toNullableString(data.criticality);
      if (data.documentOwner !== undefined) clean.documentOwner = toNullableString(data.documentOwner);
      if (data.preparedBy !== undefined) clean.preparedBy = toNullableString(data.preparedBy);
      if (data.reviewedBy !== undefined) clean.reviewedBy = toNullableString(data.reviewedBy);
      if (data.approvedBy !== undefined) clean.approvedBy = toNullableString(data.approvedBy);
      const result = await db.update(smpDocuments).set(clean).where(eq(smpDocuments.id, id)).returning();
      if (!result[0]) throw new Error("SMP document not found.");
      const familyNames = await loadFamilyNameMap();
      return mapDocumentRow(result[0], familyNames);
    }),

  /* ── Staged deletion (authenticated, destructive).
     deletePrepare snapshots the storage objects and records a ledger row;
     deleteConfirm removes the remaining objects and then deletes the DB row.
     Storage removal and the DB delete are deliberately NOT atomic; the ledger
     records progress so a failure is explicit and the operation can be
     retried idempotently. ── */
  deletePrepare: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const documentRows = await db.select({
        id: smpDocuments.id,
        bucket: smpDocuments.storageBucket,
        path: smpDocuments.storagePath,
      }).from(smpDocuments).where(eq(smpDocuments.id, input.id)).limit(1);
      const document = documentRows[0];
      if (!document) throw new Error("SMP document not found.");

      const revisions = await db.select({
        bucket: smpDocumentRevisions.storageBucket,
        path: smpDocumentRevisions.storagePath,
      }).from(smpDocumentRevisions).where(eq(smpDocumentRevisions.documentId, input.id));

      const objects = [
        ...revisions.map((r) => ({ bucket: r.bucket, path: r.path })),
        ...(document.bucket && document.path ? [{ bucket: document.bucket, path: document.path }] : []),
      ].filter((o): o is { bucket: string; path: string } => Boolean(o.bucket && o.path));

      const deletionToken = randomUUID();
      const now = new Date();
      const inserted = await db.insert(smpDeletionRecords).values({
        documentId: input.id,
        tokenHash: hashToken(deletionToken),
        status: "pending",
        objects,
        removedObjects: [],
        createdBy: ctx.user?.name ?? null,
        createdAt: now,
        updatedAt: now,
      }).returning({ id: smpDeletionRecords.id });

      return {
        recordId: inserted[0].id,
        deletionToken,
        objectCount: objects.length,
      };
    }),

  deleteConfirm: authedQuery
    .input(z.object({
      recordId: z.number().int().positive(),
      deletionToken: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const records = await db.select().from(smpDeletionRecords)
        .where(and(
          eq(smpDeletionRecords.id, input.recordId),
          eq(smpDeletionRecords.tokenHash, hashToken(input.deletionToken)),
        ))
        .limit(1);
      const record = records[0];
      if (!record) throw new Error("Deletion record not found or token invalid.");

      // Idempotent: a completed deletion is a success, never re-executed.
      if (record.status === "completed") {
        return { status: "completed", documentId: record.documentId };
      }

      const objects = Array.isArray(record.objects)
        ? (record.objects as Array<{ bucket: string; path: string }>)
        : [];
      const removed = new Set(Array.isArray(record.removedObjects) ? (record.removedObjects as string[]) : []);
      const now = new Date();

      // Phase 1: remove the storage objects that have not been removed yet.
      for (const object of objects) {
        if (!object.bucket || !object.path || removed.has(object.path)) continue;
        const { error } = await getSupabaseStorageAdmin().storage
          .from(object.bucket)
          .remove([object.path]);
        if (error) {
          await db.update(smpDeletionRecords).set({
            status: "storage_failed",
            removedObjects: [...removed],
            failureReason: `Storage deletion failed for ${object.path}: ${error.message}`,
            updatedAt: now,
          }).where(eq(smpDeletionRecords.id, record.id));
          throw new Error(
            `Storage deletion failed for ${object.path}: ${error.message}. ` +
            "No database rows were removed. Retry the same token to continue.",
          );
        }
        removed.add(object.path);
      }

      // Phase 2: all storage objects removed — delete the document series row
      // (cascades revisions, sections, tasks, applicability tags).
      try {
        const deleted = await db.delete(smpDocuments)
          .where(eq(smpDocuments.id, record.documentId))
          .returning({ id: smpDocuments.id });
        if (!deleted.length) throw new Error("SMP document was not found during deletion.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Database deletion failed.";
        await db.update(smpDeletionRecords).set({
          status: "db_failed",
          removedObjects: [...removed],
          failureReason: `Storage objects removed, but database deletion failed: ${message}`,
          updatedAt: now,
        }).where(eq(smpDeletionRecords.id, record.id));
        throw new Error(
          `Storage objects were removed, but the database deletion failed: ${message}. ` +
          "Retry the same token to complete the deletion.",
        );
      }

      await db.update(smpDeletionRecords).set({
        status: "completed",
        removedObjects: [...removed],
        completedAt: now,
        updatedAt: now,
      }).where(eq(smpDeletionRecords.id, record.id));

      return { status: "completed", documentId: record.documentId };
    }),
});
