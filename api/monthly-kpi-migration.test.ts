import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migrationSql = readFileSync("./db/migrations/0010_monthly_kpi_raw_fields.sql", "utf8");
const connectionSource = readFileSync("./api/queries/connection.ts", "utf8");

describe("monthly_kpi_records raw fields migration", () => {
  it("migration file adds mttr_downtime and repair_count safely", () => {
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "mttr_downtime" double precision');
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "repair_count" double precision');
  });

  it("migration file adds facility uptime raw fields safely", () => {
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "facility_operating_time" double precision');
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "facility_downtime" double precision');
  });

  it("migration file adds metadata columns safely", () => {
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "source_sheet" varchar(255)');
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "import_batch_id" varchar(100)');
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "notes" text');
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "raw_imported_values" jsonb');
  });

  it("migration backfills mttr_downtime from mttr_days and repair_count only when both exist", () => {
    expect(migrationSql).toContain('UPDATE "monthly_kpi_records"');
    expect(migrationSql).toContain('"mttr_downtime" = COALESCE("mttr_downtime", "mttr_days" * "repair_count")');
    expect(migrationSql).toContain('"mttr_days" IS NOT NULL');
    expect(migrationSql).toContain('"repair_count" IS NOT NULL');
  });

  it("connection.ts has boot-time raw fields guard", () => {
    expect(connectionSource).toContain("ensureMonthlyKpiRawFields");
    expect(connectionSource).toContain('"mttr_downtime" double precision');
    expect(connectionSource).toContain('"repair_count" double precision');
    expect(connectionSource).toContain('"facility_operating_time" double precision');
    expect(connectionSource).toContain('"facility_downtime" double precision');
  });
});
