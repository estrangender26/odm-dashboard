import { z } from "zod";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "./queries/connection";
import {
  smpDocuments,
  smpDocumentRevisions,
  smpFamilies,
  smpSections,
  smpTasks,
  smpTaskApplicability,
} from "@db/schema";
import { authedQuery, createRouter, publicQuery } from "./middleware";
import {
  buildSmpListWhere,
  type SmpListInput,
} from "./smp-logic";
import { getSupabaseStorageAdmin } from "./supabase-storage";

/**
 * SMP controlled-document repository.
 *
 * A row in `smp_documents` is one document SERIES identified by its reference
 * number (`code`). Approved PDF revisions are immutable rows in
 * `smp_document_revisions`; the file columns on the series row mirror the
 * current revision. Structured procedure data lives in `smp_sections`,
 * `smp_tasks` and `smp_task_applicability`.
 *
 * Reads are public; every mutation requires authentication. Destructive
 * operations stay behind the authenticated guard and remove Storage objects
 * through the same governed path as the rest of the application.
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
  smpFamily: z.string().trim().max(255).optional(),
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

function mapDocumentRow(row: SmpDocumentRow, extra?: {
  revisionCount?: number;
  hasCurrentRevision?: boolean;
}) {
  return {
    id: row.id,
    code: row.code,
    smpId: row.smpId,
    title: row.title,
    smpFamily: row.smpFamily,
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

      const items = rows.map((row) => {
        const summary = revisionSummary.get(row.id);
        return mapDocumentRow(row, {
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

  /* ── Single document detail (public read) ── */
  get: publicQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rows = await db.select().from(smpDocuments).where(eq(smpDocuments.id, input.id)).limit(1);
      const document = rows[0];
      if (!document) return null;

      const revisions = (await db.select().from(smpDocumentRevisions)
        .where(eq(smpDocumentRevisions.documentId, input.id))
        .orderBy(desc(smpDocumentRevisions.revisionNumber), desc(smpDocumentRevisions.id)))
        .map((r) => ({ ...r, hasFile: Boolean(r.originalFileName) }));

      const sections = await db.select().from(smpSections)
        .where(eq(smpSections.documentId, input.id))
        .orderBy(smpSections.position, smpSections.id);

      const taskRows = await db.select().from(smpTasks)
        .where(eq(smpTasks.documentId, input.id))
        .orderBy(smpTasks.category, smpTasks.displayOrder, smpTasks.id);

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

      return {
        document: mapDocumentRow(document, {
          revisionCount: revisions.length,
          hasCurrentRevision: revisions.some((r) => r.status === "current"),
        }),
        revisions,
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

  /* ── Create a document series (authenticated, metadata only) ── */
  create: authedQuery
    .input(z.object(metadataSchema))
    .mutation(async ({ input, ctx }) => {
      const existing = await db.select({ id: smpDocuments.id })
        .from(smpDocuments).where(eq(smpDocuments.code, input.code)).limit(1);
      if (existing.length > 0) {
        throw new Error(`An SMP with reference number "${input.code}" already exists.`);
      }
      const now = new Date();
      const result = await db.insert(smpDocuments).values({
        code: input.code,
        title: input.title,
        smpId: toNullableString(input.smpId),
        smpFamily: toNullableString(input.smpFamily),
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
      return mapDocumentRow(result[0]);
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
          .where(and(eq(smpDocuments.code, data.code), ne(smpDocuments.id, id)))
          .limit(1);
        if (dup.length > 0) {
          throw new Error(`An SMP with reference number "${data.code}" already exists.`);
        }
      }
      const clean: Record<string, unknown> = { updatedAt: new Date() };
      if (data.code !== undefined) clean.code = data.code;
      if (data.title !== undefined) clean.title = data.title;
      if (data.smpId !== undefined) clean.smpId = toNullableString(data.smpId);
      if (data.smpFamily !== undefined) clean.smpFamily = toNullableString(data.smpFamily);
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
      return mapDocumentRow(result[0]);
    }),

  /* ── Delete a document series (authenticated, destructive). Storage objects
     of every revision are removed through the governed Storage client. ── */
  delete: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const revisions = await db.select({
        bucket: smpDocumentRevisions.storageBucket,
        path: smpDocumentRevisions.storagePath,
      }).from(smpDocumentRevisions).where(eq(smpDocumentRevisions.documentId, input.id));

      const documentRows = await db.select({
        bucket: smpDocuments.storageBucket,
        path: smpDocuments.storagePath,
      }).from(smpDocuments).where(eq(smpDocuments.id, input.id)).limit(1);

      const objects = [
        ...revisions.map((r) => ({ bucket: r.bucket, path: r.path })),
        ...(documentRows[0] ? [{ bucket: documentRows[0].bucket, path: documentRows[0].path }] : []),
      ].filter((o) => o.bucket && o.path);

      for (const object of objects) {
        const { error } = await getSupabaseStorageAdmin().storage
          .from(object.bucket!).remove([object.path!]);
        if (error) throw new Error(`Storage deletion failed: ${error.message}`);
      }

      const deleted = await db.delete(smpDocuments).where(eq(smpDocuments.id, input.id)).returning({ id: smpDocuments.id });
      return { deleted: deleted.length > 0, id: input.id };
    }),
});
