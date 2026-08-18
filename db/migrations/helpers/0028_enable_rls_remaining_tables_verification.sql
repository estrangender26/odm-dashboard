-- Verification for migration 0028: read-only confirmation after enabling RLS.
--
-- Confirms the expected post-migration state for all 27 target tables.
-- Safe to run in production; performs no mutations.

WITH target_tables AS (
  SELECT unnest(ARRAY[
    'equipment','governance_facilities','upload_rate_limits','mw_inspections','gantt_project_events',
    'smp_documents','governance_milestone_state','governance_deliverable_status','doc_folders',
    'lihok_corporate_document_categories','lihok_corporate_documents','users','doc_files',
    'lihok_corporate_document_versions','tasks','monthly_kpi_records','lihok_corporate_document_audit',
    'presentation_files','storage_upload_intents','governance_uploads','governance_files',
    'gantt_calendars','gantt_calendar_exceptions','gantt_projects','gantt_wbs_nodes','gantt_activities',
    'gantt_activity_dependencies'
  ]) AS table_name
)
SELECT
  t.table_name,
  c.relname IS NOT NULL AS table_exists,
  COALESCE(c.relrowsecurity, false) AS rls_enabled,
  COALESCE(c.relforcerowsecurity, false) AS force_rls,
  pg_get_userbyid(c.relowner) AS owner,
  (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.table_name) AS policy_count
FROM target_tables t
LEFT JOIN pg_class c ON c.relname = t.table_name
LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
ORDER BY t.table_name;

-- Verify no policies exist on target tables.
SELECT count(*) AS target_table_policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'equipment','governance_facilities','upload_rate_limits','mw_inspections','gantt_project_events',
    'smp_documents','governance_milestone_state','governance_deliverable_status','doc_folders',
    'lihok_corporate_document_categories','lihok_corporate_documents','users','doc_files',
    'lihok_corporate_document_versions','tasks','monthly_kpi_records','lihok_corporate_document_audit',
    'presentation_files','storage_upload_intents','governance_uploads','governance_files',
    'gantt_calendars','gantt_calendar_exceptions','gantt_projects','gantt_wbs_nodes','gantt_activities',
    'gantt_activity_dependencies'
  );

-- Verify anon/authenticated have no privileges on target tables.
WITH target_tables AS (
  SELECT unnest(ARRAY[
    'equipment','governance_facilities','upload_rate_limits','mw_inspections','gantt_project_events',
    'smp_documents','governance_milestone_state','governance_deliverable_status','doc_folders',
    'lihok_corporate_document_categories','lihok_corporate_documents','users','doc_files',
    'lihok_corporate_document_versions','tasks','monthly_kpi_records','lihok_corporate_document_audit',
    'presentation_files','storage_upload_intents','governance_uploads','governance_files',
    'gantt_calendars','gantt_calendar_exceptions','gantt_projects','gantt_wbs_nodes','gantt_activities',
    'gantt_activity_dependencies'
  ]) AS table_name
)
SELECT
  t.table_name,
  grantee,
  string_agg(privilege_type, ', ' ORDER BY privilege_type) AS remaining_privileges
FROM target_tables t
JOIN information_schema.table_privileges p
  ON p.table_schema = 'public' AND p.table_name = t.table_name
WHERE p.grantee IN ('anon','authenticated')
GROUP BY t.table_name, grantee
ORDER BY t.table_name, grantee;

-- Confirm protected roles are unchanged.
SELECT rolname, rolbypassrls, rolsuper
FROM pg_roles
WHERE rolname IN ('anon','authenticated','service_role','postgres','supabase_admin')
ORDER BY rolname;
