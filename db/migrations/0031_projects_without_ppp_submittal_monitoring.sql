-- Migration 0031: Projects without PPP — Master Data Submittal Monitoring
--
-- PR #389 previously created production tables projects_without_ppp and
-- project_without_ppp_files and applied them in production; the source-level
-- rollback (PR #390) removed the schema, migration file and journal entry but
-- intentionally left the inert production tables in place.
--
-- This migration re-establishes the schema (reusing those inert tables, never
-- dropping them) and additively evolves them for the submittal-monitoring
-- product:
--   * project_without_ppp.project_name          — OWNER reference metadata
--   * project_without_ppp_files.submitted_at    — submission evidence timestamp
--   * project_without_ppp_files.superseded_at   — safe-removal/current indicator
--                                                 (NULL = current evidence)
--
-- Every statement is idempotent (IF NOT EXISTS), so the SAME migration applies
-- safely both to a fresh database and to a production database that already
-- contains the inert PR #389 tables. No DROP TABLE statements are included;
-- any destructive operation requires separate approval.

CREATE TABLE IF NOT EXISTS public.projects_without_ppp (
  id serial PRIMARY KEY,
  tracking_id varchar(50) NOT NULL UNIQUE,
  ps_code varchar(50) NOT NULL,
  coding_mask varchar(50),
  project_phase varchar(50) NOT NULL,
  latest_milestone varchar(50),
  sub_phase varchar(50),
  pm_headline varchar(255),
  work_package varchar(500),
  contract_package varchar(500),
  contractor varchar(255),
  major_project_tag varchar(100),
  construction_manager varchar(255),
  project_manager varchar(255),
  with_ls_ps boolean NOT NULL DEFAULT false,
  amd_grid_head varchar(255),
  submitted_by varchar(255),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

ALTER TABLE public.projects_without_ppp ADD COLUMN IF NOT EXISTS project_name varchar(255);

CREATE INDEX IF NOT EXISTS pwp_tracking_id_idx ON public.projects_without_ppp (tracking_id);
CREATE INDEX IF NOT EXISTS pwp_ps_code_idx ON public.projects_without_ppp (ps_code);
CREATE INDEX IF NOT EXISTS pwp_phase_idx ON public.projects_without_ppp (project_phase);
CREATE INDEX IF NOT EXISTS pwp_tag_idx ON public.projects_without_ppp (major_project_tag);

CREATE TABLE IF NOT EXISTS public.project_without_ppp_files (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES public.projects_without_ppp(id) ON DELETE CASCADE,
  file_name varchar(255) NOT NULL,
  file_type varchar(100),
  file_size integer,
  file_data text,
  uploaded_by varchar(255),
  uploaded_at timestamp DEFAULT now(),
  storage_provider varchar(32),
  storage_bucket varchar(100),
  storage_path text,
  storage_size bigint,
  storage_mime_type varchar(255),
  storage_etag text,
  storage_uploaded_at timestamp with time zone
);

ALTER TABLE public.project_without_ppp_files ADD COLUMN IF NOT EXISTS submitted_at timestamp;
ALTER TABLE public.project_without_ppp_files ADD COLUMN IF NOT EXISTS superseded_at timestamp;

CREATE INDEX IF NOT EXISTS pwp_files_project_idx ON public.project_without_ppp_files (project_id);
CREATE INDEX IF NOT EXISTS pwp_files_current_idx ON public.project_without_ppp_files (project_id, superseded_at);

-- Supabase RLS/revoke posture (mirrors migrations 0024 and 0028): the backend
-- connects through the postgres role (which bypasses RLS) so application
-- authorization is unaffected, while direct PostgREST access by the anon and
-- authenticated roles is disabled. No policies are created; service_role is
-- not modified. Both statements are idempotent (ENABLE RLS and REVOKE are
-- no-ops on re-run).
ALTER TABLE public.projects_without_ppp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_without_ppp_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.projects_without_ppp FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.project_without_ppp_files FROM anon, authenticated;
