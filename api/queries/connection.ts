import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "../../db/schema";
import { join } from "path";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

// In-memory cache for read-after-write consistency
// Supabase pooler has replica lag — writes go to primary, reads hit lagging replicas
// Cache ensures reads always see the latest data
const queryCache: Map<string, { data: unknown; ts: number }> = new Map();
const CACHE_TTL = 30000; // 30 seconds

export function getDb() {
  if (_db) return _db;
  
  let databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[DB] DATABASE_URL not set!");
    throw new Error("DATABASE_URL not set");
  }
  
  // IMPORTANT: always use the exact DATABASE_URL provided by the runtime environment.
  // Rewriting or falling back to a hardcoded URL can make writes/reads hit a different database.
  
  console.log("[DB] Connecting to database...");
  const client = postgres(databaseUrl, {
    ssl: "require",
    prepare: false,
    max: 1,
    max_lifetime: 600,
  });
  
  _db = drizzle(client, { schema });
  console.log("[DB] Connected!");

  // Run migrations async (fire-and-forget) — getDb must stay synchronous for the Proxy
  const migrationsPath = join(process.cwd(), "db/migrations");
  migrate(_db, { migrationsFolder: migrationsPath })
    .then(() => console.log("[DB] Migrations applied!"))
    .catch((err: any) => console.error("[DB] Migration error:", err.message));

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
