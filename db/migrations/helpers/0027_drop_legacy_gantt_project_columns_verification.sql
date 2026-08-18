-- Migration 0027 verification: read-only checks after legacy gantt_projects column drop.
-- Run this AFTER the forward migration. It performs no writes.
--
-- Confirms:
--   1. The six legacy columns no longer exist.
--   2. public.gantt_projects still exists.
--   3. Protected active columns remain.
--   4. Protected related Primavera tables remain.

-- 1. Legacy columns absent
WITH legacy_columns(column_name) AS (
  VALUES
    ('session_id'::text), ('user_id'::text), ('tasks_data'::text),
    ('links_data'::text), ('created_by'::text), ('updated_by'::text)
)
SELECT
  lc.column_name,
  CASE WHEN col.column_name IS NULL THEN true ELSE false END AS column_absent
FROM legacy_columns lc
LEFT JOIN information_schema.columns col
  ON col.table_schema = 'public'
 AND col.table_name = 'gantt_projects'
 AND col.column_name = lc.column_name
ORDER BY lc.column_name;

-- 2. gantt_projects table still exists
SELECT
  CASE WHEN to_regclass('public.gantt_projects') IS NOT NULL THEN true ELSE false END AS gantt_projects_exists;

-- 3. Protected active columns remain
WITH protected_columns(column_name) AS (
  VALUES
    ('id'::text), ('name'::text), ('project_name'::text), ('description'::text),
    ('status'::text), ('start_date'::text), ('finish_date'::text), ('revision'::text),
    ('slug'::text), ('public_id'::text), ('owner_id'::text), ('tenant_id'::text),
    ('org_id'::text), ('admin_token_hash'::text), ('edit_token_hash'::text),
    ('view_token_hash'::text), ('sharing_enabled'::text), ('data_date'::text),
    ('default_calendar_id'::text), ('archived_at'::text), ('created_at'::text), ('updated_at'::text)
)
SELECT
  pc.column_name,
  CASE WHEN col.column_name IS NOT NULL THEN true ELSE false END AS column_exists
FROM protected_columns pc
LEFT JOIN information_schema.columns col
  ON col.table_schema = 'public'
 AND col.table_name = 'gantt_projects'
 AND col.column_name = pc.column_name
ORDER BY pc.column_name;

-- 4. Protected related tables remain
WITH protected_tables(table_name) AS (
  VALUES
    ('gantt_project_events'::text),
    ('gantt_wbs_nodes'::text),
    ('gantt_activities'::text),
    ('gantt_activity_dependencies'::text),
    ('gantt_calendars'::text),
    ('gantt_calendar_exceptions'::text)
)
SELECT
  pt.table_name,
  CASE WHEN to_regclass(format('public.%I', pt.table_name)) IS NOT NULL THEN true ELSE false END AS table_exists
FROM protected_tables pt
ORDER BY pt.table_name;
