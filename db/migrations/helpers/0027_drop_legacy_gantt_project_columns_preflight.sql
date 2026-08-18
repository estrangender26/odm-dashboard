-- Migration 0027 preflight: read-only dry-run checks for legacy gantt_projects columns.
-- Run this BEFORE the forward migration. It performs no writes.
--
-- Confirms:
--   1. Each legacy column exists with expected type/default/nullability.
--   2. Expected indexes exist.
--   3. No FK/constraint/view/function dependencies.
--   4. Protected Primavera columns remain.

-- 1. Legacy column catalog
WITH legacy_columns(column_name) AS (
  VALUES
    ('session_id'::text),
    ('user_id'::text),
    ('tasks_data'::text),
    ('links_data'::text),
    ('created_by'::text),
    ('updated_by'::text)
)
SELECT
  lc.column_name,
  col.udt_name::text AS data_type,
  CASE WHEN col.is_nullable = 'YES' THEN true ELSE false END AS is_nullable,
  col.column_default AS default_expression,
  (
    SELECT COUNT(*)
    FROM public.gantt_projects gp
    WHERE (CASE lc.column_name
      WHEN 'session_id' THEN gp.session_id
      WHEN 'user_id' THEN gp.user_id::text
      WHEN 'tasks_data' THEN gp.tasks_data
      WHEN 'links_data' THEN gp.links_data
      WHEN 'created_by' THEN gp.created_by
      WHEN 'updated_by' THEN gp.updated_by
    END) IS NOT NULL
  ) AS non_null_rows
FROM legacy_columns lc
JOIN information_schema.columns col
  ON col.table_schema = 'public'
 AND col.table_name = 'gantt_projects'
 AND col.column_name = lc.column_name
ORDER BY lc.column_name;

-- 2. Indexes touching legacy columns
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'gantt_projects'
  AND indexdef ILIKE ANY (ARRAY[
    '%session_id%',
    '%user_id%',
    '%tasks_data%',
    '%links_data%',
    '%created_by%',
    '%updated_by%'
  ]);

-- 3. Constraints/FKs touching legacy columns
SELECT con.conname AS constraint_name, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
WHERE con.conrelid = 'public.gantt_projects'::regclass
  AND pg_get_constraintdef(con.oid) ILIKE ANY (ARRAY[
    '%session_id%', '%user_id%', '%tasks_data%', '%links_data%', '%created_by%', '%updated_by%'
  ]);

-- 4. Views/functions depending on legacy columns
WITH legacy_columns(column_name) AS (
  VALUES ('session_id'::text), ('user_id'::text), ('tasks_data'::text),
         ('links_data'::text), ('created_by'::text), ('updated_by'::text)
)
SELECT 'VIEW/MATVIEW' AS check_type, lc.column_name, view_cls.relname AS object_name
FROM legacy_columns lc
JOIN pg_attribute col ON col.attrelid = 'public.gantt_projects'::regclass AND col.attname = lc.column_name
JOIN pg_depend dep ON dep.refobjid = col.attrelid AND dep.refobjsubid = col.attnum
JOIN pg_rewrite rw ON rw.oid = dep.objid
JOIN pg_class view_cls ON view_cls.oid = rw.ev_class AND view_cls.relkind IN ('v', 'm')
UNION ALL
SELECT 'FUNCTION', lc.column_name, proc.proname
FROM legacy_columns lc
JOIN pg_attribute col ON col.attrelid = 'public.gantt_projects'::regclass AND col.attname = lc.column_name
JOIN pg_depend dep ON dep.refobjid = col.attrelid AND dep.refobjsubid = col.attnum
JOIN pg_proc proc ON proc.oid = dep.objid
ORDER BY check_type, column_name, object_name;

-- 5. Protected active columns must still exist
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
