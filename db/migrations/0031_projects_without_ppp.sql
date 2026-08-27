-- Migration 0031: Projects without PPP module
-- Adds projects_without_ppp and project_without_ppp_files tables.
-- Schema is managed through the standard Drizzle migration journal;
-- the API router must not auto-create these tables at runtime.

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

CREATE INDEX IF NOT EXISTS pwp_files_project_idx ON public.project_without_ppp_files (project_id);
