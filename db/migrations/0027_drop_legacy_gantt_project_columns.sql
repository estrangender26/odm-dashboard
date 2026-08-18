-- Migration 0027: Remove legacy-only columns from public.gantt_projects.
--
-- These columns were used by the legacy Gantt Chart implementation that was
-- removed in PR #361. Primavera Lite and all other active modules do not read
-- or write these columns.
--
-- Columns removed:
--   session_id
--   user_id
--   tasks_data
--   links_data
--   created_by
--   updated_by
--
-- Columns preserved (active Primavera Lite / shared use):
--   id, name, project_name, description, status, start_date, finish_date,
--   revision, slug, public_id, owner_id, tenant_id, org_id,
--   admin_token_hash, edit_token_hash, view_token_hash, sharing_enabled,
--   data_date, default_calendar_id, archived_at, created_at, updated_at,
--   and any other columns defined in db/schema.ts.
--
-- The legacy indexes gantt_projects_session_idx and gantt_projects_user_idx
-- disappear automatically when their columns are dropped.
--
-- CASCADE is intentionally not used. Plain ALTER TABLE ... DROP COLUMN ensures
-- any unexpected dependency causes the migration to fail rather than silently
-- cascading.

ALTER TABLE public.gantt_projects
  DROP COLUMN session_id,
  DROP COLUMN user_id,
  DROP COLUMN tasks_data,
  DROP COLUMN links_data,
  DROP COLUMN created_by,
  DROP COLUMN updated_by;
