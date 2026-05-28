CREATE TABLE IF NOT EXISTS gantt_projects (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  project_name VARCHAR(255),
  start_date VARCHAR(20),
  finish_date VARCHAR(20),
  status VARCHAR(50),
  tasks_data TEXT NOT NULL DEFAULT '[]',
  links_data TEXT,
  description TEXT,
  created_by VARCHAR(255),
  updated_by VARCHAR(255),
  user_id INTEGER,
  owner_id INTEGER,
  tenant_id VARCHAR(255),
  org_id VARCHAR(255),
  session_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS project_name VARCHAR(255);
ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS start_date VARCHAR(20);
ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS finish_date VARCHAR(20);
ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS status VARCHAR(50);
ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS tasks_data TEXT;
ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS links_data TEXT;
ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);
ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS owner_id INTEGER;
ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(255);
ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS org_id VARCHAR(255);
ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS session_id VARCHAR(255);
ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE gantt_projects ALTER COLUMN tasks_data SET DEFAULT '[]';

CREATE INDEX IF NOT EXISTS gantt_projects_name_idx ON gantt_projects(name);
CREATE INDEX IF NOT EXISTS gantt_projects_session_idx ON gantt_projects(session_id);
CREATE INDEX IF NOT EXISTS gantt_projects_user_idx ON gantt_projects(user_id);
