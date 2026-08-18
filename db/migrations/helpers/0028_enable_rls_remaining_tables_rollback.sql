-- Emergency rollback for migration 0028.
--
-- Reverses ONLY the changes made by migration 0028:
--   1. Restores original anon/authenticated table privileges
--   2. DISABLE ROW LEVEL SECURITY on the 27 target tables
--
-- Does NOT modify postgres, service_role, PUBLIC, sequences, ownership, or data.
-- Run only if the migration causes unexpected access issues.

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.equipment TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.governance_facilities TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.upload_rate_limits TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.mw_inspections TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.gantt_project_events TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.smp_documents TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.governance_milestone_state TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.governance_deliverable_status TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.doc_folders TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.lihok_corporate_document_categories TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.lihok_corporate_documents TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.users TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.doc_files TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.lihok_corporate_document_versions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.tasks TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.monthly_kpi_records TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.lihok_corporate_document_audit TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.presentation_files TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.storage_upload_intents TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.governance_uploads TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.governance_files TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.gantt_calendars TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.gantt_calendar_exceptions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.gantt_projects TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.gantt_wbs_nodes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.gantt_activities TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.gantt_activity_dependencies TO anon, authenticated;

ALTER TABLE public.equipment DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_facilities DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_rate_limits DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.mw_inspections DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_project_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.smp_documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_milestone_state DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_deliverable_status DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.doc_folders DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lihok_corporate_document_categories DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lihok_corporate_documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.doc_files DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lihok_corporate_document_versions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_kpi_records DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.lihok_corporate_document_audit DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.presentation_files DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_upload_intents DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_uploads DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_files DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_calendars DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_calendar_exceptions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_wbs_nodes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_activities DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_activity_dependencies DISABLE ROW LEVEL SECURITY;
