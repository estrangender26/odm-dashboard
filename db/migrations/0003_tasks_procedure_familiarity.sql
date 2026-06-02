-- Ensure production tasks imports can persist the procedure familiarity field.
ALTER TABLE "tasks"
ADD COLUMN IF NOT EXISTS "procedure_familiarity" text;

CREATE INDEX IF NOT EXISTS "tasks_familiarity_idx"
ON "tasks" ("procedure_familiarity");
