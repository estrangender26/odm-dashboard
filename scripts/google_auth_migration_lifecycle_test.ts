/**
 * Google OAuth auth identity — migration 0032 lifecycle test (live PostgreSQL).
 *
 * Requires a local PostgreSQL on localhost:5433 (postgres/postgres), the same
 * fixture used by scripts/migration_lifecycle_test.ts (embedded-postgres).
 *
 * Run:  node --import tsx scripts/google_auth_migration_lifecycle_test.ts
 *
 * Scenarios:
 *   1. Fresh database — full journal applies; users gains auth_provider +
 *      auth_subject columns and the partial unique index; 0032 recorded once.
 *   2. Production-like database — ledger already at 0031, existing OWNER row
 *      (role=admin, legacy union_id, no provider columns). 0032 applies
 *      additively; the OWNER row is preserved (no duplicate, role stays admin).
 *   3. Idempotency — a second migrate run adds no ledger rows.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { join } from "path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../db/schema";

const baseUrl = "postgresql://postgres:postgres@localhost:5433/";
const NEW_ENTRY_WHEN = 1791312000020;
const OLD_LAST_WHEN = 1791312000014; // 0031 (pre-Google-auth)

async function createDatabase(name: string): Promise<void> {
  const admin = postgres(baseUrl + "postgres", { ssl: false, prepare: false, max: 1 });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name.replace(/"/g, '\\"')}"`);
    await admin.unsafe(`CREATE DATABASE "${name.replace(/"/g, '\\"')}"`);
  } finally {
    await admin.end();
  }
}

async function withClient<T>(dbName: string, fn: (client: postgres.Sql<Record<string, unknown>>) => Promise<T>): Promise<T> {
  const client = postgres(`${baseUrl}${dbName}?sslmode=disable`, { ssl: false, prepare: false, max: 1 });
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function seedLedger(client: postgres.Sql<Record<string, unknown>>, whens: number[]): Promise<void> {
  await client`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await client`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;
  for (const when of whens) {
    await client`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${"placeholder-" + when}, ${when})`;
  }
}

async function seedLegacyPrerequisiteTables(client: postgres.Sql<Record<string, unknown>>, options?: { skipUsers?: boolean }): Promise<void> {
  // Stubs for tables that historical migrations ALTER/DROP but that are NOT
  // created by any migration. Mirror scripts/migration_lifecycle_test.ts.
  // skipUsers: scenario 2 creates the production-shaped users table itself.
  const usersStub = options?.skipUsers ? "" : "CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY);";
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS tasks (id SERIAL PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS gantt_tasks (id SERIAL PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS gantt_dependencies (id SERIAL PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS gantt_links (id SERIAL PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS doc_files (id SERIAL PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS governance_uploads (id SERIAL PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS governance_files (id SERIAL PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS smp_documents (id SERIAL PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS governance_milestone_state (id SERIAL PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS governance_facilities (
      id SERIAL PRIMARY KEY,
      slug VARCHAR(100) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      short_name VARCHAR(100)
    );
    ${usersStub}
    CREATE TABLE IF NOT EXISTS existing_facilities_maintenance (id SERIAL PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS mw_compliance (id SERIAL PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS mw_escalations (id SERIAL PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS odm_talk_notifications (id SERIAL PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS odm_talk_messages (id SERIAL PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS odm_talk_threads (id SERIAL PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS equipment (id SERIAL PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS mw_inspections (id SERIAL PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS doc_folders (id SERIAL PRIMARY KEY);
  `);
}

async function ensureSupabaseRoles(client: postgres.Sql<Record<string, unknown>>): Promise<void> {
  await client.unsafe(`
    DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
}

async function readLedger(client: postgres.Sql<Record<string, unknown>>): Promise<number[]> {
  const rows = await client`SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id`;
  return rows.map((r) => Number(r.created_at));
}

async function columnExists(client: postgres.Sql<Record<string, unknown>>, table: string, column: string): Promise<boolean> {
  const rows = await client`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
  `;
  return rows.length > 0;
}

async function indexExists(client: postgres.Sql<Record<string, unknown>>, index: string): Promise<boolean> {
  const rows = await client`
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${index}
  `;
  return rows.length > 0;
}

async function runMigrate(dbName: string): Promise<void> {
  const url = `${baseUrl}${dbName}?sslmode=disable`;
  const client = postgres(url, { ssl: false, prepare: false, max: 1 });
  try {
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: join(process.cwd(), "db/migrations") });
  } finally {
    await client.end();
  }
}

async function scenarioFresh(): Promise<string> {
  const dbName = "gauth_fresh_" + Date.now();
  await createDatabase(dbName);
  const journal = (await import("../db/migrations/meta/_journal.json")) as {
    entries: { tag: string; when: number }[];
  };

  await withClient(dbName, async (client) => {
    await seedLegacyPrerequisiteTables(client);
    await ensureSupabaseRoles(client);
    await seedLedger(client, []);
  });
  await runMigrate(dbName);

  const message = await withClient(dbName, async (client) => {
    const ledger = await readLedger(client);
    const newEntryCount = ledger.filter((w) => w === NEW_ENTRY_WHEN).length;
    const hasProvider = await columnExists(client, "users", "auth_provider");
    const hasSubject = await columnExists(client, "users", "auth_subject");
    const hasIndex = await indexExists(client, "users_auth_provider_subject_idx");
    const pass =
      ledger.length === journal.entries.length &&
      newEntryCount === 1 &&
      hasProvider &&
      hasSubject &&
      hasIndex;
    return `Scenario 1 (fresh DB): ${pass ? "PASS" : "FAIL"} — ledger=${ledger.length}/${journal.entries.length}, new0032=${newEntryCount}, auth_provider=${hasProvider}, auth_subject=${hasSubject}, unique_index=${hasIndex}`;
  });
  return message;
}

async function scenarioProductionLike(): Promise<{ message: string; dbName: string }> {
  const dbName = "gauth_prod_like_" + Date.now();
  await createDatabase(dbName);
  const journal = (await import("../db/migrations/meta/_journal.json")) as {
    entries: { tag: string; when: number }[];
  };
  const ledgerWhens = journal.entries
    .filter((e) => e.when <= OLD_LAST_WHEN)
    .map((e) => e.when);

  await withClient(dbName, async (client) => {
    await seedLegacyPrerequisiteTables(client, { skipUsers: true });
    await ensureSupabaseRoles(client);
    // Production-shaped users table with the existing OWNER row (Kimi era).
    await client.unsafe(`
      CREATE TABLE IF NOT EXISTS public.users (
        id serial PRIMARY KEY,
        name varchar(255) NOT NULL,
        email varchar(255) NOT NULL UNIQUE,
        avatar varchar(500),
        role varchar(50) NOT NULL DEFAULT 'user',
        union_id varchar(255),
        created_at timestamp DEFAULT now(),
        last_sign_in_at timestamp DEFAULT now()
      );
      INSERT INTO public.users (id, name, email, role, union_id)
      VALUES (1, 'Gerald Balucan', 'owner@example.com', 'admin', 'legacy-kimi-union-id');
    `);
    await seedLedger(client, ledgerWhens);
  });
  await runMigrate(dbName);

  const message = await withClient(dbName, async (client) => {
    const ledger = await readLedger(client);
    const newEntryCount = ledger.filter((w) => w === NEW_ENTRY_WHEN).length;
    const hasProvider = await columnExists(client, "users", "auth_provider");
    const hasSubject = await columnExists(client, "users", "auth_subject");
    const hasIndex = await indexExists(client, "users_auth_provider_subject_idx");
    const ownerRows = await client`
      SELECT id, role, union_id FROM public.users WHERE role = 'admin'
    `;
    const total = await client`SELECT COUNT(*)::int AS n FROM public.users`;
    const owner = ownerRows[0] as { id: number; role: string; union_id: string } | undefined;
    const pass =
      newEntryCount === 1 &&
      hasProvider &&
      hasSubject &&
      hasIndex &&
      total[0].n === 1 &&
      ownerRows.length === 1 &&
      owner?.role === "admin" &&
      owner?.id === 1 &&
      owner?.union_id === "legacy-kimi-union-id";
    return `Scenario 2 (production-like with OWNER row): ${pass ? "PASS" : "FAIL"} — new0032=${newEntryCount}, auth_provider=${hasProvider}, auth_subject=${hasSubject}, unique_index=${hasIndex}, users=${total[0].n}/1 admin_rows=${ownerRows.length}/1 owner_id=${owner?.id} role=${owner?.role} union_id=${owner?.union_id}`;
  });
  return { message, dbName };
}

async function scenarioIdempotent(dbName: string): Promise<string> {
  await runMigrate(dbName);
  return withClient(dbName, async (client) => {
    const ledger = await readLedger(client);
    const newEntryCount = ledger.filter((w) => w === NEW_ENTRY_WHEN).length;
    const pass = newEntryCount === 1;
    return `Scenario 3 (idempotency): ${pass ? "PASS" : "FAIL"} — new0032=${newEntryCount} after second run`;
  });
}

async function main() {
  const s1 = await scenarioFresh();
  console.log(s1);
  const s2 = await scenarioProductionLike();
  console.log(s2.message);
  const s3 = await scenarioIdempotent(s2.dbName);
  console.log(s3);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
