import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const adminUrl = "postgresql://postgres:postgres@localhost:5433/postgres?sslmode=disable";
const migration = readFileSync(join(process.cwd(), "db/migrations/0021_primavera_lite_activity_grid.sql"), "utf8");
const rollback = readFileSync(join(process.cwd(), "db/migrations/helpers/0021_primavera_lite_activity_grid_rollback.sql"), "utf8");
const databases: string[] = [];

async function database(label: string) {
  const name = `odmtest_pr3_migration_${label}_${Date.now()}_${databases.length}`;
  databases.push(name);
  const admin = postgres(adminUrl, { max: 1 });
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  await admin.end();
  const client = postgres(`postgresql://postgres:postgres@localhost:5433/${name}?sslmode=disable`, { max: 1 });
  await client.unsafe(`CREATE TABLE gantt_activities (
    id serial PRIMARY KEY,
    project_id integer NOT NULL,
    wbs_node_id integer NOT NULL,
    activity_name varchar(500) NOT NULL
  )`);
  return client;
}

describe("migration 0021 Primavera activity ordering", () => {
  beforeAll(() => {
    if (process.env.PRIMAVERA_PR1_TEST_DB !== "1") throw new Error("PRIMAVERA_PR1_TEST_DB=1 is required");
  });
  afterAll(async () => {
    const admin = postgres(adminUrl, { max: 1 });
    for (const name of databases) {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
    await admin.end();
  });

  it("applies fresh to an empty through-0020 table", async () => {
    const client = await database("fresh");
    await client.unsafe(migration);
    const [column] = await client`SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'gantt_activities' AND column_name = 'sort_order'`;
    expect(column).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    await client.end();
  });

  it("backfills production-like rows deterministically by project and WBS", async () => {
    const client = await database("backfill");
    await client`INSERT INTO gantt_activities (project_id, wbs_node_id, activity_name) VALUES (1, 10, 'A'), (1, 11, 'B'), (1, 10, 'C'), (2, 10, 'D')`;
    await client.unsafe(migration);
    const rows = await client`SELECT id, sort_order FROM gantt_activities ORDER BY id`;
    expect(rows.map((row) => Number(row.sort_order))).toEqual([0, 0, 1, 0]);
    await client.end();
  });

  it("is idempotent and preserves established order", async () => {
    const client = await database("idempotent");
    await client`INSERT INTO gantt_activities (project_id, wbs_node_id, activity_name) VALUES (1, 10, 'A'), (1, 10, 'B')`;
    await client.unsafe(migration);
    await client`UPDATE gantt_activities SET sort_order = 1 - sort_order`;
    await client.unsafe(migration);
    const rows = await client`SELECT sort_order FROM gantt_activities ORDER BY id`;
    expect(rows.map((row) => Number(row.sort_order))).toEqual([1, 0]);
    await client.end();
  });

  it("rejects conflicting drift", async () => {
    const client = await database("drift");
    await client`ALTER TABLE gantt_activities ADD COLUMN sort_order text`;
    await expect(client.unsafe(migration)).rejects.toThrow(/type conflict/);
    await client.end();
  });

  it.each([
    ["duplicate", [0, 0]],
    ["negative", [-1, 0]],
    ["non_contiguous", [0, 2]],
  ])("rejects %s existing order drift", async (label, orders) => {
    const client = await database(label);
    await client`ALTER TABLE gantt_activities ADD COLUMN sort_order integer NOT NULL DEFAULT 0`;
    await client`INSERT INTO gantt_activities (project_id, wbs_node_id, activity_name, sort_order) VALUES (1, 10, 'A', ${orders[0]}), (1, 10, 'B', ${orders[1]})`;
    await client`CREATE SCHEMA drizzle`;
    await client`CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)`;
    await client`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('through-0020', 1791312000002)`;
    await expect(migrate(drizzle(client), { migrationsFolder: join(process.cwd(), "db/migrations") }))
      .rejects.toThrow(/negative, duplicate, or non-contiguous ordering/);
    const [ledger] = await client`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations WHERE created_at = 1791312000003`;
    expect(ledger.count).toBe(0);
    await client.end();
  });

  it("rollback removes only 0021 objects", async () => {
    const client = await database("rollback");
    await client`INSERT INTO gantt_activities (project_id, wbs_node_id, activity_name) VALUES (1, 10, 'Survivor')`;
    await client.unsafe(migration);
    await client.unsafe(rollback);
    const [row] = await client`SELECT activity_name FROM gantt_activities`;
    const [column] = await client`SELECT count(*)::int AS count FROM information_schema.columns WHERE table_name = 'gantt_activities' AND column_name = 'sort_order'`;
    expect(row.activity_name).toBe("Survivor");
    expect(column.count).toBe(0);
    await client.end();
  });
});
