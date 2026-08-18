# Migration 0028 — Enable RLS on all remaining public tables

## Scope

Exactly 27 tables:

- `public.equipment`
- `public.governance_facilities`
- `public.upload_rate_limits`
- `public.mw_inspections`
- `public.gantt_project_events`
- `public.smp_documents`
- `public.governance_milestone_state`
- `public.governance_deliverable_status`
- `public.doc_folders`
- `public.lihok_corporate_document_categories`
- `public.lihok_corporate_documents`
- `public.users`
- `public.doc_files`
- `public.lihok_corporate_document_versions`
- `public.tasks`
- `public.monthly_kpi_records`
- `public.lihok_corporate_document_audit`
- `public.presentation_files`
- `public.storage_upload_intents`
- `public.governance_uploads`
- `public.governance_files`
- `public.gantt_calendars`
- `public.gantt_calendar_exceptions`
- `public.gantt_projects`
- `public.gantt_wbs_nodes`
- `public.gantt_activities`
- `public.gantt_activity_dependencies`

## Change

For each table:

1. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
2. `REVOKE ALL PRIVILEGES ON TABLE ... FROM anon, authenticated;`

## What is NOT changed

- No policies are created.
- `FORCE ROW LEVEL SECURITY` remains OFF.
- `postgres`, `service_role`, `PUBLIC`, sequences, ownership, table structure, and data are untouched.

## Rationale

All 27 tables are active and backend-only. The Render application server connects with the `postgres` role, which has `BYPASSRLS`. No browser code queries these tables directly through Supabase/PostgREST. Enabling RLS and removing direct `anon`/`authenticated` privileges remediates the Supabase Security Advisor "RLS disabled in public" findings without affecting runtime behavior.

## Runbook

1. Run `0028_enable_rls_remaining_tables_preflight.sql` in Supabase SQL Editor to confirm pre-state.
2. Deploy migration through normal Render startup path (do not run manually).
3. Run `0028_enable_rls_remaining_tables_verification.sql` after deployment.
4. Keep `0028_enable_rls_remaining_tables_rollback.sql` available for emergency use only.
