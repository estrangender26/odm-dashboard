import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  docFiles,
  docFolders,
  governanceFacilities,
  governanceUploads,
  smpDocuments,
  storageUploadIntents,
  type User,
} from "@db/schema";
import {
  STORAGE_BUCKET_BY_MODULE,
  STORAGE_MODULES,
  STORAGE_SIGNED_URL_TTL_SECONDS,
  STORAGE_UPLOAD_INTENT_TTL_MS,
  TUS_CHUNK_SIZE_BYTES,
  type StorageFileSource,
  type StorageModule,
} from "@contracts/storage";
import {
  MAX_UPLOAD_ERROR_MESSAGE,
  isUploadFileSizeAllowed,
} from "@contracts/upload-limits";
import { authenticateRequest } from "./kimi/auth";
import { env } from "./lib/env";
import { db } from "./queries/connection";
import { getStorageFeatureFlags, isStorageUploadEnabled } from "./storage-feature-flags";
import { deleteStoredFileRecord, getStoredFileRecord } from "./storage-files";
import { getSupabaseStorageAdmin, getSupabaseStorageConfig } from "./supabase-storage";
import { getFinalizedStorageSizeError } from "./storage-validation";

export const storageRouter = new Hono();

const sourceSchema = z.enum(["doc_files", "governance_uploads", "governance_files", "smp_documents"]);
const authorizeSchema = z.object({
  module: z.enum(STORAGE_MODULES),
  originalFilename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  fileSize: z.number().int().nonnegative(),
  target: z.record(z.string(), z.unknown()),
});
const intentSchema = z.object({ intentId: z.string().uuid() });

function sanitizeHeaderFilename(value: string) {
  return value.replace(/[\r\n"\\]/g, "_");
}

function inferMimeType(fileName: string, stored: string | null) {
  if (stored?.trim()) return stored.trim();
  const ext = fileName.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", txt: "text/plain",
    csv: "text/csv", json: "application/json", zip: "application/zip",
    doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return ext ? map[ext] || "application/octet-stream" : "application/octet-stream";
}

function decodeLegacyData(value: string, fallbackMime: string) {
  let mimeType = fallbackMime;
  let encoded = value.trim();
  if (encoded.startsWith("data:")) {
    const comma = encoded.indexOf(",");
    const header = comma >= 0 ? encoded.slice(5, comma) : "";
    const declared = header.split(";")[0];
    if (declared) mimeType = declared;
    encoded = comma >= 0 ? encoded.slice(comma + 1) : "";
  }
  return { mimeType, buffer: Buffer.from(encoded, "base64") };
}

async function requireUser(headers: Headers): Promise<User> {
  return authenticateRequest(headers);
}

function normalizedSegment(value: unknown, label: string, maxLength = 80) {
  const segment = String(value ?? "").trim().toLowerCase();
  if (!segment || segment.length > maxLength || !/^[a-z0-9_-]+$/.test(segment)) {
    throw new Error(`Invalid ${label}.`);
  }
  return segment;
}

async function validateTarget(module: StorageModule, target: Record<string, unknown>) {
  if (module === "om") {
    const folderId = Number(target.folderId);
    if (!Number.isInteger(folderId) || folderId <= 0) throw new Error("A valid target folder is required.");
    const rows = await db.select({ id: docFolders.id }).from(docFolders).where(eq(docFolders.id, folderId)).limit(1);
    if (!rows.length) throw new Error("Target folder not found.");
    return { folderId };
  }
  if (module === "smp") {
    const documentId = Number(target.documentId);
    if (!Number.isInteger(documentId) || documentId <= 0) throw new Error("A valid SMP document is required.");
    const rows = await db.select({ id: smpDocuments.id }).from(smpDocuments).where(eq(smpDocuments.id, documentId)).limit(1);
    if (!rows.length) throw new Error("SMP document not found.");
    return { documentId };
  }
  const facilitySlug = normalizedSegment(target.facilitySlug, "facility", 50);
  const milestoneId = normalizedSegment(target.milestoneId, "milestone", 30);
  const category = String(target.category ?? "other").trim().slice(0, 50) || "other";
  const tocItem = target.tocItem == null ? null : String(target.tocItem).trim().slice(0, 20) || null;
  if (facilitySlug !== "all") {
    const rows = await db.select({ slug: governanceFacilities.slug })
      .from(governanceFacilities).where(eq(governanceFacilities.slug, facilitySlug)).limit(1);
    if (!rows.length) throw new Error("Governance facility not found.");
  }
  return { facilitySlug, milestoneId, category, tocItem };
}

function buildObjectPath(module: StorageModule, target: Record<string, unknown>) {
  const id = randomUUID();
  if (module === "om") return `v1/folder-${target.folderId}/${id}`;
  if (module === "smp") return `v1/document-${target.documentId}/${id}`;
  return `v1/${target.facilitySlug}/${target.milestoneId}/${id}`;
}

function signDeletePayload(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", env.appSecret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyDeletePayload(token: string) {
  const [encoded, supplied] = token.split(".");
  if (!encoded || !supplied) return null;
  const expected = createHmac("sha256", env.appSecret).update(encoded).digest();
  const actual = Buffer.from(supplied, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  return payload && Number(payload.exp) >= Date.now() ? payload : null;
}

storageRouter.get("/config", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({ flags: getStorageFeatureFlags() });
});

storageRouter.post("/uploads/authorize", async (c) => {
  try {
    const user = await requireUser(c.req.raw.headers);
    const input = authorizeSchema.parse(await c.req.json());
    if (!isUploadFileSizeAllowed(input.fileSize)) return c.json({ error: MAX_UPLOAD_ERROR_MESSAGE }, 413);
    if (!isStorageUploadEnabled(input.module)) {
      return c.json({ storageEnabled: false, error: "Supabase Storage upload is disabled for this module." }, 409);
    }
    const target = await validateTarget(input.module, input.target);
    const expectedBucket = STORAGE_BUCKET_BY_MODULE[input.module];
    const expectedPath = buildObjectPath(input.module, target);
    const intentId = randomUUID();
    const expiresAt = new Date(Date.now() + STORAGE_UPLOAD_INTENT_TTL_MS);
    const storage = getSupabaseStorageAdmin();
    const { data, error } = await storage.storage.from(expectedBucket)
      .createSignedUploadUrl(expectedPath, { upsert: false });
    if (error || !data?.token) throw new Error(error?.message || "Unable to create signed upload authorization.");
    await db.insert(storageUploadIntents).values({
      id: intentId,
      module: input.module,
      targetContext: target,
      expectedBucket,
      expectedPath,
      originalFilename: input.originalFilename,
      expectedSize: input.fileSize,
      expectedMimeType: input.mimeType,
      requestedBy: user.id,
      status: "pending",
      expiresAt,
    });
    return c.json({
      storageEnabled: true,
      intentId,
      endpoint: `${getSupabaseStorageConfig().directStorageUrl}/storage/v1/upload/resumable`,
      token: data.token,
      bucket: expectedBucket,
      path: expectedPath,
      chunkSize: TUS_CHUNK_SIZE_BYTES,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error: any) {
    const message = error?.issues?.[0]?.message || error?.message || "Upload authorization failed.";
    const status = message.includes("authentication") || message.includes("token") ? 401 : 400;
    return c.json({ error: message }, status);
  }
});

storageRouter.post("/uploads/finalize", async (c) => {
  try {
    const user = await requireUser(c.req.raw.headers);
    const { intentId } = intentSchema.parse(await c.req.json());
    const rows = await db.select().from(storageUploadIntents).where(and(
      eq(storageUploadIntents.id, intentId),
      eq(storageUploadIntents.requestedBy, user.id),
    )).limit(1);
    const intent = rows[0];
    if (!intent) return c.json({ error: "Upload intent not found." }, 404);
    if (intent.status === "finalized") return c.json({ success: true, alreadyFinalized: true });
    if (intent.status !== "pending" || intent.expiresAt.getTime() < Date.now()) {
      return c.json({ error: "Upload intent is no longer active." }, 409);
    }
    const storage = getSupabaseStorageAdmin();
    const { data: info, error } = await storage.storage.from(intent.expectedBucket).info(intent.expectedPath);
    if (error || !info) throw new Error(error?.message || "Uploaded object was not found.");
    if (info.bucketId !== intent.expectedBucket || info.name !== intent.expectedPath) {
      await db.update(storageUploadIntents).set({ status: "cleanup_required", failureReason: "Storage object identity mismatch." })
        .where(eq(storageUploadIntents.id, intent.id));
      return c.json({ error: "Uploaded object did not match the authorization." }, 409);
    }
    const actualSize = Number(info.size);
    const sizeError = getFinalizedStorageSizeError(actualSize, intent.expectedSize);
    if (sizeError) {
      await db.update(storageUploadIntents).set({ status: "cleanup_required", failureReason: "Storage object size mismatch." })
        .where(eq(storageUploadIntents.id, intent.id));
      return c.json({ error: sizeError.error }, sizeError.status);
    }
    const expectedMime = intent.expectedMimeType.split(";", 1)[0].trim().toLowerCase();
    const actualMime = info.contentType?.split(";", 1)[0].trim().toLowerCase();
    if (actualMime && expectedMime !== "application/octet-stream" && actualMime !== expectedMime) {
      await db.update(storageUploadIntents).set({ status: "cleanup_required", failureReason: "Storage object MIME type mismatch." })
        .where(eq(storageUploadIntents.id, intent.id));
      return c.json({ error: "Uploaded object MIME type did not match the authorization." }, 409);
    }
    const target = intent.targetContext as Record<string, any>;
    const now = new Date();
    const { fileId, source } = await db.transaction(async (tx) => {
      const claimed = await tx.update(storageUploadIntents).set({ status: "finalizing" }).where(and(
        eq(storageUploadIntents.id, intent.id),
        eq(storageUploadIntents.status, "pending"),
      )).returning({ id: storageUploadIntents.id });
      if (!claimed.length) throw new Error("Upload intent is already being finalized.");

      let persistedId: number;
      let persistedSource: StorageFileSource;
      if (intent.module === "om") {
        const inserted = await tx.insert(docFiles).values({
          folderId: Number(target.folderId),
          title: intent.originalFilename.replace(/\.[^.]+$/, ""),
          fileName: intent.originalFilename,
          fileType: intent.expectedMimeType,
          fileSize: actualSize,
          fileData: null,
          fileUrl: null,
          uploadedBy: user.name,
          storageProvider: "supabase",
          storageBucket: intent.expectedBucket,
          storagePath: intent.expectedPath,
          storageSize: actualSize,
          storageMimeType: info.contentType || intent.expectedMimeType,
          storageEtag: info.etag || null,
          storageUploadedAt: now,
          updatedAt: now,
        }).returning({ id: docFiles.id });
        persistedId = inserted[0].id;
        persistedSource = "doc_files";
      } else if (intent.module === "governance") {
        const inserted = await tx.insert(governanceUploads).values({
          facilitySlug: String(target.facilitySlug),
          milestoneId: String(target.milestoneId),
          category: String(target.category || "other"),
          tocItem: target.tocItem || null,
          fileName: intent.originalFilename,
          fileUrl: "",
          uploadedBy: user.name,
          storageProvider: "supabase",
          storageBucket: intent.expectedBucket,
          storagePath: intent.expectedPath,
          storageSize: actualSize,
          storageMimeType: info.contentType || intent.expectedMimeType,
          storageEtag: info.etag || null,
          storageUploadedAt: now,
        }).returning({ id: governanceUploads.id });
        persistedId = inserted[0].id;
        persistedSource = "governance_uploads";
      } else {
        const updated = await tx.update(smpDocuments).set({
          fileData: null,
          fileType: intent.expectedMimeType,
          fileName: intent.originalFilename,
          storageProvider: "supabase",
          storageBucket: intent.expectedBucket,
          storagePath: intent.expectedPath,
          storageSize: actualSize,
          storageMimeType: info.contentType || intent.expectedMimeType,
          storageEtag: info.etag || null,
          storageUploadedAt: now,
          updatedAt: now,
        }).where(eq(smpDocuments.id, Number(target.documentId))).returning({ id: smpDocuments.id });
        if (!updated.length) throw new Error("SMP document no longer exists.");
        persistedId = updated[0].id;
        persistedSource = "smp_documents";
      }
      await tx.update(storageUploadIntents).set({ status: "finalized", finalizedAt: now, failureReason: null })
        .where(eq(storageUploadIntents.id, intent.id));
      return { fileId: persistedId, source: persistedSource };
    });
    return c.json({ success: true, fileId, source });
  } catch (error: any) {
    const message = error?.issues?.[0]?.message || error?.message || "Upload finalization failed.";
    const status = message.includes("authentication") || message.includes("token") ? 401 : 400;
    return c.json({ error: message }, status);
  }
});

storageRouter.post("/uploads/abandon", async (c) => {
  try {
    const user = await requireUser(c.req.raw.headers);
    const { intentId } = intentSchema.parse(await c.req.json());
    const updated = await db.update(storageUploadIntents).set({ status: "abandoned", abandonedAt: new Date() }).where(and(
      eq(storageUploadIntents.id, intentId), eq(storageUploadIntents.requestedBy, user.id), eq(storageUploadIntents.status, "pending"),
    )).returning({ id: storageUploadIntents.id });
    return c.json({ success: true, abandoned: updated.length > 0 });
  } catch (error: any) {
    return c.json({ error: error?.message || "Unable to abandon upload." }, 400);
  }
});

storageRouter.get("/files/:source/:id/:action", async (c) => {
  try {
    await requireUser(c.req.raw.headers);
    const source = sourceSchema.parse(c.req.param("source"));
    const id = Number(c.req.param("id"));
    const action = c.req.param("action");
    if (!Number.isInteger(id) || !["view", "download"].includes(action)) return c.json({ error: "Invalid file request." }, 400);
    const record = await getStoredFileRecord(source, id);
    if (!record) return c.json({ error: "File not found." }, 404);
    if (record.storagePath && record.storageBucket) {
      const { data, error } = await getSupabaseStorageAdmin().storage.from(record.storageBucket)
        .createSignedUrl(record.storagePath, STORAGE_SIGNED_URL_TTL_SECONDS, action === "download" ? { download: record.fileName } : undefined);
      if (error || !data?.signedUrl) throw new Error(error?.message || "Unable to sign file URL.");
      return c.redirect(data.signedUrl, 302);
    }
    if (!record.legacyData) return c.json({ error: "File content is unavailable." }, 404);
    const decoded = decodeLegacyData(record.legacyData, inferMimeType(record.fileName, record.mimeType));
    if (!decoded.buffer.length) return c.json({ error: "File content is unavailable." }, 404);
    const fileName = sanitizeHeaderFilename(record.fileName);
    const viewable = decoded.mimeType === "application/pdf" || decoded.mimeType.startsWith("image/") || decoded.mimeType.startsWith("text/");
    c.header("Content-Type", decoded.mimeType);
    c.header("Content-Disposition", `${action === "view" && viewable ? "inline" : "attachment"}; filename="${fileName}"`);
    c.header("Content-Length", String(decoded.buffer.length));
    c.header("Cache-Control", "private, max-age=120");
    c.header("X-Content-Type-Options", "nosniff");
    return c.body(decoded.buffer as any);
  } catch (error: any) {
    const status = error?.message?.includes("authentication") || error?.message?.includes("token") ? 401 : 400;
    return c.json({ error: error?.message || "Unable to access file." }, status);
  }
});

storageRouter.post("/files/delete/prepare", async (c) => {
  try {
    const user = await requireUser(c.req.raw.headers);
    const input = z.object({ source: sourceSchema, id: z.number().int().positive() }).parse(await c.req.json());
    const record = await getStoredFileRecord(input.source, input.id);
    if (!record) return c.json({ error: "File not found." }, 404);
    const expiresAt = Date.now() + 5 * 60_000;
    const confirmationToken = signDeletePayload({
      source: input.source, id: input.id, userId: user.id,
      bucket: record.storageBucket, path: record.storagePath, exp: expiresAt,
    });
    return c.json({ confirmationToken, expiresAt: new Date(expiresAt).toISOString(), fileName: record.fileName, storageBacked: Boolean(record.storagePath) });
  } catch (error: any) {
    return c.json({ error: error?.message || "Delete verification failed." }, 400);
  }
});

storageRouter.post("/files/delete/confirm", async (c) => {
  try {
    const user = await requireUser(c.req.raw.headers);
    const { confirmationToken } = z.object({ confirmationToken: z.string().min(1) }).parse(await c.req.json());
    const payload = verifyDeletePayload(confirmationToken);
    if (!payload || payload.userId !== user.id) return c.json({ error: "Delete confirmation is invalid or expired." }, 409);
    const source = sourceSchema.parse(payload.source);
    const id = Number(payload.id);
    const record = await getStoredFileRecord(source, id);
    if (!record) return c.json({ error: "File not found." }, 404);
    if (record.storageBucket !== payload.bucket || record.storagePath !== payload.path) {
      return c.json({ error: "File changed after delete verification." }, 409);
    }
    if (record.storageBucket && record.storagePath) {
      const { error } = await getSupabaseStorageAdmin().storage.from(record.storageBucket).remove([record.storagePath]);
      if (error) throw new Error(`Storage deletion failed: ${error.message}`);
    }
    await deleteStoredFileRecord(source, id);
    return c.json({ success: true, id, source });
  } catch (error: any) {
    return c.json({ error: error?.message || "Delete failed." }, 400);
  }
});
