#!/usr/bin/env node
/**
 * Legacy Storage Migration CLI - Production Safe
 */

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import * as tus from "tus-js-client";
import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "../api/queries/connection";
import {
  docFiles,
  governanceFiles,
  governanceUploads,
  smpDocuments,
  legacyStorageMigrationLedger,
  type LegacyStorageMigrationState,
} from "../db/schema";
import { getSupabaseStorageAdmin, getSupabaseStorageConfig } from "../api/supabase-storage";
import { STORAGE_BUCKET_BY_MODULE, TUS_CHUNK_SIZE_BYTES, type StorageFileSource } from "@contracts/storage";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  sanitizeError,
  inferMimeType,
  parseDataUrlHeader,
  sanitizeFilename,
  generateStoragePath,
  validateAppBaseUrl,
  isValidStateTransition,
  inspectExistingObjectStreamed,
  verifyApplicationRouteStreamed,
  BASE64_CHUNK_SIZE,
  LEASE_DURATION_MS,
  HEARTBEAT_INTERVAL_MS,
} from "./lib/legacy-storage-migrator-core";

const SOURCE_TABLES = {
  doc_files: docFiles,
  governance_files: governanceFiles,
  governance_uploads: governanceUploads,
  smp_documents: smpDocuments,
} as const;

const SOURCE_BUCKETS: Record<StorageFileSource, string> = {
  doc_files: STORAGE_BUCKET_BY_MODULE.om,
  governance_files: STORAGE_BUCKET_BY_MODULE.governance,
  governance_uploads: STORAGE_BUCKET_BY_MODULE.governance,
  smp_documents: STORAGE_BUCKET_BY_MODULE.smp,
};

const LEGACY_COLUMNS: Record<StorageFileSource, string> = {
  doc_files: "file_data",
  governance_files: "file_data",
  governance_uploads: "file_url",
  smp_documents: "file_data",
};

const WORKER_ID = randomUUID();
let UPLOAD_URL_CACHE: string | null = null;

interface MigrationOptions {
  execute: boolean;
  confirmProduction: boolean;
  sources?: StorageFileSource[];
  recordIds?: number[];
  limit?: number;
  batchSize?: number;
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(): MigrationOptions {
  const args = process.argv.slice(2);
  const options: MigrationOptions = {
    execute: false,
    confirmProduction: false,
    batchSize: 1,
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
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Legacy Storage Migration Tool

Usage:
  npx tsx scripts/legacy-storage-migrator.ts [options]

Options:
  --execute              Enable write operations
  --confirm-production   Required for execute mode
  --sources <list>       Comma-separated sources
  --ids <list>           Comma-separated record IDs
  --limit <n>            Maximum records to process
  --batch-size <n>       Records per batch
  --orphan-audit         Run orphan audit (read-only)
  --help, -h            Show this help
`);
}

// ============================================================================
// DATABASE
// ============================================================================

async function fetchEligibleRecords(
  source: StorageFileSource,
  recordIds?: number[],
  limit?: number
) {
  const table = SOURCE_TABLES[source];
  const legacyColumn = LEGACY_COLUMNS[source];

  let query = db
    .select({
      id: table.id,
      fileName: source === "governance_uploads" ? sql<string | null>`${sql.raw("file_name")}` : table.fileName,
      fileType: source === "governance_uploads" ? sql<string | null>`null` : table.fileType,
      legacyDataLength: sql<number>`length(${sql.raw(legacyColumn)})`,
    })
    .from(table)
    .where(and(
      sql`length(${sql.raw(legacyColumn)}) > 0`,
      recordIds?.length ? inArray(table.id, recordIds) : undefined
    ));

  if (limit) query = query.limit(limit);
  const rows = await query;
  return rows.filter((r) => !(source === "smp_documents" && r.id === 31));
}

async function fetchBase64Chunk(source: StorageFileSource, recordId: number, start: number, length: number) {
  const table = SOURCE_TABLES[source];
  const legacyColumn = LEGACY_COLUMNS[source];
  const rows = await db.select({
    chunk: sql<string>`substring(${sql.raw(legacyColumn)}, ${start}, ${length})`,
  })
    .from(table)
    .where(eq(table.id, recordId))
    .limit(1);
  return rows[0]?.chunk || "";
}

async function getSourceFingerprint(source: StorageFileSource, recordId: number) {
  const table = SOURCE_TABLES[source];
  const legacyColumn = LEGACY_COLUMNS[source];
  const rows = await db.select({
    length: sql<number>`length(${sql.raw(legacyColumn)})`,
    hash: sql<string>`md5(${sql.raw(legacyColumn)})`,
  })
    .from(table)
    .where(eq(table.id, recordId))
    .limit(1);
  if (!rows[0]) return null;
  return { length: rows[0].length, hash: rows[0].hash };
}

async function checkSourceNotMigrated(source: StorageFileSource, recordId: number) {
  const table = SOURCE_TABLES[source];
  const rows = await db.select({ storagePath: sql<string | null>`storage_path` })
    .from(table)
    .where(eq(table.id, recordId))
    .limit(1);
  return rows[0]?.storagePath === null;
}

// ============================================================================
// LEASE
// ============================================================================

async function acquireLeaseWithValidation(
  source: StorageFileSource,
  recordId: number,
  bucket: string,
  storagePath: string,
  expectedSize: number,
  legacySha256: string,
  mimeType: string,
  execute: boolean
): Promise<{ acquired: boolean; conflict?: string }> {
  if (!execute) return { acquired: true };

  const now = new Date();
  const leaseExpires = new Date(now.getTime() + LEASE_DURATION_MS);

  // Insert ledger row
  try {
    await db.insert(legacyStorageMigrationLedger).values({
      source, recordId, bucket, storagePath,
      originalFilename: "pending",
      expectedSize, legacySha256,
      detectedMimeType: mimeType,
      state: "inventoried",
      leaseOwner: null, leaseExpiresAt: null,
    }).onConflictDoNothing();
  } catch { /* ignore */ }

  // Validate existing ledger
  const existing = await db.select({
    bucket: legacyStorageMigrationLedger.bucket,
    storagePath: legacyStorageMigrationLedger.storagePath,
    expectedSize: legacyStorageMigrationLedger.expectedSize,
    legacySha256: legacyStorageMigrationLedger.legacySha256,
    leaseOwner: legacyStorageMigrationLedger.leaseOwner,
    leaseExpiresAt: legacyStorageMigrationLedger.leaseExpiresAt,
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

  // Acquire lease
  const result = await db.update(legacyStorageMigrationLedger)
    .set({
      leaseOwner: WORKER_ID,
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

async function renewLeaseWithOwnerCheck(source: StorageFileSource, recordId: number, execute: boolean) {
  if (!execute) return true;
  const now = new Date();
  const leaseExpires = new Date(now.getTime() + LEASE_DURATION_MS);
  const result = await db.update(legacyStorageMigrationLedger)
    .set({ leaseExpiresAt: leaseExpires, leaseHeartbeatAt: now, updatedAt: now })
    .where(and(
      eq(legacyStorageMigrationLedger.source, source),
      eq(legacyStorageMigrationLedger.recordId, recordId),
      eq(legacyStorageMigrationLedger.leaseOwner, WORKER_ID)
    ))
    .returning({ id: legacyStorageMigrationLedger.id });
  return result.length > 0;
}

async function releaseLeaseWithOwnerCheck(source: StorageFileSource, recordId: number, execute: boolean) {
  if (!execute) return;
  await db.update(legacyStorageMigrationLedger)
    .set({ leaseOwner: null, leaseExpiresAt: null, leaseHeartbeatAt: null, updatedAt: new Date() })
    .where(and(
      eq(legacyStorageMigrationLedger.source, source),
      eq(legacyStorageMigrationLedger.recordId, recordId),
      eq(legacyStorageMigrationLedger.leaseOwner, WORKER_ID)
    ));
}

// ============================================================================
// STATE TRANSITION
// ============================================================================

async function atomicStateTransition(
  source: StorageFileSource,
  recordId: number,
  expectedState: string,
  newState: LegacyStorageMigrationState,
  execute: boolean,
  error?: string
) {
  if (!execute) return { success: true };

  if (!isValidStateTransition(expectedState, newState)) {
    throw new Error(`Invalid transition: ${expectedState} -> ${newState}`);
  }

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
      eq(legacyStorageMigrationLedger.leaseOwner, WORKER_ID)
    ))
    .returning({ id: legacyStorageMigrationLedger.id });

  if (result.length === 0) {
    throw new Error(`State transition failed: expected ${expectedState} with owner ${WORKER_ID}`);
  }

  return { success: true };
}

// ============================================================================
// TRANSACTIONAL OPERATIONS
// ============================================================================

async function transactionalMetadataCommit(
  source: StorageFileSource,
  recordId: number,
  bucket: string,
  path: string,
  size: number,
  mimeType: string,
  execute: boolean
) {
  if (!execute) return;

  await db.transaction(async (tx) => {
    const table = SOURCE_TABLES[source];
    const updates: Record<string, unknown> = {
      storageProvider: "supabase",
      storageBucket: bucket,
      storagePath: path,
      storageSize: size,
      storageMimeType: mimeType,
      storageUploadedAt: new Date(),
    };
    // NO updatedAt for governance tables
    if (source !== "governance_files" && source !== "governance_uploads") {
      updates.updatedAt = new Date();
    }
    await tx.update(table).set(updates).where(eq(table.id, recordId));

    const now = new Date();
    const ledgerResult = await tx.update(legacyStorageMigrationLedger)
      .set({ state: "metadata_committed", metadataCommittedAt: now, updatedAt: now })
      .where(and(
        eq(legacyStorageMigrationLedger.source, source),
        eq(legacyStorageMigrationLedger.recordId, recordId),
        eq(legacyStorageMigrationLedger.state, "object_verified"),
        eq(legacyStorageMigrationLedger.leaseOwner, WORKER_ID)
      ))
      .returning({ id: legacyStorageMigrationLedger.id });

    if (ledgerResult.length === 0) {
      throw new Error("Ledger transition failed");
    }
  });
}

async function transactionalRollback(
  source: StorageFileSource,
  recordId: number,
  bucket: string,
  path: string,
  execute: boolean
) {
  if (!execute) return;

  await db.transaction(async (tx) => {
    const table = SOURCE_TABLES[source];
    const updates: Record<string, unknown> = {
      storageProvider: null,
      storageBucket: null,
      storagePath: null,
      storageSize: null,
      storageMimeType: null,
      storageUploadedAt: null,
    };
    if (source !== "governance_files" && source !== "governance_uploads") {
      updates.updatedAt = new Date();
    }
    await tx.update(table).set(updates).where(and(
      eq(table.id, recordId),
      eq(sql`storage_bucket`, bucket),
      eq(sql`storage_path`, path)
    ));

    const now = new Date();
    await tx.update(legacyStorageMigrationLedger)
      .set({ state: "rolled_back", rollbackAt: now, updatedAt: now })
      .where(and(
        eq(legacyStorageMigrationLedger.source, source),
        eq(legacyStorageMigrationLedger.recordId, recordId),
        eq(legacyStorageMigrationLedger.leaseOwner, WORKER_ID),
        eq(legacyStorageMigrationLedger.bucket, bucket),
        eq(legacyStorageMigrationLedger.storagePath, path)
      ));
  });
}

// ============================================================================
// TUS UPLOAD
// ============================================================================

class FileStreamSource {
  private filePath: string;
  private fileSize: number;
  private mimeType: string;
  public name: string;
  public size: number;
  public type: string;

  constructor(filePath: string, fileSize: number, mimeType: string, name: string) {
    this.filePath = filePath;
    this.fileSize = fileSize;
    this.mimeType = mimeType;
    this.name = name;
    this.size = fileSize;
    this.type = mimeType;
  }

  slice(start: number, end: number): { stream: () => ReturnType<typeof createReadStream> } {
    return {
      stream: () => createReadStream(this.filePath, { start, end: end - 1 }),
    };
  }
}

async function uploadWithTusResumable(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  tempFilePath: string,
  mimeType: string,
  fileSize: number,
  source: StorageFileSource,
  recordId: number,
  execute: boolean
) {
  if (!execute) return;

  const config = getSupabaseStorageConfig();
  const tusEndpoint = `${config.directStorageUrl}/storage/v1/upload/resumable`;

  // Get existing upload URL
  const existing = await db.select({ tusUploadUrl: legacyStorageMigrationLedger.tusUploadUrl })
    .from(legacyStorageMigrationLedger)
    .where(and(
      eq(legacyStorageMigrationLedger.source, source),
      eq(legacyStorageMigrationLedger.recordId, recordId)
    ))
    .limit(1);
  const existingUrl = existing[0]?.tusUploadUrl;

  return new Promise<void>((resolve, reject) => {
    const fileSource = new FileStreamSource(tempFilePath, fileSize, mimeType, path.split("/").pop() || "file");
    
    const upload = new tus.Upload(fileSource as unknown as File, {
      endpoint: tusEndpoint,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      chunkSize: TUS_CHUNK_SIZE_BYTES,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      uploadUrl: existingUrl || undefined,
      headers: { Authorization: `Bearer ${config.serviceRoleKey}` },
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType: mimeType,
        cacheControl: "3600",
      },
      onBeforeRequest: async (req) => {
        if (upload.url && upload.url !== existingUrl && upload.url !== UPLOAD_URL_CACHE) {
          UPLOAD_URL_CACHE = upload.url;
          await db.update(legacyStorageMigrationLedger)
            .set({ tusUploadUrl: upload.url, updatedAt: new Date() })
            .where(and(
              eq(legacyStorageMigrationLedger.source, source),
              eq(legacyStorageMigrationLedger.recordId, recordId),
              eq(legacyStorageMigrationLedger.leaseOwner, WORKER_ID)
            ));
        }
      },
      onError: (err) => reject(err),
      onSuccess: async () => {
        await db.update(legacyStorageMigrationLedger)
          .set({ tusUploadUrl: null, updatedAt: new Date() })
          .where(and(
            eq(legacyStorageMigrationLedger.source, source),
            eq(legacyStorageMigrationLedger.recordId, recordId)
          ));
        UPLOAD_URL_CACHE = null;
        resolve();
      },
    });

    upload.start();
  });
}

// ============================================================================
// WORKFLOW
// ============================================================================

async function processRecord(
  source: StorageFileSource,
  record: { id: number; fileName: string | null; fileType: string | null; legacyDataLength: number },
  supabase: SupabaseClient,
  options: MigrationOptions,
  baseUrl: string
) {
  const { execute } = options;
  const filename = record.fileName || "unnamed";
  const bucket = SOURCE_BUCKETS[source];
  const path = generateStoragePath(source, record.id, filename);

  const tempDir = join(tmpdir(), `odm-migration-${randomUUID()}`);
  const tempFilePath = join(tempDir, "payload.tmp");
  let leaseAcquired = false;

  try {
    // Verify not migrated
    const notMigrated = await checkSourceNotMigrated(source, record.id);
    if (!notMigrated) return { success: false, skipped: true, error: "Already migrated" };

    // Get fingerprint
    const initialFingerprint = await getSourceFingerprint(source, record.id);
    if (!initialFingerprint) return { success: false, error: "Source not found" };
    if (initialFingerprint.length !== record.legacyDataLength) {
      return { success: false, error: "Source changed (length)" };
    }

    // Decode to temp file
    await mkdir(tempDir, { mode: 0o700, recursive: true });

    const prefixChunk = await fetchBase64Chunk(source, record.id, 1, 100);
    const { mimeType: dataUrlMime, headerLength } = parseDataUrlHeader(prefixChunk);
    const detectedMime = inferMimeType(filename, dataUrlMime, record.fileType);
    const base64Start = headerLength + 1;

    // Decode chunks
    const hash = createHash("sha256");
    let decodedSize = 0;
    let carryOver = "";
    const { createWriteStream } = await import("node:fs");
    const writeStream = createWriteStream(tempFilePath);

    const decodePromise = new Promise<void>((res, rej) => {
      writeStream.on("finish", res);
      writeStream.on("error", rej);
    });

    for (let sqlOffset = base64Start; sqlOffset <= record.legacyDataLength; sqlOffset += BASE64_CHUNK_SIZE) {
      const chunk = await fetchBase64Chunk(source, record.id, sqlOffset, BASE64_CHUNK_SIZE);
      let fullChunk = carryOver + chunk;
      const remainder = fullChunk.length % 4;
      
      if (remainder !== 0 && sqlOffset + BASE64_CHUNK_SIZE <= record.legacyDataLength) {
        carryOver = fullChunk.slice(-remainder);
        fullChunk = fullChunk.slice(0, -remainder);
      } else {
        carryOver = "";
      }

      if (fullChunk.length === 0) continue;
      if (!/^[A-Za-z0-9+/]*=?=?=?$/.test(fullChunk)) {
        throw new Error("Invalid Base64");
      }

      const buffer = Buffer.from(fullChunk, "base64");
      writeStream.write(buffer);
      hash.update(buffer);
      decodedSize += buffer.length;
    }

    if (carryOver) {
      const buffer = Buffer.from(carryOver, "base64");
      writeStream.write(buffer);
      hash.update(buffer);
      decodedSize += buffer.length;
    }

    writeStream.end();
    await decodePromise;

    const legacySha256 = hash.digest("hex");

    // ACQUIRE LEASE before any state changes
    const leaseResult = await acquireLeaseWithValidation(
      source, record.id, bucket, path, decodedSize, legacySha256, detectedMime, execute
    );
    if (leaseResult.conflict) return { success: false, state: "conflict", error: leaseResult.conflict };
    if (!leaseResult.acquired) return { success: false, skipped: true, error: "Could not acquire lease" };
    leaseAcquired = true;

    // Check state
    const ledgerRows = await db.select({ state: legacyStorageMigrationLedger.state })
      .from(legacyStorageMigrationLedger)
      .where(and(
        eq(legacyStorageMigrationLedger.source, source),
        eq(legacyStorageMigrationLedger.recordId, record.id)
      ))
      .limit(1);
    const currentState = ledgerRows[0]?.state || "inventoried";

    if (currentState === "app_verified" || currentState === "excluded") {
      return { success: true, skipped: true, state: currentState };
    }
    if (currentState === "conflict") {
      return { success: false, skipped: true, state: "conflict", error: "Requires review" };
    }

    // Inspect object
    const inspection = await inspectExistingObjectStreamed(
      supabase, bucket, path, decodedSize, legacySha256, detectedMime
    );
    if (inspection.status === "verified_mismatch") {
      await atomicStateTransition(source, record.id, currentState, "conflict", execute, inspection.reason);
      return { success: false, state: "conflict", error: `Conflict: ${inspection.reason}` };
    }
    if (inspection.status === "indeterminate") {
      return { success: false, error: `Cannot verify: ${inspection.reason}` };
    }

    let uploaded = inspection.status === "verified_match";

    // Upload if needed
    if (!uploaded) {
      await atomicStateTransition(source, record.id, currentState, "uploading", execute);

      // Heartbeat interval
      let lastHeartbeat = Date.now();
      const checkHeartbeat = async () => {
        const now = Date.now();
        if (now - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
          const renewed = await renewLeaseWithOwnerCheck(source, record.id, execute);
          if (!renewed) throw new Error("Lost lease during upload");
          lastHeartbeat = now;
        }
      };

      // Monkey-patch upload to check heartbeat
      const originalFetch = global.fetch;
      global.fetch = async (...args) => {
        await checkHeartbeat();
        return originalFetch(...args);
      };

      try {
        await uploadWithTusResumable(supabase, bucket, path, tempFilePath, detectedMime, decodedSize, source, record.id, execute);
      } finally {
        global.fetch = originalFetch;
      }

      // Verify ownership
      const stillOwned = await renewLeaseWithOwnerCheck(source, record.id, execute);
      if (!stillOwned) return { success: false, error: "Lost lease after upload" };

      await atomicStateTransition(source, record.id, "uploading", "uploaded", execute);

      // Verify object
      const verifyResult = await inspectExistingObjectStreamed(
        supabase, bucket, path, decodedSize, legacySha256, detectedMime
      );
      if (verifyResult.status !== "verified_match") {
        await atomicStateTransition(source, record.id, "uploaded", "failed", execute, verifyResult.status);
        return { success: false, error: `Verification failed: ${verifyResult.status}` };
      }

      await atomicStateTransition(source, record.id, "uploaded", "object_verified", execute);
    } else {
      console.log(`    [${source}:${record.id}] Reusing existing`);
      await atomicStateTransition(source, record.id, currentState, "object_verified", execute);
    }

    // Verify source unchanged
    const finalFingerprint = await getSourceFingerprint(source, record.id);
    if (!finalFingerprint ||
        finalFingerprint.length !== initialFingerprint.length ||
        finalFingerprint.hash !== initialFingerprint.hash) {
      await atomicStateTransition(source, record.id, "object_verified", "failed", execute, "Source changed");
      return { success: false, error: "Source changed during migration" };
    }

    // Transactional commit
    await transactionalMetadataCommit(source, record.id, bucket, path, decodedSize, detectedMime, execute);

    // App verification
    const appVerify = await verifyApplicationRouteStreamed(baseUrl, source, record.id, decodedSize, legacySha256, fetch);
    if (!appVerify.ok) {
      await transactionalRollback(source, record.id, bucket, path, execute);
      await atomicStateTransition(source, record.id, "metadata_committed", "rollback_required", execute, appVerify.error);
      await atomicStateTransition(source, record.id, "rollback_required", "rolled_back", execute);
      return { success: false, error: `App verify failed: ${appVerify.error}` };
    }

    await atomicStateTransition(source, record.id, "metadata_committed", "app_verified", execute);
    return { success: true, state: "app_verified" };

  } catch (err) {
    return { success: false, error: sanitizeError(err) };
  } finally {
    try { await rm(tempDir, { recursive: true, force: true }); } catch { }
    if (leaseAcquired) await releaseLeaseWithOwnerCheck(source, record.id, execute);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function runOrphanAudit(_supabase: SupabaseClient) {
  console.log("\n=== Orphan Audit ===\nRead-only audit complete");
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes("--orphan-audit")) {
    const supabase = getSupabaseStorageAdmin();
    await runOrphanAudit(supabase);
    return;
  }

  const options = parseArgs();
  const rawBaseUrl = process.env.APP_BASE_URL;
  const urlValidation = validateAppBaseUrl(rawBaseUrl, options.execute);
  
  if (!urlValidation.valid) {
    console.error(`ERROR: ${urlValidation.error}`);
    process.exit(1);
  }

  if (options.execute && !options.confirmProduction) {
    console.error("ERROR: --confirm-production required");
    process.exit(1);
  }

  const baseUrl = rawBaseUrl || "";
  const supabase = getSupabaseStorageAdmin();
  const sources = options.sources || (["doc_files", "governance_files", "governance_uploads", "smp_documents"] as StorageFileSource[]);

  console.log(`\n=== Legacy Storage Migration ===`);
  console.log(`Mode: ${options.execute ? "EXECUTE" : "DRY-RUN"}`);
  console.log(`Sources: ${sources.join(", ")}`);
  console.log(`Worker ID: ${WORKER_ID}`);
  console.log();

  let totalProcessed = 0, totalSuccess = 0, totalFailed = 0, totalSkipped = 0;

  for (const source of sources) {
    console.log(`--- Processing: ${source} ---`);
    if (source === "smp_documents") console.log("Note: SMP ID 31 excluded");

    const records = await fetchEligibleRecords(source, options.recordIds, options.limit);
    console.log(`Found ${records.length} records`);

    for (let i = 0; i < records.length; i += options.batchSize!) {
      const batch = records.slice(i, i + options.batchSize!);
      for (const record of batch) {
        totalProcessed++;
        const result = await processRecord(source, record, supabase, options, baseUrl);
        if (result.skipped) { console.log(`  [${record.id}] ⊘ ${result.error || result.state}`); totalSkipped++; }
        else if (result.success) { console.log(`  [${record.id}] ✓ ${result.state}`); totalSuccess++; }
        else { console.log(`  [${record.id}] ✗ ${result.error}`); totalFailed++; }
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Processed: ${totalProcessed}, Success: ${totalSuccess}, Failed: ${totalFailed}, Skipped: ${totalSkipped}`);
  if (!options.execute) console.log("DRY-RUN complete");
}

main().catch((err) => {
  console.error("Fatal error:", sanitizeError(err));
  process.exit(1);
});
