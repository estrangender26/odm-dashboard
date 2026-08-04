-- Executable rollback for migration 0019_gantt_link_sharing
-- Reverses only the additive schema changes. DATA added to new tables
-- (gantt_project_events, gantt_calendars, gantt_calendar_exceptions) will be lost.

DROP TABLE IF EXISTS gantt_calendar_exceptions;
DROP TABLE IF EXISTS gantt_calendars;
DROP TABLE IF EXISTS gantt_project_events;

ALTER TABLE gantt_tasks
  DROP COLUMN IF EXISTS revision,
  DROP COLUMN IF EXISTS updated_by_name;

ALTER TABLE gantt_dependencies
  DROP COLUMN IF EXISTS revision,
  DROP COLUMN IF EXISTS updated_by_name;

ALTER TABLE gantt_projects
  DROP COLUMN IF EXISTS public_id,
  DROP COLUMN IF EXISTS slug,
  DROP COLUMN IF EXISTS edit_token_hash,
  DROP COLUMN IF EXISTS view_token_hash,
  DROP COLUMN IF EXISTS revision,
  DROP COLUMN IF EXISTS data_date,
  DROP COLUMN IF EXISTS default_calendar_id,
  DROP COLUMN IF EXISTS sharing_enabled,
  DROP COLUMN IF EXISTS last_scheduled_at;

DROP INDEX IF EXISTS gantt_projects_public_id_idx;
DROP INDEX IF EXISTS gantt_projects_slug_idx;
DROP INDEX IF EXISTS gantt_projects_edit_token_idx;
DROP INDEX IF EXISTS gantt_projects_view_token_idx;
DROP INDEX IF EXISTS gantt_calendars_project_idx;
DROP INDEX IF EXISTS gantt_calendar_exceptions_calendar_idx;
