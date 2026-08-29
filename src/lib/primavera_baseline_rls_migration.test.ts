import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const adminUrl = "postgresql://postgres:postgres@localhost:5433/postgres?sslmode=disable";
const migration = readFileSync(join(process.cwd(), "db/migrations/0037_primavera_baseline_rls.sql"), "utf8");
const rollback = readFileSync(join(process.cwd(), "db/migrations/helpers/0037_primavera_baseline_rls_rollback.sql"), "utf8");
const databases: string[] = [];

async function database(label: string) {
  const name = `odmtest_pr37_rls_${label}_${Date.now()}_${databases.length}`;
  databases.push(name);
  const admin = postgres(adminUrl, { max: 1 });
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  await admin.end();
  const client = postgres(`postgresql://postgres:postgres@localhost:5433/${name}?sslmode=disable`, { max: 1 });
  await client.unsafe(`CREATE TABLE gantt_baselines (
    id serial PRIMARY KEY,
    project_id integer NOT NULL,
    name varchar(255) NOT NULL
  )`);
  await client.unsafe(`CREATE TABLE gantt_baseline_activities (
    id serial PRIMARY KEY,
    baseline_id integer NOT NULL,
    activity_id integer NOT NULL
  )`);
  // Reproduce the pre-hardening exposure: RLS off, full grants to browser roles.
  await client.unsafe(`GRANT ALL ON gantt_baselines TO anon, authenticated`);
  await client.unsafe(`GRANT ALL ON gantt_baseline_activities TO anon, authenticated`);
  return client;
}

async function rlsState(client: postgres.Sql) {
  const rows = (await client`
    SELECT relname, relrowsecurity
    FROM pg_class
    WHERE relname IN ('gantt_baselines', 'gantt_baseline_activities')
    ORDER BY relname`) as Array<{ relname: string; relrowsecurity: boolean }>;
  return Object.fromEntries(rows.map((r) => [r.relname, r.relrowsecurity]));
}

async function browserGrants(client: postgres.Sql) {
  const rows = await client`
    SELECT table_name, grantee
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN ('gantt_baselines', 'gantt_baseline_activities')
      AND grantee IN ('anon', 'authenticated')
    ORDER BY table_name, grantee`;
  return rows;
}

async function backendGrants(client: postgres.Sql) {
  const rows = await client`
    SELECT table_name, grantee
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN ('gantt_baselines', 'gantt_baseline_activities')
      AND grantee = 'postgres'
    ORDER BY table_name`;
  return rows;
}

describe("migration 0037 Primavera baseline RLS hardening", () => {
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

  it("enables RLS and revokes anon/authenticated on both baseline tables", async () => {
    const client = await database("fresh");
    await client.unsafe(migration);

    const rls = await rlsState(client);
    expect(rls["gantt_baselines"]).toBe(true);
    expect(rls["gantt_baseline_activities"]).toBe(true);

    const browser = await browserGrants(client);
    expect(browser).toHaveLength(0);

    // Backend (owner) privileges must remain intact.
    const backend = await backendGrants(client);
    expect(backend.length).toBeGreaterThan(0);
    await client.end();
  });

  it("is idempotent on a second run", async () => {
    const client = await database("idempotent");
    await client.unsafe(migration);
    await client.unsafe(migration);

    const rls = await rlsState(client);
    expect(rls["gantt_baselines"]).toBe(true);
    expect(rls["gantt_baseline_activities"]).toBe(true);
    expect(await browserGrants(client)).toHaveLength(0);
    await client.end();
  });

  it("rollback restores the pre-hardening state", async () => {
    const client = await database("rollback");
    await client.unsafe(migration);
    await client.unsafe(rollback);

    const rls = await rlsState(client);
    expect(rls["gantt_baselines"]).toBe(false);
    expect(rls["gantt_baseline_activities"]).toBe(false);
    const browser = await browserGrants(client);
    expect(browser.length).toBeGreaterThan(0); // anon/authenticated grants restored
    await client.end();
  });
});
