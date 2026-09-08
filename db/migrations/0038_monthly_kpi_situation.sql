ALTER TABLE IF EXISTS "monthly_kpi_records"
ADD COLUMN IF NOT EXISTS "situation" text;
