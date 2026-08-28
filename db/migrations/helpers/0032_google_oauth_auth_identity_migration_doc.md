# Migration 0032 — Google OAuth auth identity

Replaces Kimi-based interactive authentication with Google OAuth (OpenID
Connect) for OWNER/admin access while keeping the public Projects without PPP
workflow login-free.

## What it does (additive, idempotent, no destructive SQL)

- Adds `users.auth_provider varchar(32)` (e.g. `'google'`)
- Adds `users.auth_subject varchar(255)` (Google immutable `sub`)
- Creates partial unique index `users_auth_provider_subject_idx` on
  `(auth_provider, auth_subject) WHERE auth_provider IS NOT NULL AND
  auth_subject IS NOT NULL`

## Why not drop `union_id`

The production OWNER row (role=admin) still carries its legacy Kimi `union_id`.
The first Google OWNER login reconciles that row in place (matching
role=admin + NULL provider columns) and stamps `auth_provider`/`auth_subject`
onto it — no duplicate account, no admin loss. `union_id` stays as a legacy
fingerprint and can be dropped only in a later, separately-approved migration.

## OWNER identity authority

The immutable Google `sub` (persisted in `auth_subject`) is the ongoing
authorization authority. Server-side only: the verified id_token `sub` is
compared in `upsertUserByProvider`; a non-OWNER Google account always receives
`role=user`; the frontend cannot influence role assignment. `adminQuery`
remains the enforcement boundary.

First-login bootstrap (no `sub` knowledge required before login):

- If `OWNER_GOOGLE_SUB` is configured, it is the sole first-login authority.
- If `OWNER_GOOGLE_SUB` is NOT configured, `OWNER_GOOGLE_EMAIL` (a verified
  `email_verified === true` id_token email that exactly matches) bootstraps
  the OWNER: the single legacy role=admin row is reconciled in place with the
  verified `sub`. Ambiguity (multiple legacy admin rows) or an accidental
  pre-bootstrap ordinary Google row fails closed — nothing is merged or
  deleted automatically. After reconciliation the persisted (google, sub) row
  is the identity; email is not the ongoing boundary.

## Session

Cookie renamed `kimi_sid` → `odm_sid` (provider-neutral). Existing Kimi
sessions are intentionally invalidated. httpOnly/Secure/SameSite/signature
behavior unchanged.

## Rollout

Applied automatically by the startup migrator on the next deploy after merge
(`RUN_DB_MIGRATIONS_ON_STARTUP`). No manual production migration required.
