-- Migration 0026 preflight: read-only dry-run checks for legacy Gantt table drop.
-- Run this BEFORE the forward migration. It performs no writes.
--
-- Checks:
--   1. Both target tables exist.
--   2. Owner is postgres for each.
--   3. Row counts (no row content exposed).
--   4. No FK constraints inbound or outbound.
--   5. No views, materialized views, triggers, or function dependencies.
--   6. Expected SERIAL sequences/defaults.
--
-- If any check fails, do NOT proceed with the forward migration.

-- 1. Table existence, owner, RLS state, row count, policies
WITH target_tables(table_name) AS (
  VALUES ('gantt_dependencies'::text), ('gantt_tasks'::text)
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

-- 2. Exact row counts (safe aggregate only)
SELECT 'gantt_dependencies' AS table_name, COUNT(*) AS exact_rows FROM public.gantt_dependencies
UNION ALL
SELECT 'gantt_tasks', COUNT(*) FROM public.gantt_tasks;

-- 3. FK constraints (must be none)
WITH target_tables(table_name) AS (
  VALUES ('gantt_dependencies'::text), ('gantt_tasks'::text)
),
target_oids AS (
  SELECT format('public.%I', table_name)::regclass AS oid, table_name
  FROM target_tables
  WHERE to_regclass(format('public.%I', table_name)) IS NOT NULL
)
SELECT
  'FK_OUT' AS direction,
  t.table_name AS from_table,
  con.conname AS constraint_name,
  pg_get_constraintdef(con.oid) AS definition
FROM target_oids t
JOIN pg_constraint con ON con.conrelid = t.oid AND con.contype = 'f'
UNION ALL
SELECT
  'FK_IN' AS direction,
  t.table_name AS to_table,
  con.conname AS constraint_name,
  pg_get_constraintdef(con.oid) AS definition
FROM target_oids t
JOIN pg_constraint con ON con.confrelid = t.oid AND con.contype = 'f'
ORDER BY direction, from_table, constraint_name;

-- 4. Views, triggers, functions depending on target tables
WITH target_tables(table_name) AS (
  VALUES ('gantt_dependencies'::text), ('gantt_tasks'::text)
),
target_oids AS (
  SELECT format('public.%I', table_name)::regclass AS oid, table_name
  FROM target_tables
  WHERE to_regclass(format('public.%I', table_name)) IS NOT NULL
)
SELECT 'VIEW/MATVIEW' AS check_type, t.table_name, view_cls.relname AS object_name
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

-- 5. Serial/default/sequence dependencies
WITH target_tables(table_name) AS (
  VALUES ('gantt_dependencies'::text), ('gantt_tasks'::text)
)
SELECT
  t.table_name,
  col.attname AS column_name,
  pg_get_expr(col.atthasdef, col.attrelid) AS default_expression,
  seq_cls.relname AS sequence_name
FROM target_tables t
JOIN pg_class cls ON cls.oid = format('public.%I', t.table_name)::regclass
JOIN pg_attribute col ON col.attrelid = cls.oid AND col.attnum > 0 AND NOT col.attisdropped
LEFT JOIN pg_attrdef ad ON ad.adrelid = col.attrelid AND ad.adnum = col.attnum
LEFT JOIN pg_depend dep ON dep.objid = ad.oid AND dep.classid = 'pg_attrdef'::regclass
LEFT JOIN pg_class seq_cls ON seq_cls.oid = dep.refobjid AND seq_cls.relkind = 'S'
ORDER BY t.table_name, col.attnum;
