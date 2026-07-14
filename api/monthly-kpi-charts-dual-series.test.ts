import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const scorecardHtml = readFileSync("./public/scorecard-kpi.html", "utf-8");
const scorecardScript = scorecardHtml.match(/\u003cscript\u003e([\s\S]*?)\u003c\/script\u003e/)?.[1] || "";

function createScorecardContext() {
  const capturedCharts: any[] = [];
  const element: any = {
    addEventListener() {},
    appendChild() {},
    remove() {},
    classList: { add() {}, remove() {}, toggle() {} },
    style: {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    set innerHTML(_: string) {},
    get innerHTML() { return ""; },
    set textContent(_: string) {},
    get textContent() { return ""; },
    value: "",
  };
  const Chart = class {
    public config: any;
    public data: any;
    public options: any;
    public type: any;
    constructor(ctxOrConfig: any, config?: any) {
      const resolved = config || ctxOrConfig;
      this.config = resolved;
      this.data = resolved?.data;
      this.options = resolved?.options;
      this.type = resolved?.type;
      capturedCharts.push(this);
    }
    destroy() {}
    toBase64Image() { return "data:image/png;base64,FAKE"; }
    static register() {}
  };
  const yearSelect = { ...element, value: "2026" };
  const context: any = {
    console,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    window: {},
    document: {
      body: element,
      addEventListener() {},
      createElement() { return { ...element, href: "", download: "", click() {} }; },
      getElementById(id: string) {
        if (id === "yearSel") return yearSelect;
        return element;
      },
      querySelector() { return element; },
      querySelectorAll() { return []; },
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    Chart,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  };
  vm.createContext(context);
  vm.runInContext(scorecardScript, context);
  const ctxAny = context as any;
  ctxAny.renderBUChartsForTest = ctxAny.renderBUCharts;
  ctxAny.loadData = () => {};
  ctxAny.renderBUCharts = () => {};
  ctxAny.renderSummaryDashboard = () => {};
  ctxAny.updateChartLoadingOverlays = () => {};
  ctxAny.fetchMonthlyKpiAggregates = async () => {};
  ctxAny.fetchSavedMonthlyKpiRecords = async () => {};
  ctxAny.refreshBusinessUnitSelectors = () => { ctxAny.initBusinessUnitSelector(); };
  return { context: ctxAny, capturedCharts };
}

describe("Monthly KPI chart dual series", () => {
  it("renders Monthly Actual and YTD/Trend datasets for summary charts", () => {
    const { context, capturedCharts } = createScorecardContext();
    context.KpiAggregates = context.normalizeKpiAggregates({
      reportingYear: 2026,
      byBusinessUnit: [],
      byBusinessUnitMap: {},
      portfolioYearAverage: {},
      portfolioMonthlyAverages: {
        1: { pmCompliance: 90, budgetSpend: 100, pmCmWorkOrderRatio: 80, pmCmCostRatio: 75, mttrDays: 5, facilityUptime: 99 },
        2: { pmCompliance: 92, budgetSpend: 110, pmCmWorkOrderRatio: 82, pmCmCostRatio: 76, mttrDays: 6, facilityUptime: 99.5 },
      },
      portfolioMonthlyActuals: {
        1: { pmCompliance: 90, budgetSpend: 100, pmCmWorkOrderRatio: 80, pmCmCostRatio: 75, mttrDays: 5, facilityUptime: 99 },
        2: { pmCompliance: 94, budgetSpend: 120, pmCmWorkOrderRatio: 84, pmCmCostRatio: 77, mttrDays: 7, facilityUptime: 100 },
      },
    });
    context.renderSummaryCharts();

    expect(capturedCharts.length).toBe(6);
    const firstChart = capturedCharts[0];
    expect(firstChart.data.datasets).toHaveLength(2);
    const labels = firstChart.data.datasets.map((ds: any) => ds.label);
    expect(labels).toContain("Monthly Actual");
    expect(labels).toContain("YTD / Trend");
  });

  it("summary chart Budget Spend YTD/Trend is cumulative while Monthly Actual is monthly", () => {
    const { context, capturedCharts } = createScorecardContext();
    context.KpiAggregates = context.normalizeKpiAggregates({
      reportingYear: 2026,
      byBusinessUnit: [],
      byBusinessUnitMap: {},
      portfolioYearAverage: {},
      portfolioMonthlyAverages: {
        1: { budgetSpend: 100 },
        2: { budgetSpend: 125 },
      },
      portfolioMonthlyActuals: {
        1: { budgetSpend: 100 },
        2: { budgetSpend: 150 },
      },
    });
    context.renderSummaryCharts();

    const budgetChart = capturedCharts.find((chart: any) =>
      chart.options?.scales?.y?.title?.text === "Budget Spend %"
    );
    expect(budgetChart).toBeDefined();
    const trendDataset = budgetChart.data.datasets.find((ds: any) => ds.label === "YTD / Trend");
    const actualDataset = budgetChart.data.datasets.find((ds: any) => ds.label === "Monthly Actual");
    expect(trendDataset.data[0]).toBeCloseTo(100, 2);
    expect(trendDataset.data[1]).toBeCloseTo(125, 2);
    expect(actualDataset.data[0]).toBeCloseTo(100, 2);
    expect(actualDataset.data[1]).toBeCloseTo(150, 2);
  });

  it("summary chart PM Compliance YTD/Trend is running average while Monthly Actual is monthly", () => {
    const { context, capturedCharts } = createScorecardContext();
    context.KpiAggregates = context.normalizeKpiAggregates({
      reportingYear: 2026,
      byBusinessUnit: [],
      byBusinessUnitMap: {},
      portfolioYearAverage: {},
      portfolioMonthlyAverages: {
        1: { pmCompliance: 90 },
        2: { pmCompliance: 92.5 },
      },
      portfolioMonthlyActuals: {
        1: { pmCompliance: 90 },
        2: { pmCompliance: 95 },
      },
    });
    context.renderSummaryCharts();

    const pmChart = capturedCharts.find((chart: any) =>
      chart.options?.scales?.y?.title?.text === "PM Compliance %"
    );
    expect(pmChart).toBeDefined();
    const trendDataset = pmChart.data.datasets.find((ds: any) => ds.label === "YTD / Trend");
    const actualDataset = pmChart.data.datasets.find((ds: any) => ds.label === "Monthly Actual");
    expect(trendDataset.data[0]).toBeCloseTo(90, 2);
    expect(trendDataset.data[1]).toBeCloseTo(92.5, 2);
    expect(actualDataset.data[0]).toBeCloseTo(90, 2);
    expect(actualDataset.data[1]).toBeCloseTo(95, 2);
  });

  it("computeTrendKpiValuesForMonth computes cumulative Budget Spend for BU charts", () => {
    const { context } = createScorecardContext();
    const records = [
      {
        business_unit: "AMD-EZ",
        reporting_year: 2026,
        reporting_month: 1,
        budgetSpend: 100,
        budget_spend: 100,
        actual_spend: 100,
        budget: 100,
      },
      {
        business_unit: "AMD-EZ",
        reporting_year: 2026,
        reporting_month: 2,
        budgetSpend: 150,
        budget_spend: 150,
        actual_spend: 150,
        budget: 100,
      },
    ];
    const feb = context.computeTrendKpiValuesForMonth(records, 2);
    expect(feb.budgetSpend).toBeCloseTo(((100 + 150) / (100 + 100)) * 100, 2);
  });

  it("plots LARC Budget Spend through the latest submitted Actual Spend month", () => {
    const { context, capturedCharts } = createScorecardContext();
    const months = [
      { month: 1, actual: 1600, budget: 0, monthly: null, pm: 91 },
      { month: 2, actual: 128728.1, budget: 262000, monthly: 49.13, pm: 92 },
      { month: 3, actual: 26628.1, budget: 200000, monthly: 13.31, pm: 93 },
      { month: 4, actual: 89600, budget: 0, monthly: null, pm: null },
      { month: 5, actual: 0, budget: 262000, monthly: 0, pm: null },
      { month: 6, actual: 0, budget: 200000, monthly: 0, pm: null },
      { month: 7, actual: null, budget: 0, monthly: null, pm: null },
      { month: 8, actual: null, budget: 262000, monthly: null, pm: null },
      { month: 9, actual: null, budget: 200000, monthly: null, pm: null },
      { month: 10, actual: null, budget: 0, monthly: null, pm: null },
      { month: 11, actual: null, budget: 262000, monthly: null, pm: null },
      { month: 12, actual: null, budget: 200000, monthly: null, pm: null },
    ];
    context.applyPersistedMonthlyKpiRecords(months.map((entry) => ({
      business_unit: "LARC",
      reporting_year: 2026,
      reporting_month: entry.month,
      actual_spend: entry.actual,
      budget: entry.budget,
      budget_spend: entry.monthly,
      pm_compliance: entry.pm,
      pm_orders_completed_on_time: entry.pm,
      total_pm_orders: entry.pm === null ? null : 100,
    })), { reset: true });

    context.renderBUChartsForTest("larc");

    const budgetChart = capturedCharts.find((chart: any) =>
      chart.options?.scales?.y?.title?.text === "Budget Spend %"
    );
    const actual = budgetChart.data.datasets.find((dataset: any) => dataset.label === "Monthly Actual").data;
    const trend = budgetChart.data.datasets.find((dataset: any) => dataset.label === "YTD / Trend").data;
    expect(actual.slice(0, 6)).toEqual([null, 49.13, 13.31, null, 0, 0]);
    expect(actual.slice(6)).toEqual([null, null, null, null, null, null]);
    expect(trend[0]).toBeNull();
    expect(trend[1]).toBeCloseTo(49.74, 2);
    expect(trend[2]).toBeCloseTo(33.97, 2);
    expect(trend[3]).toBeCloseTo(53.37, 2);
    expect(trend[4]).toBeCloseTo(34.05, 2);
    expect(trend[5]).toBeCloseTo(26.68, 2);
    expect(trend.slice(6)).toEqual([null, null, null, null, null, null]);

    const tooltipLabel = budgetChart.options.plugins.tooltip.callbacks.label;
    expect(tooltipLabel({ dataset: { label: "Monthly Actual" }, parsed: { y: 0 }, dataIndex: 4 })).toContain("0.00");
    expect(tooltipLabel({ dataset: { label: "Monthly Actual" }, parsed: { y: null }, dataIndex: 3 })).toContain("No Data");

    const pmChart = capturedCharts.find((chart: any) =>
      chart.options?.scales?.y?.title?.text === "PM Compliance %"
    );
    expect(pmChart.data.datasets.find((dataset: any) => dataset.label === "Monthly Actual").data.slice(0, 6)).toEqual([91, 92, 93, null, null, null]);
    expect(pmChart.data.datasets.find((dataset: any) => dataset.label === "YTD / Trend").data.slice(0, 6)).toEqual([91, 91.5, 92, null, null, null]);
  });

  it("computeTrendKpiValuesForMonth computes running average PM Compliance for BU charts", () => {
    const { context } = createScorecardContext();
    const records = [
      {
        business_unit: "AMD-EZ",
        reporting_year: 2026,
        reporting_month: 1,
        pmCompliance: 90,
        pm_compliance: 90,
        pm_orders_completed_on_time: 90,
        total_pm_orders: 100,
      },
      {
        business_unit: "AMD-EZ",
        reporting_year: 2026,
        reporting_month: 2,
        pmCompliance: 95,
        pm_compliance: 95,
        pm_orders_completed_on_time: 95,
        total_pm_orders: 100,
      },
    ];
    const feb = context.computeTrendKpiValuesForMonth(records, 2);
    expect(feb.pmCompliance).toBeCloseTo((90 + 95) / 2, 2);
  });

  it("computeTrendKpiValuesForMonth leaves future months null", () => {
    const { context } = createScorecardContext();
    const records = [
      {
        business_unit: "AMD-EZ",
        reporting_year: 2026,
        reporting_month: 1,
        budgetSpend: 100,
        budget_spend: 100,
        actual_spend: 100,
        budget: 100,
      },
    ];
    const may = context.computeTrendKpiValuesForMonth(records, 5);
    expect(may.budgetSpend).toBeNull();
    expect(may.pmCompliance).toBeNull();
  });

  it("chart options enable legend and use bar for Monthly Actual and line for YTD/Trend", () => {
    const { context, capturedCharts } = createScorecardContext();
    context.KpiAggregates = context.normalizeKpiAggregates({
      reportingYear: 2026,
      byBusinessUnit: [],
      byBusinessUnitMap: {},
      portfolioYearAverage: {},
      portfolioMonthlyAverages: {
        1: { budgetSpend: 100 },
      },
      portfolioMonthlyActuals: {
        1: { budgetSpend: 100 },
      },
    });
    context.renderSummaryCharts();

    const chart = capturedCharts[0];
    expect(chart.options.plugins.legend.display).toBe(true);
    const monthlyActualDataset = chart.data.datasets.find((ds: any) => ds.label === "Monthly Actual");
    const trendDataset = chart.data.datasets.find((ds: any) => ds.label === "YTD / Trend");
    expect(monthlyActualDataset.type).toBe("bar");
    expect(trendDataset.type).toBe("line");
  });
});
