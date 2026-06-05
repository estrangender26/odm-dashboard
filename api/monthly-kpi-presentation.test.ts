import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scorecardHtml = readFileSync(resolve(process.cwd(), "public/scorecard-kpi.html"), "utf8");

function extractScriptArray(name: string) {
  const match = scorecardHtml.match(new RegExp(`var ${name} = \\[(.*?)\\];`, "s"));
  if (!match) throw new Error(`${name} array not found`);
  return Array.from(match[1].matchAll(/'([^']+)'/g)).map((entry) => entry[1]);
}

describe("Monthly KPI dashboard presentation", () => {
  it("keeps the dashboard KPI cards to the required 8-card layout without PM Planned", () => {
    expect(extractScriptArray("GaugeKPIs")).toEqual([
      "pmCompliance",
      "scheduleCompliance",
      "budgetSpend",
      "facilityUptime",
      "pmcmWORatio",
      "pmcmCostRatio",
      "mtbf",
      "mttr",
    ]);
    expect(extractScriptArray("GaugeKPIs")).not.toContain("pmPlanned");
  });

  it("limits the Summary Matrix to the required KPI metrics without PM Planned", () => {
    expect(extractScriptArray("SummaryMatrixKPIs")).toEqual([
      "pmCompliance",
      "pmcmWORatio",
      "budgetSpend",
      "pmcmCostRatio",
      "facilityUptime",
    ]);

    const summaryTable = scorecardHtml.match(/<table class="matrix-table" id="summaryTable">([\s\S]*?)<\/table>/)?.[1] ?? "";
    expect(summaryTable).toContain("PM Compliance (%)");
    expect(summaryTable).toContain("PM:CM Ratio (Work Order)");
    expect(summaryTable).toContain("Budget Spend (%)");
    expect(summaryTable).toContain("PM:CM Ratio (Cost)");
    expect(summaryTable).toContain("Facility Uptime (%)");
    expect(summaryTable).not.toContain("PM Planned");
  });

  it("hides PM Planned from per-BU imported monthly records tables", () => {
    const monthlyRecordsRenderer = scorecardHtml.slice(
      scorecardHtml.indexOf("function renderMonthlyRecords(buId)"),
      scorecardHtml.indexOf("// ===== CHARTS ====="),
    );

    expect(monthlyRecordsRenderer).toContain("'Month','PM Compliance (%)','Schedule Compliance (%)'");
    expect(monthlyRecordsRenderer).toContain("'pmCompliance','scheduleCompliance','budgetSpend'");
    expect(monthlyRecordsRenderer).not.toContain("PM Planned");
    expect(monthlyRecordsRenderer).not.toContain("pmPlanned");
  });

  it("keeps PM Planned available internally for imports and saved records", () => {
    expect(scorecardHtml).toContain("pmPlanned:'pm_planned'");
    expect(scorecardHtml).toContain("record.pmPlanned = row.pm_planned");
    expect(scorecardHtml).toContain("pm_planned: record.pmPlanned ?? null");
  });
});
