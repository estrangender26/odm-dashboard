import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const baseUrl = "postgresql://postgres:postgres@localhost:5433/";
const databases: string[] = [];
const migration = fs.readFileSync(path.join(process.cwd(), "db/migrations/0022_primavera_lite_dependencies.sql"), "utf8");

async function database(label: string) {
  const name = `odmtest_pr5_migration_${label.replace(/[^a-z0-9]+/gi, "_")}_${Date.now()}_${databases.length}`;
  databases.push(name);
  const admin = postgres(baseUrl + "postgres", { ssl: false, prepare: false, max: 1 });
  await admin.unsafe(`CREATE DATABASE "${name}"`); await admin.end();
  const client = postgres(baseUrl + name, { ssl: false, prepare: false, max: 1 });
  await client.unsafe(`
    CREATE TABLE gantt_projects (id SERIAL PRIMARY KEY);
    CREATE TABLE gantt_activities (id SERIAL PRIMARY KEY);
    CREATE TABLE gantt_dependencies (id SERIAL PRIMARY KEY, dependency_type varchar(10));
    INSERT INTO gantt_dependencies (dependency_type) VALUES ('FS');
  `);
  return client;
}

async function through0021Ledger(client: postgres.Sql) {
  await client.unsafe(`CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);`);
  for (let index = 0; index <= 21; index++) await client`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${`through-${index}`}, ${index === 21 ? 1791312000003 : index})`;
}

describe("migration 0022 Primavera normalized dependencies", () => {
  beforeAll(() => {
    if (process.env.PRIMAVERA_PR1_TEST_DB !== "1") throw new Error("PRIMAVERA_PR1_TEST_DB=1 is required");
  });
  afterAll(async () => {
    const admin = postgres(baseUrl + "postgres", { ssl: false, prepare: false, max: 1 });
    try { for (const name of databases) await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); }
    finally { await admin.end(); }
  });
  it("creates only the normalized table and leaves legacy dependencies unchanged", async () => {
    const client = await database("fresh");
    try {
      await client.unsafe(migration);
      const columns = await client`SELECT column_name FROM information_schema.columns WHERE table_name = 'gantt_activity_dependencies' ORDER BY ordinal_position`;
      expect(columns.map((row) => row.column_name)).toEqual([
        "id", "project_id", "predecessor_activity_id", "successor_activity_id", "dependency_type", "lag_days", "revision", "updated_by_name", "archived_at", "created_at", "updated_at",
      ]);
      const indexes = await client`SELECT indexname FROM pg_indexes WHERE tablename = 'gantt_activity_dependencies'`;
      expect(indexes.map((row) => row.indexname)).toContain("gantt_activity_dependencies_active_unique");
      expect(Number((await client`SELECT count(*)::int AS count FROM gantt_dependencies`)[0].count)).toBe(1);
    } finally { await client.end(); }
  });

  it("accepts canonical schema-present/ledger-absent drift and adds exactly one ledger row", async () => {
    const client = await database("schema_present");
    try {
      await client.unsafe(migration);
      await through0021Ledger(client);
      await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "db/migrations") });
      const [ledger] = await client`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations WHERE created_at=1791312000004`;
      expect(ledger.count).toBe(1);
    } finally { await client.end(); }
  });

  it("is safe on a second direct run", async () => {
    const client = await database("second_run");
    try {
      await client.unsafe(migration);
      await expect(client.unsafe(migration)).resolves.toBeDefined();
      expect(Number((await client`SELECT count(*)::int AS count FROM gantt_dependencies`)[0].count)).toBe(1);
    } finally { await client.end(); }
  });

  it.each([
    ["column", `ALTER TABLE gantt_activity_dependencies ALTER COLUMN lag_days TYPE bigint`],
    ["foreign key", `ALTER TABLE gantt_activity_dependencies DROP CONSTRAINT gantt_activity_dependencies_project_fk; ALTER TABLE gantt_activity_dependencies ADD CONSTRAINT wrong_project_fk FOREIGN KEY (project_id) REFERENCES gantt_projects(id) ON DELETE CASCADE`],
    ["index", `DROP INDEX gantt_activity_dependencies_active_unique; CREATE UNIQUE INDEX gantt_activity_dependencies_active_unique ON gantt_activity_dependencies(project_id, predecessor_activity_id, successor_activity_id, dependency_type, lag_days) WHERE archived_at IS NULL`],
    ["dependency type constraint", `ALTER TABLE gantt_activity_dependencies DROP CONSTRAINT gantt_activity_dependencies_type_check`],
    ["no-self constraint", `ALTER TABLE gantt_activity_dependencies DROP CONSTRAINT gantt_activity_dependencies_no_self_check`],
  ])("rejects conflicting %s drift before ledger insertion", async (_label, drift) => {
    const client = await database(`drift_${_label}`);
    try {
      await client.unsafe(migration);
      await client.unsafe(drift);
      await through0021Ledger(client);
      await expect(migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "db/migrations") })).rejects.toThrow(/drift/i);
      const [ledger] = await client`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations WHERE created_at=1791312000004`;
      expect(ledger.count).toBe(0);
    } finally { await client.end(); }
  });
});
