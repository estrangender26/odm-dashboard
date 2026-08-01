/**
 * Monthly KPI Executive Scorecard generator.
 *
 * Replaces text and tables inside the committed MonthlyKpiExecutive.pptx
 * template using the shared Executive Presentation Framework.
 *
 * Recovery changes:
 * - Template headers are preserved from the approved deck instead of being
 *   overwritten, which avoids collapsing multi-paragraph header cells and
 *   keeps the generated deck visually identical to the approved template.
 * - Table data cells are still replaced with the persisted KPI values.
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
  // from the approved template to avoid corrupting multi-paragraph header
  // formatting; only the data values are replaced.
  for (let i = 0; i < 7; i++) {
    const row = rows[i + 1];
    const cells = getCells(row);
    const trend = selectedBu.monthlyTrend[i];
    if (!trend) {
      if (cells.length > 0) setCellText(cells[0], "");
      for (let j = 1; j < cells.length; j++) setCellText(cells[j], "");
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

  const readoutShape = findShapeByName(doc, "Executive Readout");
  if (readoutShape) {
    setShapeText(readoutShape, data.executive.slide1Observation);
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

function buildIssueCellText(
  bu: BusinessUnitScorecard | undefined,
  key: ScorecardKpiKey
): string {
  if (!bu) return "";
  const value = bu.ytd[key];
  if (!isPresentNumber(value.value)) return "No data submitted.";
  if (value.status === "success") return "";
  if (value.status === "warning") {
    return `${value.formatted}; requires monitoring and recovery validation.`;
  }
  if (value.status === "danger") {
    return `${value.formatted}; below benchmark, recovery plan required.`;
  }
  if (key === "mttrDays") {
    return `${value.formatted}; provisional pending validation.`;
  }
  return `${value.formatted}; review drivers.`;
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
  // approved template; only the per-BU issue cells are replaced.
  for (let i = 0; i < TABLE_METRICS.length; i++) {
    const key = TABLE_METRICS[i];
    const row = rows[i + 1];
    const cells = getCells(row);
    for (let c = 0; c < TEMPLATE_BU_COLUMNS.length; c++) {
      const buName = TEMPLATE_BU_COLUMNS[c];
      const bu = data.buScorecards.find((b) => b.businessUnit === buName);
      setCellText(cells[c + 1], buildIssueCellText(bu, key));
    }
  }

  // Action shapes
  const actions = data.executive.slide3Actions;
  const actionShapeNames = [
    "PM RECOVERY Action",
    "DATA CLOSURE Action",
    "VALIDATION Action",
  ];
  for (let i = 0; i < actionShapeNames.length; i++) {
    const shape = findShapeByName(doc, actionShapeNames[i]);
    if (shape) {
      setShapeText(
        shape,
        actions[i] ?? "Continue monthly KPI monitoring and validation."
      );
    }
  }
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
