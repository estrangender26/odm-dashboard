-- Rollback for migration 0020_primavera_lite_shell
-- Removes ONLY objects created by PR 1.
-- Does NOT touch PR #328 objects or legacy data.

\echo '=== Migration 0020 rollback ==='

-- Drop new tables (order matters because of FKs)
DROP TABLE IF EXISTS public.gantt_activities;
DROP TABLE IF EXISTS public.gantt_wbs_nodes;

-- Drop new columns from gantt_projects
ALTER TABLE public.gantt_projects DROP COLUMN IF EXISTS admin_token_hash;
ALTER TABLE public.gantt_projects DROP COLUMN IF EXISTS archived_at;

-- Drop index created for new column
DROP INDEX IF EXISTS public.gantt_projects_admin_token_idx;

\echo '=== Rollback complete ==='
