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

describe("Operator-Driven Maintenance records API", () => {
  it("registers a read-only inspections route over existing mw_inspections rows", () => {
    const getRoute = routeBlock("get", "/api/operator-driven-maintenance/inspections");
    const query = sourceBlock(
      "async function fetchOdmInspectionsForResponse",
      "app.get(\"/api/operator-driven-maintenance/inspections\""
    );

    expect(query).toContain("FROM mw_inspections");
    expect(query).toContain("WHERE (${facilityId}::text IS NULL OR facility_id = ${facilityId})");
    expect(query).not.toContain("INSERT INTO");
    expect(query).not.toContain("DELETE FROM");
    expect(query).not.toContain("UPDATE mw_inspections");
    expect(getRoute).toContain("return c.json({ records })");
  });

  it("returns the fields required by the ODM presentation generator", () => {
    const query = sourceBlock(
      "async function fetchOdmInspectionsForResponse",
      "app.get(\"/api/operator-driven-maintenance/inspections\""
    );

    expectInOrder(query, [
      "SELECT",
      "facility_id,",
      "inspection_date,",
      "asset_tag,",
      "asset_name,",
      "equipment_type,",
      "category,",
      "task,",
      "escalation_trigger,",
      "entry_notes,",
      "status,",
      "score,",
      "findings,",
      "date,",
      "submitted_at,",
      "FROM mw_inspections",
    ]);
  });

  it("supports reporting period and facility filters without destructive database changes", () => {
    const getRoute = routeBlock("get", "/api/operator-driven-maintenance/inspections");
    const filterBlock = sourceBlock(
      "return rowsFromDb<Record<string, unknown>>(rows).filter(record => {",
      "app.get(\"/api/operator-driven-maintenance/inspections\""
    );

    expect(getRoute).toContain("c.req.query(\"reporting_year\")");
    expect(getRoute).toContain("c.req.query(\"reporting_month\")");
    expect(getRoute).toContain("c.req.query(\"facility_id\")");
    expect(getRoute).toContain("reporting_month query parameter must be between 1 and 12");
    expect(filterBlock).toContain("parts.year !== reportingYear");
    expect(filterBlock).toContain("parts.month !== reportingMonth");
  });
});
