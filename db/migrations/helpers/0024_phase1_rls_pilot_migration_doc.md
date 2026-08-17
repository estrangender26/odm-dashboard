# Migration 0024 — Phase 1 RLS pilot

## Scope

This migration is the Phase 1 pilot for exactly these approved tables:

- `public.existing_facilities_maintenance`
- `public.mw_compliance`
- `public.mw_escalations`

ODM-Talk tables and every other active table are outside this migration.

## Operating model

The pilot is intentionally backend-only. Render connects through the PostgreSQL
connection as `postgres`, whose `BYPASSRLS` attribute is already true. The
migration does not alter `postgres` or `service_role`, and it does not enable
`FORCE ROW LEVEL SECURITY`. The browser is not intended to use Supabase Data API
table CRUD for these tables.

No RLS policies are created by design. Table privileges are revoked from both
`anon` and `authenticated`, which denies their direct table access. `TRUNCATE`
and `REFERENCES` are included in the revocation because RLS does not govern
those privileges. Sequences are unchanged.

## Dry-run preflight

Run the read-only preflight first:

`0024_phase1_rls_pilot_preflight.sql`

It should confirm the live baseline: owner `postgres`, RLS disabled, FORCE RLS
disabled, zero policies, and all seven confirmed table privileges for both
`anon` and `authenticated`.

This repository task does not execute the preflight or migration against
production.

## Forward migration

The forward file:

1. Enables RLS on the three approved tables.
2. Creates no policies.
3. Revokes all table privileges from `anon` and `authenticated` on only those
   three tables.
4. Leaves FORCE RLS off, roles unchanged, PUBLIC unchanged, and sequences
   unchanged.

Afterward, run the read-only verification query:

`0024_phase1_rls_pilot_verification.sql`

## Exact rollback SQL

The rollback restores all seven confirmed privileges to both roles, then
disables RLS:

```sql
BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.existing_facilities_maintenance
  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.mw_compliance
  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.mw_escalations
  TO anon, authenticated;

ALTER TABLE public.existing_facilities_maintenance DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.mw_compliance DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.mw_escalations DISABLE ROW LEVEL SECURITY;

COMMIT;
```

The canonical rollback file is:

`0024_phase1_rls_pilot_rollback.sql`
