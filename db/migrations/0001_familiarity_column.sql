-- Add the editable procedure familiarity field used by maintenance-planning imports.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS procedure_familiarity varchar(50);

CREATE INDEX IF NOT EXISTS tasks_familiarity_idx
  ON tasks (procedure_familiarity);
