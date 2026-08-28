-- 0032 Google OAuth auth identity — preflight checks.
-- Fails loudly if the users table is missing (the migration would fail too).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    RAISE EXCEPTION 'preflight failed: public.users table does not exist';
  END IF;
END $$;
