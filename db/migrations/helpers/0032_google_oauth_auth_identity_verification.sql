-- 0032 Google OAuth auth identity — verification.
-- Confirms both additive columns and the partial unique index exist.

SELECT
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name IN ('auth_provider', 'auth_subject')) AS identity_columns,
  (SELECT COUNT(*) FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'users'
      AND indexname = 'users_auth_provider_subject_idx') AS unique_index;
