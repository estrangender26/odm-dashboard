import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../db/schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

// In-memory cache for read-after-write consistency
// Supabase pooler has replica lag — writes go to primary, reads hit lagging replicas
// Cache ensures reads always see the latest data
const queryCache: Map<string, { data: unknown; ts: number }> = new Map();
const CACHE_TTL = 30000; // 30 seconds

// Session Pooler (port 5432) URL — username MUST include project_ref as tenant identifier
const FALLBACK_DB_URL = "postgresql://postgres.hpfcwqyoxbndfwzbhrbz:COGF6I3w1Ij6UitG@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres";

export function getDb() {
  if (_db) return _db;
  
  let databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[DB] DATABASE_URL not set!");
    throw new Error("DATABASE_URL not set");
  }
  
  // Use Session Pooler (port 5432) instead of Transaction Pooler (port 6543)
  // Port 6543 = Transaction Pooler = read replica lag (writes not visible immediately)
  // Port 5432 = Session Pooler = session affinity (reads see your writes)
  // Username MUST keep "postgres.project_ref" — it's the tenant identifier for the pooler
  databaseUrl = databaseUrl.replace(":6543/", ":5432/");
  
  // If the URL still contains 6543 or is otherwise malformed, use fallback
  if (databaseUrl.includes(":6543")) {
    console.log("[DB] Transaction Pooler detected, forcing Session Pooler fallback");
    databaseUrl = FALLBACK_DB_URL;
  }
  
  console.log("[DB] Connecting to database...");
  const client = postgres(databaseUrl, {
    ssl: "require",
    prepare: false,
    max: 1,
    max_lifetime: 600,
  });
  
  _db = drizzle(client, { schema });
  console.log("[DB] Connected!");
  return _db;
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
