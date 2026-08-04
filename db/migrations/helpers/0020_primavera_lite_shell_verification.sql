-- Verification for migration 0020_primavera_lite_shell
-- Run after the forward migration to confirm objects exist and legacy data is intact.

\echo '=== Migration 0020 verification ==='

-- 1. New columns exist on gantt_projects
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'gantt_projects' AND column_name = 'admin_token_hash' AND data_type = 'character varying') AS admin_token_hash_ok,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'gantt_projects' AND column_name = 'archived_at' AND data_type = 'timestamp with time zone') AS archived_at_ok;

-- 2. New tables exist
SELECT
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'gantt_wbs_nodes') AS wbs_nodes_table_ok,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'gantt_activities') AS activities_table_ok;

-- 3. Foreign key behavior is RESTRICT (not CASCADE) for new tables
SELECT tc.table_name, kcu.column_name, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN ('gantt_wbs_nodes', 'gantt_activities')
ORDER BY tc.table_name, kcu.column_name;

-- 4. Partial unique index on active WBS codes
SELECT EXISTS (
  SELECT 1 FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'gantt_wbs_nodes_project_code_unique'
) AS wbs_code_unique_index_ok;

-- 5. Legacy counts (guard for tables that exist in production but may not exist in a fresh isolated DB)
CREATE TEMP TABLE IF NOT EXISTS _pr1_verify_counts (table_name text PRIMARY KEY, row_count bigint);
TRUNCATE _pr1_verify_counts;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='gantt_projects') THEN
    EXECUTE 'INSERT INTO _pr1_verify_counts VALUES (''gantt_projects'', (SELECT count(*) FROM public.gantt_projects))';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='gantt_tasks') THEN
    EXECUTE 'INSERT INTO _pr1_verify_counts VALUES (''gantt_tasks'', (SELECT count(*) FROM public.gantt_tasks))';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='gantt_dependencies') THEN
    EXECUTE 'INSERT INTO _pr1_verify_counts VALUES (''gantt_dependencies'', (SELECT count(*) FROM public.gantt_dependencies))';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='gantt_project_events') THEN
    EXECUTE 'INSERT INTO _pr1_verify_counts VALUES (''gantt_project_events'', (SELECT count(*) FROM public.gantt_project_events))';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='gantt_calendars') THEN
    EXECUTE 'INSERT INTO _pr1_verify_counts VALUES (''gantt_calendars'', (SELECT count(*) FROM public.gantt_calendars))';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='gantt_calendar_exceptions') THEN
    EXECUTE 'INSERT INTO _pr1_verify_counts VALUES (''gantt_calendar_exceptions'', (SELECT count(*) FROM public.gantt_calendar_exceptions))';
  END IF;
END $$;
SELECT * FROM _pr1_verify_counts ORDER BY table_name;

-- 6. Existing gantt_projects columns were NOT altered (types remain)
SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'gantt_projects'
  AND column_name IN ('start_date', 'finish_date', 'data_date', 'last_scheduled_at', 'created_at', 'updated_at', 'tasks_data', 'links_data')
ORDER BY ordinal_position;

\echo '=== Verification complete ==='
