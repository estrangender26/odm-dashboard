-- Rollback for migration 0036_primavera_activity_id_unique (F-03).
-- Drops the partial unique index. Idempotent; safe to run when absent.
DROP INDEX IF EXISTS gantt_activities_active_project_id_unique;
