# Monthly KPI Scorecard Persistence Migration Dry Run

No destructive database changes are required.

## Table

`monthly_kpi_records`

## Columns

- `id` serial primary key
- `business_unit` varchar(100), required
- `reporting_month` integer, required
- `reporting_year` integer, required
- `source_file_name` varchar(255)
- `imported_at` timestamp, defaults to `now()`
- `pm_compliance` double precision
- `pm_planned` double precision
- `schedule_compliance` double precision
- `budget_spend` double precision
- `pm_cm_work_order_ratio` double precision
- `pm_cm_cost_ratio` double precision
- `mtbf_days` double precision
- `mttr_days` double precision
- `facility_uptime` double precision
- `raw_imported_values` jsonb, used to preserve original imported cell values separately from display formatting

Nullable KPI metric columns intentionally preserve blanks as `NULL`; explicit workbook zeros remain numeric `0`.

## Indexes and constraints

- Primary key: `id`
- Unique upsert key: `business_unit`, `reporting_year`, `reporting_month`
- Index: `reporting_year`, `reporting_month`
- Index: `business_unit`

## Upsert behavior

`POST /api/monthly-kpi/import` inserts imported records and uses the unique key (`business_unit`, `reporting_year`, `reporting_month`) to update an existing monthly KPI row when the same workbook/month/business unit is imported again.

## Rollback approach

If rollback is required before dependent code is used, drop only the additive table and indexes:

```sql
DROP TABLE IF EXISTS "monthly_kpi_records";
```

No existing tables or records are modified by this migration.
