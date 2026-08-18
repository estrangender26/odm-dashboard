-- Migration 0026: Legacy Gantt table decommission.
--
-- Drops exactly these two legacy-only tables that are no longer required by the
-- application after PR #361 removed the legacy Gantt UI, API routers, engine,
-- and tests:
--   public.gantt_dependencies
--   public.gantt_tasks
--
-- PR #361 decommissioned the legacy Gantt Chart. Primavera Lite uses the
-- normalized tables gantt_projects, gantt_project_events, gantt_wbs_nodes,
-- gantt_activities, gantt_activity_dependencies, gantt_calendars, and
-- gantt_calendar_exceptions. Those tables are intentionally NOT touched here.
--
-- CASCADE is intentionally not used. Plain DROP TABLE (RESTRICT semantics)
-- ensures that any unexpected dependency causes the migration to fail rather
-- than silently destroying dependent objects.
--
-- A read-only preflight must be run before this migration to confirm the
-- expected dependency state. A read-only verification query must be run after
-- to confirm removal. A recovery plan documents restoration from the existing
-- phase2_legacy_gantt_backup schema and from a full-fidelity pg_dump backup.

DROP TABLE public.gantt_dependencies;
DROP TABLE public.gantt_tasks;
