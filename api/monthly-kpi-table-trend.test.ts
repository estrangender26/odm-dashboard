import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const scorecardHtml = readFileSync("./public/scorecard-kpi.html", "utf-8");
const scorecardScript = scorecardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] || "";

function createMockXLSX() {
  return {
    SSF: {
      parse_date_code(value: number) {
        const epoch = new Date(1899, 11, 30);
        const date = new Date(epoch.getTime() + value * 24 * 60 * 60 * 1000);
        return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
      },
    },
    utils: {
      encode_cell({ r, c }: { r: number; c: number }) {
        return String.fromCharCode(65 + c) + (r + 1);
      },
      sheet_to_json(sheet: { _rows?: unknown[][] }, opts: any) {
        if (opts.header === 1 && Array.isArray(sheet._rows)) {
          return sheet._rows.map((row) =>
            Array.isArray(row) ? row.map((cell) => (cell && typeof cell === "object" && "v" in cell ? (cell as { v: unknown }).v : cell)) : []
          );
        }
        return [];
      },
    },
  };
}

function createContext() {
  const element: any = {
    addEventListener() {}, appendChild() {}, remove() {},
    classList: { add() {}, remove() {}, toggle() {} }, style: {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    set innerHTML(_: string) {}, get innerHTML() { return ""; },
    value: "2026", focus() {},
  };
  const ctx: any = {
    console,
    setTimeout,
    XLSX: createMockXLSX(),
    window: {},
    document: {
      getElementById: () => element,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      body: element,
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    Chart: function() { return { destroy() {} }; },
    FileReader: class { onload: any; readAsArrayBuffer() { setTimeout(() => this.onload?.({ target: { result: new ArrayBuffer(0) } }), 0); } },
  };
  vm.createContext(ctx);
  vm.runInContext(scorecardScript, ctx);
  return ctx;
}

function makeBaseRecord(month: number, overrides: any = {}) {
  return {
    business_unit: "AMD-EZ",
    reporting_year: 2026,
    reporting_month: month,
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
    total_downtime: null,
    number_of_repairs: null,
    total_operating_time: null,
    notes: null,
    raw_imported_values: { values: {} },
    ...overrides,
  };
}

describe("monthly records table trend values", () => {
  it("computes cumulative Budget Spend and running average PM Compliance", () => {
    const ctx = createContext();
    const records = [
      makeBaseRecord(1, { actual_spend: 100, budget: 100, pm_orders_completed_on_time: 90, total_pm_orders: 100 }),
      makeBaseRecord(2, { actual_spend: 150, budget: 100, pm_orders_completed_on_time: 95, total_pm_orders: 100 }),
      makeBaseRecord(3, { actual_spend: 50, budget: 100, pm_orders_completed_on_time: 100, total_pm_orders: 100 }),
    ];
    records.forEach((r: any) => ctx.computeImportedMonthlyKpis(r));

    const feb = ctx.computeTrendKpiValuesForMonth(records, 2);
    expect(feb.budgetSpend).toBeCloseTo(((100 + 150) / (100 + 100)) * 100, 2);
    expect(feb.pmCompliance).toBeCloseTo((90 + 95) / 2, 2);

    const mar = ctx.computeTrendKpiValuesForMonth(records, 3);
    expect(mar.budgetSpend).toBeCloseTo(((100 + 150 + 50) / (100 + 100 + 100)) * 100, 2);
    expect(mar.pmCompliance).toBeCloseTo((90 + 95 + 100) / 3, 2);

    const apr = ctx.computeTrendKpiValuesForMonth(records, 4);
    expect(apr.budgetSpend).toBeNull();
    expect(apr.pmCompliance).toBeNull();
  });

  it("computes cumulative PM:CM Work Orders and PM:CM Cost", () => {
    const ctx = createContext();
    const records = [
      makeBaseRecord(1, { pm_work_orders: 60, cm_work_orders: 10, pm_cost: 6000, cm_cost: 1000 }),
      makeBaseRecord(2, { pm_work_orders: 50, cm_work_orders: 20, pm_cost: 5000, cm_cost: 2000 }),
      makeBaseRecord(3, { pm_work_orders: 70, cm_work_orders: 5, pm_cost: 7000, cm_cost: 500 }),
    ];
    records.forEach((r: any) => ctx.computeImportedMonthlyKpis(r));

    const feb = ctx.computeTrendKpiValuesForMonth(records, 2);
    expect(feb.pmcmWORatio).toBeCloseTo(((60 + 50) / ((60 + 50) + (10 + 20))) * 100, 2);
    expect(feb.pmcmCostRatio).toBeCloseTo(((6000 + 5000) / ((6000 + 5000) + (1000 + 2000))) * 100, 2);

    const mar = ctx.computeTrendKpiValuesForMonth(records, 3);
    expect(mar.pmcmWORatio).toBeCloseTo(((60 + 50 + 70) / ((60 + 50 + 70) + (10 + 20 + 5))) * 100, 2);
    expect(mar.pmcmCostRatio).toBeCloseTo(((6000 + 5000 + 7000) / ((6000 + 5000 + 7000) + (1000 + 2000 + 500))) * 100, 2);

    const apr = ctx.computeTrendKpiValuesForMonth(records, 4);
    expect(apr.pmcmWORatio).toBeNull();
    expect(apr.pmcmCostRatio).toBeNull();
  });

  it("computes cumulative MTTR as sum of monthly MTTR days", () => {
    const ctx = createContext();
    const records = [
      makeBaseRecord(1, { mttr_days: 8 }),
      makeBaseRecord(2, { mttr_days: 12 }),
      makeBaseRecord(3, { mttr_days: 0 }),
    ];
    records.forEach((r: any) => ctx.computeImportedMonthlyKpis(r));

    const feb = ctx.computeTrendKpiValuesForMonth(records, 2);
    expect(feb.mttr).toBeCloseTo(8 + 12, 2);

    const mar = ctx.computeTrendKpiValuesForMonth(records, 3);
    expect(mar.mttr).toBeCloseTo(8 + 12 + 0, 2);
  });

  it("falls back to legacy generic downtime/repair fields for monthly MTTR", () => {
    const ctx = createContext();
    const records = [
      makeBaseRecord(1, { mttr_days: 10 }),
      makeBaseRecord(2, { mttr_days: 20 }),
    ];
    records.forEach((r: any) => ctx.computeImportedMonthlyKpis(r));

    const feb = ctx.computeTrendKpiValuesForMonth(records, 2);
    expect(feb.mttr).toBeCloseTo(10 + 20, 2);
  });

  it("computes running average Facility Uptime", () => {
    const ctx = createContext();
    const records = [
      makeBaseRecord(1, { facility_operating_time: 744, facility_downtime: 0 }),
      makeBaseRecord(2, { facility_operating_time: 672, facility_downtime: 0 }),
      makeBaseRecord(3, { facility_operating_time: 744, facility_downtime: 24 }),
    ];
    records.forEach((r: any) => ctx.computeImportedMonthlyKpis(r));

    const feb = ctx.computeTrendKpiValuesForMonth(records, 2);
    expect(feb.facilityUptime).toBeCloseTo(100, 2);

    const mar = ctx.computeTrendKpiValuesForMonth(records, 3);
    const janUptime = ((744 - 0) / 744) * 100;
    const febUptime = ((672 - 0) / 672) * 100;
    const marUptime = ((744 - 24) / 744) * 100;
    expect(mar.facilityUptime).toBeCloseTo((janUptime + febUptime + marUptime) / 3, 2);
  });

  it("does not carry forward values for blank future months", () => {
    const ctx = createContext();
    const records = [
      makeBaseRecord(1, { actual_spend: 100, budget: 100, pm_orders_completed_on_time: 90, total_pm_orders: 100 }),
      makeBaseRecord(2, { actual_spend: 150, budget: 100, pm_orders_completed_on_time: 95, total_pm_orders: 100 }),
    ];
    records.forEach((r: any) => ctx.computeImportedMonthlyKpis(r));

    for (let m = 4; m <= 12; m++) {
      const trend = ctx.computeTrendKpiValuesForMonth(records, m);
      expect(trend.budgetSpend, `month ${m} budgetSpend`).toBeNull();
      expect(trend.pmCompliance, `month ${m} pmCompliance`).toBeNull();
      expect(trend.pmcmWORatio, `month ${m} pmcmWORatio`).toBeNull();
      expect(trend.pmcmCostRatio, `month ${m} pmcmCostRatio`).toBeNull();
      expect(trend.mttr, `month ${m} mttr`).toBeNull();
      expect(trend.facilityUptime, `month ${m} facilityUptime`).toBeNull();
    }
  });

  it("keeps Notes unchanged while computing trend values", () => {
    const ctx = createContext();
    const records = [
      makeBaseRecord(1, { actual_spend: 100, budget: 100, notes: "Q1 note" }),
      makeBaseRecord(2, { actual_spend: 150, budget: 100 }),
    ];
    records.forEach((r: any) => ctx.computeImportedMonthlyKpis(r));

    const feb = ctx.computeTrendKpiValuesForMonth(records, 2);
    expect(feb.budgetSpend).toBeCloseTo(((100 + 150) / (100 + 100)) * 100, 2);
    expect(records[0].notes).toBe("Q1 note");
  });

  it("uses snake_case computed KPI values when camelCase keys are missing", () => {
    const ctx = createContext();
    const records = [
      makeBaseRecord(1, { pm_orders_completed_on_time: 90, total_pm_orders: 100 }),
      makeBaseRecord(2, { pm_orders_completed_on_time: 80, total_pm_orders: 100 }),
    ];
    records.forEach((r: any) => ctx.computeImportedMonthlyKpis(r));

    const feb = ctx.computeTrendKpiValuesForMonth(records, 2);
    expect(feb.pmCompliance).toBeCloseTo((90 + 80) / 2, 2);
  });
});
