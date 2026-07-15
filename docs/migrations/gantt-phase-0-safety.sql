-- Gantt Phase 0 normalized persistence migration
-- REVIEW-ONLY ARTIFACT. DO NOT EXECUTE WITHOUT SEPARATE EXPLICIT APPROVAL.
-- This file is intentionally outside the runtime migration directory.

BEGIN;

LOCK TABLE gantt_projects, gantt_tasks, gantt_dependencies IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE gantt_projects
  ADD COLUMN IF NOT EXISTS status_date varchar(20),
  ADD COLUMN IF NOT EXISTS calendar_id integer,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;

ALTER TABLE gantt_dependencies
  ADD COLUMN IF NOT EXISTS lag_unit varchar(20) NOT NULL DEFAULT 'day';

CREATE TABLE IF NOT EXISTS gantt_assignments (
  id serial PRIMARY KEY,
  project_id integer NOT NULL,
  task_id integer NOT NULL,
  resource_id varchar(255) NOT NULL,
  units double precision NOT NULL DEFAULT 1,
  role varchar(100),
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gantt_calendars (
  id serial PRIMARY KEY,
  owner_id integer,
  session_id varchar(255),
  name varchar(255) NOT NULL,
  timezone varchar(100) NOT NULL,
  working_days jsonb NOT NULL,
  working_ranges jsonb NOT NULL,
  exceptions jsonb NOT NULL,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT gantt_calendar_owner_scope_check CHECK (
    (owner_id IS NOT NULL AND session_id IS NULL)
    OR (owner_id IS NULL AND session_id IS NOT NULL)
  )
);

-- The old UI represented a root task as parent_task_id=0. Canonical storage uses NULL.
UPDATE gantt_tasks SET parent_task_id = NULL WHERE parent_task_id = 0;
ALTER TABLE gantt_tasks ALTER COLUMN parent_task_id DROP DEFAULT;

-- Dependencies can be backfilled only when both endpoints already belong to the
-- same project. Ambiguous rows deliberately remain NULL and fail the preflight.
UPDATE gantt_dependencies dependency
SET project_id = predecessor.project_id
FROM gantt_tasks predecessor, gantt_tasks successor
WHERE dependency.predecessor_task_id = predecessor.id
  AND dependency.successor_task_id = successor.id
  AND predecessor.project_id = successor.project_id
  AND dependency.project_id IS NULL;

-- Stop instead of guessing ownership or project membership.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM gantt_projects WHERE user_id IS NULL AND session_id IS NULL) THEN
    RAISE EXCEPTION 'Unowned gantt_projects rows require an approved ownership mapping';
  END IF;
  IF EXISTS (SELECT 1 FROM gantt_projects WHERE user_id IS NOT NULL AND session_id IS NOT NULL) THEN
    RAISE EXCEPTION 'gantt_projects rows with both user and anonymous owners require review';
  END IF;
  IF EXISTS (SELECT 1 FROM gantt_tasks WHERE project_id IS NULL) THEN
    RAISE EXCEPTION 'gantt_tasks rows with NULL project_id require an approved project mapping';
  END IF;
  IF EXISTS (
    SELECT 1 FROM gantt_tasks task
    LEFT JOIN gantt_projects project ON project.id = task.project_id
    WHERE project.id IS NULL
  ) THEN
    RAISE EXCEPTION 'gantt_tasks contains orphan project references';
  END IF;
  IF EXISTS (SELECT 1 FROM gantt_dependencies WHERE project_id IS NULL) THEN
    RAISE EXCEPTION 'gantt_dependencies rows with ambiguous project_id require review';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM gantt_dependencies dependency
    JOIN gantt_tasks predecessor ON predecessor.id = dependency.predecessor_task_id
    JOIN gantt_tasks successor ON successor.id = dependency.successor_task_id
    WHERE predecessor.project_id <> dependency.project_id
       OR successor.project_id <> dependency.project_id
  ) THEN
    RAISE EXCEPTION 'Cross-project Gantt dependencies must be resolved before migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM gantt_dependencies
    GROUP BY project_id, predecessor_task_id, successor_task_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate Gantt dependency pairs require reviewed deduplication';
  END IF;
END $$;

ALTER TABLE gantt_tasks ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE gantt_dependencies ALTER COLUMN project_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gantt_tasks_project_id_id_unique
  ON gantt_tasks(project_id, id);
CREATE INDEX IF NOT EXISTS gantt_tasks_project_sort_idx
  ON gantt_tasks(project_id, sort_order, id);
CREATE INDEX IF NOT EXISTS gantt_dependencies_project_predecessor_idx
  ON gantt_dependencies(project_id, predecessor_task_id);
CREATE INDEX IF NOT EXISTS gantt_dependencies_project_successor_idx
  ON gantt_dependencies(project_id, successor_task_id);
CREATE UNIQUE INDEX IF NOT EXISTS gantt_dependencies_project_pair_unique
  ON gantt_dependencies(project_id, predecessor_task_id, successor_task_id);
CREATE INDEX IF NOT EXISTS gantt_assignments_project_idx ON gantt_assignments(project_id);
CREATE INDEX IF NOT EXISTS gantt_assignments_task_idx ON gantt_assignments(task_id);
CREATE UNIQUE INDEX IF NOT EXISTS gantt_assignments_project_task_resource_unique
  ON gantt_assignments(project_id, task_id, resource_id);
CREATE INDEX IF NOT EXISTS gantt_calendars_owner_idx ON gantt_calendars(owner_id);
CREATE INDEX IF NOT EXISTS gantt_calendars_session_idx ON gantt_calendars(session_id);

ALTER TABLE gantt_projects
  ADD CONSTRAINT gantt_projects_owner_scope_check CHECK (
    (user_id IS NOT NULL AND session_id IS NULL)
    OR (user_id IS NULL AND session_id IS NOT NULL)
  ) NOT VALID;
ALTER TABLE gantt_projects VALIDATE CONSTRAINT gantt_projects_owner_scope_check;

ALTER TABLE gantt_tasks
  ADD CONSTRAINT gantt_tasks_project_fk FOREIGN KEY (project_id)
  REFERENCES gantt_projects(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE gantt_tasks VALIDATE CONSTRAINT gantt_tasks_project_fk;

ALTER TABLE gantt_tasks
  ADD CONSTRAINT gantt_tasks_parent_same_project_fk FOREIGN KEY (project_id, parent_task_id)
  REFERENCES gantt_tasks(project_id, id) DEFERRABLE INITIALLY DEFERRED NOT VALID;
ALTER TABLE gantt_tasks VALIDATE CONSTRAINT gantt_tasks_parent_same_project_fk;

ALTER TABLE gantt_dependencies
  ADD CONSTRAINT gantt_dependencies_project_fk FOREIGN KEY (project_id)
  REFERENCES gantt_projects(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE gantt_dependencies
  ADD CONSTRAINT gantt_dependencies_predecessor_same_project_fk
  FOREIGN KEY (project_id, predecessor_task_id)
  REFERENCES gantt_tasks(project_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE gantt_dependencies
  ADD CONSTRAINT gantt_dependencies_successor_same_project_fk
  FOREIGN KEY (project_id, successor_task_id)
  REFERENCES gantt_tasks(project_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE gantt_dependencies VALIDATE CONSTRAINT gantt_dependencies_project_fk;
ALTER TABLE gantt_dependencies VALIDATE CONSTRAINT gantt_dependencies_predecessor_same_project_fk;
ALTER TABLE gantt_dependencies VALIDATE CONSTRAINT gantt_dependencies_successor_same_project_fk;

ALTER TABLE gantt_assignments
  ADD CONSTRAINT gantt_assignments_project_fk FOREIGN KEY (project_id)
  REFERENCES gantt_projects(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE gantt_assignments
  ADD CONSTRAINT gantt_assignments_task_same_project_fk FOREIGN KEY (project_id, task_id)
  REFERENCES gantt_tasks(project_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE gantt_assignments VALIDATE CONSTRAINT gantt_assignments_project_fk;
ALTER TABLE gantt_assignments VALIDATE CONSTRAINT gantt_assignments_task_same_project_fk;

ALTER TABLE gantt_projects
  ADD CONSTRAINT gantt_projects_calendar_fk FOREIGN KEY (calendar_id)
  REFERENCES gantt_calendars(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE gantt_projects VALIDATE CONSTRAINT gantt_projects_calendar_fk;

COMMIT;
