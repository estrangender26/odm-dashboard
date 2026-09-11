-- Verification for migration 0039: Maintenance Planning (Post-PPP) decommission.
--
-- Run this AFTER the migration. Each query documents its expected result.

-- 1. Both tables are gone (no relation, view, matview, or sequence of that name).
--    Expected: 0 rows.
SELECT c.relname, c.relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('tasks', 'equipment');

-- 2. Their sequences are gone too.
--    Expected: 0 rows.
SELECT sequence_name
FROM information_schema.sequences
WHERE sequence_schema = 'public'
  AND sequence_name IN ('tasks_id_seq', 'equipment_id_seq');

-- 3. The retained tables are still present and intact.
--    Expected: all listed tables present.
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'mw_inspections', 'mw_compliance', 'mw_escalations',
    'monthly_kpi_records', 'governance_facilities', 'governance_milestone_state',
    'gantt_projects', 'gantt_activities', 'gantt_wbs_nodes',
    'smp_documents', 'smp_tasks', 'smp_task_applicability',
    'doc_files', 'doc_folders', 'presentation_files',
    'projects_without_ppp', 'project_without_ppp_files',
    'existing_facilities_maintenance', 'users'
  )
ORDER BY tablename;

-- 4. Retained module row counts remain plausible (compare against the
--    pre-migration baseline snapshot; these must be unchanged).
SELECT 'mw_inspections' AS object, count(*)::bigint AS rows FROM public.mw_inspections
UNION ALL SELECT 'monthly_kpi_records', count(*)::bigint FROM public.monthly_kpi_records
UNION ALL SELECT 'governance_facilities', count(*)::bigint FROM public.governance_facilities
UNION ALL SELECT 'gantt_projects', count(*)::bigint FROM public.gantt_projects
UNION ALL SELECT 'gantt_activities', count(*)::bigint FROM public.gantt_activities
UNION ALL SELECT 'smp_documents', count(*)::bigint FROM public.smp_documents
UNION ALL SELECT 'existing_facilities_maintenance', count(*)::bigint FROM public.existing_facilities_maintenance;

-- 5. The SMP applicability FK still targets smp_tasks (shared-name safety).
--    Expected: one row, referencing public.smp_tasks(id).
SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'smp_task_applicability' AND con.contype = 'f';
