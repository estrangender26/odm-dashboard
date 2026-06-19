import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const bootSource = readFileSync(resolve(process.cwd(), "api/boot.ts"), "utf8");
const mwDashboardSource = readFileSync(
  resolve(process.cwd(), "public/mw-dashboard.html"),
  "utf8"
);

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
  it("redirects retired React ODM dashboard routes to the retained mw-dashboard", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

    expect(bootSource).toContain(
      'app.get("/operator-maintenance", (c) => c.redirect("/mw-dashboard", 302))'
    );
    expect(bootSource).toContain(
      'app.get("/operator-driven-maintenance", (c) => c.redirect("/mw-dashboard", 302))'
    );
    expect(appSource).not.toContain("OperatorDrivenMaintenance");
    expect(appSource).not.toContain('path="/operator-maintenance"');
  });

  it("keeps the read-only inspections route over existing mw_inspections rows", () => {
    const getRoute = routeBlock("get", "/api/operator-driven-maintenance/inspections");
    const query = sourceBlock(
      "async function fetchOdmInspectionsForResponse",
      "function isOdmDateParam"
    );

    expect(query).toContain("FROM mw_inspections");
    expect(query).toContain("WHERE (${facilityId}::text IS NULL OR facility_id = ${facilityId})");
    expect(query).not.toContain("INSERT INTO");
    expect(query).not.toContain("DELETE FROM");
    expect(query).not.toContain("UPDATE mw_inspections");
    expect(getRoute).toContain("return c.json({ records })");
  });

  it("registers a read-only dashboard summary route using shared ODM dashboard aggregation", () => {
    const summaryRoute = routeBlock("get", "/api/operator-driven-maintenance/summary");
    const query = sourceBlock(
      "async function fetchOdmDashboardSummaryForResponse",
      "app.get(\"/api/operator-driven-maintenance/inspections\""
    );

    expect(query).toContain("FROM mw_inspections");
    expect(query).toContain("mapInspectionToDashboardRow");
    expect(query).toContain("buildOdmDashboardScorecard");
    expect(query).not.toContain("INSERT INTO");
    expect(query).not.toContain("DELETE FROM");
    expect(query).not.toContain("UPDATE mw_inspections");
    expect(summaryRoute).toContain("return c.json({ ...scorecard, records: scorecard.rows })");
  });

  it("returns the fields required by the dashboard summary and ODM presentation generator", () => {
    const query = sourceBlock(
      "async function fetchOdmDashboardSummaryForResponse",
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
      "capture1_label,",
      "capture1_response,",
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

  it("supports dashboard date range and plant/equipment/category/inspector filters", () => {
    const summaryRoute = routeBlock("get", "/api/operator-driven-maintenance/summary");

    expect(summaryRoute).toContain("c.req.query(\"date_from\")");
    expect(summaryRoute).toContain("c.req.query(\"date_to\")");
    expect(summaryRoute).toContain("c.req.query(\"facility_id\")");
    expect(summaryRoute).toContain("c.req.query(\"plant\")");
    expect(summaryRoute).toContain("c.req.query(\"equipment_type\")");
    expect(summaryRoute).toContain("c.req.query(\"category\")");
    expect(summaryRoute).toContain("c.req.query(\"inspector\")");
    expect(summaryRoute).toContain("date_from query parameter must be YYYY-MM-DD");
    expect(summaryRoute).toContain("date_to query parameter must be YYYY-MM-DD");
    expect(summaryRoute).not.toContain("reporting_month");
  });

  it("renders the retained mw-dashboard from the shared dashboard summary contract", () => {
    expect(mwDashboardSource).toContain("function buildDashboardSummaryUrl()");
    expect(mwDashboardSource).toContain(
      "return query ? '/api/operator-driven-maintenance/summary?' + query : '/api/operator-driven-maintenance/summary'"
    );
    expectInOrder(mwDashboardSource, [
      "const dateFrom = dashboardFilterValue('dateFrom')",
      "const dateTo = dashboardFilterValue('dateTo')",
      "const plant = dashboardFilterValue('plantFilter')",
      "const equipmentType = dashboardFilterValue('equipFilter')",
      "const category = dashboardFilterValue('categoryFilter')",
      "const inspector = dashboardFilterValue('inspectorFilter')",
      "if (dateFrom) params.set('date_from', dateFrom)",
      "if (dateTo) params.set('date_to', dateTo)",
      "if (plant) params.set('facility_id', plant)",
      "if (equipmentType) params.set('equipment_type', equipmentType)",
      "if (category) params.set('category', category)",
      "if (inspector) params.set('inspector', inspector)",
    ]);
    expect(mwDashboardSource).toContain(
      "xhr.open('GET', buildDashboardSummaryUrl(), true)"
    );
    expect(mwDashboardSource).toContain(
      "? payload.rows.map(normalizeDashboardSummaryRow)"
    );
    expect(mwDashboardSource).toContain("updateKPIsFromSummary(payload.summary)");
    expect(mwDashboardSource).toContain("renderInsights(rows, insights)");
    expect(mwDashboardSource).toContain("Array.isArray(precomputedInsights)");
    expect(mwDashboardSource).toContain(
      "Dashboard summary load failed:"
    );
    expect(mwDashboardSource).not.toContain("reporting_year");
    expect(mwDashboardSource).not.toContain("reporting_month");
  });
});
