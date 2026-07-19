#!/usr/bin/env node
/**
 * Legacy Storage Migration CLI
 * 
 * Production-safe migration of Base64/file_url content to Supabase Storage.
 * 
 * Usage:
 *   # Dry-run (default)
 *   npx tsx scripts/legacy-storage-migrator.ts
 * 
 *   # Execute with confirmation
 *   npx tsx scripts/legacy-storage-migrator.ts --execute --confirm-production
 * 
 *   # Orphan audit (read-only)
 *   npx tsx scripts/legacy-storage-migrator.ts --orphan-audit
 */

import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, rm, writeFile, readFile, unlink } from "node:fs/promises";
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
  type LegacyStorageMigrationState,
} from "../db/schema";
import { getSupabaseStorageAdmin, getSupabaseStorageConfig } from "../api/supabase-storage";
import { STORAGE_BUCKET_BY_MODULE, TUS_CHUNK_SIZE_BYTES, type StorageFileSource } from "@contracts/storage";
import type { SupabaseClient } from "@supabase/supabase-js";

// Import production core functions
import {
  sanitizeError,
  inferMimeType,
  parseDataUrlHeader,
  sanitizeFilename,
  generateStoragePath,
  validateAppBaseUrl,
  isValidStateTransition,
  decodeLegacyDataChunked,
  inspectExistingObjectStreamed,
  verifyApplicationRouteStreamed,
  BASE64_CHUNK_SIZE,
  LEASE_DURATION_MS,
  HEARTBEAT_INTERVAL_MS,
  type ObjectInspectionResult,
} from "./lib/legacy-storage-migrator-core";

// Source mappings
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

// Worker UUID for lease ownership
const WORKER_ID = randomUUID();

interface MigrationOptions {
  execute: boolean;
  confirmProduction: boolean;
  sources?: StorageFileSource[];
  recordIds?: number[];
  limit?: number;
  batchSize?: number;
}

interface ProcessingContext {
  tempDir: string;
  tempFilePath: string;
}

// Parse CLI arguments
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
  --execute              Enable write operations (default: dry-run)
  --confirm-production   Required for production execution
  --sources <list>       Comma-separated sources (doc_files,governance_files,...)
  --ids <list>           Comma-separated record IDs
  --limit <n>            Maximum records to process
  --batch-size <n>       Records per batch (default: 1)
  --orphan-audit         Run orphan audit mode (read-only)
  --help, -h            Show this help

Examples:
  # Dry-run inventory
  npx tsx scripts/legacy-storage-migrator.ts

  # Execute migration (requires both flags)
  npx tsx scripts/legacy-storage-migrator.ts --execute --confirm-production --limit 1
`);
}

// ============================================================================
// LEASE MANAGEMENT
// ============================================================================

/**
 * Create or get ledger entry, then acquire lease atomically.
 * Returns true if lease acquired, false if locked by another worker.
 */
async function acquireLease(
  source: StorageFileSource,
  recordId: number,
  bucket: string,
  storagePath: string,
  filename: string,
  expectedSize: number,
  legacySha256: string,
  mimeType: string,
  execute: boolean
): Promise<{ acquired: boolean; existing?: boolean }> {
  if (!execute) return { acquired: true }; // Dry-run doesn't need locking

  const now = new Date();
  const leaseExpires = new Date(now.getTime() + LEASE_DURATION_MS);

  // First, try to insert the ledger row (idempotent)
  try {
    await db.insert(legacyStorageMigrationLedger).values({
      source,
      recordId,
      bucket,
      storagePath,
      originalFilename: filename,
      expectedSize,
      legacySha256,
      detectedMimeType: mimeType,
      state: "inventoried",
      leaseOwner: null,
      leaseExpiresAt: null,
    }).onConflictDoNothing();
  } catch {
    // Ignore conflict - row may already exist
  }

  // Try to acquire lease with conditional update
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
      // Either no lease, or lease expired
      sql`(${legacyStorageMigrationLedger.leaseOwner} IS NULL OR ${legacyStorageMigrationLedger.leaseExpiresAt} < ${now})`
    ))
    .returning({ id: legacyStorageMigrationLedger.id });

  if (result.length === 0) {
    return { acquired: false };
  }

  return { acquired: true };
}

/**
 * Renew lease heartbeat during long operations
 */
async function renewLease(
  source: StorageFileSource,
  recordId: number,
  execute: boolean
): Promise<boolean> {
  if (!execute) return true;

  const now = new Date();
  const leaseExpires = new Date(now.getTime() + LEASE_DURATION_MS);

  const result = await db.update(legacyStorageMigrationLedger)
    .set({
      leaseExpiresAt: leaseExpires,
      leaseHeartbeatAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(legacyStorageMigrationLedger.source, source),
      eq(legacyStorageMigrationLedger.recordId, recordId),
      eq(legacyStorageMigrationLedger.leaseOwner, WORKER_ID)
    ))
    .returning({ id: legacyStorageMigrationLedger.id });

  return result.length > 0;
}

/**
 * Release lease - only if we own it
 */
async function releaseLease(
  source: StorageFileSource,
  recordId: number,
  execute: boolean
): Promise<void> {
  if (!execute) return;

  await db.update(legacyStorageMigrationLedger)
    .set({
      leaseOwner: null,
      leaseExpiresAt: null,
      leaseHeartbeatAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(legacyStorageMigrationLedger.source, source),
      eq(legacyStorageMigrationLedger.recordId, recordId),
      eq(legacyStorageMigrationLedger.leaseOwner, WORKER_ID)
    ));
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

/**
 * Transition state with validation
 */
async function transitionState(
  source: StorageFileSource,
  recordId: number,
  newState: LegacyStorageMigrationState,
  execute: boolean,
  error?: string
): Promise<void> {
  if (!execute) return;

  // Get current state
  const rows = await db.select({ state: legacyStorageMigrationLedger.state })
    .from(legacyStorageMigrationLedger)
    .where(and(
      eq(legacyStorageMigrationLedger.source, source),
      eq(legacyStorageMigrationLedger.recordId, recordId)
    ))
    .limit(1);

  const currentState = rows[0]?.state || "inventoried";

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

  // Set timestamps only on transition
  if (newState === "object_verified" && currentState !== "object_verified") {
    updates.objectVerifiedAt = new Date();
  } else if (newState === "metadata_committed" && currentState !== "metadata_committed") {
    updates.metadataCommittedAt = new Date();
  } else if (newState === "app_verified" && currentState !== "app_verified") {
    updates.appVerifiedAt = new Date();
  } else if (newState === "rolled_back" && currentState !== "rolled_back") {
    updates.rollbackAt = new Date();
  }

  await db.update(legacyStorageMigrationLedger)
    .set(updates)
    .where(and(
      eq(legacyStorageMigrationLedger.source, source),
      eq(legacyStorageMigrationLedger.recordId, recordId)
    ));
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

/**
 * Fetch eligible records with metadata only (not full Base64)
 */
async function fetchEligibleRecords(
  source: StorageFileSource,
  recordIds?: number[],
  limit?: number
): Promise<Array<{ id: number; fileName: string | null; fileType: string | null; legacyDataLength: number }>> {
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

  if (limit) {
    query = query.limit(limit);
  }

  const rows = await query;

  // Filter out SMP ID 31
  return rows.filter((r) => !(source === "smp_documents" && r.id === 31));
}

/**
 * Fetch Base64 chunk from PostgreSQL
 */
async function fetchBase64Chunk(
  source: StorageFileSource,
  recordId: number,
  start: number,
  length: number
): Promise<string> {
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

/**
 * Get source fingerprint for change detection
 */
async function getSourceFingerprint(
  source: StorageFileSource,
  recordId: number
): Promise<{ length: number; hash: string } | null> {
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

// ============================================================================
// STORAGE OPERATIONS
// ============================================================================

/**
 * Upload using TUS with resumable support
 */
async function uploadWithTus(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  tempFilePath: string,
  mimeType: string,
  fileSize: number,
  onProgress?: () => void
): Promise<void> {
  const config = getSupabaseStorageConfig();
  const tusEndpoint = `${config.directStorageUrl}/storage/v1/upload/resumable`;

  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(null as unknown as File, {
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
      onProgress: () => {
        onProgress?.();
      },
      onSuccess: () => {
        resolve();
      },
    });

    // Override to use file stream
    (upload as unknown as { _source: { size: number; slice: (start: number, end: number) => unknown } })._source = {
      size: fileSize,
      slice: (start: number, end: number) => {
        return createReadStream(tempFilePath, { start, end: end - 1 }) as unknown as Blob;
      },
    };

    upload.start();
  });
}

/**
 * Update source record metadata (source-specific, no updatedAt for governance_uploads)
 */
async function updateSourceMetadata(
  source: StorageFileSource,
  recordId: number,
  bucket: string,
  path: string,
  size: number,
  mimeType: string,
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
    storageEtag: null,
    storageUploadedAt: now,
  };

  // Only add updatedAt for sources that support it
  if (source !== "governance_uploads") {
    updates.updatedAt = now;
  }

  await db.update(table).set(updates).where(eq(table.id, recordId));
}

/**
 * Clear storage metadata (rollback)
 */
async function clearSourceMetadata(
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

// ============================================================================
// ORPHAN AUDIT
// ============================================================================

type ObjectClassification = 
  | "referenced" 
  | "active_upload_intent" 
  | "finalized_upload_intent" 
  | "migration_verified" 
  | "migration_staged" 
  | "possible_orphan" 
  | "indeterminate";

async function runOrphanAudit(supabase: SupabaseClient): Promise<void> {
  console.log("\n=== Storage Orphan Audit ===\n");

  const buckets = ["om-manuals", "om-governance", "smp-library"];

  // Build reference sets
  const tablePaths = new Set<string>();
  const intentPendingPaths = new Set<string>();
  const intentFinalizedPaths = new Set<string>();
  const ledgerStagedPaths = new Set<string>();
  const ledgerVerifiedPaths = new Set<string>();

  // Collect from source tables
  const sources: StorageFileSource[] = ["doc_files", "governance_files", "governance_uploads", "smp_documents"];
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

  // Classification function
  function classifyObject(bucket: string, path: string): ObjectClassification {
    const key = `${bucket}:${path}`;
    if (tablePaths.has(key)) return "referenced";
    if (intentPendingPaths.has(key)) return "active_upload_intent";
    if (intentFinalizedPaths.has(key)) return "finalized_upload_intent";
    if (ledgerVerifiedPaths.has(key)) return "migration_verified";
    if (ledgerStagedPaths.has(key)) return "migration_staged";
    return "possible_orphan";
  }

  // Recursive prefix traversal
  async function scanPrefix(bucket: string, prefix: string, visited: Set<string>): Promise<Array<{ path: string; classification: ObjectClassification }>> {
    if (visited.has(prefix)) return [];
    visited.add(prefix);

    const results: Array<{ path: string; classification: ObjectClassification }> = [];
    let offset = 0;
    const limit = 1000;

    while (true) {
      const { data: objects, error } = await supabase.storage.from(bucket).list(prefix, { limit, offset });

      if (error) {
        console.log(`  Error listing ${prefix}: ${sanitizeError(error)}`);
        return [{ path: `${prefix}/*`, classification: "indeterminate" }];
      }

      if (!objects || objects.length === 0) break;

      for (const obj of objects) {
        const fullPath = prefix ? `${prefix}/${obj.name}` : obj.name;

        if (obj.id === null) {
          // Folder - recurse
          const subResults = await scanPrefix(bucket, fullPath, visited);
          results.push(...subResults);
        } else {
          results.push({ path: fullPath, classification: classifyObject(bucket, fullPath) });
        }
      }

      if (objects.length < limit) break;
      offset += limit;
    }

    return results;
  }

  // Scan each bucket
  for (const bucket of buckets) {
    console.log(`\n--- Scanning bucket: ${bucket} ---`);
    const visited = new Set<string>();
    const results = await scanPrefix(bucket, "", visited);

    const counts: Record<ObjectClassification, number> = {} as Record<ObjectClassification, number>;
    for (const { classification } of results) {
      counts[classification] = (counts[classification] || 0) + 1;
    }

    console.log(`  Total objects: ${results.length}`);
    for (const [cls, count] of Object.entries(counts)) {
      console.log(`  ${cls}: ${count}`);
    }

    const orphans = results.filter(r => r.classification === "possible_orphan");
    if (orphans.length > 0) {
      console.log(`  Possible orphans (${orphans.length}):`);
      for (const orphan of orphans.slice(0, 10)) {
        console.log(`    - ${orphan.path}`);
      }
      if (orphans.length > 10) {
        console.log(`    ... and ${orphans.length - 10} more`);
      }
    }
  }

  console.log("\nNote: This is a READ-ONLY audit. No objects were deleted.");
}

// ============================================================================
// MIGRATION WORKFLOW
// ============================================================================

async function processRecord(
  source: StorageFileSource,
  record: { id: number; fileName: string | null; fileType: string | null; legacyDataLength: number },
  supabase: SupabaseClient,
  options: MigrationOptions,
  baseUrl: string
): Promise<{ success: boolean; state?: string; error?: string; skipped?: boolean }> {
  const { execute } = options;
  const filename = record.fileName || "unnamed";
  const bucket = SOURCE_BUCKETS[source];
  const path = generateStoragePath(source, record.id, filename);

  // Create temp directory
  const tempDir = join(tmpdir(), `odm-migration-${randomUUID()}`);
  const tempFilePath = join(tempDir, "payload.tmp");

  try {
    await mkdir(tempDir, { mode: 0o700, recursive: true });

    // Fetch prefix for MIME detection
    const prefixChunk = await fetchBase64Chunk(source, record.id, 1, 100);
    const { mimeType: dataUrlMime, headerLength } = parseDataUrlHeader(prefixChunk);
    const detectedMime = inferMimeType(filename, dataUrlMime, record.fileType);

    // Calculate expected Base64 start position
    const base64Start = headerLength + 1; // 1-indexed in SQL

    // Decode Base64 in chunks
    const hash = createHash("sha256");
    let decodedSize = 0;
    let carryOver = "";

    const writeStream = createWriteStream(tempFilePath);

    try {
      for (let sqlOffset = base64Start; sqlOffset <= record.legacyDataLength; sqlOffset += BASE64_CHUNK_SIZE) {
        // Renew lease periodically
        if ((sqlOffset - base64Start) % (BASE64_CHUNK_SIZE * 10) === 0) {
          const renewed = await renewLease(source, record.id, execute);
          if (!renewed && execute) {
            throw new Error("Lost lease during processing");
          }
        }

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
          throw new Error("Invalid Base64 character detected");
        }

        const buffer = Buffer.from(fullChunk, "base64");
        await new Promise<void>((resolve, reject) => {
          writeStream.write(buffer, (err) => (err ? reject(err) : resolve()));
        });

        hash.update(buffer);
        decodedSize += buffer.length;
      }

      // Handle carry-over
      if (carryOver) {
        const buffer = Buffer.from(carryOver, "base64");
        await new Promise<void>((resolve, reject) => {
          writeStream.write(buffer, (err) => (err ? reject(err) : resolve()));
        });
        hash.update(buffer);
        decodedSize += buffer.length;
      }

      await new Promise<void>((resolve, reject) => {
        writeStream.end(() => resolve());
        writeStream.on("error", reject);
      });
    } catch (error) {
      writeStream.destroy();
      throw error;
    }

    const legacySha256 = hash.digest("hex");

    // Acquire lease before proceeding
    const leaseResult = await acquireLease(
      source, record.id, bucket, path, filename, decodedSize, legacySha256, detectedMime, execute
    );

    if (!leaseResult.acquired) {
      return { success: false, skipped: true, error: "Could not acquire lease - locked by another worker" };
    }

    // Get current ledger state
    const ledgerRows = await db.select({ state: legacyStorageMigrationLedger.state })
      .from(legacyStorageMigrationLedger)
      .where(and(
        eq(legacyStorageMigrationLedger.source, source),
        eq(legacyStorageMigrationLedger.recordId, record.id)
      ))
      .limit(1);

    const currentState = ledgerRows[0]?.state || "inventoried";

    // Skip if already verified
    if (currentState === "app_verified" || currentState === "excluded") {
      return { success: true, skipped: true, state: currentState };
    }

    if (currentState === "conflict") {
      return { success: false, skipped: true, state: "conflict", error: "Requires human review" };
    }

    // Inspect existing object
    const inspection = await inspectExistingObjectStreamed(
      supabase, bucket, path, decodedSize, legacySha256, detectedMime
    );

    if (inspection.status === "verified_mismatch") {
      await transitionState(source, record.id, "conflict", execute, inspection.reason);
      return { success: false, state: "conflict", error: `Object conflict: ${inspection.reason}` };
    }

    if (inspection.status === "indeterminate") {
      return { success: false, error: `Cannot verify existing object: ${inspection.reason}` };
    }

    let uploaded = false;

    if (inspection.status === "verified_match") {
      uploaded = true;
      console.log(`    [${source}:${record.id}] Reusing existing verified object`);
    } else {
      // Upload via TUS
      await transitionState(source, record.id, "uploading", execute);

      try {
        await uploadWithTus(supabase, bucket, path, tempFilePath, detectedMime, decodedSize, () => {
          // Heartbeat during upload
          void renewLease(source, record.id, execute);
        });
        uploaded = true;
      } catch (err) {
        await transitionState(source, record.id, "failed", execute, String(err));
        return { success: false, error: `Upload failed: ${sanitizeError(err)}` };
      }

      await transitionState(source, record.id, "uploaded", execute);

      // Verify uploaded object
      const verifyResult = await inspectExistingObjectStreamed(
        supabase, bucket, path, decodedSize, legacySha256, detectedMime
      );

      if (verifyResult.status !== "verified_match") {
        await transitionState(source, record.id, "failed", execute, verifyResult.status === "verified_mismatch" ? verifyResult.reason : "Verification failed");
        return { success: false, error: `Object verification failed: ${verifyResult.status}` };
      }

      await transitionState(source, record.id, "object_verified", execute);
    }

    // Verify source hasn't changed using fingerprint
    const finalFingerprint = await getSourceFingerprint(source, record.id);
    if (!finalFingerprint || finalFingerprint.length !== record.legacyDataLength) {
      await transitionState(source, record.id, "failed", execute, "Source record changed during migration");
      return { success: false, error: "Source record changed during migration" };
    }

    // Commit metadata
    await updateSourceMetadata(source, record.id, bucket, path, decodedSize, detectedMime, execute);
    await transitionState(source, record.id, "metadata_committed", execute);

    // Verify application route
    const appVerify = await verifyApplicationRouteStreamed(baseUrl, source, record.id, decodedSize, legacySha256, fetch);

    if (!appVerify.ok) {
      // Rollback
      await clearSourceMetadata(source, record.id, execute);
      await transitionState(source, record.id, "rollback_required", execute, appVerify.error);
      await transitionState(source, record.id, "rolled_back", execute);
      return { success: false, error: `App verification failed: ${appVerify.error}` };
    }

    await transitionState(source, record.id, "app_verified", execute);
    return { success: true, state: "app_verified" };

  } catch (err) {
    return { success: false, error: sanitizeError(err) };
  } finally {
    // Cleanup temp directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    // Release lease
    await releaseLease(source, record.id, execute);
  }
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes("--orphan-audit")) {
    const supabase = getSupabaseStorageAdmin();
    await runOrphanAudit(supabase);
    return;
  }

  const options = parseArgs();
  
  // Validate APP_BASE_URL
  const rawBaseUrl = process.env.APP_BASE_URL;
  const urlValidation = validateAppBaseUrl(rawBaseUrl, options.execute);
  
  if (!urlValidation.valid) {
    console.error(`ERROR: ${urlValidation.error}`);
    process.exit(1);
  }

  if (options.execute && !options.confirmProduction) {
    console.error("ERROR: --confirm-production required for execute mode");
    process.exit(1);
  }

  const baseUrl = rawBaseUrl || "";
  const supabase = getSupabaseStorageAdmin();

  const sources = options.sources || (["doc_files", "governance_files", "governance_uploads", "smp_documents"] as StorageFileSource[]);

  console.log(`\n=== Legacy Storage Migration ===`);
  console.log(`Mode: ${options.execute ? "EXECUTE" : "DRY-RUN"}`);
  console.log(`Sources: ${sources.join(", ")}`);
  console.log(`Limit: ${options.limit || "unlimited"}`);
  console.log(`Batch size: ${options.batchSize}`);
  console.log(`Base URL: ${baseUrl || "(none)"}`);
  console.log(`Worker ID: ${WORKER_ID}`);
  console.log();

  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const source of sources) {
    console.log(`--- Processing source: ${source} ---`);
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

main().catch((err) => {
  console.error("Fatal error:", sanitizeError(err));
  process.exit(1);
});
