#!/usr/bin/env node
// Legacy Storage Migration CLI
// Thin wrapper around core module

import { createHash, randomBytes } from "node:crypto";
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
  VALID_STATE_TRANSITIONS,
  type LegacyStorageMigrationState,
} from "../db/schema";
import { getSupabaseStorageAdmin, getSupabaseStorageConfig } from "../api/supabase-storage";
import { STORAGE_BUCKET_BY_MODULE, TUS_CHUNK_SIZE_BYTES, type StorageFileSource } from "@contracts/storage";

// Import from core module
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

interface MigrationOptions {
  execute: boolean;
  confirmProduction: boolean;
  sources?: StorageFileSource[];
  recordIds?: number[];
  limit?: number;
  batchSize?: number;
}

// Parse CLI arguments
function parseArgs(): MigrationOptions {
  const args = process.argv.slice(2);
  const options: MigrationOptions = {
    execute: false,
    confirmProduction: false,
    batchSize: 1,
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
        options.batchSize = parseInt(args[++i] || "1", 10);
        break;
      case "--orphan-audit":
        // Handled separately
        break;
    }
  }

  return options;
}

// Main entry point
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes("--orphan-audit")) {
    console.log("Orphan audit mode - to be implemented");
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

  console.log(`Mode: ${options.execute ? "EXECUTE" : "DRY-RUN"}`);
  console.log("Migration tooling ready - implementation continues in core module");
}

main().catch((err) => {
  console.error("Fatal error:", sanitizeError(err));
  process.exit(1);
});
