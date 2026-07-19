import { db } from "../api/queries/connection";
import { getSupabaseStorageAdmin } from "../api/supabase-storage";
import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as tus from "tus-js-client";
import type { MigrationContext } from "./migrator-adapters";

export function createProductionContext(execute: boolean): MigrationContext {
  return {
    db: db as any,
    storage: {
      from: (bucket: string) => getSupabaseStorageAdmin().storage.from(bucket)
    },
    tus: { Upload: tus.Upload },
    fs: fs as any,
    fetchAdapter: { fetch: (url, init) => fetch(url, init) },
    clock: { now: () => Date.now(), newDate: () => new Date(), randomUUID },
    logger: { log: console.log, error: console.error },
    workerId: randomUUID(),
    execute,
  };
}
