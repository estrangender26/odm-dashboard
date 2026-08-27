-- Migration 0032: Google OAuth provider identity for users
--
-- Retires Kimi-based authentication in favor of Google OAuth for OWNER/admin
-- access. This migration addsitively introduces provider-neutral identity
-- columns on the existing `users` table:
--   * auth_provider  — OAuth provider name (e.g. 'google')
--   * auth_subject   — immutable provider subject (Google `sub`)
--
-- The existing union_id column is intentionally NOT dropped: it holds the
-- legacy Kimi union ID of the existing production OWNER row and is used as a
-- fingerprint during first-login reconciliation so the OWNER account is
-- updated in place rather than duplicated. It may be dropped in a later,
-- separately-approved migration.
--
-- Every statement is idempotent (IF NOT EXISTS) and additive. The unique
-- index is partial (provider/subject both NOT NULL) so legacy rows with NULL
-- identity columns remain valid and multiple legacy rows cannot collide.
-- No DROP statements are included; no destructive SQL.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_provider varchar(32);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_subject varchar(255);

CREATE UNIQUE INDEX IF NOT EXISTS users_auth_provider_subject_idx
  ON public.users (auth_provider, auth_subject)
  WHERE auth_provider IS NOT NULL AND auth_subject IS NOT NULL;
