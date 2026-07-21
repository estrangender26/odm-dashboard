#!/usr/bin/env tsx
/**
 * Minimal Serial Storage Migrator
 * 
 * Single-worker, deterministic, idempotent migration without leases or ledger.
 * Rerun-safe: verifies/reuses existing objects, stops on mismatch.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { writeFile, mkdir, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { db } from "../api/queries/connection";
import { eq, and, sql, isNull } from "drizzle-orm";
import { governanceUploads, docFiles, governanceFiles, smpDocuments } from "../db/schema";
import { decodePayload, MAX_DECODED_BYTES, type DecodeResult } from "./lib/payload-decoder";

// ============================================================================
// CONFIGURATION
// ============================================================================

const SOURCES = ["governance_uploads", "governance_files", "doc_files", "smp_documents"] as const;
type Source = typeof SOURCES[number];

const SOURCE_BUCKETS: Record<Source, string> = {
  governance_uploads: "om-governance",
  governance_files: "om-governance",
  doc_files: "om-manuals",
  smp_documents: "smp-library",
};

const SOURCE_TABLES: Record<Source, any> = {
  governance_uploads: governanceUploads,
  governance_files: governanceFiles,
  doc_files: docFiles,
  smp_documents: smpDocuments,
};

const CHUNK_SIZE = 64 * 1024; // 64KB chunks for Base64 streaming

// ============================================================================
// TYPES
// ============================================================================

interface MigrationRecord {
  id: number;
  fileName: string | null;
  fileUrl: string | null;
  fileType: string | null;
  storagePath: string | null;
  legacyDataLength: number; // encoded length
}

interface DecodedPayload {
  tempPath: string;
  size: number;
  sha256: string;
  mimeType: string;
}

interface VerificationResult {
  exists: boolean;
  matches: boolean;
  size?: number;
  sha256?: string;
}

// ============================================================================
// SANITIZATION
// ============================================================================

function sanitizeError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return msg
    .replace(/(postgres(?:ql)?|mysql|mongodb|redis):\/\/[^\s"]+/gi, "[REDACTED_DB_URL]")
    .replace(/\b[0-9a-f]{32,}\b/gi, "[REDACTED_HASH]")
    .replace(/eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*/g, "[REDACTED_JWT]")
    .substring(0, 500);
}


/**
 * Fetch Base64 payload in bounded chunks
 */

/**
 * Fetch complete Base64 payload via bounded chunk queries
 */
async function fetchFullBase64(
  source: Source,
  id: number,
  totalLength: number
): Promise<string> {
  const chunks: string[] = [];
  const CHUNK_SIZE = 100000; // 100KB SQL chunks
  
  for (let offset = 0; offset < totalLength; offset += CHUNK_SIZE) {
    const chunk = await fetchBase64Chunk(source, id, offset, CHUNK_SIZE);
    chunks.push(chunk);
  }
  
  return chunks.join("");
}

async function fetchBase64Chunk(
  source: Source,
  id: number,
  offset: number,
  length: number
): Promise<string> {
  const table = SOURCE_TABLES[source];
  const column = source === "governance_uploads" ? "file_url" : "file_data";
  
  const result = await db
    .select({
      chunk: sql<string>`substr(${sql.raw(column)}, ${offset + 1}, ${length})`,
    })
    .from(table)
    .where(eq(sql`id`, id))
    .limit(1);
  
  return result[0]?.chunk || "";
}

// ============================================================================
// PATH GENERATION (deterministic)
// ============================================================================

function generateStoragePath(source: Source, id: number, filename: string): string {
  const safeName = filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .substring(0, 200);
  return `legacy/${source}/${id}/${safeName}`;
}

// ============================================================================
// BASE64 DECODING (bounded chunks)
// ============================================================================

async function decodePayloadToFile(
  payload: string,
  outputPath: string,
  options: { filename?: string; sourceMimeType?: string }
): Promise<{ size: number; sha256: string; mimeType: string }> {
  const result = decodePayload(payload, options);
  
  if (!result.success) {
    throw new Error(result.error || "Decode failed");
  }
  
  if (!result.bytes) {
    throw new Error("No decoded bytes");
  }
  
  // Write decoded bytes to file
  await writeFile(outputPath, result.bytes);
  
  return {
    size: result.size!,
    sha256: result.sha256!,
    mimeType: result.mimeType!,
  };
}

// ============================================================================
// STORAGE OPERATIONS
// ============================================================================

async function checkStorageObject(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  expectedSize: number,
  expectedSha256: string
): Promise<VerificationResult> {
  const { data: listData } = await supabase.storage.from(bucket).list(path.split("/").slice(0, -1).join("/"));
  const fileName = path.split("/").pop();
  const existing = listData?.find((f: any) => f.name === fileName);
  
  if (!existing) {
    return { exists: false, matches: false };
  }
  
  const { data: fileData } = await supabase.storage.from(bucket).download(path);
  if (!fileData) {
    return { exists: true, matches: false };
  }
  
  const buffer = Buffer.from(await fileData.arrayBuffer());
  const actualSha256 = createHash("sha256").update(buffer).digest("hex");
  
  return {
    exists: true,
    matches: buffer.length === expectedSize && actualSha256 === expectedSha256,
    size: buffer.length,
    sha256: actualSha256,
  };
}

async function uploadToStorage(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  filePath: string,
  mimeType: string
): Promise<void> {
  const content = await readFile(filePath);
  const { error } = await supabase.storage.from(bucket).upload(path, content, {
    contentType: mimeType,
    upsert: false,
  });
  
  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }
}

// ============================================================================
// APPLICATION VERIFICATION
// ============================================================================

async function verifyApplicationRoute(
  baseUrl: string,
  source: Source,
  id: number
): Promise<boolean> {
  try {
    // Use redirect: manual to capture the 302 redirect URL
    const response = await fetch(`${baseUrl}/api/storage/files/${source}/${id}/view`, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    
    // Require HTTP 302 with nonempty Location header
    if (response.status !== 302) {
      return false;
    }
    
    const location = response.headers.get("Location");
    return location != null && location.length > 0;
  } catch (error) {
    // Sanitize any network errors
    return false;
  }
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function getSourceFingerprint(
  source: Source,
  id: number
): Promise<{ length: number; hash: string } | null> {
  const table = SOURCE_TABLES[source];
  const column = source === "governance_uploads" ? "file_url" : "file_data";
  
  const result = await db
    .select({
      length: sql<number>`length(${sql.raw(column)})`,
      hash: sql<string>`md5(${sql.raw(column)})`,
    })
    .from(table)
    .where(eq(sql`id`, id))
    .limit(1);
  
  return result[0] || null;
}

async function getRecord(source: Source, id: number): Promise<MigrationRecord | null> {
  const table = SOURCE_TABLES[source];
  const column = source === "governance_uploads" ? "file_url" : "file_data";
  
  // governance_uploads has no file_type column; return NULL for it
  const fileTypeColumn = source === "governance_uploads" ? "NULL" : "file_type";
  
  const result = await db
    .select({
      id: sql<number>`id`,
      fileName: sql<string | null>`file_name`,
      // NEVER select full file_url/file_data - only length is queried
      fileType: sql<string | null>`${sql.raw(fileTypeColumn)}`,
      storagePath: sql<string | null>`storage_path`,
      legacyDataLength: sql<number>`COALESCE(length(${sql.raw(column)}), 0)`,
    })
    .from(table)
    .where(eq(sql`id`, id))
    .limit(1);
  
  if (!result[0]) return null;
  
  return {
    id: result[0].id,
    fileName: result[0].fileName,
    fileUrl: null, // Never expose full Base64
    fileType: result[0].fileType,
    storagePath: result[0].storagePath,
    legacyDataLength: result[0].legacyDataLength,
  };
}

async function commitMetadata(
  source: Source,
  id: number,
  bucket: string,
  path: string,
  size: number,
  mimeType: string,
  fingerprint: { length: number; hash: string }
): Promise<boolean> {
  const table = SOURCE_TABLES[source];
  const column = source === "governance_uploads" ? "file_url" : "file_data";
  
  const result = await db
    .update(table)
    .set({
      storageProvider: "supabase",
      storageBucket: bucket,
      storagePath: path,
      storageSize: size.toString(),
      storageMimeType: mimeType,
      storageUploadedAt: new Date(),
    })
    .where(and(
      eq(sql`id`, id),
      isNull(sql`storage_path`),
      eq(sql`length(${sql.raw(column)})`, fingerprint.length),
      eq(sql`md5(${sql.raw(column)})`, fingerprint.hash)
    ))
    .returning({ id: sql`id` });
  
  return result.length === 1;
}

// ============================================================================
// MAIN MIGRATION WORKFLOW
// ============================================================================

interface ProcessOptions {
  execute: boolean;
  baseUrl: string;
}

async function processRecord(
  source: Source,
  id: number,
  supabase: SupabaseClient,
  options: ProcessOptions
): Promise<{ success: boolean; skipped?: boolean; error?: string; reused?: boolean }> {
  const { execute, baseUrl } = options;
  const bucket = SOURCE_BUCKETS[source];
  
  // Step 1: Get record
  const record = await getRecord(source, id);
  if (!record) {
    return { success: false, error: "Record not found" };
  }
  
  // Check for data by length (fileUrl is never loaded fully)
  if (record.legacyDataLength === 0) {
    return { success: false, error: "No file_url data" };
  }
  
  // Step 2: Already migrated?
  if (record.storagePath) {
    return { success: true, skipped: true, reused: true };
  }
  
  // Step 3: Get fingerprint before decoding
  const fingerprint = await getSourceFingerprint(source, id);
  if (!fingerprint) {
    return { success: false, error: "Cannot fingerprint source" };
  }
  
  // Verify fingerprint matches record expectation
  if (fingerprint.length !== record.legacyDataLength) {
    return { success: false, error: "Source changed during migration" };
  }
  
  // Step 4: Decode to temp file
  const tempDir = join(tmpdir(), `odm-migrate-${Date.now()}`);
  const tempPath = join(tempDir, "payload");
  
  try {
    await mkdir(tempDir, { recursive: true, mode: 0o700 });
    
    console.log(`  [${id}] Decoding...`);
    // Fetch full Base64 in bounded chunks via SQL
    const fileUrl = await fetchFullBase64(source, id, record.legacyDataLength);
    const decoded = await decodePayloadToFile(fileUrl, tempPath, { filename: record.fileName || undefined, sourceMimeType: record.fileType || undefined });
    
    const path = generateStoragePath(source, id, record.fileName || "unnamed");
    
    // Step 5: Check if object exists
    console.log(`  [${id}] Checking Storage...`);
    const storageCheck = await checkStorageObject(supabase, bucket, path, decoded.size, decoded.sha256);
    
    if (storageCheck.exists) {
      if (!storageCheck.matches) {
        return { success: false, error: `Object exists but mismatch: expected ${decoded.size}/${decoded.sha256}, got ${storageCheck.size}/${storageCheck.sha256}` };
      }
      console.log(`  [${id}] Object exists and matches, reusing`);
    }
    
    // Step 6: Dry-run check
    if (!execute) {
      console.log(`  [${id}] ✓ Dry-run: would upload ${decoded.size} bytes to ${path}`);
      return { success: true, skipped: true };
    }
    
    // Step 7: Upload if needed
    if (!storageCheck.exists) {
      console.log(`  [${id}] Uploading...`);
      await uploadToStorage(supabase, bucket, path, tempPath, decoded.mimeType);
    }
    
    // Step 8: Verify uploaded object
    console.log(`  [${id}] Verifying object...`);
    const verifyCheck = await checkStorageObject(supabase, bucket, path, decoded.size, decoded.sha256);
    if (!verifyCheck.exists || !verifyCheck.matches) {
      return { success: false, error: "Upload verification failed" };
    }
    
    // Step 9: Transactional metadata commit
    console.log(`  [${id}] Committing metadata...`);
    const committed = await commitMetadata(source, id, bucket, path, decoded.size, decoded.mimeType, fingerprint);
    
    if (!committed) {
      return { success: false, error: "Metadata commit failed (concurrent change detected)" };
    }
    
    // Step 10: Application verification
    console.log(`  [${id}] Verifying application route...`);
    const appOk = await verifyApplicationRoute(baseUrl, source, id);
    if (!appOk) {
      return { success: false, error: "Application verification failed" };
    }
    
    console.log(`  [${id}] ✓ Migrated successfully`);
    return { success: true, reused: storageCheck.exists };
    
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  } finally {
    // Cleanup
    try { await unlink(tempPath); } catch {}
    try { await unlink(tempDir); } catch {}
  }
}

// ============================================================================
// CLI
// ============================================================================

function showHelp() {
  console.log(`
Minimal Storage Migrator

Usage: npx tsx scripts/minimal-storage-migrator.ts [options]

Options:
  --sources <list>          Comma-separated sources (default: all)
  --ids <list>              Comma-separated record IDs to process
  --limit <n>               Max records per source (default: unlimited)
  --batch-size <n>          Records per transaction (default: 1)
  --execute                 Enable writes (default: dry-run)
  --confirm-production      Required flag for execute mode
  --help                    Show this help

Examples:
  # Dry run
  npx tsx scripts/minimal-storage-migrator.ts --sources governance_uploads --ids 7 --limit 1

  # Execute (requires both flags)
  npx tsx scripts/minimal-storage-migrator.ts --sources governance_uploads --ids 7 --execute --confirm-production
`);
}

function parseArgs(): {
  sources: Source[];
  ids: number[] | null;
  limit: number | null;
  batchSize: number;
  execute: boolean;
  confirmProduction: boolean;
} {
  const args = process.argv.slice(2);
  
  if (args.includes("--help")) {
    showHelp();
    process.exit(0);
  }
  
  const getValue = (flag: string): string | null => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
  };
  
  const sourcesArg = getValue("--sources");
  const sources = sourcesArg
    ? sourcesArg.split(",").filter((s): s is Source => SOURCES.includes(s as Source))
    : [...SOURCES];
  
  const idsArg = getValue("--ids");
  const ids = idsArg ? idsArg.split(",").map(Number).filter(n => !isNaN(n)) : null;
  
  const limitArg = getValue("--limit");
  const limit = limitArg ? parseInt(limitArg, 10) : null;
  
  const batchSizeArg = getValue("--batch-size");
  const batchSize = batchSizeArg ? parseInt(batchSizeArg, 10) : 1;
  
  return {
    sources,
    ids,
    limit,
    batchSize,
    execute: args.includes("--execute"),
    confirmProduction: args.includes("--confirm-production"),
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const options = parseArgs();
  
  console.log("=== Minimal Storage Migrator ===");
  console.log(`Mode: ${options.execute ? "EXECUTE" : "DRY-RUN"}`);
  console.log(`Sources: ${options.sources.join(", ")}`);
  
  if (options.execute && !options.confirmProduction) {
    console.error("ERROR: --confirm-production required for execute mode");
    process.exit(1);
  }
  
  // Initialize Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
    process.exit(1);
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
  
  // Process records
  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  
  for (const source of options.sources) {
    console.log(`\n--- Processing: ${source} ---`);
    
    // Get IDs to process
    const idsToProcess: number[] = [];
    
    if (options.ids) {
      idsToProcess.push(...options.ids);
    } else {
      // Query all unmigrated records (excluding SMP ID 31 for smp_documents source)
      const table = SOURCE_TABLES[source];
      const column = source === "governance_uploads" ? "file_url" : "file_data";
      
      const records = await db
        .select({ id: sql<number>`id` })
        .from(table)
        .where(and(
          sql`${sql.raw(column)} IS NOT NULL`,
          isNull(sql`storage_path`),
          source === "smp_documents" ? sql`id != 31` : sql`1=1`
        ))
        .limit(options.limit || 10000);
      
      idsToProcess.push(...records.map(r => r.id));
    }
    
    console.log(`Found ${idsToProcess.length} records`);
    
    // Process each record serially
    for (const id of idsToProcess) {
      const result = await processRecord(source, id, supabase, {
        execute: options.execute,
        baseUrl,
      });
      
      totalProcessed++;
      
      if (result.success) {
        if (result.skipped) {
          console.log(`  [${id}] ⊘ ${result.reused ? "Already migrated" : "Dry-run"}`);
          totalSkipped++;
        } else {
          totalSuccess++;
        }
      } else {
        console.log(`  [${id}] ✗ ${result.error}`);
        totalFailed++;
      }
    }
  }
  
  console.log("\n=== Summary ===");
  console.log(`Processed: ${totalProcessed}, Success: ${totalSuccess}, Failed: ${totalFailed}, Skipped: ${totalSkipped}`);
  
  if (!options.execute) {
    console.log("DRY-RUN complete - no changes made");
  }
  
  process.exit(totalFailed > 0 ? 1 : 0);
}

// ESM-safe entry point
const currentFile = new URL(import.meta.url).pathname;
const executedFile = process.argv[1] ? new URL(`file://${process.argv[1]}`).pathname : "";

if (currentFile === executedFile || executedFile.endsWith("minimal-storage-migrator.ts")) {
  main().catch((err) => {
    console.error("Fatal error:", sanitizeError(err));
    process.exit(1);
  });
}

export { processRecord, generateStoragePath };
