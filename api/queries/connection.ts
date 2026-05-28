import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../db/schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _dbReady: Promise<void> | null = null;

// In-memory cache for read-after-write consistency
// Supabase pooler has replica lag — writes go to primary, reads hit lagging replicas
// Cache ensures reads always see the latest data
const queryCache: Map<string, { data: unknown; ts: number }> = new Map();
const CACHE_TTL = 30000; // 30 seconds


async function logConnectionTest(client: postgres.Sql<{}>, databaseUrl: string): Promise<void> {
  try {
    const result = await client`SELECT current_database() AS current_database, current_schema() AS current_schema`;
    const row = result[0] as { current_database?: string; current_schema?: string } | undefined;
    console.log(`[DB] Connection test -> current_database=${row?.current_database ?? "unknown"}, current_schema=${row?.current_schema ?? "unknown"}, host=${getConnectionFingerprint(databaseUrl)}`);
  } catch (err: any) {
    console.error(`[DB] Connection test failed: ${err?.message ?? String(err)}`);
  }
}

function getUrlFingerprint(databaseUrl: string): string {
  return databaseUrl
    .replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@")
    .replace(/([?&](?:password|pwd|token|apikey)=)[^&]+/gi, "$1***");
}

export function getConnectionFingerprint(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl);
    const host = parsed.hostname || "unknown-host";
    const port = parsed.port || "5432";
    const dbName = parsed.pathname.replace(/^\//, "") || "unknown-db";
    return `${host}:${port}/${dbName}`;
  } catch {
    return "invalid DATABASE_URL";
  }
}

export function getDatabaseUrl(): string {
  const rawDatabaseUrl = process.env.DATABASE_URL;
  if (!rawDatabaseUrl) {
    console.error("[DB] DATABASE_URL not set!");
    throw new Error("DATABASE_URL not set");
  }

  return rawDatabaseUrl;
}

export const getNormalizedDatabaseUrl = getDatabaseUrl;

export function getDb() {
  if (_db) return _db;

  const databaseUrl = getDatabaseUrl();
  console.log(`[DB] DATABASE_URL fingerprint: ${getUrlFingerprint(databaseUrl)}`);
  console.log(`[DB] Connection fingerprint: ${getConnectionFingerprint(databaseUrl)}`);

  console.log("[DB] Connecting to database...");
  const client = postgres(databaseUrl, {
    ssl: "require",
    prepare: false,
    max: 1,
    max_lifetime: 600,
    connect_timeout: 10,
    idle_timeout: 20,
    // Prevent long-hanging queries from blocking all shared requests.
    connection: {
      application_name: "odm-dashboard",
    },
  });

  _db = drizzle(client, { schema });
  console.log("[DB] Connected!");
  void logConnectionTest(client, databaseUrl);

  _dbReady = (async () => {
    // Runtime should not run DDL/migrations; only verify connectivity.
    await _db!.execute(sql`SELECT 1`);
    await _db!.execute(sql`SET statement_timeout = '15000'`);
    await _db!.execute(sql`SET lock_timeout = '5000'`);
    console.log("[db] connection ready (timeouts configured)");
  })().catch((err: any) => {
    console.error("[DB] Migration/startup verification error:", err.message);
    throw err;
  });

  return _db;
}

export async function ensureDbReady(): Promise<void> {
  getDb();
  if (_dbReady) await _dbReady;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_, prop) {
    return getDb()[prop as keyof typeof _db];
  },
});

// Cache helpers for consistent reads
export function cacheGet(key: string): unknown | undefined {
  const entry = queryCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL) {
    queryCache.delete(key);
    return undefined;
  }
  return entry.data;
}

export function cacheSet(key: string, data: unknown): void {
  queryCache.set(key, { data, ts: Date.now() });
}

export function cacheInvalidate(pattern?: string): void {
  if (!pattern) {
    queryCache.clear();
    return;
  }
  for (const key of queryCache.keys()) {
    if (key.includes(pattern)) queryCache.delete(key);
  }
}

export type DrizzleDB = ReturnType<typeof getDb>;
