-- Migration 0036_primavera_activity_id_unique
-- F-03: active non-null Activity IDs must be unique per project.
--
-- Forward-safe and idempotent. The implementation phase MUST run the read-only
-- preflight (blank-string IDs, post-normalization duplicates, exact duplicates)
-- and normalize blank-string activity_id values to NULL BEFORE this migration is
-- applied. The partial unique index only constrains active, non-null rows, so
-- multiple unassigned (NULL) Activity IDs remain valid and archived rows do not
-- reserve identifiers.

CREATE UNIQUE INDEX IF NOT EXISTS gantt_activities_active_project_id_unique
  ON public.gantt_activities (project_id, activity_id)
  WHERE archived_at IS NULL AND activity_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'gantt_activities'
      AND indexname = 'gantt_activities_active_project_id_unique'
  ) THEN
    RAISE EXCEPTION 'gantt_activities_active_project_id_unique was not created';
  END IF;
END $$;
