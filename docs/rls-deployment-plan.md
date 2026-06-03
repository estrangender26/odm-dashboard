# RLS Deployment Plan

This plan intentionally does **not** apply any database change automatically. Run one phase at a time during a maintenance window, validate it, and only then proceed to the next phase.

## Baseline assumptions

- Target database is PostgreSQL/Supabase with `anon` and `authenticated` roles.
- The current application routes are backend tRPC routes and many are exposed as `publicQuery`; therefore this plan preserves read access for `anon` and grants write access only to `authenticated` for direct Supabase/PostgREST access.
- Backend connections that use a table owner, superuser, or Supabase service-role connection can bypass RLS unless `FORCE ROW LEVEL SECURITY` is enabled. This plan does **not** use `FORCE ROW LEVEL SECURITY` so the rollout stays low-risk for the existing server-side API.
- Existing Drizzle metadata indicates tables currently have RLS disabled, so each phase enables RLS and creates permissive, named policies that can be rolled back cleanly.

## Phase 1 — Low-risk document tables

### Tables

- `doc_folders`
- `doc_files`
- `smp_documents`

### Exact SQL

```sql
BEGIN;

-- Grants for direct Supabase/PostgREST access.
GRANT SELECT ON TABLE public.doc_folders, public.doc_files, public.smp_documents TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.doc_folders, public.doc_files, public.smp_documents TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.doc_folders_id_seq, public.doc_files_id_seq, public.smp_documents_id_seq TO authenticated;

-- Enable RLS without forcing it on the table owner/service connection.
ALTER TABLE public.doc_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doc_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smp_documents ENABLE ROW LEVEL SECURITY;

-- doc_folders
DROP POLICY IF EXISTS doc_folders_read_all ON public.doc_folders;
CREATE POLICY doc_folders_read_all
  ON public.doc_folders
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS doc_folders_write_authenticated ON public.doc_folders;
CREATE POLICY doc_folders_write_authenticated
  ON public.doc_folders
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- doc_files
DROP POLICY IF EXISTS doc_files_read_all ON public.doc_files;
CREATE POLICY doc_files_read_all
  ON public.doc_files
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS doc_files_write_authenticated ON public.doc_files;
CREATE POLICY doc_files_write_authenticated
  ON public.doc_files
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- smp_documents
DROP POLICY IF EXISTS smp_documents_read_all ON public.smp_documents;
CREATE POLICY smp_documents_read_all
  ON public.smp_documents
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS smp_documents_write_authenticated ON public.smp_documents;
CREATE POLICY smp_documents_write_authenticated
  ON public.smp_documents
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMIT;
```

### Rollback SQL

```sql
BEGIN;

DROP POLICY IF EXISTS doc_folders_read_all ON public.doc_folders;
DROP POLICY IF EXISTS doc_folders_write_authenticated ON public.doc_folders;
DROP POLICY IF EXISTS doc_files_read_all ON public.doc_files;
DROP POLICY IF EXISTS doc_files_write_authenticated ON public.doc_files;
DROP POLICY IF EXISTS smp_documents_read_all ON public.smp_documents;
DROP POLICY IF EXISTS smp_documents_write_authenticated ON public.smp_documents;

ALTER TABLE public.doc_folders DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.doc_files DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.smp_documents DISABLE ROW LEVEL SECURITY;

COMMIT;
```

### Validation checklist

- Confirm RLS is enabled for all Phase 1 tables:

  ```sql
  SELECT relname, relrowsecurity, relforcerowsecurity
  FROM pg_class
  WHERE oid IN ('public.doc_folders'::regclass, 'public.doc_files'::regclass, 'public.smp_documents'::regclass)
  ORDER BY relname;
  ```

- Confirm exactly two policies exist per Phase 1 table:

  ```sql
  SELECT schemaname, tablename, policyname, cmd, roles
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('doc_folders', 'doc_files', 'smp_documents')
  ORDER BY tablename, policyname;
  ```

- As `anon`, verify `SELECT` succeeds on `doc_folders`, `doc_files`, and `smp_documents`.
- As `anon`, verify `INSERT`, `UPDATE`, and `DELETE` are denied on all Phase 1 tables.
- As `authenticated`, verify read/write/delete succeeds against disposable test rows.
- Verify the document tree loads, file upload/download/delete works, and SMP document create/update/delete works in the UI.

### Modules affected

- O&M document library tree, folder management, and file CRUD.
- SMP document library list, detail, create, update, delete, and seed flows.

## Phase 2 — Planning and scheduling tables

### Tables

- `equipment`
- `tasks`
- `existing_facilities_maintenance`
- `gantt_tasks`
- `gantt_dependencies`
- `gantt_projects`

### Exact SQL

```sql
BEGIN;

-- Grants for direct Supabase/PostgREST access.
GRANT SELECT ON TABLE
  public.equipment,
  public.tasks,
  public.existing_facilities_maintenance,
  public.gantt_tasks,
  public.gantt_dependencies,
  public.gantt_projects
TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE ON TABLE
  public.equipment,
  public.tasks,
  public.existing_facilities_maintenance,
  public.gantt_tasks,
  public.gantt_dependencies,
  public.gantt_projects
TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE
  public.equipment_id_seq,
  public.tasks_id_seq,
  public.existing_facilities_maintenance_id_seq,
  public.gantt_tasks_id_seq,
  public.gantt_dependencies_id_seq,
  public.gantt_projects_id_seq
TO authenticated;

-- Enable RLS without forcing it on the table owner/service connection.
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.existing_facilities_maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_projects ENABLE ROW LEVEL SECURITY;

-- equipment
DROP POLICY IF EXISTS equipment_read_all ON public.equipment;
CREATE POLICY equipment_read_all
  ON public.equipment
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS equipment_write_authenticated ON public.equipment;
CREATE POLICY equipment_write_authenticated
  ON public.equipment
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- tasks
DROP POLICY IF EXISTS tasks_read_all ON public.tasks;
CREATE POLICY tasks_read_all
  ON public.tasks
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS tasks_write_authenticated ON public.tasks;
CREATE POLICY tasks_write_authenticated
  ON public.tasks
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- existing_facilities_maintenance
DROP POLICY IF EXISTS efm_read_all ON public.existing_facilities_maintenance;
CREATE POLICY efm_read_all
  ON public.existing_facilities_maintenance
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS efm_write_authenticated ON public.existing_facilities_maintenance;
CREATE POLICY efm_write_authenticated
  ON public.existing_facilities_maintenance
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- gantt_tasks
DROP POLICY IF EXISTS gantt_tasks_read_all ON public.gantt_tasks;
CREATE POLICY gantt_tasks_read_all
  ON public.gantt_tasks
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS gantt_tasks_write_authenticated ON public.gantt_tasks;
CREATE POLICY gantt_tasks_write_authenticated
  ON public.gantt_tasks
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- gantt_dependencies
DROP POLICY IF EXISTS gantt_dependencies_read_all ON public.gantt_dependencies;
CREATE POLICY gantt_dependencies_read_all
  ON public.gantt_dependencies
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS gantt_dependencies_write_authenticated ON public.gantt_dependencies;
CREATE POLICY gantt_dependencies_write_authenticated
  ON public.gantt_dependencies
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- gantt_projects
DROP POLICY IF EXISTS gantt_projects_read_all ON public.gantt_projects;
CREATE POLICY gantt_projects_read_all
  ON public.gantt_projects
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS gantt_projects_write_authenticated ON public.gantt_projects;
CREATE POLICY gantt_projects_write_authenticated
  ON public.gantt_projects
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMIT;
```

### Rollback SQL

```sql
BEGIN;

DROP POLICY IF EXISTS equipment_read_all ON public.equipment;
DROP POLICY IF EXISTS equipment_write_authenticated ON public.equipment;
DROP POLICY IF EXISTS tasks_read_all ON public.tasks;
DROP POLICY IF EXISTS tasks_write_authenticated ON public.tasks;
DROP POLICY IF EXISTS efm_read_all ON public.existing_facilities_maintenance;
DROP POLICY IF EXISTS efm_write_authenticated ON public.existing_facilities_maintenance;
DROP POLICY IF EXISTS gantt_tasks_read_all ON public.gantt_tasks;
DROP POLICY IF EXISTS gantt_tasks_write_authenticated ON public.gantt_tasks;
DROP POLICY IF EXISTS gantt_dependencies_read_all ON public.gantt_dependencies;
DROP POLICY IF EXISTS gantt_dependencies_write_authenticated ON public.gantt_dependencies;
DROP POLICY IF EXISTS gantt_projects_read_all ON public.gantt_projects;
DROP POLICY IF EXISTS gantt_projects_write_authenticated ON public.gantt_projects;

ALTER TABLE public.equipment DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.existing_facilities_maintenance DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_tasks DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_dependencies DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_projects DISABLE ROW LEVEL SECURITY;

COMMIT;
```

### Validation checklist

- Confirm RLS is enabled for all Phase 2 tables:

  ```sql
  SELECT relname, relrowsecurity, relforcerowsecurity
  FROM pg_class
  WHERE oid IN (
    'public.equipment'::regclass,
    'public.tasks'::regclass,
    'public.existing_facilities_maintenance'::regclass,
    'public.gantt_tasks'::regclass,
    'public.gantt_dependencies'::regclass,
    'public.gantt_projects'::regclass
  )
  ORDER BY relname;
  ```

- Confirm exactly two policies exist per Phase 2 table:

  ```sql
  SELECT schemaname, tablename, policyname, cmd, roles
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'equipment',
      'tasks',
      'existing_facilities_maintenance',
      'gantt_tasks',
      'gantt_dependencies',
      'gantt_projects'
    )
  ORDER BY tablename, policyname;
  ```

- As `anon`, verify `SELECT` succeeds on all Phase 2 tables.
- As `anon`, verify writes are denied on all Phase 2 tables.
- As `authenticated`, verify disposable inserts/updates/deletes succeed on each Phase 2 table or through the relevant application workflows.
- Verify task listing, task updates, bulk update/import, task filters, familiarity summary, and task export.
- Verify Existing Facilities Maintenance list, filters, create, update, delete, import, seed, and reset.
- Verify Gantt task load, save, delete, reorder, link save/delete, batch link save, seed/reset, project list/get/save/rename/delete.

### Modules affected

- Operator Driven Maintenance and post-planning task modules.
- Existing Facilities Maintenance module.
- Gantt planner task, dependency, reorder, seed/reset, and saved-project modules.

## Phase 3 — Governance and escalation tables

### Tables

- `governance_facilities`
- `governance_milestone_state`
- `governance_uploads`
- `governance_files`
- `mw_inspections`
- `mw_compliance`
- `mw_escalations`

### Exact SQL

```sql
BEGIN;

-- Grants for direct Supabase/PostgREST access.
GRANT SELECT ON TABLE
  public.governance_facilities,
  public.governance_milestone_state,
  public.governance_uploads,
  public.governance_files,
  public.mw_inspections,
  public.mw_compliance,
  public.mw_escalations
TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE ON TABLE
  public.governance_facilities,
  public.governance_milestone_state,
  public.governance_uploads,
  public.governance_files,
  public.mw_inspections,
  public.mw_compliance,
  public.mw_escalations
TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE
  public.governance_facilities_id_seq,
  public.governance_milestone_state_id_seq,
  public.governance_uploads_id_seq,
  public.governance_files_id_seq,
  public.mw_inspections_id_seq,
  public.mw_compliance_id_seq,
  public.mw_escalations_id_seq
TO authenticated;

-- Enable RLS without forcing it on the table owner/service connection.
ALTER TABLE public.governance_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_milestone_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mw_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mw_compliance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mw_escalations ENABLE ROW LEVEL SECURITY;

-- governance_facilities
DROP POLICY IF EXISTS governance_facilities_read_all ON public.governance_facilities;
CREATE POLICY governance_facilities_read_all
  ON public.governance_facilities
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS governance_facilities_write_authenticated ON public.governance_facilities;
CREATE POLICY governance_facilities_write_authenticated
  ON public.governance_facilities
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- governance_milestone_state
DROP POLICY IF EXISTS governance_milestone_state_read_all ON public.governance_milestone_state;
CREATE POLICY governance_milestone_state_read_all
  ON public.governance_milestone_state
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS governance_milestone_state_write_authenticated ON public.governance_milestone_state;
CREATE POLICY governance_milestone_state_write_authenticated
  ON public.governance_milestone_state
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- governance_uploads
DROP POLICY IF EXISTS governance_uploads_read_all ON public.governance_uploads;
CREATE POLICY governance_uploads_read_all
  ON public.governance_uploads
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS governance_uploads_write_authenticated ON public.governance_uploads;
CREATE POLICY governance_uploads_write_authenticated
  ON public.governance_uploads
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- governance_files
DROP POLICY IF EXISTS governance_files_read_all ON public.governance_files;
CREATE POLICY governance_files_read_all
  ON public.governance_files
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS governance_files_write_authenticated ON public.governance_files;
CREATE POLICY governance_files_write_authenticated
  ON public.governance_files
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- mw_inspections
DROP POLICY IF EXISTS mw_inspections_read_all ON public.mw_inspections;
CREATE POLICY mw_inspections_read_all
  ON public.mw_inspections
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS mw_inspections_write_authenticated ON public.mw_inspections;
CREATE POLICY mw_inspections_write_authenticated
  ON public.mw_inspections
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- mw_compliance
DROP POLICY IF EXISTS mw_compliance_read_all ON public.mw_compliance;
CREATE POLICY mw_compliance_read_all
  ON public.mw_compliance
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS mw_compliance_write_authenticated ON public.mw_compliance;
CREATE POLICY mw_compliance_write_authenticated
  ON public.mw_compliance
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- mw_escalations
DROP POLICY IF EXISTS mw_escalations_read_all ON public.mw_escalations;
CREATE POLICY mw_escalations_read_all
  ON public.mw_escalations
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS mw_escalations_write_authenticated ON public.mw_escalations;
CREATE POLICY mw_escalations_write_authenticated
  ON public.mw_escalations
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMIT;
```

### Rollback SQL

```sql
BEGIN;

DROP POLICY IF EXISTS governance_facilities_read_all ON public.governance_facilities;
DROP POLICY IF EXISTS governance_facilities_write_authenticated ON public.governance_facilities;
DROP POLICY IF EXISTS governance_milestone_state_read_all ON public.governance_milestone_state;
DROP POLICY IF EXISTS governance_milestone_state_write_authenticated ON public.governance_milestone_state;
DROP POLICY IF EXISTS governance_uploads_read_all ON public.governance_uploads;
DROP POLICY IF EXISTS governance_uploads_write_authenticated ON public.governance_uploads;
DROP POLICY IF EXISTS governance_files_read_all ON public.governance_files;
DROP POLICY IF EXISTS governance_files_write_authenticated ON public.governance_files;
DROP POLICY IF EXISTS mw_inspections_read_all ON public.mw_inspections;
DROP POLICY IF EXISTS mw_inspections_write_authenticated ON public.mw_inspections;
DROP POLICY IF EXISTS mw_compliance_read_all ON public.mw_compliance;
DROP POLICY IF EXISTS mw_compliance_write_authenticated ON public.mw_compliance;
DROP POLICY IF EXISTS mw_escalations_read_all ON public.mw_escalations;
DROP POLICY IF EXISTS mw_escalations_write_authenticated ON public.mw_escalations;

ALTER TABLE public.governance_facilities DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_milestone_state DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_uploads DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_files DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.mw_inspections DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.mw_compliance DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.mw_escalations DISABLE ROW LEVEL SECURITY;

COMMIT;
```

### Validation checklist

- Confirm RLS is enabled for all Phase 3 tables:

  ```sql
  SELECT relname, relrowsecurity, relforcerowsecurity
  FROM pg_class
  WHERE oid IN (
    'public.governance_facilities'::regclass,
    'public.governance_milestone_state'::regclass,
    'public.governance_uploads'::regclass,
    'public.governance_files'::regclass,
    'public.mw_inspections'::regclass,
    'public.mw_compliance'::regclass,
    'public.mw_escalations'::regclass
  )
  ORDER BY relname;
  ```

- Confirm exactly two policies exist per Phase 3 table:

  ```sql
  SELECT schemaname, tablename, policyname, cmd, roles
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'governance_facilities',
      'governance_milestone_state',
      'governance_uploads',
      'governance_files',
      'mw_inspections',
      'mw_compliance',
      'mw_escalations'
    )
  ORDER BY tablename, policyname;
  ```

- As `anon`, verify `SELECT` succeeds on all Phase 3 tables.
- As `anon`, verify writes are denied on all Phase 3 tables.
- As `authenticated`, verify disposable inserts/updates/deletes succeed on mutable Phase 3 tables or through the relevant application workflows.
- Verify governance facilities load, milestone state loads/saves, upload counts load, uploads list/add/delete, governance file upload/list/download/delete/list-all/list-by-facility.
- Verify MW import, inspection list/detail/update/delete/reset flows.
- Verify compliance and escalation data remain visible where used by downstream dashboards and AI context.

### Modules affected

- Governance dashboard facility, milestone, upload metadata, and governance file modules.
- MW inspection import/list/detail/update/delete/reset module.
- Maintenance compliance and escalation tracking tables.

## Post-rollout hardening backlog

After all phases are stable, consider a second deployment that replaces permissive `authenticated` write policies with tenant-, organization-, facility-, or owner-scoped policies. The best candidates are `gantt_projects.owner_id`, `gantt_projects.user_id`, `gantt_projects.tenant_id`, `gantt_projects.org_id`, facility-scoped governance/MW tables, and uploader/creator columns. Do not add `FORCE ROW LEVEL SECURITY` until the backend connection role and migration tooling have been verified under RLS.
