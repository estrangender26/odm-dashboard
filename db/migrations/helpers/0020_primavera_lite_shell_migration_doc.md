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

## Deployment prerequisite

Before deploying the application that includes this migration, set the environment
variable `PRIMAVERA_LITE_PREVIEW_SECRET` to a cryptographically random string of at
least 32 bytes encoded as hex. Example generation:

```bash
openssl rand -hex 32
```

The production startup preflight (`api/boot.ts`) calls
`assertPreviewSecretConfigured()`. If the secret is missing in a production or
Render environment, the server refuses to start and exits with code 1, so the
deployment fails before serving traffic.

For local development and tests, a deterministic test-only fallback is used. The
fallback is **never** used when `NODE_ENV=production` or `RENDER=true`.
