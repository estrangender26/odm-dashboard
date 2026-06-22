import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
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

function loadChartInteractions() {
  const source = readFileSync(resolve(process.cwd(), "public/chart-interactions.js"), "utf8");

  class FakeElement {
    tagName: string;
    id = "";
    textContent = "";
    innerHTML = "";
    children: any[] = [];
    style: Record<string, any> = {};
    private dataset: Record<string, string> = {};
    private classSet = new Set<string>();
    classList = {
      add: (c: string) => this.classSet.add(c),
      remove: (c: string) => this.classSet.delete(c),
      toggle: (c: string, force?: boolean) => {
        if (force) this.classSet.add(c);
        else this.classSet.delete(c);
      },
      contains: (c: string) => this.classSet.has(c),
    };
    constructor(tagName: string) {
      this.tagName = tagName;
    }
    setAttribute(name: string, value: string) {
      this.dataset[name] = value;
    }
    getAttribute(name: string) {
      return this.dataset[name] ?? null;
    }
    appendChild(child: any) {
      this.children.push(child);
      return child;
    }
    querySelector() {
      return null;
    }
    querySelectorAll() {
      return [] as any[];
    }
  }

  const documentStub = {
    head: { appendChild() {}, children: [] as any[] },
    body: { appendChild() {}, children: [] as any[] },
    createElement(tagName: string) {
      return new FakeElement(tagName);
    },
    getElementById() {
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [] as any[];
    },
    addEventListener() {},
  };

  const windowStub = {
    ...globalThis,
    document: documentStub,
    renderInsights: () => {},
    AnalyticsEngine: { generateInsights: () => [] as any[] },
    setTimeout,
    clearTimeout,
  };

  const context = createContext({ ...globalThis, window: windowStub, document: documentStub });
  runInContext(source, context, { timeout: 2000 });
  return context.window.ChartInteractions as any;
}

const chartSource = readFileSync(resolve(process.cwd(), "public/chart-interactions.js"), "utf8");

describe("AI Operational Insights drill-down drawer", () => {
  it("does not add an Equipment History tab or page", () => {
    expect(chartSource.toLowerCase()).not.toContain("equipment history");
    expect(mwDashboardSource.toLowerCase()).not.toContain("equipment history");
  });

  it("renders summary table rows as clickable, focusable buttons", () => {
    const ci = loadChartInteractions();
    const groups = [
      { asset: "WS-WPS-BAL-00141", facility: "Balara PS", findingCount: 80, latestDate: "2026-06-20", severity: "high", rows: [] as any[] },
      { asset: "WS-WPS-BAL-00142", facility: "Balara PS", findingCount: 20, latestDate: "2026-06-19", severity: "medium", rows: [] as any[] },
    ];
    const html = ci.renderAiInsightSummaryTable("asset", groups);
    expect(html).toContain("ai-insight-summary-row");
    expect(html).toContain('data-summary-kind="asset"');
    expect(html).toContain('data-summary-key="WS-WPS-BAL-00141"');
    expect(html).toContain('data-summary-index="0"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="button"');
    expect(html).toContain("Click a summary row to view its underlying inspection records.");
    expect(html).toContain('data-summary-index="1"');
    expect(html).not.toContain('data-summary-index="2"');
  });

  it("filters raw records for an asset summary row using stored rows when available", () => {
    const ci = loadChartInteractions();
    const rows = [
      { AssetTag: "A1", Inspector: "I1", InspectionDate: "2026-06-20", EntryNotes: "leak" },
      { AssetTag: "A2", Inspector: "I2", InspectionDate: "2026-06-19", EntryNotes: "ok" },
      { AssetTag: "A1", Inspector: "I3", InspectionDate: "2026-06-18", EntryNotes: "noise" },
    ];
    const group = { asset: "A1", rows: [rows[0], rows[2]] };
    expect(ci.getRowsForSummaryGroup("asset", group, rows)).toEqual(group.rows);
  });

  it("filters raw records for a category summary row by EquipmentType", () => {
    const ci = loadChartInteractions();
    const rows = [
      { AssetTag: "A1", EquipmentType: "Pump", InspectionDate: "2026-06-20", EntryNotes: "leak" },
      { AssetTag: "A2", EquipmentType: "Motor", InspectionDate: "2026-06-19", EntryNotes: "ok" },
      { AssetTag: "A3", EquipmentType: "Pump", InspectionDate: "2026-06-18", EntryNotes: "noise" },
    ];
    const group = { category: "Pump" };
    const filtered = ci.getRowsForSummaryGroup("category", group, rows);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((r: any) => r.AssetTag).sort()).toEqual(["A1", "A3"]);
  });

  it("filters raw records for an inspector summary row by Inspector", () => {
    const ci = loadChartInteractions();
    const rows = [
      { AssetTag: "A1", Inspector: "Bob", InspectionDate: "2026-06-20", EntryNotes: "leak" },
      { AssetTag: "A2", Inspector: "Alice", InspectionDate: "2026-06-19", EntryNotes: "ok" },
      { AssetTag: "A3", Inspector: "Bob", InspectionDate: "2026-06-18", EntryNotes: "noise" },
    ];
    const group = { inspector: "Bob" };
    const filtered = ci.getRowsForSummaryGroup("inspector", group, rows);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((r: any) => r.AssetTag).sort()).toEqual(["A1", "A3"]);
  });

  it("filters raw records for a trend summary row by period and status", () => {
    const ci = loadChartInteractions();
    const rows = [
      { AssetTag: "A1", InspectionDate: "2026-06-20", EntryNotes: "leak" },
      { AssetTag: "A2", InspectionDate: "2026-06-20", EntryNotes: "ok" },
      { AssetTag: "A3", InspectionDate: "2026-06-19", EntryNotes: "vibration" },
    ];
    const group = { period: "2026-06-20", status: "Negative" };
    const filtered = ci.getRowsForSummaryGroup("trend", group, rows);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].AssetTag).toBe("A1");
  });

  it("filters raw records for a critical-pareto summary row by contributor name", () => {
    const ci = loadChartInteractions();
    const rows = [
      { AssetTag: "TAG-001", InspectionDate: "2026-06-20", EntryNotes: "critical leak" },
      { AssetTag: "TAG-002", InspectionDate: "2026-06-19", EntryNotes: "ok" },
      { AssetTag: "TAG-001", InspectionDate: "2026-06-18", EntryNotes: "fault" },
    ];
    const group = { name: "TAG-001" };
    const filtered = ci.getRowsForSummaryGroup("critical-pareto", group, rows);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((r: any) => r.AssetTag).sort()).toEqual(["TAG-001", "TAG-001"]);
  });

  it("builds the selected-group label", () => {
    const ci = loadChartInteractions();
    const group = { asset: "WS-WPS-BAL-00141" };
    expect(ci.buildSelectedGroupLabel("asset", group, 80)).toBe("Records for WS-WPS-BAL-00141 — 80 findings");
  });

  it("does not introduce destructive or schema-changing statements for this feature", () => {
    const lower = chartSource.toLowerCase();
    expect(lower).not.toContain("insert into");
    expect(lower).not.toContain("delete from");
    expect(lower).not.toContain("update mw_inspections");
    expect(lower).not.toContain("alter table");
    expect(lower).not.toContain("create table");
  });
});

