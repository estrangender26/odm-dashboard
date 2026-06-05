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
  it("keeps the dashboard KPI cards to the required layout without PM Planned", () => {
    expect(extractScriptArray("GaugeKPIs")).toEqual([
      "pmCompliance",
      "scheduleCompliance",
      "budgetSpend",
      "facilityUptime",
      "pmcmWORatio",
      "pmcmCostRatio",
    ]);
    expect(extractScriptArray("GaugeKPIs")).not.toContain("pmPlanned");
  });

  it("limits the Summary Matrix to the required KPI metrics without PM Planned", () => {
    expect(extractScriptArray("SummaryMatrixKPIs")).toEqual([
      "pmCompliance",
      "scheduleCompliance",
      "budgetSpend",
      "pmcmWORatio",
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


  it("includes explanatory tooltips for monthly KPI cards", () => {
    expect(scorecardHtml).toContain("gauge-tooltip");
    expect(scorecardHtml).toContain("aria-describedby");
    expect(scorecardHtml).toContain("Completed PMs / Planned PMs × 100");
    expect(scorecardHtml).toContain("Work Orders Completed On Time / Scheduled Work Orders × 100");
    expect(scorecardHtml).toContain("Actual Maintenance Spend / Budgeted Maintenance Spend × 100");
    expect(scorecardHtml).toContain("PM Work Orders / (PM Work Orders + CM Work Orders)");
    expect(scorecardHtml).toContain("Percentage + Equivalent Ratio (example: 90% = 9:1)");
    expect(scorecardHtml).toContain("PM Maintenance Cost / (PM Cost + CM Cost)");
    expect(scorecardHtml).toContain("Percentage + Equivalent Ratio (example: 72.7% = 2.7:1)");
    expect(scorecardHtml).toContain("Available Operating Time / Total Required Operating Time × 100");
    expect(scorecardHtml).toContain("Higher is better.");
  });

  it("renders PM:CM ratios as percentages with equivalent ratios", () => {
    expect(scorecardHtml).toContain("function formatPmCmRatioEquivalent");
    expect(scorecardHtml).toContain("return (pct / cmShare).toFixed(1)+':1';");
    expect(scorecardHtml).toContain("return formatKPIValue(pct)+'% ('+formatPmCmRatioEquivalent(pct)+')';");
    expect(scorecardHtml).toContain("formatDisplayKpiValue(sk.key,val)");
    expect(scorecardHtml).toContain("formatDisplayKpiValue(key,v)");
    expect(scorecardHtml).toContain("formatDisplayKpiValue(key,val)");
    expect(scorecardHtml).toContain("if(pct>=100)return 'No CM';");
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
