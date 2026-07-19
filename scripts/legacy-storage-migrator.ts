import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, createReadStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  VALID_STATE_TRANSITIONS,
  type LegacyStorageMigrationState,
} from "../db/schema";
import { getSupabaseStorageAdmin, getSupabaseStorageConfig } from "../api/supabase-storage";
import { STORAGE_BUCKET_BY_MODULE, TUS_CHUNK_SIZE_BYTES, type StorageFileSource } from "@contracts/storage";
import type { SupabaseClient } from "@supabase/supabase-js";

// Configuration constants
const BASE64_CHUNK_SIZE = 64 * 1024; // 64KB chunks (must be multiple of 4 for Base64)
const MAX_MEMORY_BUFFER = 256 * 1024; // 256KB max in-memory buffer
const LEASE_DURATION_MS = 5 * 60 * 1000; // 5 minute lease duration

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

interface MigrationOptions {
  execute: boolean;
  confirmProduction: boolean;
  sources?: StorageFileSource[];
  recordIds?: number[];
  limit?: number;
  batchSize?: number;
  concurrency?: number;
}

interface ProcessingContext {
  tempDir: string;
  tempFilePath: string;
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

  const patterns = [
    { pattern: /[a-zA-Z]+:\/\/[^\s"]+/g, replacement: "[REDACTED_URL]" },
    { pattern: /authorization[:\s=]+[^\s,"]+/gi, replacement: "authorization: [REDACTED]" },
    { pattern: /bearer\s+[a-zA-Z0-9_-]{10,}/gi, replacement: "[REDACTED_BEARER]" },
    { pattern: /[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, replacement: "[REDACTED_JWT]" },
    { pattern: /ey[a-zA-Z0-9_-]{20,}/g, replacement: "[REDACTED_KEY]" },
    { pattern: /data:[^;]+;base64,[a-zA-Z0-9+/]{100,}/gi, replacement: "[REDACTED_BASE64]" },
    { pattern: /\s+at\s+.+$/gm, replacement: "" },
  ];

  for (const { pattern, replacement } of patterns) {
    message = message.replace(pattern, replacement);
  }

  return message.substring(0, 500).trim();
}

// Infer MIME type with proper precedence
function inferMimeType(fileName: string, dataUrlMime: string | null, fileType: string | null): string {
  if (dataUrlMime && dataUrlMime !== "application/octet-stream") {
    return dataUrlMime;
  }
  if (fileType?.trim()) {
    return fileType.trim();
  }
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext && EXT_TO_MIME[ext]) {
    return EXT_TO_MIME[ext];
  }
  return "application/octet-stream";
}

// Parse data URL header separately (small bounded read)
function parseDataUrlHeader(value: string): { mimeType: string | null; headerLength: number } {
  const trimmed = value.trim();
  if (!trimmed.startsWith("data:")) {
    return { mimeType: null, headerLength: 0 };
  }
  const comma = trimmed.indexOf(",");
  if (comma < 0) {
    return { mimeType: null, headerLength: 0 };
  }
  const header = trimmed.slice(5, comma);
  const declaredMime = header.split(";")[0] || null;
  return { mimeType: declaredMime, headerLength: comma + 1 };
}

// Create private temp directory with restrictive permissions
async function createPrivateTempDir(): Promise<string> {
  const randomSuffix = randomBytes(16).toString("hex");
  const tempDir = join(tmpdir(), `odm-migration-${randomSuffix}`);
  await fs.mkdir(tempDir, { mode: 0o700, recursive: true });
  return tempDir;
}

// Decode Base64 in chunks to temp file with streaming SHA-256
async function decodeLegacyDataChunked(
  base64Data: string,
  tempFilePath: string
): Promise<{ size: number; sha256: string }> {
  const hash = createHash("sha256");
  let size = 0;
  let carryOver = "";

  const writeStream = createWriteStream(tempFilePath);

  try {
    for (let i = 0; i < base64Data.length; i += BASE64_CHUNK_SIZE) {
      // Include carry-over from previous chunk to maintain 4-character alignment
      let chunk = carryOver + base64Data.slice(i, i + BASE64_CHUNK_SIZE);

      // Calculate how many complete 4-character groups we have
      const remainder = chunk.length % 4;
      if (remainder !== 0 && i + BASE64_CHUNK_SIZE < base64Data.length) {
        // Not the last chunk - save remainder for next iteration
        carryOver = chunk.slice(-remainder);
        chunk = chunk.slice(0, -remainder);
      } else {
        carryOver = "";
      }

      if (chunk.length === 0) continue;

      // Validate Base64 characters
      if (!/^[A-Za-z0-9+/]*=?=?=?$/.test(chunk)) {
        throw new Error("Invalid Base64 character detected");
      }

      // Decode chunk
      const buffer = Buffer.from(chunk, "base64");

      // Write to file
      await new Promise<void>((resolve, reject) => {
        writeStream.write(buffer, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Update hash and size
      hash.update(buffer);
      size += buffer.length;
    }

    // Handle any remaining carry-over (should only be padding)
    if (carryOver) {
      const buffer = Buffer.from(carryOver, "base64");
      await new Promise<void>((resolve, reject) => {
        writeStream.write(buffer, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      hash.update(buffer);
      size += buffer.length;
    }

    // Close write stream
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

// Try to acquire worker lease (time-based distributed lock)
async function tryAcquireWorkerLease(
  source: string,
  recordId: number,
  execute: boolean
): Promise<boolean> {
  if (!execute) return true; // Dry-run doesn't need locking

  const now = new Date();
  const leaseExpires = new Date(now.getTime() + LEASE_DURATION_MS);

  try {
    // Try to update lease for existing record
    const result = await db
      .update(legacyStorageMigrationLedger)
      .set({ leaseExpiresAt: leaseExpires, updatedAt: now })
      .where(and(
        eq(legacyStorageMigrationLedger.source, source),
        eq(legacyStorageMigrationLedger.recordId, recordId),
        // Only acquire if no active lease
        sql`(${legacyStorageMigrationLedger.leaseExpiresAt} IS NULL OR ${legacyStorageMigrationLedger.leaseExpiresAt} < ${now})`
      ))
      .returning({ id: legacyStorageMigrationLedger.id });

    return result.length > 0;
  } catch {
    return false;
  }
}

// Release worker lease
async function releaseWorkerLease(source: string, recordId: number, execute: boolean): Promise<void> {
  if (!execute) return;

  await db
    .update(legacyStorageMigrationLedger)
    .set({ leaseExpiresAt: null, updatedAt: new Date() })
    .where(and(
      eq(legacyStorageMigrationLedger.source, source),
      eq(legacyStorageMigrationLedger.recordId, recordId)
    ));
}

// Validate state transition
function isValidStateTransition(from: string, to: string): boolean {
  if (!(from in VALID_STATE_TRANSITIONS)) return false;
  return VALID_STATE_TRANSITIONS[from as LegacyStorageMigrationState].includes(to as LegacyStorageMigrationState);
}

// Update ledger state with transition validation
async function updateLedgerState(
  source: StorageFileSource,
  recordId: number,
  newState: LegacyStorageMigrationState,
  execute: boolean,
  error?: string
): Promise<void> {
  if (!execute) return;

  // Get current state
  const current = await getLedgerEntry(source, recordId);
  const currentState = current?.state || "inventoried";

  // Validate transition
  if (!isValidStateTransition(currentState, newState)) {
    console.error(`Invalid state transition: ${currentState} -> ${newState}`);
    return;
  }

  const updates: Record<string, unknown> = {
    state: newState,
    updatedAt: new Date(),
  };

  if (error) {
    updates.lastError = sanitizeError(error);
  }

  // Only set timestamps on transition (not on every update)
  if (newState === "object_verified" && currentState !== "object_verified") {
    updates.objectVerifiedAt = new Date();
  } else if (newState === "metadata_committed" && currentState !== "metadata_committed") {
    updates.metadataCommittedAt = new Date();
  } else if (newState === "app_verified" && currentState !== "app_verified") {
    updates.appVerifiedAt = new Date();
  } else if (newState === "rolled_back" && currentState !== "rolled_back") {
    updates.rollbackAt = new Date();
  }

  await db
    .update(legacyStorageMigrationLedger)
    .set(updates)
    .where(and(
      eq(legacyStorageMigrationLedger.source, source),
      eq(legacyStorageMigrationLedger.recordId, recordId)
    ));
}

// Update TUS upload URL
async function updateTusUploadUrl(
  source: StorageFileSource,
  recordId: number,
  uploadUrl: string | null,
  execute: boolean
): Promise<void> {
  if (!execute) return;

  await db
    .update(legacyStorageMigrationLedger)
    .set({
      tusUploadUrl: uploadUrl,
      updatedAt: new Date(),
    })
    .where(and(
      eq(legacyStorageMigrationLedger.source, source),
      eq(legacyStorageMigrationLedger.recordId, recordId)
    ));
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
    .where(and(
      eq(legacyStorageMigrationLedger.source, source),
      eq(legacyStorageMigrationLedger.recordId, recordId)
    ));
}

// Verify existing object with streaming SHA-256
async function verifyExistingObjectStreamed(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  expectedSize: number,
  expectedSha256: string,
  expectedMimeType: string
): Promise<{ matches: boolean; reason?: string; actualSize?: number; actualSha256?: string }> {
  try {
    // Get object metadata first
    const { data: objects, error } = await supabase.storage.from(bucket).list(path.split("/").slice(0, -1).join("/"), {
      limit: 100,
    });

    if (error) {
      return { matches: false, reason: "Failed to list bucket" };
    }

    const objectName = path.split("/").pop();
    const obj = objects?.find((o) => o.name === objectName);

    if (!obj) {
      return { matches: false, reason: "Object not found" };
    }

    // Verify size
    const actualSize = obj.metadata?.size;
    if (actualSize !== expectedSize) {
      return {
        matches: false,
        reason: "Size mismatch",
        actualSize,
      };
    }

    // Verify MIME type if available in metadata
    const actualMimeType = obj.metadata?.mimetype;
    if (actualMimeType && actualMimeType !== expectedMimeType) {
      return { matches: false, reason: "MIME type mismatch" };
    }

    // Stream download and calculate SHA-256
    const { data: downloadData, error: downloadError } = await supabase.storage.from(bucket).download(path);
    if (downloadError || !downloadData) {
      return { matches: false, reason: "Download failed" };
    }

    // Get reader for streaming
    const reader = downloadData.stream().getReader();
    const hash = createHash("sha256");
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const buffer = Buffer.from(value);
      hash.update(buffer);
      totalBytes += buffer.length;

      // Safety check
      if (totalBytes > expectedSize * 2) {
        return { matches: false, reason: "Downloaded size exceeds expected" };
      }
    }

    if (totalBytes !== expectedSize) {
      return { matches: false, reason: "Downloaded size mismatch", actualSize: totalBytes };
    }

    const actualSha256 = hash.digest("hex");
    if (actualSha256 !== expectedSha256) {
      return { matches: false, reason: "SHA-256 mismatch", actualSha256 };
    }

    return { matches: true };
  } catch (error) {
    return { matches: false, reason: "Verification error" };
  }
}

// Upload file using TUS with resumable support
async function uploadWithTusResumable(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  tempFilePath: string,
  mimeType: string,
  fileSize: number,
  existingUploadUrl: string | null | undefined,
  source: StorageFileSource,
  recordId: number,
  execute: boolean
): Promise<{ etag: string | null; uploadUrl: string | null }> {
  if (!execute) {
    return { etag: "dry-run-etag", uploadUrl: null };
  }

  const config = getSupabaseStorageConfig();
  const tusEndpoint = `${config.directStorageUrl}/storage/v1/upload/resumable`;

  return new Promise((resolve, reject) => {
    // Use file path for streaming upload (not buffer)
    const upload = new tus.Upload(null as unknown as File, {
      endpoint: tusEndpoint,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      chunkSize: TUS_CHUNK_SIZE_BYTES,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      uploadUrl: existingUploadUrl || undefined,
      headers: {
        Authorization: `Bearer ${config.serviceRoleKey}`,
      },
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType: mimeType,
        cacheControl: "3600",
      },
      // Use streaming from file
      chunkSizeBytes: TUS_CHUNK_SIZE_BYTES,
      onBeforeRequest: (req) => {
        // Ensure upload URL is captured for resume
        if (upload.url && upload.url !== existingUploadUrl) {
          void updateTusUploadUrl(source, recordId, upload.url, execute);
        }
      },
      onError: (error) => {
        reject(new Error(`TUS upload failed: ${sanitizeError(error)}`));
      },
      onSuccess: () => {
        // Clear upload URL on success
        void updateTusUploadUrl(source, recordId, null, execute);
        resolve({ etag: "tus-completed", uploadUrl: upload.url });
      },
    });

    // Override to use file stream
    upload._source = {
      size: fileSize,
      slice: (start: number, end: number) => {
        const stream = createReadStream(tempFilePath, { start, end: end - 1 });
        return stream as unknown as Blob;
      },
    };

    upload.start();
  });
}

// Update source record with storage metadata (source-specific, no updatedAt)
async function updateSourceRecordMetadata(
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

  const updates: Record<string, unknown> = {
    storageProvider: "supabase",
    storageBucket: bucket,
    storagePath: path,
    storageSize: size,
    storageMimeType: mimeType,
    storageEtag: etag,
    storageUploadedAt: now,
  };

  // Only add updatedAt for sources that have it
  if (source !== "governance_uploads") {
    updates.updatedAt = now;
  }

  await db.update(table).set(updates).where(eq(table.id, recordId));
}

// Clear storage metadata (rollback)
async function clearStorageMetadata(
  source: StorageFileSource,
  recordId: number,
  execute: boolean
): Promise<void> {
  if (!execute) return;

  const table = SOURCE_TABLES[source];
  const now = new Date();

  const updates: Record<string, unknown> = {
    storageProvider: null,
    storageBucket: null,
    storagePath: null,
    storageSize: null,
    storageMimeType: null,
    storageEtag: null,
    storageUploadedAt: null,
  };

  if (source !== "governance_uploads") {
    updates.updatedAt = now;
  }

  await db.update(table).set(updates).where(eq(table.id, recordId));
}

// Verify application route with streaming response
async function verifyApplicationRouteStreamed(
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

    const contentResponse = await fetch(redirectUrl);
    if (!contentResponse.ok) {
      return { ok: false, error: `Content fetch failed: ${contentResponse.status}` };
    }

    // Stream response and calculate SHA-256
    const reader = contentResponse.body?.getReader();
    if (!reader) {
      return { ok: false, error: "No response body" };
    }

    const hash = createHash("sha256");
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const buffer = Buffer.from(value);
      hash.update(buffer);
      totalBytes += buffer.length;

      // Safety check
      if (totalBytes > expectedSize * 2) {
        return { ok: false, error: "Downloaded size exceeds expected" };
      }
    }

    if (totalBytes !== expectedSize) {
      return { ok: false, error: `Content size mismatch: expected ${expectedSize}, got ${totalBytes}` };
    }

    const actualSha256 = hash.digest("hex");
    if (actualSha256 !== expectedSha256) {
      return { ok: false, error: "Content SHA-256 mismatch" };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: sanitizeError(err) };
  }
}

// Fetch records eligible for migration
async function fetchEligibleRecords(
  source: StorageFileSource,
  recordIds?: number[],
  limit?: number
): Promise<Array<{ id: number; fileName: string | null; fileType: string | null; legacyDataPrefix: string | null; legacyDataLength: number }>> {
  const table = SOURCE_TABLES[source];
  const legacyColumn = LEGACY_COLUMNS[source];

  // Fetch metadata only - not full Base64 content
  let query = db
    .select({
      id: table.id,
      fileName: source === "governance_uploads" ? sql<string | null>`${sql.raw("file_name")}` : table.fileName,
      fileType: source === "governance_uploads" ? sql<string | null>`null` : table.fileType,
      // Only fetch prefix for MIME detection (first 100 chars for data URL)
      legacyDataPrefix: sql<string | null>`substring(${sql.raw(legacyColumn)}, 1, 100)`,
      legacyDataLength: sql<number>`length(${sql.raw(legacyColumn)})`,
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
  return rows.filter((r) => !(source === "smp_documents" && r.id === 31));
}

// Fetch full legacy data for a specific record (bounded query)
async function fetchLegacyData(
  source: StorageFileSource,
  recordId: number
): Promise<string | null> {
  const table = SOURCE_TABLES[source];
  const legacyColumn = LEGACY_COLUMNS[source];

  const rows = await db
    .select({ legacyData: sql<string>`${sql.raw(legacyColumn)}` })
    .from(table)
    .where(eq(table.id, recordId))
    .limit(1);

  return rows[0]?.legacyData || null;
}

// Validate APP_BASE_URL for production
function validateAppBaseUrl(url: string | undefined, isExecute: boolean): { valid: boolean; error?: string } {
  if (!isExecute) {
    return { valid: true };
  }

  if (!url) {
    return { valid: false, error: "APP_BASE_URL environment variable is required for execute mode" };
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

    // Reject fragments
    if (parsed.hash && parsed.hash !== "") {
      return { valid: false, error: "APP_BASE_URL cannot contain fragments" };
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
  record: { id: number; fileName: string | null; fileType: string | null; legacyDataPrefix: string | null; legacyDataLength: number },
  supabase: SupabaseClient,
  options: MigrationOptions,
  baseUrl: string
): Promise<{ success: boolean; state?: string; error?: string; skipped?: boolean }> {
  const { execute } = options;
  const filename = record.fileName || "unnamed";
  const bucket = SOURCE_BUCKETS[source];
  const path = generateStoragePath(source, record.id, filename);

  // Create temp directory and file path (before any early returns)
  let tempDir = "";
  let tempFilePath = "";
  let cleanupNeeded = false;

  try {
    // Create private temp directory
    tempDir = await createPrivateTempDir();
    tempFilePath = join(tempDir, "payload.tmp");
    cleanupNeeded = true;

    // Try to acquire worker lease
    const leaseAcquired = await tryAcquireWorkerLease(source, record.id, execute);
    if (!leaseAcquired) {
      return { success: false, skipped: true, error: "Record locked by another worker or lease active" };
    }

    // Check existing ledger entry for state-based continuation
    const ledger = await getLedgerEntry(source, record.id);
    const currentState = ledger?.state || "inventoried";

    // Terminal states - skip
    if (currentState === "app_verified" || currentState === "excluded") {
      return { success: true, skipped: true, state: currentState };
    }

    // Conflict state - requires human review
    if (currentState === "conflict") {
      return { success: false, skipped: true, state: "conflict", error: "Requires human review - object conflict" };
    }

    // Fetch full legacy data (after acquiring lease)
    const legacyData = await fetchLegacyData(source, record.id);
    if (!legacyData) {
      return { success: false, error: "No legacy data found" };
    }

    // Parse data URL header and extract MIME
    const { mimeType: dataUrlMime, headerLength } = parseDataUrlHeader(legacyData);
    const detectedMime = inferMimeType(filename, dataUrlMime, record.fileType);

    // Extract Base64 data (after header)
    const base64Data = dataUrlMime ? legacyData.slice(headerLength) : legacyData;

    // Decode Base64 in chunks to temp file
    let decodedResult: { size: number; sha256: string };
    try {
      decodedResult = await decodeLegacyDataChunked(base64Data, tempFilePath);
    } catch (err) {
      return { success: false, error: `Failed to decode Base64: ${sanitizeError(err)}` };
    }

    if (decodedResult.size === 0) {
      return { success: false, error: "Empty payload" };
    }

    // Upsert ledger entry (dry-run safe - no writes in dry-run)
    if (execute) {
      await db
        .insert(legacyStorageMigrationLedger)
        .values({
          source,
          recordId: record.id,
          bucket,
          storagePath: path,
          originalFilename: filename,
          expectedSize: decodedResult.size,
          legacySha256: decodedResult.sha256,
          detectedMimeType: detectedMime,
          state: "inventoried",
        })
        .onConflictDoUpdate({
          target: [legacyStorageMigrationLedger.source, legacyStorageMigrationLedger.recordId],
          set: { updatedAt: new Date() },
        });
    }

    await incrementAttemptCount(source, record.id, execute);

    // State-based continuation logic
    let uploadResult: { etag: string | null; uploadUrl: string | null } = { etag: null, uploadUrl: null };
    let objectVerified = false;

    // Handle different starting states
    if (currentState === "uploaded" || currentState === "object_verified") {
      // Previous upload recorded - verify existing object
      const existingCheck = await verifyExistingObjectStreamed(
        supabase, bucket, path, decodedResult.size, decodedResult.sha256, detectedMime
      );

      if (existingCheck.matches) {
        objectVerified = true;
        uploadResult = { etag: "existing-verified", uploadUrl: null };
      } else {
        // Previous upload failed verification
        if (currentState === "object_verified") {
          await updateLedgerState(source, record.id, "failed", execute, existingCheck.reason);
          return { success: false, error: `Previous upload verification failed: ${existingCheck.reason}` };
        }
        // Otherwise, re-upload
      }
    }

    // Check for existing object before upload (idempotency)
    if (!objectVerified) {
      const existingCheck = await verifyExistingObjectStreamed(
        supabase, bucket, path, decodedResult.size, decodedResult.sha256, detectedMime
      );

      if (existingCheck.matches) {
        // Object already exists and matches - reuse it
        console.log(`    [${source}:${record.id}] Existing object verified - reusing`);
        objectVerified = true;
        uploadResult = { etag: "existing-verified", uploadUrl: null };
        await updateLedgerState(source, record.id, "uploaded", execute);
        await updateLedgerState(source, record.id, "object_verified", execute);
      } else if (existingCheck.reason !== "Object not found") {
        // Object exists but doesn't match
        await updateLedgerState(source, record.id, "conflict", execute, existingCheck.reason);
        return {
          success: false,
          state: "conflict",
          error: `Object conflict: ${existingCheck.reason}. Human review required.`,
        };
      }
    }

    // Upload if not already verified
    if (!objectVerified) {
      await updateLedgerState(source, record.id, "uploading", execute);

      try {
        uploadResult = await uploadWithTusResumable(
          supabase,
          bucket,
          path,
          tempFilePath,
          detectedMime,
          decodedResult.size,
          ledger?.tusUploadUrl,
          source,
          record.id,
          execute
        );
      } catch (err) {
        await updateLedgerState(source, record.id, "failed", execute, sanitizeError(err));
        return { success: false, error: `Upload failed: ${sanitizeError(err)}` };
      }

      await updateLedgerState(source, record.id, "uploaded", execute);

      // Verify uploaded object
      const verifyResult = await verifyExistingObjectStreamed(
        supabase,
        bucket,
        path,
        decodedResult.size,
        decodedResult.sha256,
        detectedMime
      );

      if (!verifyResult.matches) {
        await updateLedgerState(source, record.id, "failed", execute, verifyResult.reason);
        return { success: false, error: `Object verification failed: ${verifyResult.reason}` };
      }

      await updateLedgerState(source, record.id, "object_verified", execute);
    }

    // Re-check source record hasn't changed
    const currentLegacyData = await fetchLegacyData(source, record.id);
    if (currentLegacyData !== legacyData) {
      await updateLedgerState(source, record.id, "failed", execute, "Source record changed during migration");
      return { success: false, error: "Source record changed during migration" };
    }

    // Commit metadata
    await updateSourceRecordMetadata(
      source,
      record.id,
      bucket,
      path,
      decodedResult.size,
      detectedMime,
      uploadResult.etag,
      execute
    );

    await updateLedgerState(source, record.id, "metadata_committed", execute);

    // Verify application route
    const appVerify = await verifyApplicationRouteStreamed(
      source,
      record.id,
      decodedResult.size,
      decodedResult.sha256,
      baseUrl,
      execute
    );

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
    // Always release lease
    await releaseWorkerLease(source, record.id, execute).catch(() => {});

    // Always clean up temp directory
    if (cleanupNeeded && tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

// Main migration function
async function runMigration(options: MigrationOptions): Promise<void> {
  const sources = options.sources || (["doc_files", "governance_files", "governance_uploads", "smp_documents"] as StorageFileSource[]);

  // Get and validate APP_BASE_URL
  const rawBaseUrl = process.env.APP_BASE_URL;
  const urlValidation = validateAppBaseUrl(rawBaseUrl, options.execute);

  if (!urlValidation.valid) {
    console.error(`ERROR: ${urlValidation.error}`);
    process.exit(1);
  }

  // Use provided URL or fail in execute mode
  const baseUrl = rawBaseUrl || "";

  if (options.execute && !baseUrl) {
    console.error("ERROR: APP_BASE_URL is required for execute mode");
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
  console.log(`Base URL: ${baseUrl || "(none)"}`);
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

// Recursive orphan audit with folder traversal
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

  // Classify a single object
  function classifyObject(bucket: string, path: string): string {
    const key = `${bucket}:${path}`;

    if (tablePaths.has(key)) return "referenced";
    if (intentPendingPaths.has(key)) return "active_upload_intent";
    if (intentFinalizedPaths.has(key)) return "finalized_upload_intent";
    if (ledgerVerifiedPaths.has(key)) return "migration_verified";
    if (ledgerStagedPaths.has(key)) return "migration_staged";
    return "possible_orphan";
  }

  // Recursive prefix traversal
  async function scanPrefix(bucket: string, prefix: string, visitedPrefixes: Set<string>): Promise<Array<{ path: string; size: number | null; classification: string }>> {
    if (visitedPrefixes.has(prefix)) return [];
    visitedPrefixes.add(prefix);

    const results: Array<{ path: string; size: number | null; classification: string }> = [];
    let offset = 0;
    const limit = 1000;

    while (true) {
      const { data: objects, error } = await supabase.storage.from(bucket).list(prefix, {
        limit,
        offset,
      });

      if (error) {
        console.log(`  Error listing ${prefix}: ${sanitizeError(error)}`);
        // Return indeterminate classification for this prefix
        return [{ path: `${prefix}/*`, size: null, classification: "indeterminate" }];
      }

      if (!objects || objects.length === 0) {
        break;
      }

      for (const obj of objects) {
        const fullPath = prefix ? `${prefix}/${obj.name}` : obj.name;

        if (obj.id === null) {
          // This is a folder - recurse
          const subResults = await scanPrefix(bucket, fullPath, visitedPrefixes);
          results.push(...subResults);
        } else {
          // This is an object
          const classification = classifyObject(bucket, fullPath);
          results.push({
            path: fullPath,
            size: obj.metadata?.size || null,
            classification,
          });
        }
      }

      if (objects.length < limit) {
        break;
      }
      offset += limit;
    }

    return results;
  }

  // Scan each bucket
  for (const bucket of buckets) {
    console.log(`\n--- Scanning bucket: ${bucket} ---`);

    const visitedPrefixes = new Set<string>();
    const results = await scanPrefix(bucket, "", visitedPrefixes);

    // Report results
    const counts: Record<string, number> = {};
    for (const { classification } of results) {
      counts[classification] = (counts[classification] || 0) + 1;
    }

    console.log(`  Total objects: ${results.length}`);
    for (const [classification, count] of Object.entries(counts)) {
      console.log(`  ${classification}: ${count}`);
    }

    // Report possible orphans
    const orphans = results.filter((r) => r.classification === "possible_orphan");
    if (orphans.length > 0) {
      console.log(`  Possible orphans (${orphans.length}):`);
      for (const orphan of orphans.slice(0, 10)) {
        console.log(`    - ${orphan.path} (${orphan.size || "unknown"} bytes)`);
      }
      if (orphans.length > 10) {
        console.log(`    ... and ${orphans.length - 10} more`);
      }
    }
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
