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
    set innerHTML(_value: string) {},
    get innerHTML() { return ""; },
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
        if (id === "monthSel") return { ...element, value: "1", style: { ...element.style } };
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
    selectedBusinessUnitId: string;
    BUs: Array<{ id: string; apiValue: string; name: string; label: string }>;
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

    expect(monthlyRecordsRenderer).toContain("'Month','PM Compliance (%)','Budget Spend (%)'");
    expect(monthlyRecordsRenderer).not.toContain("'Schedule Compliance (%)'");
    expect(monthlyRecordsRenderer).not.toContain("'MTBF (Days)'");
    expect(monthlyRecordsRenderer).toContain("'MTTR (Days)'");
    expect(monthlyRecordsRenderer).toContain("Notes");
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
    expect(html).toContain("MTTR (Days)");
    expect(html).toContain("Notes");
    expect(html).toContain("91.00");
    expect(html).toContain("92.00");
    expect(html).toContain("93.00");
    expect(html).toContain("94.00");
    expect(html).toContain("95.00");
    expect(html).toContain("Planned shutdown completed.");
    expect(html).not.toContain("Schedule Compliance");
    expect(html).not.toContain("MTBF");
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

  it("recognizes alternate Notes headers such as Remarks and Comment", () => {
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
      SheetNames: ["MTTR", "Facility Uptime"],
      Sheets: {
        MTTR: makeSheet([
          ["BUSINESS UNIT", "Month", "Total Downtime", "Number of Repairs", "Remarks"],
          ["AMD-EZ", 46023, 10, 2, "Pump seal leak"],
        ]),
        "Facility Uptime": makeSheet([
          ["BU", "Month", "Total Operating Time", "Total Downtime", "Comment"],
          ["AMD-EZ", 46023, 1000, 10, "Scheduled outage"],
        ]),
      },
    };

    const result = ctx.importConsolidatedWorkbook(workbook, "notes-aliases.xlsx");
    expect(result.imported).toBe(1);
    const jan = result.records[0];
    expect(jan.notes).toBe("MTTR: Pump seal leak; Facility Uptime: Scheduled outage");
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



  it("sends reporting_year and reporting_month without business_unit when clearing All Business Units", async () => {
    const ctx = createImportContext();
    const capturedUrls: string[] = [];
    (ctx as any).fetch = async (url: any) => {
      capturedUrls.push(String(url));
      return { ok: true, json: async () => ({}) };
    };
    ctx.selectedBusinessUnitId = "all-business-units";
    const clearPromise = ctx.clearData();
    await ctx.resolveClearConfirmation(true);
    await clearPromise;

    const deleteUrl = capturedUrls.find((u) => u.includes("/api/monthly-kpi/records"));
    expect(deleteUrl).toBeDefined();
    expect(deleteUrl).toContain("reporting_year=2026");
    expect(deleteUrl).toContain("reporting_month=1");
    expect(deleteUrl).not.toContain("business_unit=");
  });

  it("sends business_unit when clearing a specific BU", async () => {
    const ctx = createImportContext();
    const capturedUrls: string[] = [];
    (ctx as any).fetch = async (url: any) => {
      capturedUrls.push(String(url));
      return { ok: true, json: async () => ({}) };
    };
    ctx.selectedBusinessUnitId = "ez";
    const clearPromise = ctx.clearData();
    await ctx.resolveClearConfirmation(true);
    await clearPromise;

    const deleteUrl = capturedUrls.find((u) => u.includes("/api/monthly-kpi/records"));
    expect(deleteUrl).toBeDefined();
    expect(deleteUrl).toContain("reporting_year=2026");
    expect(deleteUrl).toContain("reporting_month=1");
    expect(deleteUrl).toContain("business_unit=AMD-EZ");
  });


});
