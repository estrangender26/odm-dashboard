import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const scorecardHtml = readFileSync(resolve(process.cwd(), "public/scorecard-kpi.html"), "utf8");
const scorecardThresholdScript = readFileSync(resolve(process.cwd(), "public/scorecard-kpi-thresholds.js"), "utf8");

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
  const businessUnitSelect: any = { id: "businessUnitSel", _value: "", _innerHTML: "" };
  Object.defineProperty(businessUnitSelect, "value", {
    get() { return this._value; },
    set(v) { this._value = v; },
  });
  Object.defineProperty(businessUnitSelect, "innerHTML", {
    get() { return this._innerHTML; },
    set(v) { this._innerHTML = v; },
  });
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
    _innerHTML: "",
    set innerHTML(value: string) { this._innerHTML = value; },
    get innerHTML() { return this._innerHTML; },
    set textContent(_value: string) {},
    get textContent() { return ""; },
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
  const ctxAny = context as any;
  ctxAny.loadData = () => {};
  ctxAny.renderBUCharts = () => {};
  ctxAny.renderSummaryDashboard = () => {};
  ctxAny.updateChartLoadingOverlays = () => {};
  ctxAny.fetchMonthlyKpiAggregates = async () => {};
  ctxAny.refreshBusinessUnitSelectors = () => { ctxAny.initBusinessUnitSelector(); };
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
    applyPersistedMonthlyKpiRecords: (records: unknown[], options?: { businessUnitId?: string; reset?: boolean; merge?: boolean }) => void;
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
    summarizeSummaryMatrixNotes: (notes: string) => string;
    renderSummaryNotesValue: (notes: string) => string;
  };
}

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
      sheet_to_json(sheet: { _rows?: unknown[][] }, opts: { header?: number; range?: string; defval?: unknown; raw?: boolean }) {
        if (opts.header === 1 && Array.isArray(sheet._rows)) {
          const rangeMatch = opts.range?.match(/A1:([A-Z]+)(\d+)/);
          const maxRow = rangeMatch ? Number(rangeMatch[2]) : sheet._rows.length;
          return sheet._rows.slice(0, maxRow).map((row) =>
            Array.isArray(row) ? row.map((cell) => (cell && typeof cell === "object" && "v" in cell ? (cell as { v: unknown }).v : cell)) : []
          );
        }
        return [];
      },
    },
  };
}

function createImportContext() {
  const scorecardScript = extractScorecardScript();
  const element = {
    addEventListener() {},
    appendChild() {},
    remove() {},
    classList: { add() {}, remove() {}, toggle() {} },
    style: {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    _innerHTML: "",
    set innerHTML(value: string) { this._innerHTML = value; },
    get innerHTML() { return this._innerHTML; },
    value: "2026",
    focus() {},
  };
  const yearSelect = { ...element, value: "2026" };
  const elementCache: Record<string, any> = {};
  const context = {
    console,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    XLSX: createMockXLSX(),
    Chart: class Chart { constructor() {} static register() {} },
    document: {
      body: element,
      addEventListener() {},
      createElement() { return element; },
      getElementById(id: string) {
        if (id === "yearSel") return yearSelect;
        if (id === "monthSel") {
          if (!elementCache["monthSel"]) {
            elementCache["monthSel"] = { ...element, value: "1", style: { ...element.style } };
          }
          return elementCache["monthSel"];
        }
        if (id === "businessUnitSel") {
          if (!elementCache["businessUnitSel"]) {
            const sel: any = { ...element };
            Object.defineProperty(sel, "options", {
              get() {
                const html = sel._innerHTML || "";
                const matches = html.matchAll(/<option value="([^"]+)"[^>]*>([^<]*)<\/option>/g);
                return Array.from(matches).map((m: any) => ({ value: m[1], text: m[2] }));
              },
            });
            Object.defineProperty(sel, "value", {
              get() { return sel._value || "all-business-units"; },
              set(v: any) { sel._value = v; },
            });
            elementCache["businessUnitSel"] = sel;
          }
          return elementCache["businessUnitSel"];
        }
        if (id === "importConflictPanel" || id === "importPrimaryActions" || id === "importConflictMessage") {
          if (!elementCache[id]) elementCache[id] = { ...element, style: { ...element.style } };
          return elementCache[id];
        }
        return element;
      },
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
  const ctxAny: any = context;
  ctxAny.loadData = () => {};
  ctxAny.renderBUCharts = () => {};
  ctxAny.renderSummaryDashboard = () => {};
  ctxAny.updateChartLoadingOverlays = () => {};
  ctxAny.fetchMonthlyKpiAggregates = async () => {};
  ctxAny.refreshBusinessUnitSelectors = () => { ctxAny.initBusinessUnitSelector(); };
  return context as typeof context & {
    importSummaryWorkbook: (workbook: unknown, fileName: string, buId: string) => { imported: number; records: Array<Record<string, unknown>>; importedMonths: Array<{ year: number; month: number }> };
    importConsolidatedWorkbook: (workbook: unknown, fileName: string) => { imported: number; records: Array<Record<string, unknown>>; createdBusinessUnits: Array<{ id: string; apiValue: string; name: string; label: string }> };
    getBUApiValue: (buId: string) => string;
    getSelectedYear: () => number;
    getSelectedMonth: () => number;
    applyPersistedMonthlyKpiRecords: (records: unknown[], options?: { businessUnitId?: string; reset?: boolean; merge?: boolean }) => void;
    MonthlyScoreData: Record<string, Record<number, Record<number, any>>>;
    ScoreData: Record<string, any>;
    importExcel: () => void;
    clearData: () => Promise<void>;
    resolveClearConfirmation: (confirmed: boolean) => void;
    closeImportModal: (force?: boolean) => void;
    isImportModalOpen: () => boolean;
    setImporting: (flag: boolean) => void;
    initBusinessUnitSelector: () => void;
    fetchSavedMonthlyKpiRecords: (buId?: string, options?: any) => Promise<{ ok: boolean; records?: unknown[]; error?: Error }>;
    saveImportedMonthlyKpiRecords: (fileName: string, records: unknown[], buId: string | null) => Promise<{ records?: unknown[] }>;
    buildClearScopeLabel: () => { year: number; buLabel: string; isAll: boolean };
    fetchMonthlyKpiAggregates: () => Promise<void>;
    normalizeKpiAggregates: (aggregates: unknown) => any;
    KpiAggregates: any;
    selectedBusinessUnitId: string;
    BUs: Array<{ id: string; apiValue: string; name: string; label: string }>;
    normalizePersistedBusinessUnit: (value: string) => string;
    getAggregateForBusinessUnit: (buId: string, year: number) => { businessUnit: string } | null;
    getSortedBusinessUnits: (businessUnits: Array<{ id: string; apiValue: string; name: string; label: string }>) => Array<{ id: string; apiValue: string; name: string; label: string }>;
    drillDownToBusinessUnit: (buId: string) => void;
    handleSummaryBusinessUnitKeydown: (event: { key: string; preventDefault?: () => void }, buId: string) => void;
    renderSummary: () => void;
    renderMonthlyRecords: (buId: string) => void;
  };
}

async function resolveImportConflict(ctx: any, shouldReplace: boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!ctx.conflictResolver && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
  ctx.resolveImportReplacement(shouldReplace);
}

function createImportExcelContext(workbook: any) {
  const ctx = createImportContext() as any;

  // Mock FileReader so importExcel can run in Node without a browser.
  ctx.FileReader = class FileReader {
    result: ArrayBuffer | null = null;
    onload: ((ev: { target: { result: ArrayBuffer } }) => void) | null = null;
    onerror: (() => void) | null = null;
    readAsArrayBuffer(file: { buffer: ArrayBuffer }) {
      this.result = file.buffer;
      setTimeout(() => this.onload && this.onload({ target: { result: file.buffer } }), 0);
    }
  };

  // Mock XLSX.read so the supplied workbook is parsed without touching SheetJS internals.
  ctx.XLSX.read = () => workbook;

  // Drive the import flow deterministically without real DOM or backend calls.
  ctx.getImportContext = () => ({
    buSelection: "ez",
    buId: "ez",
    bu: ctx.BUs[0],
    isNewBusinessUnit: false,
    newBusinessUnitName: "",
    file: { buffer: new ArrayBuffer(0), name: "test.xlsx" },
  });
  ctx.validateImportContext = () => true;
  ctx.resolveImportBusinessUnit = () => ({ buId: "ez", bu: ctx.BUs[0], created: false });
  ctx.confirmImportReplacement = (message: string) => {
    ctx.lastConflictMessage = message;
    ctx.conflictResolver = null;
    const fullMessage = message + " Replace existing data for the selected month(s)?";
    if (ctx.showImportConflictPanel) ctx.showImportConflictPanel(fullMessage);
    return new Promise((resolve) => {
      ctx.conflictResolver = resolve;
    });
  };
  const originalResolveImportReplacement = ctx.resolveImportReplacement;
  ctx.resolveImportReplacement = (shouldReplace: boolean) => {
    if (ctx.conflictResolver) {
      ctx.conflictResolver(shouldReplace);
      ctx.conflictResolver = null;
    }
    if (originalResolveImportReplacement) originalResolveImportReplacement(shouldReplace);
  };
  ctx.checkImportConflicts = async () => ctx.importConflicts;
  ctx.persistBusinessUnits = () => {};
  ctx.refreshBusinessUnitSelectors = () => {};
  ctx.updateImportButtonState = () => {};
  ctx.setImporting = (flag: boolean) => { ctx.isImporting = flag; };
  ctx.saveImportedMonthlyKpiRecords = async (fileName: string, records: unknown[], buId: string) => {
    ctx.saveCalls.push({ fileName, records, buId });
    if (ctx.saveReject) throw ctx.saveReject;
    return { records: ctx.savedRecords || records };
  };
  ctx.fetchSavedMonthlyKpiRecords = async (buId?: string, options?: any) => {
    ctx.fetchSavedCalls.push({ buId, options });
    if (ctx.fetchSavedReject) {
      const err = ctx.fetchSavedReject;
      if (options && options.rethrow) throw err;
      return { ok: false, error: err };
    }
    if (ctx.fetchSavedRecords) {
      ctx.applyPersistedMonthlyKpiRecords(
        ctx.fetchSavedRecords,
        buId ? { businessUnitId: buId, merge: !!(options && options.merge) } : { reset: true, merge: !!(options && options.merge) },
      );
    }
    return { ok: true, records: ctx.fetchSavedRecords || [] };
  };
  ctx.switchToImportedBusinessUnit = async () => {
    ctx.switchCalls.push({});
    if (ctx.switchReject) throw ctx.switchReject;
  };
  ctx.fetchMonthlyKpiAggregates = async () => {};
  ctx.Chart = class Chart { constructor() {} static register() {} };
  ctx.showToast = (type: string, message: string) => {
    ctx.toastCalls.push({ type, message });
  };

  ctx.closeImportModalCalls = [] as boolean[];
  const originalCloseImportModal = ctx.closeImportModal;
  ctx.closeImportModal = (force?: boolean) => {
    ctx.closeImportModalCalls.push(force ?? false);
    return originalCloseImportModal(force);
  };

  ctx.removeBusinessUnitCalls = [] as string[];
  const originalRemoveBusinessUnitById = ctx.removeBusinessUnitById;
  ctx.removeBusinessUnitById = (buId: string) => {
    ctx.removeBusinessUnitCalls.push(buId);
    return originalRemoveBusinessUnitById(buId);
  };

  // Mutable test controls and spies.
  ctx.confirmReplacementResult = true;
  ctx.importConflicts = [] as Array<{ year: number; month: number }>;
  ctx.lastConflictMessage = "" as string;
  ctx.conflictResolver = null as ((value: boolean) => void) | null;
  ctx.saveReject = null as Error | null;
  ctx.savedRecords = null as unknown[] | null;
  ctx.fetchSavedRecords = null as unknown[] | null;
  ctx.fetchSavedReject = null as Error | null;
  ctx.switchReject = null as Error | null;
  ctx.saveCalls = [] as any[];
  ctx.fetchSavedCalls = [] as any[];
  ctx.switchCalls = [] as any[];
  ctx.toastCalls = [] as any[];

  return ctx;
}

async function runImportExcel(ctx: any) {
  ctx.importExcel();
  // Wait for FileReader mock, the inner 120ms setTimeout, and async saves.
  await new Promise((r) => setTimeout(r, 250));
}

describe("Monthly KPI dashboard presentation", () => {
function makeCompletionSafetyNote(items: string[], trailingStatement = "All listed works remain under completion-status review.") {
  return [
    "PM Compliance:",
    "Scheduled outsourced PM remains deferred due to unavailable SLA during contract review.",
    "PM:CM Work Orders:",
    ...items.map((item, index) => `${index + 1}. ${item}`),
    "MTTR:",
    "No downtime occurred during the reporting period while completion status remained under review.",
    "Facility Uptime:",
    "Facility remained operational throughout the reporting period.",
    trailingStatement,
  ].join("\n");
}

function makeConsolidatedWorkbookWithRow(values: { pmCompliance?: number; budgetSpend?: number; pmcmWORatio?: number; pmcmCostRatio?: number; mttr?: number; facilityUptime?: number; notes?: string | null } = {}) {
  function makeSheet(rows: unknown[][]) {
    const sheet: any = { _rows: rows };
    rows.forEach((row, r) => {
      row.forEach((value, c) => {
        const addr = String.fromCharCode(65 + c) + (r + 1);
        sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
      });
    });
    return sheet;
  }
  const pm = values.pmCompliance ?? 98.9;
  const budget = values.budgetSpend ?? 103.67;
  const wo = values.pmcmWORatio ?? 69.52;
  const cost = values.pmcmCostRatio ?? 74.73;
  const mttr = values.mttr ?? 113;
  const uptime = values.facilityUptime ?? 100;
  const notes = values.notes ?? null;
  return {
    SheetNames: ["Budget Spend", "PM Compliance", "PM CM Work Orders", "PM CM Cost", "MTTR", "Facility Uptime"],
    Sheets: {
      "Budget Spend": makeSheet([
        ["BUSINESS UNIT", "Month", "Actual Spend", "Budget", "Notes"],
        ["AMD-EZ", 46023, budget * 100, 10000, notes],
      ]),
      "PM Compliance": makeSheet([
        ["BUSINESS UNIT", "Month", "Completed On Time", "Total Orders", "Notes"],
        ["AMD-EZ", 46023, pm, 100, null],
      ]),
      "PM CM Work Orders": makeSheet([
        ["BUSINESS UNIT", "Month", "PM Work Orders", "CM Work Orders", "Notes"],
        ["AMD-EZ", 46023, wo, 100 - wo, null],
      ]),
      "PM CM Cost": makeSheet([
        ["BUSINESS UNIT", "Month", "PM Cost", "CM Cost", "Notes"],
        ["AMD-EZ", 46023, cost, 100 - cost, null],
      ]),
      "MTTR": makeSheet([
        ["BUSINESS UNIT", "Month", "Total Downtime", "Number of Repairs", "Notes"],
        ["AMD-EZ", 46023, mttr, 1, null],
      ]),
      "Facility Uptime": makeSheet([
        ["BUSINESS UNIT", "Month", "Total Operating Time", "Total Downtime", "Notes"],
        ["AMD-EZ", 46023, 1000, 1000 - uptime * 10, null],
      ]),
    },
  };
}


  it("keeps the dashboard KPI cards to the required layout without PM Planned", () => {
    expect(extractScriptArray("GaugeKPIs")).toEqual([
      "pmCompliance",
      "budgetSpend",
      "pmcmWORatio",
      "pmcmCostRatio",
      "mttr",
      "facilityUptime",
    ]);
    expect(extractScriptArray("GaugeKPIs")).not.toContain("pmPlanned");
  });

  it("uses a responsive six, three, and one-column KPI card grid without horizontal overflow", () => {
    const desktopCss = scorecardHtml.slice(0, scorecardHtml.indexOf("/* ===== RESPONSIVE ===== */"));
    const mediumCss = scorecardHtml.slice(
      scorecardHtml.indexOf("/* LAPTOP: 1024px-1279px */"),
      scorecardHtml.indexOf("/* MOBILE: 640px-767px */"),
    );
    const mobileCss = scorecardHtml.slice(
      scorecardHtml.indexOf("/* MOBILE: 640px-767px */"),
      scorecardHtml.indexOf("/* SMALL MOBILE: 480px-639px */"),
    );

    expect(desktopCss).toContain(".gauge-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));align-items:stretch");
    expect(mediumCss).toContain(".gauge-grid{grid-template-columns:repeat(3,minmax(0,1fr))}");
    expect(mobileCss).toContain(".gauge-grid{grid-template-columns:minmax(0,1fr)}");
    expect(desktopCss).toContain(".gauge-card{position:relative;display:flex;flex-direction:column;min-width:0;height:100%;box-sizing:border-box");
    expect(desktopCss).toContain(".gauge-bar{height:6px;margin-top:auto");
    expect(scorecardHtml).toContain("@media(min-width:1280px){");
    expect(scorecardHtml).toContain(".gauge-card:last-child .gauge-tooltip{left:auto;right:0");
    expect(scorecardHtml).toContain("@media(min-width:768px) and (max-width:1279px){");
    expect(scorecardHtml).toContain(".gauge-card:nth-child(3n) .gauge-tooltip{left:auto;right:0");
    expect(scorecardHtml).toContain('<div id="summary-gauges" class="gauge-grid"></div>');
    expect(scorecardHtml).toContain('<div id="business-unit-gauges" class="gauge-grid"></div>');

    // Chart grid responsive layout: 3x2 desktop, 2-col tablet/laptop, 1-col mobile
    expect(desktopCss).toContain(".chart-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))");
    expect(desktopCss).toContain(".chart-card{position:relative;display:flex;flex-direction:column;min-width:0;height:100%;box-sizing:border-box");
    expect(scorecardHtml).toContain(".chart-grid{grid-template-columns:repeat(2,minmax(0,1fr))}");
    expect(scorecardHtml).toContain(".chart-grid{grid-template-columns:minmax(0,1fr)}");
    expect(scorecardHtml).toContain('<div id="summary-trend-section"></div>');
    expect(scorecardHtml).toContain('<div id="business-unit-trend-section"></div>');
  });

  it("limits the Summary Matrix to the required KPI metrics without PM Planned", () => {
    expect(extractScriptArray("SummaryMatrixKPIs")).toEqual([
      "pmCompliance",
      "budgetSpend",
      "pmcmWORatio",
      "pmcmCostRatio",
      "mttr",
      "facilityUptime",
    ]);

    const summaryTable = scorecardHtml.match(/<table class="matrix-table" id="summaryTable">([\s\S]*?)<\/table>/)?.[1] ?? "";
    const expectedKpiHeaders = [
      "PM Compliance (%)",
      "Budget Spend (%)",
      "PM:CM Ratio (Work Order)",
      "PM:CM Ratio (Cost)",
      "MTTR (Days)",
      "Facility Uptime (%)",
    ];
    expectedKpiHeaders.forEach((header) => {
      expect(summaryTable).toContain(`<th>${header}</th>`);
    });
    expect(summaryTable).toContain("<th class=\"notes-col\">Notes</th>");
    expect(summaryTable).not.toContain("Schedule Compliance");
    expect(summaryTable).not.toContain("MTBF");
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
    expect(tooltipByKey.budgetSpend?.formula).toBe("Cumulative Actual Spend ÷ Cumulative Budget × 100");
    expect(tooltipByKey.pmcmWORatio?.formula).toBe("PM Work Orders ÷ (PM + CM Work Orders) × 100");
    expect(tooltipByKey.pmcmWORatio?.displayedAs).toBe("Percentage + Equivalent Ratio (example: 90% = 9:1)");
    expect(tooltipByKey.pmcmCostRatio?.formula).toBe("PM Cost ÷ (PM + CM Cost) × 100");
    expect(tooltipByKey.pmcmCostRatio?.displayedAs).toBe("Percentage + Equivalent Ratio (example: 80% = 4:1)");
    expect(tooltipByKey.mttr?.formula).toBe("Total Downtime ÷ Number of Repairs");
    expect(tooltipByKey.facilityUptime?.formula).toBe("(Total Operating Time - Total Downtime) ÷ Total Operating Time × 100");
    expect(tooltipByKey.pmCompliance?.interpretation).toBe("Higher is better.");

  });

  it("uses =100% for every Facility Uptime benchmark label", () => {
    const context = createScorecardContext() as any;
    const facilityUptime = context.KPIs.find((kpi: any) => kpi.key === "facilityUptime");
    const definition = context.getKpiDefinitionRows().find((row: any) => row.key === "facilityUptime");
    const faq = context.KPI_DEFINITION_FAQ.find((item: any) => item.q.includes("Facility Uptime"));

    expect(facilityUptime.benchmarkLabel).toBe("=100%");
    expect(facilityUptime.tooltip.target).toBe("=100%");
    expect(facilityUptime.definitionBenchmark).toBe("=100%");
    expect(context.getKpiBenchmarkLabel("facilityUptime")).toBe("=100%");
    expect(definition.benchmark).toBe("=100%");
    expect(context.getTooltipFooter("facilityUptime")).toEqual(["Benchmark Value: =100%"]);
    expect(context.benchmarkOptionsFor("facilityUptime").lines[0].label).toBe("Benchmark =100%");
    expect(faq.a).toContain("benchmark (=100%)");
    expect(scorecardThresholdScript).toContain('if (rule.key === "facilityUptime")');
    expect(scorecardThresholdScript).toContain('var greenOperator = rule.key === "facilityUptime" ? "=" : "≥";');
  });

  it("renders PM:CM ratio equivalents in cards, the Summary Matrix, and the monthly table", () => {
    const monthlyRecordsRenderer = scorecardHtml.slice(
      scorecardHtml.indexOf("function renderMonthlyRecords(buId)"),
      scorecardHtml.indexOf("// ===== CHARTS ====="),
    );

    expect(scorecardHtml).toContain("function formatPmCmRatioEquivalent");
    expect(scorecardHtml).toContain("return (pct / cmShare).toFixed(1)+':1';");
    expect(scorecardHtml).toContain("return formatKPIValue(pct)+'% ('+formatPmCmRatioEquivalent(pct)+')';");
    expect(scorecardHtml).toContain("formatDisplayKpiValue(sk.key,val)");
    expect(scorecardHtml).toContain("formatDisplayKpiValue(key,v)");
    expect(monthlyRecordsRenderer).toContain("formatDisplayKpiValue(key,val,{blank:'—'})");
    expect(scorecardHtml).toContain("if(pct>=100)return 'No CM';");
  });

  it("hides PM Planned from per-BU imported monthly records tables", () => {
    const monthlyRecordsRenderer = scorecardHtml.slice(
      scorecardHtml.indexOf("function renderMonthlyRecords(buId)"),
      scorecardHtml.indexOf("// ===== CHARTS ====="),
    );

    expect(monthlyRecordsRenderer).toContain("'Month','PM Compliance (%)','Budget Spend (%)'");
    expect(monthlyRecordsRenderer).not.toContain("'Schedule Compliance (%)'");
    expect(monthlyRecordsRenderer).not.toContain("'MTBF (Days)'");
    expect(monthlyRecordsRenderer).toContain("'MTTR (Days)'");
    expect(monthlyRecordsRenderer).toContain("Situation");
    expect(monthlyRecordsRenderer).not.toContain("PM Planned");
    expect(monthlyRecordsRenderer).not.toContain("pmPlanned");
  });

  it("keeps PM Planned available internally for imports and saved records", () => {
    expect(scorecardHtml).toContain("pmPlanned:'pm_planned'");
    expect(scorecardHtml).toContain("record.pmPlanned = row.pm_planned");
    expect(scorecardHtml).toContain("pm_planned:");
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
    expect(scorecardHtml).toContain("if(h==='notes'||h==='note'||h==='remarks'||h==='commentary'||h==='comments'||h==='situation')return 'notes';");
    expect(scorecardHtml).toContain("textarea id=\"form-manual-notes\"");
  });

  it("deterministically summarizes long Summary Matrix Notes while preserving operational meaning", () => {
    const context = createScorecardContext();
    const longNote = [
      "PM Compliance:",
      "Most scheduled outsourced PM are deferred due to unavailable SLA.",
      "PM CM Work Orders:",
      "1. Emergency repair of the affected equipment was completed.",
      "2. Surge arrester replacement was completed.",
      "3. Switchgear repair was completed.",
      "4. Auto sync module installation was completed.",
      "PM CM Cost:",
      "Emergency repair costs were incurred.",
      "MTTR:",
      "No downtime occurred.",
      "Facility Uptime:",
      "Facility remained operational.",
    ].join("\n");

    const summary = context.summarizeSummaryMatrixNotes(longNote);

    expect(summary).toBe(
      "PM deferred due to unavailable SLA. 4 corrective works completed. Emergency repair costs incurred. No downtime. Facility remained operational.",
    );
    expect(summary).toMatch(/deferred due to unavailable SLA/i);
    expect(summary).toMatch(/4 corrective works completed/i);
    expect(summary).toMatch(/emergency repair/i);
    expect(summary).toMatch(/No downtime/i);
    expect(summary).toMatch(/Facility remained operational/i);
  });

  it("does not infer completion when numbered corrective work items do not say they were completed", () => {
    const context = createScorecardContext();
    const longNote = [
      "PM Compliance:",
      "Most scheduled outsourced PM are deferred due to unavailable SLA pending contract approval.",
      "PM CM Work Orders:",
      "1. Emergency repair is required for the damaged equipment.",
      "2. Surge arrester requires inspection and technical assessment.",
      "3. Switchgear requires repair after the recorded breakdown.",
      "4. Auto sync module requires testing during the planned shutdown.",
      "MTTR:",
      "No downtime occurred during the reporting month.",
      "Facility Uptime:",
      "Facility remained operational throughout the reporting month.",
    ].join("\n");

    const summary = context.summarizeSummaryMatrixNotes(longNote);

    expect(summary).toContain("4 corrective works.");
    expect(summary).not.toContain("4 corrective works completed");
    expect(summary).toContain("Emergency repair.");
    expect(summary).toContain("Breakdown.");
    expect(summary).toContain("Shutdown.");
  });

  it.each([
    {
      label: "not completed",
      items: [
        "1. Emergency repair was not completed.",
        "2. Surge arrester work was not completed.",
        "3. Switchgear work was not completed.",
        "4. Auto sync work was not completed.",
      ],
    },
    {
      label: "not repaired",
      items: [
        "1. Emergency equipment was not repaired.",
        "2. Surge arrester was not repaired.",
        "3. Switchgear was not repaired.",
        "4. Auto sync equipment was not repaired.",
      ],
    },
  ])("does not infer completion when all corrective works are $label", ({ items }) => {
    const context = createScorecardContext();
    const longNote = [
      "PM Compliance:",
      "Scheduled outsourced PM remains deferred due to unavailable SLA pending contract review.",
      "PM:CM Work Orders:",
      ...items,
      "MTTR:",
      "No downtime occurred during the reporting period while all listed works remain unresolved.",
      "Facility Uptime:",
      "Facility remained operational throughout the reporting period while corrective work remains pending.",
    ].join("\n");

    const summary = context.summarizeSummaryMatrixNotes(longNote);

    expect(summary).toContain("4 corrective works.");
    expect(summary).not.toContain("4 corrective works completed");
  });

  it("does not infer completion from a mixed completed and pending corrective-work list", () => {
    const context = createScorecardContext();
    const longNote = [
      "PM Compliance:",
      "Scheduled outsourced PM remains deferred due to unavailable SLA pending contract review.",
      "CM Work Orders:",
      "1. Emergency repair was completed.",
      "2. Surge arrester replacement was completed.",
      "3. Switchgear repair is pending.",
      "4. Auto sync module testing is ongoing.",
      "MTTR:",
      "No downtime occurred during the reporting period while pending work remains controlled.",
      "Facility Uptime:",
      "Facility remained operational throughout the reporting period while work remains pending.",
    ].join("\n");

    const summary = context.summarizeSummaryMatrixNotes(longNote);

    expect(summary).toContain("4 corrective works.");
    expect(summary).not.toContain("4 corrective works completed");
  });

  it.each([
    "not completed",
    "not repaired",
    "not replaced",
    "not installed",
    "not yet completed",
    "not yet repaired",
    "not yet replaced",
    "not yet installed",
    "incomplete",
    "pending",
    "ongoing",
    "for completion",
  ])("rejects the non-completion marker: %s", (marker) => {
    const context = createScorecardContext() as any;

    expect(context.hasAffirmativeCompletionMarker(`Corrective work ${marker}.`)).toBe(false);
  });

  it.each(["repaired", "replaced", "installed", "resolved", "rectified", "restored"])(
    "does not infer completion from the action verb: %s",
    (verb) => {
      const context = createScorecardContext() as any;

      expect(context.hasAffirmativeCompletionMarker(`Equipment ${verb}.`)).toBe(false);
    },
  );

  it.each([
    { label: "never completed", makeItem: (subject: string) => `${subject} was never completed.` },
    { label: "cannot be completed", makeItem: (subject: string) => `${subject} cannot be completed.` },
    { label: "can't be completed", makeItem: (subject: string) => `${subject} can't be completed.` },
    { label: "no work was completed", makeItem: (subject: string) => `No work was completed for ${subject}.` },
    { label: "wasn't completed", makeItem: (subject: string) => `${subject} wasn't completed.` },
    { label: "weren't completed", makeItem: (subject: string) => `${subject} activities weren't completed.` },
    { label: "will be completed", makeItem: (subject: string) => `${subject} will be completed.` },
    { label: "shall be completed", makeItem: (subject: string) => `${subject} shall be completed.` },
    { label: "should be completed", makeItem: (subject: string) => `${subject} should be completed.` },
    { label: "to be completed", makeItem: (subject: string) => `${subject} is to be completed.` },
  ])("does not emit completed for end-to-end $label items", ({ makeItem }) => {
    const context = createScorecardContext();
    const subjects = ["Emergency repair", "Surge arrester work", "Switchgear work", "Auto sync work"];
    const summary = context.summarizeSummaryMatrixNotes(makeCompletionSafetyNote(subjects.map(makeItem)));

    expect(summary).toContain("4 corrective works.");
    expect(summary).not.toContain("4 corrective works completed");
  });

  it.each([
    "Completed.",
    "Work completed.",
    "Work was completed.",
    "Work has been completed.",
    "All four activities were completed.",
  ])("accepts the affirmative completion statement: %s", (statement) => {
    const context = createScorecardContext() as any;

    expect(context.hasAffirmativeCompletionMarker(statement)).toBe(true);
  });

  it("does not emit completed for the contradictory unfinished review case", () => {
    const context = createScorecardContext();
    const longNote = makeCompletionSafetyNote(
      [
        "Emergency repair was never completed.",
        "Surge arrester work cannot be completed.",
        "No switchgear work was completed.",
        "Auto sync work will be completed after shutdown.",
      ],
      "All four corrective works remain unfinished.",
    );

    const summary = context.summarizeSummaryMatrixNotes(longNote);

    expect(summary).toContain("4 corrective works.");
    expect(summary).not.toContain("4 corrective works completed");
    expect(summary).toContain("All four corrective works remain unfinished.");
  });

  it("allows completion only when every corrective work has an affirmative completion marker", () => {
    const context = createScorecardContext();
    const longNote = [
      "PM Compliance:",
      "Scheduled outsourced PM remains deferred due to unavailable SLA pending contract review.",
      "Corrective Maintenance:",
      "1. Emergency repair was completed.",
      "2. Surge arrester work was completed.",
      "3. Switchgear work was completed.",
      "4. Auto sync module work was completed.",
      "MTTR:",
      "No downtime occurred during the reporting period after the completed corrective work.",
      "Facility Uptime:",
      "Facility remained operational throughout the reporting period after the completed work.",
    ].join("\n");

    expect(context.summarizeSummaryMatrixNotes(longNote)).toContain("4 corrective works completed.");
  });

  it("does not classify a Budget Spend procurement list as corrective works", () => {
    const context = createScorecardContext();
    const longNote = [
      "Budget Spend:",
      "Procurement items remain under commercial review for the reporting period.",
      "1. Auto sync module quotation remains pending approval.",
      "2. Switchgear quotation remains pending approval.",
      "3. Surge arrester quotation remains pending approval.",
      "4. Control equipment quotation remains pending approval.",
      "MTTR:",
      "No downtime occurred during the reporting period while procurement review continued.",
      "Facility Uptime:",
      "Facility remained operational throughout the reporting period without service interruption.",
    ].join("\n");

    const summary = context.summarizeSummaryMatrixNotes(longNote);

    expect(summary).not.toContain("corrective works");
    expect(summary).toContain("Auto sync module quotation remains pending approval.");
  });

  it("does not classify a spare-parts list as corrective works", () => {
    const context = createScorecardContext();
    const longNote = [
      "Spare Parts:",
      "The following spare-parts requirements remain subject to inventory validation and purchasing review.",
      "1. Auto sync module spare part remains pending.",
      "2. Switchgear spare part remains pending.",
      "3. Surge arrester spare part remains pending.",
      "4. Control equipment spare part remains pending.",
      "MTTR:",
      "No downtime occurred during the reporting period while inventory validation continued.",
      "Facility Uptime:",
      "Facility remained operational throughout the reporting period without service interruption.",
    ].join("\n");

    const summary = context.summarizeSummaryMatrixNotes(longNote);

    expect(summary).not.toContain("corrective works");
    expect(summary).toContain("Auto sync module spare part remains pending.");
  });

  it("classifies a clearly headed PM:CM Work Orders list as corrective works", () => {
    const context = createScorecardContext();
    const longNote = [
      "PM Compliance:",
      "Scheduled outsourced PM remains deferred due to unavailable SLA pending contract review.",
      "PM:CM Work Orders:",
      "1. Emergency repair requires technical assessment.",
      "2. Surge arrester requires technical assessment.",
      "3. Switchgear requires technical assessment.",
      "4. Auto sync module requires technical assessment.",
      "MTTR:",
      "No downtime occurred during the reporting period while assessment work continued.",
      "Facility Uptime:",
      "Facility remained operational throughout the reporting period without service interruption.",
    ].join("\n");

    expect(context.summarizeSummaryMatrixNotes(longNote)).toContain("4 corrective works.");
  });

  it("leaves short Summary Matrix Notes unchanged", () => {
    const context = createScorecardContext();
    const shortNote = "Deferred PM due to no SLA. No downtime; facility operational.";

    expect(context.summarizeSummaryMatrixNotes(shortNote)).toBe(shortNote);
  });

  it("reduces long Summary Matrix Notes without mutating persisted note values or KPI rendering", () => {
    const context = createScorecardContext();
    const longNote = [
      "PM Compliance:",
      "Most scheduled outsourced PM are deferred due to unavailable SLA.",
      "PM CM Work Orders:",
      "1. Emergency repair of the affected equipment was completed.",
      "2. Surge arrester replacement was completed.",
      "3. Switchgear repair was completed.",
      "4. Auto sync module installation was completed.",
      "PM CM Cost:",
      "Emergency repair costs were incurred.",
      "MTTR:",
      "No downtime occurred.",
      "Facility Uptime:",
      "Facility remained operational.",
    ].join("\n");
    context.applyPersistedMonthlyKpiRecords([
      {
        business_unit: "AMD-EZ",
        reporting_year: 2026,
        reporting_month: 1,
        pm_compliance: 98,
        notes: longNote,
      },
    ], { reset: true });

    const storedNote = (context.MonthlyScoreData.ez[2026][1] as { notes: string }).notes;
    const renderedSummary = context.renderSummaryNotesValue(storedNote);
    const summary = context.summarizeSummaryMatrixNotes(storedNote);

    expect(storedNote).toBe(longNote);
    expect(context.MonthlyScoreData.ez[2026][1]).toMatchObject({ pmCompliance: 98, notes: longNote });
    expect(renderedSummary).toBe(summary);
    expect(summary.split(/\s+/).length).toBeLessThanOrEqual(25);
    expect(summary.length).toBeLessThan(longNote.length * 0.6);
    expect(summary).not.toContain("\n");
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

  it("loads all-year records for the Summary Matrix / all-BU view regardless of selected month", async () => {
    const requests: string[] = [];
    const context = createImportContext();
    (context as any).getSelectedYear = () => 2026;
    (context as any).getSelectedMonth = () => 5;
    (context as any).getSelectedMonthValue = () => 5;
    context.fetchMonthlyKpiAggregates = async () => {};
    (context as any).loadData = () => {};
    (context as any).fetch = async (url: string) => {
      requests.push(url);
      return { ok: true, json: async () => ({ records: [] }) };
    };

    await context.fetchSavedMonthlyKpiRecords();

    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("reporting_year=2026");
    expect(requests[0]).not.toContain("reporting_month");
    expect(requests[0]).not.toContain("business_unit=AMD-EZ");
  });

  it("still scopes per-BU record loads to the selected year and does not add a month filter", async () => {
    const requests: string[] = [];
    const context = createImportContext();
    (context as any).getSelectedYear = () => 2026;
    (context as any).getSelectedMonth = () => 5;
    (context as any).getSelectedMonthValue = () => 5;
    context.fetchMonthlyKpiAggregates = async () => {};
    (context as any).loadData = () => {};
    (context as any).fetch = async (url: string) => {
      requests.push(url);
      return { ok: true, json: async () => ({ records: [] }) };
    };

    await context.fetchSavedMonthlyKpiRecords("ez");

    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("reporting_year=2026");
    expect(requests[0]).toContain("business_unit=AMD-EZ");
    expect(requests[0]).not.toContain("reporting_month");
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
    expect(context.getPortfolioCurrentData().scheduleCompliance).toBeUndefined();
    expect(context.getPortfolioCurrentData().mtbf).toBeUndefined();
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
    expect(elements["summary-gauges"].innerHTML).toContain("Budget Spend");
    expect(elements["summary-gauges"].innerHTML).toContain("94.83");
    expect(elements["summary-gauges"].innerHTML).toContain("PM:CM Ratio (WO)");
    expect(elements["summary-gauges"].innerHTML).toContain("86.05%");
    expect(elements["summary-gauges"].innerHTML).toContain("PM:CM Ratio (Cost)");
    expect(elements["summary-gauges"].innerHTML).toContain("53.08%");
    expect(elements["summary-gauges"].innerHTML).toContain("MTTR");
    expect(elements["summary-gauges"].innerHTML).toContain("4.25");
    expect(elements["summary-gauges"].innerHTML).toContain("Facility Uptime");
    expect(elements["summary-gauges"].innerHTML).toContain("98.55");
    expect(elements["summary-gauges"].innerHTML).not.toContain("Schedule Compliance");
    expect(elements["summary-gauges"].innerHTML).not.toContain("MTBF");
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
        // Computed KPI values returned by the backend.
        pm_compliance: 90 + month,
        budget_spend: 100,
        pm_cm_work_order_ratio: month === 1 ? 82 : 86,
        pm_cm_cost_ratio: month === 1 ? 65.34 : 60,
        mttr_days: month,
        facility_uptime: 99.97,
        // Raw input fields required for trend-ready table display.
        actual_spend: 100 * month,
        budget: 100 * month,
        pm_orders_completed_on_time: 90 + month,
        total_pm_orders: 100,
        pm_work_orders: month === 1 ? 82 : 60 + month,
        cm_work_orders: month === 1 ? 18 : 10,
        pm_cost: month === 1 ? 6534 : 6000 + month * 200,
        cm_cost: month === 1 ? 3466 : 1000,
        mttr_downtime: 10 * month,
        repair_count: month,
        facility_operating_time: 744,
        facility_downtime: 0,
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
    expect(html).toContain("MTTR (Days)");
    expect(html).toContain('<th class="notes-col">Notes</th><th class="situation-col">Situation</th>');
    expect(html).toContain("Situation");
    // The monthly table now displays actual monthly imported values, not
    // running averages or cumulative/YTD values. Jan=91..May=95.
    expect(html).toContain("91.00");
    expect(html).toContain("92.00");
    expect(html).toContain("93.00");
    expect(html).toContain("94.00");
    expect(html).toContain("95.00");
    // Monthly table should NOT contain running-average PM Compliance values.
    expect(html).not.toContain("91.50");
    expect(html).not.toContain("92.50");
    // The audit subtitle explains the distinction.
    expect(html).toContain("Monthly table shows actual monthly imported values");
    expect(html).toContain("KPI cards and trend charts show YTD/cumulative or running-average performance");
    expect(html).toContain("Planned shutdown completed.");
    expect(html).not.toContain("Schedule Compliance");
    expect(html).not.toContain("MTBF");
    const populatedMonthRow = (month: string) => html.match(new RegExp(`<tr><td>${month}</td>[\\s\\S]*?</tr>`))?.[0] ?? "";
    ["January", "February", "March", "April", "May"].forEach((month) => {
      expect(populatedMonthRow(month).match(/class="kpi-dual-value"/g)).toHaveLength(2);
    });
    expect(populatedMonthRow("January")).toContain('<span class="kpi-dual-primary">82.00%</span><span class="kpi-dual-secondary">(4.6:1)</span>');
    expect(populatedMonthRow("January")).toContain('<span class="kpi-dual-primary">65.34%</span><span class="kpi-dual-secondary">(1.9:1)</span>');
    const januaryRecord = (runnableContext as any).MonthlyScoreData.ez[2026][1];
    expect(januaryRecord.pmcmWORatio).toBeCloseTo((januaryRecord.pm_work_orders / (januaryRecord.pm_work_orders + januaryRecord.cm_work_orders)) * 100, 2);
    expect(januaryRecord.pmcmCostRatio).toBeCloseTo((januaryRecord.pm_cost / (januaryRecord.pm_cost + januaryRecord.cm_cost)) * 100, 2);

    const aggregateSnapshot = {
      reportingYear: 2026,
      byBusinessUnitMap: { "AMD-EZ": { budgetSpend: 26.68, pmCompliance: 100 } },
      portfolioYearAverage: { budgetSpend: 26.68, pmCompliance: 100 },
    };
    (runnableContext as any).KpiAggregates = aggregateSnapshot;
    const aggregateBeforeRender = JSON.stringify((runnableContext as any).KpiAggregates);

    runnableContext.applyPersistedMonthlyKpiRecords(
      [
        {
          id: 101,
          business_unit: "AMD-EZ",
          reporting_year: 2026,
          reporting_month: 1,
          pm_compliance: 0,
          budget_spend: 0,
          pm_cm_work_order_ratio: 0,
          pm_cm_cost_ratio: 0,
          mttr_days: 0,
          facility_uptime: 100,
          pm_orders_completed_on_time: 0,
          total_pm_orders: 10,
          actual_spend: 0,
          budget: 100,
          pm_work_orders: 0,
          cm_work_orders: 5,
          pm_cost: 0,
          cm_cost: 10,
          mttr_downtime: 0,
          repair_count: 1,
          facility_operating_time: 100,
          facility_downtime: 0,
          notes: "Zero values recorded.",
          raw_imported_values: { values: {} },
        },
        {
          id: 102,
          business_unit: "AMD-EZ",
          reporting_year: 2026,
          reporting_month: 2,
          pm_compliance: 100,
          budget_spend: null,
          pm_cm_work_order_ratio: 100,
          pm_cm_cost_ratio: null,
          mttr_days: 1,
          facility_uptime: 100,
          pm_orders_completed_on_time: 10,
          total_pm_orders: 10,
          actual_spend: 50,
          budget: 0,
          pm_work_orders: 1,
          cm_work_orders: 0,
          pm_cost: 0,
          cm_cost: 0,
          mttr_downtime: 1,
          repair_count: 1,
          facility_operating_time: 100,
          facility_downtime: 0,
          notes: "Vendor deferral; No Budget",
          raw_imported_values: { values: {} },
        },
        {
          id: 103,
          business_unit: "AMD-EZ",
          reporting_year: 2026,
          reporting_month: 3,
          pm_compliance: 100,
          budget_spend: 100,
          pm_cm_work_order_ratio: null,
          pm_cm_cost_ratio: 80,
          mttr_days: null,
          facility_uptime: 100,
          pm_orders_completed_on_time: 10,
          total_pm_orders: 10,
          actual_spend: 100,
          budget: 100,
          pm_work_orders: 0,
          cm_work_orders: 0,
          pm_cost: 80,
          cm_cost: 20,
          mttr_downtime: 0,
          repair_count: 0,
          facility_operating_time: 100,
          facility_downtime: 0,
          notes: null,
          raw_imported_values: { values: {} },
        },
        {
          id: 104,
          business_unit: "AMD-EZ",
          reporting_year: 2026,
          reporting_month: 4,
          pm_compliance: null,
          budget_spend: null,
          pm_cm_work_order_ratio: null,
          pm_cm_cost_ratio: null,
          mttr_days: null,
          facility_uptime: null,
          actual_spend: 50,
          budget: 0,
          notes: "Budget submission received.",
          raw_imported_values: { values: {} },
        },
        {
          id: 105,
          business_unit: "AMD-EZ",
          reporting_year: 2026,
          reporting_month: 5,
          pm_compliance: null,
          budget_spend: null,
          pm_cm_work_order_ratio: null,
          pm_cm_cost_ratio: null,
          mttr_days: null,
          facility_uptime: null,
          mttr_downtime: 5,
          repair_count: null,
          notes: null,
          raw_imported_values: { values: {} },
        },
      ],
      { businessUnitId: "ez" },
    );
    runnableContext.renderMonthlyRecords("ez");

    const situationHtml = elements["ez-monthly-records"].innerHTML;
    const monthRow = (month: string) => situationHtml.match(new RegExp(`<tr><td>${month}</td>[\\s\\S]*?</tr>`))?.[0] ?? "";
    const januaryRow = monthRow("January");
    const februaryRow = monthRow("February");
    const marchRow = monthRow("March");
    const aprilRow = monthRow("April");
    const mayRow = monthRow("May");
    const juneRow = monthRow("June");

    expect(situationHtml).toContain('<th class="notes-col">Notes</th><th class="situation-col">Situation</th>');
    expect(situationHtml).not.toContain("No Data");
    expect(januaryRow).toContain(">0.00<");
    expect(januaryRow.match(/<span class="kpi-dual-primary">0\.00%<\/span><span class="kpi-dual-secondary">\(0\.0:1\)<\/span>/g)).toHaveLength(2);
    expect(januaryRow).toContain('<td class="notes-col">Zero values recorded.</td><td class="situation-col">—</td>');
    expect(januaryRow).not.toContain("Not Submitted");
    expect(februaryRow).toContain('class="kpi-missing">—</td>');
    expect(februaryRow).toContain('<span class="kpi-dual-primary">100.00%</span><span class="kpi-dual-secondary">(No CM)</span>');
    expect(februaryRow).toContain('<td class="notes-col">Vendor deferral; No Budget</td><td class="situation-col">No Budget; No CM Cost</td>');
    expect(februaryRow.match(/No Budget/g)).toHaveLength(2);
    expect(marchRow).toContain('<td class="notes-col">—</td><td class="situation-col">No Work Orders; No Qualifying Downtime</td>');
    expect(aprilRow).toContain('<td class="notes-col">Budget submission received.</td><td class="situation-col">Not Submitted; No Budget</td>');
    expect(aprilRow).not.toContain("Pending");
    expect(mayRow).toContain('<td class="notes-col">—</td><td class="situation-col">Not Submitted</td>');
    expect(mayRow).not.toContain("No Qualifying Downtime");
    expect(mayRow).not.toContain("Pending");
    expect(juneRow).toContain('<td class="notes-col">—</td><td class="situation-col">Pending</td>');
    expect((runnableContext as any).MonthlyScoreData.ez[2026][2].notes).toBe("Vendor deferral; No Budget");
    expect((runnableContext as any).MonthlyScoreData.ez[2026][4].notes).toBe("Budget submission received.");
    expect(JSON.stringify((runnableContext as any).KpiAggregates)).toBe(aggregateBeforeRender);
  });
  it("imports visible KPI values from the Summary sheet only, ignoring dedicated sheets", () => {
    const ctx = createImportContext();
    ctx.getBUApiValue = () => "amd-ez";

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const summaryRows = [
      ["Month", "PM Compliance (%)", "Schedule Compliance (%)", "Budget Spend (%)", "PM vs CM Ratio (Work Orders) (%)", "PM vs CM Ratio (Cost) (%)", "MTBF (days)", "MTTR (days)", "Facility Uptime (%)"],
      [46023, 98.9, 75.5, 103.67, 69.52, 74.73, 30, 113, 100],
      [46054, 99.07, 76.5, 145.29, 82.51, 72.73, 31, 113, 100],
    ];

    const workbook = {
      SheetNames: ["Summary", "PM Compliance", "Schedule Compliance", "Budget Spend", "PM vs CM Ratio - Work Orders", "PM vs CM Ratio - Cost", "MTBF", "MTTR", "Facility Uptime"],
      Sheets: {
        Summary: makeSheet(summaryRows),
        "PM Compliance": makeSheet([["Month", "A", "B", "PM Compliance (%)"], [46023, 0, 0, 100], [46054, 0, 0, 99]]),
        "Schedule Compliance": makeSheet([["Month", "A", "B", "Schedule Compliance (%)"], [46023, 0, 0, 80], [46054, 0, 0, 81]]),
        "Budget Spend": makeSheet([["Month", "A", "B", "Budget Spend (%)"], [46023, 0, 0, 83.05], [46054, 0, 0, 145.29]]),
        "PM vs CM Ratio - Work Orders": makeSheet([["Month", "A", "B", "PM vs CM Ratio (Work Orders) (%)"], [46023, 0, 0, 82], [46054, 0, 0, 82.51]]),
        "PM vs CM Ratio - Cost": makeSheet([["Month", "A", "B", "PM vs CM Ratio (Cost) (%)"], [46023, 0, 0, 65.34], [46054, 0, 0, 72.73]]),
        MTBF: makeSheet([["Month", "A", "B", "MTBF (days)"], [46023, 0, 0, 25], [46054, 0, 0, 26]]),
        MTTR: makeSheet([["Month", "A", "B", "MTTR (days)"], [46023, 0, 0, 24], [46054, 0, 0, 24]]),
        "Facility Uptime": makeSheet([["Month", "A", "B", "Facility Uptime (%)"], [46023, 0, 0, 99.9], [46054, 0, 0, 99.9]]),
      },
    };

    const result = ctx.importSummaryWorkbook(workbook, "test.xlsx", "ez");
    expect(result.imported).toBe(2);

    const jan = result.records.find((r) => r.reporting_month === 1);
    const feb = result.records.find((r) => r.reporting_month === 2);
    expect(jan).toBeDefined();
    expect(feb).toBeDefined();

    // Summary values win over dedicated-sheet values and include hidden KPIs.
    expect(jan?.pm_compliance).toBe(98.9);
    expect(jan?.schedule_compliance).toBe(75.5);
    expect(jan?.budget_spend).toBe(103.67);
    expect(jan?.pm_cm_work_order_ratio).toBe(69.52);
    expect(jan?.pm_cm_cost_ratio).toBe(74.73);
    expect(jan?.mtbf_days).toBe(30);
    expect(jan?.mttr_days).toBe(113);
    expect(jan?.facility_uptime).toBe(100);

    expect(feb?.pm_compliance).toBe(99.07);
    expect(feb?.schedule_compliance).toBe(76.5);
    expect(feb?.budget_spend).toBe(145.29);
    expect(feb?.pm_cm_work_order_ratio).toBe(82.51);
    expect(feb?.pm_cm_cost_ratio).toBe(72.73);
    expect(feb?.mtbf_days).toBe(31);
    expect(feb?.mttr_days).toBe(113);
    expect(feb?.facility_uptime).toBe(100);
  });

  it("does not mutate MonthlyScoreData or ScoreData during Summary parsing", () => {
    const ctx = createImportContext();
    ctx.getBUApiValue = () => "amd-ez";

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ["Summary"],
      Sheets: {
        Summary: makeSheet([
          ["Month", "PM Compliance (%)", "Budget Spend (%)", "PM vs CM Ratio (Work Orders) (%)", "PM vs CM Ratio (Cost) (%)", "MTTR (days)", "Facility Uptime (%)"],
          [46023, 98.9, 103.67, 69.52, 74.73, 113, 100],
        ]),
      },
    };

    const beforeMonthly = JSON.stringify(ctx.MonthlyScoreData);
    const beforeScore = JSON.stringify(ctx.ScoreData);

    ctx.importSummaryWorkbook(workbook, "test.xlsx", "ez");

    expect(JSON.stringify(ctx.MonthlyScoreData)).toBe(beforeMonthly);
    expect(JSON.stringify(ctx.ScoreData)).toBe(beforeScore);
  });

  it("round-trips every imported Summary KPI through persisted record mapping", () => {
    const ctx = createImportContext();
    ctx.getBUApiValue = () => "amd-ez";

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const summaryRows = [
      ["Month", "PM Compliance (%)", "PM Planned (%)", "Schedule Compliance (%)", "Budget Spend (%)", "PM vs CM Ratio (Work Orders) (%)", "PM vs CM Ratio (Cost) (%)", "MTBF (days)", "MTTR (days)", "Facility Uptime (%)", "Notes"],
      [46023, 98.9, 80, 75.5, 103.67, 69.52, 74.73, 30, 113, 100, "Jan notes"],
    ];

    const workbook = {
      SheetNames: ["Summary"],
      Sheets: { Summary: makeSheet(summaryRows) },
    };

    const imported = ctx.importSummaryWorkbook(workbook, "test.xlsx", "ez");
    expect(imported.imported).toBe(1);
    const payload = imported.records[0];
    expect(payload).toBeDefined();

    // Simulate the persisted DB row shape returned by the backend.
    const persisted = {
      id: 1,
      business_unit: "AMD-EZ",
      reporting_year: 2026,
      reporting_month: 1,
      source_file_name: "test.xlsx",
      pm_compliance: payload.pm_compliance,
      pm_planned: payload.pm_planned,
      schedule_compliance: payload.schedule_compliance,
      budget_spend: payload.budget_spend,
      pm_cm_work_order_ratio: payload.pm_cm_work_order_ratio,
      pm_cm_cost_ratio: payload.pm_cm_cost_ratio,
      mtbf_days: payload.mtbf_days,
      mttr_days: payload.mttr_days,
      facility_uptime: payload.facility_uptime,
      notes: payload.notes,
      raw_imported_values: payload.raw_imported_values,
    };

    ctx.applyPersistedMonthlyKpiRecords([persisted], { businessUnitId: "ez" });
    const record = ctx.MonthlyScoreData.ez[2026][1];

    expect(record.pmCompliance).toBe(98.9);
    expect(record.pmPlanned).toBe(80);
    expect(record.scheduleCompliance).toBe(75.5);
    expect(record.budgetSpend).toBe(103.67);
    expect(record.pmcmWORatio).toBe(69.52);
    expect(record.pmcmCostRatio).toBe(74.73);
    expect(record.mtbf).toBe(30);
    expect(record.mttr).toBe(113);
    expect(record.facilityUptime).toBe(100);
    expect(record.notes).toBe("Jan notes");
    expect(record.raw_imported_values).toBeDefined();
  });

  it("keeps PM:CM Work Order Ratio at 82.51 after persisted-record reload", () => {
    const ctx = createImportContext();
    ctx.applyPersistedMonthlyKpiRecords(
      [
        {
          id: 2,
          business_unit: "AMD-EZ",
          reporting_year: 2026,
          reporting_month: 2,
          pm_compliance: 99.07,
          budget_spend: 145.29,
          pm_cm_work_order_ratio: 82.51,
          pm_cm_cost_ratio: 72.73,
          mttr_days: 113,
          facility_uptime: 100,
          notes: null,
          raw_imported_values: { sourceSheet: "Summary", values: { pm_cm_work_order_ratio: 82.51 } },
        },
      ],
      { businessUnitId: "ez" },
    );

    expect(ctx.MonthlyScoreData.ez[2026][2].pmcmWORatio).toBe(82.51);
    expect(ctx.MonthlyScoreData.ez[2026][2].pm_cm_work_order_ratio).toBe(82.51);
  });

  it("closes the import modal after a successful Summary save", async () => {
    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const ctx = createImportExcelContext(makeConsolidatedWorkbookWithRow({}));
    await runImportExcel(ctx);

    expect(ctx.saveCalls.length).toBe(1);
    expect(ctx.closeImportModalCalls).toContain(true);
    expect(ctx.toastCalls.some((t: any) => t.type === "success")).toBe(true);
  });

  it("keeps the import modal open when persistence fails", async () => {
    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const ctx = createImportExcelContext(makeConsolidatedWorkbookWithRow({}));
    ctx.saveReject = new Error("Database unavailable");
    await runImportExcel(ctx);

    expect(ctx.saveCalls.length).toBe(1);
    expect(ctx.closeImportModalCalls.length).toBe(0);
    expect(ctx.toastCalls.some((t: any) => t.type === "error")).toBe(true);
  });

  it("preserves existing records and does not display unsaved workbook values on save failure", async () => {
    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const ctx = createImportExcelContext(makeConsolidatedWorkbookWithRow({}));

    // Seed existing saved records.
    ctx.applyPersistedMonthlyKpiRecords(
      [
        {
          id: 1,
          business_unit: "AMD-EZ",
          reporting_year: 2026,
          reporting_month: 1,
          pm_compliance: 55,
          budget_spend: 60,
          pm_cm_work_order_ratio: 61,
          pm_cm_cost_ratio: 62,
          mttr_days: 63,
          facility_uptime: 64,
          notes: "existing",
          raw_imported_values: null,
        },
      ],
      { businessUnitId: "ez" },
    );

    ctx.saveReject = new Error("Database unavailable");
    await runImportExcel(ctx);

    expect(ctx.saveCalls.length).toBe(1);
    expect(ctx.closeImportModalCalls.length).toBe(0);

    // Existing saved record must survive the failed import.
    const afterFailure = ctx.MonthlyScoreData.ez[2026][1];
    expect(afterFailure.pm_compliance).toBe(55);
    expect(afterFailure.pm_cm_work_order_ratio).toBe(61);
    expect(afterFailure.mttr_days).toBe(63);
    expect(afterFailure.notes).toBe("existing");

    // Unsaved workbook value must not be published.
    expect(afterFailure.pm_compliance).not.toBe(98.9);
  });

  it("discards temporary imported state when replacement is cancelled", async () => {
    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const summaryRows = [
      ["Month", "PM Compliance (%)", "Budget Spend (%)", "PM vs CM Ratio (Work Orders) (%)", "PM vs CM Ratio (Cost) (%)", "MTTR (days)", "Facility Uptime (%)"],
      [46023, 98.9, 103.67, 69.52, 74.73, 113, 100],
    ];

    const workbook = {
      SheetNames: ["Summary"],
      Sheets: { Summary: makeSheet(summaryRows) },
    };

    const ctx = createImportExcelContext(workbook);

    // Seed a previously saved record for the same month.
    ctx.applyPersistedMonthlyKpiRecords(
      [
        {
          id: 1,
          business_unit: "AMD-EZ",
          reporting_year: 2026,
          reporting_month: 1,
          pm_compliance: 55,
          budget_spend: 60,
          pm_cm_work_order_ratio: 61,
          pm_cm_cost_ratio: 62,
          mttr_days: 63,
          facility_uptime: 64,
          notes: "existing",
          raw_imported_values: null,
        },
      ],
      { businessUnitId: "ez" },
    );

    const existingPmCompliance = ctx.MonthlyScoreData.ez[2026][1].pm_compliance;
    const existingPmCmWo = ctx.MonthlyScoreData.ez[2026][1].pm_cm_work_order_ratio;
    const existingMttr = ctx.MonthlyScoreData.ez[2026][1].mttr_days;

    // Force a conflict and cancel the replacement prompt.
    ctx.importConflicts = [{ year: 2026, month: 1 }];

    const runPromise = runImportExcel(ctx);
    await resolveImportConflict(ctx, false);
    await runPromise;

    expect(ctx.saveCalls.length).toBe(0);
    expect(ctx.closeImportModalCalls.length).toBe(0);

    // Existing saved record must survive the cancelled import.
    const afterCancel = ctx.MonthlyScoreData.ez[2026][1];
    expect(afterCancel.pm_compliance).toBe(existingPmCompliance);
    expect(afterCancel.pm_cm_work_order_ratio).toBe(existingPmCmWo);
    expect(afterCancel.mttr_days).toBe(existingMttr);
    expect(afterCancel.notes).toBe("existing");
  });

  it("only renders the six approved KPIs in cards, matrix, and monthly records table", () => {
    expect(extractScriptArray("GaugeKPIs")).toEqual([
      "pmCompliance",
      "budgetSpend",
      "pmcmWORatio",
      "pmcmCostRatio",
      "mttr",
      "facilityUptime",
    ]);
    expect(extractScriptArray("SummaryMatrixKPIs")).toEqual([
      "pmCompliance",
      "budgetSpend",
      "pmcmWORatio",
      "pmcmCostRatio",
      "mttr",
      "facilityUptime",
    ]);

    const monthlyRecordsRenderer = scorecardHtml.slice(
      scorecardHtml.indexOf("function renderMonthlyRecords(buId)"),
      scorecardHtml.indexOf("// ===== CHARTS ====="),
    );
    expect(monthlyRecordsRenderer).toContain("'Month','PM Compliance (%)','Budget Spend (%)','PM vs CM WO (%)','PM vs CM Cost (%)','MTTR (Days)','Facility Uptime (%)'");
    expect(monthlyRecordsRenderer).not.toContain("Schedule Compliance");
    expect(monthlyRecordsRenderer).not.toContain("MTBF");

    expect(scorecardHtml).not.toContain("Schedule Compliance");
    expect(scorecardHtml).not.toContain("MTBF");
  });

  it("keeps the modal closed and treats save as successful when the post-save tab switch fails", async () => {
    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const ctx = createImportExcelContext(makeConsolidatedWorkbookWithRow({}));
    await runImportExcel(ctx);

    expect(ctx.saveCalls.length).toBe(1);
    expect(ctx.closeImportModalCalls).toContain(true);
    expect(ctx.toastCalls.some((t: any) => t.type === "success")).toBe(true);
    // Persisted records are applied; no optimistic pre-save mutation occurred.
    expect(ctx.MonthlyScoreData.ez).toBeDefined();
    expect(ctx.MonthlyScoreData.ez[2026][1].pm_compliance).toBe(98.9);
    expect(ctx.MonthlyScoreData.ez[2026][1].pm_cm_work_order_ratio).toBe(69.52);
  });

  it("clears the selected file after a successful POST", async () => {
    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const fileInput = { value: "test.xlsx" };
    const ctx = createImportExcelContext(makeConsolidatedWorkbookWithRow({}));

    const originalGetElementById = ctx.document.getElementById;
    ctx.document.getElementById = (id: string) => {
      if (id === "excelInput") return fileInput as any;
      return originalGetElementById(id);
    };

    await runImportExcel(ctx);

    expect(ctx.saveCalls.length).toBe(1);
    expect(fileInput.value).toBe("");
  });

  it("keeps the selected file when the POST fails", async () => {
    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const fileInput = { value: "test.xlsx" };
    const ctx = createImportExcelContext(makeConsolidatedWorkbookWithRow({}));
    ctx.saveReject = new Error("Database unavailable");

    const originalGetElementById = ctx.document.getElementById;
    ctx.document.getElementById = (id: string) => {
      if (id === "excelInput") return fileInput as any;
      return originalGetElementById(id);
    };

    await runImportExcel(ctx);

    expect(ctx.saveCalls.length).toBe(1);
    expect(ctx.closeImportModalCalls.length).toBe(0);
    expect(fileInput.value).toBe("test.xlsx");
  });

  it("does not change state when replacement is cancelled", async () => {
    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const ctx = createImportExcelContext(makeConsolidatedWorkbookWithRow({}));

    ctx.importConflicts = [{ year: 2026, month: 1 }];

    const beforeMonthly = JSON.stringify(ctx.MonthlyScoreData);
    const beforeScore = JSON.stringify(ctx.ScoreData);

    const runPromise = runImportExcel(ctx);
    await resolveImportConflict(ctx, false);
    await runPromise;

    expect(ctx.saveCalls.length).toBe(0);
    expect(ctx.closeImportModalCalls.length).toBe(0);
    expect(JSON.stringify(ctx.MonthlyScoreData)).toBe(beforeMonthly);
    expect(JSON.stringify(ctx.ScoreData)).toBe(beforeScore);
  });


  it("merges POST-returned imported records without deleting other months in the same business unit", async () => {
    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const ctx = createImportExcelContext(makeConsolidatedWorkbookWithRow({}));

    // Seed an existing record for a different month in the same BU.
    ctx.applyPersistedMonthlyKpiRecords(
      [
        {
          id: 10,
          business_unit: "AMD-EZ",
          reporting_year: 2026,
          reporting_month: 2,
          pm_compliance: 88.8,
          budget_spend: 90,
          pm_cm_work_order_ratio: 82.51,
          pm_cm_cost_ratio: 72.73,
          mttr_days: 999,
          facility_uptime: 95,
          notes: "feb-existing",
          raw_imported_values: null,
        },
      ],
      { businessUnitId: "ez" },
    );

    await runImportExcel(ctx);

    expect(ctx.closeImportModalCalls).toContain(true);
    // The imported January record is applied.
    expect(ctx.MonthlyScoreData.ez[2026][1].pm_compliance).toBe(98.9);
    // The existing February record survives because apply is merge mode.
    expect(ctx.MonthlyScoreData.ez[2026][2].pm_compliance).toBe(88.8);
    expect(ctx.MonthlyScoreData.ez[2026][2].pm_cm_work_order_ratio).toBe(82.51);
    expect(ctx.MonthlyScoreData.ez[2026][2].mttr_days).toBe(999);
  });

  it("does not delete existing months when a one-month legacy import is applied", () => {
    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const legacyRows = [
      ["Business Unit", "Year", "Month", "PM Compliance (%)", "Budget Spend (%)", "PM vs CM Ratio (Work Orders) (%)", "PM vs CM Ratio (Cost) (%)", "MTTR (days)", "Facility Uptime (%)", "Notes"],
      ["AMD-EZ", 2026, 3, 77, 88, 66, 55, 44, 99, "march-legacy"],
    ];
    const ctx = createImportExcelContext({
      SheetNames: ["Legacy"],
      Sheets: { Legacy: makeSheet(legacyRows) },
    });

    // Seed an existing January record in the same BU.
    ctx.applyPersistedMonthlyKpiRecords(
      [
        {
          id: 11,
          business_unit: "AMD-EZ",
          reporting_year: 2026,
          reporting_month: 1,
          pm_compliance: 99,
          budget_spend: 100,
          pm_cm_work_order_ratio: 70,
          pm_cm_cost_ratio: 60,
          mttr_days: 120,
          facility_uptime: 98,
          notes: "jan-existing",
          raw_imported_values: null,
        },
      ],
      { businessUnitId: "ez" },
    );

    const legacyResult = ctx.importLegacyWorkbook({ SheetNames: ["Legacy"], Sheets: { Legacy: makeSheet(legacyRows) } }, "legacy.xlsx", "ez", ctx.BUs[0]);
    expect(legacyResult.imported).toBe(1);
    ctx.applyPersistedMonthlyKpiRecords(legacyResult.records, { businessUnitId: "ez", merge: true });

    // Imported March record is applied.
    expect(ctx.MonthlyScoreData.ez[2026][3].pm_compliance).toBe(77);
    expect(ctx.MonthlyScoreData.ez[2026][3].notes).toBe("march-legacy");
    // Existing January record survives.
    expect(ctx.MonthlyScoreData.ez[2026][1].pm_compliance).toBe(99);
    expect(ctx.MonthlyScoreData.ez[2026][1].notes).toBe("jan-existing");
  });


  it("shows an in-page conflict prompt, then POSTs only after Replace Existing Records is chosen", async () => {
    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const ctx = createImportExcelContext(makeConsolidatedWorkbookWithRow({}));

    // Seed existing saved record to trigger conflict detection.
    ctx.applyPersistedMonthlyKpiRecords(
      [
        {
          id: 1,
          business_unit: "AMD-EZ",
          reporting_year: 2026,
          reporting_month: 1,
          pm_compliance: 55,
          budget_spend: 60,
          pm_cm_work_order_ratio: 61,
          pm_cm_cost_ratio: 62,
          mttr_days: 63,
          facility_uptime: 64,
          notes: "existing",
          raw_imported_values: null,
        },
      ],
      { businessUnitId: "ez" },
    );

    ctx.importConflicts = [{ year: 2026, month: 1 }];

    const beforeMonthly = JSON.stringify(ctx.MonthlyScoreData);
    const runPromise = runImportExcel(ctx);

    // Wait for FileReader mock and importExcel inner setTimeout to reach conflict prompt.
    await new Promise((r) => setTimeout(r, 150));

    // Confirm the in-page conflict prompt is visible and the primary actions are hidden.
    const conflictPanel = ctx.document.getElementById("importConflictPanel") as { style: { display: string } };
    const primaryActions = ctx.document.getElementById("importPrimaryActions") as { style: { display: string } };
    const conflictMessage = ctx.document.getElementById("importConflictMessage") as { textContent: string };
    expect(conflictPanel.style.display).toBe("block");
    expect(primaryActions.style.display).toBe("none");
    expect(conflictMessage.textContent).toContain("Replace existing data for the selected month(s)?");

    // Before the user chooses, no POST has happened and state is unchanged.
    expect(ctx.saveCalls.length).toBe(0);
    expect(JSON.stringify(ctx.MonthlyScoreData)).toBe(beforeMonthly);

    // Choosing Replace Existing Records triggers the POST and applies persisted records.
    await resolveImportConflict(ctx, true);
    await runPromise;

    expect(ctx.saveCalls.length).toBe(1);
    expect(ctx.closeImportModalCalls).toContain(true);
    expect(ctx.MonthlyScoreData.ez[2026][1].pm_compliance).toBe(98.9);
  });

  it("does not POST and keeps existing records when Cancel Import is chosen from the conflict prompt", async () => {
    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const fileInput = { value: "test.xlsx" };
    const ctx = createImportExcelContext(makeConsolidatedWorkbookWithRow({}));

    const originalGetElementById = ctx.document.getElementById;
    ctx.document.getElementById = (id: string) => {
      if (id === "excelInput") return fileInput as any;
      return originalGetElementById(id);
    };

    ctx.applyPersistedMonthlyKpiRecords(
      [
        {
          id: 1,
          business_unit: "AMD-EZ",
          reporting_year: 2026,
          reporting_month: 1,
          pm_compliance: 55,
          budget_spend: 60,
          pm_cm_work_order_ratio: 61,
          pm_cm_cost_ratio: 62,
          mttr_days: 63,
          facility_uptime: 64,
          notes: "existing",
          raw_imported_values: null,
        },
      ],
      { businessUnitId: "ez" },
    );

    ctx.importConflicts = [{ year: 2026, month: 1 }];

    const beforeMonthly = JSON.stringify(ctx.MonthlyScoreData);
    const beforeScore = JSON.stringify(ctx.ScoreData);
    const runPromise = runImportExcel(ctx);

    // Wait for conflict prompt to appear before cancelling.
    await new Promise((r) => setTimeout(r, 150));

    // Cancel from the in-page conflict prompt.
    await resolveImportConflict(ctx, false);
    await runPromise;

    expect(ctx.saveCalls.length).toBe(0);
    expect(ctx.closeImportModalCalls.length).toBe(0);
    expect(fileInput.value).toBe("test.xlsx");
    expect(JSON.stringify(ctx.MonthlyScoreData)).toBe(beforeMonthly);
    expect(JSON.stringify(ctx.ScoreData)).toBe(beforeScore);
  });

  it("imports whitespace-only KPI cells as null, not 0", () => {
    const ctx = createImportContext();
    ctx.getBUApiValue = () => "amd-ez";

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const summaryRows = [
      ["Month", "PM Compliance (%)", "Budget Spend (%)", "PM vs CM Ratio (Work Orders) (%)", "PM vs CM Ratio (Cost) (%)", "MTTR (days)", "Facility Uptime (%)"],
      [46023, " ", " ", " ", " ", " ", " "],
    ];

    const workbook = {
      SheetNames: ["Summary"],
      Sheets: { Summary: makeSheet(summaryRows) },
    };

    const result = ctx.importSummaryWorkbook(workbook, "test.xlsx", "ez");
    const record = result.records[0];
    expect(record.pm_compliance).toBeNull();
    expect(record.budget_spend).toBeNull();
    expect(record.pm_cm_work_order_ratio).toBeNull();
    expect(record.pm_cm_cost_ratio).toBeNull();
    expect(record.mttr_days).toBeNull();
    expect(record.facility_uptime).toBeNull();
  });

  it("treats a successful POST as successful even when the fallback re-fetch fails", async () => {
    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const fileInput = { value: "test.xlsx" };
    const ctx = createImportExcelContext(makeConsolidatedWorkbookWithRow({}));

    const originalGetElementById = ctx.document.getElementById;
    ctx.document.getElementById = (id: string) => {
      if (id === "excelInput") return fileInput as any;
      return originalGetElementById(id);
    };

    // Seed existing persisted records; the POST response will be empty, forcing a fallback re-fetch.
    ctx.savedRecords = [];
    ctx.fetchSavedReject = new Error("Saved-record refresh failed");

    await runImportExcel(ctx);

    expect(ctx.saveCalls.length).toBe(1);
    expect(ctx.closeImportModalCalls).toContain(true);
    expect(fileInput.value).toBe("");

    // Save is still reported as successful; no error toast is shown for the re-fetch failure.
    expect(ctx.toastCalls.some((t: any) => t.type === "success")).toBe(true);
    expect(ctx.toastCalls.some((t: any) => t.type === "warning" && t.message.includes("could not refresh automatically"))).toBe(true);
    expect(ctx.toastCalls.some((t: any) => t.type === "error")).toBe(false);

    // No optimistic workbook values leaked into dashboard state.
    expect(ctx.MonthlyScoreData.ez).toBeUndefined();
  });

  it("cancelling replacement leaves the modal open, keeps the file selected, and makes no API call", async () => {
    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const fileInput = { value: "test.xlsx" };
    const ctx = createImportExcelContext(makeConsolidatedWorkbookWithRow({}));

    const originalGetElementById = ctx.document.getElementById;
    ctx.document.getElementById = (id: string) => {
      if (id === "excelInput") return fileInput as any;
      return originalGetElementById(id);
    };

    ctx.importConflicts = [{ year: 2026, month: 1 }];

    const beforeMonthly = JSON.stringify(ctx.MonthlyScoreData);
    const beforeScore = JSON.stringify(ctx.ScoreData);

    const runPromise = runImportExcel(ctx);
    await resolveImportConflict(ctx, false);
    await runPromise;

    expect(ctx.saveCalls.length).toBe(0);
    expect(ctx.closeImportModalCalls.length).toBe(0);
    expect(fileInput.value).toBe("test.xlsx");
    expect(JSON.stringify(ctx.MonthlyScoreData)).toBe(beforeMonthly);
    expect(JSON.stringify(ctx.ScoreData)).toBe(beforeScore);
  });

});


  it('imports successfully when Summary month header is "Reporting Month"', () => {
    const ctx = createImportContext();
    ctx.getBUApiValue = () => 'amd-ez';

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === 'number' ? 'n' : 's' };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ['Summary'],
      Sheets: {
        Summary: makeSheet([
          ['Reporting Month', 'PM Compliance (%)', 'Budget Spend (%)', 'PM vs CM Ratio (Work Orders) (%)', 'PM vs CM Ratio (Cost) (%)', 'MTTR (days)', 'Facility Uptime (%)'],
          [46023, 98.9, 103.67, 69.52, 74.73, 113, 100],
        ]),
      },
    };

    const result = ctx.importSummaryWorkbook(workbook, 'test.xlsx', 'ez');
    expect(result.imported).toBe(1);
    const record = result.records[0];
    expect(record.reporting_month).toBe(1);
    expect(record.reporting_year).toBe(2026);
    expect(record.pm_compliance).toBe(98.9);
    expect(record.budget_spend).toBe(103.67);
    expect(record.pm_cm_work_order_ratio).toBe(69.52);
    expect(record.pm_cm_cost_ratio).toBe(74.73);
  });

  it('imports successfully when Summary month header is "Period"', () => {
    const ctx = createImportContext();
    ctx.getBUApiValue = () => 'amd-ez';

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === 'number' ? 'n' : 's' };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ['Summary'],
      Sheets: {
        Summary: makeSheet([
          ['Period', 'PM Compliance (%)', 'Budget Spend (%)', 'PM vs CM Ratio (Work Orders) (%)', 'PM vs CM Ratio (Cost) (%)', 'MTTR (days)', 'Facility Uptime (%)'],
          [46023, 98.9, 103.67, 69.52, 74.73, 113, 100],
        ]),
      },
    };

    const result = ctx.importSummaryWorkbook(workbook, 'test.xlsx', 'ez');
    expect(result.imported).toBe(1);
    expect(result.records[0].reporting_month).toBe(1);
  });

  it('imports successfully when Summary month header is "Month Date"', () => {
    const ctx = createImportContext();
    ctx.getBUApiValue = () => 'amd-ez';

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === 'number' ? 'n' : 's' };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ['Summary'],
      Sheets: {
        Summary: makeSheet([
          ['Month Date', 'PM Compliance (%)', 'Budget Spend (%)', 'PM vs CM Ratio (Work Orders) (%)', 'PM vs CM Ratio (Cost) (%)', 'MTTR (days)', 'Facility Uptime (%)'],
          [46023, 98.9, 103.67, 69.52, 74.73, 113, 100],
        ]),
      },
    };

    const result = ctx.importSummaryWorkbook(workbook, 'test.xlsx', 'ez');
    expect(result.imported).toBe(1);
    expect(result.records[0].reporting_month).toBe(1);
  });

  it('matches month header case-insensitively and trims spaces', () => {
    const ctx = createImportContext();
    ctx.getBUApiValue = () => 'amd-ez';

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === 'number' ? 'n' : 's' };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ['Summary'],
      Sheets: {
        Summary: makeSheet([
          ['  RePoRtInG MoNth ', 'PM Compliance (%)', 'Budget Spend (%)', 'PM vs CM Ratio (Work Orders) (%)', 'PM vs CM Ratio (Cost) (%)', 'MTTR (days)', 'Facility Uptime (%)'],
          [46023, 98.9, 103.67, 69.52, 74.73, 113, 100],
        ]),
      },
    };

    const result = ctx.importSummaryWorkbook(workbook, 'test.xlsx', 'ez');
    expect(result.imported).toBe(1);
    expect(result.records[0].reporting_month).toBe(1);
  });

  it('imports a Summary sheet with a line-break month header', () => {
    const ctx = createImportContext();
    ctx.getBUApiValue = () => 'amd-ez';

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === 'number' ? 'n' : 's' };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ['Summary'],
      Sheets: {
        Summary: makeSheet([
          ['Reporting\nMonth', 'PM Compliance (%)', 'Budget Spend (%)', 'PM vs CM Ratio (Work Orders) (%)', 'PM vs CM Ratio (Cost) (%)', 'MTTR (days)', 'Facility Uptime (%)'],
          [46023, 98.9, 103.67, 69.52, 74.73, 113, 100],
        ]),
      },
    };

    const result = ctx.importSummaryWorkbook(workbook, 'test.xlsx', 'ez');
    expect(result.imported).toBe(1);
    expect(result.records[0].reporting_month).toBe(1);
  });

  it('detects month labels from the first column when no month header is present', () => {
    const ctx = createImportContext();
    ctx.getBUApiValue = () => 'amd-ez';

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === 'number' ? 'n' : 's' };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ['Summary'],
      Sheets: {
        Summary: makeSheet([
          ['', 'PM Compliance (%)', 'Budget Spend (%)', 'PM vs CM Ratio (Work Orders) (%)', 'PM vs CM Ratio (Cost) (%)', 'MTTR (days)', 'Facility Uptime (%)'],
          ['January', 98.9, 103.67, 69.52, 74.73, 113, 100],
          ['February', 99.1, 104.0, 70.0, 75.0, 110, 99],
        ]),
      },
    };

    const result = ctx.importSummaryWorkbook(workbook, 'test.xlsx', 'ez');
    expect(result.imported).toBe(2);
    const jan = result.records.find((r: any) => r.reporting_month === 1);
    const feb = result.records.find((r: any) => r.reporting_month === 2);
    expect(jan).toBeDefined();
    expect(feb).toBeDefined();
    expect(jan?.pm_compliance).toBe(98.9);
    expect(feb?.pm_compliance).toBe(99.1);
  });

  it('falls back to the selected UI month for a single-row Summary sheet with no month column', () => {
    const ctx = createImportContext();
    ctx.getBUApiValue = () => 'amd-ez';

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === 'number' ? 'n' : 's' };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ['Summary'],
      Sheets: {
        Summary: makeSheet([
          ['', 'PM Compliance (%)', 'Budget Spend (%)', 'PM vs CM Ratio (Work Orders) (%)', 'PM vs CM Ratio (Cost) (%)', 'MTTR (days)', 'Facility Uptime (%)'],
          ['', 98.9, 103.67, 69.52, 74.73, 113, 100],
        ]),
      },
    };

    const result = ctx.importSummaryWorkbook(workbook, 'test.xlsx', 'ez');
    expect(result.imported).toBe(1);
    expect(result.records[0].reporting_month).toBe(1);
    expect(result.records[0].reporting_year).toBe(2026);
  });

  it('throws a user-friendly error when the month column cannot be identified', () => {
    const ctx = createImportContext();
    ctx.getBUApiValue = () => 'amd-ez';

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === 'number' ? 'n' : 's' };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ['Summary'],
      Sheets: {
        Summary: makeSheet([
          ['Metric', 'PM Compliance (%)', 'Budget Spend (%)'],
          ['Row 1', 98.9, 103.67],
          ['Row 2', 99.1, 104.0],
        ]),
      },
    };

    expect(() => ctx.importSummaryWorkbook(workbook, 'test.xlsx', 'ez')).toThrow(
      'Could not identify the reporting month in the Summary sheet. Expected a header such as Month, Reporting Month, Period, or Month Date.'
    );
  });

  it('Budget Spend persists correctly after refresh', () => {
    const ctx = createImportContext();
    ctx.applyPersistedMonthlyKpiRecords(
      [
        {
          id: 10,
          business_unit: 'AMD-EZ',
          reporting_year: 2026,
          reporting_month: 5,
          budget_spend: 96.5,
        },
      ],
      { businessUnitId: 'ez' },
    );
    expect(ctx.MonthlyScoreData.ez[2026][5].budgetSpend).toBe(96.5);
    expect(ctx.MonthlyScoreData.ez[2026][5].budget_spend).toBe(96.5);
  });

  it('PM:CM cost ratio persists correctly after refresh', () => {
    const ctx = createImportContext();
    ctx.applyPersistedMonthlyKpiRecords(
      [
        {
          id: 11,
          business_unit: 'AMD-EZ',
          reporting_year: 2026,
          reporting_month: 5,
          pm_cm_cost_ratio: 71.25,
        },
      ],
      { businessUnitId: 'ez' },
    );
    expect(ctx.MonthlyScoreData.ez[2026][5].pmcmCostRatio).toBe(71.25);
    expect(ctx.MonthlyScoreData.ez[2026][5].pm_cm_cost_ratio).toBe(71.25);
  });

describe("Monthly KPI Scorecard Scope / Inclusions tab", () => {
  it("adds a Scope / Inclusions tab beside Definitions / FAQ", () => {
    expect(scorecardHtml).toContain('<button class="tab" data-tab="scope-inclusions">Scope / Inclusions</button>');
    expect(scorecardHtml).toContain('id="t-scope-inclusions"');
    expect(scorecardHtml).toContain('id="scope-inclusions-content"');
  });

  it("states that the scorecard covers only Repair and Maintenance – Technical Equipment", () => {
    const scopePanel = scorecardHtml.match(/id="t-scope-inclusions"[\s\S]*?<!-- MANUAL INPUT MODAL/)?.[0] ?? "";
    expect(scopePanel).toContain("Repair and Maintenance – Technical Equipment");
    expect(scopePanel).toContain("Primary GL scope for this scorecard");
    expect(scopePanel).toContain("Included");
  });

  it("lists the required excluded categories", () => {
    const scopePanel = scorecardHtml.match(/id="t-scope-inclusions"[\s\S]*?<!-- MANUAL INPUT MODAL/)?.[0] ?? "";
    expect(scopePanel).toContain("Building / civil / structural");
    expect(scopePanel).toContain("Fleet / vehicle");
    expect(scopePanel).toContain("IT equipment and office equipment");
    expect(scopePanel).toContain("Property / Facilities / General Services");
    expect(scopePanel).toContain("CAPEX");
  });

  it("does not invent exact SAP GL account numbers", () => {
    const scopePanel = scorecardHtml.match(/id="t-scope-inclusions"[\s\S]*?<!-- MANUAL INPUT MODAL/)?.[0] ?? "";
    expect(scopePanel).toContain("Exact SAP GL account codes should be confirmed");
    expect(scopePanel).not.toMatch(/\b\d{4,6}\b/);
  });

  it("keeps only the six approved KPI cards visible", () => {
    expect(extractScriptArray("GaugeKPIs")).toEqual([
      "pmCompliance",
      "budgetSpend",
      "pmcmWORatio",
      "pmcmCostRatio",
      "mttr",
      "facilityUptime",
    ]);
  });
  it("imports raw Budget Spend values from a consolidated workbook and recomputes monthly budget spend", () => {
    const ctx = createImportContext();

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ["Budget Spend"],
      Sheets: {
        "Budget Spend": makeSheet([
          ["BUSINESS UNIT", "Month", "Actual Spend", "Budget", "Budget Spend (%)"],
          ["AMD-EZ", 46023, 100, 100, 99],
          ["AMD-EZ", 46054, 150, 100, 149],
        ]),
      },
    };

    const result = ctx.importConsolidatedWorkbook(workbook, "consolidated.xlsx");
    expect(result.imported).toBe(2);
    const jan = result.records.find((r: any) => r.reporting_month === 1);
    const feb = result.records.find((r: any) => r.reporting_month === 2);
    expect(jan?.actual_spend).toBe(100);
    expect(jan?.budget).toBe(100);
    expect(jan?.budget_spend).toBe(100);
    expect(feb?.actual_spend).toBe(150);
    expect(feb?.budget).toBe(100);
    expect(feb?.budget_spend).toBe(150);
  });

  it("imports PM:CM Work Orders and PM:CM Cost sheets without cross-populating fields", () => {
    const ctx = createImportContext();

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ["PM CM Work Orders", "PM CM Cost"],
      Sheets: {
        "PM CM Work Orders": makeSheet([
          ["BUSINESS UNIT", "Month", "PM Work Orders", "CM Work Orders"],
          ["AMD-EZ", 46023, 90, 10],
          ["AMD-EZ", 46054, 80, 20],
        ]),
        "PM CM Cost": makeSheet([
          ["BUSINESS UNIT", "Month", "PM Cost", "CM Cost"],
          ["AMD-EZ", 46023, 8000, 2000],
          ["AMD-EZ", 46054, 6000, 4000],
        ]),
      },
    };

    const result = ctx.importConsolidatedWorkbook(workbook, "pmcm-multi-sheet.xlsx");
    expect(result.imported).toBe(2);
    const jan = result.records.find((r: any) => r.reporting_month === 1);
    const feb = result.records.find((r: any) => r.reporting_month === 2);

    expect(jan?.pm_work_orders).toBe(90);
    expect(jan?.cm_work_orders).toBe(10);
    expect(jan?.pm_cost).toBe(8000);
    expect(jan?.cm_cost).toBe(2000);
    expect(jan?.pm_cm_work_order_ratio).toBeCloseTo((90 / 100) * 100, 2);
    expect(jan?.pm_cm_cost_ratio).toBeCloseTo((8000 / 10000) * 100, 2);

    expect(feb?.pm_work_orders).toBe(80);
    expect(feb?.cm_work_orders).toBe(20);
    expect(feb?.pm_cost).toBe(6000);
    expect(feb?.cm_cost).toBe(4000);
    expect(feb?.pm_cm_work_order_ratio).toBeCloseTo((80 / 100) * 100, 2);
    expect(feb?.pm_cm_cost_ratio).toBeCloseTo((6000 / 10000) * 100, 2);
  });
  it("imports a Notes column from a consolidated KPI sheet and persists it to record.notes", () => {
    const ctx = createImportContext();

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ["Budget Spend"],
      Sheets: {
        "Budget Spend": makeSheet([
          ["BUSINESS UNIT", "Month", "Actual Spend", "Budget", "Notes"],
          ["AMD-EZ", 46023, 100, 100, "Under budget due to deferred vendor work."],
        ]),
      },
    };

    const result = ctx.importConsolidatedWorkbook(workbook, "notes-single.xlsx");
    expect(result.imported).toBe(1);
    const jan = result.records[0];
    expect(jan.notes).toBe("Under budget due to deferred vendor work.");
    expect(jan.actual_spend).toBe(100);
    expect(jan.budget).toBe(100);
    expect(jan.budget_spend).toBe(100);
  });

  it("does not fail import when a consolidated KPI sheet is missing the Notes column", () => {
    const ctx = createImportContext();

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ["Budget Spend"],
      Sheets: {
        "Budget Spend": makeSheet([
          ["BUSINESS UNIT", "Month", "Actual Spend", "Budget"],
          ["AMD-EZ", 46023, 100, 100],
        ]),
      },
    };

    const result = ctx.importConsolidatedWorkbook(workbook, "notes-missing.xlsx");
    expect(result.imported).toBe(1);
    expect(result.records[0].notes).toBeNull();
    expect(result.records[0].budget_spend).toBe(100);
  });

  it("turns a blank Notes cell into null during consolidated import", () => {
    const ctx = createImportContext();

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ["Budget Spend"],
      Sheets: {
        "Budget Spend": makeSheet([
          ["BUSINESS UNIT", "Month", "Actual Spend", "Budget", "Remarks"],
          ["AMD-EZ", 46023, 100, 100, ""],
        ]),
      },
    };

    const result = ctx.importConsolidatedWorkbook(workbook, "notes-blank.xlsx");
    expect(result.imported).toBe(1);
    expect(result.records[0].notes).toBeNull();
  });

  it("recognizes alternate Notes headers such as Remarks, Comment, and Situation", () => {
    const ctx = createImportContext();

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ["MTTR", "Facility Uptime", "Budget Spend"],
      Sheets: {
        MTTR: makeSheet([
          ["BUSINESS UNIT", "Month", "Total Downtime", "Number of Repairs", "Remarks"],
          ["AMD-EZ", 46023, 10, 2, "Pump seal leak"],
        ]),
        "Facility Uptime": makeSheet([
          ["BU", "Month", "Total Operating Time", "Total Downtime", "Comment"],
          ["AMD-EZ", 46023, 1000, 10, "Scheduled outage"],
        ]),
        "Budget Spend": makeSheet([
          ["BUSINESS UNIT", "Month", "Actual Spend", "Budget", "Situation"],
          ["AMD-EZ", 46023, 100, 100, "Budget held"],
        ]),
      },
    };

    const result = ctx.importConsolidatedWorkbook(workbook, "notes-aliases.xlsx");
    expect(result.imported).toBe(1);
    const jan = result.records[0];
    expect(jan.notes).toBe("MTTR: Pump seal leak; Facility Uptime: Scheduled outage; Budget Spend: Budget held");
    expect(jan.mttr_days).toBeCloseTo(5, 2);
    expect(jan.facility_uptime).toBeCloseTo(99, 2);
  });

  it("combines notes from multiple consolidated sheets for the same BU/month with sheet labels and deduplicates identical text", () => {
    const ctx = createImportContext();

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ["Budget Spend", "MTTR", "PM CM Work Orders"],
      Sheets: {
        "Budget Spend": makeSheet([
          ["BUSINESS UNIT", "Month", "Actual Spend", "Budget", "Notes"],
          ["AMD-EZ", 46023, 100, 100, "Shared note"],
        ]),
        MTTR: makeSheet([
          ["BUSINESS UNIT", "Month", "Total Downtime", "Number of Repairs", "Note"],
          ["AMD-EZ", 46023, 10, 2, "Shared note"],
        ]),
        "PM CM Work Orders": makeSheet([
          ["BUSINESS UNIT", "Month", "PM Work Orders", "CM Work Orders", "Notes"],
          ["AMD-EZ", 46023, 90, 10, "PM dominated month."],
        ]),
      },
    };

    const result = ctx.importConsolidatedWorkbook(workbook, "notes-combined.xlsx");
    expect(result.imported).toBe(1);
    const jan = result.records[0];
    expect(jan.notes).toBe("Budget Spend: Shared note; PM CM Work Orders: PM dominated month.");
    expect(jan.budget_spend).toBe(100);
    expect(jan.mttr_days).toBeCloseTo(5, 2);
    expect(jan.pm_cm_work_order_ratio).toBeCloseTo(90, 2);
  });



  it("imports the new 7-column BU template and ignores formula/output columns F and G", () => {
    const ctx = createImportContext();

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ["Instructions", "Summary", "_Lists", "_ChartData", "PM Compliance", "Budget Spend", "PM CM Work Orders", "PM CM Cost", "MTTR", "Facility Uptime", "Executive Dashboard"],
      Sheets: {
        Instructions: makeSheet([["Instructions"]]),
        Summary: makeSheet([["Summary"]]),
        _Lists: makeSheet([["Business Units"], ["AMD-EZ"], ["Clark Water"]]),
        _ChartData: makeSheet([["Chart Data"]]),
        "PM Compliance": makeSheet([
          ["Business Unit", "Month", "PM Orders Completed On Time", "Total PM Orders", "Notes", "PM Compliance (%)", "Average / YTD KPI (%)"],
          ["AMD-EZ", 46023, 90, 100, "PM note", 90, 90],
        ]),
        "Budget Spend": makeSheet([
          ["Business Unit", "Month", "Actual Spend", "Budget", "Notes", "Budget Spend (%)", "Cumulative Budget Spend (%)"],
          ["AMD-EZ", 46023, 100, 100, null, 100, 100],
        ]),
        "PM CM Work Orders": makeSheet([
          ["Business Unit", "Month", "PM Work Orders", "CM Work Orders", "Notes", "PM:CM WO (%)", "Cumulative PM:CM WO (%)"],
          ["AMD-EZ", 46023, 90, 10, null, 90, 90],
        ]),
        "PM CM Cost": makeSheet([
          ["Business Unit", "Month", "PM Cost", "CM Cost", "Notes", "PM:CM Cost (%)", "Cumulative PM:CM Cost (%)"],
          ["AMD-EZ", 46023, 8000, 2000, null, 80, 80],
        ]),
        MTTR: makeSheet([
          ["Business Unit", "Month", "Total Downtime", "Number of Repairs", "Notes", "MTTR (Days)", "Cumulative MTTR (Days)"],
          ["AMD-EZ", 46023, 10, 2, null, 5, 5],
        ]),
        "Facility Uptime": makeSheet([
          ["Business Unit", "Month", "Total Operating Time", "Total Downtime", "Notes", "Facility Uptime (%)", "Average / YTD KPI (%)"],
          ["AMD-EZ", 46023, 1000, 0, null, 100, 100],
        ]),
        "Executive Dashboard": makeSheet([["Executive Dashboard"]]),
      },
    };

    const result = ctx.importConsolidatedWorkbook(workbook, "bu-template-7col.xlsx");
    expect(result.imported).toBe(1);
    const jan = result.records[0];
    expect(jan.business_unit).toBe("AMD-EZ");
    expect(jan.pm_orders_completed_on_time).toBe(90);
    expect(jan.total_pm_orders).toBe(100);
    expect(jan.pm_compliance).toBeCloseTo(90, 2);
    expect(jan.actual_spend).toBe(100);
    expect(jan.budget).toBe(100);
    expect(jan.budget_spend).toBeCloseTo(100, 2);
    expect(jan.pm_work_orders).toBe(90);
    expect(jan.cm_work_orders).toBe(10);
    expect(jan.pm_cm_work_order_ratio).toBeCloseTo(90, 2);
    expect(jan.pm_cost).toBe(8000);
    expect(jan.cm_cost).toBe(2000);
    expect(jan.pm_cm_cost_ratio).toBeCloseTo(80, 2);
    expect(jan.mttr_downtime).toBe(10);
    expect(jan.repair_count).toBe(2);
    expect(jan.mttr_days).toBeCloseTo(5, 2);
    expect(jan.facility_operating_time).toBe(1000);
    expect(jan.facility_downtime).toBe(0);
    expect(jan.facility_uptime).toBeCloseTo(100, 2);
    expect(jan.notes).toBe("PM note");
    // Generic legacy fields should remain null because KPI-specific fields are used.
    expect(jan.total_downtime).toBeNull();
    expect(jan.number_of_repairs).toBeNull();
    expect(jan.total_operating_time).toBeNull();
  });

  it("imports both AMD-EZ and Clark Water from a 7-column consolidated workbook", () => {
    const ctx = createImportContext();

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    function kpiSheet(name: string, c1: number, c2: number) {
      return makeSheet([
        ["Business Unit", "Month", name, "Total", "Notes", name + " (%)", "Cumulative " + name + " (%)"],
        ["AMD-EZ", 46023, c1, c2, null, (c1 / c2) * 100, (c1 / c2) * 100],
        ["Clark Water", 46023, c1, c2, null, (c1 / c2) * 100, (c1 / c2) * 100],
      ]);
    }

    const workbook = {
      SheetNames: ["Budget Spend", "PM Compliance"],
      Sheets: {
        "Budget Spend": makeSheet([
          ["Business Unit", "Month", "Actual Spend", "Budget", "Notes", "Budget Spend (%)", "Cumulative Budget Spend (%)"],
          ["AMD-EZ", 46023, 100, 100, null, 100, 100],
          ["Clark Water", 46023, 200, 100, null, 200, 200],
        ]),
        "PM Compliance": makeSheet([
          ["Business Unit", "Month", "PM Orders Completed On Time", "Total PM Orders", "Notes", "PM Compliance (%)", "Average / YTD KPI (%)"],
          ["AMD-EZ", 46023, 90, 100, null, 90, 90],
          ["Clark Water", 46023, 95, 100, null, 95, 95],
        ]),
      },
    };

    const result = ctx.importConsolidatedWorkbook(workbook, "multi-bu-7col.xlsx");
    expect(result.imported).toBe(2);
    const bus = result.records.map((r: any) => r.business_unit).sort();
    expect(bus).toEqual(["AMD-EZ", "Clark Water"]);
  });

  it("skips blank future months in the 7-column template without creating zero KPI records", () => {
    const ctx = createImportContext();

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ["Budget Spend"],
      Sheets: {
        "Budget Spend": makeSheet([
          ["Business Unit", "Month", "Actual Spend", "Budget", "Notes", "Budget Spend (%)", "Cumulative Budget Spend (%)"],
          ["AMD-EZ", 46023, 100, 100, null, 100, 100],
          ["AMD-EZ", 46054, null, null, null, "", ""],
          ["AMD-EZ", 46083, null, null, null, "", ""],
        ]),
      },
    };

    const result = ctx.importConsolidatedWorkbook(workbook, "blank-future.xlsx");
    expect(result.imported).toBe(1);
    const months = result.records.map((r: any) => r.reporting_month).sort();
    expect(months).toEqual([1]);
  });

  it("skips rows with numeric-only Business Unit values in the 7-column template", () => {
    const ctx = createImportContext();

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ["Budget Spend"],
      Sheets: {
        "Budget Spend": makeSheet([
          ["Business Unit", "Month", "Actual Spend", "Budget", "Notes", "Budget Spend (%)", "Cumulative Budget Spend (%)"],
          ["AMD-EZ", 46023, 100, 100, null, 100, 100],
          [100, 46023, 200, 100, null, 200, 200],
        ]),
      },
    };

    const result = ctx.importConsolidatedWorkbook(workbook, "numeric-bu-7col.xlsx");
    expect(result.imported).toBe(1);
    expect(result.records[0].business_unit).toBe("AMD-EZ");
  });
  it("clears AMD-EZ data when All Business Units is selected", async () => {
    const ctx = createImportContext();

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ["Budget Spend", "PM Compliance"],
      Sheets: {
        "Budget Spend": makeSheet([
          ["BUSINESS UNIT", "Month", "Actual Spend", "Budget", "Notes"],
          ["AMD-EZ", 46023, 100, 100, "EZ note"],
          ["Clark Water", 46023, 200, 100, "Clark note"],
        ]),
        "PM Compliance": makeSheet([
          ["BUSINESS UNIT", "Month", "Completed On Time", "Total Orders", "Notes"],
          ["AMD-EZ", 46023, 98, 100, null],
          ["Clark Water", 46023, 95, 100, null],
        ]),
      },
    };

    const result = ctx.importConsolidatedWorkbook(workbook, "multi-bu.xlsx");
    expect(result.imported).toBe(2);
    ctx.applyPersistedMonthlyKpiRecords(result.records, { reset: true });

    expect(ctx.MonthlyScoreData.ez[2026][1].budget_spend).toBe(100);
    expect(ctx.MonthlyScoreData.clark[2026][1].budget_spend).toBe(200);

    ctx.fetchSavedMonthlyKpiRecords = async (buId?: string, options?: any) => {
      if (!buId) {
        ctx.applyPersistedMonthlyKpiRecords([], { reset: true });
      }
      return { ok: true, records: [] };
    };

    ctx.selectedBusinessUnitId = "all-business-units";
    const clearPromise = ctx.clearData();
    await ctx.resolveClearConfirmation(true);
    await clearPromise;

    expect(ctx.MonthlyScoreData.ez).toBeUndefined();
    expect(ctx.MonthlyScoreData.clark).toBeUndefined();
  });

  it("clears only the selected BU and leaves other BU data intact", async () => {
    const ctx = createImportContext();

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ["Budget Spend", "PM Compliance"],
      Sheets: {
        "Budget Spend": makeSheet([
          ["BUSINESS UNIT", "Month", "Actual Spend", "Budget", "Notes"],
          ["AMD-EZ", 46023, 100, 100, "EZ note"],
          ["Clark Water", 46023, 200, 100, "Clark note"],
        ]),
        "PM Compliance": makeSheet([
          ["BUSINESS UNIT", "Month", "Completed On Time", "Total Orders", "Notes"],
          ["AMD-EZ", 46023, 98, 100, null],
          ["Clark Water", 46023, 95, 100, null],
        ]),
      },
    };

    const result = ctx.importConsolidatedWorkbook(workbook, "multi-bu.xlsx");
    ctx.applyPersistedMonthlyKpiRecords(result.records, { reset: true });

    expect(ctx.MonthlyScoreData.ez[2026][1].budget_spend).toBe(100);
    expect(ctx.MonthlyScoreData.clark[2026][1].budget_spend).toBe(200);

    ctx.fetchSavedMonthlyKpiRecords = async (buId?: string, options?: any) => {
      if (!buId || buId === "ez") {
        ctx.applyPersistedMonthlyKpiRecords([], { businessUnitId: "ez", merge: false });
      }
      return { ok: true, records: [] };
    };

    ctx.selectedBusinessUnitId = "ez";
    const clearPromise = ctx.clearData();
    await ctx.resolveClearConfirmation(true);
    await clearPromise;

    expect(ctx.MonthlyScoreData.ez).toBeUndefined();
    expect(ctx.MonthlyScoreData.clark[2026][1].budget_spend).toBe(200);
  });

  it("Business Unit dropdown only shows BUs with Monthly KPI data", () => {
    const ctx = createImportContext();

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ["Budget Spend"],
      Sheets: {
        "Budget Spend": makeSheet([
          ["BUSINESS UNIT", "Month", "Actual Spend", "Budget", "Notes"],
          ["AMD-EZ", 46023, 100, 100, "EZ note"],
        ]),
      },
    };

    const result = ctx.importConsolidatedWorkbook(workbook, "ez-only.xlsx");
    ctx.applyPersistedMonthlyKpiRecords(result.records, { reset: true });

    ctx.initBusinessUnitSelector();
    const sel = ctx.document.getElementById("businessUnitSel") as any;
    const html = sel.innerHTML;
    expect(html).toContain('value="all-business-units"');
    expect(html).toContain('value="ez"');
    expect(html).not.toContain('value="clark"');
    expect(html).not.toContain('value="laguna"');
  });

  it("canonicalizes WAWAJVC records and aggregates without duplicate dropdown options", () => {
    const ctx = createImportContext();
    const records = [
      { id: 1, business_unit: "WAWAJVC", reporting_year: 2026, reporting_month: 1, pm_compliance: 98 },
      { id: 2, business_unit: "WAWA/JVC", reporting_year: 2026, reporting_month: 2, pm_compliance: 99 },
      { id: 3, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, pm_compliance: 97 },
    ];

    ctx.applyPersistedMonthlyKpiRecords(records, { reset: true });
    const wawaBus = ctx.BUs.filter((bu) => bu.id === "wawajvc");
    expect(wawaBus).toHaveLength(1);
    expect(wawaBus[0]).toMatchObject({ apiValue: "WAWA/JVC", label: "WAWA/JVC" });
    expect(ctx.normalizePersistedBusinessUnit("WAWAJVC")).toBe("wawajvc");
    expect(ctx.normalizePersistedBusinessUnit("WAWA/JVC")).toBe("wawajvc");
    expect(Object.keys(ctx.MonthlyScoreData.wawajvc[2026])).toEqual(["1", "2"]);

    ctx.KpiAggregates = ctx.normalizeKpiAggregates({
      reportingYear: 2026,
      byBusinessUnit: [
        { businessUnit: "WAWA/JVC", reportingYear: 2026, recordCount: 2, pmCompliance: 98.5 },
        { businessUnit: "AMD-EZ", reportingYear: 2026, recordCount: 1, pmCompliance: 97 },
      ],
      byBusinessUnitMap: {},
      portfolioYearAverage: { pmCompliance: 97.75 },
      portfolioMonthlyAverages: {},
      portfolioMonthlyActuals: {},
    });

    expect(ctx.getAggregateForBusinessUnit("wawajvc", 2026)?.businessUnit).toBe("WAWA/JVC");
    expect(ctx.getAggregateForBusinessUnit("ez", 2026)?.businessUnit).toBe("AMD-EZ");

    ctx.initBusinessUnitSelector();
    const html = ctx.document.getElementById("businessUnitSel").innerHTML;
    expect((html.match(/value="wawajvc"/g) || [])).toHaveLength(1);
    expect(html).toContain(">WAWA/JVC<");

    ctx.renderSummary();
    expect(ctx.document.getElementById("summaryBody").innerHTML).toContain("WAWA/JVC");
  });

  it("sorts normalized Business Units alphabetically with All Business Units first", () => {
    const ctx = createImportContext();
    ctx.applyPersistedMonthlyKpiRecords([
      { id: 1, business_unit: "Tagum Water", reporting_year: 2026, reporting_month: 1, pm_compliance: 97 },
      { id: 2, business_unit: "WAWAJVC", reporting_year: 2026, reporting_month: 1, pm_compliance: 98 },
      { id: 3, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, pm_compliance: 99 },
      { id: 4, business_unit: "Clark Water", reporting_year: 2026, reporting_month: 1, pm_compliance: 96 },
      { id: 5, business_unit: "WAWA/JVC", reporting_year: 2026, reporting_month: 2, pm_compliance: 99 },
    ], { reset: true });

    ctx.initBusinessUnitSelector();
    const selectorHtml = String(ctx.document.getElementById("businessUnitSel").innerHTML);
    const selectorLabels = Array.from(selectorHtml.matchAll(/<option value="[^"]+">([^<]+)<\/option>/g), (match) => match[1]);
    expect(selectorLabels).toEqual(["All Business Units", "AMD-EZ", "Clark Water", "Tagum Water", "WAWA/JVC"]);
    expect(selectorLabels.filter((label) => label === "WAWA/JVC")).toHaveLength(1);

    const sortedLabels = ctx.getSortedBusinessUnits(ctx.BUs).map((bu) => bu.label);
    expect(sortedLabels).toEqual(["AMD-EZ", "Clark Water", "Estate Water", "Laguna Water", "Tagum Water", "WAWA/JVC"]);

    ctx.renderSummary();
    const summaryHtml = ctx.document.getElementById("summaryBody").innerHTML;
    expect(summaryHtml.indexOf("All Business Units")).toBeLessThan(summaryHtml.indexOf("AMD-EZ"));
    expect(summaryHtml.indexOf("AMD-EZ")).toBeLessThan(summaryHtml.indexOf("Clark Water"));
    expect(summaryHtml.indexOf("Clark Water")).toBeLessThan(summaryHtml.indexOf("Tagum Water"));
    expect(summaryHtml.indexOf("Tagum Water")).toBeLessThan(summaryHtml.indexOf("WAWA/JVC"));
    expect((summaryHtml.match(/>WAWA\/JVC</g) || [])).toHaveLength(1);
    expect(summaryHtml).toContain('class="summary-bu-row"');
    expect(summaryHtml).toContain('role="button"');
    expect(summaryHtml).toContain("onclick=\"drillDownToBusinessUnit");
  });

  it("drills down through the existing selector workflow and briefly highlights details", () => {
    vi.useFakeTimers();
    try {
      const ctx = createImportContext();
      ctx.applyPersistedMonthlyKpiRecords([
        { id: 1, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, pm_compliance: 98 },
        { id: 2, business_unit: "WAWAJVC", reporting_year: 2026, reporting_month: 1, pm_compliance: 65.85 },
      ], { reset: true });
      ctx.initBusinessUnitSelector();

      const originalGetElementById = ctx.document.getElementById.bind(ctx.document);
      const detailClassList = createClassList("tc");
      const scrollCalls: Array<{ behavior?: string; block?: string }> = [];
      const detailElement = {
        id: "t-business-unit",
        classList: detailClassList,
        scrollIntoView(options: { behavior?: string; block?: string }) { scrollCalls.push(options); },
      };
      ctx.document.getElementById = ((id: string) => {
        if (id === "t-business-unit") return detailElement;
        return originalGetElementById(id);
      }) as typeof ctx.document.getElementById;

      let detailRefreshCount = 0;
      ctx.loadData = () => { detailRefreshCount += 1; };
      ctx.fetchSavedMonthlyKpiRecords = async () => ({ ok: true, records: [] });

      ctx.drillDownToBusinessUnit("ez");
      const selector = ctx.document.getElementById("businessUnitSel") as unknown as { value: string };
      expect(ctx.selectedBusinessUnitId).toBe("ez");
      expect(selector.value).toBe("ez");
      expect(detailRefreshCount).toBe(1);
      expect(scrollCalls).toEqual([{ behavior: "smooth", block: "start" }]);
      expect(detailClassList.contains("bu-detail-highlight")).toBe(true);

      let prevented = false;
      ctx.handleSummaryBusinessUnitKeydown({ key: " ", preventDefault() { prevented = true; } }, "wawajvc");
      expect(prevented).toBe(true);
      expect(ctx.selectedBusinessUnitId).toBe("wawajvc");
      expect(selector.value).toBe("wawajvc");
      expect(detailRefreshCount).toBe(2);
      expect(scrollCalls).toHaveLength(2);
      expect(detailClassList.contains("bu-detail-highlight")).toBe(true);

      let enterPrevented = false;
      ctx.handleSummaryBusinessUnitKeydown({ key: "Enter", preventDefault() { enterPrevented = true; } }, "ez");
      expect(enterPrevented).toBe(true);
      expect(ctx.selectedBusinessUnitId).toBe("ez");
      expect(selector.value).toBe("ez");
      expect(detailRefreshCount).toBe(3);

      vi.advanceTimersByTime(1600);
      expect(detailClassList.contains("bu-detail-highlight")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps WAWA/JVC selected and renders its monthly rows after a filtered refresh", async () => {
    const ctx = createImportContext();
    const wawaRecord = {
      id: 724,
      business_unit: "WAWA/JVC",
      reporting_year: 2026,
      reporting_month: 1,
      pm_compliance: 65.85,
      budget_spend: 0,
      raw_imported_values: { values: { pm_compliance: 65.85, budget_spend: 0 } },
    };
    const amdRecord = { id: 1, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, pm_compliance: 98 };
    ctx.applyPersistedMonthlyKpiRecords([wawaRecord, amdRecord], { reset: true });
    ctx.selectedBusinessUnitId = "wawajvc";
    (ctx as unknown as { fetch: (url: string) => Promise<{ ok: boolean; json: () => Promise<{ records: typeof wawaRecord[] }> }> }).fetch = async (url: string) => {
      expect(url).toContain("reporting_year=2026");
      expect(url).toContain("business_unit=WAWA%2FJVC");
      return { ok: true, json: async () => ({ records: [wawaRecord] }) };
    };

    await ctx.fetchSavedMonthlyKpiRecords("wawajvc");

    expect(ctx.MonthlyScoreData.wawajvc[2026][1].id).toBe(724);
    expect(ctx.MonthlyScoreData.ez[2026][1].id).toBe(1);
    const selectorHtml = ctx.document.getElementById("businessUnitSel").innerHTML;
    expect(selectorHtml).toContain('value="wawajvc"');
    expect((selectorHtml.match(/value="wawajvc"/g) || [])).toHaveLength(1);

    ctx.renderMonthlyRecords("wawajvc");
    const tableHtml = ctx.document.getElementById("business-unit-monthly-records").innerHTML;
    expect(tableHtml).toContain("January");
    expect(tableHtml).toContain("65.85");
  });

  it("Business Unit dropdown resets to All Business Units when the selected BU no longer has data", () => {
    const ctx = createImportContext();

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ["Budget Spend"],
      Sheets: {
        "Budget Spend": makeSheet([
          ["BUSINESS UNIT", "Month", "Actual Spend", "Budget", "Notes"],
          ["Clark Water", 46023, 200, 100, "Clark note"],
        ]),
      },
    };

    const result = ctx.importConsolidatedWorkbook(workbook, "clark-only.xlsx");
    ctx.applyPersistedMonthlyKpiRecords(result.records, { reset: true });
    ctx.selectedBusinessUnitId = "ez";

    ctx.initBusinessUnitSelector();
    const sel = ctx.document.getElementById("businessUnitSel") as any;
    expect(sel.value).toBe("all-business-units");
    const html = sel.innerHTML;
    expect(html).toContain('value="all-business-units"');
    expect(html).toContain('value="clark"');
    expect(html).not.toContain('value="ez"');
  });



  it("sends reporting_year only when clearing All Business Units", async () => {
    const ctx = createImportContext();
    const capturedUrls: string[] = [];
    (ctx as any).fetch = async (url: any) => {
      capturedUrls.push(String(url));
      return { ok: true, json: async () => ({}) };
    };
    ctx.selectedBusinessUnitId = "all-business-units";
    (ctx.document.getElementById("monthSel") as any).value = "5";
    const clearPromise = ctx.clearData();
    await ctx.resolveClearConfirmation(true);
    await clearPromise;

    const deleteUrl = capturedUrls.find((u) => u.includes("/api/monthly-kpi/records"));
    expect(deleteUrl).toBeDefined();
    expect(deleteUrl).toContain("reporting_year=2026");
    expect(deleteUrl).not.toContain("reporting_month");
    expect(deleteUrl).not.toContain("business_unit=");
  });

  it("sends business_unit but no reporting_month when clearing a specific BU", async () => {
    const ctx = createImportContext();
    const capturedUrls: string[] = [];
    (ctx as any).fetch = async (url: any) => {
      capturedUrls.push(String(url));
      return { ok: true, json: async () => ({}) };
    };
    ctx.selectedBusinessUnitId = "ez";
    (ctx.document.getElementById("monthSel") as any).value = "5";
    const clearPromise = ctx.clearData();
    await ctx.resolveClearConfirmation(true);
    await clearPromise;

    const deleteUrl = capturedUrls.find((u) => u.includes("/api/monthly-kpi/records"));
    expect(deleteUrl).toBeDefined();
    expect(deleteUrl).toContain("reporting_year=2026");
    expect(deleteUrl).toContain("business_unit=AMD-EZ");
    expect(deleteUrl).not.toContain("reporting_month");
  });



  it("imports AMD-EZ and Clark Water from a consolidated workbook", () => {
    const ctx = createImportContext();

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ["Budget Spend", "PM Compliance"],
      Sheets: {
        "Budget Spend": makeSheet([
          ["BUSINESS UNIT", "Month", "Actual Spend", "Budget", "Notes"],
          ["AMD-EZ", 46023, 100, 100, "EZ note"],
          ["Clark Water", 46023, 200, 100, "Clark note"],
        ]),
        "PM Compliance": makeSheet([
          ["BUSINESS UNIT", "Month", "Completed On Time", "Total Orders", "Notes"],
          ["AMD-EZ", 46023, 98, 100, null],
          ["Clark Water", 46023, 95, 100, null],
        ]),
      },
    };

    const result = ctx.importConsolidatedWorkbook(workbook, "multi-bu.xlsx");
    expect(result.imported).toBe(2);
    expect(result.records.some((r: any) => r.business_unit === "AMD-EZ")).toBe(true);
    expect(result.records.some((r: any) => r.business_unit === "Clark Water")).toBe(true);
  });

  it("Business Unit dropdown shows all imported BUs after consolidated import", () => {
    const ctx = createImportContext();

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ["Budget Spend"],
      Sheets: {
        "Budget Spend": makeSheet([
          ["BUSINESS UNIT", "Month", "Actual Spend", "Budget", "Notes"],
          ["AMD-EZ", 46023, 100, 100, "EZ note"],
          ["Clark Water", 46023, 200, 100, "Clark note"],
        ]),
      },
    };

    const result = ctx.importConsolidatedWorkbook(workbook, "multi-bu-budget.xlsx");
    ctx.applyPersistedMonthlyKpiRecords(result.records, { reset: true });
    ctx.initBusinessUnitSelector();
    const sel = ctx.document.getElementById("businessUnitSel") as any;
    const html = sel.innerHTML;
    expect(html).toContain('value="all-business-units"');
    expect(html).toContain('value="ez"');
    expect(html).toContain('value="clark"');
  });

  it("clear request omits reporting_month when All Months is selected", async () => {
    const ctx = createImportContext();
    const capturedUrls: string[] = [];
    (ctx as any).fetch = async (url: any) => {
      capturedUrls.push(String(url));
      return { ok: true, json: async () => ({}) };
    };
    (ctx as any).selectedBusinessUnitId = "ez";
    (ctx.document.getElementById("monthSel") as any).value = "all";

    const clearPromise = ctx.clearData();
    await ctx.resolveClearConfirmation(true);
    await clearPromise;

    const deleteUrl = capturedUrls.find((u) => u.includes("/api/monthly-kpi/records"));
    expect(deleteUrl).toBeDefined();
    expect(deleteUrl).toContain("reporting_year=2026");
    expect(deleteUrl).toContain("business_unit=AMD-EZ");
    expect(deleteUrl).not.toContain("reporting_month");
  });

  it("saveImportedMonthlyKpiRecords does not send business_unit for consolidated import", async () => {
    const ctx = createImportContext();
    const captured: { url: string; body: string }[] = [];
    (ctx as any).fetch = async (url: string, options: any) => {
      captured.push({ url, body: options.body });
      return { ok: true, json: async () => ({ records: [] }) };
    };
    await (ctx as any).saveImportedMonthlyKpiRecords(
      "consolidated.xlsx",
      [{ business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1 }],
      null
    );
    expect(captured).toHaveLength(1);
    const body = JSON.parse(captured[0].body);
    expect(body).not.toHaveProperty("business_unit");
    expect(body.records).toHaveLength(1);
  });

  it("fetchSavedMonthlyKpiRecords refreshes dropdown with all BUs returned by API", async () => {
    const ctx = createImportContext();
    const records = [
      { id: 1, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, budget_spend: 50 },
      { id: 2, business_unit: "Clark Water", reporting_year: 2026, reporting_month: 1, budget_spend: 60 },
    ];
    (ctx as any).fetch = async () => ({ ok: true, json: async () => ({ records }) });
    await (ctx as any).fetchSavedMonthlyKpiRecords();
    const sel = ctx.document.getElementById("businessUnitSel") as any;
    const html = sel.innerHTML;
    expect(html).toContain('value="all-business-units"');
    expect(html).toContain('value="ez"');
    expect(html).toContain('value="clark"');
  });

  it("clear request ignores selected month and clears full selected year for the BU", async () => {
    const ctx = createImportContext();
    const capturedUrls: string[] = [];
    const toasts: string[] = [];
    (ctx as any).fetch = async (url: any) => {
      capturedUrls.push(String(url));
      return { ok: true, json: async () => ({}) };
    };
    (ctx as any).showToast = (_type: any, message: string) => {
      toasts.push(message);
    };
    (ctx as any).selectedBusinessUnitId = "ez";
    (ctx.document.getElementById("monthSel") as any).value = "5";

    const clearPromise = ctx.clearData();
    await ctx.resolveClearConfirmation(true);
    await clearPromise;

    const deleteUrl = capturedUrls.find((u) => u.includes("/api/monthly-kpi/records"));
    expect(deleteUrl).toBeDefined();
    expect(deleteUrl).toContain("reporting_year=2026");
    expect(deleteUrl).toContain("business_unit=AMD-EZ");
    expect(deleteUrl).not.toContain("reporting_month");
    expect(toasts.some((m) => m.includes("KPI records cleared for AMD-EZ") && m.includes("2026"))).toBe(true);
  });

  it("numeric Business Unit values are not imported", () => {
    const ctx = createImportContext();

    function makeSheet(rows: unknown[][]) {
      const sheet: any = { _rows: rows };
      rows.forEach((row, r) => {
        row.forEach((value, c) => {
          const addr = String.fromCharCode(65 + c) + (r + 1);
          sheet[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
        });
      });
      return sheet;
    }

    const workbook = {
      SheetNames: ["Budget Spend"],
      Sheets: {
        "Budget Spend": makeSheet([
          ["BUSINESS UNIT", "Month", "Actual Spend", "Budget", "Notes"],
          ["12345", 46023, 100, 100, "numeric BU"],
          ["AMD-EZ", 46023, 200, 100, "EZ note"],
        ]),
      },
    };

    const result = ctx.importConsolidatedWorkbook(workbook, "numeric-bu.xlsx");
    expect(result.imported).toBe(1);
    expect(result.records[0].business_unit).toBe("AMD-EZ");
  });

  it("buildClearScopeLabel only contains year and BU scope", () => {
    const ctx = createImportContext();
    (ctx.document.getElementById("monthSel") as any).value = "5";
    (ctx as any).selectedBusinessUnitId = "ez";
    const scope = ctx.buildClearScopeLabel();
    expect(scope.buLabel).toBe("AMD-EZ");
    expect(scope.year).toBe(2026);
    expect(scope.isAll).toBe(false);
  });

  it("dropdown excludes invalid numeric Business Unit values", () => {
    const ctx = createImportContext();
    ctx.applyPersistedMonthlyKpiRecords(
      [
        { id: 1, business_unit: "100", reporting_year: 2026, reporting_month: 1, budget_spend: 10 },
        { id: 2, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, budget_spend: 50 },
      ],
      { reset: true }
    );
    ctx.initBusinessUnitSelector();
    const sel = ctx.document.getElementById("businessUnitSel") as any;
    const html = sel.innerHTML;
    expect(html).toContain('value="all-business-units"');
    expect(html).toContain('value="ez"');
    expect(html).not.toContain('value="100"');
  });

  it("Summary Matrix excludes invalid numeric Business Unit rows", () => {
    const ctx = createImportContext();
    ctx.applyPersistedMonthlyKpiRecords(
      [
        { id: 1, business_unit: "100", reporting_year: 2026, reporting_month: 1, budget_spend: 10 },
        { id: 2, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, budget_spend: 50 },
      ],
      { reset: true }
    );
    ctx.initBusinessUnitSelector();
    const sel = ctx.document.getElementById("businessUnitSel") as any;
    expect(sel.innerHTML).toContain('value="ez"');
    expect(sel.innerHTML).not.toContain('value="100"');
  });



  it("dropdown includes all BUs after a full-year records refresh", async () => {
    const ctx = createImportContext();
    (ctx as any).fetch = async () => ({
      ok: true,
      json: async () => ({
        records: [
          { id: 1, business_unit: "AMD-EZ", reporting_year: 2026, reporting_month: 1, budget_spend: 50 },
          { id: 2, business_unit: "Clark Water", reporting_year: 2026, reporting_month: 2, budget_spend: 60 },
        ],
      }),
    });
    ctx.fetchMonthlyKpiAggregates = async () => {};
    (ctx as any).loadData = () => {};
    (ctx.document.getElementById("monthSel") as any).value = "5";

    await ctx.fetchSavedMonthlyKpiRecords();

    const sel = ctx.document.getElementById("businessUnitSel") as any;
    const html = sel.innerHTML;
    expect(html).toContain('value="all-business-units"');
    expect(html).toContain('value="ez"');
    expect(html).toContain('value="clark"');
  });

  it("clearData always fetches records after delete even when DELETE response includes records", async () => {
    const ctx = createImportContext();
    const captured: { url: string; kind?: string }[] = [];
    (ctx as any).fetch = async (url: string) => {
      const isDelete = url.includes("/api/monthly-kpi/records") && !url.includes("aggregates");
      const isGetRecords = isDelete && captured.some((c) => c.kind === "delete");
      if (isDelete && !isGetRecords) {
        captured.push({ url, kind: "delete" });
        return { ok: true, json: async () => ({ success: true, deletedCount: 2, records: [{ id: 1, business_unit: "AMD-EZ" }] }) };
      }
      if (isGetRecords) {
        captured.push({ url, kind: "records" });
        return { ok: true, json: async () => ({ records: [] }) };
      }
      if (url.includes("/api/monthly-kpi/aggregates")) {
        captured.push({ url, kind: "aggregates" });
        return { ok: true, json: async () => ({ reportingYear: 2026, byBusinessUnit: [], portfolioMonthlyAverages: {} }) };
      }
      return { ok: true, json: async () => ({}) };
    };
    (ctx as any).selectedBusinessUnitId = "all-business-units";
    (ctx.document.getElementById("monthSel") as any).value = "5";
    ctx.fetchMonthlyKpiAggregates = async () => {
      const res = await (ctx as any).fetch('/api/monthly-kpi/aggregates?reporting_year=2026');
      const payload = await res.json();
      ctx.KpiAggregates = (ctx as any).normalizeKpiAggregates(payload);
    };

    const clearPromise = ctx.clearData();
    await ctx.resolveClearConfirmation(true);
    await clearPromise;

    const deleteCall = captured.find((c) => c.kind === "delete");
    const recordsCall = captured.find((c) => c.kind === "records");
    const aggregatesCall = captured.find((c) => c.kind === "aggregates");
    expect(deleteCall).toBeDefined();
    expect(deleteCall!.url).toContain("reporting_year=2026");
    expect(deleteCall!.url).not.toContain("reporting_month");
    expect(recordsCall).toBeDefined();
    expect(aggregatesCall).toBeDefined();
    const recordsIdx = captured.findIndex((c) => c.kind === "records");
    const aggregatesIdx = captured.findIndex((c) => c.kind === "aggregates");
    expect(recordsIdx).toBeLessThan(aggregatesIdx);
    expect((ctx as any).MonthlyScoreData).toEqual({});
  });

  it("clearData builds correct DELETE URL for All Months and specific BU", async () => {
    const ctx = createImportContext();
    const captured: string[] = [];
    (ctx as any).fetch = async (url: string) => {
      captured.push(String(url));
      if (url.includes("/api/monthly-kpi/records?")) {
        return { ok: true, json: async () => ({ records: [] }) };
      }
      return { ok: true, json: async () => ({ success: true, deletedCount: 0 }) };
    };
    (ctx as any).selectedBusinessUnitId = "ez";
    (ctx.document.getElementById("monthSel") as any).value = "all";

    const clearPromise = ctx.clearData();
    await ctx.resolveClearConfirmation(true);
    await clearPromise;

    const deleteUrl = captured.find((u) => u.startsWith("/api/monthly-kpi/records") && !u.includes("aggregates"));
    expect(deleteUrl).toBeDefined();
    expect(deleteUrl).toContain("reporting_year=2026");
    expect(deleteUrl).toContain("business_unit=AMD-EZ");
    expect(deleteUrl).not.toContain("reporting_month");
  });

});
