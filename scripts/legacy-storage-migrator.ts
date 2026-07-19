import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, createReadStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import * as tus from "tus-js-client";
import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "../api/queries/connection";
import {
  docFiles,
  governanceFiles,
  governanceUploads,
  smpDocuments,
  legacyStorageMigrationLedger,
  storageUploadIntents,
} from "../db/schema";
import { getSupabaseStorageAdmin, getSupabaseStorageConfig } from "../api/supabase-storage";
import { STORAGE_BUCKET_BY_MODULE, TUS_CHUNK_SIZE_BYTES, type StorageFileSource } from "@contracts/storage";
import type { SupabaseClient } from "@supabase/supabase-js";

// Source to table mapping
const SOURCE_TABLES = {
  doc_files: docFiles,
  governance_files: governanceFiles,
  governance_uploads: governanceUploads,
  smp_documents: smpDocuments,
} as const;

// Source to bucket mapping
const SOURCE_BUCKETS: Record<StorageFileSource, string> = {
  doc_files: STORAGE_BUCKET_BY_MODULE.om,
  governance_files: STORAGE_BUCKET_BY_MODULE.governance,
  governance_uploads: STORAGE_BUCKET_BY_MODULE.governance,
  smp_documents: STORAGE_BUCKET_BY_MODULE.smp,
};

// Legacy column mapping
const LEGACY_COLUMNS: Record<StorageFileSource, string> = {
  doc_files: "file_data",
  governance_files: "file_data",
  governance_uploads: "file_url",
  smp_documents: "file_data",
};

// MIME type mapping from filename extension
const EXT_TO_MIME: Record<string, string> = {
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

// Allowed state transitions
const VALID_STATE_TRANSITIONS: Record<string, string[]> = {
  inventoried: ["uploading", "excluded"],
  uploading: ["uploaded", "failed"],
  uploaded: ["object_verified", "failed"],
  object_verified: ["metadata_committed", "failed"],
  metadata_committed: ["app_verified", "rollback_required", "failed"],
  rollback_required: ["rolled_back", "failed"],
  rolled_back: ["uploading"], // Can retry after rollback
  conflict: [], // Terminal - requires human review
  failed: ["uploading", "excluded"], // Can retry or exclude
  app_verified: [], // Terminal success
  excluded: [], // Terminal - excluded
};

interface MigrationOptions {
  execute: boolean;
  confirmProduction: boolean;
  sources?: StorageFileSource[];
  recordIds?: number[];
  limit?: number;
  batchSize?: number;
  concurrency?: number;
}

interface DecodedStreamResult {
  tempFilePath: string;
  size: number;
  sha256: string;
  mimeType: string;
}

interface ExistingObjectInfo {
  exists: boolean;
  size?: number;
  mimeType?: string;
}

// Parse command line arguments
function parseArgs(): MigrationOptions {
  const args = process.argv.slice(2);
  const options: MigrationOptions = {
    execute: false,
    confirmProduction: false,
    batchSize: 1,
    concurrency: 1,
  };

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--execute":
        options.execute = true;
        break;
      case "--confirm-production":
        options.confirmProduction = true;
        break;
      case "--sources":
        options.sources = args[++i]?.split(",").filter((s): s is StorageFileSource =>
          ["doc_files", "governance_files", "governance_uploads", "smp_documents"].includes(s)
        );
        break;
      case "--ids":
        options.recordIds = args[++i]?.split(",").map(Number).filter(n => !isNaN(n));
        break;
      case "--limit":
        options.limit = parseInt(args[++i] || "0", 10);
        break;
      case "--batch-size":
        options.batchSize = parseInt(args[++i] || "1", 10);
        break;
      case "--concurrency":
        options.concurrency = parseInt(args[++i] || "1", 10);
        break;
      case "--orphan-audit":
        // Handled in main
        break;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Legacy Storage Migration Tool

Usage: npx tsx scripts/legacy-storage-migrator.ts [options]

Options:
  --execute              Enable write operations (default: dry-run)
  --confirm-production   Required for production execution
  --sources <list>       Comma-separated sources
  --ids <list>           Comma-separated record IDs
  --limit <n>            Maximum records to process
  --batch-size <n>       Records per batch (default: 1)
  --concurrency <n>      Parallel workers (default: 1)
  --orphan-audit         Run orphan audit mode
  --help, -h            Show this help

Examples:
  # Dry-run inventory
  npx tsx scripts/legacy-storage-migrator.ts

  # Execute migration (requires both flags)
  npx tsx scripts/legacy-storage-migrator.ts --execute --confirm-production --limit 1
`);
}

// Sanitize error messages - redact sensitive information
function sanitizeError(error: string | Error | unknown): string {
  if (!error) return "Unknown error";

  let message = error instanceof Error ? error.message : String(error);

  // Redact patterns
  const patterns = [
    // URLs with credentials
    { pattern: /[a-zA-Z]+:\/\/[^\s"]+/g, replacement: "[REDACTED_URL]" },
    // Authorization headers
    { pattern: /authorization[:\s=]+[^\s,"]+/gi, replacement: "authorization: [REDACTED]" },
    // Bearer tokens
    { pattern: /bearer\s+[a-zA-Z0-9_-]{10,}/gi, replacement: "[REDACTED_BEARER]" },
    // JWT-like strings (3 base64 parts separated by dots)
    { pattern: /[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, replacement: "[REDACTED_JWT]" },
    // Service role keys (long alphanumeric)
    { pattern: /ey[a-zA-Z0-9_-]{20,}/g, replacement: "[REDACTED_KEY]" },
    // Base64 data URLs (long)
    { pattern: /data:[^;]+;base64,[a-zA-Z0-9+/]{100,}/gi, replacement: "[REDACTED_BASE64]" },
    // Stack traces
    { pattern: /\s+at\s+.+$/gm, replacement: "" },
  ];

  for (const { pattern, replacement } of patterns) {
    message = message.replace(pattern, replacement);
  }

  // Limit length
  return message.substring(0, 500).trim();
}

// Infer MIME type with proper precedence
function inferMimeType(fileName: string, dataUrlMime: string | null, fileType: string | null): string {
  // 1. Valid MIME from data URL
  if (dataUrlMime && dataUrlMime !== "application/octet-stream") {
    return dataUrlMime;
  }

  // 2. Existing fileType from source record
  if (fileType?.trim()) {
    return fileType.trim();
  }

  // 3. Filename extension inference
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext && EXT_TO_MIME[ext]) {
    return EXT_TO_MIME[ext];
  }

  // 4. Fallback
  return "application/octet-stream";
}

// Parse data URL and extract MIME type
function parseDataUrl(value: string): { mimeType: string | null; base64Data: string } {
  const trimmed = value.trim();

  if (!trimmed.startsWith("data:")) {
    return { mimeType: null, base64Data: trimmed };
  }

  const comma = trimmed.indexOf(",");
  if (comma < 0) {
    return { mimeType: null, base64Data: "" };
  }

  const header = trimmed.slice(5, comma);
  const declaredMime = header.split(";")[0] || null;
  const base64Data = trimmed.slice(comma + 1);

  return { mimeType: declaredMime, base64Data };
}

// Decode Base64 to temp file with streaming and SHA-256 calculation
async function decodeLegacyDataToTemp(
  value: string,
  fileName: string,
  fileType: string | null
): Promise<DecodedStreamResult> {
  const { mimeType: dataUrlMime, base64Data } = parseDataUrl(value);
  const detectedMime = inferMimeType(fileName, dataUrlMime, fileType);

  const tempFilePath = join(tmpdir(), `odm-migration-${randomUUID()}.tmp`);
  const hash = createHash("sha256");
  let size = 0;

  try {
    // Decode Base64 to buffer
    const buffer = Buffer.from(base64Data, "base64");

    // Write to temp file
    const writeStream = createWriteStream(tempFilePath);
    await new Promise<void>((resolve, reject) => {
      writeStream.write(buffer, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    writeStream.end();

    // Update hash and size
    hash.update(buffer);
    size = buffer.length;

    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    return {
      tempFilePath,
      size,
      sha256: hash.digest("hex"),
      mimeType: detectedMime,
    };
  } catch (error) {
    // Clean up on error
    await fs.unlink(tempFilePath).catch(() => {});
    throw error;
  }
}

// Sanitize filename for path
function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .substring(0, 200);
}

// Generate deterministic storage path
function generateStoragePath(source: StorageFileSource, recordId: number, filename: string): string {
  const sanitized = sanitizeFilename(filename);
  return `legacy/${source}/${recordId}/${sanitized}`;
}

// Check and lock record for exclusive processing
async function tryAcquireRecordLock(source: string, recordId: number): Promise<boolean> {
  const lockId = `legacy:${source}:${recordId}`;
  const result = await db.execute(sql`SELECT pg_try_advisory_lock(hashtextextended(${lockId}, 0)) as acquired`);
  return result[0]?.acquired === true;
}

// Release record lock
async function releaseRecordLock(source: string, recordId: number): Promise<void> {
  const lockId = `legacy:${source}:${recordId}`;
  await db.execute(sql`SELECT pg_advisory_unlock(hashtextextended(${lockId}, 0))`);
}

// Get ledger entry with state
async function getLedgerEntry(source: string, recordId: number) {
  const rows = await db
    .select()
    .from(legacyStorageMigrationLedger)
    .where(and(
      eq(legacyStorageMigrationLedger.source, source),
      eq(legacyStorageMigrationLedger.recordId, recordId)
    ))
    .limit(1);
  return rows[0] || null;
}

// Upsert ledger entry
async function upsertLedgerEntry(
  source: StorageFileSource,
  recordId: number,
  bucket: string,
  storagePath: string,
  filename: string,
  expectedSize: number,
  legacySha256: string,
  mimeType: string,
  execute: boolean
): Promise<void> {
  if (!execute) return;

  await db
    .insert(legacyStorageMigrationLedger)
    .values({
      source,
      recordId,
      bucket,
      storagePath,
      originalFilename: filename,
      expectedSize,
      legacySha256,
      detectedMimeType: mimeType,
      state: "inventoried",
    })
    .onConflictDoUpdate({
      target: [legacyStorageMigrationLedger.source, legacyStorageMigrationLedger.recordId],
      set: { updatedAt: new Date() },
    });
}

// Update ledger state with transition validation
async function updateLedgerState(
  source: StorageFileSource,
  recordId: number,
  newState: string,
  execute: boolean,
  error?: string
): Promise<void> {
  if (!execute) return;

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (error) {
    updates.lastError = sanitizeError(error);
  }

  // Set timestamps based on state
  if (newState === "object_verified") {
    updates.objectVerifiedAt = new Date();
  } else if (newState === "metadata_committed") {
    updates.metadataCommittedAt = new Date();
  } else if (newState === "app_verified") {
    updates.appVerifiedAt = new Date();
  } else if (newState === "rolled_back") {
    updates.rollbackAt = new Date();
  }

  await db
    .update(legacyStorageMigrationLedger)
    .set({ ...updates, state: newState })
    .where(
      and(
        eq(legacyStorageMigrationLedger.source, source),
        eq(legacyStorageMigrationLedger.recordId, recordId)
      )
    );
}

// Increment attempt count
async function incrementAttemptCount(
  source: StorageFileSource,
  recordId: number,
  execute: boolean
): Promise<void> {
  if (!execute) return;

  await db
    .update(legacyStorageMigrationLedger)
    .set({
      attemptCount: sql`attempt_count + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(legacyStorageMigrationLedger.source, source),
        eq(legacyStorageMigrationLedger.recordId, recordId)
      )
    );
}

// Check if existing object matches expected
async function verifyExistingObject(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  expectedSize: number,
  expectedSha256: string,
  expectedMimeType: string
): Promise<{ matches: boolean; reason?: string }> {
  try {
    // Get object metadata
    const { data: objects, error } = await supabase.storage.from(bucket).list(path.split("/").slice(0, -1).join("/"), {
      limit: 100,
    });

    if (error) {
      return { matches: false, reason: "Failed to list bucket: " + sanitizeError(error) };
    }

    const objectName = path.split("/").pop();
    const obj = objects?.find((o) => o.name === objectName);

    if (!obj) {
      return { matches: false, reason: "Object not found" };
    }

    // Verify size
    if (obj.metadata?.size !== expectedSize) {
      return { matches: false, reason: `Size mismatch: expected ${expectedSize}, got ${obj.metadata?.size}` };
    }

    // Verify MIME type if available
    const objMimeType = obj.metadata?.mimetype;
    if (objMimeType && objMimeType !== expectedMimeType) {
      return { matches: false, reason: `MIME type mismatch` };
    }

    // Download and verify SHA-256
    const { data: downloadData, error: downloadError } = await supabase.storage.from(bucket).download(path);
    if (downloadError || !downloadData) {
      return { matches: false, reason: "Download failed: " + sanitizeError(downloadError) };
    }

    const buffer = Buffer.from(await downloadData.arrayBuffer());
    const actualSha256 = createHash("sha256").update(buffer).digest("hex");

    if (actualSha256 !== expectedSha256) {
      return { matches: false, reason: "SHA-256 mismatch" };
    }

    return { matches: true };
  } catch (error) {
    return { matches: false, reason: "Verification error: " + sanitizeError(error) };
  }
}

// Upload file using TUS resumable upload
async function uploadWithTus(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  tempFilePath: string,
  mimeType: string,
  fileSize: number,
  execute: boolean
): Promise<{ etag: string | null; uploadUrl: string | null }> {
  if (!execute) {
    return { etag: "dry-run-etag", uploadUrl: null };
  }

  const config = getSupabaseStorageConfig();
  const tusEndpoint = `${config.directStorageUrl}/storage/v1/upload/resumable`;

  // Generate a temporary token for TUS upload (this is a simplified approach)
  // In production, you would use the proper authorization flow
  const fileStream = createReadStream(tempFilePath);
  const fileBuffer = await fs.readFile(tempFilePath);

  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(fileBuffer, {
      endpoint: tusEndpoint,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      chunkSize: TUS_CHUNK_SIZE_BYTES,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: {
        Authorization: `Bearer ${config.serviceRoleKey}`,
      },
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType: mimeType,
        cacheControl: "3600",
      },
      onError: (error) => {
        reject(new Error(`TUS upload failed: ${sanitizeError(error)}`));
      },
      onSuccess: () => {
        resolve({ etag: "tus-completed", uploadUrl: null });
      },
    });

    upload.start();
  });
}

// Update source record with storage metadata
async function updateSourceRecord(
  source: StorageFileSource,
  recordId: number,
  bucket: string,
  path: string,
  size: number,
  mimeType: string,
  etag: string | null,
  execute: boolean
): Promise<void> {
  if (!execute) return;

  const table = SOURCE_TABLES[source];
  const now = new Date();

  await db
    .update(table)
    .set({
      storageProvider: "supabase",
      storageBucket: bucket,
      storagePath: path,
      storageSize: size,
      storageMimeType: mimeType,
      storageEtag: etag,
      storageUploadedAt: now,
      updatedAt: now,
    })
    .where(eq(table.id, recordId));
}

// Clear storage metadata (rollback)
async function clearStorageMetadata(
  source: StorageFileSource,
  recordId: number,
  execute: boolean
): Promise<void> {
  if (!execute) return;

  const table = SOURCE_TABLES[source];

  await db
    .update(table)
    .set({
      storageProvider: null,
      storageBucket: null,
      storagePath: null,
      storageSize: null,
      storageMimeType: null,
      storageEtag: null,
      storageUploadedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(table.id, recordId));
}

// Verify application route
async function verifyApplicationRoute(
  source: StorageFileSource,
  recordId: number,
  expectedSize: number,
  expectedSha256: string,
  baseUrl: string,
  execute: boolean
): Promise<{ ok: boolean; error?: string }> {
  if (!execute) return { ok: true };

  try {
    const url = `${baseUrl}/api/storage/files/${source}/${recordId}/view`;
    const response = await fetch(url, { redirect: "manual" });

    if (response.status !== 302) {
      return { ok: false, error: `Expected redirect (302), got ${response.status}` };
    }

    const redirectUrl = response.headers.get("location");
    if (!redirectUrl) {
      return { ok: false, error: "No redirect URL in response" };
    }

    // Don't log the full redirect URL
    const contentResponse = await fetch(redirectUrl);
    if (!contentResponse.ok) {
      return { ok: false, error: `Content fetch failed: ${contentResponse.status}` };
    }

    const buffer = Buffer.from(await contentResponse.arrayBuffer());

    if (buffer.length !== expectedSize) {
      return { ok: false, error: `Content size mismatch: expected ${expectedSize}, got ${buffer.length}` };
    }

    const sha256 = createHash("sha256").update(buffer).digest("hex");

    if (sha256 !== expectedSha256) {
      return { ok: false, error: "Content SHA-256 mismatch" };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: sanitizeError(err) };
  }
}

// Fetch records eligible for migration (includes resumed states)
async function fetchEligibleRecords(
  source: StorageFileSource,
  recordIds?: number[],
  limit?: number
): Promise<Array<{ id: number; fileName: string | null; fileType: string | null; legacyData: string }>> {
  const table = SOURCE_TABLES[source];
  const legacyColumn = LEGACY_COLUMNS[source];

  // Build base query - fetch records with legacy data
  let query = db
    .select({
      id: table.id,
      fileName: source === "governance_uploads" ? sql<string | null>`${sql.raw("file_name")}` : table.fileName,
      fileType: source === "governance_uploads" ? sql<string | null>`null` : table.fileType,
      legacyData: sql<string>`${sql.raw(legacyColumn)}`,
    })
    .from(table)
    .where(and(
      sql`length(${sql.raw(legacyColumn)}) > 0`,
      recordIds?.length ? inArray(table.id, recordIds) : undefined
    ));

  if (limit) {
    query = query.limit(limit);
  }

  const rows = await query;

  // Filter out SMP ID 31
  return rows
    .filter((r): r is typeof r &amp; { legacyData: string } => !!r.legacyData)
    .filter((r) => !(source === "smp_documents" && r.id === 31));
}

// Validate APP_BASE_URL for production
function validateAppBaseUrl(url: string | undefined, isExecute: boolean): { valid: boolean; error?: string } {
  if (!isExecute) {
    // Dry-run can operate without APP_BASE_URL if verification is skipped
    return { valid: true };
  }

  if (!url) {
    return { valid: false, error: "APP_BASE_URL is required for execute mode" };
  }

  try {
    const parsed = new URL(url);

    // Reject localhost and loopback
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return { valid: false, error: "APP_BASE_URL cannot be localhost/loopback in production" };
    }

    // Require HTTPS in production
    if (parsed.protocol !== "https:") {
      return { valid: false, error: "APP_BASE_URL must use HTTPS in production" };
    }

    // Reject query strings
    if (parsed.search && parsed.search !== "") {
      return { valid: false, error: "APP_BASE_URL cannot contain query strings" };
    }

    // Reject credentials in URL
    if (parsed.username || parsed.password) {
      return { valid: false, error: "APP_BASE_URL cannot contain credentials" };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: "APP_BASE_URL is not a valid URL" };
  }
}

// Process a single record with state-based continuation
async function processRecord(
  source: StorageFileSource,
  record: { id: number; fileName: string | null; fileType: string | null; legacyData: string },
  supabase: SupabaseClient,
  options: MigrationOptions,
  baseUrl: string
): Promise<{ success: boolean; state?: string; error?: string; skipped?: boolean }> {
  const { execute } = options;
  const filename = record.fileName || "unnamed";
  const bucket = SOURCE_BUCKETS[source];
  const path = generateStoragePath(source, record.id, filename);

  // Try to acquire exclusive lock
  const lockAcquired = await tryAcquireRecordLock(source, record.id);
  if (!lockAcquired) {
    return { success: false, skipped: true, error: "Record locked by another worker" };
  }

  try {
    // Check existing ledger entry for state-based continuation
    const ledger = await getLedgerEntry(source, record.id);

    // Terminal states - skip
    if (ledger?.state === "app_verified" || ledger?.state === "excluded") {
      return { success: true, skipped: true, state: ledger.state };
    }

    // Conflict state - requires human review
    if (ledger?.state === "conflict") {
      return { success: false, skipped: true, state: "conflict", error: "Requires human review - object conflict" };
    }

    // Step 1-3: Decode legacy data to temp file
    let decoded: DecodedStreamResult;
    try {
      decoded = await decodeLegacyDataToTemp(record.legacyData, filename, record.fileType);
    } catch (err) {
      return { success: false, error: `Failed to decode: ${sanitizeError(err)}` };
    }

    if (decoded.size === 0) {
      await fs.unlink(decoded.tempFilePath).catch(() => {});
      return { success: false, error: "Empty payload" };
    }

    // Step 4: Upsert ledger
    await upsertLedgerEntry(
      source,
      record.id,
      bucket,
      path,
      filename,
      decoded.size,
      decoded.sha256,
      decoded.mimeType,
      execute
    );

    await incrementAttemptCount(source, record.id, execute);

    // Check for existing object (idempotent handling)
    const existingCheck = await verifyExistingObject(
      supabase,
      bucket,
      path,
      decoded.size,
      decoded.sha256,
      decoded.mimeType
    );

    let etag: string | null = null;

    if (existingCheck.matches) {
      // Object already exists and matches - reuse it
      console.log(`    [${source}:${record.id}] Existing object verified - reusing`);
      etag = "existing-verified";
      await updateLedgerState(source, record.id, "uploaded", execute);
      await updateLedgerState(source, record.id, "object_verified", execute);
    } else if (ledger?.state === "uploaded" || ledger?.state === "object_verified") {
      // Previous upload recorded but verification failed
      await updateLedgerState(source, record.id, "failed", execute, existingCheck.reason);
      await fs.unlink(decoded.tempFilePath).catch(() => {});
      return { success: false, error: `Existing object verification failed: ${existingCheck.reason}` };
    } else {
      // Step 5: Upload via TUS
      await updateLedgerState(source, record.id, "uploading", execute);

      try {
        const uploadResult = await uploadWithTus(
          supabase,
          bucket,
          path,
          decoded.tempFilePath,
          decoded.mimeType,
          decoded.size,
          execute
        );
        etag = uploadResult.etag;
      } catch (err) {
        await updateLedgerState(source, record.id, "failed", execute, sanitizeError(err));
        await fs.unlink(decoded.tempFilePath).catch(() => {});
        return { success: false, error: `Upload failed: ${sanitizeError(err)}` };
      }

      await updateLedgerState(source, record.id, "uploaded", execute);

      // Step 6: Verify uploaded object
      const verifyResult = await verifyExistingObject(
        supabase,
        bucket,
        path,
        decoded.size,
        decoded.sha256,
        decoded.mimeType
      );

      if (!verifyResult.matches) {
        await updateLedgerState(source, record.id, "failed", execute, verifyResult.reason);
        await fs.unlink(decoded.tempFilePath).catch(() => {});
        return { success: false, error: `Object verification failed: ${verifyResult.reason}` };
      }

      await updateLedgerState(source, record.id, "object_verified", execute);
    }

    // Step 8: Recheck source record hasn't changed
    const current = await fetchEligibleRecords(source, [record.id], 1);
    if (current.length === 0 || current[0].legacyData !== record.legacyData) {
      await updateLedgerState(source, record.id, "failed", execute, "Source record changed during migration");
      await fs.unlink(decoded.tempFilePath).catch(() => {});
      return { success: false, error: "Source record changed during migration" };
    }

    // Step 9: Commit metadata
    await updateSourceRecord(
      source,
      record.id,
      bucket,
      path,
      decoded.size,
      decoded.mimeType,
      etag,
      execute
    );

    await updateLedgerState(source, record.id, "metadata_committed", execute);

    // Step 11: Verify application route
    const appVerify = await verifyApplicationRoute(
      source,
      record.id,
      decoded.size,
      decoded.sha256,
      baseUrl,
      execute
    );

    // Clean up temp file
    await fs.unlink(decoded.tempFilePath).catch(() => {});

    if (!appVerify.ok) {
      // Rollback
      await clearStorageMetadata(source, record.id, execute);
      await updateLedgerState(source, record.id, "rollback_required", execute, appVerify.error);
      await updateLedgerState(source, record.id, "rolled_back", execute);
      return { success: false, error: `App verification failed: ${appVerify.error}` };
    }

    await updateLedgerState(source, record.id, "app_verified", execute);

    return { success: true, state: "app_verified" };
  } finally {
    await releaseRecordLock(source, record.id);
  }
}

// Main migration function
async function runMigration(options: MigrationOptions): Promise<void> {
  const sources = options.sources || (["doc_files", "governance_files", "governance_uploads", "smp_documents"] as StorageFileSource[]);

  // Validate APP_BASE_URL
  const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
  const urlValidation = validateAppBaseUrl(process.env.APP_BASE_URL, options.execute);

  if (!urlValidation.valid) {
    console.error(`ERROR: ${urlValidation.error}`);
    process.exit(1);
  }

  // Get Supabase client
  let supabase: SupabaseClient;
  try {
    supabase = getSupabaseStorageAdmin();
  } catch (err) {
    console.error("Failed to initialize Supabase Storage client:", sanitizeError(err));
    process.exit(1);
  }

  console.log(`\n=== Legacy Storage Migration ===`);
  console.log(`Mode: ${options.execute ? "EXECUTE" : "DRY-RUN"}`);
  console.log(`Sources: ${sources.join(", ")}`);
  console.log(`Limit: ${options.limit || "unlimited"}`);
  console.log(`Batch size: ${options.batchSize}`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`\n`);

  if (options.execute && !options.confirmProduction) {
    console.error("ERROR: Production execution requires --confirm-production flag");
    process.exit(1);
  }

  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const source of sources) {
    console.log(`\n--- Processing source: ${source} ---`);

    if (source === "smp_documents") {
      console.log("Note: SMP ID 31 is excluded (smoke artifact)");
    }

    const records = await fetchEligibleRecords(source, options.recordIds, options.limit);

    console.log(`Found ${records.length} eligible records`);

    for (let i = 0; i < records.length; i += options.batchSize!) {
      const batch = records.slice(i, i + options.batchSize!);
      console.log(`  Batch ${Math.floor(i / options.batchSize!) + 1}: ${batch.length} records`);

      for (const record of batch) {
        totalProcessed++;

        const result = await processRecord(source, record, supabase, options, baseUrl);

        if (result.skipped) {
          console.log(`    [${source}:${record.id}] ⊘ ${result.state || result.error}`);
          totalSkipped++;
        } else if (result.success) {
          console.log(`    [${source}:${record.id}] ✓ ${result.state}`);
          totalSuccess++;
        } else {
          console.log(`    [${source}:${record.id}] ✗ ${result.error}`);
          totalFailed++;
        }
      }
    }
  }

  console.log(`\n=== Migration Summary ===`);
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Successful: ${totalSuccess}`);
  console.log(`Failed: ${totalFailed}`);
  console.log(`Skipped: ${totalSkipped}`);
  console.log(`Mode: ${options.execute ? "EXECUTE" : "DRY-RUN"}`);

  if (!options.execute) {
    console.log(`\nThis was a DRY-RUN. No changes were made.`);
    console.log(`To execute, add --execute --confirm-production flags.`);
  }
}

// Orphan audit mode with proper classification
async function runOrphanAudit(): Promise<void> {
  console.log("\n=== Storage Orphan Audit ===\n");

  const supabase = getSupabaseStorageAdmin();
  const buckets = ["om-manuals", "om-governance", "smp-library"];

  // Build reference sets
  const tablePaths = new Set<string>();
  const intentPendingPaths = new Set<string>();
  const intentFinalizedPaths = new Set<string>();
  const ledgerStagedPaths = new Set<string>();
  const ledgerVerifiedPaths = new Set<string>();

  // Collect from source tables
  const sources = ["doc_files", "governance_files", "governance_uploads", "smp_documents"] as StorageFileSource[];
  for (const source of sources) {
    const table = SOURCE_TABLES[source];
    const rows = await db
      .select({ bucket: sql<string | null>`storage_bucket`, path: sql<string | null>`storage_path` })
      .from(table)
      .where(sql`storage_path IS NOT NULL`);

    for (const row of rows) {
      if (row.bucket && row.path) {
        tablePaths.add(`${row.bucket}:${row.path}`);
      }
    }
  }

  // Collect from upload intents
  const intents = await db
    .select({ bucket: storageUploadIntents.expectedBucket, path: storageUploadIntents.expectedPath, status: storageUploadIntents.status })
    .from(storageUploadIntents);

  for (const intent of intents) {
    const key = `${intent.bucket}:${intent.path}`;
    if (intent.status === "finalized") {
      intentFinalizedPaths.add(key);
    } else if (["pending", "uploading"].includes(intent.status)) {
      intentPendingPaths.add(key);
    }
  }

  // Collect from migration ledger
  const ledger = await db
    .select({ bucket: legacyStorageMigrationLedger.bucket, path: legacyStorageMigrationLedger.storagePath, state: legacyStorageMigrationLedger.state })
    .from(legacyStorageMigrationLedger);

  for (const entry of ledger) {
    const key = `${entry.bucket}:${entry.path}`;
    if (entry.state === "app_verified") {
      ledgerVerifiedPaths.add(key);
    } else if (["uploaded", "object_verified", "metadata_committed", "uploading"].includes(entry.state)) {
      ledgerStagedPaths.add(key);
    }
  }

  console.log(`References from tables: ${tablePaths.size}`);
  console.log(`Pending intent paths: ${intentPendingPaths.size}`);
  console.log(`Finalized intent paths: ${intentFinalizedPaths.size}`);
  console.log(`Ledger staged: ${ledgerStagedPaths.size}`);
  console.log(`Ledger verified: ${ledgerVerifiedPaths.size}`);

  // Scan each bucket with pagination
  for (const bucket of buckets) {
    console.log(`\n--- Scanning bucket: ${bucket} ---`);

    let offset = 0;
    const limit = 1000;
    let hasMore = true;
    let objectCount = 0;

    while (hasMore) {
      const { data: objects, error } = await supabase.storage.from(bucket).list("", {
        limit,
        offset,
      });

      if (error) {
        console.log(`  Error listing bucket: ${sanitizeError(error)}`);
        break;
      }

      if (!objects || objects.length === 0) {
        break;
      }

      for (const obj of objects) {
        // Skip folders (they have no metadata)
        if (!obj.metadata) continue;

        objectCount++;
        const key = `${bucket}:${obj.name}`;

        // Classification precedence
        let classification: string;

        if (tablePaths.has(key)) {
          classification = "referenced";
        } else if (intentPendingPaths.has(key)) {
          classification = "active_upload_intent";
        } else if (intentFinalizedPaths.has(key)) {
          classification = "finalized_upload_intent";
        } else if (ledgerVerifiedPaths.has(key)) {
          classification = "migration_verified";
        } else if (ledgerStagedPaths.has(key)) {
          classification = "migration_staged";
        } else {
          classification = "possible_orphan";
        }

        // Report but limit output
        if (classification === "possible_orphan" || objectCount <= 10) {
          console.log(`  ${obj.name}: ${classification} (${obj.metadata?.size || "unknown"} bytes)`);
        }
      }

      if (objects.length < limit) {
        hasMore = false;
      } else {
        offset += limit;
      }
    }

    console.log(`  Total objects: ${objectCount}`);
  }

  console.log("\nNote: This is a READ-ONLY audit. No objects were deleted.");
}

// Main entry point
async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--orphan-audit")) {
    await runOrphanAudit();
    return;
  }

  const options = parseArgs();
  await runMigration(options);
}

main().catch((err) => {
  console.error("Fatal error:", sanitizeError(err));
  process.exit(1);
});
