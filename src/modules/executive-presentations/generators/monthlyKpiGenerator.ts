/**
 * Monthly KPI Executive Scorecard generator.
 *
 * Replaces only dynamic values inside the committed MonthlyKpiExecutive.pptx
 * template using the shared Executive Presentation Framework. Shape geometry,
 * body properties, paragraph properties, run properties, autofit settings,
 * masters, layouts, themes, and notes are preserved.
 */

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
  resolveExecutiveTemplatePath,
  saveSlideXml,
  setCellFill,
  setCellText,
  setShapeText,
  type XmlDocument,
  type XmlElement,
} from "../framework";
import type {
  BusinessUnitScorecard,
  MonthlyKpiPresentation,
  MonthlyKpiTrendRow,
  MonthlyKpiValue,
  ScorecardKpiKey,
} from "../../monthly-kpi/types";
import {
  evaluateKpiStatus,
  getDefaultMonthlyKpiThresholdConfig,
  type MonthlyKpiThresholdConfig,
} from "../../monthly-kpi/kpiThresholds";

const TEMPLATE_FILENAME = "MonthlyKpiExecutive.pptx";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const TABLE_METRICS: ScorecardKpiKey[] = [
  "pmCompliance",
  "budgetSpend",
  "pmCmWorkOrderRatio",
  "pmCmCostRatio",
  "mttrDays",
  "facilityUptime",
];

// Slide 3 issue-matrix row order in the approved template. Facility Uptime
// appears before MTTR, so we map by row label rather than by TABLE_METRICS
// order to avoid putting MTTR days into the Facility Uptime row.
const ISSUE_TABLE_METRICS: ScorecardKpiKey[] = [
  "pmCompliance",
  "budgetSpend",
  "pmCmWorkOrderRatio",
  "pmCmCostRatio",
  "facilityUptime",
  "mttrDays",
];

// Template slide 2/3 columns after the KPI/row-label column.
const TEMPLATE_BU_COLUMNS = [
  "AMD-EZ",
  "LARC",
  "CWC",
  "LAWC",
  "TWCI",
  "EWG",
  "WAWA/JVC",
];

/**
 * Resolve a template BU column to its canonical scorecard.
 *
 * Fail loudly when the template expects a column that the adapter did not
 * supply. Silent mismatches used to produce blank columns (e.g. WAWA/JVC).
 */
function requireBuScorecard(
  data: MonthlyKpiPresentation,
  buName: string
): BusinessUnitScorecard {
  const bu = data.buScorecards.find((b) => b.businessUnit === buName);
  if (!bu) {
    const available = data.buScorecards.map((b) => b.businessUnit).join(", ");
    throw new Error(
      `[MONTHLY-KPI-TEMPLATE] Missing scorecard for template column "${buName}". ` +
        `Available scorecards: [${available}]. Check the canonical business-unit mapping in kpiAggregation.`
    );
  }
  return bu;
}

// Color palette for the Slide 3 issues matrix and action cards. These hex
// values match the legend swatches in the approved Monthly KPI template.
const ISSUE_COLORS = {
  critical: "FAD7D7", // red / critical performance gap
  warning: "FFF0C7",  // yellow / KPI or operational gap
  data: "DDE6F0",     // blue-gray / data or scope gap
  neutral: "E2F0D9",  // light green / no material issue (meets target)
} as const;

type IssueClassification =
  | { category: "critical"; text: string; fill: string }
  | { category: "warning"; text: string; fill: string }
  | { category: "data"; text: string; fill: string }
  | { category: "neutral"; text: string; fill: string };

function isPresentNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function cloneMonthlyRow(sourceRow: XmlElement): XmlElement {
  return sourceRow.cloneNode(true) as XmlElement;
}

/**
 * Return the table-cell fill color for Slides 1 and 2 using the configurable
 * Monthly KPI thresholds as the single source of truth. This keeps the
 * presentation generator aligned with the RAG Threshold Configuration screen.
 *
 * Threshold mapping (from the approved configuration):
 * - PM Compliance: Green ≥98; Amber 90 to <98; Red <90
 * - Budget Spend: Green 95–105; Amber 90–<95 or >105–110; Red <90 or >110
 * - PM:CM Ratio (WO): Green ≥86; Amber 75 to <86; Red <75
 * - PM:CM Ratio (Cost): Green ≥80; Amber 50 to <80; Red <50
 * - Facility Uptime: Green =100; Amber 99 to <100; Red <99
 * - MTTR: Green when a valid value exists; no data = gray (Amber/Red TBD)
 *
 * Missing/null values always receive neutral gray so cloned template-row
 * colors never leak into empty cells.
 */
const DEFAULT_THRESHOLD_CONFIG = getDefaultMonthlyKpiThresholdConfig();

function getSlide12KpiFillColor(
  key: ScorecardKpiKey,
  value: MonthlyKpiValue | undefined,
  config: MonthlyKpiThresholdConfig = DEFAULT_THRESHOLD_CONFIG
): string {
  if (!value || !isPresentNumber(value.value)) return "DDE6F0";
  const evalStatus = evaluateKpiStatus(key, value.value, config).status;
  switch (evalStatus) {
    case "green":
      return "A9D18E";
    case "amber":
      return "FFD966";
    case "red":
      return "FF6B6B";
    case "missing":
    default:
      return "DDE6F0";
  }
}

function formatDisplayValue(key: ScorecardKpiKey, value: number | null): string {
  if (!isPresentNumber(value)) return "";
  if (key === "mttrDays") return String(Math.round(value));
  if (key === "pmCmWorkOrderRatio" || key === "pmCmCostRatio") {
    const pct = String(Math.round(value));
    const cmShare = 100 - value;
    if (cmShare <= 0) return `${pct}% (No CM)`;
    return `${pct}% (${(value / cmShare).toFixed(1)}:1)`;
  }
  return `${Math.round(value)}%`;
}

function formatMonthlyValue(
  key: ScorecardKpiKey,
  value: MonthlyKpiValue
): string {
  return formatDisplayValue(key, value.value);
}

function formatThresholdTargetDescription(rule: import("../../monthly-kpi/kpiThresholds").KpiThresholdRule): string {
  if (rule.dataExistsGreen) {
    return "Data exists";
  }
  if (rule.twoSided) {
    const min = rule.green.min ?? rule.amber.min;
    const max = rule.green.max ?? rule.amber.max;
    if (min != null && max != null) {
      return `${min}%–${max}%`;
    }
  }
  if (rule.green.min != null) {
    if (rule.key === "facilityUptime") {
      return `=${rule.green.min}${rule.unit === "%" ? "%" : ""}`;
    }
    return `≥${rule.green.min}${rule.unit === "%" ? "%" : ""}`;
  }
  return "";
}

function formatMonthRanges(months: number[]): string {
  if (months.length === 0) return "";
  if (months.length === 1) {
    return MONTH_NAMES[months[0] - 1]?.slice(0, 3) ?? `M${months[0]}`;
  }
  const isContiguous = months.every((m, i) => i === 0 || m === months[i - 1] + 1);
  const first = MONTH_NAMES[months[0] - 1]?.slice(0, 3) ?? `M${months[0]}`;
  const last = MONTH_NAMES[months[months.length - 1] - 1]?.slice(0, 3) ?? `M${months[months.length - 1]}`;
  if (isContiguous) {
    return `${first}–${last}`;
  }
  return months.map((m) => MONTH_NAMES[m - 1]?.slice(0, 3) ?? `M${m}`).join(", ");
}

function getMetricDisplayName(key: ScorecardKpiKey): string {
  switch (key) {
    case "pmCompliance":
      return "PM compliance";
    case "budgetSpend":
      return "budget spend";
    case "pmCmWorkOrderRatio":
      return "PM:CM WO ratio";
    case "pmCmCostRatio":
      return "PM:CM cost ratio";
    case "facilityUptime":
      return "facility uptime";
    case "mttrDays":
      return "MTTR";
  }
}

function getMonthlyExceptionDescription(key: ScorecardKpiKey, hasRed: boolean, hasAmber: boolean): string {
  if (key === "budgetSpend") {
    return "was outside the target range";
  }
  if (hasRed && hasAmber) {
    return "was below target";
  }
  if (hasRed) {
    return "was below target";
  }
  return "was below target";
}

interface KpiExceptionInfo {
  key: ScorecardKpiKey;
  monthlyExceptionMonths: number[];
  monthlyRedMonths: number[];
  monthlyAmberMonths: number[];
  ytdStatus: import("../../monthly-kpi/kpiThresholds").KpiEvaluationStatus["status"];
  ytdValue: number | null;
}

function gatherKpiExceptions(
  bu: BusinessUnitScorecard,
  reportingMonth: number,
  config: MonthlyKpiThresholdConfig = DEFAULT_THRESHOLD_CONFIG
): KpiExceptionInfo[] {
  const result: KpiExceptionInfo[] = [];
  for (const key of TABLE_METRICS) {
    if (key === "mttrDays") continue; // valid MTTR is green under current config
    const monthlyExceptionMonths: number[] = [];
    const monthlyRedMonths: number[] = [];
    const monthlyAmberMonths: number[] = [];
    for (let month = 1; month <= reportingMonth; month++) {
      const trend = bu.monthlyTrend.find((t) => t.month === month);
      const value = trend?.values[key];
      if (!value || !isPresentNumber(value.value)) continue;
      const status = evaluateKpiStatus(key, value.value, config).status;
      if (status === "red" || status === "amber") {
        monthlyExceptionMonths.push(month);
        if (status === "red") monthlyRedMonths.push(month);
        else monthlyAmberMonths.push(month);
      }
    }
    const ytdValue = bu.ytd[key];
    const ytdStatus = ytdValue && isPresentNumber(ytdValue.value)
      ? evaluateKpiStatus(key, ytdValue.value, config).status
      : "missing";
    if (monthlyExceptionMonths.length > 0 || ytdStatus === "red" || ytdStatus === "amber") {
      result.push({
        key,
        monthlyExceptionMonths,
        monthlyRedMonths,
        monthlyAmberMonths,
        ytdStatus,
        ytdValue: ytdValue?.value ?? null,
      });
    }
  }
  return result;
}

function generateSlide1Commentary(
  bu: BusinessUnitScorecard,
  reportingMonth: number,
  config: MonthlyKpiThresholdConfig = DEFAULT_THRESHOLD_CONFIG
): string {
  const exceptions = gatherKpiExceptions(bu, reportingMonth, config);
  if (exceptions.length === 0) {
    return "All reported KPIs are within target/acceptable bands.";
  }

  const clauses: string[] = [];
  const ratioKeys = ["pmCmWorkOrderRatio", "pmCmCostRatio"] as const;
  const ratioExceptions = exceptions.filter((e) =>
    (ratioKeys as readonly string[]).includes(e.key)
  );
  const nonRatioExceptions = exceptions.filter((e) =>
    !(ratioKeys as readonly string[]).includes(e.key)
  );

  if (ratioExceptions.length === 2) {
    const wo = ratioExceptions.find((e) => e.key === "pmCmWorkOrderRatio")!;
    const cost = ratioExceptions.find((e) => e.key === "pmCmCostRatio")!;
    const allRatioMonths = Array.from(
      new Set([...wo.monthlyExceptionMonths, ...cost.monthlyExceptionMonths])
    ).sort((a, b) => a - b);
    const hasMonthly = allRatioMonths.length > 0;
    const hasYtd = wo.ytdStatus !== "green" || cost.ytdStatus !== "green";
    let clause = "PM:CM ratios ";
    if (hasMonthly) {
      const allMonths = allRatioMonths.length === reportingMonth;
      const mostMonths = !allMonths && allRatioMonths.length > reportingMonth / 2;
      const monthDesc = allMonths
        ? "throughout the period"
        : mostMonths
        ? "in most months"
        : `in ${formatMonthRanges(allRatioMonths)}`;
      clause += `were below benchmark ${monthDesc} and `;
    }
    clause += "remain below benchmark";
    if (hasYtd) {
      const woFormatted = formatDisplayValue("pmCmWorkOrderRatio", wo.ytdValue);
      const costFormatted = formatDisplayValue("pmCmCostRatio", cost.ytdValue);
      const woRule = config.pmCmWorkOrderRatio;
      const costRule = config.pmCmCostRatio;
      const woTarget = formatThresholdTargetDescription(woRule);
      const costTarget = formatThresholdTargetDescription(costRule);
      clause += `, with YTD WO ratio at ${woFormatted} vs ${woTarget} target and YTD cost ratio at ${costFormatted} vs ${costTarget} target`;
    }
    clauses.push(clause);
  } else if (ratioExceptions.length === 1) {
    const info = ratioExceptions[0];
    const rule = config[info.key];
    const target = formatThresholdTargetDescription(rule);
    const metricName = getMetricDisplayName(info.key);
    const hasMonthly = info.monthlyExceptionMonths.length > 0;
    const hasYtd = info.ytdStatus === "red" || info.ytdStatus === "amber";
    let clause = "";
    if (hasMonthly) {
      const allMonths = info.monthlyExceptionMonths.length === reportingMonth;
      const mostMonths = !allMonths && info.monthlyExceptionMonths.length > reportingMonth / 2;
      const monthDesc = allMonths
        ? "throughout the period"
        : mostMonths
        ? "in most months"
        : `in ${formatMonthRanges(info.monthlyExceptionMonths)}`;
      clause = `${metricName} was below benchmark ${monthDesc}`;
    }
    if (hasYtd && isPresentNumber(info.ytdValue)) {
      const ytdFormatted = formatDisplayValue(info.key, info.ytdValue);
      const ytdClause = `YTD ${ytdFormatted} vs ${target} target`;
      clause = clause ? `${clause}; ${ytdClause}` : `${metricName} ${ytdClause}`;
    }
    if (clause) clauses.push(clause);
  }

  for (const info of nonRatioExceptions) {
    const rule = config[info.key];
    const target = formatThresholdTargetDescription(rule);
    const metricName = getMetricDisplayName(info.key);
    const hasMonthly = info.monthlyExceptionMonths.length > 0;
    const hasYtd = info.ytdStatus === "red" || info.ytdStatus === "amber";
    let clause = "";
    if (hasMonthly) {
      const allMonths = info.monthlyExceptionMonths.length === reportingMonth;
      const mostMonths = !allMonths && info.monthlyExceptionMonths.length > reportingMonth / 2;
      const monthDesc = allMonths
        ? "throughout the period"
        : mostMonths
        ? "in most months"
        : `in ${formatMonthRanges(info.monthlyExceptionMonths)}`;
      const description = getMonthlyExceptionDescription(
        info.key,
        info.monthlyRedMonths.length > 0,
        info.monthlyAmberMonths.length > 0
      );
      clause = `${metricName} ${description} ${monthDesc}`;
    }
    if (hasYtd && isPresentNumber(info.ytdValue)) {
      const ytdFormatted = formatDisplayValue(info.key, info.ytdValue);
      const ytdClause = `YTD ${ytdFormatted} vs ${target} target`;
      clause = clause ? `${clause}; ${ytdClause}` : `${metricName} ${ytdClause}`;
    }
    if (clause) clauses.push(clause);
  }

  if (clauses.length === 0) {
    return "All reported KPIs are within target/acceptable bands.";
  }
  return "Key exceptions: " + clauses.join("; ") + ".";
}



/**
 * Convert an EMU attribute value to a number.
 */
function parseEmu(value: string | null | undefined): number {
  if (!value) return 0;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Apply a vertical offset to a shape's xfrm. Only the y offset is changed;
 * size and x position are preserved.
 */
function setShapeY(shape: XmlElement, y: number): void {
  const xfrm = getElementsByTagNameNS(shape, "a", "xfrm")[0];
  if (!xfrm) return;
  const off = getElementsByTagNameNS(xfrm, "a", "off")[0];
  if (!off) return;
  off.setAttribute("y", String(Math.round(y)));
}

/**
 * Apply a new height to a graphic frame (table) xfrm while preserving position
 * and width. Graphic frames use a p:xfrm container with a:ext children.
 */
function setFrameHeight(frame: XmlElement, cy: number): void {
  const xfrms = [
    getElementsByTagNameNS(frame, "p", "xfrm")[0],
    getElementsByTagNameNS(frame, "a", "xfrm")[0],
  ].filter(Boolean);
  const xfrm = xfrms[0];
  if (!xfrm) return;
  const ext = getElementsByTagNameNS(xfrm, "a", "ext")[0];
  if (!ext) return;
  ext.setAttribute("cy", String(Math.round(cy)));
}

/**
 * Sum of table row heights in EMU.
 */
function getTableHeightEmu(rows: XmlElement[]): number {
  let total = 0;
  for (const row of rows) {
    total += parseEmu(row.getAttribute("h"));
  }
  return total;
}

function updateSlide1(doc: XmlDocument, data: MonthlyKpiPresentation): void {
  const titleShape = findShapeByName(doc, "Slide Title");
  if (titleShape) {
    setShapeText(
      titleShape,
      `Monthly Reliability KPI Scorecard, ${
        data.selectedBusinessUnit === "All Business Units"
          ? "East Zone"
          : data.selectedBusinessUnit
      }`
    );
  }

  const selectedBu =
    data.buScorecards.find((bu) => bu.businessUnit === data.selectedBusinessUnit) ??
    data.buScorecards[0];

  const tableFrame = findGraphicFrameByName(doc, "AMD-EZ Monthly KPI Scorecard");
  if (!tableFrame) {
    throw new Error(
      '[TEMPLATE] Required frame "AMD-EZ Monthly KPI Scorecard" not found on slide 1.'
    );
  }
  const rows = getTableRows(tableFrame);
  if (rows.length < 10) {
    throw new Error(
      `[TEMPLATE] Expected at least 10 rows on slide 1 table, found ${rows.length}.`
    );
  }

  const reportingMonth = data.reportingMonth;
  if (reportingMonth < 1 || reportingMonth > 12) {
    throw new Error(
      `[MONTHLY-KPI] reportingMonth must be between 1 and 12, got ${reportingMonth}.`
    );
  }

  const trendByMonth = new Map<number, MonthlyKpiTrendRow>();
  for (const trend of selectedBu.monthlyTrend) {
    trendByMonth.set(trend.month, trend);
  }

  const tbl = getElementsByTagNameNS(tableFrame, "a", "tbl")[0];
  if (!tbl) {
    throw new Error('[TEMPLATE] Slide 1 table has no <a:tbl> element.');
  }

  // The template provides rows 1-7 (Jan-Jul). If the requested reporting month
  // is later in the year, clone the July row to create Aug-Dec rows before YTD.
  const requiredRowCount = reportingMonth + 3; // header + reportingMonth monthly rows + YTD + TARGET
  if (rows.length < requiredRowCount) {
    const julyRow = rows[7];
    const ytdRow = rows[rows.length - 2];
    const missing = requiredRowCount - rows.length;
    for (let i = 0; i < missing; i++) {
      const clone = cloneMonthlyRow(julyRow);
      tbl.insertBefore(clone, ytdRow);
      rows.splice(rows.length - 2, 0, clone);
    }
  }

  // Fill monthly rows Jan..reportingMonth. Missing months use the existing
  // KPI convention: empty cells (the template already shows the month label).
  for (let month = 1; month <= reportingMonth; month++) {
    const row = rows[month];
    const cells = getCells(row);
    const monthLabel = MONTH_NAMES[month - 1]?.slice(0, 3) ?? `M${month}`;
    setCellText(cells[0], monthLabel);
    const trend = trendByMonth.get(month);
    for (let m = 0; m < TABLE_METRICS.length; m++) {
      const metric = TABLE_METRICS[m];
      const value = trend?.values[metric];
      const cell = cells[m + 1];
      setCellText(cell, value ? formatMonthlyValue(metric, value) : "");
      setCellFill(cell, getSlide12KpiFillColor(metric, value));
    }
  }

  // Remove template rows that fall outside the requested reporting period.
  // The approved template provides Jan-Jul; for earlier reporting months such as
  // April, May-Jul must not appear in the deck. Removing them (instead of just
  // clearing) keeps the generated scorecard strictly limited to the requested
  // period.
  const firstTemplateExtraMonth = reportingMonth + 1;
  const lastTemplateExtraMonth = Math.min(7, rows.length - 3);
  for (let month = lastTemplateExtraMonth; month >= firstTemplateExtraMonth; month--) {
    const row = rows[month];
    if (row && row.parentNode) {
      tbl.removeChild(row);
    }
    rows.splice(month, 1);
  }

  // After potential removals, re-derive YTD position.
  const finalYtdRowIndex = rows.length - 2;

  // YTD row
  const ytdRow = rows[finalYtdRowIndex];
  const ytdCells = getCells(ytdRow);
  for (let m = 0; m < TABLE_METRICS.length; m++) {
    const metric = TABLE_METRICS[m];
    const value = selectedBu.ytd[metric];
    const cell = ytdCells[m + 1];
    setCellText(cell, formatMonthlyValue(metric, value));
    setCellFill(cell, getSlide12KpiFillColor(metric, value));
  }

  // Normalize all body cells to a uniform font family/size/alignment so KPI
  // values (including MTTR, which the template leaves empty) render
  // consistently. Then scale the table if the natural row sum exceeds the
  // vertical budget, so Slide 1 remains clean for reporting months 1-12.
  const tableFrameXfrm = getElementsByTagNameNS(tableFrame, "p", "xfrm")[0];
  const tableOff = tableFrameXfrm
    ? getElementsByTagNameNS(tableFrameXfrm, "a", "off")[0]
    : null;
  const tableY = tableOff ? parseEmu(tableOff.getAttribute("y")) : 742950;

  const SLIDE_HEIGHT_EMU = 6858000;
  const BOTTOM_MARGIN_EMU = 190500; // ~0.21 in safety margin
  const READOUT_HEIGHT_EMU = 900000;
  const READOUT_TOP_MARGIN_EMU = 300000;
  const LEGEND_MIN_HEIGHT_EMU = 900000;
  const BUDGET_BELOW_TABLE_EMU =
    READOUT_TOP_MARGIN_EMU + READOUT_HEIGHT_EMU + READOUT_TOP_MARGIN_EMU;
  const maxTableHeight =
    SLIDE_HEIGHT_EMU - tableY - BUDGET_BELOW_TABLE_EMU - BOTTOM_MARGIN_EMU;

  const naturalTableHeight = getTableHeightEmu(rows);
  let tableActualHeight = naturalTableHeight;
  let bodyFontSizeHundredths = 1400;

  if (naturalTableHeight > maxTableHeight) {
    const scale = maxTableHeight / naturalTableHeight;
    tableActualHeight = maxTableHeight;
    // Reduce body font size proportionally, but never below 10 pt, to keep
    // text readable inside scaled rows.
    bodyFontSizeHundredths = Math.max(1000, Math.round(1400 * scale));
    for (const row of rows) {
      const currentH = parseEmu(row.getAttribute("h"));
      row.setAttribute("h", String(Math.round(currentH * scale)));
    }
  }

  // Normalize only the KPI data/value cells (columns 1-6). Preserve the approved
  // template typography for structural cells: header row, Month/YTD/TARGET labels,
  // and the TARGET row values.
  for (let r = 0; r < rows.length; r++) {
    const isHeader = r === 0;
    const isTarget = r === rows.length - 1;
    if (isHeader || isTarget) continue;

    const cells = getCells(rows[r]);
    for (let c = 1; c < cells.length && c <= TABLE_METRICS.length; c++) {
      const cell = cells[c];
      normalizeTableCellBodyFormatting(cell, bodyFontSizeHundredths);
    }
  }

  // Resize the table frame to match its final row content.
  setFrameHeight(tableFrame, tableActualHeight);

  const readoutTop = tableY + tableActualHeight + READOUT_TOP_MARGIN_EMU;

  // Single executive commentary block below the table. The approved August
  // layout shows one bullet only and no separate MTTR methodology note on
  // Slide 1; that note belongs on subsequent slides.
  const readoutShape = findShapeByName(doc, "Executive Readout");
  if (readoutShape) {
    const commentary = generateSlide1Commentary(selectedBu, reportingMonth);
    setShapeText(readoutShape, commentary);
    setShapeY(readoutShape, readoutTop);
  }

  // Hide the legacy MTTR methodology note shape so it does not appear on
  // Slide 1 while remaining available in the template for other uses.
  const mttrNoteShape = findShapeByName(doc, "TextBox 1");
  if (mttrNoteShape) {
    setShapeY(mttrNoteShape, SLIDE_HEIGHT_EMU + BOTTOM_MARGIN_EMU);
  }

  // Keep the RAG legend on the right side of the slide, aligned with the
  // executive readout block. Its compact four-line content fits a fixed height.
  const legendShape = findShapeByName(doc, "RAG Legend");
  if (legendShape) {
    const legendXfrm = getElementsByTagNameNS(legendShape, "a", "xfrm")[0];
    const legendOff = legendXfrm
      ? getElementsByTagNameNS(legendXfrm, "a", "off")[0]
      : null;
    const legendExt = legendXfrm
      ? getElementsByTagNameNS(legendXfrm, "a", "ext")[0]
      : null;
    if (legendOff) {
      legendOff.setAttribute("y", String(Math.round(readoutTop)));
    }
    if (legendExt) {
      legendExt.setAttribute("cy", String(LEGEND_MIN_HEIGHT_EMU));
    }
  }
}

/**
 * Force every run in a KPI data/value table cell to use the same body
 * formatting: supplied font size, Aptos typeface, centered alignment, and a
 * centered vertical anchor. Existing intentional emphasis (bold, italic) is
 * preserved. This eliminates inconsistencies (e.g. MTTR values) caused by
 * template cells that mix 10 pt, 14 pt, or theme-reference (+mn-lt) fonts.
 * Structural cells (header, Month/YTD labels, TARGET row) are not modified.
 */
function normalizeTableCellBodyFormatting(
  cell: XmlElement,
  fontSizeHundredths: number
): void {
  const ownerDoc = cell.ownerDocument;
  if (!ownerDoc) return;

  const txBody = getElementsByTagNameNS(cell, "a", "txBody")[0];
  if (!txBody) return;

  let bodyPr = getElementsByTagNameNS(txBody, "a", "bodyPr")[0];
  if (!bodyPr) {
    bodyPr = createElementNS(ownerDoc, "a", "bodyPr");
    txBody.insertBefore(bodyPr, txBody.firstChild);
  }
  bodyPr.setAttribute("anchor", "ctr");

  for (const paragraph of getElementsByTagNameNS(txBody, "a", "p")) {
    const pPr = getElementsByTagNameNS(paragraph, "a", "pPr")[0];
    if (pPr) {
      pPr.setAttribute("algn", "ctr");
    }
    for (const run of getElementsByTagNameNS(paragraph, "a", "r")) {
      let rPr = getElementsByTagNameNS(run, "a", "rPr")[0];
      if (!rPr) {
        rPr = createElementNS(ownerDoc, "a", "rPr");
        // Insert before any a:t child.
        const t = getElementsByTagNameNS(run, "a", "t")[0];
        if (t) {
          run.insertBefore(rPr, t);
        } else {
          run.appendChild(rPr);
        }
      }
      rPr.setAttribute("sz", String(fontSizeHundredths));
      if (rPr.getAttribute("b") === null) {
        rPr.setAttribute("b", "0");
      }
      if (rPr.getAttribute("i") === null) {
        rPr.setAttribute("i", "0");
      }
      if (rPr.getAttribute("u") === null) {
        rPr.setAttribute("u", "none");
      }
      if (rPr.getAttribute("strike") === null) {
        rPr.setAttribute("strike", "noStrike");
      }
      rPr.setAttribute("kern", "1200");

      // Ensure solid fill and Aptos typeface.
      let solidFill = getElementsByTagNameNS(rPr, "a", "solidFill")[0];
      if (!solidFill) {
        solidFill = createElementNS(ownerDoc, "a", "solidFill");
        rPr.insertBefore(solidFill, rPr.firstChild);
      }
      for (const child of [...solidFill.childNodes]) {
        if ((child as unknown as XmlElement).localName) {
          solidFill.removeChild(child);
        }
      }
      const srgbClr = createElementNS(ownerDoc, "a", "srgbClr");
      srgbClr.setAttribute("val", "172B47");
      solidFill.appendChild(srgbClr);

      const latin = getElementsByTagNameNS(rPr, "a", "latin")[0] ?? createElementNS(ownerDoc, "a", "latin");
      latin.setAttribute("typeface", "Aptos");
      if (!latin.parentNode) rPr.appendChild(latin);

      const ea = getElementsByTagNameNS(rPr, "a", "ea")[0] ?? createElementNS(ownerDoc, "a", "ea");
      ea.setAttribute("typeface", "Aptos");
      if (!ea.parentNode) rPr.appendChild(ea);

      const cs = getElementsByTagNameNS(rPr, "a", "cs")[0] ?? createElementNS(ownerDoc, "a", "cs");
      cs.setAttribute("typeface", "Aptos");
      if (!cs.parentNode) rPr.appendChild(cs);
    }
  }
}

function updateSlide2(doc: XmlDocument, data: MonthlyKpiPresentation): void {
  const titleShape = findShapeByName(doc, "Slide Title");
  if (titleShape) {
    setShapeText(titleShape, "Reliability KPI Scorecard – All BUs");
  }
  const subtitleShape = findShapeByName(doc, "Slide Subtitle");
  if (subtitleShape) {
    setShapeText(
      subtitleShape,
      `KPI Scorecard – All BUs | ${data.reportingMonthLabel}`
    );
  }

  const tableFrame = findGraphicFrameByName(doc, "All Business Units KPI Scorecard");
  if (!tableFrame) {
    throw new Error(
      '[TEMPLATE] Required frame "All Business Units KPI Scorecard" not found on slide 2.'
    );
  }
  const rows = getTableRows(tableFrame);
  if (rows.length < 10) {
    throw new Error(
      `[TEMPLATE] Expected 10 rows on slide 2 table, found ${rows.length}.`
    );
  }

  // BU rows 1-7. Headers and row labels are preserved from the approved
  // template; only data values are replaced.
  for (let i = 0; i < TEMPLATE_BU_COLUMNS.length; i++) {
    const row = rows[i + 1];
    const cells = getCells(row);
    const buName = TEMPLATE_BU_COLUMNS[i];
    const bu = data.buScorecards.find((b) => b.businessUnit === buName);
    for (let m = 0; m < TABLE_METRICS.length; m++) {
      const key = TABLE_METRICS[m];
      const value =
        bu?.ytd[key] ?? { value: null, status: "no-data", formatted: "No Data" };
      const cell = cells[m + 1];
      const displayText = isPresentNumber(value.value)
        ? formatDisplayValue(key, value.value)
        : value.formatted;
      setCellText(cell, displayText);
      setCellFill(cell, getSlide12KpiFillColor(key, value));
    }
  }

  // YTD (ALL BUs) row
  const portfolioRow = rows[8];
  const portfolioCells = getCells(portfolioRow);
  for (let m = 0; m < TABLE_METRICS.length; m++) {
    const key = TABLE_METRICS[m];
    const value = data.portfolioYtd[key];
    const cell = portfolioCells[m + 1];
    const displayText = isPresentNumber(value.value)
      ? formatDisplayValue(key, value.value)
      : value.formatted;
    setCellText(cell, displayText);
    setCellFill(cell, getSlide12KpiFillColor(key, value));
  }

  const readoutShape = findShapeByName(doc, "Executive Readout");
  if (readoutShape) {
    setShapeText(readoutShape, data.executive.slide2Observation);
  }

  const dataNoteShape = findShapeByName(doc, "Data Note");
  if (dataNoteShape) {
    setShapeText(dataNoteShape, data.executive.dataNote);
  }
}

/**
 * Classify a BU/KPI cell for the Slide 3 issues matrix.
 *
 * Rules:
 * - Critical (red): actual performance shortfall — danger status with data.
 * - Warning (yellow): near-target or warning status.
 * - Data gap (blue-gray): no data, provisional MTTR, or questionable metric.
 * - Neutral (light): success / acceptable.
 */
function classifyIssueCell(
  bu: BusinessUnitScorecard | undefined,
  key: ScorecardKpiKey
): IssueClassification {
  if (!bu) {
    return { category: "neutral", text: "", fill: ISSUE_COLORS.neutral };
  }
  const value = bu.ytd[key];

  if (!isPresentNumber(value.value)) {
    return { category: "data", text: "No data", fill: ISSUE_COLORS.data };
  }

  if (key === "mttrDays") {
    return {
      category: "data",
      text: `${value.formatted} — Provisional`,
      fill: ISSUE_COLORS.data,
    };
  }

  // CWC PM:CM WO 99.7% (307:1) is flagged as a questionable ratio that needs
  // validation, not a clean pass.
  if (key === "pmCmWorkOrderRatio" && bu.businessUnit === "CWC") {
    const raw = value.value;
    if (raw >= 99) {
      return {
        category: "data",
        text: `${value.formatted} — Validation pending`,
        fill: ISSUE_COLORS.data,
      };
    }
  }

  if (value.status === "danger") {
    return {
      category: "critical",
      text: `${value.formatted} — Recovery required`,
      fill: ISSUE_COLORS.critical,
    };
  }

  if (value.status === "warning") {
    return {
      category: "warning",
      text: `${value.formatted} — Monitor`,
      fill: ISSUE_COLORS.warning,
    };
  }

  // Success / acceptable: show the value with a short success label so
  // the matrix is visually consistent and readers do not mistake a blank
  // neutral cell for missing data.
  return {
    category: "neutral",
    text: `${value.formatted} — Meets target`,
    fill: ISSUE_COLORS.neutral,
  };
}

function updateSlide3(doc: XmlDocument, data: MonthlyKpiPresentation): void {
  const titleShape = findShapeByName(doc, "Issues Title");
  if (titleShape) {
    setShapeText(
      titleShape,
      "Three actions must be completed before the next review"
    );
  }
  const subtitleShape = findShapeByName(doc, "Issues Subtitle");
  if (subtitleShape) {
    setShapeText(
      subtitleShape,
      `Maintenance KPI issues matrix | ${data.reportingMonthLabel}`
    );
  }

  const tableFrame = findGraphicFrameByName(doc, "Executive KPI Issues Matrix");
  if (!tableFrame) {
    throw new Error(
      '[TEMPLATE] Required frame "Executive KPI Issues Matrix" not found on slide 3.'
    );
  }
  const rows = getTableRows(tableFrame);
  if (rows.length < 7) {
    throw new Error(
      `[TEMPLATE] Expected 7 rows on slide 3 table, found ${rows.length}.`
    );
  }

  // Rows 1-6. The header row and KPI column labels are preserved from the
  // approved template; only the per-BU issue cells are replaced. We use the
  // row order from the template, not TABLE_METRICS order.
  for (let i = 0; i < ISSUE_TABLE_METRICS.length; i++) {
    const key = ISSUE_TABLE_METRICS[i];
    const row = rows[i + 1];
    const cells = getCells(row);
    for (let c = 0; c < TEMPLATE_BU_COLUMNS.length; c++) {
      const buName = TEMPLATE_BU_COLUMNS[c];
      const bu = requireBuScorecard(data, buName);
      const issue = classifyIssueCell(bu, key);
      const cell = cells[c + 1];
      setCellText(cell, issue.text);
      setCellFill(cell, issue.fill);
    }
  }

  // Action statements belong in the dedicated text shapes, not the background
  // action-card shapes. Labels are preserved from the template.
  const actions = data.executive.slide3Actions;
  const actionTextShapeNames = [
    "PM RECOVERY Text",
    "DATA CLOSURE Text",
    "VALIDATION Text",
  ];
  for (let i = 0; i < actionTextShapeNames.length; i++) {
    const shape = findShapeByName(doc, actionTextShapeNames[i]);
    if (shape) {
      const text = actions[i] ?? "Continue monthly KPI monitoring and validation.";
      // Keep action statements to at most two lines by truncating with an
      // ellipsis if the adapter supplies a longer string.
      setShapeText(shape, truncateActionText(text));
    }
  }
}

function truncateActionText(text: string): string {
  const maxChars = 110;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trim() + "…";
}

export async function generateMonthlyKpiPresentation(
  data: MonthlyKpiPresentation
): Promise<Blob> {
  const templatePath = resolveExecutiveTemplatePath(TEMPLATE_FILENAME);
  const zip = await loadPptxTemplate(templatePath);

  const slideFiles: Array<{
    name: string;
    updater: (doc: XmlDocument, data: MonthlyKpiPresentation) => void;
  }> = [
    { name: "ppt/slides/slide1.xml", updater: updateSlide1 },
    { name: "ppt/slides/slide2.xml", updater: updateSlide2 },
    { name: "ppt/slides/slide3.xml", updater: updateSlide3 },
  ];

  for (const { name, updater } of slideFiles) {
    const doc = await loadSlideXml(zip, name);
    updater(doc, data);
    saveSlideXml(zip, name, doc);
  }

  return generatePptxBlob(zip);
}
