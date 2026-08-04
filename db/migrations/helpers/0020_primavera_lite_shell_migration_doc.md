# Migration 0020 — Primavera Lite Shell

## Scope

Additive migration that creates the minimal normalized schema for ODM Primavera Lite Online (PR 1).

## Objects created

- `gantt_projects.admin_token_hash` (varchar(64))
- `gantt_projects.archived_at` (timestamptz)
- `gantt_wbs_nodes` table
- `gantt_activities` table
- Supporting indexes and foreign keys with `ON DELETE RESTRICT`

## Objects not modified

- Existing `gantt_projects` columns (`start_date`, `finish_date`, `data_date`, `last_scheduled_at`, `created_at`, `updated_at`)
- `tasks_data` and `links_data` columns
- `gantt_tasks` and `gantt_dependencies` legacy tables
- `gantt_project_events`, `gantt_calendars`, `gantt_calendar_exceptions`
- Existing foreign-key `ON DELETE` behavior

## Procedure

1. Run `0020_primavera_lite_shell_preflight.sql`.
2. Take a database backup.
3. Apply `db/migrations/0020_primavera_lite_shell.sql` (forward migration).
4. Run `0020_primavera_lite_shell_verification.sql`.
5. If rollback is needed, run `0020_primavera_lite_shell_rollback.sql`.

## Safety

This migration is strictly additive. No existing data is converted, renamed, or deleted.
