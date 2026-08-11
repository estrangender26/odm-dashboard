-- Migration 0023: safely backfill default calendars for Primavera Lite projects missing a default calendar.
-- Idempotent, drift-detecting, and never modifies legacy Gantt projects.

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

ALTER TABLE IF EXISTS public.gantt_projects
  ADD COLUMN IF NOT EXISTS default_calendar_id integer;

DO $$
DECLARE
  v_project record;
  v_calendar_id integer;
  v_type text;
BEGIN
  -- Validate required schema columns exist and have expected types
  IF to_regclass('public.gantt_projects') IS NOT NULL THEN
    SELECT data_type INTO v_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'gantt_projects'
      AND column_name = 'default_calendar_id';

    IF v_type IS NOT NULL AND v_type <> 'integer' THEN
      RAISE EXCEPTION 'gantt_projects.default_calendar_id type conflict: expected integer, found %', v_type;
    END IF;
  END IF;

  IF to_regclass('public.gantt_wbs_nodes') IS NOT NULL AND to_regclass('public.gantt_projects') IS NOT NULL THEN
    -- Backfill only Primavera Lite projects (projects that have entries in gantt_wbs_nodes).
    -- Legacy Gantt projects never have entries in gantt_wbs_nodes and are never modified.
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
      -- Check if a calendar already exists for this project
      SELECT c.id INTO v_calendar_id
      FROM public.gantt_calendars c
      WHERE c.project_id = v_project.id
      ORDER BY c.id ASC
      LIMIT 1;

      IF v_calendar_id IS NULL THEN
        -- Create the default Mon-Fri, 8h/day, Asia/Manila calendar
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

      -- Assign the default calendar to the project
      UPDATE public.gantt_projects
      SET default_calendar_id = v_calendar_id
      WHERE id = v_project.id;
    END LOOP;
  END IF;
END
$$;
