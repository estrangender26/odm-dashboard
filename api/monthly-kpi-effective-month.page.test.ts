import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

/**
 * Page-level proof that the scorecard requests the aggregates for the EFFECTIVE
 * reporting month (latest submitted month) instead of an unsubmitted selected
 * month, and keeps the month selector in sync.
 *
 * Fixture: January-August submitted for AMD-EZ; September-December only carry
 * planned-budget placeholder rows (Not Submitted).
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

function makeMonthRecord(month: number, year: number, submitted: boolean) {
  const raw: Record<string, number | null> = {
    actual_spend: null, budget: null, pm_orders_completed_on_time: null, total_pm_orders: null,
    pm_work_orders: null, cm_work_orders: null, pm_cost: null, cm_cost: null,
    mttr_downtime: null, repair_count: null, facility_operating_time: null, facility_downtime: null,
  };
  const stored: Record<string, number | null> = {
    pm_compliance: null, budget_spend: null, pm_cm_work_order_ratio: null,
    pm_cm_cost_ratio: null, mttr_days: null, facility_uptime: null,
  };
  if (submitted) {
    raw.pm_orders_completed_on_time = 100 - month;
    raw.total_pm_orders = 100;
    stored.pm_compliance = 100 - month;
    raw.actual_spend = 100 * month + 10;
    raw.budget = 200;
    stored.budget_spend = ((100 * month + 10) / 200) * 100;
    raw.pm_work_orders = 40 + month;
    raw.cm_work_orders = 20 - (month % 3);
    raw.pm_cost = 1000 + 50 * month;
    raw.cm_cost = 500 - 10 * month;
    raw.mttr_downtime = 60 * month + 5;
    raw.repair_count = month + 2;
    raw.facility_operating_time = 1000;
    raw.facility_downtime = month;
    stored.facility_uptime = ((1000 - month) / 1000) * 100;
  } else {
    // Planned-budget-only placeholder row (Not Submitted).
    raw.budget = 1000 * month;
  }
  return {
    id: year * 100 + month,
    business_unit: "AMD-EZ",
    reporting_year: year,
    reporting_month: month,
    notes: month === 8 ? "August submission." : null,
    raw_imported_values: { values: { ...raw } },
    ...raw,
    ...stored,
  };
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
    fetch: async (url: string) => {
      requests.push(String(url));
      return { ok: true, json: async () => ({ reportingYear: 2026, byBusinessUnit: [], byBusinessUnitMap: {}, portfolioYearAverage: {}, portfolioMonthlyAverages: {} }) };
    },
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

function setMockAggregatesResponse(context: any, requests: string[], effective: number) {
  context.fetch = (async (url: string) => {
    requests.push(String(url));
    return {
      ok: true,
      json: async () => ({
        reportingYear: 2026,
        byBusinessUnit: [],
        byBusinessUnitMap: {},
        portfolioYearAverage: {},
        portfolioMonthlyAverages: {},
        effectiveReportingMonth: effective,
      }),
    };
  }) as any;
}

function loadSubmittedYear(ctx: any, year = 2026, through = 8) {
  const records = [];
  for (let month = 1; month <= 12; month += 1) {
    records.push(makeMonthRecord(month, year, month <= through));
  }
  ctx.applyPersistedMonthlyKpiRecords(records, { reset: true });
}

describe("scorecard effective reporting month (page flow)", () => {
  it("defaults the aggregates request to the latest submitted month (August) when the user has not chosen a month", async () => {
    const { context, requests } = createContext();
    // monthSel starts at its default of May; no manual month choice yet.
    loadSubmittedYear(context);
    setMockAggregatesResponse(context, requests, 8);
    await context.fetchMonthlyKpiAggregates();

    const aggregatesUrl = requests.find((url) => url.includes("/api/monthly-kpi/aggregates"));
    expect(aggregatesUrl).toBeDefined();
    expect(aggregatesUrl).toContain("reporting_month=8");
    expect(aggregatesUrl).not.toContain("reporting_month=5");
    expect(context.document.getElementById("monthSel").value).toBe("8");
  });

  it("rolls an explicitly selected unsubmitted month (September) to the latest submitted month", async () => {
    const { context, requests } = createContext();
    loadSubmittedYear(context);
    context.monthlyKpiReportingMonthUserChosen = true;
    context.document.getElementById("monthSel").value = "9";
    setMockAggregatesResponse(context, requests, 8);
    await context.fetchMonthlyKpiAggregates();

    const aggregatesUrl = requests.find((url) => url.includes("/api/monthly-kpi/aggregates"));
    expect(aggregatesUrl).toContain("reporting_month=8");
    expect(context.document.getElementById("monthSel").value).toBe("8");
  });

  it("keeps an explicit valid submitted month selection (March) as the cutoff", async () => {
    const { context, requests } = createContext();
    loadSubmittedYear(context);
    context.monthlyKpiReportingMonthUserChosen = true;
    context.document.getElementById("monthSel").value = "3";
    setMockAggregatesResponse(context, requests, 3);
    await context.fetchMonthlyKpiAggregates();

    const aggregatesUrl = requests.find((url) => url.includes("/api/monthly-kpi/aggregates"));
    expect(aggregatesUrl).toContain("reporting_month=3");
    expect(context.document.getElementById("monthSel").value).toBe("3");
  });

  it("resolves the latest submitted month within the selected year only (2025 -> May)", async () => {
    const { context, requests } = createContext();
    context.document.getElementById("yearSel").value = "2025";
    loadSubmittedYear(context, 2025, 5);
    setMockAggregatesResponse(context, requests, 5);
    await context.fetchMonthlyKpiAggregates();

    const aggregatesUrl = requests.find((url) => url.includes("/api/monthly-kpi/aggregates"));
    expect(aggregatesUrl).toContain("reporting_month=5");
    expect(aggregatesUrl).not.toContain("reporting_month=8");
    expect(context.document.getElementById("monthSel").value).toBe("5");
  });

  it("keeps the month selector in sync with the server-resolved effective month", async () => {
    const { context, requests } = createContext();
    // Local fixture ends in August; a server could still return its own
    // authoritative effective month - the selector must follow it.
    loadSubmittedYear(context);
    context.monthlyKpiReportingMonthUserChosen = true;
    context.document.getElementById("monthSel").value = "9";
    setMockAggregatesResponse(context, requests, 8);
    await context.fetchMonthlyKpiAggregates();
    expect(context.document.getElementById("monthSel").value).toBe("8");
  });
});
