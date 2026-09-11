-- Preflight for migration 0039: Maintenance Planning (Post-PPP) decommission.
--
-- Run this BEFORE the migration. Every query must return the expected result
-- documented in the comment above it. Any deviation means the environment does
-- not match the audited production inventory and the migration must not run.

-- 1. The two tables exist and are ordinary tables.
--    Expected: 2 rows, both relkind = 'r'.
SELECT c.relname, c.relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('tasks', 'equipment')
ORDER BY c.relname;

-- 2. Row counts (record these before the drop; they are the numbers the
--    backup must reproduce).
--    Expected at decommission time: tasks = 1376, equipment = 127.
SELECT 'tasks' AS object, count(*)::bigint AS rows FROM public.tasks
UNION ALL
SELECT 'equipment', count(*)::bigint FROM public.equipment;

-- 3. No foreign key in any schema points at, or comes from, these tables.
--    Expected: 0 rows.
SELECT con.conname,
       src_ns.nspname || '.' || src.relname AS source_table,
       tgt_ns.nspname || '.' || tgt.relname AS target_table
FROM pg_constraint con
JOIN pg_class src ON src.oid = con.conrelid
JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
JOIN pg_class tgt ON tgt.oid = con.confrelid
JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt.relnamespace
WHERE con.contype = 'f'
  AND (src.relname IN ('tasks', 'equipment') OR tgt.relname IN ('tasks', 'equipment'));

-- 4. No view or materialized view depends on them.
--    Expected: 0 rows.
SELECT n.nspname || '.' || c.relname AS dependent_view, c.relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_depend d ON d.objid = c.oid
JOIN pg_class t ON t.oid = d.refobjid
WHERE c.relkind IN ('v', 'm')
  AND t.relname IN ('tasks', 'equipment')
  AND t.relnamespace = 'public'::regnamespace;

-- 5. No non-system function body mentions them.
--    Expected: 0 rows.
SELECT n.nspname || '.' || p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND (p.prosrc ~* '\mtasks\M' OR p.prosrc ~* '\mequipment\M');

-- 6. No triggers on them.
--    Expected: 0 rows.
SELECT c.relname AS tbl, t.tgname
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('tasks', 'equipment')
  AND NOT t.tgisinternal;

-- 7. Sequences owned by these tables (dropped together with the tables).
--    Expected: equipment_id_seq, tasks_id_seq.
SELECT seq_ns.nspname || '.' || seq.relname AS owned_sequence
FROM pg_class seq
JOIN pg_namespace seq_ns ON seq_ns.oid = seq.relnamespace
JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a', 'i')
JOIN pg_class tbl ON tbl.oid = d.refobjid
JOIN pg_namespace tbl_ns ON tbl_ns.oid = tbl.relnamespace
WHERE seq.relkind = 'S'
  AND tbl_ns.nspname = 'public'
  AND tbl.relname IN ('tasks', 'equipment');

-- 8. Shared-name check: smp_task_applicability.task_id must point at smp_tasks.
--    Expected: confrelid = public.smp_tasks (this is why public.tasks is safe
--    to drop: the SMP module owns its own task table).
SELECT con.conname,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'smp_task_applicability' AND con.contype = 'f';
