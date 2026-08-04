-- PR 1: Link-Based Collaborative Gantt Foundation
-- Adds public share tokens, revision tracking, audit events, and calendar tables
-- without deleting or overwriting existing JSON snapshot projects.

-- Shared-project identity and access on gantt_projects
ALTER TABLE gantt_projects
  ADD COLUMN IF NOT EXISTS public_id UUID UNIQUE,
  ADD COLUMN IF NOT EXISTS slug VARCHAR(255) UNIQUE,
  ADD COLUMN IF NOT EXISTS edit_token_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS view_token_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS data_date VARCHAR(20),
  ADD COLUMN IF NOT EXISTS default_calendar_id INTEGER,
  ADD COLUMN IF NOT EXISTS sharing_enabled INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_scheduled_at TIMESTAMP;

-- Backfill public_id and slug for existing projects so they remain reachable
-- through the legacy session path and can later be enabled for sharing.
UPDATE gantt_projects
SET public_id = gen_random_uuid(),
    slug = regexp_replace(
             lower(coalesce(project_name, name, 'project')),
             '[^a-z0-9]+', '-', 'g'
           ) || '-' || substr(md5(random()::text), 1, 8)
WHERE public_id IS NULL;

-- Indexes for shared-project lookups
CREATE INDEX IF NOT EXISTS gantt_projects_public_id_idx ON gantt_projects(public_id);
CREATE INDEX IF NOT EXISTS gantt_projects_slug_idx ON gantt_projects(slug);
CREATE INDEX IF NOT EXISTS gantt_projects_edit_token_idx ON gantt_projects(edit_token_hash);
CREATE INDEX IF NOT EXISTS gantt_projects_view_token_idx ON gantt_projects(view_token_hash);

-- Revision and actor tracking on tasks/dependencies
ALTER TABLE gantt_tasks
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_by_name VARCHAR(255);

ALTER TABLE gantt_dependencies
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_by_name VARCHAR(255);

-- Append-only audit trail for shared projects
CREATE TABLE IF NOT EXISTS gantt_project_events (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES gantt_projects(id) ON DELETE CASCADE,
  entity_type VARCHAR(50) NOT NULL,
  entity_id INTEGER,
  action VARCHAR(50) NOT NULL,
  actor_name VARCHAR(255),
  before_data JSONB,
  after_data JSONB,
  project_revision INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS gantt_project_events_project_idx ON gantt_project_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gantt_project_events_entity_idx ON gantt_project_events(project_id, entity_type, entity_id);

-- Default project calendar and exceptions
CREATE TABLE IF NOT EXISTS gantt_calendars (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES gantt_projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  working_days INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5}',
  hours_per_day NUMERIC(4,2) NOT NULL DEFAULT 8,
  timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Manila',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gantt_calendar_exceptions (
  id SERIAL PRIMARY KEY,
  calendar_id INTEGER NOT NULL REFERENCES gantt_calendars(id) ON DELETE CASCADE,
  exception_date DATE NOT NULL,
  is_working BOOLEAN NOT NULL DEFAULT FALSE,
  working_hours NUMERIC(4,2),
  description VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(calendar_id, exception_date)
);

CREATE INDEX IF NOT EXISTS gantt_calendars_project_idx ON gantt_calendars(project_id);
CREATE INDEX IF NOT EXISTS gantt_calendar_exceptions_calendar_idx ON gantt_calendar_exceptions(calendar_id, exception_date);
