# Migration 0023 — Primavera Lite Default Calendar Backfill

## Overview
Safely backfills default calendars (`Mon–Fri, 8h/day, Asia/Manila`) for any existing Primavera Lite projects that are missing a default calendar, and assigns `gantt_projects.default_calendar_id`.
Crucially, **legacy Gantt projects are never modified**.

## Preflight
Run `db/migrations/helpers/0023_primavera_lite_default_calendar_preflight.sql` read-only to inspect the count of Primavera Lite projects missing a default calendar versus legacy Gantt projects.

## Execution & Idempotency
Migration 0023 is fully idempotent and drift-detecting:
1. Validates schema column types using `_mig_check_column`.
2. Backfills only Primavera Lite projects (`EXISTS (SELECT 1 FROM gantt_wbs_nodes WHERE project_id = p.id)`).
3. Re-running migration 0023 on an already backfilled database makes 0 changes.

## Verification
Run `db/migrations/helpers/0023_primavera_lite_default_calendar_verification.sql` to verify that 0 Primavera Lite projects remain without a valid `default_calendar_id`.

## Rollback
See `db/migrations/helpers/0023_primavera_lite_default_calendar_rollback.sql`. Since this migration is purely additive backfill and does not drop or alter schema columns, manual rollback is not required.
