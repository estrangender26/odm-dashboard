/**
 * Production Adapter Implementations
 *
 * Factory function to create production-grade MigrationContext
 * that preserves CLI behavior while enabling test injection.
 */

import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { db as productionDb } from "../../api/queries/connection";
import { getSupabaseStorageAdmin, getSupabaseStorageConfig } from "../../api/supabase-storage";
import * as tus from "tus-js-client";
import type { MigrationContext, DbAdapter, StorageAdapter, TusAdapter, FsAdapter, FetchAdapter, ClockAdapter, LoggerAdapter } from "./migrator-adapters";

// ============================================================================
// PRODUCTION DATABASE ADAPTER (Drizzle ORM wrapper)
// ============================================================================

const dbAdapter: DbAdapter = productionDb as any;

// ============================================================================
// PRODUCTION STORAGE ADAPTER (Supabase Storage wrapper)
// ============================================================================

function createStorageAdapter(): StorageAdapter {
  const supabase = getSupabaseStorageAdmin();
  return {
    from: (bucket: string) => supabase.storage.from(bucket),
  };
}

// ============================================================================
// PRODUCTION TUS ADAPTER (tus-js-client wrapper)
// ============================================================================

const tusAdapter: TusAdapter = {
  Upload: tus.Upload,
};

// ============================================================================
// PRODUCTION FILESYSTEM ADAPTER (Node.js fs wrapper)
// ============================================================================

const fsAdapter: FsAdapter = {
  mkdir: fsPromises.mkdir,
  rm: fsPromises.rm,
  open: fsPromises.open,
  createReadStream,
  createWriteStream,
};

// ============================================================================
// PRODUCTION FETCH ADAPTER (native fetch wrapper)
// ============================================================================

const fetchAdapter: FetchAdapter = {
  fetch: globalThis.fetch.bind(globalThis),
};

// ============================================================================
// PRODUCTION CLOCK ADAPTER (system time/UUID)
// ============================================================================

const clockAdapter: ClockAdapter = {
  now: () => Date.now(),
  newDate: () => new Date(),
  randomUUID: () => randomUUID(),
};

// ============================================================================
// PRODUCTION LOGGER ADAPTER (console wrapper)
// ============================================================================

const loggerAdapter: LoggerAdapter = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
};

// ============================================================================
// PRODUCTION CONTEXT FACTORY
// ============================================================================

export function createProductionContext(execute: boolean): MigrationContext {
  return {
    db: dbAdapter,
    storage: createStorageAdapter(),
    tus: tusAdapter,
    fs: fsAdapter,
    fetchAdapter,
    clock: clockAdapter,
    logger: loggerAdapter,
    workerId: randomUUID(),
    execute,
  };
}

// Export individual adapters for specialized testing
export { dbAdapter, tusAdapter, fsAdapter, fetchAdapter, clockAdapter, loggerAdapter };
