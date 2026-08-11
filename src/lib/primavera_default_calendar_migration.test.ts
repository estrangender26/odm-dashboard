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

async function createBaseDatabase(label: string, includeCalendarTable = true) {
  const name = `odmtest_pr6_mig_${label.replace(/[^a-z0-9]+/gi, "_")}_${Date.now()}_${databases.length}`;
  databases.push(name);
  const admin = postgres(baseUrl + "postgres", { ssl: false, prepare: false, max: 1 });
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  await admin.end();
  const client = postgres(baseUrl + name, { ssl: false, prepare: false, max: 1 });

  await client.unsafe(`
    CREATE TABLE gantt_projects (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL
    );

    CREATE TABLE gantt_wbs_nodes (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES gantt_projects(id)
    );
  `);

  if (includeCalendarTable) {
    await client.unsafe(`
      CREATE TABLE public.gantt_calendars (
        id serial PRIMARY KEY,
        project_id integer NOT NULL REFERENCES public.gantt_projects(id) ON DELETE CASCADE,
        name character varying(255) NOT NULL,
        working_days integer[] DEFAULT '{1,2,3,4,5}'::integer[] NOT NULL,
        hours_per_day numeric(4,2) DEFAULT 8 NOT NULL,
        timezone character varying(100) DEFAULT 'Asia/Manila'::character varying NOT NULL,
        created_at timestamp without time zone DEFAULT now(),
        updated_at timestamp without time zone DEFAULT now()
      );
    `);
  }

  return client;
}

describe("migration 0023 Primavera Lite default calendar backfill & schema validation", () => {
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
    const client = await createBaseDatabase("backfill");
    try {
      // 1. Insert Primavera Lite project without calendar
      await client`INSERT INTO gantt_projects (id, name) VALUES (1, 'Primavera Project')`;
      await client`INSERT INTO gantt_wbs_nodes (id, project_id) VALUES (10, 1)`;

      // 2. Insert Legacy Gantt project (no WBS node) without calendar
      await client`INSERT INTO gantt_projects (id, name) VALUES (2, 'Legacy Gantt Project')`;

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

  it("schema-present/ledger-absent drift: accepts canonical gantt_calendars table and default_calendar_id column when already present", async () => {
    const client = await createBaseDatabase("present");
    try {
      await client.unsafe(`
        ALTER TABLE public.gantt_projects
          ADD COLUMN default_calendar_id integer REFERENCES public.gantt_calendars(id) ON DELETE SET NULL;

        INSERT INTO gantt_projects (id, name, default_calendar_id) VALUES (1, 'Existing Schema Project', NULL);
        INSERT INTO gantt_wbs_nodes (id, project_id) VALUES (10, 1);
      `);

      // Run Migration 0023 -> should succeed and backfill
      await client.unsafe(migration0023);

      const p1 = await client`SELECT * FROM gantt_projects WHERE id = 1`;
      expect(p1[0].default_calendar_id).not.toBeNull();
      const c1 = await client`SELECT * FROM gantt_calendars WHERE project_id = 1`;
      expect(c1).toHaveLength(1);
    } finally {
      await client.end();
    }
  });

  it("conflicting drift: rejects column nullability conflict before backfill", async () => {
    const client = await createBaseDatabase("conflict_nullable", false);
    try {
      await client.unsafe(`
        CREATE TABLE public.gantt_calendars (
          id serial PRIMARY KEY,
          project_id integer NULL REFERENCES public.gantt_projects(id) ON DELETE CASCADE,
          name character varying(255) NOT NULL,
          working_days integer[] DEFAULT '{1,2,3,4,5}'::integer[] NOT NULL,
          hours_per_day numeric(4,2) DEFAULT 8 NOT NULL,
          timezone character varying(100) DEFAULT 'Asia/Manila'::character varying NOT NULL,
          created_at timestamp without time zone DEFAULT now(),
          updated_at timestamp without time zone DEFAULT now()
        );
      `);

      await expect(client.unsafe(migration0023)).rejects.toThrow(
        /gantt_calendars\.project_id conflict: expected integer NOT NULL/i
      );
    } finally {
      await client.end();
    }
  });

  it("conflicting drift: rejects foreign key CASCADE rule conflict before backfill", async () => {
    const client = await createBaseDatabase("conflict_fk", false);
    try {
      await client.unsafe(`
        CREATE TABLE public.gantt_calendars (
          id serial PRIMARY KEY,
          project_id integer NOT NULL REFERENCES public.gantt_projects(id) ON DELETE RESTRICT,
          name character varying(255) NOT NULL,
          working_days integer[] DEFAULT '{1,2,3,4,5}'::integer[] NOT NULL,
          hours_per_day numeric(4,2) DEFAULT 8 NOT NULL,
          timezone character varying(100) DEFAULT 'Asia/Manila'::character varying NOT NULL,
          created_at timestamp without time zone DEFAULT now(),
          updated_at timestamp without time zone DEFAULT now()
        );
      `);

      await expect(client.unsafe(migration0023)).rejects.toThrow(
        /gantt_calendars project_id FK delete rule conflict: expected CASCADE/i
      );
    } finally {
      await client.end();
    }
  });

  it("conflicting drift: rejects default_calendar_id data type conflict before backfill", async () => {
    const client = await createBaseDatabase("conflict_col_type");
    try {
      await client.unsafe(`
        ALTER TABLE public.gantt_projects
          ADD COLUMN default_calendar_id varchar(50);
      `);

      await expect(client.unsafe(migration0023)).rejects.toThrow(
        /gantt_projects\.default_calendar_id type conflict: expected integer/i
      );
    } finally {
      await client.end();
    }
  });

  it("conflicting drift: rejects missing calendar project FK before backfill", async () => {
    const client = await createBaseDatabase("conflict_missing_cal_fk", false);
    try {
      await client.unsafe(`
        CREATE TABLE public.gantt_calendars (
          id serial PRIMARY KEY,
          project_id integer NOT NULL,
          name character varying(255) NOT NULL,
          working_days integer[] DEFAULT '{1,2,3,4,5}'::integer[] NOT NULL,
          hours_per_day numeric(4,2) DEFAULT 8 NOT NULL,
          timezone character varying(100) DEFAULT 'Asia/Manila'::character varying NOT NULL,
          created_at timestamp without time zone DEFAULT now(),
          updated_at timestamp without time zone DEFAULT now()
        );
      `);

      await expect(client.unsafe(migration0023)).rejects.toThrow(
        /gantt_calendars project_id FK conflict: missing foreign key constraint to gantt_projects/i
      );
    } finally {
      await client.end();
    }
  });

  it("conflicting drift: rejects missing default_calendar_id FK before backfill", async () => {
    const client = await createBaseDatabase("conflict_missing_def_fk");
    try {
      await client.unsafe(`
        ALTER TABLE public.gantt_projects
          ADD COLUMN default_calendar_id integer;
      `);

      await expect(client.unsafe(migration0023)).rejects.toThrow(
        /gantt_projects\.default_calendar_id FK conflict: missing foreign key constraint to gantt_calendars/i
      );
    } finally {
      await client.end();
    }
  });

  it("conflicting drift: rejects wrong required default before backfill", async () => {
    const client = await createBaseDatabase("conflict_wrong_default", false);
    try {
      await client.unsafe(`
        CREATE TABLE public.gantt_calendars (
          id serial PRIMARY KEY,
          project_id integer NOT NULL REFERENCES public.gantt_projects(id) ON DELETE CASCADE,
          name character varying(255) NOT NULL,
          working_days integer[] DEFAULT '{1,2,3,4,5,6}'::integer[] NOT NULL,
          hours_per_day numeric(4,2) DEFAULT 8 NOT NULL,
          timezone character varying(100) DEFAULT 'Asia/Manila'::character varying NOT NULL,
          created_at timestamp without time zone DEFAULT now(),
          updated_at timestamp without time zone DEFAULT now()
        );
      `);

      await expect(client.unsafe(migration0023)).rejects.toThrow(
        /gantt_calendars\.working_days default conflict: expected {1,2,3,4,5}/i
      );
    } finally {
      await client.end();
    }
  });
});
