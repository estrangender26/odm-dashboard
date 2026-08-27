-- Preflight for 0031_projects_without_ppp_submittal_monitoring
-- Safe read-only checks that must pass before applying the migration.
-- Run against the target database BEFORE `npm run db:migrate`.

-- 1. Target tables must either not exist (fresh) or exist with the inert
--    PR #389 shape (production). Both conditions are acceptable; report what
--    is actually present so the operator can confirm intent.
SELECT table_name, EXISTS (
  SELECT 1 FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = t.table_name AND c.column_name = 'project_name'
) AS has_project_name
FROM information_schema.tables t
WHERE t.table_schema = 'public' AND t.table_name IN ('projects_without_ppp', 'project_without_ppp_files')
ORDER BY table_name;

-- 2. Drizzle ledger position: the new entry (when = 1791312000014) must be
--    newer than the largest applied created_at so it is NOT skipped.
SELECT COALESCE(MAX(created_at), 0)::bigint AS max_ledger_created_at
FROM drizzle.__drizzle_migrations;

-- 3. No destructive statements are part of this migration.
--    (Manual confirmation: 0031 contains only CREATE ... IF NOT EXISTS and
--    ALTER TABLE ... ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.)
SELECT 'preflight-ok' AS status;
