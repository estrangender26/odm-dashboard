import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const baseUrl = "postgresql://postgres:postgres@localhost:5433/";
const databases: string[] = [];
const migration0023 = fs.readFileSync(
  path.join(process.cwd(), "db/migrations/0023_primavera_lite_default_calendar.sql"),
  "utf8"
);
const verification0023 = fs.readFileSync(
  path.join(process.cwd(), "db/migrations/helpers/0023_primavera_lite_default_calendar_verification.sql"),
  "utf8"
);
const preflight0023 = fs.readFileSync(
  path.join(process.cwd(), "db/migrations/helpers/0023_primavera_lite_default_calendar_preflight.sql"),
  "utf8"
);

async function createTestDatabase(label: string) {
  const name = `odmtest_pr6_mig_${label.replace(/[^a-z0-9]+/gi, "_")}_${Date.now()}_${databases.length}`;
  databases.push(name);
  const admin = postgres(baseUrl + "postgres", { ssl: false, prepare: false, max: 1 });
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  await admin.end();
  const client = postgres(baseUrl + name, { ssl: false, prepare: false, max: 1 });

  await client.unsafe(`
    CREATE OR REPLACE FUNCTION public._mig_check_column(
      p_table text,
      p_column text,
      p_expected_type text,
      p_expected_nullable text,
      p_expected_varchar_length int,
      p_expected_default text
    ) RETURNS void AS $$
    BEGIN
      -- dummy helper for test isolation
    END;
    $$ LANGUAGE plpgsql;

    CREATE TABLE gantt_projects (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      default_calendar_id INTEGER
    );

    CREATE TABLE gantt_wbs_nodes (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES gantt_projects(id)
    );

    CREATE TABLE gantt_calendars (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES gantt_projects(id),
      name VARCHAR(255) NOT NULL,
      working_days INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5}',
      hours_per_day NUMERIC(4,2) NOT NULL DEFAULT 8,
      timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Manila',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  return client;
}

describe("migration 0023 Primavera Lite default calendar backfill", () => {
  beforeAll(() => {
    if (process.env.PRIMAVERA_PR1_TEST_DB !== "1") {
      throw new Error("PRIMAVERA_PR1_TEST_DB=1 is required");
    }
  });

  afterAll(async () => {
    const admin = postgres(baseUrl + "postgres", { ssl: false, prepare: false, max: 1 });
    try {
      for (const name of databases) {
        await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      }
    } finally {
      await admin.end();
    }
  });

  it("safely backfills Primavera Lite projects, never modifies legacy Gantt projects, and is idempotent", async () => {
    const client = await createTestDatabase("backfill");
    try {
      // 1. Insert Primavera Lite project without calendar
      await client`INSERT INTO gantt_projects (id, name, default_calendar_id) VALUES (1, 'Primavera Project', NULL)`;
      await client`INSERT INTO gantt_wbs_nodes (id, project_id) VALUES (10, 1)`;

      // 2. Insert Legacy Gantt project (no WBS node) without calendar
      await client`INSERT INTO gantt_projects (id, name, default_calendar_id) VALUES (2, 'Legacy Gantt Project', NULL)`;

      // Run preflight
      const preflight = await client.unsafe(preflight0023);
      expect(Number(preflight[0].primavera_lite_project_count)).toBe(1);
      expect(Number(preflight[0].primavera_lite_missing_default_calendar_count)).toBe(1);
      expect(Number(preflight[0].legacy_gantt_project_count)).toBe(1);

      // Run Migration 0023
      await client.unsafe(migration0023);

      // Verify Primavera Lite project got a calendar
      const p1 = await client`SELECT * FROM gantt_projects WHERE id = 1`;
      expect(p1[0].default_calendar_id).not.toBeNull();

      const c1 = await client`SELECT * FROM gantt_calendars WHERE project_id = 1`;
      expect(c1).toHaveLength(1);
      expect(c1[0]).toMatchObject({
        name: "Default Calendar",
        working_days: [1, 2, 3, 4, 5],
        timezone: "Asia/Manila",
      });

      // Verify Legacy Gantt project was UNTOUCHED
      const p2 = await client`SELECT * FROM gantt_projects WHERE id = 2`;
      expect(p2[0].default_calendar_id).toBeNull();
      const c2 = await client`SELECT * FROM gantt_calendars WHERE project_id = 2`;
      expect(c2).toHaveLength(0);

      // Verify verification script reports 0 missing
      const verifyRows = await client.unsafe(verification0023);
      expect(verifyRows).toHaveLength(0);

      // Idempotency: re-run migration 0023
      await client.unsafe(migration0023);

      // Still exactly 1 calendar total
      const allCalendars = await client`SELECT * FROM gantt_calendars`;
      expect(allCalendars).toHaveLength(1);
    } finally {
      await client.end();
    }
  });
});
