// Legacy Storage Migrator Core Module
// Production-safe migration functions with dependency injection

import { createHash, randomBytes } from "node:crypto";
import type { createWriteStream, createReadStream } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";

// Types
export type StorageFileSource = "doc_files" | "governance_files" | "governance_uploads" | "smp_documents";

export interface MigrationRecord {
  id: number;
  fileName: string | null;
  fileType: string | null;
  legacyDataLength: number;
  legacyDataPrefix: string | null;
}

export interface DecodedPayload {
  size: number;
  sha256: string;
  mimeType: string;
}

export interface LeaseInfo {
  owner: string;
  expiresAt: Date;
  heartbeatAt: Date;
}

export type ObjectInspectionResult =
  | { status: "missing" }
  | { status: "verified_match"; etag: string | null }
  | { status: "verified_mismatch"; reason: string }
  | { status: "indeterminate"; reason: string };

// State machine
export const VALID_STATE_TRANSITIONS: Record<string, string[]> = {
  inventoried: ["uploading", "excluded"],
  uploading: ["uploaded", "failed"],
  uploaded: ["object_verified", "failed"],
  object_verified: ["metadata_committed", "failed"],
  metadata_committed: ["app_verified", "rollback_required", "failed"],
  rollback_required: ["rolled_back", "failed"],
  rolled_back: ["uploading"],
  conflict: [],
  failed: ["uploading", "excluded"],
  app_verified: [],
  excluded: [],
};

// MIME type mapping
export const EXT_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

// Configuration
export const BASE64_CHUNK_SIZE = 64 * 1024; // Must be multiple of 4
export const LEASE_DURATION_MS = 5 * 60 * 1000;
export const HEARTBEAT_INTERVAL_MS = 30 * 1000;

// Sanitize error messages
export function sanitizeError(error: string | Error | unknown): string {
  if (!error) return "Unknown error";
  let message = error instanceof Error ? error.message : String(error);
  const patterns = [
    { pattern: /[a-zA-Z]+:\/\/[^\s"]+/g, replacement: "[REDACTED_URL]" },
    { pattern: /authorization[:\s=]+[^\s,"]+/gi, replacement: "authorization: [REDACTED]" },
    { pattern: /bearer\s+[a-zA-Z0-9_-]{10,}/gi, replacement: "[REDACTED_BEARER]" },
    { pattern: /[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, replacement: "[REDACTED_JWT]" },
    { pattern: /ey[a-zA-Z0-9_-]{20,}/g, replacement: "[REDACTED_KEY]" },
    { pattern: /data:[^;]+;base64,[a-zA-Z0-9+/]{100,}/gi, replacement: "[REDACTED_BASE64]" },
  ];
  for (const { pattern, replacement } of patterns) {
    message = message.replace(pattern, replacement);
  }
  return message.substring(0, 500).trim();
}

// Infer MIME type
export function inferMimeType(fileName: string, dataUrlMime: string | null, fileType: string | null): string {
  if (dataUrlMime && dataUrlMime !== "application/octet-stream") return dataUrlMime;
  if (fileType?.trim()) return fileType.trim();
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext && EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];
  return "application/octet-stream";
}

// Parse data URL header
export function parseDataUrlHeader(value: string): { mimeType: string | null; headerLength: number } {
  const trimmed = value.trim();
  if (!trimmed.startsWith("data:")) return { mimeType: null, headerLength: 0 };
  const comma = trimmed.indexOf(",");
  if (comma < 0) return { mimeType: null, headerLength: 0 };
  const header = trimmed.slice(5, comma);
  return { mimeType: header.split(";")[0] || null, headerLength: comma + 1 };
}

// Sanitize filename
export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_{2,}/g, "_").substring(0, 200);
}

// Generate storage path
export function generateStoragePath(source: StorageFileSource, recordId: number, filename: string): string {
  return `legacy/${source}/${recordId}/${sanitizeFilename(filename)}`;
}

// Validate state transition
export function isValidStateTransition(from: string, to: string): boolean {
  return VALID_STATE_TRANSITIONS[from]?.includes(to) ?? false;
}

// Validate APP_BASE_URL
export function validateAppBaseUrl(url: string | undefined, isExecute: boolean): { valid: boolean; error?: string } {
  if (!isExecute) return { valid: true };
  if (!url) return { valid: false, error: "APP_BASE_URL required" };
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return { valid: false, error: "localhost not allowed" };
    }
    if (parsed.protocol !== "https:") return { valid: false, error: "HTTPS required" };
    if (parsed.search || parsed.hash) return { valid: false, error: "No query/fragment allowed" };
    if (parsed.username || parsed.password) return { valid: false, error: "No credentials allowed" };
    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL" };
  }
}

// Decode Base64 in chunks to temp file
export async function decodeLegacyDataChunked(
  base64Data: string,
  tempFilePath: string,
  createWriteStream: typeof import("node:fs")["createWriteStream"],
  chunkSize: number = BASE64_CHUNK_SIZE
): Promise<{ size: number; sha256: string }> {
  const hash = createHash("sha256");
  let size = 0;
  let carryOver = "";

  const writeStream = createWriteStream(tempFilePath);

  try {
    for (let i = 0; i < base64Data.length; i += chunkSize) {
      let chunk = carryOver + base64Data.slice(i, i + chunkSize);
      const remainder = chunk.length % 4;
      
      if (remainder !== 0 && i + chunkSize < base64Data.length) {
        carryOver = chunk.slice(-remainder);
        chunk = chunk.slice(0, -remainder);
      } else {
        carryOver = "";
      }

      if (chunk.length === 0) continue;
      if (!/^[A-Za-z0-9+/]*=?=?=?$/.test(chunk)) {
        throw new Error("Invalid Base64 character");
      }

      const buffer = Buffer.from(chunk, "base64");
      await new Promise<void>((resolve, reject) => {
        writeStream.write(buffer, (err) => (err ? reject(err) : resolve()));
      });
      hash.update(buffer);
      size += buffer.length;
    }

    if (carryOver) {
      const buffer = Buffer.from(carryOver, "base64");
      await new Promise<void>((resolve, reject) => {
        writeStream.write(buffer, (err) => (err ? reject(err) : resolve()));
      });
      hash.update(buffer);
      size += buffer.length;
    }

    await new Promise<void>((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on("error", reject);
    });

    return { size, sha256: hash.digest("hex") };
  } catch (error) {
    writeStream.destroy();
    throw error;
  }
}

// Inspect existing Storage object with streaming SHA-256
export async function inspectExistingObjectStreamed(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  expectedSize: number,
  expectedSha256: string,
  expectedMimeType: string
): Promise<ObjectInspectionResult> {
  try {
    // Get metadata
    const { data: objects, error } = await supabase.storage.from(bucket).list(path.split("/").slice(0, -1).join("/"), { limit: 100 });
    if (error) return { status: "indeterminate", reason: "List failed" };

    const obj = objects?.find((o) => o.name === path.split("/").pop());
    if (!obj) return { status: "missing" };

    // Verify size
    if (obj.metadata?.size !== expectedSize) {
      return { status: "verified_mismatch", reason: "Size mismatch" };
    }

    // Verify MIME
    if (obj.metadata?.mimetype && obj.metadata.mimetype !== expectedMimeType) {
      return { status: "verified_mismatch", reason: "MIME mismatch" };
    }

    // Stream download and verify SHA-256
    const { data: downloadData, error: downloadError } = await supabase.storage.from(bucket).download(path);
    if (downloadError || !downloadData) {
      return { status: "indeterminate", reason: "Download failed" };
    }

    const reader = downloadData.stream().getReader();
    const hash = createHash("sha256");
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const buffer = Buffer.from(value);
      hash.update(buffer);
      totalBytes += buffer.length;
      if (totalBytes > expectedSize * 2) {
        return { status: "indeterminate", reason: "Size exceeded expected" };
      }
    }

    if (totalBytes !== expectedSize) {
      return { status: "verified_mismatch", reason: "Downloaded size mismatch" };
    }

    const actualSha256 = hash.digest("hex");
    if (actualSha256 !== expectedSha256) {
      return { status: "verified_mismatch", reason: "SHA-256 mismatch" };
    }

    return { status: "verified_match", etag: obj.metadata?.eTag || null };
  } catch {
    return { status: "indeterminate", reason: "Verification exception" };
  }
}

// Verify application route with streaming
export async function verifyApplicationRouteStreamed(
  baseUrl: string,
  source: StorageFileSource,
  recordId: number,
  expectedSize: number,
  expectedSha256: string,
  fetch: typeof globalThis.fetch
): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `${baseUrl}/api/storage/files/${source}/${recordId}/view`;
    const response = await fetch(url, { redirect: "manual" });

    if (response.status !== 302) {
      return { ok: false, error: `Expected 302, got ${response.status}` };
    }

    const redirectUrl = response.headers.get("location");
    if (!redirectUrl) return { ok: false, error: "No redirect URL" };

    const contentResponse = await fetch(redirectUrl);
    if (!contentResponse.ok) {
      return { ok: false, error: `Content fetch failed: ${contentResponse.status}` };
    }

    const reader = contentResponse.body?.getReader();
    if (!reader) return { ok: false, error: "No response body" };

    const hash = createHash("sha256");
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const buffer = Buffer.from(value);
      hash.update(buffer);
      totalBytes += buffer.length;
      if (totalBytes > expectedSize * 2) {
        return { ok: false, error: "Size exceeded expected" };
      }
    }

    if (totalBytes !== expectedSize) {
      return { ok: false, error: `Size mismatch: expected ${expectedSize}, got ${totalBytes}` };
    }

    const actualSha256 = hash.digest("hex");
    if (actualSha256 !== expectedSha256) {
      return { ok: false, error: "SHA-256 mismatch" };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: sanitizeError(err) };
  }
}


// ============================================================================
// WORKFLOW FUNCTIONS (exported for testing)
// ============================================================================

import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "../../api/queries/connection";
import {
  docFiles,
  governanceFiles,
  governanceUploads,
  smpDocuments,
  legacyStorageMigrationLedger,
} from "../../db/schema";

const SOURCE_TABLES = {
  doc_files: docFiles,
  governance_files: governanceFiles,
  governance_uploads: governanceUploads,
  smp_documents: smpDocuments,
} as const;

const LEGACY_COLUMNS: Record<StorageFileSource, string> = {
  doc_files: "file_data",
  governance_files: "file_data",
  governance_uploads: "file_url",
  smp_documents: "file_data",
};

/**
 * Acquires an owner-bound lease for a migration record.
 * Validates ledger identity and ensures atomic lease acquisition.
 */
export async function acquireLease(
  source: StorageFileSource,
  recordId: number,
  bucket: string,
  storagePath: string,
  expectedSize: number,
  legacySha256: string,
  mimeType: string,
  execute: boolean,
  workerId: string
): Promise<{ acquired: boolean; conflict?: string }> {
  if (!execute) return { acquired: true };

  const now = new Date();
  const leaseExpires = new Date(now.getTime() + LEASE_DURATION_MS);

  // Insert ledger row if not exists
  try {
    await db.insert(legacyStorageMigrationLedger).values({
      source, recordId, bucket, storagePath,
      originalFilename: "pending",
      expectedSize, legacySha256,
      detectedMimeType: mimeType,
      state: "inventoried",
      leaseOwner: null, leaseExpiresAt: null,
    }).onConflictDoNothing();
  } catch { }

  // Validate existing ledger matches
  const existing = await db.select({
    bucket: legacyStorageMigrationLedger.bucket,
    storagePath: legacyStorageMigrationLedger.storagePath,
    expectedSize: legacyStorageMigrationLedger.expectedSize,
    legacySha256: legacyStorageMigrationLedger.legacySha256,
  })
    .from(legacyStorageMigrationLedger)
    .where(and(
      eq(legacyStorageMigrationLedger.source, source),
      eq(legacyStorageMigrationLedger.recordId, recordId)
    ))
    .limit(1);

  if (existing[0]) {
    const e = existing[0];
    if (e.bucket !== bucket || e.storagePath !== storagePath ||
        Number(e.expectedSize) !== expectedSize || e.legacySha256 !== legacySha256) {
      return { acquired: false, conflict: "Ledger identity mismatch" };
    }
  }

  // Acquire lease atomically
  const result = await db.update(legacyStorageMigrationLedger)
    .set({
      leaseOwner: workerId,
      leaseExpiresAt: leaseExpires,
      leaseHeartbeatAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(legacyStorageMigrationLedger.source, source),
      eq(legacyStorageMigrationLedger.recordId, recordId),
      sql`(${legacyStorageMigrationLedger.leaseOwner} IS NULL OR ${legacyStorageMigrationLedger.leaseExpiresAt} < ${now})`
    ))
    .returning({ id: legacyStorageMigrationLedger.id });

  return { acquired: result.length > 0 };
}

/**
 * Renews an existing lease if owned by the worker.
 */
export async function renewLease(
  source: StorageFileSource,
  recordId: number,
  execute: boolean,
  workerId: string
): Promise<boolean> {
  if (!execute) return true;
  const now = new Date();
  const leaseExpires = new Date(now.getTime() + LEASE_DURATION_MS);
  const result = await db.update(legacyStorageMigrationLedger)
    .set({ leaseExpiresAt: leaseExpires, leaseHeartbeatAt: now, updatedAt: now })
    .where(and(
      eq(legacyStorageMigrationLedger.source, source),
      eq(legacyStorageMigrationLedger.recordId, recordId),
      eq(legacyStorageMigrationLedger.leaseOwner, workerId)
    ))
    .returning({ id: legacyStorageMigrationLedger.id });
  return result.length > 0;
}

/**
 * Releases a lease owned by the worker.
 */
export async function releaseLease(
  source: StorageFileSource,
  recordId: number,
  execute: boolean,
  workerId: string
): Promise<void> {
  if (!execute) return;
  await db.update(legacyStorageMigrationLedger)
    .set({ leaseOwner: null, leaseExpiresAt: null, leaseHeartbeatAt: null, updatedAt: new Date() })
    .where(and(
      eq(legacyStorageMigrationLedger.source, source),
      eq(legacyStorageMigrationLedger.recordId, recordId),
      eq(legacyStorageMigrationLedger.leaseOwner, workerId)
    ));
}

/**
 * Validates and performs a state transition atomically.
 */
export async function transitionState(
  source: StorageFileSource,
  recordId: number,
  expectedState: string,
  newState: string,
  execute: boolean,
  workerId: string,
  error?: string
): Promise<{ success: boolean }> {
  // Always validate transition (even in dry-run)
  if (!isValidStateTransition(expectedState, newState)) {
    throw new Error(`Invalid transition: ${expectedState} -> ${newState}`);
  }

  if (!execute) return { success: true };

  const now = new Date();
  const updates: Record<string, unknown> = { state: newState, updatedAt: now };
  if (error) updates.lastError = sanitizeError(error);
  if (newState === "object_verified") updates.objectVerifiedAt = now;
  if (newState === "metadata_committed") updates.metadataCommittedAt = now;
  if (newState === "app_verified") updates.appVerifiedAt = now;
  if (newState === "rolled_back") updates.rollbackAt = now;

  const result = await db.update(legacyStorageMigrationLedger)
    .set(updates)
    .where(and(
      eq(legacyStorageMigrationLedger.source, source),
      eq(legacyStorageMigrationLedger.recordId, recordId),
      eq(legacyStorageMigrationLedger.state, expectedState),
      eq(legacyStorageMigrationLedger.leaseOwner, workerId)
    ))
    .returning({ id: legacyStorageMigrationLedger.id });

  if (result.length === 0) {
    throw new Error(`State transition failed: expected ${expectedState}`);
  }
  return { success: true };
}

/**
 * Transactionally commits metadata with fingerprint verification.
 */
export async function transactionalMetadataCommit(
  source: StorageFileSource,
  recordId: number,
  bucket: string,
  path: string,
  size: number,
  mimeType: string,
  fingerprint: { length: number; hash: string },
  execute: boolean,
  workerId: string
): Promise<{ success: boolean; error?: string }> {
  if (!execute) return { success: true };

  try {
    await db.transaction(async (tx) => {
      const table = SOURCE_TABLES[source];
      const legacyColumn = LEGACY_COLUMNS[source];

      // Verify fingerprint still matches
      const currentFp = await tx.select({
        length: sql<number>`length(${sql.raw(legacyColumn)})`,
        hash: sql<string>`md5(${sql.raw(legacyColumn)})`,
      })
        .from(table)
        .where(eq(table.id, recordId))
        .limit(1);

      if (!currentFp[0]) throw new Error("Record not found");
      if (currentFp[0].length !== fingerprint.length) throw new Error("Fingerprint length changed");
      if (currentFp[0].hash !== fingerprint.hash) throw new Error("Fingerprint hash changed");

      // Update source metadata
      await tx.update(table)
        .set({
          storageProvider: "supabase",
          storageBucket: bucket,
          storagePath: path,
          storageSize: size,
          storageMimeType: mimeType,
          storageUploadedAt: new Date(),
        })
        .where(eq(table.id, recordId));

      // Update ledger
      const now = new Date();
      await tx.update(legacyStorageMigrationLedger)
        .set({ state: "metadata_committed", metadataCommittedAt: now, updatedAt: now })
        .where(and(
          eq(legacyStorageMigrationLedger.source, source),
          eq(legacyStorageMigrationLedger.recordId, recordId),
          eq(legacyStorageMigrationLedger.state, "object_verified"),
          eq(legacyStorageMigrationLedger.leaseOwner, workerId)
        ));
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: sanitizeError(err) };
  }
}

/**
 * Transactionally rolls back metadata changes.
 */
export async function transactionalRollback(
  source: StorageFileSource,
  recordId: number,
  bucket: string,
  path: string,
  execute: boolean
): Promise<{ success: boolean; error?: string }> {
  if (!execute) return { success: true };

  try {
    await db.transaction(async (tx) => {
      const table = SOURCE_TABLES[source];

      // Clear metadata only if matches exact bucket/path
      await tx.update(table)
        .set({
          storageProvider: null,
          storageBucket: null,
          storagePath: null,
          storageSize: null,
          storageMimeType: null,
          storageUploadedAt: null,
        })
        .where(and(
          eq(table.id, recordId),
          eq(sql`storage_bucket`, bucket),
          eq(sql`storage_path`, path)
        ));
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: sanitizeError(err) };
  }
}
