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
});
