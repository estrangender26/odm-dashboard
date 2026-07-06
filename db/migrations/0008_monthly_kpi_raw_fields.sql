-- Monthly KPI raw input fields.
-- Adds nullable columns for the numerator/denominator values needed to recompute KPIs inside the app.
-- Safe additive migration; existing computed KPI columns remain unchanged.

ALTER TABLE "monthly_kpi_records"
  ADD COLUMN IF NOT EXISTS "actual_spend" double precision,
  ADD COLUMN IF NOT EXISTS "budget" double precision,
  ADD COLUMN IF NOT EXISTS "pm_orders_completed_on_time" double precision,
  ADD COLUMN IF NOT EXISTS "total_pm_orders" double precision,
  ADD COLUMN IF NOT EXISTS "pm_work_orders" double precision,
  ADD COLUMN IF NOT EXISTS "cm_work_orders" double precision,
  ADD COLUMN IF NOT EXISTS "pm_cost" double precision,
  ADD COLUMN IF NOT EXISTS "cm_cost" double precision,
  ADD COLUMN IF NOT EXISTS "total_downtime" double precision,
  ADD COLUMN IF NOT EXISTS "number_of_repairs" double precision,
  ADD COLUMN IF NOT EXISTS "total_operating_time" double precision,
  ADD COLUMN IF NOT EXISTS "source_sheet" varchar(255),
  ADD COLUMN IF NOT EXISTS "import_batch_id" varchar(100);
