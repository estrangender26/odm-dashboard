-- Migration 0025 Phase 1B decommission: read-only dry-run preflight.
-- Run this BEFORE the forward migration. It performs no writes.
--
-- Checks:
--   1. All 4 target tables exist.
--   2. Owner is postgres for each.
--   3. Row estimates from pg_class (no row content exposed).
--   4. FK constraints are only the expected internal ODM-Talk graph.
--   5. No external FKs referencing the target tables.
--   6. No views, materialized views, triggers, or function dependencies.
--
-- If any check fails, do NOT proceed with the forward migration.

-- ── Section 1: Table existence and basic properties ──
WITH target_tables(table_name) AS (
  VALUES
    ('odm_talk_notifications'::text),
    ('odm_talk_messages'::text),
    ('odm_talk_threads'::text),
    ('gantt_links'::text)
)
SELECT
  target_tables.table_name,
  CASE WHEN cls.oid IS NOT NULL THEN true ELSE false END AS table_exists,
  pg_get_userbyid(cls.relowner) AS owner,
  cls.relrowsecurity AS rls_enabled,
  cls.relforcerowsecurity AS force_rls,
  cls.reltuples::bigint AS estimated_rows,
  COUNT(pol.policyname)::integer AS policy_count
FROM target_tables
LEFT JOIN pg_class AS cls
  ON cls.oid = format('public.%I', target_tables.table_name)::regclass
LEFT JOIN pg_policies AS pol
  ON pol.schemaname = 'public'
 AND pol.tablename = target_tables.table_name
GROUP BY target_tables.table_name, cls.oid, cls.relowner, cls.relrowsecurity, cls.relforcerowsecurity, cls.reltuples
ORDER BY target_tables.table_name;

-- ── Section 2: FK constraints (should be only internal ODM-Talk FKs) ──
WITH target_tables(table_name) AS (
  VALUES
    ('odm_talk_notifications'::text),
    ('odm_talk_messages'::text),
    ('odm_talk_threads'::text),
    ('gantt_links'::text)
),
target_oids AS (
  SELECT format('public.%I', table_name)::regclass AS oid, table_name
  FROM target_tables
  WHERE to_regclass(format('public.%I', table_name)) IS NOT NULL
)
SELECT
  'FK_OUT' AS direction,
  t.table_name AS from_table,
  pg_get_userbyid(cls.relowner) AS from_owner,
  con.conname AS constraint_name,
  pg_get_constraintdef(con.oid) AS definition,
  CASE WHEN con.confrelid IN (SELECT oid FROM target_oids) THEN 'INTERNAL' ELSE 'EXTERNAL' END AS scope
FROM target_oids t
JOIN pg_constraint con ON con.conrelid = t.oid AND con.contype = 'f'
JOIN pg_class cls ON cls.oid = con.conrelid

UNION ALL

SELECT
  'FK_IN' AS direction,
  t.table_name AS to_table,
  pg_get_userbyid(cls.relowner) AS to_owner,
  con.conname AS constraint_name,
  pg_get_constraintdef(con.oid) AS definition,
  CASE WHEN con.conrelid IN (SELECT oid FROM target_oids) THEN 'INTERNAL' ELSE 'EXTERNAL' END AS scope
FROM target_oids t
JOIN pg_constraint con ON con.confrelid = t.oid AND con.contype = 'f'
JOIN pg_class cls ON cls.oid = con.confrelid
ORDER BY direction, from_table, constraint_name;

-- ── Section 3: Views, triggers, functions depending on target tables ──
WITH target_tables(table_name) AS (
  VALUES
    ('odm_talk_notifications'::text),
    ('odm_talk_messages'::text),
    ('odm_talk_threads'::text),
    ('gantt_links'::text)
),
target_oids AS (
  SELECT format('public.%I', table_name)::regclass AS oid, table_name
  FROM target_tables
  WHERE to_regclass(format('public.%I', table_name)) IS NOT NULL
)

SELECT 'VIEW' AS check_type, t.table_name, view_cls.relname AS object_name
FROM target_oids t
JOIN pg_depend dep ON dep.refobjid = t.oid
JOIN pg_rewrite rw ON rw.oid = dep.objid
JOIN pg_class view_cls ON view_cls.oid = rw.ev_class AND view_cls.relkind IN ('v', 'm')

UNION ALL

SELECT 'TRIGGER', t.table_name, trg.tgname
FROM target_oids t
JOIN pg_trigger trg ON trg.tgrelid = t.oid AND NOT trg.tgisinternal

UNION ALL

SELECT 'FUNCTION', t.table_name, proc.proname
FROM target_oids t
JOIN pg_depend dep ON dep.refobjid = t.oid
JOIN pg_proc proc ON proc.oid = dep.objid

ORDER BY check_type, table_name, object_name;
