import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { join } from "path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../db/schema";

const baseUrl = "postgresql://postgres:postgres@localhost:5433/";

async function createDatabase(name: string): Promise<void> {
  const admin = postgres(baseUrl + "postgres", { ssl: false, prepare: false, max: 1 });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name.replace(/"/g, '\"')}"`);
    await admin.unsafe(`CREATE DATABASE "${name.replace(/"/g, '\"')}"`);
  } finally {
    await admin.end();
  }
}

async function runMigrate(dbName: string): Promise<number[]> {
  const url = `${baseUrl}${dbName}?sslmode=disable`;
  const client = postgres(url, { ssl: false, prepare: false, max: 1 });
  const db = drizzle(client, { schema });
  // The original 0001 migration ALTERs a tasks table created outside migrations.
  // Seed a minimal tasks table so the historical migrations can apply.
  try {
    await client`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        name TEXT
      )
    `;
    await migrate(db, { migrationsFolder: join(process.cwd(), "db/migrations") });
    const rows = await client`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id`;
    return rows.map((r) => Number(r.created_at));
  } finally {
    await client.end();
  }
}

async function applyUpTo0019(dbName: string): Promise<void> {
  const url = `${baseUrl}${dbName}?sslmode=disable`;
  const client = postgres(url, { ssl: false, prepare: false, max: 1 });
  try {
    // The migrator only looks at the largest ledger created_at. Simulate 0019
    // as already applied by creating a minimal gantt_projects table and seeding
    // the ledger up to 0019.
    await client`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await client`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `;

    await client`
      CREATE TABLE IF NOT EXISTS gantt_calendars (
        id SERIAL PRIMARY KEY,
        project_id INTEGER,
        name VARCHAR(255) NOT NULL,
        is_default BOOLEAN DEFAULT false,
        is_global BOOLEAN DEFAULT false,
        work_on_monday BOOLEAN DEFAULT true,
        work_on_tuesday BOOLEAN DEFAULT true,
        work_on_wednesday BOOLEAN DEFAULT true,
        work_on_thursday BOOLEAN DEFAULT true,
        work_on_friday BOOLEAN DEFAULT true,
        work_on_saturday BOOLEAN DEFAULT false,
        work_on_sunday BOOLEAN DEFAULT false,
        hours_per_day NUMERIC(5,2) DEFAULT 8,
        minutes_per_day INTEGER DEFAULT 480,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await client`
      CREATE TABLE IF NOT EXISTS gantt_projects (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        project_name VARCHAR(255),
        start_date VARCHAR(20),
        finish_date VARCHAR(20),
        status VARCHAR(50),
        tasks_data TEXT NOT NULL DEFAULT '[]',
        links_data TEXT,
        description TEXT,
        created_by VARCHAR(255),
        updated_by VARCHAR(255),
        user_id INTEGER,
        owner_id INTEGER,
        tenant_id VARCHAR(255),
        org_id VARCHAR(255),
        session_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        public_id VARCHAR(64) UNIQUE,
        slug VARCHAR(100) UNIQUE,
        edit_token_hash VARCHAR(64),
        view_token_hash VARCHAR(64),
        revision INTEGER DEFAULT 1,
        data_date VARCHAR(20),
        default_calendar_id INTEGER,
        sharing_enabled INTEGER DEFAULT 0,
        last_scheduled_at TIMESTAMP,
        tasks_data_json TEXT,
        links_data_json TEXT
      )
    `;

    // Historical migrations and some conflict fixtures reference the legacy tasks table.
    await client`CREATE TABLE IF NOT EXISTS tasks (id SERIAL PRIMARY KEY)`;

    // Seed ledger for 0000..0019 using the current journal timestamps.
    const journal = (await import("../db/migrations/meta/_journal.json")) as { entries: { tag: string; when: number }[] };
    for (const entry of journal.entries) {
      if (entry.tag.localeCompare("0019_gantt_link_sharing") <= 0) {
        const hash = "placeholder-" + entry.tag; // hash not used for skip logic by runner
        await client`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${entry.when})`;
      }
    }
  } finally {
    await client.end();
  }
}

async function scenario2(): Promise<{ message: string; dbName: string }> {
  const dbName = "primavera_scenario2_" + Date.now();
  await createDatabase(dbName);
  await applyUpTo0019(dbName);
  const whens = await runMigrate(dbName);
  const expected0020 = 1791312000002;
  const only0020 = whens.filter((w) => w === expected0020).length;
  const ok = whens.length === 22 && only0020 === 1 && isNonDecreasing(whens);
  return {
    message: `Scenario 2 (through 0019): ${ok ? "PASS" : "FAIL"} — ledger has ${whens.length} rows, 0020 rows=${only0020}`,
    dbName,
  };
}

function isNonDecreasing(arr: number[]): boolean {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < arr[i - 1]) return false;
  }
  return true;
}

async function seedLegacyPrerequisiteTables(dbName: string): Promise<void> {
  const url = `${baseUrl}${dbName}?sslmode=disable`;
  const client = postgres(url, { ssl: false, prepare: false, max: 1 });
  try {
    // Historical migrations ALTER tables that were created outside the migration
    // system. Provide minimal stubs so the full journal can apply.
    await client.unsafe(`
      CREATE TABLE IF NOT EXISTS tasks (id SERIAL PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS gantt_tasks (id SERIAL PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS gantt_dependencies (id SERIAL PRIMARY KEY);
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
    `);
  } finally {
    await client.end();
  }
}

async function applyOriginal0020Schema(dbName: string): Promise<void> {
  const url = `${baseUrl}${dbName}?sslmode=disable`;
  const client = postgres(url, { ssl: false, prepare: false, max: 1 });
  try {
    // Manually create the verified 0020 schema objects without touching the ledger.
    // This simulates the partial manual application that occurred in production.
    const original = (await import("fs")).readFileSync(
      join(process.cwd(), "src/lib/__fixtures__/0020_primavera_lite_shell_original.sql"),
      "utf8"
    );
    // Strip statement breakpoints and run each DO/CREATE/ALTER statement.
    const statements = original
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await client.unsafe(stmt);
    }
  } finally {
    await client.end();
  }
}

async function applyConflictingSchema(dbName: string, setupSql: string): Promise<void> {
  const url = `${baseUrl}${dbName}?sslmode=disable`;
  const client = postgres(url, { ssl: false, prepare: false, max: 1 });
  try {
    await client.unsafe(setupSql);
  } finally {
    await client.end();
  }
}

async function runConflictScenario(
  label: string,
  setupSql: string,
  expectedErrorFragment: string
): Promise<string> {
  const dbName = "primavera_conflict_" + Date.now() + "_" + label.replace(/\W+/g, "_");
  await createDatabase(dbName);
  await applyUpTo0019(dbName);
  await applyConflictingSchema(dbName, setupSql);

  let failed = false;
  let actualError = "";
  try {
    await runMigrate(dbName);
  } catch (e: any) {
    failed = true;
    actualError = (e?.cause?.message ?? e?.message ?? String(e));
  }

  // Verify no 0020 ledger row was added.
  const url = `${baseUrl}${dbName}?sslmode=disable`;
  const client = postgres(url, { ssl: false, prepare: false, max: 1 });
  const ledger = await client`SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id`;
  const has0020 = ledger.some((r) => Number(r.created_at) === 1791312000002);
  await client.end();

  const matches = actualError.toLowerCase().includes(expectedErrorFragment.toLowerCase());
  const ok = failed && !has0020 && matches;
  return `${label}: ${ok ? "PASS" : "FAIL"} — failed=${failed}, no-ledger=${!has0020}, error-matches=${matches} (${actualError.slice(0, 120)})`;
}

async function getCounts(dbName: string): Promise<Record<string, number>> {
  const url = `${baseUrl}${dbName}?sslmode=disable`;
  const client = postgres(url, { ssl: false, prepare: false, max: 1 });
  const tables = ['gantt_projects', 'gantt_tasks', 'gantt_dependencies', 'gantt_wbs_nodes', 'gantt_activities'];
  const result: Record<string, number> = {};
  for (const t of tables) {
    const exists = (await client`SELECT to_regclass('public.' || ${t}) as e`)[0].e !== null;
    if (exists) {
      const n = await client.unsafe(`SELECT COUNT(*)::int n FROM "${t.replace(/"/g, '\"')}"`);
      result[t] = n[0].n;
    } else {
      result[t] = 0;
    }
  }
  await client.end();
  return result;
}

async function scenario3(): Promise<string> {
  const dbName = "primavera_scenario3_" + Date.now();
  await createDatabase(dbName);
  await applyUpTo0019(dbName);
  await applyOriginal0020Schema(dbName);
  const countsBefore = await getCounts(dbName);

  // 3a: governance checker should detect schema-present/ledger-absent drift
  // before the migrator reconciles the ledger.
  const { runGovernanceCheck } = await import("./migration_governance_check");
  const driftCheck = await runGovernanceCheck(`${baseUrl}${dbName}?sslmode=disable`);
  const driftDetected = driftCheck.ledgerErrors.some((e) =>
    e.includes("schema-present/ledger-absent")
  );

  const whens = await runMigrate(dbName);
  const countsAfter = await getCounts(dbName);
  const only0020 = whens.filter((w) => w === 1791312000002).length;
  const countsOk =
    countsAfter.gantt_projects === countsBefore.gantt_projects &&
    countsAfter.gantt_tasks === countsBefore.gantt_tasks &&
    countsAfter.gantt_dependencies === countsBefore.gantt_dependencies &&
    countsAfter.gantt_wbs_nodes === countsBefore.gantt_wbs_nodes &&
    countsAfter.gantt_activities === countsBefore.gantt_activities;
  const ok =
    driftDetected &&
    whens.length === 22 &&
    only0020 === 1 &&
    isNonDecreasing(whens) &&
    countsOk;
  return `Scenario 3 (production-like drift): ${ok ? "PASS" : "FAIL"} — drift detected=${driftDetected}, ledger has ${whens.length} rows, 0020 rows=${only0020}, counts preserved=${countsOk}`;
}

async function scenario4(): Promise<string[]> {
  const conflicts = [
    runConflictScenario(
      "missing activity column",
      `CREATE TABLE gantt_wbs_nodes (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL,
        parent_node_id INTEGER,
        code VARCHAR(100) NOT NULL,
        name VARCHAR(500) NOT NULL,
        sort_order INTEGER DEFAULT 0 NOT NULL,
        is_leaf BOOLEAN DEFAULT true NOT NULL,
        archived_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );
      CREATE TABLE gantt_activities (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL,
        wbs_node_id INTEGER NOT NULL,
        activity_name VARCHAR(500) NOT NULL
      );`,
      "does not exist"
    ),
    runConflictScenario(
      "wrong activity column type",
      `CREATE TABLE gantt_wbs_nodes (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL,
        parent_node_id INTEGER,
        code VARCHAR(100) NOT NULL,
        name VARCHAR(500) NOT NULL,
        sort_order INTEGER DEFAULT 0 NOT NULL,
        is_leaf BOOLEAN DEFAULT true NOT NULL,
        archived_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );
      CREATE TABLE gantt_activities (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL,
        wbs_node_id INTEGER NOT NULL,
        frontend_activity_uid VARCHAR(64),
        activity_id VARCHAR(100),
        activity_name VARCHAR(500) NOT NULL,
        activity_type VARCHAR(20) DEFAULT 'task' NOT NULL,
        calendar_id INTEGER,
        original_duration_days INTEGER DEFAULT 0 NOT NULL,
        remaining_duration_days INTEGER DEFAULT 0 NOT NULL,
        planned_start VARCHAR(20),
        planned_finish date,
        early_start date,
        early_finish date,
        late_start date,
        late_finish date,
        total_float_days INTEGER DEFAULT 0 NOT NULL,
        free_float_days INTEGER DEFAULT 0 NOT NULL,
        actual_start date,
        actual_finish date,
        percent_complete INTEGER DEFAULT 0 NOT NULL,
        status VARCHAR(50),
        constraint_type VARCHAR(20),
        constraint_date date,
        notes text,
        revision INTEGER DEFAULT 1 NOT NULL,
        updated_by_name VARCHAR(255),
        archived_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );`,
      "type conflict"
    ),
    runConflictScenario(
      "wrong activity default",
      `CREATE TABLE gantt_wbs_nodes (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL,
        parent_node_id INTEGER,
        code VARCHAR(100) NOT NULL,
        name VARCHAR(500) NOT NULL,
        sort_order INTEGER DEFAULT 0 NOT NULL,
        is_leaf BOOLEAN DEFAULT true NOT NULL,
        archived_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );
      CREATE TABLE gantt_activities (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL,
        wbs_node_id INTEGER NOT NULL,
        frontend_activity_uid VARCHAR(64),
        activity_id VARCHAR(100),
        activity_name VARCHAR(500) NOT NULL,
        activity_type VARCHAR(20) DEFAULT 'milestone' NOT NULL,
        calendar_id INTEGER,
        original_duration_days INTEGER DEFAULT 0 NOT NULL,
        remaining_duration_days INTEGER DEFAULT 0 NOT NULL,
        planned_start date,
        planned_finish date,
        early_start date,
        early_finish date,
        late_start date,
        late_finish date,
        total_float_days INTEGER DEFAULT 0 NOT NULL,
        free_float_days INTEGER DEFAULT 0 NOT NULL,
        actual_start date,
        actual_finish date,
        percent_complete INTEGER DEFAULT 0 NOT NULL,
        status VARCHAR(50),
        constraint_type VARCHAR(20),
        constraint_date date,
        notes text,
        revision INTEGER DEFAULT 1 NOT NULL,
        updated_by_name VARCHAR(255),
        archived_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );`,
      "default conflict"
    ),
    runConflictScenario(
      "wrong FK target",
      `CREATE TABLE gantt_wbs_nodes (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL,
        parent_node_id INTEGER,
        code VARCHAR(100) NOT NULL,
        name VARCHAR(500) NOT NULL,
        sort_order INTEGER DEFAULT 0 NOT NULL,
        is_leaf BOOLEAN DEFAULT true NOT NULL,
        archived_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );
      CREATE TABLE gantt_activities (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL,
        wbs_node_id INTEGER NOT NULL,
        frontend_activity_uid VARCHAR(64),
        activity_id VARCHAR(100),
        activity_name VARCHAR(500) NOT NULL,
        activity_type VARCHAR(20) DEFAULT 'task' NOT NULL,
        calendar_id INTEGER,
        original_duration_days INTEGER DEFAULT 0 NOT NULL,
        remaining_duration_days INTEGER DEFAULT 0 NOT NULL,
        planned_start date,
        planned_finish date,
        early_start date,
        early_finish date,
        late_start date,
        late_finish date,
        total_float_days INTEGER DEFAULT 0 NOT NULL,
        free_float_days INTEGER DEFAULT 0 NOT NULL,
        actual_start date,
        actual_finish date,
        percent_complete INTEGER DEFAULT 0 NOT NULL,
        status VARCHAR(50),
        constraint_type VARCHAR(20),
        constraint_date date,
        notes text,
        revision INTEGER DEFAULT 1 NOT NULL,
        updated_by_name VARCHAR(255),
        archived_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );
      ALTER TABLE gantt_activities ADD CONSTRAINT gantt_activities_wbs_node_id_gantt_wbs_nodes_id_fk
        FOREIGN KEY (wbs_node_id) REFERENCES tasks(id) ON DELETE restrict ON UPDATE no action;`,
      "referenced table conflict"
    ),
    runConflictScenario(
      "wrong FK delete rule",
      `CREATE TABLE gantt_wbs_nodes (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL,
        parent_node_id INTEGER,
        code VARCHAR(100) NOT NULL,
        name VARCHAR(500) NOT NULL,
        sort_order INTEGER DEFAULT 0 NOT NULL,
        is_leaf BOOLEAN DEFAULT true NOT NULL,
        archived_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );
      CREATE TABLE gantt_activities (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL,
        wbs_node_id INTEGER NOT NULL,
        frontend_activity_uid VARCHAR(64),
        activity_id VARCHAR(100),
        activity_name VARCHAR(500) NOT NULL,
        activity_type VARCHAR(20) DEFAULT 'task' NOT NULL,
        calendar_id INTEGER,
        original_duration_days INTEGER DEFAULT 0 NOT NULL,
        remaining_duration_days INTEGER DEFAULT 0 NOT NULL,
        planned_start date,
        planned_finish date,
        early_start date,
        early_finish date,
        late_start date,
        late_finish date,
        total_float_days INTEGER DEFAULT 0 NOT NULL,
        free_float_days INTEGER DEFAULT 0 NOT NULL,
        actual_start date,
        actual_finish date,
        percent_complete INTEGER DEFAULT 0 NOT NULL,
        status VARCHAR(50),
        constraint_type VARCHAR(20),
        constraint_date date,
        notes text,
        revision INTEGER DEFAULT 1 NOT NULL,
        updated_by_name VARCHAR(255),
        archived_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );
      ALTER TABLE gantt_activities ADD CONSTRAINT gantt_activities_wbs_node_id_gantt_wbs_nodes_id_fk
        FOREIGN KEY (wbs_node_id) REFERENCES gantt_wbs_nodes(id) ON DELETE cascade ON UPDATE no action;`,
      "ON DELETE conflict"
    ),
    runConflictScenario(
      "same index name wrong columns",
      `CREATE TABLE gantt_wbs_nodes (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL,
        parent_node_id INTEGER,
        code VARCHAR(100) NOT NULL,
        name VARCHAR(500) NOT NULL,
        sort_order INTEGER DEFAULT 0 NOT NULL,
        is_leaf BOOLEAN DEFAULT true NOT NULL,
        archived_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );
      CREATE INDEX gantt_wbs_nodes_project_idx ON gantt_wbs_nodes USING btree (code);`,
      "columns conflict"
    ),
    runConflictScenario(
      "non-unique replacement for unique index",
      `CREATE TABLE gantt_wbs_nodes (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL,
        parent_node_id INTEGER,
        code VARCHAR(100) NOT NULL,
        name VARCHAR(500) NOT NULL,
        sort_order INTEGER DEFAULT 0 NOT NULL,
        is_leaf BOOLEAN DEFAULT true NOT NULL,
        archived_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );
      CREATE INDEX gantt_wbs_nodes_project_code_unique ON gantt_wbs_nodes USING btree (project_id, code);`,
      "uniqueness conflict"
    ),
    runConflictScenario(
      "missing primary key",
      `CREATE TABLE gantt_wbs_nodes (
        id INTEGER NOT NULL,
        project_id INTEGER NOT NULL,
        parent_node_id INTEGER,
        code VARCHAR(100) NOT NULL,
        name VARCHAR(500) NOT NULL,
        sort_order INTEGER DEFAULT 0 NOT NULL,
        is_leaf BOOLEAN DEFAULT true NOT NULL,
        archived_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );`,
      "nextval default"
    ),
  ];

  const results: string[] = [];
  for (const c of conflicts) { results.push(await c); }
  return results;
}

// The repository migrations depend on historical tables that do not exist in a
// pure fresh DB (e.g. tasks, doc_files). We therefore validate the specific
// governance concern — 0020 ordering and idempotency — on a disposable DB that
// has already been migrated through 0019 by the test helper.
async function scenario1(): Promise<string> {
  const dbName = "primavera_scenario1_" + Date.now();
  await createDatabase(dbName);
  await seedLegacyPrerequisiteTables(dbName);
  const whens = await runMigrate(dbName);
  const expected0020 = 1791312000002;
  const only0020 = whens.filter((w) => w === expected0020).length;
  const ok = whens.length === 22 && only0020 === 1 && isNonDecreasing(whens);
  return `Scenario 1 (fresh DB): ${ok ? "PASS" : "FAIL"} — ledger has ${whens.length} rows, 0020 rows=${only0020}`;
}

async function main() {
  const s1 = await scenario1();
  console.log(s1);

  const s2 = await scenario2();
  console.log(s2.message);

  // Scenario 2b: idempotency — re-run migrator on the same database and confirm
  // no additional ledger rows are added.
  const whensAgain = await runMigrate(s2.dbName);
  const only0020Again = whensAgain.filter((w) => w === 1791312000002).length;
  const okIdempotent = whensAgain.length === 22 && only0020Again === 1 && isNonDecreasing(whensAgain);
  console.log(`Scenario 2b (idempotency): ${okIdempotent ? "PASS" : "FAIL"} — ledger has ${whensAgain.length} rows, 0020 rows=${only0020Again} after second run`);

  const s3 = await scenario3();
  console.log(s3);

  const s4 = await scenario4();
  for (const r of s4) {
    console.log(r);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
