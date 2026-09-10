/**
 * Monthly KPI — All Business Units deck (server-only).
 *
 * The All-Business-Units Monthly KPI Executive deck is generated from a
 * committed master template that carries three DONOR slides:
 *
 *   slide1  cover donor
 *   slide2  the authoritative Manila Water "Monthly Reliability KPI
 *           Scorecard" slide (byte-identical to the master slide used by the
 *           single-BU executive deck)
 *   slide3  a Trends donor with six native charts (3 columns x 2 rows,
 *           dashboard-style combo charts: monthly actual columns + YTD line
 *           + dashed benchmark reference lines where applicable)
 *
 * plus the six chart parts + embedded workbooks the Trends donor references.
 *
 * At generation time the server:
 *   - updates the cover text;
 *   - for every BU in module-authoritative order clones the Scorecard donor
 *     (slide2) and replaces only dynamic content (BU name, monthly values,
 *     YTD values, RAG fills, Notes/Situation commentary bullets);
 *   - immediately after each Scorecard slide clones the Trends donor (slide3)
 *     per BU, clones its six chart parts, and rewrites only the chart caches
 *     (categories + series values) for that BU.
 *
 * Output structure: 1 cover + (2 x number of BUs), ordered
 *   BU1 Scorecard, BU1 Trends, BU2 Scorecard, BU2 Trends, ...
 *
 * KPI values reuse the live Monthly KPI scorecard aggregation functions via
 * allBusinessUnitsData (Group A cumulative Jan->E, Group B YTD average; no
 * presentation-specific formulas).
 */

import type JSZip from "jszip";
import {
  createElementNS,
  findGraphicFrameByName,
  findShapeByName,
  generatePptxBlob,
  getCells,
  getElementsByTagNameNS,
  getTableRows,
  loadPptxTemplate,
  loadSlideXml,
  parseXml,
  resolveExecutiveTemplatePath,
  saveSlideXml,
  serializeXml,
  setCellFill,
  setCellText,
  setShapeText,
  type XmlDocument,
  type XmlElement,
} from "../executive-presentations/framework";
import {
  addChartClone,
  addSlidePart,
  ensureXlsxDefault,
  maxChartNumber,
  removeSlidePart,
  setPresentationSlideOrder,
} from "../executive-presentations/framework/slidePackage";
import {
  writeNotesSituationReadout,
} from "../executive-presentations/framework/readoutText";
import { buildExecutiveReadoutLines } from "./executiveReadout";
import { formatFacilityUptimePercent } from "./facilityUptimeDisplay";
import { cleanMonthlyKpiPresentationZip } from "../executive-presentations/framework/presentationCleanup";
import type { ReadoutLine } from "../executive-presentations/framework/readoutText";
import type { ScorecardKpiKey } from "./types";
import {
  evaluateKpiStatus,
  getDefaultMonthlyKpiThresholdConfig,
} from "./kpiThresholds";
import type {
  AllBusinessUnitsDeckData,
  BusinessUnitDeckSection,
  ScorecardKpiKey2,
} from "./allBusinessUnitsData";

const TEMPLATE_FILENAME = "MonthlyKpiAllBuExecutive.pptx";

// Namespace of native PowerPoint chart parts.
const CHART_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart";

type PptxZip = JSZip;

const SCORECARD_KPI_KEYS: ScorecardKpiKey2[] = [
  "pmCompliance",
  "budgetSpend",
  "pmCmWorkOrderRatio",
  "pmCmCostRatio",
  "mttrDays",
  "facilityUptime",
];


const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// RAG fill + text palette used by the approved Manila Water scorecard.
const RAG_FILL = { green: "A9D18E", amber: "FFD966", red: "FF6B6B", noData: "DDE6F0" };

const DEFAULT_THRESHOLD_CONFIG = getDefaultMonthlyKpiThresholdConfig();

function isPresentNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * The six Trends panels. `id` is the donor chart number (chart{id}.xml).
 * `source` selects the trend field of a BusinessUnitTrendPoint.
 */
export const TRENDS_PANELS: Array<{
  id: number;
  key: ScorecardKpiKey2;
  title: string;
  series: Array<
    | { role: "monthly"; source: keyof BusinessUnitDeckSection["trends"][number] }
    | { role: "ytdAvg"; source: keyof BusinessUnitDeckSection["trends"][number] }
    | { role: "ytd"; source: keyof BusinessUnitDeckSection["trends"][number] }
    | { role: "const"; value: number }
  >;
}> = [
  {
    id: 1,
    key: "pmCompliance",
    title: "PM Compliance (%)",
    series: [
      { role: "monthly", source: "pmComplianceMonthly" },
      { role: "ytdAvg", source: "pmComplianceYtdAverage" },
      { role: "const", value: 98 },
    ],
  },
  {
    id: 2,
    key: "budgetSpend",
    title: "Budget Spend (%)",
    series: [
      { role: "monthly", source: "budgetSpendMonthly" },
      { role: "ytd", source: "budgetSpend" },
      { role: "const", value: 95 },
      { role: "const", value: 105 },
    ],
  },
  {
    id: 3,
    key: "pmCmWorkOrderRatio",
    title: "PM:CM WO (%)",
    series: [
      { role: "monthly", source: "pmCmWorkOrderRatioMonthly" },
      { role: "ytd", source: "pmCmWorkOrderRatio" },
      { role: "const", value: 86 },
    ],
  },
  {
    id: 4,
    key: "pmCmCostRatio",
    title: "PM:CM Cost (%)",
    series: [
      { role: "monthly", source: "pmCmCostRatioMonthly" },
      { role: "ytd", source: "pmCmCostRatio" },
      { role: "const", value: 80 },
    ],
  },
  {
    id: 5,
    key: "mttrDays",
    title: "MTTR (Days)",
    series: [
      { role: "monthly", source: "mttrDaysMonthly" },
      { role: "ytd", source: "mttrDays" },
    ],
  },
  {
    id: 6,
    key: "facilityUptime",
    title: "Facility Uptime (%)",
    series: [
      { role: "monthly", source: "facilityUptimeMonthly" },
      { role: "ytdAvg", source: "facilityUptimeYtdAverage" },
      { role: "const", value: 100 },
    ],
  },
];

// ── Display formatting (same conventions as the approved scorecard) ──

function formatPrecisePercent(value: number): string {
  if (Number.isInteger(value)) return `${value}%`;
  // Never render a value that is below 100 as "100%": a 99.996% result would
  // round to 100.00 at 2 decimals yet must still be seen as below the =100%
  // target. In that case keep the full authoritative precision instead.
  if (value < 100 && value.toFixed(2) === "100.00") {
    return `${value}%`;
  }
  const s = value.toFixed(2).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return `${s}%`;
}

export function formatScorecardCell(
  key: ScorecardKpiKey2,
  value: number | null | undefined
): string {
  if (!isPresentNumber(value)) return "";
  if (key === "mttrDays") return String(Math.round(value));
  if (key === "pmCmWorkOrderRatio" || key === "pmCmCostRatio") {
    const pct = Math.round(value);
    const cmShare = 100 - value;
    if (cmShare <= 0) return `${pct}% (No CM)`;
    return `${pct}% (${(value / cmShare).toFixed(1)}:1)`;
  }
  if (key === "facilityUptime") {
    // Facility Uptime (PR #427): max two decimals; a below-100 value is
    // truncated so it can never display as 100% / 100.00%.
    return formatFacilityUptimePercent(value);
  }
  if (key === "pmCompliance") {
    // PM Compliance formatting is intentionally UNCHANGED (PR #427 scope).
    return formatPrecisePercent(value);
  }
  return `${Math.round(value)}%`;
}

export function scorecardCellFill(
  key: ScorecardKpiKey2,
  value: number | null | undefined
): string {
  if (!isPresentNumber(value)) return RAG_FILL.noData;
  const status = evaluateKpiStatus(key, value, DEFAULT_THRESHOLD_CONFIG).status;
  switch (status) {
    case "green":
      return RAG_FILL.green;
    case "amber":
      return RAG_FILL.amber;
    case "red":
      return RAG_FILL.red;
    default:
      return RAG_FILL.noData;
  }
}

// ── Geometry helpers (EMU), mirroring the single-BU generator ──

function parseEmu(value: string | null | undefined): number {
  if (!value) return 0;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

function setShapeY(shape: XmlElement, y: number): void {
  const xfrm = getElementsByTagNameNS(shape, "a", "xfrm")[0];
  if (!xfrm) return;
  const off = getElementsByTagNameNS(xfrm, "a", "off")[0];
  if (off) off.setAttribute("y", String(Math.round(y)));
}

function setFrameHeight(frame: XmlElement, cy: number): void {
  const xfrms = [
    getElementsByTagNameNS(frame, "p", "xfrm")[0],
    getElementsByTagNameNS(frame, "a", "xfrm")[0],
  ].filter(Boolean);
  const xfrm = xfrms[0];
  if (!xfrm) return;
  const ext = getElementsByTagNameNS(xfrm, "a", "ext")[0];
  if (ext) ext.setAttribute("cy", String(Math.round(cy)));
}

function getTableHeightEmu(rows: XmlElement[]): number {
  let total = 0;
  for (const row of rows) total += parseEmu(row.getAttribute("h"));
  return total;
}

function deepClone(source: XmlElement): XmlElement {
  return source.cloneNode(true) as XmlElement;
}

/**
 * Normalize KPI data cells (columns 1-6) so injected values render with the
 * approved body formatting regardless of the template cell that was cloned.
 * Structural cells (header, Month/YTD/TARGET labels) are preserved.
 */
function normalizeDataCellRuns(cell: XmlElement, fontSizeHundredths: number): void {
  const txBody = getElementsByTagNameNS(cell, "a", "txBody")[0];
  if (!txBody) return;
  let bodyPr = getElementsByTagNameNS(txBody, "a", "bodyPr")[0];
  if (!bodyPr) {
    bodyPr = createElementNS(cell.ownerDocument as XmlDocument, "a", "bodyPr");
    txBody.insertBefore(bodyPr, txBody.firstChild);
  }
  bodyPr.setAttribute("anchor", "ctr");
  for (const paragraph of getElementsByTagNameNS(txBody, "a", "p")) {
    const pPr = getElementsByTagNameNS(paragraph, "a", "pPr")[0];
    if (pPr) pPr.setAttribute("algn", "ctr");
    for (const run of getElementsByTagNameNS(paragraph, "a", "r")) {
      let rPr = getElementsByTagNameNS(run, "a", "rPr")[0];
      if (!rPr) {
        rPr = createElementNS(cell.ownerDocument as XmlDocument, "a", "rPr");
        const t = getElementsByTagNameNS(run, "a", "t")[0];
        if (t) run.insertBefore(rPr, t);
        else run.appendChild(rPr);
      }
      rPr.setAttribute("sz", String(fontSizeHundredths));
      if (rPr.getAttribute("b") === null) rPr.setAttribute("b", "0");
      if (rPr.getAttribute("i") === null) rPr.setAttribute("i", "0");
      if (rPr.getAttribute("u") === null) rPr.setAttribute("u", "none");
      if (rPr.getAttribute("strike") === null) rPr.setAttribute("strike", "noStrike");
      rPr.setAttribute("kern", "1200");

      let solidFill = getElementsByTagNameNS(rPr, "a", "solidFill")[0];
      if (!solidFill) {
        solidFill = createElementNS(cell.ownerDocument as XmlDocument, "a", "solidFill");
        rPr.insertBefore(solidFill, rPr.firstChild);
      }
      for (const child of [...solidFill.childNodes]) {
        if ((child as unknown as XmlElement).localName) {
          solidFill.removeChild(child);
        }
      }
      const srgbClr = createElementNS(cell.ownerDocument as XmlDocument, "a", "srgbClr");
      srgbClr.setAttribute("val", "172B47");
      solidFill.appendChild(srgbClr);

      const setTypeface = (name: string) => {
        const el = getElementsByTagNameNS(rPr, "a", name)[0] ??
          createElementNS(cell.ownerDocument as XmlDocument, "a", name);
        el.setAttribute("typeface", "Aptos");
        if (!el.parentNode) rPr.appendChild(el);
      };
      setTypeface("latin");
      setTypeface("ea");
      setTypeface("cs");
    }
  }
}

// ── Scorecard slide ──

/**
 * Populate the clone of the Manila Water scorecard master for one BU.
 * Only dynamic content changes: title, monthly rows, YTD row, RAG fills,
 * commentary bullets. Header, TARGET row, legend, footer and geometry are the
 * template's own.
 */
function updateScorecardSlide(
  doc: XmlDocument,
  section: BusinessUnitDeckSection
): void {
  const titleShape = findShapeByName(doc, "Slide Title");
  if (titleShape) {
    setShapeText(titleShape, `Monthly Reliability KPI Scorecard, ${section.businessUnit}`);
  }

  const tableFrame = findGraphicFrameByName(doc, "AMD-EZ Monthly KPI Scorecard");
  if (!tableFrame) {
    throw new Error(
      '[TEMPLATE] Required frame "AMD-EZ Monthly KPI Scorecard" not found on Scorecard slide.'
    );
  }
  const rows = getTableRows(tableFrame);
  if (rows.length < 10) {
    throw new Error(`[TEMPLATE] Expected at least 10 rows on Scorecard table, found ${rows.length}.`);
  }
  const tbl = getElementsByTagNameNS(tableFrame, "a", "tbl")[0];
  if (!tbl) throw new Error("[TEMPLATE] Scorecard table has no <a:tbl> element.");

  const effectiveMonth = section.reportingMonth;
  if (effectiveMonth < 1 || effectiveMonth > 12) {
    throw new Error(`[MONTHLY-KPI] reportingMonth must be 1-12, got ${effectiveMonth}.`);
  }

  // Trend value lookup per month (null for months after the BU's own last
  // submitted data point; those rows stay blank like the live scorecard).
  const trendByMonth = new Map<number, BusinessUnitDeckSection["trends"][number]>();
  for (const point of section.trends) trendByMonth.set(point.month, point);

  // STANDALONE-MONTH rows for the three corrected KPIs: Budget Spend,
  // PM:CM Work Orders and PM:CM Cost use the authoritative standalone value of
  // that individual calendar month (same source as the chart Monthly Actual
  // bars). PM Compliance / Facility Uptime keep their existing monthly-standalone
  // behavior; MTTR keeps its existing monthly/YTD semantics unchanged.
  const standaloneMonthlyField: Record<string, keyof BusinessUnitDeckSection["trends"][number]> = {
    budgetSpend: "budgetSpendMonthly",
    pmCmWorkOrderRatio: "pmCmWorkOrderRatioMonthly",
    pmCmCostRatio: "pmCmCostRatioMonthly",
  };
  const valueAtMonth = (key: ScorecardKpiKey2, month: number): number | null => {
    const point = trendByMonth.get(month);
    if (!point) return null;
    if (key === "pmCompliance") return point.pmComplianceMonthly;
    if (key === "facilityUptime") return point.facilityUptimeMonthly;
    const standalone = standaloneMonthlyField[key];
    if (standalone) {
      return (point[standalone] as number | null) ?? null;
    }
    return (point[key] as number | null) ?? null; // MTTR: existing semantics
  };

  // Template provides rows 1-7 (Jan-Jul). Clone the last monthly template row
  // for reporting months beyond July; drop trailing rows for earlier months.
  const requiredRowCount = effectiveMonth + 3; // header + months + YTD + TARGET
  if (rows.length < requiredRowCount) {
    const sourceRow = rows[7]; // July row
    const ytdRow = rows[rows.length - 2];
    const missing = requiredRowCount - rows.length;
    for (let i = 0; i < missing; i++) {
      const clone = deepClone(sourceRow);
      tbl.insertBefore(clone, ytdRow);
      rows.splice(rows.length - 2, 0, clone);
    }
  }

  // Fill monthly rows Jan..effectiveMonth.
  for (let month = 1; month <= effectiveMonth; month++) {
    const row = rows[month];
    const cells = getCells(row);
    setCellText(cells[0], MONTH_SHORT[month - 1] ?? `M${month}`);
    for (let m = 0; m < SCORECARD_KPI_KEYS.length; m++) {
      const key = SCORECARD_KPI_KEYS[m];
      const value = valueAtMonth(key, month);
      const cell = cells[m + 1];
      setCellText(cell, formatScorecardCell(key, value));
      setCellFill(cell, scorecardCellFill(key, value));
    }
  }

  // Remove template rows that fall outside the requested reporting period.
  const firstTemplateExtraMonth = effectiveMonth + 1;
  const lastTemplateExtraMonth = Math.min(7, rows.length - 3);
  for (let month = lastTemplateExtraMonth; month >= firstTemplateExtraMonth; month--) {
    const row = rows[month];
    if (row && row.parentNode) tbl.removeChild(row);
    rows.splice(month, 1);
  }

  const finalYtdRowIndex = rows.length - 2;
  const ytdRow = rows[finalYtdRowIndex];
  const ytdCells = getCells(ytdRow);
  const summaryByKey = new Map(section.summary.map((row) => [row.key, row.value]));
  for (let m = 0; m < SCORECARD_KPI_KEYS.length; m++) {
    const key = SCORECARD_KPI_KEYS[m];
    const value = summaryByKey.get(key) ?? null;
    const cell = ytdCells[m + 1];
    setCellText(cell, formatScorecardCell(key, value));
    setCellFill(cell, scorecardCellFill(key, value));
  }

  // Table geometry: scale rows when the natural height exceeds the vertical
  // budget (12-month decks), exactly like the single-BU generator.
  const tableFrameXfrm = getElementsByTagNameNS(tableFrame, "p", "xfrm")[0];
  const tableOff = tableFrameXfrm
    ? getElementsByTagNameNS(tableFrameXfrm, "a", "off")[0]
    : null;
  const tableY = tableOff ? parseEmu(tableOff.getAttribute("y")) : 742950;

  const SLIDE_HEIGHT_EMU = 6858000;
  const BOTTOM_MARGIN_EMU = 190500;
  const READOUT_HEIGHT_EMU = 900000;
  const READOUT_TOP_MARGIN_EMU = 300000;
  const LEGEND_MIN_HEIGHT_EMU = 900000;
  const maxTableHeight =
    SLIDE_HEIGHT_EMU -
    tableY -
    READOUT_TOP_MARGIN_EMU -
    READOUT_HEIGHT_EMU -
    READOUT_TOP_MARGIN_EMU -
    BOTTOM_MARGIN_EMU;

  const naturalTableHeight = getTableHeightEmu(rows);
  let tableActualHeight = naturalTableHeight;
  let bodyFontSizeHundredths = 1400;
  if (naturalTableHeight > maxTableHeight) {
    const scale = maxTableHeight / naturalTableHeight;
    tableActualHeight = maxTableHeight;
    bodyFontSizeHundredths = Math.max(1000, Math.round(1400 * scale));
    for (const row of rows) {
      const currentH = parseEmu(row.getAttribute("h"));
      row.setAttribute("h", String(Math.round(currentH * scale)));
    }
  }

  for (let r = 0; r < rows.length; r++) {
    const isHeader = r === 0;
    const isTarget = r === rows.length - 1;
    if (isHeader || isTarget) continue;
    const cells = getCells(rows[r]);
    for (let c = 1; c < cells.length && c <= SCORECARD_KPI_KEYS.length; c++) {
      normalizeDataCellRuns(cells[c], bodyFontSizeHundredths);
    }
  }

  setFrameHeight(tableFrame, tableActualHeight);

  const readoutTop = tableY + tableActualHeight + READOUT_TOP_MARGIN_EMU;

  const readoutValues: Partial<Record<ScorecardKpiKey, number | null>> = {};
  for (const row of section.summary) readoutValues[row.key as ScorecardKpiKey] = row.value;
  const effectivePoint = section.trends.find((pt) => pt.month === section.reportingMonth);
  const monthlyReadoutValues: Partial<Record<ScorecardKpiKey, number | null>> = {};
  if (effectivePoint) {
    monthlyReadoutValues.pmCompliance = effectivePoint.pmComplianceMonthly;
    monthlyReadoutValues.budgetSpend = effectivePoint.budgetSpendMonthly;
    monthlyReadoutValues.pmCmWorkOrderRatio = effectivePoint.pmCmWorkOrderRatioMonthly;
    monthlyReadoutValues.pmCmCostRatio = effectivePoint.pmCmCostRatioMonthly;
    monthlyReadoutValues.facilityUptime = effectivePoint.facilityUptimeMonthly;
  }
  const lines = buildExecutiveReadoutLines({
    businessUnit: section.businessUnit,
    monthLabel: section.reportingMonthLabel,
    reportingMonth: section.reportingMonth,
    notes: section.notes,
    situation: section.situation,
    values: readoutValues,
    monthlyValues: monthlyReadoutValues,
  });
  setReadoutLinesForSlide(doc, lines, readoutTop, READOUT_TOP_MARGIN_EMU, READOUT_HEIGHT_EMU);

  // Keep the RAG legend aligned with the readout block.
  const legendShape = findShapeByName(doc, "RAG Legend");
  if (legendShape) {
    const xfrm = getElementsByTagNameNS(legendShape, "a", "xfrm")[0];
    const off = xfrm ? getElementsByTagNameNS(xfrm, "a", "off")[0] : null;
    const ext = xfrm ? getElementsByTagNameNS(xfrm, "a", "ext")[0] : null;
    if (off) off.setAttribute("y", String(Math.round(readoutTop)));
    if (ext) ext.setAttribute("cy", String(LEGEND_MIN_HEIGHT_EMU));
  }

  // Hide the legacy MTTR methodology note (kept off-slide, as in the master).
  const mttrNoteShape = findShapeByName(doc, "TextBox 1");
  if (mttrNoteShape) {
    setShapeY(mttrNoteShape, SLIDE_HEIGHT_EMU + BOTTOM_MARGIN_EMU);
  }
}

/**
 * Create a freshly-generated Notes/Situation text box in the readout area
 * below the table. The donor shape is used only for its horizontal geometry
 * and is then REMOVED - the visible content lives in a brand-new slide
 * object the generator owns (never recycled donor paragraphs/runs).
 */
function setReadoutLinesForSlide(
  doc: XmlDocument,
  lines: ReadoutLine[],
  readoutTop: number,
  _topMarginEmu: number,
  heightEmu: number
): void {
  const donorReadout = findShapeByName(doc, "Executive Readout");
  writeNotesSituationReadout(doc, donorReadout ?? null, lines, readoutTop, heightEmu);
}

// ── Cover slide ──

function updateCoverSlide(doc: XmlDocument, data: AllBusinessUnitsDeckData): void {
  const set = (name: string, text: string) => {
    const shape = findShapeByName(doc, name);
    if (shape) setShapeText(shape, text);
  };
  set("Cover Title", "Monthly KPI Scorecard — All Business Units");
  set("Cover Period", `Effective reporting period: ${data.effectiveReportingMonthLabel}`);
  set(
    "Cover Meta",
    `Reporting year ${data.reportingYear} · ${data.sections.length} business unit(s) · values use the live Monthly KPI scorecard semantics`
  );
  set("Cover Footer", "Prepared from the Monthly KPI Scorecard module — ODM Dashboard");
}

// ── Trends slide ──

function updateTrendsSlide(
  doc: XmlDocument,
  section: BusinessUnitDeckSection
): void {
  const titleShape = findShapeByName(doc, "Slide Title");
  if (titleShape) {
    setShapeText(titleShape, `Monthly Reliability KPI Trends, ${section.businessUnit}`);
  }
  const periodShape = findShapeByName(doc, "Slide Period");
  if (periodShape) {
    setShapeText(periodShape, `Reporting period: ${section.reportingMonthLabel}`);
  }
}

const TREND_MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
  "Sep", "Oct", "Nov", "Dec",
];

function axisIdValue(axis: XmlElement | undefined): number {
  if (!axis) return 0;
  const axId = cElements(axis, "axId")[0];
  const value = axId ? Number(axId.getAttribute("val")) : NaN;
  return Number.isFinite(value) ? value : 0;
}

/**
 * Ensure the shared chart grammar for ALL six panels:
 *   MONTHLY ACTUAL = BAR/COLUMN
 *   YTD / CUMULATIVE / YTD AVERAGE = LINE
 *   BENCHMARK = LINE (where applicable)
 *
 * PM Compliance (chart 1) and Facility Uptime (chart 6) already use this
 * grammar. Panels 2-5 (Budget / PM:CM WO / PM:CM Cost / MTTR) previously
 * plotted only lines; this converts them into a barChart + lineChart combo:
 * the Monthly Actual series becomes a clustered column series inside a
 * <c:barChart> that shares the chart's category/value axes with the remaining
 * YTD/benchmark <c:lineChart> series.
 */
function ensureMonthlyBarCombo(
  doc: XmlDocument,
  panel: (typeof TRENDS_PANELS)[number]
): void {
  const expected = panel.series.length;
  if (!panel.series.some((spec) => spec.role === "monthly")) return;

  // 1) If the chart does not yet own the monthly series, add it up-front as a
  //    deep clone (full formatting preserved) relabelled "Monthly Actual".
  const allColl = doc.getElementsByTagNameNS(CHART_NS, "ser");
  const lineChart = cElements(doc, "lineChart")[0];
  if (allColl.length < expected && lineChart) {
    const lineSers = cElements(lineChart, "ser");
    if (lineSers.length === 0) return;
    const monthly = lineSers[0].cloneNode(true) as XmlElement;
    const txCache = cElements(monthly, "strCache")[0];
    const txPt = txCache ? cElements(txCache, "pt")[0] : null;
    if (txPt) {
      removeChildElements(txPt, "v");
      txPt.appendChild(cText(monthly.ownerDocument as XmlDocument, "Monthly Actual"));
    }
    lineChart.insertBefore(monthly, lineChart.firstChild);
  }

  // 2) Convert Monthly Actual into a column series (barChart sharing the axes).
  const plotArea = cElements(doc, "plotArea")[0];
  const existingBar = cElements(doc, "barChart")[0];
  if (!plotArea || !lineChart || existingBar) return;
  const sersAfter = cElements(lineChart, "ser");
  if (sersAfter.length === 0) return;
  const monthlySer = sersAfter[0];
  lineChart.removeChild(monthlySer);

  const catVal = axisIdValue(cElements(doc, "catAx")[0]);
  const numVal = axisIdValue(cElements(doc, "valAx")[0]);

  const barChart = createCNs(doc, "barChart");
  const barDir = createCNs(doc, "barDir");
  barDir.setAttribute("val", "col");
  barChart.appendChild(barDir);
  const grouping = createCNs(doc, "grouping");
  grouping.setAttribute("val", "clustered");
  barChart.appendChild(grouping);
  const varyColors = createCNs(doc, "varyColors");
  varyColors.setAttribute("val", "0");
  barChart.appendChild(varyColors);
  barChart.appendChild(monthlySer);
  const gapWidth = createCNs(doc, "gapWidth");
  gapWidth.setAttribute("val", "150");
  barChart.appendChild(gapWidth);
  for (const id of [catVal, numVal]) {
    const axId = createCNs(doc, "axId");
    axId.setAttribute("val", String(id));
    barChart.appendChild(axId);
  }
  plotArea.insertBefore(barChart, lineChart);

  // 3) Renumber series idx/order across the whole chart.
  const finalColl = doc.getElementsByTagNameNS(CHART_NS, "ser");
  for (let index = 0; index < finalColl.length; index++) {
    const ser = finalColl[index] as unknown as XmlElement;
    const idxEl = cElements(ser, "idx")[0];
    const orderEl = cElements(ser, "order")[0];
    if (idxEl) idxEl.setAttribute("val", String(index));
    if (orderEl) orderEl.setAttribute("val", String(index));
  }
}

/**
 * Rewrite one chart part's cached categories + series values for a BU.
 *
 * CATEGORIES ARE CALENDAR-ALIGNED: every chart shows months 1 .. effective
 * reporting month with its real calendar label (Jan..Aug for an August
 * presentation). A month with no data keeps its position and simply has no
 * value point (a gap) - values are NEVER compacted toward the chart start.
 */
export function rewriteTrendChartCache(
  chartXml: string,
  panel: (typeof TRENDS_PANELS)[number],
  section: BusinessUnitDeckSection
): string {
  const doc = parseXml(chartXml);
  ensureMonthlyBarCombo(doc, panel);

  const points = section.trends;
  const byMonth = new Map(points.map((point) => [point.month, point]));
  const effectiveMonth = section.reportingMonth;
  const categories: string[] = [];
  const months: number[] = [];
  for (let month = 1; month <= effectiveMonth; month += 1) {
    categories.push(TREND_MONTH_LABELS[month - 1] ?? String(month));
    months.push(month);
  }

  const sers = cElements(doc, "ser");
  for (let i = 0; i < sers.length; i++) {
    const spec = panel.series[i];
    if (!spec) continue;
    const values = months.map((month) => {
      if (spec.role === "const") return spec.value;
      const point = byMonth.get(month);
      if (!point) return null;
      const raw = point[spec.source] as number | null | undefined;
      return isPresentNumber(raw) ? Math.round(raw * 100) / 100 : null;
    });
    replaceSeriesCache(sers[i], categories, values);
  }
  return serializeXml(doc);
}

function replaceSeriesCache(
  ser: XmlElement,
  categories: string[],
  values: Array<number | null>
): void {
  const ownerDoc = ser.ownerDocument as XmlDocument;

  const setPtCount = (cache: XmlElement, count: number) => {
    const ptCount = cElements(cache, "ptCount")[0];
    if (ptCount) ptCount.setAttribute("val", String(count));
  };

  // Category cache (c:cat -> multiLvlStrCache/strCache).
  const cat = cElements(ser, "cat")[0];
  if (cat) {
    const catCache =
      cElements(cat, "multiLvlStrCache")[0] ?? cElements(cat, "strCache")[0];
    if (catCache) {
      setPtCount(catCache, categories.length);
      const level = cElements(catCache, "lvl")[0];
      const ptsContainer = level ?? catCache;
      removeChildElements(ptsContainer, "pt");
      categories.forEach((category, index) => {
        const pt = createCNs(ownerDoc, "pt");
        pt.setAttribute("idx", String(index));
        pt.appendChild(cText(ownerDoc, category));
        ptsContainer.appendChild(pt);
      });
    }
  }

  // Value cache (c:val -> numCache). formatCode/ptCount are preserved.
  const val = cElements(ser, "val")[0];
  if (val) {
    const numCache = cElements(val, "numCache")[0];
    if (numCache) {
      setPtCount(numCache, values.filter((v) => v !== null).length);
      removeChildElements(numCache, "pt");
      values.forEach((value, index) => {
        if (value === null) return;
        const pt = createCNs(ownerDoc, "pt");
        pt.setAttribute("idx", String(index));
        pt.appendChild(cText(ownerDoc, String(value)));
        numCache.appendChild(pt);
      });
    }
  }
}

function removeChildElements(parent: XmlElement, localName: string): void {
  for (const child of [...parent.childNodes]) {
    const el = child as unknown as XmlElement;
    if (el && el.localName === localName && el.namespaceURI === CHART_NS) {
      parent.removeChild(child);
    }
  }
}

function cElements(
  parent: XmlElement | XmlDocument,
  localName: string
): XmlElement[] {
  const out: XmlElement[] = [];
  const collection = parent.getElementsByTagNameNS(CHART_NS, localName);
  for (let i = 0; i < collection.length; i++) {
    out.push(collection[i] as XmlElement);
  }
  return out;
}

function createCNs(ownerDoc: XmlDocument, localName: string): XmlElement {
  return ownerDoc.createElementNS(CHART_NS, `c:${localName}`) as XmlElement;
}

function cText(ownerDoc: XmlDocument, text: string): XmlElement {
  const v = createCNs(ownerDoc, "v");
  v.textContent = text;
  return v;
}

async function updateTrendsChartsForSection(
  zip: PptxZip,
  chartNumbers: number[],
  section: BusinessUnitDeckSection
): Promise<void> {
  for (const panel of TRENDS_PANELS) {
    const chartNumber = chartNumbers[panel.id - 1];
    const chartPath = `ppt/charts/chart${chartNumber}.xml`;
    const chartXml = await zip.file(chartPath)?.async("string");
    if (!chartXml) continue;
    zip.file(chartPath, rewriteTrendChartCache(chartXml, panel, section));
  }
}

// ── Deck assembly ──

const SLIDE_RELS_LAYOUT_ONLY = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout12.xml"/></Relationships>`;

function trendsSlideRels(chartNumbers: number[]): string {
  const rels = chartNumbers
    .map(
      (n, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${n}.xml"/>`
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout12.xml"/></Relationships>`;
}

export async function generateAllBusinessUnitsMonthlyKpiDeck(
  data: AllBusinessUnitsDeckData
): Promise<Blob> {
  const templatePath = resolveExecutiveTemplatePath(TEMPLATE_FILENAME);
  const zip = await loadPptxTemplate(templatePath);
  await ensureXlsxDefault(zip);

  // Cover donor (slide1).
  const coverDoc = await loadSlideXml(zip, "ppt/slides/slide1.xml");
  updateCoverSlide(coverDoc, data);
  saveSlideXml(zip, "ppt/slides/slide1.xml", coverDoc);

  const sections = data.sections;
  const totalSlides = 1 + sections.length * 2;

  if (sections.length === 0) {
    await removeSlidePart(zip, 2);
    await removeSlidePart(zip, 3);
    await setPresentationSlideOrder(zip, [1]);
    await cleanMonthlyKpiPresentationZip(zip);
    return generatePptxBlob(zip);
  }

  let nextChartNumber = (await maxChartNumber(zip)) + 1;

  // Cache the PRISTINE donor slide XML up front. Slide 2/3 parts are updated
  // in place for the first BU, so clones for later BUs must come from these
  // untouched donor strings (never from the already-updated parts, which would
  // leak earlier BUs' readout text/formatting into later BUs).
  const pristineScorecardDonorXml = await zip
    .file("ppt/slides/slide2.xml")
    ?.async("string");
  const pristineTrendsDonorXml = await zip
    .file("ppt/slides/slide3.xml")
    ?.async("string");
  if (!pristineScorecardDonorXml || !pristineTrendsDonorXml) {
    throw new Error("[TEMPLATE] Missing donor slide XML.");
  }

  // Donor scorecard slide (slide2) and donor trends slide (slide3) serve the
  // first BU; each further BU receives clones of both donors.
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const scorecardSlideNumber = 2 + i * 2;
    const trendsSlideNumber = 3 + i * 2;

    if (i === 0) {
      const scorecardDoc = await loadSlideXml(zip, `ppt/slides/slide${scorecardSlideNumber}.xml`);
      updateScorecardSlide(scorecardDoc, section);
      saveSlideXml(zip, `ppt/slides/slide${scorecardSlideNumber}.xml`, scorecardDoc);

      const trendsDoc = await loadSlideXml(zip, `ppt/slides/slide${trendsSlideNumber}.xml`);
      updateTrendsSlide(trendsDoc, section);
      saveSlideXml(zip, `ppt/slides/slide${trendsSlideNumber}.xml`, trendsDoc);
      await updateTrendsChartsForSection(zip, [1, 2, 3, 4, 5, 6], section);
      continue;
    }

    // Scorecard clone (from the pristine donor captured before any update).
    const scorecardDoc = parseXml(pristineScorecardDonorXml);
    updateScorecardSlide(scorecardDoc, section);
    await addSlidePart(
      zip,
      scorecardSlideNumber,
      serializeXml(scorecardDoc),
      SLIDE_RELS_LAYOUT_ONLY
    );

    // Trends clone: first clone the six chart parts, then the slide.
    const chartNumbers: number[] = [];
    for (let c = 1; c <= 6; c++) {
      const target = nextChartNumber++;
      await addChartClone(zip, c, target);
      chartNumbers.push(target);
    }
    const trendsDoc = parseXml(pristineTrendsDonorXml);
    updateTrendsSlide(trendsDoc, section);
    await addSlidePart(
      zip,
      trendsSlideNumber,
      serializeXml(trendsDoc),
      trendsSlideRels(chartNumbers)
    );
    await updateTrendsChartsForSection(zip, chartNumbers, section);
  }

  const slideOrder = Array.from({ length: totalSlides }, (_, index) => index + 1);
  await setPresentationSlideOrder(zip, slideOrder);
    await cleanMonthlyKpiPresentationZip(zip);
return generatePptxBlob(zip);
}

