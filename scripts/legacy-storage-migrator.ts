#!/usr/bin/env node
/**
 * Legacy Storage Migration CLI - Production Safe
 *
 * Dry-run by default. Execute mode requires --execute --confirm-production.
 * Refactored for dependency injection with MigrationContext.
 */

import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  docFiles,
  governanceFiles,
  governanceUploads,
  smpDocuments,
  legacyStorageMigrationLedger,
  storageUploadIntents,
  type LegacyStorageMigrationState,
} from "../db/schema";
import { getSupabaseStorageConfig } from "../api/supabase-storage";
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

import type {
  MigrationContext,
  MigrationOptions,
  ProcessingResult,
  SourceFingerprint,
  DecodedPayload,
} from "./lib/migrator-adapters";

import { createProductionContext } from "./lib/migrator-adapters-production";

// ============================================================================
// CONSTANTS
// ============================================================================

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
  --ids <list>          Comma-separated record IDs
  --limit <n>            Maximum records to process
  --batch-size <n>       Records per batch (default: 1)
  --orphan-audit         Run orphan audit (read-only)
  --help, -h            Show this help
`);
}

// ============================================================================
// DATABASE HELPERS (context-aware)
// ============================================================================

async function fetchEligibleRecords(
  source: StorageFileSource,
  ctx: MigrationContext,
  recordIds?: number[],
  limit?: number
): Promise<Array<{ id: number; fileName: string | null; fileType: string | null; legacyDataLength: number }>> {
  const table = SOURCE_TABLES[source];
  const legacyColumn = LEGACY_COLUMNS[source];

  let query = ctx.db
    .select({
      id: (table as any).id,
      fileName: source === "governance_uploads" ? sql<string | null>`${sql.raw("file_name")}` : (table as any).fileName,
      fileType: source === "governance_uploads" ? sql<string | null>`null` : (table as any).fileType,
      legacyDataLength: sql<number>`length(${sql.raw(legacyColumn)})`,
    })
    .from(table)
    .where(and(
      sql`${sql.raw(legacyColumn)} IS NOT NULL`,
      sql`storage_path IS NULL`
    ));

  if (recordIds?.length) {
    query = query.where(inArray(table.id, recordIds));
  }

  // Exclude SMP ID 31
  if (source === "smp_documents") {
    query = query.where(sql`${table.id} != 31`);
  }

  if (limit) {
    query = query.limit(limit);
  }

  return await query.orderBy(table.id);
}

async function fetchBase64Chunk(
  source: StorageFileSource,
  recordId: number,
  start: number,
  length: number,
  ctx: MigrationContext
): Promise<string> {
  const table = SOURCE_TABLES[source];
  const legacyColumn = LEGACY_COLUMNS[source];

  const result = await ctx.db
    .select({ chunk: sql<string>`substr(${sql.raw(legacyColumn)}, ${start}, ${length})` })
    .from(table)
    .where(eq(table.id, recordId))
    .limit(1);

  return result[0]?.chunk || "";
}

async function getSourceFingerprint(
  source: StorageFileSource,
  recordId: number,
  ctx: MigrationContext
): Promise<SourceFingerprint | null> {
  const table = SOURCE_TABLES[source];
  const legacyColumn = LEGACY_COLUMNS[source];

  const result = await ctx.db
    .select({
      length: sql<number>`length(${sql.raw(legacyColumn)})`,
      hash: sql<string>`encode(digest(${sql.raw(legacyColumn)}, 'sha256'), 'hex')`,
    })
    .from(table)
    .where(eq(table.id, recordId))
    .limit(1);

  if (!result[0]) return null;
  return { length: result[0].length, hash: result[0].hash };
}

// ============================================================================
// LEASE MANAGEMENT (context-aware)
// ============================================================================

async function acquireLease(
  source: StorageFileSource,
  recordId: number,
  bucket: string,
  storagePath: string,
  expectedSize: number,
  legacySha256: string,
  mimeType: string,
  ctx: MigrationContext
): Promise<{ acquired: boolean; conflict?: string }> {
  return coreAcquireLease(source, recordId, bucket, storagePath, expectedSize, legacySha256, mimeType, ctx.execute, ctx.workerId);
}

async function renewLease(
  source: StorageFileSource,
  recordId: number,
  ctx: MigrationContext
): Promise<boolean> {
  return coreRenewLease(source, recordId, ctx.execute, ctx.workerId);
}

async function releaseLease(
  source: StorageFileSource,
  recordId: number,
  ctx: MigrationContext
): Promise<void> {
  return coreReleaseLease(source, recordId, ctx.execute, ctx.workerId);
}

// ============================================================================
// STATE TRANSITIONS (context-aware)
// ============================================================================

async function transitionState(
  source: StorageFileSource,
  recordId: number,
  expectedState: string,
  newState: LegacyStorageMigrationState,
  ctx: MigrationContext
): Promise<{ success: boolean }> {
  if (!ctx.execute) return { success: true };
  return coreTransitionState(source, recordId, expectedState, newState, ctx.execute, ctx.workerId);
}

// ============================================================================
// TRANSACTIONAL OPERATIONS (context-aware)
// ============================================================================

async function transactionalMetadataCommit(
  source: StorageFileSource,
  recordId: number,
  bucket: string,
  path: string,
  size: number,
  mimeType: string,
  fingerprint: SourceFingerprint,
  ctx: MigrationContext
): Promise<{ success: boolean; error?: string }> {
  if (!ctx.execute) return { success: true };

  try {
    await ctx.db.transaction(async (tx: any) => {
      const table = SOURCE_TABLES[source];

      const updates: Record<string, unknown> = {
        storageProvider: "supabase",
        storageBucket: bucket,
        storagePath: path,
        storageSize: size.toString(),
        storageMimeType: mimeType,
        storageUploadedAt: ctx.clock.newDate(),
      };

      // Never write updatedAt to governance tables
      if (source !== "governance_files" && source !== "governance_uploads") {
        updates.updatedAt = ctx.clock.newDate();
      }

      const updateResult = await tx.update(table).set(updates).where(and(
        eq(table.id, recordId),
        sql`storage_path IS NULL`
      )).returning({ id: table.id });

      if (updateResult.length === 0) throw new Error("No row updated - storage_path not NULL or record changed");

      // Update ledger
      const ledgerResult = await tx.update(legacyStorageMigrationLedger)
        .set({ state: "metadata_committed", updatedAt: ctx.clock.newDate() })
        .where(and(
          eq(legacyStorageMigrationLedger.source, source),
          eq(legacyStorageMigrationLedger.recordId, recordId),
          eq(legacyStorageMigrationLedger.state, "object_verified"),
          eq(legacyStorageMigrationLedger.leaseOwner, ctx.workerId)
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
  ctx: MigrationContext
): Promise<{ success: boolean; error?: string }> {
  if (!ctx.execute) return { success: true };

  try {
    await ctx.db.transaction(async (tx: any) => {
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
        updates.updatedAt = ctx.clock.newDate();
      }

      await tx.update(table).set(updates).where(and(
        eq(table.id, recordId),
        eq(sql`storage_bucket`, bucket),
        eq(sql`storage_path`, path)
      ));

      // Update ledger
      await tx.update(legacyStorageMigrationLedger)
        .set({ state: "rolled_back", updatedAt: ctx.clock.newDate() })
        .where(and(
          eq(legacyStorageMigrationLedger.source, source),
          eq(legacyStorageMigrationLedger.recordId, recordId),
          eq(legacyStorageMigrationLedger.state, "rollback_required")
        ));
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: sanitizeError(err) };
  }
}

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

function createNodeFileReader(tempFilePath: string, fileSize: number, fs: MigrationContext["fs"]): FileReader {
  return {
    openFile: async (): Promise<FileSource> => {
      const fd = await fs.open(tempFilePath, "r");
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
  storage: MigrationContext["storage"],
  bucket: string,
  path: string,
  tempFilePath: string,
  mimeType: string,
  fileSize: number,
  source: StorageFileSource,
  recordId: number,
  ctx: MigrationContext,
  onHeartbeat: () => Promise<void>
): Promise<void> {
  if (!ctx.execute) return;

  const config = getSupabaseStorageConfig();
  const tusEndpoint = `${config.directStorageUrl}/storage/v1/upload/resumable`;

  const existing = await ctx.db.select({ tusUploadUrl: legacyStorageMigrationLedger.tusUploadUrl })
    .from(legacyStorageMigrationLedger)
    .where(and(
      eq(legacyStorageMigrationLedger.source, source),
      eq(legacyStorageMigrationLedger.recordId, recordId)
    ))
    .limit(1);
  const existingUrl = existing[0]?.tusUploadUrl;

  const fileReader = createNodeFileReader(tempFilePath, fileSize, ctx.fs);

  return new Promise<void>((resolve, reject) => {
    const upload = new ctx.tus.Upload(null as unknown as File, {
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
          await ctx.db.update(legacyStorageMigrationLedger)
            .set({ tusUploadUrl: upload.url, updatedAt: ctx.clock.newDate() })
            .where(and(
              eq(legacyStorageMigrationLedger.source, source),
              eq(legacyStorageMigrationLedger.recordId, recordId),
              eq(legacyStorageMigrationLedger.leaseOwner, ctx.workerId)
            ));
        }
      },
      onError: (err: Error) => reject(err),
      onSuccess: async () => {
        await ctx.db.update(legacyStorageMigrationLedger)
          .set({ tusUploadUrl: null, updatedAt: ctx.clock.newDate() })
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

// ============================================================================
// DECODE WITH HEARTBEAT (context-aware)
// ============================================================================

async function decodeWithHeartbeat(
  source: StorageFileSource,
  recordId: number,
  record: { id: number; fileName: string | null; fileType: string | null; legacyDataLength: number },
  tempFilePath: string,
  ctx: MigrationContext,
  onProgress: (size: number) => void
): Promise<DecodedPayload> {
  // Fetch first chunk to detect data URL header
  const firstChunk = await fetchBase64Chunk(source, recordId, 1, Math.min(100, record.legacyDataLength), ctx);
  const headerInfo = parseDataUrlHeader(firstChunk);

  // Determine where Base64 payload starts (1-indexed for SQL)
  const base64Start = headerInfo.headerLength > 0 ? headerInfo.headerLength : 1;
  const detectedMime = headerInfo.mimeType || inferMimeType(record.fileName || "", headerInfo.mimeType, record.fileType);

  const { createWriteStream } = await import("node:fs");
  const writeStream = createWriteStream(tempFilePath);

  const hash = createHash("sha256");
  let decodedSize = 0;
  let carryOver = ""; // Holds incomplete Base64 group from previous chunk
  let lastHeartbeat = ctx.clock.now();

  const decodePromise = new Promise<void>((res, rej) => {
    writeStream.on("finish", res);
    writeStream.on("error", rej);
  });

  // Calculate total Base64 payload length
  const payloadLength = record.legacyDataLength - (base64Start - 1);

  for (let sqlOffset = base64Start; sqlOffset <= record.legacyDataLength; sqlOffset += BASE64_CHUNK_SIZE) {
    // Heartbeat check every 10 chunks
    if ((sqlOffset - base64Start) / BASE64_CHUNK_SIZE % 10 === 0) {
      const now = ctx.clock.now();
      if (now - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
        const renewed = await renewLease(source, recordId, ctx);
        if (!renewed && ctx.execute) throw new Error("Lost lease during decode");
        lastHeartbeat = now;
      }
    }

    const chunk = await fetchBase64Chunk(source, recordId, sqlOffset, BASE64_CHUNK_SIZE, ctx);

    // Combine with carry-over from previous chunk
    let fullChunk = carryOver + chunk;

    // Calculate how many complete 4-character Base64 groups we have
    const remainder = fullChunk.length % 4;
    const isLastChunk = sqlOffset + BASE64_CHUNK_SIZE > record.legacyDataLength;

    if (remainder !== 0 && !isLastChunk) {
      // Save remainder for next chunk (not last chunk)
      carryOver = fullChunk.slice(-remainder);
      fullChunk = fullChunk.slice(0, -remainder);
    } else {
      // Last chunk or complete groups - process all including any remainder
      carryOver = "";
    }

    if (fullChunk.length === 0) continue;

    // Validate Base64 characters only
    if (!/^[A-Za-z0-9+/]*=?=?=?$/.test(fullChunk)) {
      throw new Error("Invalid Base64 data in chunk");
    }

    // Decode complete groups
    const buffer = Buffer.from(fullChunk, "base64");
    writeStream.write(buffer);
    hash.update(buffer);
    decodedSize += buffer.length;
    onProgress(decodedSize);
  }

  // Process any remaining carry-over (should only happen on last chunk)
  if (carryOver) {
    if (!/^[A-Za-z0-9+/]*=?=?=?$/.test(carryOver)) {
      throw new Error("Invalid Base64 data in final chunk");
    }
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
// MIGRATION WORKFLOW (context-aware)
// ============================================================================

async function processRecord(
  source: StorageFileSource,
  record: { id: number; fileName: string | null; fileType: string | null; legacyDataLength: number },
  options: MigrationOptions,
  baseUrl: string,
  ctx: MigrationContext
): Promise<ProcessingResult> {
  const filename = record.fileName || "unnamed";
  const bucket = SOURCE_BUCKETS[source];
  const path = generateStoragePath(source, record.id, filename);

  const tempDir = join(tmpdir(), `odm-migration-${ctx.clock.randomUUID()}`);
  const tempFilePath = join(tempDir, "payload.tmp");
  let leaseAcquired = false;

  try {
    // Step 1: Get initial fingerprint
    const initialFingerprint = await getSourceFingerprint(source, record.id, ctx);
    if (!initialFingerprint) return { success: false, error: "Source not found" };
    if (initialFingerprint.length !== record.legacyDataLength) {
      return { success: false, error: "Source changed (length mismatch)" };
    }

    // Step 2: ACQUIRE LEASE before decoding (no heartbeat before acquisition)
    await ctx.fs.mkdir(tempDir, { mode: 0o700, recursive: true });
    const leaseResult = await acquireLease(
      source, record.id, bucket, path, 0, "", "application/octet-stream", ctx
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
      source, record.id, record, tempFilePath, ctx,
      (size) => { /* progress */ }
    );

    // Update ledger with actual decoded values
    if (ctx.execute) {
      await ctx.db.update(legacyStorageMigrationLedger)
        .set({
          expectedSize: decoded.size,
          legacySha256: decoded.sha256,
          detectedMimeType: decoded.mimeType,
          updatedAt: ctx.clock.newDate(),
        })
        .where(and(
          eq(legacyStorageMigrationLedger.source, source),
          eq(legacyStorageMigrationLedger.recordId, record.id),
          eq(legacyStorageMigrationLedger.leaseOwner, ctx.workerId)
        ));
    }

    // Step 4: Check ledger state
    const ledgerRows = await ctx.db.select({ state: legacyStorageMigrationLedger.state })
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
      ctx.storage as unknown as SupabaseClient,
      bucket, path, decoded.size, decoded.sha256, decoded.mimeType
    );

    if (inspection.status === "verified_mismatch") {
      await transitionState(source, record.id, currentState, "conflict", ctx);
      return { success: false, state: "conflict", error: `Conflict: ${inspection.reason}` };
    }
    if (inspection.status === "indeterminate") {
      return { success: false, error: `Cannot verify: ${inspection.reason}` };
    }

    let objectVerified = inspection.status === "verified_match";

    // Step 6: Upload if needed
    if (!objectVerified) {
      await transitionState(source, record.id, currentState, "uploading", ctx);

      // Upload with heartbeat callback
      await uploadWithTus(
        ctx.storage, bucket, path, tempFilePath, decoded.mimeType, decoded.size,
        source, record.id, ctx,
        async () => {
          const renewed = await renewLease(source, record.id, ctx);
          if (!renewed && ctx.execute) throw new Error("Lost lease during upload");
        }
      );

      // Verify ownership after upload
      const stillOwned = await renewLease(source, record.id, ctx);
      if (!stillOwned && ctx.execute) return { success: false, error: "Lost lease after upload" };

      await transitionState(source, record.id, "uploading", "uploaded", ctx);

      // Verify object
      const verifyResult = await inspectExistingObjectStreamed(
        ctx.storage as unknown as SupabaseClient,
        bucket, path, decoded.size, decoded.sha256, decoded.mimeType
      );
      if (verifyResult.status !== "verified_match") {
        await transitionState(source, record.id, "uploaded", "failed", ctx);
        return { success: false, error: `Verification failed: ${verifyResult.status}` };
      }

      await transitionState(source, record.id, "uploaded", "object_verified", ctx);
    } else {
      ctx.logger.log(`    [${source}:${record.id}] Reusing existing`);
      await transitionState(source, record.id, currentState, "object_verified", ctx);
    }

    // Step 7: Verify source unchanged (both length and hash)
    const finalFingerprint = await getSourceFingerprint(source, record.id, ctx);
    if (!finalFingerprint ||
        finalFingerprint.length !== initialFingerprint.length ||
        finalFingerprint.hash !== initialFingerprint.hash) {
      await transitionState(source, record.id, "object_verified", "failed", ctx);
      return { success: false, error: "Source changed during migration" };
    }

    // Step 8: Transactional metadata commit (conditional on fingerprint)
    const commitResult = await transactionalMetadataCommit(
      source, record.id, bucket, path, decoded.size, decoded.mimeType, initialFingerprint, ctx
    );
    if (!commitResult.success) {
      await transitionState(source, record.id, "object_verified", "failed", ctx);
      return { success: false, error: commitResult.error };
    }

    // Step 9: App verification (skip in dry-run)
    if (ctx.execute) {
      const appVerify = await verifyApplicationRouteStreamed(baseUrl, source, record.id, decoded.size, decoded.sha256, ctx.fetchAdapter.fetch);
      if (!appVerify.ok) {
        // Rollback: metadata_committed → rollback_required → rolled_back
        await transitionState(source, record.id, "metadata_committed", "rollback_required", ctx);
        await transactionalRollback(source, record.id, bucket, path, ctx);
        await transitionState(source, record.id, "rollback_required", "rolled_back", ctx);
        return { success: false, error: `App verify failed: ${appVerify.error}` };
      }
    }

    await transitionState(source, record.id, "metadata_committed", "app_verified", ctx);
    return { success: true, state: "app_verified" };

  } catch (err) {
    return { success: false, error: sanitizeError(err) };
  } finally {
    try { await ctx.fs.rm(tempDir, { recursive: true, force: true }); } catch { }
    if (leaseAcquired) await releaseLease(source, record.id, ctx);
  }
}

// ============================================================================
// ORPHAN AUDIT (RECURSIVE, PAGINATED, READ-ONLY)
// ============================================================================

type ObjectClassificationValue =
  | "referenced" | "active_upload_intent" | "finalized_upload_intent"
  | "migration_verified" | "migration_staged" | "possible_orphan" | "indeterminate";

interface AuditResult {
  path: string;
  classification: ObjectClassificationValue;
}

async function runOrphanAudit(
  ctx: MigrationContext,
  supabase?: SupabaseClient
): Promise<void> {
  ctx.logger.log("\n=== Storage Orphan Audit ===\n");

  const buckets = ["om-manuals", "om-governance", "smp-library"];

  // Build reference sets
  const tablePaths = new Set<string>();
  const intentPendingPaths = new Set<string>();
  const intentFinalizedPaths = new Set<string>();
  const ledgerStagedPaths = new Set<string>();
  const ledgerVerifiedPaths = new Set<string>();

  // Collect paths from source tables
  const sources: StorageFileSource[] = ["doc_files", "governance_files", "governance_uploads", "smp_documents"];
  for (const source of sources) {
    const table = SOURCE_TABLES[source];
    const rows = await ctx.db
      .select({ bucket: sql<string | null>`storage_bucket`, path: sql<string | null>`storage_path` })
      .from(table)
      .where(sql`storage_path IS NOT NULL`);

    for (const row of rows) {
      if (row.bucket && row.path) tablePaths.add(`${row.bucket}:${row.path}`);
    }
  }

  // Collect from upload intents
  const intents = await ctx.db
    .select({ bucket: storageUploadIntents.expectedBucket, path: storageUploadIntents.expectedPath, status: storageUploadIntents.status })
    .from(storageUploadIntents);

  for (const intent of intents) {
    const key = `${intent.bucket}:${intent.path}`;
    if (intent.status === "finalized") intentFinalizedPaths.add(key);
    else if (["pending", "uploading"].includes(intent.status)) intentPendingPaths.add(key);
  }

  // Collect from migration ledger
  const ledger = await ctx.db
    .select({ bucket: legacyStorageMigrationLedger.bucket, path: legacyStorageMigrationLedger.storagePath, state: legacyStorageMigrationLedger.state })
    .from(legacyStorageMigrationLedger);

  for (const entry of ledger) {
    const key = `${entry.bucket}:${entry.path}`;
    if (entry.state === "app_verified") ledgerVerifiedPaths.add(key);
    else if (["uploaded", "object_verified", "metadata_committed", "uploading"].includes(entry.state)) {
      ledgerStagedPaths.add(key);
    }
  }

  ctx.logger.log(`References from tables: ${tablePaths.size}`);
  ctx.logger.log(`Pending intent paths: ${intentPendingPaths.size}`);
  ctx.logger.log(`Finalized intent paths: ${intentFinalizedPaths.size}`);
  ctx.logger.log(`Ledger staged: ${ledgerStagedPaths.size}`);
  ctx.logger.log(`Ledger verified: ${ledgerVerifiedPaths.size}`);

  // Classification function
  function classifyObject(bucket: string, path: string): ObjectClassificationValue {
    const key = `${bucket}:${path}`;
    if (tablePaths.has(key)) return "referenced";
    if (intentPendingPaths.has(key)) return "active_upload_intent";
    if (intentFinalizedPaths.has(key)) return "finalized_upload_intent";
    if (ledgerVerifiedPaths.has(key)) return "migration_verified";
    if (ledgerStagedPaths.has(key)) return "migration_staged";
    return "possible_orphan";
  }

  // Recursive prefix traversal
  async function scanPrefix(bucket: string, prefix: string, visited: Set<string>): Promise<AuditResult[]> {
    if (visited.has(prefix)) return [];
    visited.add(prefix);

    const results: AuditResult[] = [];
    let offset = 0;
    const limit = 1000;

    while (true) {
      const listResult = await ctx.storage.from(bucket).list(prefix, { limit, offset });

      if (listResult.error) {
        ctx.logger.log(`  Error listing ${prefix}: ${sanitizeError(listResult.error)}`);
        return [{ path: `${prefix}/*`, classification: "indeterminate" }];
      }

      const objects = listResult.data || [];
      if (objects.length === 0) break;

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
    ctx.logger.log(`\n--- Scanning bucket: ${bucket} ---`);
    const visited = new Set<string>();
    const results = await scanPrefix(bucket, "", visited);

    const counts: Partial<Record<ObjectClassificationValue, number>> = {};
    for (const { classification } of results) {
      counts[classification] = (counts[classification] || 0) + 1;
    }

    ctx.logger.log(`  Total objects: ${results.length}`);
    for (const [cls, count] of Object.entries(counts)) {
      ctx.logger.log(`  ${cls}: ${count}`);
    }

    const orphans = results.filter(r => r.classification === "possible_orphan");
    if (orphans.length > 0) {
      ctx.logger.log(`  Possible orphans (${orphans.length}):`);
      for (const orphan of orphans.slice(0, 10)) {
        ctx.logger.log(`    - ${orphan.path}`);
      }
      if (orphans.length > 10) {
        ctx.logger.log(`    ... and ${orphans.length - 10} more`);
      }
    }
  }

  ctx.logger.log("\nNote: This is a READ-ONLY audit. No objects were deleted.");
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  // Orphan audit mode - always read-only
  if (args.includes("--orphan-audit")) {
    const ctx = createProductionContext(false);
    await runOrphanAudit(ctx);
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
  const sources = options.sources || (["doc_files", "governance_files", "governance_uploads", "smp_documents"] as StorageFileSource[]);

  // Create production context with execute flag
  const ctx = createProductionContext(options.execute);

  console.log(`\n=== Legacy Storage Migration ===`);
  console.log(`Mode: ${options.execute ? "EXECUTE" : "DRY-RUN"}`);
  console.log(`Sources: ${sources.join(", ")}`);
  console.log(`Worker ID: ${ctx.workerId}`);
  console.log();

  let totalProcessed = 0, totalSuccess = 0, totalFailed = 0, totalSkipped = 0;

  for (const source of sources) {
    console.log(`--- Processing: ${source} ---`);
    if (source === "smp_documents") console.log("Note: SMP ID 31 excluded");

    const records = await fetchEligibleRecords(source, ctx, options.recordIds, options.limit);
    console.log(`Found ${records.length} records`);

    for (let i = 0; i < records.length; i += options.batchSize!) {
      const batch = records.slice(i, i + options.batchSize!);
      for (const record of batch) {
        totalProcessed++;
        const result = await processRecord(source, record, options, baseUrl, ctx);
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

// Only run main in actual CLI execution, not during module import (tests)
// ESM-safe detection: check if this module is the entry point using exact URL comparison
const isMainModule = (): boolean => {
  if (typeof process === 'undefined') return false;
  const argv1 = process.argv[1];
  if (!argv1) return false;

  // Normalize both paths to file:// URLs for exact comparison
  const currentUrl = import.meta.url;
  const executedUrl = pathToFileURL(resolve(argv1)).href;

  return currentUrl === executedUrl;
};

if (isMainModule()) {
  main().catch((err) => {
    console.error("Fatal error:", sanitizeError(err));
    process.exit(1);
  });
}

// ============================================================================
// EXPORTS FOR TESTING
// ============================================================================

export {
  processRecord,
  runOrphanAudit,
  uploadWithTus,
  decodeWithHeartbeat,
  getSourceFingerprint,
  fetchEligibleRecords,
  acquireLease,
  renewLease,
  releaseLease,
  transitionState,
  transactionalMetadataCommit,
  transactionalRollback,
  SOURCE_TABLES,
  SOURCE_BUCKETS,
  LEGACY_COLUMNS,
};

export type { MigrationOptions, ProcessingResult, SourceFingerprint, DecodedPayload };
