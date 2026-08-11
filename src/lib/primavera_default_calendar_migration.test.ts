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

  it("production regression: default_calendar_id exists as INTEGER but its FK is absent", async () => {
    const client = await createBaseDatabase("missing_default_calendar_fk");
    try {
      await client.unsafe(`
        ALTER TABLE public.gantt_projects
          ADD COLUMN default_calendar_id integer;

        INSERT INTO public.gantt_projects (id, name) VALUES (1, 'Production State Project');
        INSERT INTO public.gantt_wbs_nodes (id, project_id) VALUES (10, 1);
      `);

      const historicalState = await client.unsafe(`
        SELECT
          column_row.data_type,
          (SELECT count(*)::integer
           FROM pg_constraint constraint_row
           WHERE constraint_row.contype = 'f'
             AND constraint_row.conrelid = 'public.gantt_projects'::regclass
             AND column_row.ordinal_position = ANY (constraint_row.conkey)) AS fk_count
        FROM information_schema.columns column_row
        WHERE column_row.table_schema = 'public'
          AND column_row.table_name = 'gantt_projects'
          AND column_row.column_name = 'default_calendar_id';
      `);
      expect(historicalState).toEqual([{ data_type: "integer", fk_count: 0 }]);

      await client.unsafe(migration0023);

      const defaultCalendarFks = await client.unsafe(`
        SELECT
          target_table.relname AS target_table,
          target_column.attname AS target_column,
          constraint_row.confdeltype AS delete_rule
        FROM pg_constraint constraint_row
        JOIN pg_class source_table
          ON source_table.oid = constraint_row.conrelid
        JOIN pg_attribute source_column
          ON source_column.attrelid = source_table.oid
         AND source_column.attnum = constraint_row.conkey[1]
        JOIN pg_class target_table
          ON target_table.oid = constraint_row.confrelid
        JOIN pg_attribute target_column
          ON target_column.attrelid = target_table.oid
         AND target_column.attnum = constraint_row.confkey[1]
        WHERE constraint_row.contype = 'f'
          AND constraint_row.conrelid = 'public.gantt_projects'::regclass
          AND array_length(constraint_row.conkey, 1) = 1
          AND source_column.attname = 'default_calendar_id';
      `);
      expect(defaultCalendarFks).toEqual([
        {
          target_table: "gantt_calendars",
          target_column: "id",
          delete_rule: "n",
        },
      ]);

      const projectCalendar = await client.unsafe(`
        SELECT
          project.default_calendar_id,
          calendar.id AS calendar_id,
          calendar.project_id AS calendar_project_id
        FROM public.gantt_projects project
        JOIN public.gantt_calendars calendar
          ON calendar.id = project.default_calendar_id
        WHERE project.id = 1;
      `);
      expect(projectCalendar).toHaveLength(1);
      expect(projectCalendar[0].default_calendar_id).toBe(projectCalendar[0].calendar_id);
      expect(projectCalendar[0].calendar_project_id).toBe(1);

      await client.unsafe(migration0023);

      const stateAfterSecondRun = await client.unsafe(`
        SELECT
          (SELECT count(*)::integer
           FROM pg_constraint constraint_row
           JOIN pg_attribute source_column
             ON source_column.attrelid = constraint_row.conrelid
            AND source_column.attnum = constraint_row.conkey[1]
           WHERE constraint_row.contype = 'f'
             AND constraint_row.conrelid = 'public.gantt_projects'::regclass
             AND array_length(constraint_row.conkey, 1) = 1
             AND source_column.attname = 'default_calendar_id') AS fk_count,
          (SELECT count(*)::integer
           FROM public.gantt_calendars
           WHERE project_id = 1) AS calendar_count,
          (SELECT default_calendar_id
           FROM public.gantt_projects
           WHERE id = 1) AS default_calendar_id;
      `);
      expect(stateAfterSecondRun).toEqual([
        {
          fk_count: 1,
          calendar_count: 1,
          default_calendar_id: projectCalendar[0].default_calendar_id,
        },
      ]);
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

  it("conflicting drift: rejects default_calendar_id FK referencing wrong table before backfill", async () => {
    const client = await createBaseDatabase("conflict_wrong_def_fk");
    try {
      await client.unsafe(`
        ALTER TABLE public.gantt_projects
          ADD COLUMN default_calendar_id integer REFERENCES public.gantt_projects(id) ON DELETE SET NULL;
      `);

      await expect(client.unsafe(migration0023)).rejects.toThrow(
        /gantt_projects\.default_calendar_id FK conflict: references gantt_projects instead of gantt_calendars/i
      );
    } finally {
      await client.end();
    }
  });

  it("conflicting drift: rejects default_calendar_id FK with wrong delete rule before backfill", async () => {
    const client = await createBaseDatabase("conflict_wrong_def_del_rule");
    try {
      await client.unsafe(`
        ALTER TABLE public.gantt_projects
          ADD COLUMN default_calendar_id integer REFERENCES public.gantt_calendars(id) ON DELETE CASCADE;
      `);

      await expect(client.unsafe(migration0023)).rejects.toThrow(
        /gantt_projects\.default_calendar_id FK delete rule conflict: expected SET NULL \(n\), found c/i
      );
    } finally {
      await client.end();
    }
  });

  it("conflicting drift: rejects wrong working_days default before backfill", async () => {
    const client = await createBaseDatabase("conflict_working_days_default", false);
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

  it("conflicting drift: rejects hours_per_day default 18 before backfill", async () => {
    const client = await createBaseDatabase("conflict_hours_default", false);
    try {
      await client.unsafe(`
        CREATE TABLE public.gantt_calendars (
          id serial PRIMARY KEY,
          project_id integer NOT NULL REFERENCES public.gantt_projects(id) ON DELETE CASCADE,
          name character varying(255) NOT NULL,
          working_days integer[] DEFAULT '{1,2,3,4,5}'::integer[] NOT NULL,
          hours_per_day numeric(4,2) DEFAULT 18 NOT NULL,
          timezone character varying(100) DEFAULT 'Asia/Manila'::character varying NOT NULL,
          created_at timestamp without time zone DEFAULT now(),
          updated_at timestamp without time zone DEFAULT now()
        );
      `);

      await expect(client.unsafe(migration0023)).rejects.toThrow(
        /gantt_calendars\.hours_per_day default conflict: expected 8, found/i
      );
    } finally {
      await client.end();
    }
  });

  it("conflicting drift: rejects wrong timezone default before backfill", async () => {
    const client = await createBaseDatabase("conflict_timezone_default", false);
    try {
      await client.unsafe(`
        CREATE TABLE public.gantt_calendars (
          id serial PRIMARY KEY,
          project_id integer NOT NULL REFERENCES public.gantt_projects(id) ON DELETE CASCADE,
          name character varying(255) NOT NULL,
          working_days integer[] DEFAULT '{1,2,3,4,5}'::integer[] NOT NULL,
          hours_per_day numeric(4,2) DEFAULT 8 NOT NULL,
          timezone character varying(100) DEFAULT 'Asia/Tokyo'::character varying NOT NULL,
          created_at timestamp without time zone DEFAULT now(),
          updated_at timestamp without time zone DEFAULT now()
        );
      `);

      await expect(client.unsafe(migration0023)).rejects.toThrow(
        /gantt_calendars\.timezone default conflict: expected Asia\/Manila/i
      );
    } finally {
      await client.end();
    }
  });
});
