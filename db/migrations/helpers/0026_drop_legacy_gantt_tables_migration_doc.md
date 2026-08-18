# Migration 0026 — Drop Legacy Gantt Tables

## Scope

This migration drops exactly two tables:

- `public.gantt_dependencies`
- `public.gantt_tasks`

## Rationale

The legacy Gantt Chart UI, API routers, engine, and tests were removed in PR #361. These two tables are no longer referenced by any runtime code. Primavera Lite and all active modules use the normalized Gantt schema (`gantt_projects`, `gantt_project_events`, `gantt_wbs_nodes`, `gantt_activities`, `gantt_activity_dependencies`, `gantt_calendars`, `gantt_calendar_exceptions`), which are intentionally not touched.

## Safety

- **No CASCADE**: plain `DROP TABLE` uses RESTRICT semantics, so unexpected dependencies cause failure instead of silent destruction.
- **Preflight required**: run `0026_drop_legacy_gantt_tables_preflight.sql` before the migration.
- **Verification required**: run `0026_drop_legacy_gantt_tables_verification.sql` after the migration.
- **Backup required**: a server-side backup schema `phase2_legacy_gantt_backup` already exists in production, and a full-fidelity `pg_dump` should be taken before deployment.

## Drop order

`gantt_dependencies` is dropped before `gantt_tasks`. Both tables have no FK constraints between them or to other tables (confirmed by preflight), so order is primarily conventional.

## Recovery

See `0026_drop_legacy_gantt_tables_recovery.md` for restoration procedures using the existing `phase2_legacy_gantt_backup` schema or a full-fidelity `pg_dump` backup.
