-- Migration 0023: safely backfill default calendars for Primavera Lite projects missing a default calendar.
-- Idempotent, drift-detecting, schema-validating, and never modifies legacy Gantt projects.

CREATE OR REPLACE FUNCTION public._mig0023_normalize_default(expr text) RETURNS text AS $$
DECLARE
  v text;
BEGIN
  IF expr IS NULL THEN RETURN NULL; END IF;
  -- Remove trailing type cast like ::integer[], ::numeric, ::character varying(100), ::text, etc.
  v := regexp_replace(expr, '(::[a-z0-9_ ]+(\([0-9,]+\))?(\[\])?)+$', '', 'i');
  -- Remove whitespace
  v := regexp_replace(v, '\s+', '', 'g');
  -- Strip surrounding single/double quotes
  v := trim(both '''' from v);
  v := trim(both '"' from v);
  -- Normalize ARRAY[1,2,3,4,5] to {1,2,3,4,5}
  IF v ~* '^array\[' THEN
    v := '{' || substring(v from 7 for length(v) - 7) || '}';
  END IF;
  IF v ~ '^[0-9]+(\.[0-9]+)?$' THEN
    v := regexp_replace(v, '^0+([1-9])', '\1');
    IF v LIKE '%.%' THEN
      v := regexp_replace(v, '0+$', '');
      v := regexp_replace(v, '\.$', '');
    END IF;
  END IF;
  RETURN lower(v);
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS public.gantt_calendars (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES public.gantt_projects(id) ON DELETE CASCADE,
  name character varying(255) NOT NULL,
  working_days integer[] DEFAULT '{1,2,3,4,5}'::integer[] NOT NULL,
  hours_per_day numeric(4,2) DEFAULT 8 NOT NULL,
  timezone character varying(100) DEFAULT 'Asia/Manila'::character varying NOT NULL,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now()
);

DO $$
DECLARE
  v_exists boolean;
  v_col record;
  v_fk record;
  v_project record;
  v_calendar_id integer;
BEGIN
  -- 1. Check if public.gantt_calendars exists
  SELECT to_regclass('public.gantt_calendars') IS NOT NULL INTO v_exists;
  IF v_exists THEN
    SELECT data_type, is_nullable INTO v_col
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'gantt_calendars' AND column_name = 'project_id';
    IF NOT FOUND OR v_col.data_type <> 'integer' OR v_col.is_nullable <> 'NO' THEN
      RAISE EXCEPTION 'gantt_calendars.project_id conflict: expected integer NOT NULL';
    END IF;

    SELECT data_type, is_nullable INTO v_col
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'gantt_calendars' AND column_name = 'name';
    IF NOT FOUND OR v_col.data_type <> 'character varying' OR v_col.is_nullable <> 'NO' THEN
      RAISE EXCEPTION 'gantt_calendars.name conflict: expected character varying NOT NULL';
    END IF;

    SELECT data_type, is_nullable INTO v_col
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'gantt_calendars' AND column_name = 'working_days';
    IF NOT FOUND OR v_col.data_type <> 'ARRAY' OR v_col.is_nullable <> 'NO' THEN
      RAISE EXCEPTION 'gantt_calendars.working_days conflict: expected ARRAY NOT NULL';
    END IF;

    SELECT data_type, is_nullable INTO v_col
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'gantt_calendars' AND column_name = 'hours_per_day';
    IF NOT FOUND OR v_col.data_type <> 'numeric' OR v_col.is_nullable <> 'NO' THEN
      RAISE EXCEPTION 'gantt_calendars.hours_per_day conflict: expected numeric NOT NULL';
    END IF;

    SELECT data_type, is_nullable INTO v_col
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'gantt_calendars' AND column_name = 'timezone';
    IF NOT FOUND OR v_col.data_type <> 'character varying' OR v_col.is_nullable <> 'NO' THEN
      RAISE EXCEPTION 'gantt_calendars.timezone conflict: expected character varying NOT NULL';
    END IF;

    -- Validate canonical defaults
    SELECT column_default INTO v_col
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'gantt_calendars' AND column_name = 'working_days';
    IF NOT FOUND OR v_col.column_default IS NULL OR public._mig0023_normalize_default(v_col.column_default) <> '{1,2,3,4,5}' THEN
      RAISE EXCEPTION 'gantt_calendars.working_days default conflict: expected {1,2,3,4,5}, found %', v_col.column_default;
    END IF;

    SELECT column_default INTO v_col
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'gantt_calendars' AND column_name = 'hours_per_day';
    IF NOT FOUND OR v_col.column_default IS NULL OR public._mig0023_normalize_default(v_col.column_default) <> '8' THEN
      RAISE EXCEPTION 'gantt_calendars.hours_per_day default conflict: expected 8, found %', v_col.column_default;
    END IF;

    SELECT column_default INTO v_col
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'gantt_calendars' AND column_name = 'timezone';
    IF NOT FOUND OR v_col.column_default IS NULL OR public._mig0023_normalize_default(v_col.column_default) <> 'asia/manila' THEN
      RAISE EXCEPTION 'gantt_calendars.timezone default conflict: expected Asia/Manila, found %', v_col.column_default;
    END IF;

    SELECT c.confdeltype, cl.relname AS target_table
    INTO v_fk
    FROM pg_constraint c
    JOIN pg_class cl ON c.confrelid = cl.oid
    WHERE c.conrelid = 'public.gantt_calendars'::regclass
      AND c.contype = 'f'
      AND (
        SELECT attname FROM pg_attribute WHERE attrelid = c.conrelid AND attnum = c.conkey[1]
      ) = 'project_id'
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'gantt_calendars project_id FK conflict: missing foreign key constraint to gantt_projects';
    END IF;
    IF v_fk.target_table <> 'gantt_projects' THEN
      RAISE EXCEPTION 'gantt_calendars project_id FK conflict: references % instead of gantt_projects', v_fk.target_table;
    END IF;
    IF v_fk.confdeltype <> 'c' THEN
      RAISE EXCEPTION 'gantt_calendars project_id FK delete rule conflict: expected CASCADE (c), found %', v_fk.confdeltype;
    END IF;
  ELSE
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
  END IF;

  -- 2. Validate or create gantt_projects.default_calendar_id
  SELECT data_type INTO v_col
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'gantt_projects' AND column_name = 'default_calendar_id';

  IF FOUND THEN
    IF v_col.data_type <> 'integer' THEN
      RAISE EXCEPTION 'gantt_projects.default_calendar_id type conflict: expected integer, found %', v_col.data_type;
    END IF;
    SELECT c.confdeltype, cl.relname AS target_table INTO v_fk
    FROM pg_constraint c
    JOIN pg_class cl ON c.confrelid = cl.oid
    WHERE c.conrelid = 'public.gantt_projects'::regclass
      AND c.contype = 'f'
      AND (
        SELECT attname FROM pg_attribute WHERE attrelid = c.conrelid AND attnum = c.conkey[1]
      ) = 'default_calendar_id'
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'gantt_projects.default_calendar_id FK conflict: missing foreign key constraint to gantt_calendars';
    END IF;
    IF v_fk.target_table <> 'gantt_calendars' THEN
      RAISE EXCEPTION 'gantt_projects.default_calendar_id FK conflict: references % instead of gantt_calendars', v_fk.target_table;
    END IF;
    IF v_fk.confdeltype <> 'n' THEN
      RAISE EXCEPTION 'gantt_projects.default_calendar_id FK delete rule conflict: expected SET NULL (n), found %', v_fk.confdeltype;
    END IF;
  ELSE
    ALTER TABLE public.gantt_projects
      ADD COLUMN default_calendar_id integer REFERENCES public.gantt_calendars(id) ON DELETE SET NULL;
  END IF;

  -- 3. Backfill only Primavera Lite projects (projects that have entries in gantt_wbs_nodes).
  -- Legacy Gantt projects never have entries in gantt_wbs_nodes and are never modified.
  IF to_regclass('public.gantt_wbs_nodes') IS NOT NULL AND to_regclass('public.gantt_projects') IS NOT NULL THEN
    FOR v_project IN
      SELECT p.id, p.name
      FROM public.gantt_projects p
      WHERE EXISTS (SELECT 1 FROM public.gantt_wbs_nodes w WHERE w.project_id = p.id)
        AND (
          p.default_calendar_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.gantt_calendars c WHERE c.id = p.default_calendar_id AND c.project_id = p.id
          )
        )
    LOOP
      SELECT c.id INTO v_calendar_id
      FROM public.gantt_calendars c
      WHERE c.project_id = v_project.id
      ORDER BY c.id ASC
      LIMIT 1;

      IF v_calendar_id IS NULL THEN
        INSERT INTO public.gantt_calendars (
          project_id, name, working_days, hours_per_day, timezone, created_at, updated_at
        )
        VALUES (
          v_project.id,
          'Default Calendar',
          ARRAY[1, 2, 3, 4, 5],
          8,
          'Asia/Manila',
          now(),
          now()
        )
        RETURNING id INTO v_calendar_id;
      END IF;

      UPDATE public.gantt_projects
      SET default_calendar_id = v_calendar_id
      WHERE id = v_project.id;
    END LOOP;
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public._mig0023_normalize_default(text);
