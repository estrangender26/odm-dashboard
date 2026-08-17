-- Migration 0025: Phase 1B table decommission.
--
-- Drops exactly these four tables that are no longer required by the application:
--   public.odm_talk_notifications
--   public.odm_talk_messages
--   public.odm_talk_threads
--   public.gantt_links
--
-- The ODM-Talk application module was intentionally removed previously. The three
-- ODM-Talk tables remain live but have zero runtime references in the current
-- codebase. gantt_links is absent from the repository schema, all migration SQL,
-- all Drizzle snapshots, and all runtime code. The current Gantt/Primavera
-- dependency model uses gantt_dependencies and gantt_activity_dependencies.
--
-- Drop order respects the internal FK graph among ODM-Talk tables:
--   odm_talk_notifications references odm_talk_messages and odm_talk_threads
--   odm_talk_messages references odm_talk_threads
--   gantt_links has no dependencies
--
-- CASCADE is intentionally not used. Plain DROP TABLE (equivalent to RESTRICT)
-- ensures that any unexpected dependency causes the migration to fail rather
-- than silently destroying dependent objects.
--
-- A preflight query must be run before this migration to confirm the expected
-- dependency state. A verification query must be run after to confirm removal.
-- A recovery plan documents backup and restoration procedures.

DROP TABLE public.odm_talk_notifications;
DROP TABLE public.odm_talk_messages;
DROP TABLE public.odm_talk_threads;
DROP TABLE public.gantt_links;
