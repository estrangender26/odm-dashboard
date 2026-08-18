-- Migration 0028: Enable Row Level Security on all remaining RLS-disabled tables.
--
-- Remediates the 27 remaining Supabase Security Advisor "RLS disabled in public"
-- findings. Every audited table is active, backend-only, and accessed through the
-- Render backend's postgres role (which has BYPASSRLS).
--
-- Scope: exactly the 27 tables listed below. No other tables, roles, policies,
-- sequences, or ownership are modified.
--
-- Changes per table:
--   1. ENABLE ROW LEVEL SECURITY
--   2. REVOKE ALL PRIVILEGES from anon and authenticated
--
-- Explicitly NOT changed:
--   - postgres role
--   - service_role
--   - PUBLIC
--   - sequences / defaults
--   - table structure or data
--   - no policies are created
--   - FORCE ROW LEVEL SECURITY remains OFF

ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mw_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_project_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smp_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_milestone_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_deliverable_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doc_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lihok_corporate_document_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lihok_corporate_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doc_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lihok_corporate_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_kpi_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lihok_corporate_document_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presentation_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_upload_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_calendar_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_wbs_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_activity_dependencies ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.equipment FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.governance_facilities FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.upload_rate_limits FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.mw_inspections FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.gantt_project_events FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.smp_documents FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.governance_milestone_state FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.governance_deliverable_status FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.doc_folders FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.lihok_corporate_document_categories FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.lihok_corporate_documents FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.users FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.doc_files FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.lihok_corporate_document_versions FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.tasks FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.monthly_kpi_records FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.lihok_corporate_document_audit FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.presentation_files FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.storage_upload_intents FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.governance_uploads FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.governance_files FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.gantt_calendars FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.gantt_calendar_exceptions FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.gantt_projects FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.gantt_wbs_nodes FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.gantt_activities FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.gantt_activity_dependencies FROM anon, authenticated;
