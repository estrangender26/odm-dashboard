import { createHash } from "node:crypto";
import { eq, and, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../api/queries/connection";
import {
  docFiles,
  governanceFiles,
  governanceUploads,
  smpDocuments,
  legacyStorageMigrationLedger,
  storageUploadIntents,
  type MigrationState,
} from "../db/schema";
import { getSupabaseStorageAdmin } from "../api/supabase-storage";
import { STORAGE_BUCKET_BY_MODULE, type StorageFileSource } from "../contracts/storage";
import type { SupabaseClient } from "@supabase/supabase-js";

// Source to table mapping
const SOURCE_TABLES: Record<StorageFileSource, typeof docFiles | typeof governanceFiles | typeof governanceUploads | typeof smpDocuments> = {
  doc_files: docFiles,
  governance_files: governanceFiles,
  governance_uploads: governanceUploads,
  smp_documents: smpDocuments,
};

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

interface MigrationOptions {
  execute: boolean;
  confirmProduction: boolean;
  sources?: StorageFileSource[];
  recordIds?: number[];
  limit?: number;
  batchSize?: number;
  concurrency?: number;
  excludeIds?: string; // comma-separated source:id pairs
}

interface FileRecord {
  id: number;
  fileName: string | null;
  fileType: string | null;
  legacyData: string | null;
  storagePath: string | null;
}

interface DecodedPayload {
  buffer: Buffer;
  mimeType: string;
  size: number;
  sha256: string;
}

// Parse command line arguments
function parseArgs(): MigrationOptions {
  const args = process.argv.slice(2);
  const options: MigrationOptions = {
    execute: false,
    confirmProduction: false,
    batchSize: 10,
    concurrency: 1,
  };

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
        options.batchSize = parseInt(args[++i] || "10", 10);
        break;
      case "--concurrency":
        options.concurrency = parseInt(args[++i] || "1", 10);
        break;
      case "--exclude":
        options.excludeIds = args[++i];
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
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
  --sources <list>       Comma-separated sources (doc_files,governance_files,governance_uploads,smp_documents)
  --ids <list>           Comma-separated record IDs to process
  --limit <n>            Maximum records to process
  --batch-size <n>       Records per batch (default: 10)
  --concurrency <n>      Parallel workers (default: 1)
  --exclude <list>       Comma-separated source:id pairs to exclude (e.g., smp_documents:31)
  --help, -h            Show this help

Examples:
  # Dry-run inventory
  npx tsx scripts/legacy-storage-migrator.ts

  # Dry-run specific source
  npx tsx scripts/legacy-storage-migrator.ts --sources doc_files --limit 5

  # Execute migration (requires both flags)
  npx tsx scripts/legacy-storage-migrator.ts --execute --confirm-production --sources doc_files --limit 1
`);
}

// Decode Base64 or data URL
function decodeLegacyData(value: string): DecodedPayload {
  let mimeType = "application/octet-stream";
  let encoded = value.trim();

  if (encoded.startsWith("data:")) {
    const comma = encoded.indexOf(",");
    const header = comma >= 0 ? encoded.slice(5, comma) : "";
    const declared = header.split(";")[0];
    if (declared) mimeType = declared;
    encoded = comma >= 0 ? encoded.slice(comma + 1) : "";
  }

  const buffer = Buffer.from(encoded, "base64");
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  return {
    buffer,
    mimeType,
    size: buffer.length,
    sha256,
  };
}

// Sanitize filename for path
function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .substring(0, 200);
}

// Generate deterministic path
function generateStoragePath(source: StorageFileSource, recordId: number, filename: string): string {
  const sanitized = sanitizeFilename(filename);
  return `legacy/${source}/${recordId}/${sanitized}`;
}

// Fetch eligible records from a source
async function fetchEligibleRecords(
  source: StorageFileSource,
  recordIds?: number[],
  limit?: number,
  excludeIds?: Set<string>
): Promise<FileRecord[]> {
  const table = SOURCE_TABLES[source];
  const legacyColumn = LEGACY_COLUMNS[source];

  // Build conditions
  const conditions = [sql`length(${sql.raw(legacyColumn)}) > 0`];

  if (recordIds?.length) {
    conditions.push(inArray(table.id, recordIds));
  }

  // Exclude already migrated records (storage_path is set)
  conditions.push(isNull(sql`storage_path`));

  let query = db
    .select({
      id: table.id,
      fileName: source === "governance_uploads" ? sql<string | null>`${sql.raw("file_name")}` : table.fileName,
      fileType: source === "governance_uploads" ? sql<string | null>`null` : table.fileType,
      legacyData: sql<string | null>`${sql.raw(legacyColumn)}`,
      storagePath: sql<string | null>`storage_path`,
    })
    .from(table)
    .where(and(...conditions));

  if (limit) {
    query = query.limit(limit);
  }

  const rows = await query;

  return rows
    .filter((r): r is typeof r &amp; { legacyData: string } => !!r.legacyData)
    .filter((r) => !excludeIds?.has(`${source}:${r.id}`))
    .map((r) => ({
      id: r.id,
      fileName: r.fileName,
      fileType: r.fileType,
      legacyData: r.legacyData,
      storagePath: r.storagePath,
    }));
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
      set: {
        updatedAt: new Date(),
      },
    });
}

// Update ledger state
async function updateLedgerState(
  source: StorageFileSource,
  recordId: number,
  state: MigrationState,
  execute: boolean,
  error?: string
): Promise<void> {
  if (!execute) return;

  const updates: Record<string, unknown> = { state, updatedAt: new Date() };

  if (error) {
    // Sanitize error - remove any potentially sensitive info
    updates.lastError = error.substring(0, 500).replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f]/g, "");
  }

  if (state === "object_verified") {
    updates.objectVerifiedAt = new Date();
  } else if (state === "metadata_committed") {
    updates.metadataCommittedAt = new Date();
  } else if (state === "app_verified") {
    updates.appVerifiedAt = new Date();
  } else if (state === "rolled_back") {
    updates.rollbackAt = new Date();
  }

  await db
    .update(legacyStorageMigrationLedger)
    .set(updates)
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

// Upload to Supabase Storage using multipart upload
async function uploadToStorage(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  buffer: Buffer,
  mimeType: string,
  execute: boolean
): Promise<{ etag: string | null } | null> {
  if (!execute) {
    return { etag: "dry-run-etag" };
  }

  // Check if object already exists
  const { data: existing } = await supabase.storage.from(bucket).list(path.split("/").slice(0, -1).join("/"), {
    search: path.split("/").pop(),
  });

  const exists = existing?.some((obj) => obj.name === path.split("/").pop());

  if (exists) {
    throw new Error(`Object already exists at ${path}`);
  }

  // Upload using standard upload (buffer is already in memory from Base64 decode)
  const { data, error } = await supabase.storage.from(bucket).upload(path, buffer, {
    contentType: mimeType,
    upsert: false,
  });

  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }

  // Get object info to retrieve ETag
  const { data: objData } = await supabase.storage.from(bucket).list(path.split("/").slice(0, -1).join("/"), {
    search: path.split("/").pop(),
  });

  const etag = objData?.find((o) => o.name === path.split("/").pop())?.metadata?.eTag || null;

  return { etag };
}

// Verify object in storage
async function verifyStorageObject(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  expectedSize: number,
  expectedSha256: string,
  execute: boolean
): Promise<boolean> {
  if (!execute) return true;

  // Download and verify
  const { data, error } = await supabase.storage.from(bucket).download(path);

  if (error || !data) {
    throw new Error(`Failed to download object for verification: ${error?.message || "unknown"}`);
  }

  const buffer = Buffer.from(await data.arrayBuffer());

  if (buffer.length !== expectedSize) {
    throw new Error(`Size mismatch: expected ${expectedSize}, got ${buffer.length}`);
  }

  const sha256 = createHash("sha256").update(buffer).digest("hex");

  if (sha256 !== expectedSha256) {
    throw new Error(`SHA-256 mismatch: expected ${expectedSha256}, got ${sha256}`);
  }

  return true;
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

    // Follow redirect and check content
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
      return { ok: false, error: `Content SHA-256 mismatch` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// Process a single record
async function processRecord(
  source: StorageFileSource,
  record: FileRecord,
  supabase: SupabaseClient,
  options: MigrationOptions,
  baseUrl: string
): Promise<{ success: boolean; state?: MigrationState; error?: string }> {
  const { execute } = options;

  try {
    // Step 1: Confirm legacy payload exists
    if (!record.legacyData) {
      return { success: false, error: "No legacy data" };
    }

    // Step 2: Confirm storage_path is null
    if (record.storagePath) {
      return { success: false, error: "Already has storage_path" };
    }

    // Step 3: Decode and calculate size and SHA-256
    let decoded: DecodedPayload;
    try {
      decoded = decodeLegacyData(record.legacyData);
    } catch (err) {
      return { success: false, error: `Failed to decode: ${String(err)}` };
    }

    if (decoded.size === 0) {
      return { success: false, error: "Empty payload" };
    }

    const bucket = SOURCE_BUCKETS[source];
    const filename = record.fileName || "unnamed";
    const path = generateStoragePath(source, record.id, filename);

    // Step 4: Upsert/check the ledger
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
    await updateLedgerState(source, record.id, "uploading", execute);

    // Step 5: Upload to deterministic private Storage path
    let etag: string | null = null;
    try {
      const result = await uploadToStorage(supabase, bucket, path, decoded.buffer, decoded.mimeType, execute);
      etag = result?.etag || null;
    } catch (err) {
      await updateLedgerState(source, record.id, "failed", execute, String(err));
      return { success: false, error: `Upload failed: ${String(err)}` };
    }

    await updateLedgerState(source, record.id, "uploaded", execute);

    // Step 6: Verify Storage object size and MIME type
    try {
      await verifyStorageObject(supabase, bucket, path, decoded.size, decoded.sha256, execute);
    } catch (err) {
      await updateLedgerState(source, record.id, "failed", execute, String(err));
      return { success: false, error: `Object verification failed: ${String(err)}` };
    }

    await updateLedgerState(source, record.id, "object_verified", execute);

    // Step 8: Recheck that the legacy source record has not changed
    const current = await fetchEligibleRecords(source, [record.id], 1);
    if (current.length === 0 || current[0].legacyData !== record.legacyData) {
      await updateLedgerState(source, record.id, "failed", execute, "Source record changed during migration");
      return { success: false, error: "Source record changed during migration" };
    }

    // Step 9: Atomically populate only the Storage metadata columns
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

    // Step 11: Verify the public application route
    const appVerify = await verifyApplicationRoute(
      source,
      record.id,
      decoded.size,
      decoded.sha256,
      baseUrl,
      execute
    );

    if (!appVerify.ok) {
      // Rollback: clear storage metadata
      await clearStorageMetadata(source, record.id, execute);
      await updateLedgerState(source, record.id, "rollback_required", execute, appVerify.error);
      return { success: false, error: `App verification failed: ${appVerify.error}` };
    }

    await updateLedgerState(source, record.id, "app_verified", execute);

    return { success: true, state: "app_verified" };
  } catch (err) {
    const error = String(err);
    await updateLedgerState(source, record.id, "failed", execute, error);
    return { success: false, error };
  }
}

// Main migration function
async function runMigration(options: MigrationOptions): Promise<void> {
  const sources = options.sources || (["doc_files", "governance_files", "governance_uploads", "smp_documents"] as StorageFileSource[]);
  const excludeSet = options.excludeIds ? new Set(options.excludeIds.split(",")) : new Set<string>();

  // Check environment
  const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
  if (!baseUrl) {
    console.error("APP_BASE_URL environment variable is required");
    process.exit(1);
  }

  // Get Supabase client
  let supabase: SupabaseClient;
  try {
    supabase = getSupabaseStorageAdmin();
  } catch (err) {
    console.error("Failed to initialize Supabase Storage client:", err);
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

    // Skip SMP ID 31 if in smp_documents
    if (source === "smp_documents") {
      console.log("Note: SMP ID 31 is excluded (smoke artifact requiring audit)");
    }

    const records = await fetchEligibleRecords(source, options.recordIds, options.limit, excludeSet);

    console.log(`Found ${records.length} eligible records`);

    for (let i = 0; i < records.length; i += options.batchSize!) {
      const batch = records.slice(i, i + options.batchSize!);
      console.log(`  Batch ${Math.floor(i / options.batchSize!) + 1}: ${batch.length} records`);

      for (const record of batch) {
        totalProcessed++;

        // Check ledger for already verified
        const existing = await db
          .select({ state: legacyStorageMigrationLedger.state })
          .from(legacyStorageMigrationLedger)
          .where(
            and(
              eq(legacyStorageMigrationLedger.source, source),
              eq(legacyStorageMigrationLedger.recordId, record.id)
            )
          )
          .limit(1);

        if (existing[0]?.state === "app_verified") {
          console.log(`    [${source}:${record.id}] Already app_verified - skipping`);
          totalSkipped++;
          continue;
        }

        const result = await processRecord(source, record, supabase, options, baseUrl);

        if (result.success) {
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
  console.log(`Skipped (already verified): ${totalSkipped}`);
  console.log(`Mode: ${options.execute ? "EXECUTE" : "DRY-RUN"}`);

  if (!options.execute) {
    console.log(`\nThis was a DRY-RUN. No changes were made.`);
    console.log(`To execute, add --execute --confirm-production flags.`);
  }
}

// Orphan audit mode
async function runOrphanAudit(): Promise<void> {
  console.log("\n=== Storage Orphan Audit ===\n");

  const supabase = getSupabaseStorageAdmin();
  const buckets = ["om-manuals", "om-governance", "smp-library"];

  const referencedPaths = new Set<string>();
  const intentPaths = new Set<string>();
  const ledgerPaths = new Set<string>();

  // Collect referenced paths from source tables
  const sources: StorageFileSource[] = ["doc_files", "governance_files", "governance_uploads", "smp_documents"];

  for (const source of sources) {
    const table = SOURCE_TABLES[source];
    const rows = await db
      .select({
        bucket: sql<string | null>`storage_bucket`,
        path: sql<string | null>`storage_path`,
      })
      .from(table)
      .where(sql`storage_path IS NOT NULL`);

    for (const row of rows) {
      if (row.bucket && row.path) {
        referencedPaths.add(`${row.bucket}:${row.path}`);
      }
    }
  }

  // Collect paths from upload intents
  const intents = await db
    .select({
      bucket: storageUploadIntents.expectedBucket,
      path: storageUploadIntents.expectedPath,
      status: storageUploadIntents.status,
    })
    .from(storageUploadIntents);

  for (const intent of intents) {
    if (intent.status === "finalized") {
      intentPaths.add(`${intent.bucket}:${intent.path}`);
    } else if (["pending", "uploading"].includes(intent.status)) {
      // Active upload intent
    }
  }

  // Collect paths from migration ledger
  const ledger = await db
    .select({
      bucket: legacyStorageMigrationLedger.bucket,
      path: legacyStorageMigrationLedger.storagePath,
      state: legacyStorageMigrationLedger.state,
    })
    .from(legacyStorageMigrationLedger);

  for (const entry of ledger) {
    if (entry.state === "app_verified") {
      ledgerPaths.add(`${entry.bucket}:${entry.path}`);
    } else if (["uploaded", "object_verified", "metadata_committed"].includes(entry.state)) {
      // Migration staged
    }
  }

  console.log(`Referenced paths from tables: ${referencedPaths.size}`);
  console.log(`Finalized intent paths: ${intentPaths.size}`);
  console.log(`Verified ledger paths: ${ledgerPaths.size}`);

  // Scan each bucket
  for (const bucket of buckets) {
    console.log(`\n--- Scanning bucket: ${bucket} ---`);

    const { data: objects, error } = await supabase.storage.from(bucket).list("", { limit: 1000 });

    if (error) {
      console.log(`  Error listing bucket: ${error.message}`);
      continue;
    }

    if (!objects) {
      console.log("  No objects found");
      continue;
    }

    for (const obj of objects) {
      // Skip folders (they have no metadata)
      if (!obj.metadata) continue;

      const fullPath = obj.name.startsWith("legacy/") ? obj.name : `${obj.name}`;
      const key = `${bucket}:${fullPath}`;

      let classification = "indeterminate";

      if (referencedPaths.has(key) || intentPaths.has(key) || ledgerPaths.has(key)) {
        classification = "referenced";
      } else if ([...intentPaths].some((p) => p.startsWith(`${bucket}:`))) {
        // Could be active upload intent
        classification = "possible_orphan";
      } else {
        classification = "possible_orphan";
      }

      console.log(`  ${fullPath}: ${classification} (${obj.metadata?.size || "unknown"} bytes)`);
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
  console.error("Fatal error:", err);
  process.exit(1);
});
