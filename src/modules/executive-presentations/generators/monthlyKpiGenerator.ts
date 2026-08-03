/**
 * Monthly KPI Executive Scorecard generator.
 *
 * Replaces only dynamic values inside the committed MonthlyKpiExecutive.pptx
 * template using the shared Executive Presentation Framework. Shape geometry,
 * body properties, paragraph properties, run properties, autofit settings,
 * masters, layouts, themes, and notes are preserved.
 */

import {
  findGraphicFrameByName,
  findShapeByName,
  generatePptxBlob,
  getCells,
  getTableRows,
  loadPptxTemplate,
  loadSlideXml,
  resolveExecutiveTemplatePath,
  saveSlideXml,
  setCellFill,
  setCellText,
  setShapeText,
  type XmlDocument,
} from "../framework";
import type {
  BusinessUnitScorecard,
  MonthlyKpiPresentation,
  MonthlyKpiValue,
  ScorecardKpiKey,
} from "../../monthly-kpi/types";

const TEMPLATE_FILENAME = "MonthlyKpiExecutive.pptx";

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

function formatMonthlyValue(
  key: ScorecardKpiKey,
  value: MonthlyKpiValue
): string {
  if (!isPresentNumber(value.value)) return "";
  if (key === "mttrDays") return value.value.toFixed(2);
  if (key === "pmCmWorkOrderRatio" || key === "pmCmCostRatio") {
    const pct = value.value.toFixed(1);
    const cmShare = 100 - value.value;
    if (cmShare <= 0) return `${pct}% (No CM)`;
    return `${pct}% (${(value.value / cmShare).toFixed(1)}:1)`;
  }
  return `${value.value.toFixed(2)}%`;
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
      `[TEMPLATE] Expected 10 rows on slide 1 table, found ${rows.length}.`
    );
  }

  // Monthly rows Jan-Jul (rows 1-7). Headers and row labels are preserved
  // from the approved template; only the data values are replaced.
  for (let i = 0; i < 7; i++) {
    const row = rows[i + 1];
    const cells = getCells(row);
    const trend = selectedBu.monthlyTrend[i];
    if (!trend) {
      continue;
    }
    for (let m = 0; m < TABLE_METRICS.length; m++) {
      setCellText(
        cells[m + 1],
        formatMonthlyValue(TABLE_METRICS[m], trend.values[TABLE_METRICS[m]])
      );
    }
  }

  // YTD row
  const ytdRow = rows[8];
  const ytdCells = getCells(ytdRow);
  for (let m = 0; m < TABLE_METRICS.length; m++) {
    setCellText(
      ytdCells[m + 1],
      formatMonthlyValue(TABLE_METRICS[m], selectedBu.ytd[TABLE_METRICS[m]])
    );
  }

  // Executive observation and MTTR methodology note live in separate shapes.
  const readoutShape = findShapeByName(doc, "Executive Readout");
  if (readoutShape) {
    setShapeText(readoutShape, data.executive.slide1Observation);
  }

  const mttrNoteShape = findShapeByName(doc, "TextBox 1");
  if (mttrNoteShape) {
    setShapeText(
      mttrNoteShape,
      "MTTR calculation methodology is being realigned. Indicative MTTR remains provisional pending validation."
    );
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
      setCellText(cells[m + 1], value.formatted);
    }
  }

  // YTD (ALL BUs) row
  const portfolioRow = rows[8];
  const portfolioCells = getCells(portfolioRow);
  for (let m = 0; m < TABLE_METRICS.length; m++) {
    setCellText(
      portfolioCells[m + 1],
      data.portfolioYtd[TABLE_METRICS[m]].formatted
    );
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
