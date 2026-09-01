import {
  normalizeSmpCodeKey,
  normalizeSmpRevisionLabel,
  parseSmpRevisionNumber,
  resolveSupersessionBackfill,
  validateSmpRevisionUnique,
} from "./smp-logic";

/**
 * SMP revision finalization — pure transaction-facing logic.
 *
 * The controlled-document invariant is: after a successful finalize there is
 * EXACTLY ONE current revision per document series, the newly uploaded
 * revision is that current revision, the previous current revision is
 * superseded and points at the new one, and the new revision's
 * superseded_by_revision_id is NULL.
 *
 * The ordering below guarantees the new revision can NEVER supersede itself:
 * the previous current revision(s) are superseded BEFORE the new revision is
 * inserted, so the new revision does not exist yet when the supersede
 * predicate (`status = 'current'`) is evaluated. The backfill that points the
 * previous revision(s) at the new revision runs by captured id and
 * defensively excludes the new revision's id.
 *
 * This module is exercised by real state-semantics tests
 * (api/smp-finalize.test.ts) through a minimal in-memory transaction.
 */

export type SmpFinalizeRevisionRow = {
  id: number;
  revision: string;
  status: string;
};

export type SmpFinalizeStorage = {
  provider: string;
  bucket: string;
  path: string;
  size: number;
  mimeType: string;
  etag: string | null;
  uploadedAt: Date;
};

/** The minimal transaction surface the finalize logic needs. */
export type SmpFinalizeTx = {
  selectRevisions(documentId: number): Promise<SmpFinalizeRevisionRow[]>;
  selectDocumentByCodeKey(codeKey: string): Promise<Array<{ id: number }>>;
  insertDocument(values: Record<string, unknown>): Promise<{ id: number }>;
  /** Sets the previous current revision(s) to superseded; returns their ids. */
  supersedeCurrentRevisions(documentId: number): Promise<Array<{ id: number }>>;
  insertRevision(values: Record<string, unknown>): Promise<{ id: number }>;
  /** Sets superseded_by_revision_id = newRevisionId for the given ids. */
  backfillSupersededBy(revisionIds: number[], newRevisionId: number): Promise<void>;
  updateDocumentMirror(documentId: number, values: Record<string, unknown>): Promise<void>;
  /** Insert structured sections for the new revision. */
  insertSections?(documentId: number, revisionId: number, sections: unknown[]): Promise<void>;
  /** Insert structured tasks (and their applicability tags) for the new revision. */
  insertTasks?(documentId: number, revisionId: number, tasks: unknown[]): Promise<void>;
};

export type SmpFinalizeInput = {
  /** Present when uploading a revision to an existing document series. */
  documentId?: number;
  target: Record<string, unknown>;
  originalFilename: string;
  mimeType: string;
  size: number;
  storage: SmpFinalizeStorage;
  now: Date;
  uploaderName: string | null;
};

export async function finalizeSmpRevision(
  tx: SmpFinalizeTx,
  input: SmpFinalizeInput,
): Promise<{ documentId: number; revisionId: number }> {
  const { target, now } = input;
  const revisionLabel = normalizeSmpRevisionLabel(target.revision);
  const revisionNumber = parseSmpRevisionNumber(revisionLabel);
  const effectivityDate = target.effectivityDate ? String(target.effectivityDate).slice(0, 10) : null;

  // Resolve the document series: either an existing series or a NEW one,
  // created atomically with its first revision (a failed upload leaves no
  // orphan series behind).
  let documentId: number;
  if (input.documentId != null && Number(input.documentId) > 0) {
    documentId = Number(input.documentId);
  } else {
    const code = String(target.code ?? "").trim();
    const title = String(target.title ?? "").trim();
    if (!code || !title) throw new Error("Reference number and title are required for a new SMP.");
    const dup = await tx.selectDocumentByCodeKey(normalizeSmpCodeKey(code));
    if (dup.length > 0) {
      throw new Error(`An SMP with reference number "${code}" already exists.`);
    }
    const insertedDoc = await tx.insertDocument({
      code,
      codeKey: normalizeSmpCodeKey(code),
      title,
      smpId: target.smpId ?? null,
      smpFamily: target.smpFamily ?? null,
      familyId: target.familyId ?? null,
      assetName: target.assetName ?? null,
      assetType: target.assetType ?? null,
      equipmentType: target.equipmentType ?? null,
      facilityType: target.facilityType ?? null,
      applicability: typeof target.applicability === "string"
        ? target.applicability.split(",").map((v) => v.trim()).filter(Boolean)
        : (Array.isArray(target.applicability) && target.applicability.length
            ? target.applicability
            : null),
      criticality: target.criticality ?? null,
      documentOwner: target.documentOwner ?? null,
      preparedBy: target.preparedBy ?? null,
      reviewedBy: target.reviewedBy ?? null,
      approvedBy: target.approvedBy ?? null,
      status: "Active",
      uploadedBy: input.uploaderName,
      uploadedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    documentId = insertedDoc.id;
  }

  // Revision labels are unique per document series (no silent overwrite).
  const existingRevisions = await tx.selectRevisions(documentId);
  const duplicateError = validateSmpRevisionUnique(
    existingRevisions.map((r) => r.revision),
    revisionLabel,
  );
  if (duplicateError) throw new Error(duplicateError);

  // ORDER MATTERS: supersede the previous current revision(s) BEFORE the new
  // revision exists. The supersede predicate (`status = 'current'`) can
  // therefore never match the newly inserted revision, so the new revision
  // can never supersede itself.
  const previousCurrent = await tx.supersedeCurrentRevisions(documentId);

  // Insert the new revision as the current one, with no supersession pointer.
  const inserted = await tx.insertRevision({
    documentId,
    revision: revisionLabel,
    revisionNumber,
    status: "current",
    supersededByRevisionId: null,
    effectivityDate,
    originalFileName: input.originalFilename,
    fileType: input.mimeType,
    fileSize: input.size,
    uploadedBy: input.uploaderName,
    uploadedAt: now,
    createdAt: now,
    updatedAt: now,
    storageProvider: input.storage.provider,
    storageBucket: input.storage.bucket,
    storagePath: input.storage.path,
    storageSize: input.storage.size,
    storageMimeType: input.storage.mimeType,
    storageEtag: input.storage.etag,
    storageUploadedAt: input.storage.uploadedAt,
  });
  const revisionId = inserted.id;

  // Point the previous current revision(s) at the new revision. The ids were
  // captured BEFORE the insert, and the new revision's id is defensively
  // excluded, so the new revision can never be its own predecessor.
  const previousIds = resolveSupersessionBackfill(
    previousCurrent.map((r) => r.id),
    revisionId,
  );
  if (previousIds.length > 0) {
    await tx.backfillSupersededBy(previousIds, revisionId);
  }

  // Persist structured sections and tasks extracted from the PDF, scoped to
  // the new revision. These are optional: uploads without extraction simply
  // omit the fields.
  const sections = Array.isArray(target.sections) ? target.sections : [];
  if (sections.length > 0 && tx.insertSections) {
    await tx.insertSections(documentId, revisionId, sections);
  }
  const tasks = Array.isArray(target.tasks) ? target.tasks : [];
  if (tasks.length > 0 && tx.insertTasks) {
    await tx.insertTasks(documentId, revisionId, tasks);
  }

  // Mirror the current revision onto the document series row.
  await tx.updateDocumentMirror(documentId, {
    revision: revisionLabel,
    fileName: input.originalFilename,
    fileType: input.mimeType,
    status: "Active",
    uploadedBy: input.uploaderName,
    uploadedAt: now,
    updatedAt: now,
    storageProvider: input.storage.provider,
    storageBucket: input.storage.bucket,
    storagePath: input.storage.path,
    storageSize: input.storage.size,
    storageMimeType: input.storage.mimeType,
    storageEtag: input.storage.etag,
    storageUploadedAt: input.storage.uploadedAt,
  });

  return { documentId, revisionId };
}
