-- Preflight for migration 0020_primavera_lite_shell
-- Run against the target database before applying the forward migration.
-- All checks are read-only.

\echo '=== Migration 0020 preflight ==='

CREATE TEMP TABLE IF NOT EXISTS _pr1_preflight_results (check_name text PRIMARY KEY, detail text);
TRUNCATE _pr1_preflight_results;

-- 1. Confirm required extension exists
INSERT INTO _pr1_preflight_results
SELECT 'gen_random_uuid available',
       CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp' OR extname = 'pgcrypto')
            THEN 'ok' ELSE 'MISSING' END;

-- 2. Check whether PR 1 objects already exist
INSERT INTO _pr1_preflight_results VALUES
  ('admin_token_hash_exists',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'gantt_projects' AND column_name = 'admin_token_hash') THEN 'yes' ELSE 'no' END),
  ('archived_at_exists',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'gantt_projects' AND column_name = 'archived_at') THEN 'yes' ELSE 'no' END),
  ('wbs_nodes_table_exists',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'gantt_wbs_nodes') THEN 'yes' ELSE 'no' END),
  ('activities_table_exists',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'gantt_activities') THEN 'yes' ELSE 'no' END),
  ('gantt_calendars_table_exists',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'gantt_calendars') THEN 'yes' ELSE 'no' END);

-- 3. Duplicate active WBS codes (only relevant once gantt_wbs_nodes exists)
DO $$
DECLARE
  v_count integer;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'gantt_wbs_nodes') THEN
    SELECT count(*) INTO v_count
    FROM (
      SELECT 1
      FROM public.gantt_wbs_nodes
      WHERE archived_at IS NULL
      GROUP BY project_id, code
      HAVING count(*) > 1
    ) d;
    INSERT INTO _pr1_preflight_results VALUES ('duplicate_active_wbs_codes', coalesce(v_count, 0) || ' duplicates');
  ELSE
    INSERT INTO _pr1_preflight_results VALUES ('duplicate_active_wbs_codes', 'table not yet created');
  END IF;
END $$;

-- 4. Current row counts for legacy and existing tables
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='gantt_projects') THEN
    EXECUTE 'INSERT INTO _pr1_preflight_results SELECT ''row_count:gantt_projects'', count(*)::text FROM public.gantt_projects';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='gantt_tasks') THEN
    EXECUTE 'INSERT INTO _pr1_preflight_results SELECT ''row_count:gantt_tasks'', count(*)::text FROM public.gantt_tasks';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='gantt_dependencies') THEN
    EXECUTE 'INSERT INTO _pr1_preflight_results SELECT ''row_count:gantt_dependencies'', count(*)::text FROM public.gantt_dependencies';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='gantt_project_events') THEN
    EXECUTE 'INSERT INTO _pr1_preflight_results SELECT ''row_count:gantt_project_events'', count(*)::text FROM public.gantt_project_events';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='gantt_calendars') THEN
    EXECUTE 'INSERT INTO _pr1_preflight_results SELECT ''row_count:gantt_calendars'', count(*)::text FROM public.gantt_calendars';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='gantt_calendar_exceptions') THEN
    EXECUTE 'INSERT INTO _pr1_preflight_results SELECT ''row_count:gantt_calendar_exceptions'', count(*)::text FROM public.gantt_calendar_exceptions';
  END IF;
END $$;

-- 5. Sanity: no NULL public_id in existing gantt_projects
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='gantt_projects' AND column_name='public_id') THEN
    EXECUTE 'INSERT INTO _pr1_preflight_results SELECT ''null_public_id_count'', count(*)::text FROM public.gantt_projects WHERE public_id IS NULL';
  ELSE
    INSERT INTO _pr1_preflight_results VALUES ('null_public_id_count', 'column not present');
  END IF;
END $$;

SELECT * FROM _pr1_preflight_results ORDER BY check_name;

\echo '=== Preflight complete ==='
