import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "../../db/schema";
import { join } from "path";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _dbReady: Promise<void> | null = Promise.resolve();

// In-memory cache for read-after-write consistency
// Supabase pooler has replica lag — writes go to primary, reads hit lagging replicas
// Cache ensures reads always see the latest data
const queryCache: Map<string, { data: unknown; ts: number }> = new Map();
const CACHE_TTL = 30000; // 30 seconds

function shouldRunMigrationsOnStartup(): boolean {
  const configured = process.env.RUN_DB_MIGRATIONS_ON_STARTUP?.trim().toLowerCase();
  if (configured) return ["1", "true", "yes", "on"].includes(configured);

  return process.env.NODE_ENV === "production";
}

async function ensureTasksProcedureFamiliarityColumn(db: ReturnType<typeof drizzle<typeof schema>>): Promise<void> {
  await db.execute(sql`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "procedure_familiarity" text`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "tasks_familiarity_idx" ON "tasks" ("procedure_familiarity")`);

  const result = await db.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'tasks'
      AND column_name = 'procedure_familiarity'
  `);
  const rows = (result as any).rows ?? result;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Startup migration verification failed: tasks.procedure_familiarity is missing");
  }
}

async function ensureMonthlyKpiNotesColumn(db: ReturnType<typeof drizzle<typeof schema>>): Promise<void> {
  await db.execute(sql`ALTER TABLE IF EXISTS "monthly_kpi_records" ADD COLUMN IF NOT EXISTS "notes" text`);
}

async function ensureMonthlyKpiRawFields(db: ReturnType<typeof drizzle<typeof schema>>): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "monthly_kpi_records"
      ADD COLUMN IF NOT EXISTS "mttr_downtime" double precision,
      ADD COLUMN IF NOT EXISTS "repair_count" double precision,
      ADD COLUMN IF NOT EXISTS "facility_operating_time" double precision,
      ADD COLUMN IF NOT EXISTS "facility_downtime" double precision,
      ADD COLUMN IF NOT EXISTS "source_sheet" varchar(255),
      ADD COLUMN IF NOT EXISTS "import_batch_id" varchar(100),
      ADD COLUMN IF NOT EXISTS "notes" text,
      ADD COLUMN IF NOT EXISTS "raw_imported_values" jsonb
  `);
}

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
  const rawDatabaseUrl = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
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

  // Suppress connection logs for migrator to avoid exposing URLs/hosts/ports
  const isMigratorMode = process.env.LEGACY_MIGRATOR_MODE === "1";
  if (!isMigratorMode) {
    console.log(`[DB] DATABASE_URL fingerprint: ${getUrlFingerprint(databaseUrl)}`);
    console.log(`[DB] Connection fingerprint: ${getConnectionFingerprint(databaseUrl)}`);
    console.log("[DB] Connecting to database...");
  }
  const sslMode = process.env.DATABASE_SSL_MODE ?? "require";
  const client = postgres(databaseUrl, {
    ssl: sslMode === "disable" ? false : sslMode,
    prepare: false,
    max: 10,
    max_lifetime: 600,
    connect_timeout: 10,
    idle_timeout: 20,
    statement_timeout: 15000,
    onnotice: () => undefined,
  } as Parameters<typeof postgres>[1]);

  _db = drizzle(client, { schema });
  if (!isMigratorMode) {
    console.log("[DB] Connected!");
  }
  // Skip connection test logging for migrator to avoid exposing connection info
  if (!isMigratorMode) {
    void logConnectionTest(client, databaseUrl);
  }

  const shouldRunMigrations = shouldRunMigrationsOnStartup();
  if (shouldRunMigrations && !isMigratorMode) {
    const migrationsPath = join(process.cwd(), "db/migrations");
    _dbReady = (async () => {
      console.log("[db] migration start", { migrationsPath });
      await migrate(_db!, { migrationsFolder: migrationsPath });
      await ensureTasksProcedureFamiliarityColumn(_db!);
      await ensureMonthlyKpiNotesColumn(_db!);
      await ensureMonthlyKpiRawFields(_db!);
      await _db!.execute(sql`SELECT 1`);
      console.log("[db] migration finish; verified tasks.procedure_familiarity");
    })().catch((err: any) => {
      console.error("[db] migration error", { message: err?.message ?? String(err), stack: err?.stack });
      console.error("[DB] Migration/startup verification error:", err.message);
      throw err;
    });
  } else {
    _dbReady = Promise.resolve();
    if (!isMigratorMode) {
      console.log("[db] runtime migrations skipped (RUN_DB_MIGRATIONS_ON_STARTUP is disabled)");
    }
  }

  return _db;
}

export async function ensureDbReady(): Promise<void> {
  const db = getDb();
  if (_dbReady) await _dbReady;
  await ensureMonthlyKpiNotesColumn(db);
  await ensureMonthlyKpiRawFields(db);
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
