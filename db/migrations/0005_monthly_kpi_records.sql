-- Monthly KPI Scorecard persistence.
-- Safe additive migration: creates a dedicated table for imported scorecard rows.
CREATE TABLE IF NOT EXISTS "monthly_kpi_records" (
  "id" serial PRIMARY KEY NOT NULL,
  "business_unit" varchar(100) NOT NULL,
  "reporting_month" integer NOT NULL,
  "reporting_year" integer NOT NULL,
  "source_file_name" varchar(255),
  "imported_at" timestamp DEFAULT now(),
  "pm_compliance" double precision,
  "pm_planned" double precision,
  "schedule_compliance" double precision,
  "budget_spend" double precision,
  "pm_cm_work_order_ratio" double precision,
  "pm_cm_cost_ratio" double precision,
  "mtbf_days" double precision,
  "mttr_days" double precision,
  "facility_uptime" double precision,
  "raw_imported_values" jsonb,
  CONSTRAINT "monthly_kpi_records_bu_year_month_unique"
    UNIQUE ("business_unit", "reporting_year", "reporting_month")
);

CREATE INDEX IF NOT EXISTS "monthly_kpi_records_period_idx"
  ON "monthly_kpi_records" ("reporting_year", "reporting_month");

CREATE INDEX IF NOT EXISTS "monthly_kpi_records_business_unit_idx"
  ON "monthly_kpi_records" ("business_unit");
