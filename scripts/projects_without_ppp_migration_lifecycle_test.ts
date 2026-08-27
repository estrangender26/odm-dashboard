/**
 * Projects without PPP — migration lifecycle test (live PostgreSQL).
 *
 * Requires a local PostgreSQL on localhost:5433 (postgres/postgres), the same
 * fixture used by scripts/migration_lifecycle_test.ts (embedded-postgres).
 *
 * Run:  node --import tsx scripts/projects_without_ppp_migration_lifecycle_test.ts
 *
 * Scenarios:
 *   1. Fresh database — full journal applies; both tables exist with the
 *      evolved columns; the new 0031 entry is recorded exactly once.
 *   2. Production-like database containing the inert PR #389 tables and a
 *      ledger already at 1791312000013 — the new 0031 (when=1791312000014)
 *      applies, evolves the tables additively, and preserves existing rows.
 *   3. Idempotency — a second migrate run adds no ledger rows.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { join } from "path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../db/schema";

const baseUrl = "postgresql://postgres:postgres@localhost:5433/";

// Exact schema created by PR #389's migration 0031 (inert production tables).
const PR389_INERT_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS public.projects_without_ppp (
  id serial PRIMARY KEY,
  tracking_id varchar(50) NOT NULL UNIQUE,
  ps_code varchar(50) NOT NULL,
  coding_mask varchar(50),
  project_phase varchar(50) NOT NULL,
  latest_milestone varchar(50),
  sub_phase varchar(50),
  pm_headline varchar(255),
  work_package varchar(500),
  contract_package varchar(500),
  contractor varchar(255),
  major_project_tag varchar(100),
  construction_manager varchar(255),
  project_manager varchar(255),
  with_ls_ps boolean NOT NULL DEFAULT false,
  amd_grid_head varchar(255),
  submitted_by varchar(255),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pwp_tracking_id_idx ON public.projects_without_ppp (tracking_id);
CREATE INDEX IF NOT EXISTS pwp_ps_code_idx ON public.projects_without_ppp (ps_code);
CREATE INDEX IF NOT EXISTS pwp_phase_idx ON public.projects_without_ppp (project_phase);
CREATE INDEX IF NOT EXISTS pwp_tag_idx ON public.projects_without_ppp (major_project_tag);
CREATE TABLE IF NOT EXISTS public.project_without_ppp_files (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES public.projects_without_ppp(id) ON DELETE CASCADE,
  file_name varchar(255) NOT NULL,
  file_type varchar(100),
  file_size integer,
  file_data text,
  uploaded_by varchar(255),
  uploaded_at timestamp DEFAULT now(),
  storage_provider varchar(32),
  storage_bucket varchar(100),
  storage_path text,
  storage_size bigint,
  storage_mime_type varchar(255),
  storage_etag text,
  storage_uploaded_at timestamp with time zone
);
CREATE INDEX IF NOT EXISTS pwp_files_project_idx ON public.project_without_ppp_files (project_id);
`;

const NEW_ENTRY_WHEN = 1791312000014;
const OLD_PR389_ENTRY_WHEN = 1791312000013;

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

async function seedLegacyPrerequisiteTables(client: postgres.Sql<Record<string, unknown>>): Promise<void> {
  // Stubs for tables that historical migrations ALTER/DROP but that are NOT
  // created by any migration (they predate the migration journal). Mirror the
  // set from scripts/migration_lifecycle_test.ts and extend it for the tables
  // touched by 0024 (RLS pilot), 0025 (ODM-Talk decommission) and 0028 (RLS).
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
    CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY);
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

async function ensureSupabaseRoles(client: postgres.Sql<Record<string, unknown>>): Promise<void> {
  // Historical migrations and 0031's RLS posture REVOKE privileges from
  // Supabase roles; create them so the migration applies on the disposable
  // local database.
  await client.unsafe(`
    DO $$ BEGIN
      CREATE ROLE anon NOLOGIN;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      CREATE ROLE authenticated NOLOGIN;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
}

async function assertRlsPosture(client: postgres.Sql<Record<string, unknown>>) {
  const rls = await client`
    SELECT relname, relrowsecurity
    FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname IN ('projects_without_ppp', 'project_without_ppp_files')
    ORDER BY relname
  `;
  const priv = await client`
    SELECT
      has_table_privilege('anon', 'public.projects_without_ppp', 'SELECT') AS anon_select_p,
      has_table_privilege('anon', 'public.project_without_ppp_files', 'SELECT') AS anon_select_f,
      has_table_privilege('authenticated', 'public.projects_without_ppp', 'INSERT') AS auth_insert_p,
      has_table_privilege('authenticated', 'public.project_without_ppp_files', 'DELETE') AS auth_delete_f
  `;
  const rlsMap = new Map<string, boolean>(rls.map((r) => [r.relname, r.relrowsecurity]));
  const row = priv[0];
  const ok =
    rlsMap.get("projects_without_ppp") === true &&
    rlsMap.get("project_without_ppp_files") === true &&
    row.anon_select_p === false &&
    row.anon_select_f === false &&
    row.auth_insert_p === false &&
    row.auth_delete_f === false;
  return { ok, rlsMap, row };
}

async function scenarioFresh(): Promise<string> {
  const dbName = "pwp_fresh_" + Date.now();
  await createDatabase(dbName);
  const journal = (await import("../db/migrations/meta/_journal.json")) as {
    entries: { tag: string; when: number }[];
  };

  await withClient(dbName, async (client) => {
    await seedLegacyPrerequisiteTables(client);
    await ensureSupabaseRoles(client);
    await seedLedger(client, []); // fresh: empty ledger table
  });

  const url = `${baseUrl}${dbName}?sslmode=disable`;
  const client = postgres(url, { ssl: false, prepare: false, max: 1 });
  try {
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: join(process.cwd(), "db/migrations") });
  } finally {
    await client.end();
  }

  const ok = await withClient(dbName, async (client) => {
    const ledger = await readLedger(client);
    const newEntryCount = ledger.filter((w) => w === NEW_ENTRY_WHEN).length;
    const hasProjectName = await columnExists(client, "projects_without_ppp", "project_name");
    const hasSubmittedAt = await columnExists(client, "project_without_ppp_files", "submitted_at");
    const hasSupersededAt = await columnExists(client, "project_without_ppp_files", "superseded_at");
    const tables = await client`
      SELECT to_regclass('public.projects_without_ppp') AS p, to_regclass('public.project_without_ppp_files') AS f
    `;
    const posture = await assertRlsPosture(client);
    const pass =
      ledger.length === journal.entries.length &&
      newEntryCount === 1 &&
      tables[0].p !== null &&
      tables[0].f !== null &&
      hasProjectName &&
      hasSubmittedAt &&
      hasSupersededAt &&
      posture.ok;
    return `Scenario 1 (fresh DB): ${pass ? "PASS" : "FAIL"} — ledger=${ledger.length}/${journal.entries.length}, new0031=${newEntryCount}, project_name=${hasProjectName}, submitted_at=${hasSubmittedAt}, superseded_at=${hasSupersededAt}, rls=${posture.ok}`;
  });
  return ok;
}

async function scenarioProductionInert(): Promise<{ message: string; dbName: string }> {
  const dbName = "pwp_prod_like_" + Date.now();
  await createDatabase(dbName);
  const journal = (await import("../db/migrations/meta/_journal.json")) as {
    entries: { tag: string; when: number }[];
  };
  const ledgerWhens = journal.entries
    .filter((e) => e.when <= OLD_PR389_ENTRY_WHEN)
    .map((e) => e.when)
    .concat([OLD_PR389_ENTRY_WHEN]); // PR #389's 0031 already applied in production

  await withClient(dbName, async (client) => {
    await client.unsafe(PR389_INERT_TABLES_SQL);
    await ensureSupabaseRoles(client);
    // Simulated existing production data: one project + one submission file.
    await client.unsafe(`
      INSERT INTO public.projects_without_ppp (tracking_id, ps_code, project_phase)
      VALUES ('RR18-0616-01-01', '2024-0348', 'Construction');
      INSERT INTO public.project_without_ppp_files (project_id, file_name, file_type, file_size)
      VALUES (1, 'legacy-masterdata.pdf', 'application/pdf', 2048);
    `);
    await seedLedger(client, ledgerWhens);
  });

  const url = `${baseUrl}${dbName}?sslmode=disable`;
  const client = postgres(url, { ssl: false, prepare: false, max: 1 });
  try {
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: join(process.cwd(), "db/migrations") });
  } finally {
    await client.end();
  }

  const message = await withClient(dbName, async (client) => {
    const ledger = await readLedger(client);
    const newEntryCount = ledger.filter((w) => w === NEW_ENTRY_WHEN).length;
    const hasProjectName = await columnExists(client, "projects_without_ppp", "project_name");
    const hasSubmittedAt = await columnExists(client, "project_without_ppp_files", "submitted_at");
    const hasSupersededAt = await columnExists(client, "project_without_ppp_files", "superseded_at");
    const project = await client`SELECT COUNT(*)::int AS n FROM public.projects_without_ppp WHERE tracking_id = 'RR18-0616-01-01'`;
    const files = await client`SELECT COUNT(*)::int AS n FROM public.project_without_ppp_files`;
    const posture = await assertRlsPosture(client);
    const pass =
      newEntryCount === 1 &&
      hasProjectName &&
      hasSubmittedAt &&
      hasSupersededAt &&
      project[0].n === 1 &&
      files[0].n === 1 &&
      posture.ok;
    return `Scenario 2 (production with inert PR #389 tables): ${pass ? "PASS" : "FAIL"} — new0031=${newEntryCount}, project_name=${hasProjectName}, submitted_at=${hasSubmittedAt}, superseded_at=${hasSupersededAt}, data preserved projects=${project[0].n}/1 files=${files[0].n}/1, rls=${posture.ok}`;
  });
  return { message, dbName };
}

async function scenarioIdempotent(dbName: string): Promise<string> {
  const url = `${baseUrl}${dbName}?sslmode=disable`;
  const client = postgres(url, { ssl: false, prepare: false, max: 1 });
  try {
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: join(process.cwd(), "db/migrations") });
  } finally {
    await client.end();
  }
  return withClient(dbName, async (client) => {
    const ledger = await readLedger(client);
    const newEntryCount = ledger.filter((w) => w === NEW_ENTRY_WHEN).length;
    const posture = await assertRlsPosture(client);
    const pass = newEntryCount === 1 && posture.ok;
    return `Scenario 3 (idempotency): ${pass ? "PASS" : "FAIL"} — new0031=${newEntryCount} after second run, rls=${posture.ok}`;
  });
}

async function main() {
  const s1 = await scenarioFresh();
  console.log(s1);

  const s2 = await scenarioProductionInert();
  console.log(s2.message);

  const s3 = await scenarioIdempotent(s2.dbName);
  console.log(s3);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
