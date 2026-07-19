#!/usr/bin/env node
/**
 * Legacy Storage Migration CLI - Production Safe
 *
 * Dry-run by default. Execute mode requires --execute --confirm-production.
 */

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  acquireLease as coreAcquireLease,
  renewLease as coreRenewLease,
  releaseLease as coreReleaseLease,
  transitionState as coreTransitionState,
  transactionalMetadataCommit as coreTransactionalMetadataCommit,
  transactionalRollback as coreTransactionalRollback,
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

interface MigrationOptions {
  execute: boolean;
  confirmProduction: boolean;
  sources?: StorageFileSource[];
  recordIds?: number[];
  limit?: number;
  batchSize?: number;
}

type ProcessingResult = { success: boolean; state?: string; error?: string; skipped?: boolean };

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
  --batch-size <n>       Records per batch (default: 1)
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
      sql`storage_path IS NULL`,
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

// ============================================================================
// LEASE MANAGEMENT (wrappers around core functions)
// ============================================================================

async function acquireLease(
  source: StorageFileSource,
  recordId: number,
  bucket: string,
  storagePath: string,
  expectedSize: number,
  legacySha256: string,
  mimeType: string,
  execute: boolean
): Promise<{ acquired: boolean; conflict?: string }> {
  return coreAcquireLease(source, recordId, bucket, storagePath, expectedSize, legacySha256, mimeType, execute, WORKER_ID);
}

async function renewLease(source: StorageFileSource, recordId: number, execute: boolean): Promise<boolean> {
  return coreRenewLease(source, recordId, execute, WORKER_ID);
}

async function releaseLease(source: StorageFileSource, recordId: number, execute: boolean): Promise<void> {
  return coreReleaseLease(source, recordId, execute, WORKER_ID);
}

// ============================================================================
// STATE TRANSITIONS
// ============================================================================

async function transitionState(
  source: StorageFileSource,
  recordId: number,
  expectedState: string,
  newState: LegacyStorageMigrationState,
  execute: boolean,
  error?: string
): Promise<{ success: boolean }> {
  return coreTransitionState(source, recordId, expectedState, newState, execute, WORKER_ID, error);
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
  fingerprint: { length: number; hash: string },
  execute: boolean
): Promise<{ success: boolean; error?: string }> {
  if (!execute) return { success: true };

  try {
    await db.transaction(async (tx) => {
      // Verify fingerprint still matches
      const table = SOURCE_TABLES[source];
      const legacyColumn = LEGACY_COLUMNS[source];
      const currentFp = await tx.select({
        length: sql<number>`length(${sql.raw(legacyColumn)})`,
        hash: sql<string>`md5(${sql.raw(legacyColumn)})`,
        storagePath: sql<string | null>`storage_path`,
      })
        .from(table)
        .where(eq(table.id, recordId))
        .limit(1);

      if (!currentFp[0]) throw new Error("Record not found");
      if (currentFp[0].storagePath !== null) throw new Error("Already migrated");
      if (currentFp[0].length !== fingerprint.length) throw new Error("Fingerprint length changed");
      if (currentFp[0].hash !== fingerprint.hash) throw new Error("Fingerprint hash changed");

      // Update source - NO updatedAt for governance tables
      const updates: Record<string, unknown> = {
        storageProvider: "supabase",
        storageBucket: bucket,
        storagePath: path,
        storageSize: size,
        storageMimeType: mimeType,
        storageUploadedAt: new Date(),
      };
      if (source !== "governance_files" && source !== "governance_uploads") {
        updates.updatedAt = new Date();
      }

      const sourceResult = await tx.update(table).set(updates).where(eq(table.id, recordId)).returning({ id: table.id });
      if (sourceResult.length !== 1) throw new Error("Source update failed");

      // Update ledger
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

      if (ledgerResult.length === 0) throw new Error("Ledger transition failed");
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: sanitizeError(err) };
  }
}

async function transactionalRollback(
  source: StorageFileSource,
  recordId: number,
  bucket: string,
  path: string,
  execute: boolean
) {
  if (!execute) return { success: true };

  try {
    await db.transaction(async (tx) => {
      const table = SOURCE_TABLES[source];

      // Clear metadata only if matches exact bucket/path
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

// ============================================================================
// TUS UPLOAD (STANDARDS-COMPLIANT WITH DOCUMENTED PUBLIC API)
// ============================================================================

/** tus-js-client FileSource interface for Node.js file handles */
interface FileSource {
  size: number;
  slice(start: number, end: number): Promise<{ value: Buffer; done: boolean }>;
  close(): Promise<void>;
}

/** tus-js-client FileReader interface */
interface FileReader {
  openFile(input: unknown, chunkSize: number): Promise<FileSource>;
}

function createNodeFileReader(tempFilePath: string, fileSize: number): FileReader {
  return {
    openFile: async (): Promise<FileSource> => {
      const fd = await open(tempFilePath, "r");
      return {
        size: fileSize,
        slice: async (start: number, end: number) => {
          const length = Math.min(end - start, fileSize - start);
          if (length <= 0) return { value: Buffer.alloc(0), done: true };
          const buffer = Buffer.alloc(length);
          await fd.read(buffer, 0, length, start);
          return { value: buffer, done: end >= fileSize };
        },
        close: async () => fd.close(),
      };
    },
  };
}

async function uploadWithTus(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  tempFilePath: string,
  mimeType: string,
  fileSize: number,
  source: StorageFileSource,
  recordId: number,
  execute: boolean,
  onHeartbeat: () => Promise<void>
): Promise<void> {
  if (!execute) return;

  const config = getSupabaseStorageConfig();
  const tusEndpoint = `${config.directStorageUrl}/storage/v1/upload/resumable`;

  const existing = await db.select({ tusUploadUrl: legacyStorageMigrationLedger.tusUploadUrl })
    .from(legacyStorageMigrationLedger)
    .where(and(
      eq(legacyStorageMigrationLedger.source, source),
      eq(legacyStorageMigrationLedger.recordId, recordId)
    ))
    .limit(1);
  const existingUrl = existing[0]?.tusUploadUrl;

  const fileReader = createNodeFileReader(tempFilePath, fileSize);

  return new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(null as unknown as File, {
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
      fileReader,
      uploadSize: fileSize,
      onBeforeRequest: async () => {
        await onHeartbeat();
        if (upload.url && upload.url !== existingUrl) {
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
        resolve();
      },
    });

    upload.start();
  });
}

async function decodeWithHeartbeat(
  source: StorageFileSource,
  recordId: number,
  record: { id: number; fileName: string | null; fileType: string | null; legacyDataLength: number },
  tempFilePath: string,
  execute: boolean,
  onProgress: (decodedSize: number) => void
): Promise<{ size: number; sha256: string; mimeType: string }> {
  const prefixChunk = await fetchBase64Chunk(source, recordId, 1, 100);
  const { mimeType: dataUrlMime, headerLength } = parseDataUrlHeader(prefixChunk);
  const detectedMime = inferMimeType(record.fileName || "unnamed", dataUrlMime, record.fileType);
  const base64Start = headerLength + 1;

  const { createWriteStream } = await import("node:fs");
  const writeStream = createWriteStream(tempFilePath);

  const hash = createHash("sha256");
  let decodedSize = 0;
  let carryOver = "";
  let lastHeartbeat = Date.now();

  const decodePromise = new Promise<void>((res, rej) => {
    writeStream.on("finish", res);
    writeStream.on("error", rej);
  });

  for (let sqlOffset = base64Start; sqlOffset <= record.legacyDataLength; sqlOffset += BASE64_CHUNK_SIZE) {
    // Heartbeat check every 10 chunks
    if ((sqlOffset - base64Start) / BASE64_CHUNK_SIZE % 10 === 0) {
      const now = Date.now();
      if (now - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
        const renewed = await renewLease(source, recordId, execute);
        if (!renewed && execute) throw new Error("Lost lease during decode");
        lastHeartbeat = now;
      }
    }

    const chunk = await fetchBase64Chunk(source, recordId, sqlOffset, BASE64_CHUNK_SIZE);
    let fullChunk = carryOver + chunk;
    const remainder = fullChunk.length % 4;

    if (remainder !== 0 && sqlOffset + BASE64_CHUNK_SIZE <= record.legacyDataLength) {
      carryOver = fullChunk.slice(-remainder);
      fullChunk = fullChunk.slice(0, -remainder);
    } else {
      carryOver = "";
    }

    if (fullChunk.length === 0) continue;
    if (!/^[A-Za-z0-9+/]*=?=?=?$/.test(fullChunk)) throw new Error("Invalid Base64");

    const buffer = Buffer.from(fullChunk, "base64");
    writeStream.write(buffer);
    hash.update(buffer);
    decodedSize += buffer.length;
    onProgress(decodedSize);
  }

  if (carryOver) {
    const buffer = Buffer.from(carryOver, "base64");
    writeStream.write(buffer);
    hash.update(buffer);
    decodedSize += buffer.length;
  }

  writeStream.end();
  await decodePromise;

  return { size: decodedSize, sha256: hash.digest("hex"), mimeType: detectedMime };
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
): Promise<ProcessingResult> {
  const { execute } = options;
  const filename = record.fileName || "unnamed";
  const bucket = SOURCE_BUCKETS[source];
  const path = generateStoragePath(source, record.id, filename);

  const tempDir = join(tmpdir(), `odm-migration-${randomUUID()}`);
  const tempFilePath = join(tempDir, "payload.tmp");
  let leaseAcquired = false;

  try {
    // Step 1: Get initial fingerprint
    const initialFingerprint = await getSourceFingerprint(source, record.id);
    if (!initialFingerprint) return { success: false, error: "Source not found" };
    if (initialFingerprint.length !== record.legacyDataLength) {
      return { success: false, error: "Source changed (length mismatch)" };
    }

    // Step 2: ACQUIRE LEASE before decoding (no heartbeat before acquisition)
    await mkdir(tempDir, { mode: 0o700, recursive: true });
    const leaseResult = await acquireLease(
      source, record.id, bucket, path, 0, "", "application/octet-stream", execute
    );
    if (leaseResult.conflict) {
      return { success: false, state: "conflict", error: leaseResult.conflict };
    }
    if (!leaseResult.acquired) {
      return { success: false, skipped: true, error: "Could not acquire lease" };
    }
    leaseAcquired = true;
    // Step 3: Decode AFTER lease acquisition (heartbeat OK now)
    const decoded = await decodeWithHeartbeat(
      source, record.id, record, tempFilePath, execute,
      (size) => { /* progress */ }
    );

    // Update ledger with actual decoded values
    if (execute) {
      await db.update(legacyStorageMigrationLedger)
        .set({
          expectedSize: decoded.size,
          legacySha256: decoded.sha256,
          detectedMimeType: decoded.mimeType,
          updatedAt: new Date(),
        })
        .where(and(
          eq(legacyStorageMigrationLedger.source, source),
          eq(legacyStorageMigrationLedger.recordId, record.id),
          eq(legacyStorageMigrationLedger.leaseOwner, WORKER_ID)
        ));
    }
    // Step 4: Check ledger state
    const ledgerRows = await db.select({ state: legacyStorageMigrationLedger.state })
      .from(legacyStorageMigrationLedger)
      .where(and(
        eq(legacyStorageMigrationLedger.source, source),
        eq(legacyStorageMigrationLedger.recordId, record.id)
      ))
      .limit(1);
    const currentState = ledgerRows[0]?.state || "inventoried";

    if (currentState === "app_verified") return { success: true, skipped: true, state: "app_verified" };
    if (currentState === "excluded") return { success: true, skipped: true, state: "excluded" };
    if (currentState === "conflict") return { success: false, skipped: true, state: "conflict", error: "Requires review" };

    // Step 5: Inspect existing object
    const inspection = await inspectExistingObjectStreamed(
      supabase, bucket, path, decoded.size, decoded.sha256, decoded.mimeType
    );

    if (inspection.status === "verified_mismatch") {
      await transitionState(source, record.id, currentState, "conflict", execute, inspection.reason);
      return { success: false, state: "conflict", error: `Conflict: ${inspection.reason}` };
    }
    if (inspection.status === "indeterminate") {
      return { success: false, error: `Cannot verify: ${inspection.reason}` };
    }

    let objectVerified = inspection.status === "verified_match";

    // Step 6: Upload if needed
    if (!objectVerified) {
      await transitionState(source, record.id, currentState, "uploading", execute);

      // Upload with heartbeat callback
      await uploadWithTus(
        supabase, bucket, path, tempFilePath, decoded.mimeType, decoded.size,
        source, record.id, execute,
        async () => {
          const renewed = await renewLease(source, record.id, execute);
          if (!renewed && execute) throw new Error("Lost lease during upload");
        }
      );

      // Verify ownership after upload
      const stillOwned = await renewLease(source, record.id, execute);
      if (!stillOwned && execute) return { success: false, error: "Lost lease after upload" };

      await transitionState(source, record.id, "uploading", "uploaded", execute);

      // Verify object
      const verifyResult = await inspectExistingObjectStreamed(
        supabase, bucket, path, decoded.size, decoded.sha256, decoded.mimeType
      );
      if (verifyResult.status !== "verified_match") {
        await transitionState(source, record.id, "uploaded", "failed", execute, verifyResult.status);
        return { success: false, error: `Verification failed: ${verifyResult.status}` };
      }

      await transitionState(source, record.id, "uploaded", "object_verified", execute);
    } else {
      console.log(`    [${source}:${record.id}] Reusing existing`);
      await transitionState(source, record.id, currentState, "object_verified", execute);
    }

    // Step 7: Verify source unchanged (both length and hash)
    const finalFingerprint = await getSourceFingerprint(source, record.id);
    if (!finalFingerprint ||
        finalFingerprint.length !== initialFingerprint.length ||
        finalFingerprint.hash !== initialFingerprint.hash) {
      await transitionState(source, record.id, "object_verified", "failed", execute, "Source changed");
      return { success: false, error: "Source changed during migration" };
    }

    // Step 8: Transactional metadata commit (conditional on fingerprint)
    const commitResult = await transactionalMetadataCommit(
      source, record.id, bucket, path, decoded.size, decoded.mimeType, initialFingerprint, execute
    );
    if (!commitResult.success) {
      await transitionState(source, record.id, "object_verified", "failed", execute, commitResult.error);
      return { success: false, error: commitResult.error };
    }

    // Step 9: App verification (skip in dry-run)
    if (execute) {
      const appVerify = await verifyApplicationRouteStreamed(baseUrl, source, record.id, decoded.size, decoded.sha256, fetch);
      if (!appVerify.ok) {
        // Rollback: metadata_committed → rollback_required → rolled_back
        await transitionState(source, record.id, "metadata_committed", "rollback_required", execute, appVerify.error);
        await transactionalRollback(source, record.id, bucket, path, execute);
        await transitionState(source, record.id, "rollback_required", "rolled_back", execute);
        return { success: false, error: `App verify failed: ${appVerify.error}` };
      }
    }

    await transitionState(source, record.id, "metadata_committed", "app_verified", execute);
    return { success: true, state: "app_verified" };

  } catch (err) {
    return { success: false, error: sanitizeError(err) };
  } finally {
    try { await rm(tempDir, { recursive: true, force: true }); } catch { }
    if (leaseAcquired) await releaseLease(source, record.id, execute);
  }
}

// ============================================================================
// ORPHAN AUDIT (RECURSIVE, PAGINATED, READ-ONLY)
// ============================================================================

type ObjectClassification =
  | "referenced" | "active_upload_intent" | "finalized_upload_intent"
  | "migration_verified" | "migration_staged" | "possible_orphan" | "indeterminate";

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
      if (row.bucket && row.path) tablePaths.add(`${row.bucket}:${row.path}`);
    }
  }

  // Collect from upload intents
  const intents = await db
    .select({ bucket: storageUploadIntents.expectedBucket, path: storageUploadIntents.expectedPath, status: storageUploadIntents.status })
    .from(storageUploadIntents);

  for (const intent of intents) {
    const key = `${intent.bucket}:${intent.path}`;
    if (intent.status === "finalized") intentFinalizedPaths.add(key);
    else if (["pending", "uploading"].includes(intent.status)) intentPendingPaths.add(key);
  }

  // Collect from migration ledger
  const ledger = await db
    .select({ bucket: legacyStorageMigrationLedger.bucket, path: legacyStorageMigrationLedger.storagePath, state: legacyStorageMigrationLedger.state })
    .from(legacyStorageMigrationLedger);

  for (const entry of ledger) {
    const key = `${entry.bucket}:${entry.path}`;
    if (entry.state === "app_verified") ledgerVerifiedPaths.add(key);
    else if (["uploaded", "object_verified", "metadata_committed", "uploading"].includes(entry.state)) {
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
// MAIN
// ============================================================================

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
  if (!options.execute) console.log("DRY-RUN complete - no changes made");
}

main().catch((err) => {
  console.error("Fatal error:", sanitizeError(err));
  process.exit(1);
});
