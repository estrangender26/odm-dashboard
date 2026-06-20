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

function extractScorecardScript() {
  const scriptOpen = "<script>";
  const scriptStartIndex = scorecardHtml.indexOf(scriptOpen);
  if (scriptStartIndex === -1) throw new Error("Inline scorecard script not found");
  const scriptStart = scriptStartIndex + scriptOpen.length;
  const scriptEnd = scorecardHtml.indexOf("</script>", scriptStart);
  if (scriptEnd === -1) throw new Error("Inline scorecard script closing tag not found");
  return scorecardHtml.slice(scriptStart, scriptEnd);
}

function createClassList(initialClasses = "") {
  const classes = new Set(initialClasses.split(/\s+/).filter(Boolean));
  return {
    add(className: string) { classes.add(className); },
    remove(className: string) { classes.delete(className); },
    toggle(className: string) {
      if (classes.has(className)) {
        classes.delete(className);
        return false;
      }
      classes.add(className);
      return true;
    },
    contains(className: string) { return classes.has(className); },
  };
}

function createMonthlyKpiTabContext(search: string) {
  const scorecardScript = extractScorecardScript();
  const panels = {
    "t-summary": { id: "t-summary", classList: createClassList("tc active") },
    "t-business-unit": { id: "t-business-unit", classList: createClassList("tc") },
  };
  const businessUnitSelect = { id: "businessUnitSel", value: "" };
  const genericElement = { addEventListener() {}, classList: createClassList(), style: {}, appendChild() {}, remove() {} };
  const buttons = [
    { tab: "summary", classList: createClassList("tab active"), getAttribute(name: string) { return name === "data-tab" ? "summary" : null; }, addEventListener() {} },
    { tab: "ez", classList: createClassList("tab"), getAttribute(name: string) { return name === "data-tab" ? "ez" : null; }, addEventListener() {} },
  ];
  const context = {
    console,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    document: {
      addEventListener() {},
      getElementById(id: string) {
        if (id === "businessUnitSel") return businessUnitSelect;
        return panels[id as keyof typeof panels] ?? genericElement;
      },
      querySelector(selector: string) {
        const tabMatch = selector.match(/^\.tab\[data-tab="([^"]+)"\]$/);
        if (tabMatch) return buttons.find((button) => button.tab === tabMatch[1]) ?? null;
        if (selector === ".tc.active") return Object.values(panels).find((panel) => panel.classList.contains("active")) ?? null;
        return null;
      },
      querySelectorAll(selector: string) {
        if (selector === ".tc") return Object.values(panels);
        if (selector === ".tab" || selector === ".tab[data-tab]") return buttons;
        return [];
      },
      createElement() { return { classList: createClassList(), style: {}, appendChild() {} }; },
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    window: { location: { search } },
    fetch() {},
  };
  vm.createContext(context);
  vm.runInContext(scorecardScript, context);
  const runnableContext = context as typeof context & {
    applyMonthlyKpiUrlTabFallback: () => boolean;
    persistDeckContext: () => void;
    updateClearButtonState: () => void;
    updateExportButtonState: () => void;
    renderBUCharts: () => void;
    fetchSavedMonthlyKpiRecords: () => void;
  };
  runnableContext.persistDeckContext = () => {};
  runnableContext.updateClearButtonState = () => {};
  runnableContext.updateExportButtonState = () => {};
  runnableContext.renderBUCharts = () => {};
  runnableContext.fetchSavedMonthlyKpiRecords = () => {};
  return { context: runnableContext, panels };
}

function createScorecardContext() {
  const scorecardScript = extractScorecardScript();
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
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    loadData() {},
  };
  vm.createContext(context);
  vm.runInContext(scorecardScript, context);
  return context as typeof context & {
    KpiAggregates: NormalizedAggregateResponse;
    normalizeKpiAggregates: (aggregates: unknown) => NormalizedAggregateResponse;
    getBusinessUnitYearAverages: (buId: string, year: number) => Record<string, number | null>;
    getPortfolioCurrentData: () => Record<string, number | null>;
    getSelectedYear: () => number;
    getSelectedMonth: () => number;
    fetch: (url: string, init?: unknown) => Promise<{ ok: boolean; json: () => Promise<any> }> | any;
    fetchMonthlyKpiAggregates: () => Promise<void>;
    loadData: () => void;
    fetchSavedMonthlyKpiRecords: (buId?: string) => Promise<void>;
    applyPersistedMonthlyKpiRecords: (records: unknown[], options?: { businessUnitId?: string; reset?: boolean }) => void;
    renderMonthlyRecords: (buId: string) => void;
    KPIs: Array<{
      key: string;
      tooltip?: {
        formula?: string;
        target?: string;
        displayedAs?: string;
        interpretation?: string;
      };
    }>;
    MonthlyScoreData: Record<string, Record<number, Record<number, unknown>>>;
  };
}

describe("Monthly KPI dashboard presentation", () => {
  it("keeps the dashboard KPI cards to the required layout without PM Planned", () => {
    expect(extractScriptArray("GaugeKPIs")).toEqual([
      "pmCompliance",
      "scheduleCompliance",
      "budgetSpend",
      "pmcmWORatio",
      "pmcmCostRatio",
      "mtbf",
      "mttr",
      "facilityUptime",
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
      "mtbf",
      "mttr",
      "facilityUptime",
    ]);

    const summaryTable = scorecardHtml.match(/<table class="matrix-table" id="summaryTable">([\s\S]*?)<\/table>/)?.[1] ?? "";
    const expectedKpiHeaders = [
      "PM Compliance (%)",
      "Schedule Compliance (%)",
      "Budget Spend (%)",
      "PM:CM Ratio (Work Order)",
      "PM:CM Ratio (Cost)",
      "MTBF (Days)",
      "MTTR (Days)",
      "Facility Uptime (%)",
    ];
    expectedKpiHeaders.forEach((header) => {
      expect(summaryTable).toContain(`<th>${header}</th>`);
    });
    expect(summaryTable).toContain("<th class=\"notes-col\">Notes</th>");
    expect(summaryTable).not.toContain("PM Planned");
  });

  it("activates the AMD-EZ panel and hides Summary Matrix when the URL has ?tab=ez", () => {
    const { context, panels } = createMonthlyKpiTabContext("?tab=ez");

    expect(context.applyMonthlyKpiUrlTabFallback()).toBe(true);
    expect(panels["t-business-unit"].classList.contains("active")).toBe(true);
    expect(panels["t-summary"].classList.contains("active")).toBe(false);
  });


  it("includes explanatory tooltips for monthly KPI cards", () => {
    const context = createScorecardContext();
    const tooltipByKey = Object.fromEntries(context.KPIs.map((kpi) => [kpi.key, kpi.tooltip]));

    expect(scorecardHtml).toContain("gauge-tooltip");
    expect(scorecardHtml).toContain("aria-describedby");
    expect(tooltipByKey.pmCompliance?.formula).toBe("PM Orders Completed On Time ÷ Total PM Orders × 100");
    expect(tooltipByKey.budgetSpend?.formula).toBe("Monthly Actual Spend ÷ Monthly Budget × 100");
    expect(tooltipByKey.pmcmWORatio?.formula).toBe("PM Work Orders ÷ (PM + CM Work Orders) × 100");
    expect(tooltipByKey.pmcmWORatio?.displayedAs).toBe("Percentage + Equivalent Ratio (example: 90% = 9:1)");
    expect(tooltipByKey.pmcmCostRatio?.formula).toBe("PM Cost ÷ (PM + CM Cost) × 100");
    expect(tooltipByKey.pmcmCostRatio?.displayedAs).toBe("Percentage + Equivalent Ratio (example: 72.7% = 2.7:1)");
    expect(tooltipByKey.mttr?.formula).toBe("Total Downtime ÷ Number of Repairs");
    expect(tooltipByKey.facilityUptime?.formula).toBe("(Total Operating Time - Total Downtime) ÷ Total Operating Time × 100");
    expect(tooltipByKey.pmCompliance?.interpretation).toBe("Higher is better.");
    expect(tooltipByKey.scheduleCompliance?.formula).toContain("Scheduled Work Orders");
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

    expect(monthlyRecordsRenderer).toContain("'Month','PM Compliance (%)','Schedule Compliance (%)','Budget Spend (%)'");
    expect(monthlyRecordsRenderer).toContain("'MTBF (Days)'");
    expect(monthlyRecordsRenderer).toContain("'MTTR (Days)'");
    expect(monthlyRecordsRenderer).toContain("Notes");
    expect(monthlyRecordsRenderer).not.toContain("PM Planned");
    expect(monthlyRecordsRenderer).not.toContain("pmPlanned");
  });

  it("keeps PM Planned available internally for imports and saved records", () => {
    expect(scorecardHtml).toContain("pmPlanned:'pm_planned'");
    expect(scorecardHtml).toContain("record.pmPlanned = row.pm_planned");
    expect(scorecardHtml).toContain("pm_planned: record.pmPlanned ?? null");
  });

  it("supports Notes as multiline commentary outside KPI calculations", () => {
    expect(scorecardHtml).toContain("notes:'notes'");
    expect(scorecardHtml).toContain("function renderNotesValue(value)");
    expect(scorecardHtml).toContain("getSummaryNotesForBusinessUnit");
    expect(scorecardHtml).toContain("function renderAggregateNotesRollup()");
    expect(scorecardHtml).toContain("function openBusinessUnitCommentaryModal()");
    expect(scorecardHtml).toContain("Business Unit Commentary");
    expect(scorecardHtml).toContain("'Notes': exportRecordValue(row,'notes')");
    expect(scorecardHtml).toContain("payload.raw_imported_values.values.notes = payload.notes");
    expect(scorecardHtml).toContain("if(h==='notes'||h==='note'||h==='remarks'||h==='commentary'||h==='comments')return 'notes';");
    expect(scorecardHtml).toContain("textarea id=\"form-manual-notes\"");
  });

  it("rolls up All Business Units notes into a clickable commentary count", () => {
    const scorecardScript = extractScorecardScript();
    type TestElement = {
      id: string;
      value: string;
      innerHTML: string;
      addEventListener: () => void;
      appendChild: () => void;
      remove: () => void;
      classList: ReturnType<typeof createClassList>;
      style: Record<string, string>;
      querySelector: () => null;
      querySelectorAll: () => never[];
    };
    const elements: Record<string, TestElement> = {};
    const getElement = (id: string): TestElement => {
      if (!elements[id]) {
        elements[id] = {
          id,
          value: id === "yearSel" ? "2026" : id === "monthSel" ? "5" : "",
          innerHTML: "",
          addEventListener() {},
          appendChild() {},
          remove() {},
          classList: createClassList(id === "t-summary" ? "tc active" : ""),
          style: {},
          querySelector() { return null; },
          querySelectorAll() { return []; },
        };
      }
      return elements[id];
    };
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
      fetch() {},
    };
    vm.createContext(context);
    vm.runInContext(scorecardScript, context);
    const runnableContext = context as typeof context & {
      KpiAggregates: NormalizedAggregateResponse;
      normalizeKpiAggregates: (aggregates: unknown) => NormalizedAggregateResponse;
      applyPersistedMonthlyKpiRecords: (records: unknown[], options?: { reset?: boolean }) => void;
      renderSummary: () => void;
      openBusinessUnitCommentaryModal: () => void;
    };

    runnableContext.KpiAggregates = runnableContext.normalizeKpiAggregates({
      reportingYear: 2026,
      byBusinessUnit: [
        { businessUnit: "AMD-EZ", reportingYear: 2026, recordCount: 1, pmCompliance: 98, budgetSpend: 100, pmCmWorkOrderRatio: 90, pmCmCostRatio: 70, mttrDays: 3, facilityUptime: 100 },
        { businessUnit: "Clark Water", reportingYear: 2026, recordCount: 1, pmCompliance: 97, budgetSpend: 99, pmCmWorkOrderRatio: 88, pmCmCostRatio: 65, mttrDays: 2, facilityUptime: 99.98 },
      ],
      byBusinessUnitMap: {},
      portfolioYearAverage: { pmCompliance: 97.5, budgetSpend: 99.5, pmCmWorkOrderRatio: 89, pmCmCostRatio: 67.5, mttrDays: 2.5, facilityUptime: 99.99 },
      portfolioMonthlyAverages: {},
    });
    runnableContext.applyPersistedMonthlyKpiRecords([
      { business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 5, pm_compliance: 98, notes: "Transformer overhaul completed." },
      { business_unit: "Laguna Water", reporting_year: 2026, reporting_month: 5, pm_compliance: 96, notes: "" },
      { business_unit: "Clark Water", reporting_year: 2026, reporting_month: 5, pm_compliance: 97, notes: "MTTR improved after spare parts availability." },
    ], { reset: true });

    runnableContext.renderSummary();

    const summaryHtml = elements.summaryBody.innerHTML;
    const aggregateRow = summaryHtml.match(/<tr class="summary-aggregate-row">[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(aggregateRow).toContain("All Business Units");
    expect(aggregateRow).toContain("2 facilities with commentary");
    expect(aggregateRow).not.toContain("Transformer overhaul completed.");
    expect(summaryHtml).toContain("Transformer overhaul completed.");
    expect(summaryHtml).toContain("MTTR improved after spare parts availability.");

    runnableContext.openBusinessUnitCommentaryModal();
    const commentaryHtml = elements.commentaryTableBody.innerHTML;
    expect(commentaryHtml.match(/<tr>/g)).toHaveLength(2);
    expect(commentaryHtml).toContain("AMD-EZ");
    expect(commentaryHtml).toContain("Clark Water");
    expect(commentaryHtml).not.toContain("Laguna Water");
  });

  it("loads BU monthly tables by selected business unit and year without a selected-month records filter", async () => {
    const requests: string[] = [];
    const context = createScorecardContext();
    context.getSelectedYear = () => 2026;
    context.getSelectedMonth = () => 5;
    context.fetchMonthlyKpiAggregates = async () => {};
    context.loadData = () => {};
    context.fetch = (async (url: string) => {
      requests.push(url);
      return {
        ok: true,
        json: async () => ({ records: [] }),
      };
    }) as any;

    await context.fetchSavedMonthlyKpiRecords("ez");

    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("reporting_year=2026");
    expect(requests[0]).toContain("business_unit=AMD-EZ");
    expect(requests[0]).not.toContain("reporting_month=5");
  });

  it("keeps Summary Matrix saved-record loads scoped to the selected reporting month", async () => {
    const requests: string[] = [];
    const context = createScorecardContext();
    context.getSelectedYear = () => 2026;
    context.getSelectedMonth = () => 5;
    context.fetchMonthlyKpiAggregates = async () => {};
    context.loadData = () => {};
    context.fetch = (async (url: string) => {
      requests.push(url);
      return {
        ok: true,
        json: async () => ({ records: [] }),
      };
    }) as any;

    await context.fetchSavedMonthlyKpiRecords();

    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("reporting_year=2026");
    expect(requests[0]).toContain("reporting_month=5");
    expect(requests[0]).not.toContain("business_unit=AMD-EZ");
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
          budgetSpend: 101,
          pmCmWorkOrderRatio: 88,
          pmCmCostRatio: 62,
          mttrDays: 4.2,
          facilityUptime: 99.98,
        },
        {
          businessUnit: "Laguna Water",
          reportingYear: 2026,
          recordCount: 1,
          pmCompliance: 97,
          budgetSpend: 100,
          pmCmWorkOrderRatio: 86,
          pmCmCostRatio: 60,
          mttrDays: 2.8,
          facilityUptime: 99.97,
        },
      ],
      byBusinessUnitMap: {
        "AMD-EZ": {
          businessUnit: "AMD-EZ",
          reportingYear: 2026,
          recordCount: 2,
          pmCompliance: 99.33,
          budgetSpend: 101,
          pmCmWorkOrderRatio: 88,
          pmCmCostRatio: 62,
          mttrDays: 4.2,
          facilityUptime: 99.98,
        },
        "Laguna Water": {
          businessUnit: "Laguna Water",
          reportingYear: 2026,
          recordCount: 1,
          pmCompliance: 97,
          budgetSpend: 100,
          pmCmWorkOrderRatio: 86,
          pmCmCostRatio: 60,
          mttrDays: 2.8,
          facilityUptime: 99.97,
        },
      },
      portfolioYearAverage: {
        pmCompliance: 98.17,
        budgetSpend: 100.5,
        pmCmWorkOrderRatio: 87,
        pmCmCostRatio: 61,
        mttrDays: 3.5,
        facilityUptime: 99.975,
      },
      portfolioMonthlyAverages: {
        1: {
          pmCompliance: 98.17,
          budgetSpend: 100.5,
          pmCmWorkOrderRatio: 87,
          pmCmCostRatio: 61,
          mttrDays: 3.5,
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
    expect(context.getPortfolioCurrentData().mttr).toBe(3.5);
    expect(context.getPortfolioCurrentData().scheduleCompliance).toBeNull();
    expect(context.getPortfolioCurrentData().mtbf).toBeNull();
  });

  it("renders portfolio KPI cards into the summary panel for All Business Units", () => {
    const scorecardScript = extractScorecardScript();
    type TestElement = {
      id: string;
      value: string;
      innerHTML: string;
      addEventListener: () => void;
      appendChild: () => void;
      remove: () => void;
      classList: ReturnType<typeof createClassList>;
      style: Record<string, string>;
      querySelector: () => null;
      querySelectorAll: () => never[];
    };
    const elements: Record<string, TestElement> = {};
    const getElement = (id: string): TestElement => {
      if (!elements[id]) {
        elements[id] = {
          id,
          value: id === "yearSel" ? "2026" : id === "monthSel" ? "5" : "",
          innerHTML: "",
          addEventListener() {},
          appendChild() {},
          remove() {},
          classList: createClassList(id === "t-summary" ? "tc active" : ""),
          style: {},
          querySelector() { return null; },
          querySelectorAll() { return []; },
        };
      }
      return elements[id];
    };
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
      fetch() {},
    };
    vm.createContext(context);
    vm.runInContext(scorecardScript, context);
    const runnableContext = context as typeof context & {
      KpiAggregates: NormalizedAggregateResponse;
      normalizeKpiAggregates: (aggregates: unknown) => NormalizedAggregateResponse;
      getBusinessUnitPanelIdBySection: (buId: string, section: string) => string;
      normalizePersistedBusinessUnit: (value: string) => string;
      renderGauges: (buId: string) => void;
    };

    runnableContext.KpiAggregates = runnableContext.normalizeKpiAggregates({
      reportingYear: 2026,
      byBusinessUnit: [
        {
          businessUnit: "AMD-EZ",
          reportingYear: 2026,
          recordCount: 1,
          pmCompliance: 98.41,
          budgetSpend: 98.48,
          pmCmWorkOrderRatio: 90.15,
          pmCmCostRatio: 70.93,
          mttrDays: 3.25,
          facilityUptime: 100,
        },
      ],
      byBusinessUnitMap: {},
      portfolioYearAverage: {
        pmCompliance: 78.87,
        budgetSpend: 94.83,
        pmCmWorkOrderRatio: 86.05,
        pmCmCostRatio: 53.08,
        mttrDays: 4.25,
        facilityUptime: 98.55,
      },
      portfolioMonthlyAverages: {},
    });

    expect(runnableContext.getBusinessUnitPanelIdBySection("summary", "gauges")).toBe("summary-gauges");
    expect(runnableContext.normalizePersistedBusinessUnit("All Business Units")).toBe("");

    runnableContext.renderGauges("summary");

    expect(elements["summary-gauges"].innerHTML).toContain("PM Compliance");
    expect(elements["summary-gauges"].innerHTML).toContain("78.87");
    expect(elements["summary-gauges"].innerHTML).toContain("Schedule Compliance");
    expect(elements["summary-gauges"].innerHTML).toContain("Budget Spend");
    expect(elements["summary-gauges"].innerHTML).toContain("94.83");
    expect(elements["summary-gauges"].innerHTML).toContain("PM:CM Ratio (WO)");
    expect(elements["summary-gauges"].innerHTML).toContain("86.05%");
    expect(elements["summary-gauges"].innerHTML).toContain("PM:CM Ratio (Cost)");
    expect(elements["summary-gauges"].innerHTML).toContain("53.08%");
    expect(elements["summary-gauges"].innerHTML).toContain("MTBF");
    expect(elements["summary-gauges"].innerHTML).toContain("MTTR");
    expect(elements["summary-gauges"].innerHTML).toContain("4.25");
    expect(elements["summary-gauges"].innerHTML).toContain("Facility Uptime");
    expect(elements["summary-gauges"].innerHTML).toContain("98.55");
    expect(elements["business-unit-gauges"]?.innerHTML ?? "").toBe("");
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


  it("renders AMD-EZ January-May 2026 records in the BU monthly table", () => {
    const scorecardScript = extractScorecardScript();
    const elements: Record<string, { value: string; innerHTML: string; addEventListener: () => void; appendChild: () => void; remove: () => void; classList: ReturnType<typeof createClassList>; style: Record<string, string>; querySelector: () => null; querySelectorAll: () => never[] }> = {};
    const getElement = (id: string) => {
      if (!elements[id]) {
        elements[id] = {
          value: id === "yearSel" ? "2026" : id === "monthSel" ? "5" : "",
          innerHTML: "",
          addEventListener() {},
          appendChild() {},
          remove() {},
          classList: createClassList(),
          style: {},
          querySelector() { return null; },
          querySelectorAll() { return []; },
        };
      }
      return elements[id];
    };
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
        querySelector() { return getElement("query"); },
        querySelectorAll() { return []; },
      },
      localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
      window: {},
      fetch() {},
    };
    vm.createContext(context);
    vm.runInContext(scorecardScript, context);
    const runnableContext = context as typeof context & {
      applyPersistedMonthlyKpiRecords: (records: unknown[], options?: { businessUnitId?: string }) => void;
      renderMonthlyRecords: (buId: string) => void;
    };

    runnableContext.applyPersistedMonthlyKpiRecords(
      [1, 2, 3, 4, 5].map((month) => ({
        id: month,
        business_unit: "AMD-EZ",
        reporting_year: 2026,
        reporting_month: month,
        pm_compliance: 90 + month,
        budget_spend: 100,
        pm_cm_work_order_ratio: 86,
        pm_cm_cost_ratio: 60,
        mttr_days: month,
        facility_uptime: 99.97,
        notes: month === 3 ? "Planned shutdown completed.\nSpare delivery tracked." : null,
      })),
      { businessUnitId: "ez" },
    );
    runnableContext.renderMonthlyRecords("ez");

    const html = elements["ez-monthly-records"].innerHTML;
    expect(html).toContain("2026 Imported Monthly KPI Records");
    expect(html).toContain("January");
    expect(html).toContain("February");
    expect(html).toContain("March");
    expect(html).toContain("April");
    expect(html).toContain("May");
    expect(html).toContain("MTBF (Days)");
    expect(html).toContain("MTTR (Days)");
    expect(html).toContain("Notes");
    expect(html).toContain("91.00");
    expect(html).toContain("92.00");
    expect(html).toContain("93.00");
    expect(html).toContain("94.00");
    expect(html).toContain("95.00");
    expect(html).toContain("Planned shutdown completed.");
  });

});
