# Migration 0025 — Phase 1B Table Decommission

## Scope

This migration drops exactly four tables that are no longer required by the
application:

- `public.odm_talk_notifications`
- `public.odm_talk_messages`
- `public.odm_talk_threads`
- `public.gantt_links`

No other tables, views, sequences, functions, or objects are affected.

## Background

The ODM-Talk application module was intentionally removed from the codebase
previously. Its three database tables (`odm_talk_threads`, `odm_talk_messages`,
`odm_talk_notifications`) remain in the live database but have:

- Zero runtime references in any route, service, or component
- Zero schema definitions in `db/schema.ts`
- Zero migration SQL creating them (created outside the tracked migration history)

`gantt_links` is a table that:

- Has zero references in the entire repository
- Is absent from all Drizzle migration snapshots
- Is not used by the current Gantt/Primavera dependency model
  (which uses `gantt_dependencies` and `gantt_activity_dependencies`)

## Drop Order

The ODM-Talk tables have internal foreign key constraints:

```
odm_talk_notifications.message_id -> odm_talk_messages.id
odm_talk_notifications.thread_id -> odm_talk_threads.id
odm_talk_messages.thread_id      -> odm_talk_threads.id
```

To respect FK ordering without CASCADE:

1. `odm_talk_notifications` (references both others)
2. `odm_talk_messages` (references threads)
3. `odm_talk_threads` (root — no outgoing FKs)
4. `gantt_links` (no dependencies)

## No CASCADE

Plain `DROP TABLE` (equivalent to `DROP TABLE ... RESTRICT`) is used
intentionally. If an unexpected dependency exists, the migration will fail
rather than silently destroying dependent objects.

## Dry-Run Preflight

Run the read-only preflight first:

`0025_phase1b_decommission_preflight.sql`

It must confirm:

- All 4 tables exist with owner = `postgres`
- Only the expected 3 internal ODM-Talk FKs exist
- No external FKs reference any of the 4 tables
- No views, materialized views, triggers, or function dependencies exist

If any check fails, do NOT proceed.

## Verification

After the forward migration, run:

`0025_phase1b_decommission_verification.sql`

All 4 tables should show `table_exists = false`. No orphaned FK constraints
should remain.

## Recovery Plan

See: `0025_phase1b_decommission_recovery.md`

This repository does not include production data. A `DROP TABLE` is destructive
and cannot be undone by a simple rollback SQL. The recovery document describes
how to back up and restore these tables if needed.

## Production Execution Checklist

1. ☐ Run read-only preflight — confirm expected state
2. ☐ Execute `pg_dump` backup of the 4 tables
3. ☐ Run forward migration SQL
4. ☐ Run read-only verification — confirm tables dropped
5. ☐ Smoke-test application (homepage, O&M, MW, Governance, Gantt, Primavera Lite)
6. ☐ If any issue: restore from backup per recovery plan
