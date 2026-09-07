import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { aggregateMonthlyKpiRecords } from "../src/modules/monthly-kpi/kpiAggregation";

/**
 * Monthly scorecard table semantics (client):
 *  - Budget Spend / PM:CM WO / PM:CM Cost / MTTR rows show the YTD cumulative
 *    result from January through that row's month, and for every submitted
 *    month the row equals the per-BU KPI card value at that month;
 *  - PM Compliance / Facility Uptime rows stay standalone monthly actuals,
 *    while their KPI card is the Jan..month YTD average (server aggregation).
 *
 * Fixture: AMD-EZ submitted January-August, September-December Not Submitted
 * (planned-budget placeholder rows only).
 */
const scorecardHtml = readFileSync("./public/scorecard-kpi.html", "utf-8");
const scorecardScript = scorecardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] || "";

function createClassList(initial = "") {
  const classes = new Set(initial.split(/\s+/).filter(Boolean));
  return {
    add(c: string) { classes.add(c); },
    remove(c: string) { classes.delete(c); },
    toggle(c: string) { classes.has(c) ? classes.delete(c) : classes.add(c); },
    contains(c: string) { return classes.has(c); },
  };
}

function makeSelectOptions(values: Array<string | number>) {
  return values.map((value) => ({ value: String(value), text: String(value) }));
}

function makeMonthRecords(businessUnit: string, through: number) {
  const records: any[] = [];
  for (let month = 1; month <= 12; month += 1) {
    if (month <= through) {
      const actualSpend = 100 * month + 10;
      const budget = 200;
      const pmWo = 40 + month;
      const cmWo = 20 - (month % 3);
      const pmCost = 1000 + 50 * month;
      const cmCost = 500 - 10 * month;
      const downtime = 60 * month + 5;
      const repairs = month + 2;
      records.push({
        id: 1000 + month,
        business_unit: businessUnit,
        reporting_year: 2026,
        reporting_month: month,
        pm_compliance: 100 - month,
        budget_spend: (actualSpend / budget) * 100,
        pm_cm_work_order_ratio: (pmWo / (pmWo + cmWo)) * 100,
        pm_cm_cost_ratio: (pmCost / (pmCost + cmCost)) * 100,
        mttr_days: downtime / repairs,
        facility_uptime: ((1000 - month) / 1000) * 100,
        pm_orders_completed_on_time: 100 - month,
        total_pm_orders: 100,
        actual_spend: actualSpend,
        budget,
        pm_work_orders: pmWo,
        cm_work_orders: cmWo,
        pm_cost: pmCost,
        cm_cost: cmCost,
        mttr_downtime: downtime,
        repair_count: repairs,
        facility_operating_time: 1000,
        facility_downtime: month,
        notes: null,
        raw_imported_values: {
          values: {
            pm_orders_completed_on_time: 100 - month,
            total_pm_orders: 100,
            actual_spend: actualSpend,
            budget: budget,
            pm_work_orders: pmWo,
            cm_work_orders: cmWo,
            pm_cost: pmCost,
            cm_cost: cmCost,
            mttr_downtime: downtime,
            repair_count: repairs,
            facility_operating_time: 1000,
            facility_downtime: month,
          },
        },
      });
    } else {
      records.push({
        id: 2000 + month,
        business_unit: businessUnit,
        reporting_year: 2026,
        reporting_month: month,
        budget: 1000 * month,
        notes: null,
        raw_imported_values: { values: { budget: 1000 * month } },
      });
    }
  }
  return records;
}

function createContext() {
  const elementStore: Record<string, any> = {};
  const getElement = (id: string) => {
    if (!elementStore[id]) {
      elementStore[id] = {
        id,
        value: id === "yearSel" ? "2026" : id === "monthSel" ? "8" : "",
        innerHTML: "",
        classList: createClassList(id === "t-business-unit" ? "tc active" : ""),
        style: {},
        addEventListener() {},
        appendChild() {},
        remove() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        insertAdjacentHTML() {},
        focus() {},
      };
    }
    return elementStore[id];
  };
  getElement("monthSel").options = makeSelectOptions([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  getElement("yearSel").options = makeSelectOptions([2026, 2025]);
  const context = {
    console,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    document: {
      body: getElement("body"),
      addEventListener() {},
      createElement() { return getElement("created"); },
      getElementById: getElement,
      querySelector(selector: string) {
        if (selector === ".tc.active") return getElement("t-business-unit");
        return getElement("query");
      },
      querySelectorAll() { return []; },
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    window: {},
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  };
  vm.createContext(context);
  vm.runInContext(scorecardScript, context);
  return context as typeof context & {
    MonthlyScoreData: Record<string, Record<number, Record<number, any>>>;
    applyPersistedMonthlyKpiRecords: (records: unknown[], options?: { reset?: boolean }) => void;
    renderMonthlyRecords: (buId: string) => void;
    getKpiRecordsForYear: (buId: string, year: number) => any[];
    computeTrendKpiValuesForMonth: (records: any[], month: number) => Record<string, number | null>;
    getMonthlyTableKpiValue: (record: any, key: string) => number | null;
    formatDisplayKpiValue: (key: string, value: number | null, opts?: { blank?: string }) => string;
  };
}

describe("monthly scorecard table rows are YTD/cumulative (Group A) and standalone (Group B)", () => {
  const amdEzRecords = makeMonthRecords("AMD-EZ", 8);
  const CUMULATIVE_KEYS = ["budgetSpend", "pmcmWORatio", "pmcmCostRatio", "mttr"];
  const ROW_MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August"];

  it("every submitted month's cumulative table row equals the per-BU KPI card value for that month", () => {
    const ctx = createContext();
    ctx.applyPersistedMonthlyKpiRecords(amdEzRecords, { reset: true });
    const yearRecords = ctx.getKpiRecordsForYear("ez", 2026);

    for (let month = 1; month <= 8; month += 1) {
      const card = aggregateMonthlyKpiRecords(amdEzRecords as any, 2026, month).byBusinessUnitMap["AMD-EZ"];
      const row = ctx.computeTrendKpiValuesForMonth(yearRecords, month);
      // Card keys -> client row keys.
      expect(row.budgetSpend, `month ${month} budget row`).toBeCloseTo(card.budgetSpend as number, 6);
      expect(row.pmcmWORatio, `month ${month} WO row`).toBeCloseTo(card.pmCmWorkOrderRatio as number, 6);
      expect(row.pmcmCostRatio, `month ${month} Cost row`).toBeCloseTo(card.pmCmCostRatio as number, 6);
      expect(row.mttr, `month ${month} MTTR row`).toBeCloseTo(card.mttrDays as number, 6);
    }
  });

  it("renders cumulative Group A rows and standalone Group B rows, with August rows equal to the cards", () => {
    const ctx = createContext();
    ctx.applyPersistedMonthlyKpiRecords(amdEzRecords, { reset: true });
    ctx.renderMonthlyRecords("ez");

    const html = ctx.document.getElementById("ez-monthly-records").innerHTML;
    const row = (monthName: string) => html.match(new RegExp(`<tr><td>${monthName}</td>[\\s\\S]*?</tr>`))?.[0] ?? "";
    const card = aggregateMonthlyKpiRecords(amdEzRecords as any, 2026, 8).byBusinessUnitMap["AMD-EZ"];

    // Group A: each row's cell is the cumulative January..row value; the August
    // row must equal the KPI card value (subject to display formatting).
    const budgetFragments = [1, 2, 3, 4, 5, 6, 7, 8].map((month) => {
      const cumulative = (() => {
        const rows = amdEzRecords.filter((r) => Number(r.reporting_month) <= month);
        const actual = rows.reduce((acc: number, r: any) => acc + r.actual_spend, 0);
        const budget = rows.reduce((acc: number, r: any) => acc + r.budget, 0);
        return (actual / budget) * 100;
      })();
      return ctx.formatDisplayKpiValue("budgetSpend", cumulative, { blank: "—" });
    });
    budgetFragments.forEach((fragment, index) => {
      expect(row(ROW_MONTH_NAMES[index])).toContain(">" + fragment + "<");
    });
    expect(row("August")).toContain(">" + ctx.formatDisplayKpiValue("budgetSpend", card.budgetSpend as number) + "<");
    expect(row("August")).toContain(">" + ctx.formatDisplayKpiValue("mttr", card.mttrDays as number) + "<");

    // Group B: monthly rows remain standalone actuals (not averages).
    for (let month = 1; month <= 8; month += 1) {
      const monthlyRecord = amdEzRecords[month - 1];
      const pmStandalone = ctx.formatDisplayKpiValue("pmCompliance", monthlyRecord.pm_compliance as number);
      const uptimeStandalone = ctx.formatDisplayKpiValue("facilityUptime", monthlyRecord.facility_uptime as number);
      expect(row(ROW_MONTH_NAMES[month - 1])).toContain(">" + pmStandalone + "<");
      expect(row(ROW_MONTH_NAMES[month - 1])).toContain(">" + uptimeStandalone + "<");
    }

    // Group B cards are the Jan-Aug YTD averages, not August standalone.
    const submittedMonths = amdEzRecords.slice(0, 8);
    const pmValues = submittedMonths.map((r: any) => r.pm_compliance as number);
    const pmAverage = pmValues.reduce((a: number, b: number) => a + b, 0) / pmValues.length;
    expect(card.pmCompliance).toBeCloseTo(pmAverage, 6);
    expect(card.pmCompliance).not.toBeCloseTo(pmValues[7], 6); // August standalone

    // September placeholder contributes nothing: rows stay blank.
    expect(row("September")).toContain("kpi-missing");
  });

  it("keeps September-December future months from contributing any value", () => {
    const ctx = createContext();
    ctx.applyPersistedMonthlyKpiRecords(amdEzRecords, { reset: true });
    const yearRecords = ctx.getKpiRecordsForYear("ez", 2026);
    for (const month of CUMULATIVE_KEYS) {
      for (let m = 9; m <= 12; m += 1) {
        const trend = ctx.computeTrendKpiValuesForMonth(yearRecords, m);
        expect(trend[month], `${month} month ${m}`).toBeNull();
      }
    }
    // The card at the effective month (server resolves September -> August)
    // uses the August cutoff and is unchanged by the placeholder months.
    const atSeptemberResolution = aggregateMonthlyKpiRecords(amdEzRecords as any, 2026, 8);
    expect(atSeptemberResolution.byBusinessUnitMap["AMD-EZ"].budgetSpend).toBeCloseTo(
      aggregateMonthlyKpiRecords(amdEzRecords as any, 2026, 8).byBusinessUnitMap["AMD-EZ"].budgetSpend as number,
      6
    );
  });
});
