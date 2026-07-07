-- Monthly KPI raw fields required by current dashboard logic.
-- Adds nullable columns needed for weighted MTTR, Facility Uptime raw-field
-- separation, and import metadata. Safe additive migration; no existing data
-- is rewritten or deleted.

ALTER TABLE "monthly_kpi_records"
  ADD COLUMN IF NOT EXISTS "mttr_downtime" double precision,
  ADD COLUMN IF NOT EXISTS "repair_count" double precision,
  ADD COLUMN IF NOT EXISTS "facility_operating_time" double precision,
  ADD COLUMN IF NOT EXISTS "facility_downtime" double precision,
  ADD COLUMN IF NOT EXISTS "source_sheet" varchar(255),
  ADD COLUMN IF NOT EXISTS "import_batch_id" varchar(100),
  ADD COLUMN IF NOT EXISTS "notes" text,
  ADD COLUMN IF NOT EXISTS "raw_imported_values" jsonb;

-- Safe backfill: reconstruct MTTR downtime for old records that have monthly
-- MTTR and repair count available. Does not invent repair_count where it is
-- missing, because weighted MTTR cannot be computed without it.
UPDATE "monthly_kpi_records"
SET "mttr_downtime" = COALESCE("mttr_downtime", "mttr_days" * "repair_count")
WHERE "mttr_downtime" IS NULL
  AND "mttr_days" IS NOT NULL
  AND "repair_count" IS NOT NULL;
