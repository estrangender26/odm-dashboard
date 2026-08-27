-- Verification for 0031_projects_without_ppp_submittal_monitoring
-- Run AFTER `npm run db:migrate`. Every query must return the expected rows.

-- 1. New reference column present on projects_without_ppp.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'projects_without_ppp'
  AND column_name IN ('project_name', 'tracking_id', 'ps_code', 'project_phase');

-- 2. Submission-evidence columns present on project_without_ppp_files.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'project_without_ppp_files'
  AND column_name IN ('submitted_at', 'superseded_at', 'project_id', 'file_name');

-- 3. Indexes created.
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('pwp_tracking_id_idx', 'pwp_ps_code_idx', 'pwp_phase_idx',
                    'pwp_tag_idx', 'pwp_files_project_idx', 'pwp_files_current_idx')
ORDER BY indexname;

-- 4. The new journal entry is recorded exactly once (when = 1791312000014).
SELECT created_at, COUNT(*)::int AS occurrences
FROM drizzle.__drizzle_migrations
WHERE created_at = 1791312000014
GROUP BY created_at;

-- 5. No submission/file history can be destroyed by the migration (tables are
--    only created/evolved, never dropped). Confirm the tables still exist.
SELECT to_regclass('public.projects_without_ppp') AS projects_table,
       to_regclass('public.project_without_ppp_files') AS files_table;
