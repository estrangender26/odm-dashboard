-- Migration 0030: Primavera Lite Baseline Management
-- Adds gantt_baselines and gantt_baseline_activities tables.
-- Baseline activity snapshots are detached from live activities/WBS nodes
-- so that later archival or deletion of live rows cannot destroy history.

CREATE TABLE IF NOT EXISTS public.gantt_baselines (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES public.gantt_projects(id) ON DELETE RESTRICT,
  public_id uuid UNIQUE,
  name character varying(255) NOT NULL,
  description text,
  activity_count integer NOT NULL DEFAULT 0,
  project_revision integer NOT NULL,
  captured_at timestamp without time zone DEFAULT now(),
  captured_by_name character varying(255),
  created_at timestamp without time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gantt_baselines_project_idx ON public.gantt_baselines (project_id);
CREATE INDEX IF NOT EXISTS gantt_baselines_project_created_idx ON public.gantt_baselines (project_id, created_at);

CREATE TABLE IF NOT EXISTS public.gantt_baseline_activities (
  id serial PRIMARY KEY,
  baseline_id integer NOT NULL REFERENCES public.gantt_baselines(id) ON DELETE CASCADE,
  activity_id integer NOT NULL,
  activity_code character varying(100),
  activity_name character varying(500) NOT NULL,
  wbs_node_id integer NOT NULL,
  wbs_code character varying(100),
  wbs_name character varying(500),
  calendar_id integer,
  calendar_name character varying(255),
  original_duration_days integer NOT NULL DEFAULT 0,
  scheduled_start date,
  scheduled_finish date,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp without time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gantt_baseline_activities_baseline_idx ON public.gantt_baseline_activities (baseline_id);
CREATE INDEX IF NOT EXISTS gantt_baseline_activities_activity_idx ON public.gantt_baseline_activities (baseline_id, activity_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'gantt_baseline_activities'
      AND indexname = 'gantt_baseline_activities_baseline_activity_unique'
  ) THEN
    CREATE UNIQUE INDEX gantt_baseline_activities_baseline_activity_unique
      ON public.gantt_baseline_activities (baseline_id, activity_id);
  END IF;
END
$$;
