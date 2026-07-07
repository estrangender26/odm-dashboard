import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { aggregateMonthlyKpiRecords } from "../src/modules/monthly-kpi/kpiAggregation";

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
  ctxAny.loadData = () => {};
  ctxAny.renderSummaryDashboard = () => {};
  ctxAny.updateChartLoadingOverlays = () => {};
  ctxAny.fetchMonthlyKpiAggregates = async () => {};
  ctxAny.fetchSavedMonthlyKpiRecords = async () => {};
  ctxAny.refreshBusinessUnitSelectors = () => { ctxAny.initBusinessUnitSelector(); };
  return { context: ctxAny, capturedCharts };
}

function baseRecord(month: number, kpiKey: string, value: number) {
  const record: any = {
    id: month,
    business_unit: "AMD-EZ",
    reporting_year: 2026,
    reporting_month: month,
    pm_compliance: null,
    budget_spend: null,
    pm_cm_work_order_ratio: null,
    pm_cm_cost_ratio: null,
    mttr_days: null,
    facility_uptime: null,
    actual_spend: null,
    budget: null,
    pm_orders_completed_on_time: null,
    total_pm_orders: null,
    pm_work_orders: null,
    cm_work_orders: null,
    pm_cost: null,
    cm_cost: null,
    mttr_downtime: null,
    repair_count: null,
    facility_operating_time: null,
    facility_downtime: null,
  };
  switch (kpiKey) {
    case "budgetSpend":
      record.budget_spend = value;
      record.actual_spend = value;
      record.budget = 100;
      break;
    case "pmcmWORatio":
      record.pm_cm_work_order_ratio = value;
      record.pm_work_orders = value;
      record.cm_work_orders = 20;
      break;
    case "pmcmCostRatio":
      record.pm_cm_cost_ratio = value;
      record.pm_cost = value;
      record.cm_cost = 25;
      break;
    case "mttr":
      record.mttr_days = value;
      record.mttr_downtime = value;
      record.repair_count = 1;
      break;
    case "pmCompliance":
      record.pm_compliance = value;
      record.pm_orders_completed_on_time = value;
      record.total_pm_orders = 100;
      break;
    case "facilityUptime":
      record.facility_uptime = value;
      record.facility_operating_time = 744;
      record.facility_downtime = 7.44;
      break;
  }
  return record;
}

function findChart(capturedCharts: any[], title: string) {
  return capturedCharts.find((c: any) => c.options?.scales?.y?.title?.text === title);
}

describe("Monthly KPI chart YTD/Trend carry-forward prevention", () => {
  it("Budget Spend YTD/Trend does not carry forward past last actual month", () => {
    const { context, capturedCharts } = createScorecardContext();
    context.applyPersistedMonthlyKpiRecords(
      [1, 2].map((m) => baseRecord(m, "budgetSpend", 100 + (m - 1) * 50)),
      { businessUnitId: "ez" }
    );
    context.renderBUCharts("ez");
    const chart = findChart(capturedCharts, "Budget Spend %");
    expect(chart).toBeDefined();
    const trendDataset = chart.data.datasets.find((ds: any) => ds.label === "YTD / Trend");
    expect(trendDataset.data[0]).toBeCloseTo(100, 2);
    expect(trendDataset.data[1]).toBeCloseTo(((100 + 150) / 200) * 100, 2);
    expect(trendDataset.data[2]).toBeNull();
    expect(trendDataset.data[11]).toBeNull();
  });

  it("PM:CM WO YTD/Trend does not carry forward past last actual month", () => {
    const { context, capturedCharts } = createScorecardContext();
    context.applyPersistedMonthlyKpiRecords(
      [1, 2].map((m) => baseRecord(m, "pmcmWORatio", 80 + m)),
      { businessUnitId: "ez" }
    );
    context.renderBUCharts("ez");
    const chart = findChart(capturedCharts, "PM:CM WO %");
    const trendDataset = chart.data.datasets.find((ds: any) => ds.label === "YTD / Trend");
    expect(trendDataset.data[2]).toBeNull();
    expect(trendDataset.data[11]).toBeNull();
  });

  it("PM:CM Cost YTD/Trend does not carry forward past last actual month", () => {
    const { context, capturedCharts } = createScorecardContext();
    context.applyPersistedMonthlyKpiRecords(
      [1, 2].map((m) => baseRecord(m, "pmcmCostRatio", 75 + m)),
      { businessUnitId: "ez" }
    );
    context.renderBUCharts("ez");
    const chart = findChart(capturedCharts, "PM:CM Cost %");
    const trendDataset = chart.data.datasets.find((ds: any) => ds.label === "YTD / Trend");
    expect(trendDataset.data[2]).toBeNull();
    expect(trendDataset.data[11]).toBeNull();
  });

  it("MTTR YTD/Trend does not carry forward past last actual month", () => {
    const { context, capturedCharts } = createScorecardContext();
    context.applyPersistedMonthlyKpiRecords(
      [1, 2].map((m) => baseRecord(m, "mttr", 5 + m)),
      { businessUnitId: "ez" }
    );
    context.renderBUCharts("ez");
    const chart = findChart(capturedCharts, "MTTR days");
    const trendDataset = chart.data.datasets.find((ds: any) => ds.label === "YTD / Trend");
    expect(trendDataset.data[0]).toBeCloseTo(6, 2);
    expect(trendDataset.data[1]).toBeCloseTo((6 + 7) / 2, 2);
    expect(trendDataset.data[2]).toBeNull();
    expect(trendDataset.data[11]).toBeNull();
  });

  it("PM Compliance YTD/Trend does not carry forward past last actual month", () => {
    const { context, capturedCharts } = createScorecardContext();
    context.applyPersistedMonthlyKpiRecords(
      [1, 2].map((m) => baseRecord(m, "pmCompliance", 90 + m)),
      { businessUnitId: "ez" }
    );
    context.renderBUCharts("ez");
    const chart = findChart(capturedCharts, "PM Compliance %");
    const trendDataset = chart.data.datasets.find((ds: any) => ds.label === "YTD / Trend");
    expect(trendDataset.data[0]).toBeCloseTo(91, 2);
    expect(trendDataset.data[1]).toBeCloseTo((91 + 92) / 2, 2);
    expect(trendDataset.data[2]).toBeNull();
    expect(trendDataset.data[11]).toBeNull();
  });

  it("Facility Uptime YTD/Trend does not carry forward past last actual month", () => {
    const { context, capturedCharts } = createScorecardContext();
    context.applyPersistedMonthlyKpiRecords(
      [1, 2].map((m) => baseRecord(m, "facilityUptime", 99 + m * 0.5)),
      { businessUnitId: "ez" }
    );
    context.renderBUCharts("ez");
    const chart = findChart(capturedCharts, "Facility Uptime %");
    const trendDataset = chart.data.datasets.find((ds: any) => ds.label === "YTD / Trend");
    expect(trendDataset.data[2]).toBeNull();
    expect(trendDataset.data[11]).toBeNull();
  });

  it("Budget Spend cumulative calculation still uses all prior months with data", () => {
    const { context } = createScorecardContext();
    const records = [1, 2, 3].map((m) => baseRecord(m, "budgetSpend", 100 + (m - 1) * 50));
    const mar = context.computeTrendKpiValuesForMonth(records, 3);
    expect(mar.budgetSpend).toBeCloseTo(((100 + 150 + 200) / 300) * 100, 2);
  });

  it("summary chart YTD/Trend stops at last month with actual data", () => {
    const { context, capturedCharts } = createScorecardContext();
    context.KpiAggregates = context.normalizeKpiAggregates({
      reportingYear: 2026,
      byBusinessUnit: [],
      byBusinessUnitMap: {},
      portfolioYearAverage: {},
      portfolioMonthlyAverages: {
        1: { budgetSpend: 100 },
        2: { budgetSpend: 125 },
        3: { budgetSpend: 140 },
      },
      portfolioMonthlyActuals: {
        1: { budgetSpend: 100 },
        2: { budgetSpend: 150 },
        3: { budgetSpend: 170 },
      },
    });
    context.renderSummaryCharts();
    const chart = findChart(capturedCharts, "Budget Spend %");
    const trendDataset = chart.data.datasets.find((ds: any) => ds.label === "YTD / Trend");
    expect(trendDataset.data[0]).toBeCloseTo(100, 2);
    expect(trendDataset.data[1]).toBeCloseTo(125, 2);
    expect(trendDataset.data[2]).toBeCloseTo(140, 2);
    expect(trendDataset.data[3]).toBeNull();
    expect(trendDataset.data[11]).toBeNull();
  });

  it("MTTR YTD is weighted downtime over repairs, not sum or simple average", () => {
    const { context } = createScorecardContext();
    const records = [
      { business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, mttr_days: 10, mttr_downtime: 10, repair_count: 1 },
      { business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, mttr_days: 5, mttr_downtime: 30, repair_count: 6 },
    ];
    const feb = context.computeTrendKpiValuesForMonth(records, 2);
    // Weighted YTD MTTR = (10 + 30) / (1 + 6) = 40 / 7 ≈ 5.71
    // Not (10 + 5) / 2 = 7.5, not 10 + 5 = 15.
    expect(feb.mttr).toBeCloseTo(40 / 7, 2);
    expect(feb.mttr).not.toBeCloseTo(7.5, 2);
    expect(feb.mttr).not.toBeCloseTo(15, 2);
  });

  it("backend MTTR YTD is weighted downtime over repairs", () => {
    const base = {
      pm_compliance: null,
      budget_spend: null,
      pm_cm_work_order_ratio: null,
      pm_cm_cost_ratio: null,
      mttr_days: null,
      facility_uptime: null,
    };
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, mttr_downtime: 10, repair_count: 1 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, mttr_downtime: 30, repair_count: 6 },
      ],
      2026
    );
    expect(result.byBusinessUnitMap["AMD-EZ"].mttrDays).toBeCloseTo(40 / 7, 2);
    expect(result.portfolioMonthlyAverages[2].mttrDays).toBeCloseTo(40 / 7, 2);
  });

  it("backend reconstructs MTTR downtime from monthly MTTR and repair count", () => {
    const base = {
      pm_compliance: null,
      budget_spend: null,
      pm_cm_work_order_ratio: null,
      pm_cm_cost_ratio: null,
      mttr_days: null,
      facility_uptime: null,
    };
    const result = aggregateMonthlyKpiRecords(
      [
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, mttr_days: 10, repair_count: 1 },
        { ...base, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 2, mttr_days: 5, repair_count: 6 },
      ],
      2026
    );
    expect(result.byBusinessUnitMap["AMD-EZ"].mttrDays).toBeCloseTo(40 / 7, 2);
  });

  it("MTTR future months are null", () => {
    const { context } = createScorecardContext();
    const records = [{ business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, mttr_days: 10, mttr_downtime: 10, repair_count: 1 }];
    const may = context.computeTrendKpiValuesForMonth(records, 5);
    expect(may.mttr).toBeNull();
  });
});

describe("summary chart per-KPI carry-forward prevention", () => {
  it("PM Compliance YTD stops after last month with PM Compliance source data, but PM:CM WO continues", () => {
    const { context, capturedCharts } = createScorecardContext();
    context.KpiAggregates = context.normalizeKpiAggregates({
      reportingYear: 2026,
      byBusinessUnit: [],
      byBusinessUnitMap: {},
      portfolioYearAverage: {},
      portfolioMonthlyAverages: {
        1: { pmCompliance: 90, pmCmWorkOrderRatio: 80 },
        2: { pmCompliance: 92.5, pmCmWorkOrderRatio: 82 },
        3: { pmCompliance: 94, pmCmWorkOrderRatio: 84 },
        4: { pmCompliance: null, pmCmWorkOrderRatio: 83 },
        5: { pmCompliance: null, pmCmWorkOrderRatio: 85 },
      },
      portfolioMonthlyActuals: {
        1: { pmCompliance: 90, pmCmWorkOrderRatio: 80 },
        2: { pmCompliance: 95, pmCmWorkOrderRatio: 84 },
        3: { pmCompliance: 97, pmCmWorkOrderRatio: 86 },
        4: { pmCompliance: null, pmCmWorkOrderRatio: 82 },
        5: { pmCompliance: null, pmCmWorkOrderRatio: 88 },
      },
    });
    context.renderSummaryCharts();

    const pmChart = findChart(capturedCharts, "PM Compliance %");
    const pmTrend = pmChart.data.datasets.find((ds: any) => ds.label === "YTD / Trend");
    expect(pmTrend.data[2]).toBeCloseTo(94, 2);
    expect(pmTrend.data[3]).toBeNull();
    expect(pmTrend.data[4]).toBeNull();

    const woChart = findChart(capturedCharts, "PM:CM WO %");
    const woTrend = woChart.data.datasets.find((ds: any) => ds.label === "YTD / Trend");
    expect(woTrend.data[4]).toBeCloseTo(85, 2);
    expect(woTrend.data[4]).not.toBeNull();
  });

  it("All-BU MTTR chart shows Monthly Actual bars and YTD line when MTTR source data exists", () => {
    const { context, capturedCharts } = createScorecardContext();
    context.KpiAggregates = context.normalizeKpiAggregates({
      reportingYear: 2026,
      byBusinessUnit: [],
      byBusinessUnitMap: {},
      portfolioYearAverage: { mttrDays: 26.4 },
      portfolioMonthlyAverages: {
        1: { mttrDays: 24 },
        2: { mttrDays: 17.4 },
        3: { mttrDays: 26.4 },
        4: { mttrDays: null },
      },
      portfolioMonthlyActuals: {
        1: { mttrDays: 24 },
        2: { mttrDays: 17.4 },
        3: { mttrDays: 26.4 },
        4: { mttrDays: null },
      },
    });
    context.renderSummaryCharts();

    const mttrChart = findChart(capturedCharts, "MTTR days");
    expect(mttrChart).toBeDefined();
    const actualDataset = mttrChart.data.datasets.find((ds: any) => ds.label === "Monthly Actual");
    const trendDataset = mttrChart.data.datasets.find((ds: any) => ds.label === "YTD / Trend");
    expect(actualDataset.data[0]).toBeCloseTo(24, 2);
    expect(actualDataset.data[1]).toBeCloseTo(17.4, 2);
    expect(actualDataset.data[3]).toBeNull();
    expect(trendDataset.data[2]).toBeCloseTo(26.4, 2);
    expect(trendDataset.data[3]).toBeNull();
  });
});
