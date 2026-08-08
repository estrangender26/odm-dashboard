import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeBusinessUnitLabel } from "../src/modules/monthly-kpi/kpiAggregation";

const bootSource = readFileSync(resolve(process.cwd(), "api/boot.ts"), "utf8");

function routeBlock(method: string, path: string) {
  const start = bootSource.indexOf(`app.${method}("${path}"`);
  if (start < 0) throw new Error(`${method.toUpperCase()} ${path} route not found`);
  const nextRoute = bootSource.indexOf("\napp.", start + 1);
  return bootSource.slice(start, nextRoute > start ? nextRoute : undefined);
}

function sourceBlock(startToken: string, endToken: string) {
  const start = bootSource.indexOf(startToken);
  if (start < 0) throw new Error(`${startToken} block not found`);
  const end = bootSource.indexOf(endToken, start + startToken.length);
  if (end < 0) throw new Error(`${endToken} boundary not found`);
  return bootSource.slice(start, end);
}

function expectInOrder(source: string, tokens: string[]) {
  let offset = 0;
  for (const token of tokens) {
    const found = source.indexOf(token, offset);
    expect(found, `Expected token after offset ${offset}: ${token}`).toBeGreaterThanOrEqual(0);
    offset = found + token.length;
  }
}

describe("Monthly KPI records API", () => {
  it("normalizes supported WAWA/JVC aliases to one shared label", () => {
    expect(normalizeBusinessUnitLabel("WAWAJVC")).toBe("WAWA/JVC");
    expect(normalizeBusinessUnitLabel("WAWA/JVC")).toBe("WAWA/JVC");
  });

  it("supports business-unit aliases when filtering Monthly KPI records", () => {
    expect(bootSource).toContain("WHEN 'ez' THEN 'AMD-EZ'");
    expect(bootSource).toContain("WHEN 'laguna' THEN 'Laguna Water'");
    expect(bootSource).toContain("WHEN 'clark' THEN 'Clark Water'");
    expect(bootSource).toContain("WHEN 'tagum' THEN 'Tagum Water'");
    expect(bootSource).toContain("WHEN 'estate' THEN 'Estate Water'");
    expect(bootSource).toContain("WHEN 'wawajvc' THEN 'WAWA/JVC'");
    expect(bootSource).toContain("WHEN 'wawa/jvc' THEN 'WAWA/JVC'");
    expect(bootSource).toContain("canonical_business_unit = ${businessUnitParam}");
  });

  it("returns and filters legacy WAWAJVC rows under the canonical WAWA/JVC identity", () => {
    const listQuery = sourceBlock(
      "async function fetchMonthlyKpiRecordsForResponse",
      "async function fetchMonthlyKpiAggregateForResponse",
    );
    const getRoute = routeBlock("get", "/api/monthly-kpi/records");

    expect(listQuery).toContain("canonical_business_unit AS business_unit");
    expect(listQuery).toContain("PARTITION BY ${monthlyKpiCanonicalBusinessUnitSql}, reporting_year, reporting_month");
    expect(listQuery).toContain("canonical_business_unit = ${businessUnitParam}");
    expect(getRoute).toContain('businessUnit: c.req.query("business_unit")?.trim() || null');
    expect(bootSource).toContain("const businessUnitParam = normalizeMonthlyKpiBusinessUnitFilter(filters.businessUnit)");
  });

  it("deduplicates alias records by preferring the current API value row", () => {
    expect(bootSource).toContain("ROW_NUMBER() OVER");
    expect(bootSource).toContain("PARTITION BY ${monthlyKpiCanonicalBusinessUnitSql}, reporting_year, reporting_month");
    expect(bootSource).toContain("ORDER BY ${monthlyKpiAliasPrioritySql} ASC");
    expect(bootSource).toContain("WHERE alias_rank = 1");
  });

  it("requires reporting_year and supports optional business_unit and reporting_month filters", () => {
    const deleteRoute = routeBlock("delete", "/api/monthly-kpi/records");

    expect(deleteRoute).toContain('return c.json({ error: "reporting_year query parameter is required" }, 400)');
    expect(deleteRoute).not.toContain('return c.json({ error: "business_unit query parameter is required" }, 400)');
    expect(deleteRoute).toContain("DELETE FROM monthly_kpi_records");
    expect(deleteRoute).toContain("WHERE reporting_year = ${reportingYear}");
    expect(deleteRoute).toContain("fetchMonthlyKpiRecordsForResponse({ reportingYear })");
  });

  it("returns notes from the Monthly KPI records list query and does not select non-existent mtbf_days", () => {
    const listQuery = sourceBlock(
      "async function fetchMonthlyKpiRecordsForResponse",
      "async function fetchMonthlyKpiAggregateForResponse",
    );
    const getRoute = routeBlock("get", "/api/monthly-kpi/records");

    expectInOrder(listQuery, [
      "SELECT",
      "facility_uptime,",
      "notes,",
      "raw_imported_values",
      "FROM monthly_kpi_records",
    ]);
    expect(listQuery).not.toContain("mtbf_days");
    expect(getRoute).toContain("const records = await fetchMonthlyKpiRecordsForResponse");
    expect(getRoute).toContain("return c.json({ records })");
  });

  it("preserves notes through Monthly KPI import upserts", () => {
    const normalizer = sourceBlock(
      "function normalizeMonthlyKpiRecord",
      "logBootStage(\"registering monthly KPI scorecard routes\")",
    );
    const importRoute = routeBlock("post", "/api/monthly-kpi/import");

    expect(normalizer).toContain("notes: asNullableText(input?.notes ?? input?.Notes)");
    expectInOrder(importRoute, [
      "INSERT INTO monthly_kpi_records",
      "facility_uptime,",
      "actual_spend,",
      "budget,",
      "pm_orders_completed_on_time,",
      "total_pm_orders,",
      "pm_work_orders,",
      "cm_work_orders,",
      "pm_cost,",
      "cm_cost,",
      "total_downtime,",
      "number_of_repairs,",
      "total_operating_time,",
      "source_sheet,",
      "import_batch_id,",
      "notes,",
      "raw_imported_values",
      "${record.facilityUptime},",
      "${record.actualSpend},",
      "${record.sourceSheet},",
      "${record.notes},",
      "ON CONFLICT (business_unit, reporting_year, reporting_month)",
      "notes = EXCLUDED.notes,",
      "RETURNING",
      "facility_uptime,",
      "actual_spend,",
      "source_sheet,",
      "notes,",
      "raw_imported_values"
    ]);
  });

  it("updates notes in the Monthly KPI PATCH route", () => {
    const patchRoute = routeBlock("patch", "/api/monthly-kpi/records/:id");

    expect(patchRoute).toContain("const record = normalizeMonthlyKpiRecord({ ...existing, ...body }, existing.source_file_name)");
    expectInOrder(patchRoute, [
      "UPDATE monthly_kpi_records SET",
      "facility_uptime = ${record.facilityUptime},",
      "actual_spend = ${record.actualSpend},",
      "source_sheet = ${record.sourceSheet},",
      "import_batch_id = ${record.importBatchId},",
      "notes = ${record.notes},",
      "raw_imported_values = ${record.rawImportedValues ? JSON.stringify(record.rawImportedValues) : null}::jsonb",
      "RETURNING *"
    ]);
  });

  it("normalizes null and empty notes safely before writes", () => {
    const nullableText = sourceBlock(
      "function asNullableText",
      "function asRequiredInteger",
    );
    const normalizer = sourceBlock(
      "function normalizeMonthlyKpiRecord",
      "logBootStage(\"registering monthly KPI scorecard routes\")",
    );

    expect(nullableText).toContain("if (value === null || value === undefined) return null");
    expect(nullableText).toContain("const text = String(value).trim()");
    expect(nullableText).toContain("return text || null");
    expect(normalizer).toContain("notes: asNullableText(input?.notes ?? input?.Notes)");
  });

  it("imports all payload records and does not filter by fallback business_unit", () => {
    const importRoute = routeBlock("post", "/api/monthly-kpi/import");
    const normalizer = sourceBlock(
      "function normalizeMonthlyKpiRecord",
      'logBootStage("registering monthly KPI scorecard routes")',
    );

    expect(importRoute).toContain("for (const payloadRecord of payloadRecords)");
    expect(importRoute).toContain("normalizeMonthlyKpiRecord(payloadRecord, sourceFileName, fallbackBusinessUnit)");
    expect(normalizer).toContain('input?.business_unit ?? input?.businessUnit ?? fallbackBusinessUnit ?? ""');
  });
});
