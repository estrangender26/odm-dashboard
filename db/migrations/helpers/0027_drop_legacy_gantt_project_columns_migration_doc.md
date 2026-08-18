# Migration 0027 — Drop Legacy Columns from `public.gantt_projects`

## Scope

Removes exactly these six legacy-only columns from `public.gantt_projects`:

- `session_id`
- `user_id`
- `tasks_data`
- `links_data`
- `created_by`
- `updated_by`

## Rationale

These columns were used by the legacy Gantt Chart implementation removed in PR #361. Primavera Lite and all other active modules do not read or write them.

## Protected Columns

All other `gantt_projects` columns remain, including active Primavera Lite columns such as:

- `id`, `name`, `project_name`, `description`, `status`
- `start_date`, `finish_date`, `data_date`
- `revision`, `slug`, `public_id`
- `owner_id`, `tenant_id`, `org_id`
- `admin_token_hash`, `edit_token_hash`, `view_token_hash`
- `sharing_enabled`, `default_calendar_id`
- `archived_at`, `created_at`, `updated_at`

## Safety

- **No CASCADE**: plain `ALTER TABLE ... DROP COLUMN` uses RESTRICT semantics, so unexpected dependencies cause failure.
- The legacy indexes `gantt_projects_session_idx` and `gantt_projects_user_idx` are dropped automatically with their columns.
- **Preflight required**: run `0027_drop_legacy_gantt_project_columns_preflight.sql` before the migration.
- **Verification required**: run `0027_drop_legacy_gantt_project_columns_verification.sql` after the migration.
- **Backup required**: production already has `phase2_legacy_gantt_backup.gantt_projects_legacy_columns`. Do not delete it.

## Recovery

See `0027_drop_legacy_gantt_project_columns_recovery.md` for restoration procedures using the existing `phase2_legacy_gantt_backup.gantt_projects_legacy_columns` table.
