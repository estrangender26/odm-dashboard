-- Production safety migration: keep the existing tasks table/data and add the
-- import-backed procedure familiarity field if an older database missed it.
ALTER TABLE "tasks"
ADD COLUMN IF NOT EXISTS "procedure_familiarity" text;

CREATE INDEX IF NOT EXISTS "tasks_familiarity_idx"
ON "tasks" ("procedure_familiarity");
