import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const baseUrl = "postgresql://postgres:postgres@localhost:5433/";
const databases: string[] = [];

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
    const name = `odmtest_pr5_migration_${Date.now()}`;
    databases.push(name);
    const admin = postgres(baseUrl + "postgres", { ssl: false, prepare: false, max: 1 });
    await admin.unsafe(`CREATE DATABASE "${name}"`); await admin.end();
    const client = postgres(baseUrl + name, { ssl: false, prepare: false, max: 1 });
    try {
      await client.unsafe(`
        CREATE TABLE gantt_projects (id SERIAL PRIMARY KEY);
        CREATE TABLE gantt_activities (id SERIAL PRIMARY KEY);
        CREATE TABLE gantt_dependencies (id SERIAL PRIMARY KEY, dependency_type varchar(10));
        INSERT INTO gantt_dependencies (dependency_type) VALUES ('FS');
      `);
      const migration = fs.readFileSync(path.join(process.cwd(), "db/migrations/0022_primavera_lite_dependencies.sql"), "utf8");
      for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) await client.unsafe(statement);
      const columns = await client`SELECT column_name FROM information_schema.columns WHERE table_name = 'gantt_activity_dependencies' ORDER BY ordinal_position`;
      expect(columns.map((row) => row.column_name)).toEqual([
        "id", "project_id", "predecessor_activity_id", "successor_activity_id", "dependency_type", "lag_days", "revision", "updated_by_name", "archived_at", "created_at", "updated_at",
      ]);
      const indexes = await client`SELECT indexname FROM pg_indexes WHERE tablename = 'gantt_activity_dependencies'`;
      expect(indexes.map((row) => row.indexname)).toContain("gantt_activity_dependencies_active_unique");
      expect(Number((await client`SELECT count(*)::int AS count FROM gantt_dependencies`)[0].count)).toBe(1);
    } finally { await client.end(); }
  });
});
