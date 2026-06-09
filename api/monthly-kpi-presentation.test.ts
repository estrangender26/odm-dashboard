import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const scorecardHtml = readFileSync(resolve(process.cwd(), "public/scorecard-kpi.html"), "utf8");

type AggregateValue = number | string | null | undefined;
type NormalizedAggregateRow = Record<string, AggregateValue>;
type NormalizedAggregateResponse = {
  byBusinessUnitMap: Record<string, NormalizedAggregateRow>;
  portfolioYearAverage: NormalizedAggregateRow;
};

function extractScriptArray(name: string) {
  const match = scorecardHtml.match(new RegExp(`var ${name} = \\[(.*?)\\];`, "s"));
  if (!match) throw new Error(`${name} array not found`);
  return Array.from(match[1].matchAll(/'([^']+)'/g)).map((entry) => entry[1]);
}

function createScorecardContext() {
  const scriptStart = scorecardHtml.indexOf("<script>") + "<script>".length;
  const scriptEnd = scorecardHtml.indexOf("</body>", scriptStart);
  const scorecardScript = scorecardHtml.slice(scriptStart, scriptEnd);
  const element = {
    addEventListener() {},
    appendChild() {},
    remove() {},
    classList: { add() {}, remove() {}, toggle() {} },
    style: {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    set innerHTML(_value: string) {},
    get innerHTML() { return ""; },
    value: "",
  };
  const context = {
    console,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    document: {
      body: element,
      addEventListener() {},
      createElement() { return element; },
      getElementById() { return element; },
      querySelector() { return element; },
      querySelectorAll() { return []; },
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    window: {},
    fetch() {},
  };
  vm.createContext(context);
  vm.runInContext(scorecardScript, context);
  return context as typeof context & {
    KpiAggregates: NormalizedAggregateResponse;
    normalizeKpiAggregates: (aggregates: unknown) => NormalizedAggregateResponse;
    getBusinessUnitYearAverages: (buId: string, year: number) => Record<string, number | null>;
    getPortfolioCurrentData: () => Record<string, number | null>;
    getSelectedYear: () => number;
  };
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

  it("loads saved May 2026 records through the UI fetch path with selected period filters", () => {
    const fetchSavedRecords = scorecardHtml.slice(
      scorecardHtml.indexOf("async function fetchSavedMonthlyKpiRecords(buId)"),
      scorecardHtml.indexOf("async function saveImportedMonthlyKpiRecords")
    );

    expect(fetchSavedRecords).toContain("params.set('reporting_year',String(getSelectedYear()))");
    expect(fetchSavedRecords).toContain("params.set('reporting_month',String(getSelectedMonth()))");
    expect(fetchSavedRecords).toContain("if(buId)params.set('business_unit',getBUApiValue(buId))");
    expect(fetchSavedRecords).toContain("'/api/monthly-kpi/records?'+params.toString()");
  });

  it("keeps current API-value rows from being overwritten by legacy alias rows in the UI", () => {
    expect(scorecardHtml).toContain("function shouldPreferPersistedKpiRow(nextRow,currentRecord,buId)");
    expect(scorecardHtml).toContain("if(!nextIsCurrent && currentIsCurrent)return false");
  });

  it("normalizes actual camelCase aggregate API responses for Summary Matrix rows and Portfolio KPI cards", () => {
    const context = createScorecardContext();
    const aggregateApiResponse = {
      reportingYear: 2026,
      byBusinessUnit: [
        {
          businessUnit: "AMD-EZ",
          reportingYear: 2026,
          recordCount: 2,
          pmCompliance: 99.33,
          scheduleCompliance: 96,
          budgetSpend: 101,
          pmCmWorkOrderRatio: 88,
          pmCmCostRatio: 62,
          mtbfDays: null,
          mttrDays: null,
          facilityUptime: 99.98,
        },
        {
          businessUnit: "Laguna Water",
          reportingYear: 2026,
          recordCount: 1,
          pmCompliance: 97,
          scheduleCompliance: 95,
          budgetSpend: 100,
          pmCmWorkOrderRatio: 86,
          pmCmCostRatio: 60,
          mtbfDays: null,
          mttrDays: null,
          facilityUptime: 99.97,
        },
      ],
      byBusinessUnitMap: {
        "AMD-EZ": {
          businessUnit: "AMD-EZ",
          reportingYear: 2026,
          recordCount: 2,
          pmCompliance: 99.33,
          scheduleCompliance: 96,
          budgetSpend: 101,
          pmCmWorkOrderRatio: 88,
          pmCmCostRatio: 62,
          mtbfDays: null,
          mttrDays: null,
          facilityUptime: 99.98,
        },
        "Laguna Water": {
          businessUnit: "Laguna Water",
          reportingYear: 2026,
          recordCount: 1,
          pmCompliance: 97,
          scheduleCompliance: 95,
          budgetSpend: 100,
          pmCmWorkOrderRatio: 86,
          pmCmCostRatio: 60,
          mtbfDays: null,
          mttrDays: null,
          facilityUptime: 99.97,
        },
      },
      portfolioYearAverage: {
        pmCompliance: 98.17,
        scheduleCompliance: 95.5,
        budgetSpend: 100.5,
        pmCmWorkOrderRatio: 87,
        pmCmCostRatio: 61,
        mtbfDays: null,
        mttrDays: null,
        facilityUptime: 99.975,
      },
      portfolioMonthlyAverages: {
        1: {
          pmCompliance: 98.17,
          scheduleCompliance: 95.5,
          budgetSpend: 100.5,
          pmCmWorkOrderRatio: 87,
          pmCmCostRatio: 61,
          mtbfDays: null,
          mttrDays: null,
          facilityUptime: 99.975,
        },
      },
    };

    context.KpiAggregates = context.normalizeKpiAggregates(aggregateApiResponse);
    context.getSelectedYear = () => 2026;

    expect(context.KpiAggregates.byBusinessUnitMap["AMD-EZ"]).toBe(context.KpiAggregates.byBusinessUnitMap.ez);
    expect(context.KpiAggregates.byBusinessUnitMap["Laguna Water"]).toBe(context.KpiAggregates.byBusinessUnitMap.laguna);
    expect(context.KpiAggregates.byBusinessUnitMap.ez.pmCmWorkOrderRatio).toBe(88);
    expect(context.KpiAggregates.byBusinessUnitMap.ez.pm_cm_work_order_ratio).toBe(88);
    expect(context.KpiAggregates.byBusinessUnitMap.ez.pmcmWORatio).toBe(88);
    expect(context.getBusinessUnitYearAverages("ez", 2026).pmcmWORatio).toBe(88);
    expect(context.getBusinessUnitYearAverages("laguna", 2026).facilityUptime).toBe(99.97);
    expect(context.KpiAggregates.portfolioYearAverage.pmCmCostRatio).toBe(61);
    expect(context.KpiAggregates.portfolioYearAverage.pm_cm_cost_ratio).toBe(61);
    expect(context.KpiAggregates.portfolioYearAverage.pmcmCostRatio).toBe(61);
    expect(context.getPortfolioCurrentData().pmcmCostRatio).toBe(61);
  });

  it("adds all required business-unit aliases to aggregate maps", () => {
    const context = createScorecardContext();
    const aggregate = (businessUnit: string) => ({
      businessUnit,
      reportingYear: 2026,
      recordCount: 1,
      pmCompliance: 95,
      scheduleCompliance: null,
      budgetSpend: null,
      pmCmWorkOrderRatio: null,
      pmCmCostRatio: null,
      mtbfDays: null,
      mttrDays: null,
      facilityUptime: null,
    });

    context.KpiAggregates = context.normalizeKpiAggregates({
      reportingYear: 2026,
      byBusinessUnit: [
        aggregate("AMD-EZ"),
        aggregate("Laguna Water"),
        aggregate("Clark Water"),
        aggregate("Tagum Water"),
        aggregate("Estate Water"),
      ],
      byBusinessUnitMap: {},
      portfolioYearAverage: aggregate("Portfolio"),
      portfolioMonthlyAverages: {},
    });

    expect(context.KpiAggregates.byBusinessUnitMap["AMD-EZ"]).toBe(context.KpiAggregates.byBusinessUnitMap.ez);
    expect(context.KpiAggregates.byBusinessUnitMap["Laguna Water"]).toBe(context.KpiAggregates.byBusinessUnitMap.laguna);
    expect(context.KpiAggregates.byBusinessUnitMap["Clark Water"]).toBe(context.KpiAggregates.byBusinessUnitMap.clark);
    expect(context.KpiAggregates.byBusinessUnitMap["Tagum Water"]).toBe(context.KpiAggregates.byBusinessUnitMap.tagum);
    expect(context.KpiAggregates.byBusinessUnitMap["Estate Water"]).toBe(context.KpiAggregates.byBusinessUnitMap.estate);
  });

});
