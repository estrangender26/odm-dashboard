import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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
  it("supports business-unit aliases when filtering Monthly KPI records", () => {
    expect(bootSource).toContain("WHEN 'ez' THEN 'AMD-EZ'");
    expect(bootSource).toContain("WHEN 'laguna' THEN 'Laguna Water'");
    expect(bootSource).toContain("WHEN 'clark' THEN 'Clark Water'");
    expect(bootSource).toContain("WHEN 'tagum' THEN 'Tagum Water'");
    expect(bootSource).toContain("WHEN 'estate' THEN 'Estate Water'");
    expect(bootSource).toContain("canonical_business_unit = ${businessUnitParam}");
  });

  it("deduplicates alias records by preferring the current API value row", () => {
    expect(bootSource).toContain("ROW_NUMBER() OVER");
    expect(bootSource).toContain("PARTITION BY ${monthlyKpiCanonicalBusinessUnitSql}, reporting_year, reporting_month");
    expect(bootSource).toContain("ORDER BY ${monthlyKpiAliasPrioritySql} ASC");
    expect(bootSource).toContain("WHERE alias_rank = 1");
  });

  it("requires reporting_year and deletes only the selected business unit plus selected year", () => {
    const deleteRoute = routeBlock("delete", "/api/monthly-kpi/records");

    expect(deleteRoute).toContain('return c.json({ error: "reporting_year query parameter is required" }, 400)');
    expect(deleteRoute).toContain("WHERE business_unit = ${businessUnit.trim()}");
    expect(deleteRoute).toContain("AND reporting_year = ${reportingYear}");
    expect(deleteRoute).toContain("fetchMonthlyKpiRecordsForResponse({ reportingYear })");
  });

  it("returns notes from the Monthly KPI records list query", () => {
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
      "notes,",
      "raw_imported_values",
      "${record.facilityUptime},",
      "${record.notes},",
      "ON CONFLICT (business_unit, reporting_year, reporting_month)",
      "notes = EXCLUDED.notes,",
      "RETURNING",
      "facility_uptime,",
      "notes,",
      "raw_imported_values",
    ]);
  });

  it("updates notes in the Monthly KPI PATCH route", () => {
    const patchRoute = routeBlock("patch", "/api/monthly-kpi/records/:id");

    expect(patchRoute).toContain("const record = normalizeMonthlyKpiRecord({ ...existing, ...body }, existing.source_file_name)");
    expectInOrder(patchRoute, [
      "UPDATE monthly_kpi_records SET",
      "facility_uptime = ${record.facilityUptime},",
      "notes = ${record.notes},",
      "raw_imported_values = ${record.rawImportedValues ? JSON.stringify(record.rawImportedValues) : null}::jsonb",
      "RETURNING *",
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
});
