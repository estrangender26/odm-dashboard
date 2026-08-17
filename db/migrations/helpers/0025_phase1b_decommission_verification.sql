-- Migration 0025 Phase 1B decommission: read-only post-migration verification.
-- Run this AFTER the forward migration. It performs no writes.
--
-- Expected result: all 4 tables should show table_exists = false.
-- No rows should appear in the dependency section.

-- ── Section 1: Confirm all 4 tables no longer exist ──
WITH target_tables(table_name) AS (
  VALUES
    ('odm_talk_notifications'::text),
    ('odm_talk_messages'::text),
    ('odm_talk_threads'::text),
    ('gantt_links'::text)
)
SELECT
  target_tables.table_name,
  to_regclass(format('public.%I', target_tables.table_name)) IS NOT NULL AS table_exists
FROM target_tables
ORDER BY target_tables.table_name;

-- ── Section 2: Confirm no orphaned dependencies remain ──
SELECT
  cls.relname AS referencing_table,
  con.conname AS constraint_name,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class cls ON cls.oid = con.conrelid
WHERE con.contype = 'f'
  AND cls.relnamespace = 'public'::regnamespace
  AND pg_get_constraintdef(con.oid) ~ 'odm_talk_|gantt_links'
ORDER BY cls.relname, con.conname;
