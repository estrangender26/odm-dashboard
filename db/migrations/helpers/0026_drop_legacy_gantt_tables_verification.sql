-- Migration 0026 verification: read-only checks after legacy Gantt table drop.
-- Run this AFTER the forward migration. It performs no writes.
--
-- Confirms:
--   1. gantt_dependencies and gantt_tasks no longer exist.
--   2. Their owned SERIAL sequences no longer exist.
--   3. Protected Primavera tables still exist.

-- 1. Target tables should be absent
WITH target_tables(table_name) AS (
  VALUES ('gantt_dependencies'::text), ('gantt_tasks'::text)
)
SELECT
  target_tables.table_name,
  CASE WHEN to_regclass(format('public.%I', target_tables.table_name)) IS NULL THEN true ELSE false END AS table_absent
FROM target_tables
ORDER BY target_tables.table_name;

-- 2. Owned sequences should be absent
SELECT
  seq.relname AS sequence_name,
  CASE WHEN seq.oid IS NULL THEN true ELSE false END AS sequence_absent
FROM (
  VALUES ('gantt_dependencies_id_seq'::text), ('gantt_tasks_id_seq'::text)
) AS expected(seq_name)
LEFT JOIN pg_class seq ON seq.relname = expected.seq_name AND seq.relkind = 'S';

-- 3. Protected Primavera tables must still exist
WITH protected_tables(table_name) AS (
  VALUES
    ('gantt_projects'::text),
    ('gantt_project_events'::text),
    ('gantt_wbs_nodes'::text),
    ('gantt_activities'::text),
    ('gantt_activity_dependencies'::text),
    ('gantt_calendars'::text),
    ('gantt_calendar_exceptions'::text)
)
SELECT
  protected_tables.table_name,
  CASE WHEN to_regclass(format('public.%I', protected_tables.table_name)) IS NOT NULL THEN true ELSE false END AS table_exists
FROM protected_tables
ORDER BY protected_tables.table_name;
