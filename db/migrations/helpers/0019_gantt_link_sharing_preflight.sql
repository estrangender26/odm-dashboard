-- Preflight / dry-run checks for migration 0019_gantt_link_sharing
-- Run this against the target database BEFORE applying the migration.
-- All checks must pass; any failure blocks the migration.

DO $$
DECLARE
  has_uuid BOOLEAN;
  has_pgcrypto BOOLEAN;
  table_exists BOOLEAN;
  public_id_exists BOOLEAN;
  slug_exists BOOLEAN;
  dup_public_id INTEGER;
  dup_slug INTEGER;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'
  ) INTO has_pgcrypto;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'pg_catalog' AND p.proname = 'gen_random_uuid'
  ) INTO has_uuid;

  IF NOT has_pgcrypto AND NOT has_uuid THEN
    RAISE EXCEPTION 'Migration blocked: gen_random_uuid() is not available. Install the pgcrypto extension first.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'gantt_projects'
  ) INTO table_exists;

  IF table_exists THEN
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'gantt_projects' AND column_name = 'public_id'
    ) INTO public_id_exists;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'gantt_projects' AND column_name = 'slug'
    ) INTO slug_exists;

    IF public_id_exists THEN
      SELECT count(*) INTO dup_public_id FROM (
        SELECT public_id FROM gantt_projects WHERE public_id IS NOT NULL
        GROUP BY public_id HAVING count(*) > 1
      ) d;
      IF dup_public_id > 0 THEN
        RAISE EXCEPTION 'Migration blocked: gantt_projects already contains duplicate public_id values (%).', dup_public_id;
      END IF;
    END IF;

    IF slug_exists THEN
      SELECT count(*) INTO dup_slug FROM (
        SELECT slug FROM gantt_projects WHERE slug IS NOT NULL
        GROUP BY slug HAVING count(*) > 1
      ) d;
      IF dup_slug > 0 THEN
        RAISE EXCEPTION 'Migration blocked: gantt_projects already contains duplicate slug values (%).', dup_slug;
      END IF;
    END IF;
  END IF;

  RAISE NOTICE 'Preflight passed: gen_random_uuid() available, no duplicate public_id/slug values.';
END $$;
