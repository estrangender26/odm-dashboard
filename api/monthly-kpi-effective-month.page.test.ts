import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

/**
 * Page-level proof that the client NEVER infers the effective reporting month
 * from its (possibly BU-scoped) loaded records. The page either:
 *   - sends the user-requested month verbatim (reporting_month=N), or
 *   - sends reporting_month=latest for the default/no-user-choice view,
 * and then syncs the month selector to the SERVER-resolved
 * effectiveReportingMonth returned by /api/monthly-kpi/aggregates.
 *
 * Fixtures: AMD-EZ submitted January-May only (BU-scoped client records), while
 * the full portfolio (server) runs through August. The client must request
 * month=9 for an explicit September choice (never 5/8) and reporting_month=
 * latest for defaults, and the selector must settle on the server's August.
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

/** Full year record set for one BU: months 1..through submitted, rest blank. */
function makeMonthRecords(businessUnit: string, through: number) {
  const records: any[] = [];
  for (let month = 1; month <= 12; month += 1) {
    if (month <= through) {
      records.push({
        id: 100 * through + month,
        business_unit: businessUnit,
        reporting_year: 2026,
        reporting_month: month,
        pm_compliance: 100 - month,
        pm_orders_completed_on_time: 100 - month,
        total_pm_orders: 100,
        budget_spend: ((100 * month + 10) / 200) * 100,
        actual_spend: 100 * month + 10,
        budget: 200,
        pm_cm_work_order_ratio: ((40 + month) / (60)) * 100,
        pm_work_orders: 40 + month,
        cm_work_orders: 20 - (month % 3),
        pm_cm_cost_ratio: ((1000 + 50 * month) / (1500 + 40 * month)) * 100,
        pm_cost: 1000 + 50 * month,
        cm_cost: 500 - 10 * month,
        mttr_days: (60 * month + 5) / (month + 2),
        mttr_downtime: 60 * month + 5,
        repair_count: month + 2,
        facility_uptime: ((1000 - month) / 1000) * 100,
        facility_operating_time: 1000,
        facility_downtime: month,
        notes: null,
        raw_imported_values: {
          values: {
            pm_orders_completed_on_time: 100 - month,
            total_pm_orders: 100,
            actual_spend: 100 * month + 10,
            budget: 200,
            pm_work_orders: 40 + month,
            cm_work_orders: 20 - (month % 3),
            pm_cost: 1000 + 50 * month,
            cm_cost: 500 - 10 * month,
            mttr_downtime: 60 * month + 5,
            repair_count: month + 2,
            facility_operating_time: 1000,
            facility_downtime: month,
          },
        },
      });
    } else {
      // Not Submitted placeholder row with only a planned budget.
      records.push({
        id: 1000 + month,
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
        value: id === "yearSel" ? "2026" : id === "monthSel" ? "5" : "",
        innerHTML: "",
        classList: createClassList(id === "t-summary" ? "tc active" : ""),
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
  const requests: string[] = [];
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
        if (selector === ".tc.active") return getElement("t-summary");
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
  const runnable = context as typeof context & {
    KpiAggregates: any;
    MonthlyScoreData: Record<string, Record<number, Record<number, any>>>;
    normalizeKpiAggregates: (a: unknown) => unknown;
    applyPersistedMonthlyKpiRecords: (records: unknown[], options?: { reset?: boolean }) => void;
    fetchMonthlyKpiAggregates: () => Promise<void>;
    monthlyKpiReportingMonthUserChosen: boolean;
    getSelectedYear: () => number;
    getSelectedMonthValue: () => number;
  };
  return { context: runnable, elementStore, requests };
}

function setServerMock(context: any, requests: string[], effective: number | null) {
  context.fetch = (async (url: string) => {
    requests.push(String(url));
    const payload: Record<string, unknown> = {
      reportingYear: 2026,
      byBusinessUnit: [],
      byBusinessUnitMap: {},
      portfolioYearAverage: {},
      portfolioMonthlyAverages: {},
    };
    if (effective !== null) payload.effectiveReportingMonth = effective;
    return { ok: true, json: async () => payload };
  }) as any;
}

describe("scorecard effective reporting month (page flow, server-authoritative)", () => {
  it("default/no-user-choice view requests reporting_month=latest and syncs to the server effective month", async () => {
    const { context, requests } = createContext();
    // Default selector value is May; the page has no user month choice yet.
    setServerMock(context, requests, 8);
    await context.fetchMonthlyKpiAggregates();

    const aggregatesUrl = requests.find((url) => url.includes("/api/monthly-kpi/aggregates"));
    expect(aggregatesUrl).toBeDefined();
    expect(aggregatesUrl).toContain("reporting_month=latest");
    expect(aggregatesUrl).not.toContain("reporting_month=5");
    expect(context.document.getElementById("monthSel").value).toBe("8");
  });

  it("sends an explicit September choice verbatim even when BU-scoped records end in May, then syncs to server August", async () => {
    const { context, requests } = createContext();
    // Simulate a BU-scoped client: only AMD-EZ records loaded, submitted Jan-May.
    context.applyPersistedMonthlyKpiRecords(makeMonthRecords("AMD-EZ", 5), { reset: true });
    context.monthlyKpiReportingMonthUserChosen = true;
    context.document.getElementById("monthSel").value = "9";
    // Server (full portfolio) resolves September -> effective August.
    setServerMock(context, requests, 8);
    await context.fetchMonthlyKpiAggregates();

    const aggregatesUrl = requests.find((url) => url.includes("/api/monthly-kpi/aggregates"));
    expect(aggregatesUrl).toContain("reporting_month=9");
    // The BU-scoped records must NOT cause a locally guessed May request.
    expect(aggregatesUrl).not.toContain("reporting_month=5");
    expect(context.document.getElementById("monthSel").value).toBe("8");
  });

  it("sends an explicit valid submitted month (March) verbatim and keeps it", async () => {
    const { context, requests } = createContext();
    context.applyPersistedMonthlyKpiRecords(makeMonthRecords("AMD-EZ", 5), { reset: true });
    context.monthlyKpiReportingMonthUserChosen = true;
    context.document.getElementById("monthSel").value = "3";
    setServerMock(context, requests, 3);
    await context.fetchMonthlyKpiAggregates();

    const aggregatesUrl = requests.find((url) => url.includes("/api/monthly-kpi/aggregates"));
    expect(aggregatesUrl).toContain("reporting_month=3");
    expect(context.document.getElementById("monthSel").value).toBe("3");
  });

  it("changes with the selected year: 2025 default resolves to the server's 2025 latest submitted month", async () => {
    const { context, requests } = createContext();
    context.document.getElementById("yearSel").value = "2025";
    // 2025 portfolio data runs through May only; no user month choice yet.
    context.applyPersistedMonthlyKpiRecords(makeMonthRecords("Clark Water", 5).map((record) => ({ ...record, reporting_year: 2025 })), { reset: true });
    setServerMock(context, requests, 5);
    await context.fetchMonthlyKpiAggregates();

    const aggregatesUrl = requests.find((url) => url.includes("/api/monthly-kpi/aggregates"));
    expect(aggregatesUrl).toContain("reporting_month=latest");
    expect(context.document.getElementById("monthSel").value).toBe("5");
  });

  it("switching the loaded BU does not change the portfolio effective month request", async () => {
    const { context, requests } = createContext();
    // Two different BU-scoped loads (AMD-EZ through May, then Clark through August).
    context.applyPersistedMonthlyKpiRecords(makeMonthRecords("AMD-EZ", 5), { reset: true });
    setServerMock(context, requests, 8);
    await context.fetchMonthlyKpiAggregates();
    const firstUrl = requests.find((url) => url.includes("/api/monthly-kpi/aggregates"));

    requests.length = 0;
    context.applyPersistedMonthlyKpiRecords(makeMonthRecords("Clark Water", 8), { reset: true });
    setServerMock(context, requests, 8);
    await context.fetchMonthlyKpiAggregates();
    const secondUrl = requests.find((url) => url.includes("/api/monthly-kpi/aggregates"));

    // The default request stays 'latest' regardless of which BU's records the
    // page currently holds; the server resolves the portfolio month.
    expect(firstUrl).toContain("reporting_month=latest");
    expect(secondUrl).toContain("reporting_month=latest");
    expect(context.document.getElementById("monthSel").value).toBe("8");
  });

  it("does not clobber an explicit valid user month when the server agrees", async () => {
    const { context, requests } = createContext();
    context.monthlyKpiReportingMonthUserChosen = true;
    context.document.getElementById("monthSel").value = "3";
    setServerMock(context, requests, 3);
    await context.fetchMonthlyKpiAggregates();
    expect(requests.find((url) => url.includes("/api/monthly-kpi/aggregates"))).toContain("reporting_month=3");
    expect(context.document.getElementById("monthSel").value).toBe("3");
  });
});
