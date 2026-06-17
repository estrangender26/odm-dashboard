ALTER TABLE "monthly_kpi_records"
  ADD COLUMN IF NOT EXISTS "notes" text;
