#!/usr/bin/env tsx
/**
 * Minimal Serial Storage Migrator
 * 
 * Safe legacy Base64 migration to Supabase Storage.
 * Dry-run: Fast metadata-only inspection
 * Execute: Serial processing with verification
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { mkdir, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { db } from "../api/queries/connection";
import { eq, and, sql, isNull } from "drizzle-orm";
import { governanceUploads, docFiles, governanceFiles, smpDocuments } from "../db/schema";
import { decodePayloadStream } from "./lib/payload-decoder";

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

// ============================================================================
// TYPES
// ============================================================================

interface DryRunRecord {
  id: number;
  fileName: string | null;
  payloadLength: number;
}

/**
 * Tri-state verification result
 * - unverified: true when hash verification was not performed (dry-run)
 * - When unverified=true, matches is undefined
 * - When unverified=false, matches indicates hash match status
 */
export interface VerificationResult {
  exists: boolean;
  unverified: boolean;
  matches?: boolean;
  size?: number;
  sha256?: string;
  error?: string;
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

// ============================================================================
// PATH GENERATION (deterministic)
// ============================================================================

export function generateStoragePath(source: Source, id: number, filename: string): string {
  const safeName = filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .substring(0, 200);
  return `legacy/${source}/${id}/${safeName}`;
}

// ============================================================================
// DRY-RUN: Fast metadata-only inspection
// ============================================================================

async function runDryRun(options: {
  sources: Source[];
  ids: number[] | null;
  limit: number | null;
}): Promise<void> {
  console.log("=== Minimal Storage Migrator ===");
  console.log("Mode: DRY-RUN");
  console.log(`Sources: ${options.sources.join(", ")}`);
  console.log("");
  
  let totalWouldMigrate = 0;
  let totalAlreadyMigrated = 0;
  let totalBytes = 0;
  
  for (const source of options.sources) {
    console.log(`--- Processing: ${source} ---`);
    
    const config = getSourceConfig(source);
    const table = config.table;
    const payloadColumn = config.payloadColumn;
    const bucket = SOURCE_BUCKETS[source];
    
    // Query: unmigrated records with payload
    const conditions: any[] = [
      sql`${sql.raw(payloadColumn)} IS NOT NULL`,
      sql`length(${sql.raw(payloadColumn)}) > 0`,
    ];
    
    // Check already migrated vs not
    const unmigratedQuery = db
      .select({
        id: sql<number>`id`,
        fileName: sql<string | null>`file_name`,
        payloadLength: sql<number>`length(${sql.raw(payloadColumn)})`,
      })
      .from(table)
      .where(and(
        ...conditions,
        isNull(sql`storage_path`)
      ));
    
    const migratedQuery = db
      .select({ id: sql<number>`id` })
      .from(table)
      .where(and(
        ...conditions,
        sql`storage_path IS NOT NULL`
      ));
    
    // Apply ID filter if specified
    if (options.ids && options.ids.length > 0) {
      const idList = sql.join(options.ids.map(id => sql`${id}`), sql`, `);
      unmigratedQuery.where(sql`id IN (${idList})`);
      migratedQuery.where(sql`id IN (${idList})`);
    }
    
    // Apply smp_documents exclusion
    if (isRecordExcluded(source, 31)) {
      unmigratedQuery.where(sql`id != 31`);
      migratedQuery.where(sql`id != 31`);
    }
    
    // Execute queries
    const [unmigrated, migrated] = await Promise.all([
      unmigratedQuery.limit(options.limit || 10000),
      migratedQuery
    ]);
    
    // Report already migrated
    for (const record of migrated) {
      totalAlreadyMigrated++;
      const targetPath = generateStoragePath(source, record.id, "unknown");
      console.log(
        `[${source}] ID=${record.id} | ` +
        `File="unknown" | ` +
        `Length=N/A | ` +
        `Bucket=${bucket} | ` +
        `Path=${targetPath} | ` +
        `Status=ALREADY_MIGRATED`
      );
    }
    
    // Report candidates
    for (const record of unmigrated) {
      totalWouldMigrate++;
      totalBytes += record.payloadLength;
      const targetPath = generateStoragePath(source, record.id, record.fileName || "unnamed");
      
      console.log(
        `[${source}] ID=${record.id} | ` +
        `File="${record.fileName || "unnamed"}" | ` +
        `Length=${record.payloadLength} bytes | ` +
        `Bucket=${bucket} | ` +
        `Path=${targetPath} | ` +
        `Status=WOULD_MIGRATE`
      );
    }
    
    console.log("");
  }
  
  console.log("=== Summary ===");
  console.log(`Total candidates: ${totalWouldMigrate + totalAlreadyMigrated}`);
  console.log(`Would migrate: ${totalWouldMigrate} (${formatBytes(totalBytes)})`);
  console.log(`Already migrated: ${totalAlreadyMigrated}`);
  console.log("DRY-RUN complete - no changes made");
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// ============================================================================
// EXECUTE MODE: Full migration with verification
// ============================================================================

async function getSourceFingerprint(
  source: Source,
  id: number
): Promise<{ length: number; hash: string } | null> {
  const config = getSourceConfig(source);
  const table = config.table;
  const column = config.payloadColumn;
  
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

async function fetchFullBase64(source: Source, id: number): Promise<string> {
  const config = getSourceConfig(source);
  const column = config.payloadColumn;
  const table = config.table;
  
  const result = await db
    .select({ data: sql<string>`${sql.raw(column)}` })
    .from(table)
    .where(eq(sql`id`, id))
    .limit(1);
  
  return result[0]?.data || "";
}

async function decodePayload(payload: string, tempPath: string, options: { filename?: string; sourceMimeType?: string }): Promise<{ size: number; sha256: string; mimeType: string }> {
  const result = await decodePayloadStream(payload, { ...options, tempPath });
  
  if (!result.success) {
    throw new Error(result.error || "Decode failed");
  }
  
  return {
    size: result.size!,
    sha256: result.sha256!,
    mimeType: result.mimeType!,
  };
}


// Lightweight existence check (no download/verify)
export async function checkStorageObjectExists(
  supabase: SupabaseClient,
  bucket: string,
  path: string
): Promise<{ exists: boolean; error?: string }> {
  try {
    const { data: listData, error: listError } = await supabase.storage.from(bucket).list(path.split("/").slice(0, -1).join("/"));
    
    if (listError) {
      return { exists: false, error: `Storage list failed: ${listError.message}` };
    }
    
    const fileName = path.split("/").pop();
    const existing = listData?.find((f: any) => f.name === fileName);
    
    return { exists: !!existing };
  } catch (error) {
    return { exists: false, error: sanitizeError(error) };
  }
}

export async function checkStorageObject(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  expectedSize: number,
  expectedSha256: string
): Promise<VerificationResult> {
  try {
    // First check if object exists via list (cheaper than download)
    const { data: listData, error: listError } = await supabase.storage.from(bucket).list(path.split("/").slice(0, -1).join("/"));
    
    if (listError) {
      return { exists: false, unverified: false, matches: false, error: `Storage list failed: ${listError.message}` };
    }
    
    const fileName = path.split("/").pop();
    const existing = listData?.find((f: any) => f.name === fileName);
    
    if (!existing) {
      return { exists: false, unverified: false, matches: false };
    }
    
    // Object exists, now download and verify
    const { data: fileData, error: downloadError } = await supabase.storage.from(bucket).download(path);
    
    if (downloadError) {
      return { exists: true, unverified: false, matches: false, error: downloadError.message };
    }
    
    if (!fileData) {
      return { exists: true, unverified: false, matches: false };
    }
    
    const buffer = Buffer.from(await fileData.arrayBuffer());
    const actualSha256 = createHash("sha256").update(buffer).digest("hex");
    const matches = buffer.length === expectedSize && actualSha256 === expectedSha256;
    
    return {
      exists: true,
      unverified: false,
      matches,
      size: buffer.length,
      sha256: actualSha256,
    };
  } catch (error) {
    return { exists: false, unverified: false, matches: false, error: sanitizeError(error) };
  }
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

async function commitMetadata(
  source: Source,
  id: number,
  bucket: string,
  path: string,
  size: number,
  mimeType: string
): Promise<boolean> {
  const config = getSourceConfig(source);
  const table = config.table;
  
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
      isNull(sql`storage_path`)
    ))
    .returning({ id: sql`id` });
  
  return result.length === 1;
}

async function runExecute(options: {
  sources: Source[];
  ids: number[] | null;
  limit: number | null;
  supabaseUrl: string;
  supabaseKey: string;
}): Promise<void> {
  console.log("=== Minimal Storage Migrator ===");
  console.log("Mode: EXECUTE");
  console.log(`Sources: ${options.sources.join(", ")}`);
  console.log("");
  
  const supabase = createClient(options.supabaseUrl, options.supabaseKey);
  
  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalBytes = 0;
  
  const startTime = Date.now();
  
  for (const source of options.sources) {
    console.log(`\n--- Processing: ${source} ---`);
    
    // Get candidates (same query as dry-run)
    const config = getSourceConfig(source);
    const table = config.table;
    const payloadColumn = config.payloadColumn;
    const bucket = SOURCE_BUCKETS[source];
    
    const conditions: any[] = [
      sql`${sql.raw(payloadColumn)} IS NOT NULL`,
      sql`length(${sql.raw(payloadColumn)}) > 0`,
      isNull(sql`storage_path`),
    ];
    
    if (isRecordExcluded(source, 31)) {
      conditions.push(sql`id != 31`);
    }
    
    let query = db
      .select({
        id: sql<number>`id`,
        fileName: sql<string | null>`file_name`,
        payloadLength: sql<number>`length(${sql.raw(payloadColumn)})`,
      })
      .from(table)
      .where(and(...conditions));
    
    if (options.ids && options.ids.length > 0) {
      query = query.where(sql`id IN (${sql.join(options.ids.map(id => sql`${id}`), sql`, `)})`);
    }
    
    const candidates = await query.limit(options.limit || 10000);
    
    console.log(`Found ${candidates.length} candidate records\n`);
    
    for (const candidate of candidates) {
      totalProcessed++;
      console.log(`[${source}] ID=${candidate.id} - Starting processing`);
      
      try {
        const targetPath = generateStoragePath(source, candidate.id, candidate.fileName || "unnamed");
        
        // Get fingerprint (execute mode only)
        console.log(`  -> Getting fingerprint`);
        const fingerprint = await getSourceFingerprint(source, candidate.id);
        if (!fingerprint) {
          console.log(`  -> ERROR: Cannot get fingerprint`);
          totalFailed++;
          continue;
        }
        
        if (fingerprint.length !== candidate.payloadLength) {
          console.log(`  -> ERROR: Source changed during migration`);
          totalFailed++;
          continue;
        }
        
        // Fetch and decode
        console.log(`  -> Fetching payload (${candidate.payloadLength} bytes)`);
        const payload = await fetchFullBase64(source, candidate.id);
        
        const tempDir = join(tmpdir(), `odm-migrate-${Date.now()}-${candidate.id}`);
        const tempPath = join(tempDir, "payload");
        await mkdir(tempDir, { recursive: true, mode: 0o700 });
        
        let decoded: { size: number; sha256: string; mimeType: string };
        
        // Outer try/finally to ensure tempDir cleanup
        try {
          // Decode payload (writes to tempPath, do not delete until after upload)
          console.log(`  -> Decoding payload`);
          decoded = await decodePayload(payload, tempPath, {
            filename: candidate.fileName || undefined,
          });
          console.log(`  -> Decoded: ${decoded.size} bytes`);
          // Check existing object
          console.log(`  -> Checking Storage`);
          const existingCheck = await checkStorageObject(supabase, bucket, targetPath, decoded.size, decoded.sha256);
        
          if (existingCheck.exists) {
            if (existingCheck.matches) {
              console.log(`  -> Object exists and matches, reusing`);
              const committed = await commitMetadata(source, candidate.id, bucket, targetPath, decoded.size, decoded.mimeType);
              if (committed) {
                console.log(`  -> Metadata committed`);
                totalSuccess++;
                totalSkipped++;
              } else {
                console.log(`  -> Metadata commit failed`);
                totalFailed++;
              }
            } else {
              console.log(`  -> ERROR: Object exists but SHA mismatch - not overwriting`);
              totalFailed++;
            }
          continue;
            continue;
          }
        
          // Upload
          console.log(`  -> Uploading to ${bucket}/${targetPath}`);
          await uploadToStorage(supabase, bucket, targetPath, tempPath, decoded.mimeType);
        
          // Verify upload
          console.log(`  -> Verifying upload`);
          const verifyCheck = await checkStorageObject(supabase, bucket, targetPath, decoded.size, decoded.sha256);
        
          if (!verifyCheck.exists || !verifyCheck.matches) {
            console.log(`  -> ERROR: Upload verification failed`);
            totalFailed++;
          continue;
            continue;
          }
        
          // Commit metadata
          console.log(`  -> Committing metadata`);
          const committed = await commitMetadata(source, candidate.id, bucket, targetPath, decoded.size, decoded.mimeType);
        
          if (!committed) {
            console.log(`  -> ERROR: Metadata commit failed`);
            totalFailed++;
          continue;
            continue;
          }
        
          console.log(`  -> SUCCESS: Migrated`);
          totalSuccess++;
          totalBytes += decoded.size;
        
        
        } finally {
          // Clean up tempDir after success, skip, or failure
          try { await rm(tempDir, { recursive: true, force: true }); } catch {}
        }
      } catch (error) {
        console.log(`  -> ERROR: ${sanitizeError(error)}`);
        totalFailed++;
      }
    }
  }
  
  const elapsed = (Date.now() - startTime) / 1000;
  
  console.log("\n=== Summary ===");
  console.log(`Processed: ${totalProcessed}`);
  console.log(`Success: ${totalSuccess}`);
  console.log(`Failed: ${totalFailed}`);
  console.log(`Skipped: ${totalSkipped}`);
  console.log(`Total bytes migrated: ${formatBytes(totalBytes)}`);
  console.log(`Elapsed time: ${elapsed.toFixed(1)}s`);
  
  process.exit(totalFailed > 0 ? 1 : 0);
}

// ============================================================================
// CLI
// ============================================================================

function showHelp() {
  console.log(`
Minimal Storage Migrator

Usage: npx tsx scripts/minimal-storage-migrator.ts [options]

Options:
  --sources <list>          Comma-separated sources
  --ids <list>              Comma-separated record IDs
  --limit <n>               Maximum records to process
  --execute                 Enable writes
  --confirm-production      Required for execute mode
  --help                    Show this help

Examples:
  npx tsx scripts/minimal-storage-migrator.ts --sources doc_files --limit 10
  npx tsx scripts/minimal-storage-migrator.ts --sources doc_files --ids 1,2,3 --execute --confirm-production
`);
}

function parseArgs(): {
  sources: Source[];
  ids: number[] | null;
  limit: number | null;
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
  
  return {
    sources,
    ids,
    limit,
    execute: args.includes("--execute"),
    confirmProduction: args.includes("--confirm-production"),
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const options = parseArgs();
  
  if (options.execute && !options.confirmProduction) {
    console.error("ERROR: --confirm-production required for execute mode");
    process.exit(1);
  }
  
  if (options.execute) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
      process.exit(1);
    }
    
    await runExecute({
      sources: options.sources,
      ids: options.ids,
      limit: options.limit,
      supabaseUrl,
      supabaseKey,
    });
  } else {
    await runDryRun({
      sources: options.sources,
      ids: options.ids,
      limit: options.limit,
    });
    process.exit(0);
  }
}

const currentFile = new URL(import.meta.url).pathname;
const executedFile = process.argv[1] ? new URL(`file://${process.argv[1]}`).pathname : "";

if (currentFile === executedFile || executedFile.endsWith("minimal-storage-migrator.ts")) {
  main().catch((err) => {
    console.error("Fatal error:", sanitizeError(err));
    process.exit(1);
  });
}

// ============================================================================
// EXPORTS
// ============================================================================

export type { Source };
export { SOURCES, SOURCE_BUCKETS, SOURCE_TABLES };

export function canExecute(execute: boolean, confirmProduction: boolean): boolean {
  return execute && confirmProduction;
}

export function shouldRejectExecution(execute: boolean, confirmProduction: boolean): boolean {
  return execute && !canExecute(execute, confirmProduction);
}

export function isRecordExcluded(source: Source, id: number): boolean {
  return source === "smp_documents" && id === 31;
}

export function getSourceConfig(source: Source) {
  return {
    bucket: SOURCE_BUCKETS[source],
    payloadColumn: source === "governance_uploads" ? "file_url" : "file_data",
    filenameColumn: "file_name",
    mimeColumn: source === "governance_uploads" ? null : "file_type",
    table: SOURCE_TABLES[source],
  };
}

export { runDryRun };
