import { and, eq } from "drizzle-orm";
import {
  docFiles,
  governanceFiles,
  governanceMilestoneState,
  governanceUploads,
  smpDocuments,
} from "@db/schema";
import type { StorageFileSource } from "@contracts/storage";
import { db } from "./queries/connection";

export type StoredFileRecord = {
  source: StorageFileSource;
  id: number;
  fileName: string;
  mimeType: string | null;
  legacyData: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  storageSize: number | null;
  storageMimeType: string | null;
};

export async function getStoredFileRecord(
  source: StorageFileSource,
  id: number,
): Promise<StoredFileRecord | null> {
  if (source === "doc_files") {
    const rows = await db.select({
      id: docFiles.id,
      fileName: docFiles.fileName,
      mimeType: docFiles.fileType,
      legacyData: docFiles.fileData,
      storageBucket: docFiles.storageBucket,
      storagePath: docFiles.storagePath,
      storageSize: docFiles.storageSize,
      storageMimeType: docFiles.storageMimeType,
    }).from(docFiles).where(eq(docFiles.id, id)).limit(1);
    return rows[0] ? { source, ...rows[0] } : null;
  }
  if (source === "governance_uploads") {
    const rows = await db.select({
      id: governanceUploads.id,
      fileName: governanceUploads.fileName,
      legacyData: governanceUploads.fileUrl,
      storageBucket: governanceUploads.storageBucket,
      storagePath: governanceUploads.storagePath,
      storageSize: governanceUploads.storageSize,
      storageMimeType: governanceUploads.storageMimeType,
    }).from(governanceUploads).where(eq(governanceUploads.id, id)).limit(1);
    return rows[0] ? { source, mimeType: rows[0].storageMimeType, ...rows[0] } : null;
  }
  if (source === "governance_files") {
    const rows = await db.select({
      id: governanceFiles.id,
      fileName: governanceFiles.fileName,
      mimeType: governanceFiles.fileType,
      legacyData: governanceFiles.fileData,
      storageBucket: governanceFiles.storageBucket,
      storagePath: governanceFiles.storagePath,
      storageSize: governanceFiles.storageSize,
      storageMimeType: governanceFiles.storageMimeType,
    }).from(governanceFiles).where(eq(governanceFiles.id, id)).limit(1);
    return rows[0] ? { source, ...rows[0] } : null;
  }
  const rows = await db.select({
    id: smpDocuments.id,
    fileName: smpDocuments.fileName,
    mimeType: smpDocuments.fileType,
    legacyData: smpDocuments.fileData,
    storageBucket: smpDocuments.storageBucket,
    storagePath: smpDocuments.storagePath,
    storageSize: smpDocuments.storageSize,
    storageMimeType: smpDocuments.storageMimeType,
  }).from(smpDocuments).where(eq(smpDocuments.id, id)).limit(1);
  return rows[0]?.fileName ? { source, ...rows[0], fileName: rows[0].fileName } : null;
}

export async function deleteStoredFileRecord(source: StorageFileSource, id: number) {
  if (source === "doc_files") return db.delete(docFiles).where(eq(docFiles.id, id));
  if (source === "governance_uploads") {
    const rows = await db.select({ facilitySlug: governanceUploads.facilitySlug, milestoneId: governanceUploads.milestoneId })
      .from(governanceUploads).where(eq(governanceUploads.id, id)).limit(1);
    return db.transaction(async (tx) => {
      await tx.delete(governanceUploads).where(eq(governanceUploads.id, id));
      if (rows[0]) {
        await tx.update(governanceMilestoneState).set({ compDate: null }).where(and(
          eq(governanceMilestoneState.facilitySlug, rows[0].facilitySlug),
          eq(governanceMilestoneState.milestoneId, rows[0].milestoneId),
        ));
      }
    });
  }
  if (source === "governance_files") return db.delete(governanceFiles).where(eq(governanceFiles.id, id));
  return db.update(smpDocuments).set({
    fileData: null,
    fileType: null,
    fileName: null,
    storageProvider: null,
    storageBucket: null,
    storagePath: null,
    storageSize: null,
    storageMimeType: null,
    storageEtag: null,
    storageUploadedAt: null,
    updatedAt: new Date(),
  }).where(and(eq(smpDocuments.id, id)));
}
