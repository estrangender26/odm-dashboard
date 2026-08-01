/**
 * Monthly KPI Scorecard Template-Based Presentation Generator
 *
 * Uses the committed reference PPTX as an immutable production template and
 * modifies only explicitly dynamic fields via direct XML editing.
 */

import JSZip from "jszip";
import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import type {
  BusinessUnitScorecard,
  ScorecardKpiKey,
  MonthlyKpiPresentation,
  MonthlyKpiValue,
} from "./types";

const NS = {
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
};

const TEMPLATE_FILENAME = "Scorecard Status.pptx";

const TABLE_METRICS: ScorecardKpiKey[] = [
  "pmCompliance",
  "budgetSpend",
  "pmCmWorkOrderRatio",
  "pmCmCostRatio",
  "mttrDays",
  "facilityUptime",
];

const TABLE_METRIC_LABELS: Record<ScorecardKpiKey, string> = {
  pmCompliance: "PM Compliance",
  budgetSpend: "Budget Spend",
  pmCmWorkOrderRatio: "PM:CM Ratio(# of WO's)",
  pmCmCostRatio: "PM:CM Ratio(Cost)",
  mttrDays: "MTTR*(days)",
  facilityUptime: "Facility Uptime",
};

const MONTH_LABELS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

function resolveTemplatePath(): string {
  const templatePath = path.resolve(
    fileURLToPath(import.meta.url),
    "..",
    "templates",
    TEMPLATE_FILENAME
  );
  if (fs.existsSync(templatePath)) return templatePath;
  throw new Error(
    `[MONTHLY KPI TEMPLATE] Template not found at ${templatePath}. ` +
      `Ensure the build copies src/modules/monthly-kpi/templates to dist/templates.`
  );
}

function getShapeName(shape: XmlElement): string {
  const cNvPr = shape.getElementsByTagName("p:cNvPr")[0];
  return cNvPr?.getAttribute("name") ?? "";
}

function findShapeByName(doc: XmlDocument, name: string): XmlElement | null {
  const shapes = doc.getElementsByTagName("p:sp");
  for (let i = 0; i < shapes.length; i++) {
    if (getShapeName(shapes[i]) === name) return shapes[i];
  }
  return null;
}

function findGraphicFrameByName(
  doc: XmlDocument,
  name: string
): XmlElement | null {
  const frames = doc.getElementsByTagName("p:graphicFrame");
  for (let i = 0; i < frames.length; i++) {
    if (getShapeName(frames[i]) === name) return frames[i];
  }
  return null;
}

function setTextInParagraph(p: XmlElement, text: string): void {
  const ownerDoc = p.ownerDocument;
  if (!ownerDoc) return;

  const liveRuns = p.getElementsByTagName("a:r");
  const runs: XmlElement[] = [];
  for (let i = 0; i < liveRuns.length; i++) {
    runs.push(liveRuns[i]);
  }

  let firstRun: XmlElement | null = null;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (i === 0) {
      firstRun = run;
      const textNodes = run.getElementsByTagName("a:t");
      while (textNodes.length > 0) {
        run.removeChild(textNodes[0]);
      }
    } else {
      p.removeChild(run);
    }
  }

  if (firstRun) {
    const t = ownerDoc.createElementNS(NS.a, "a:t");
    t.textContent = text;
    firstRun.appendChild(t);
  } else {
    const run = ownerDoc.createElementNS(NS.a, "a:r");
    const t = ownerDoc.createElementNS(NS.a, "a:t");
    t.textContent = text;
    run.appendChild(t);
    p.insertBefore(run, p.firstChild);
  }
}

function setShapeText(shape: XmlElement, text: string): void {
  const txBody = shape.getElementsByTagName("p:txBody")[0];
  if (!txBody) {
    throw new Error(`Shape "${getShapeName(shape)}" has no txBody.`);
  }
  const paragraphs = txBody.getElementsByTagName("a:p");
  if (paragraphs.length === 0) return;
  setTextInParagraph(paragraphs[0], text);
  while (paragraphs.length > 1) {
    txBody.removeChild(paragraphs[1]);
  }
}

function setCellText(cell: XmlElement, text: string): void {
  const txBody = cell.getElementsByTagName("a:txBody")[0];
  if (!txBody) return;
  const paragraphs = txBody.getElementsByTagName("a:p");
  for (let i = 0; i < paragraphs.length; i++) {
    setTextInParagraph(paragraphs[i], text);
  }
}

function getTableRows(frame: XmlElement): XmlElement[] {
  const tbl = frame.getElementsByTagName("a:tbl")[0];
  if (!tbl) return [];
  const rows = tbl.getElementsByTagName("a:tr");
  const result: XmlElement[] = [];
  for (let i = 0; i < rows.length; i++) {
    result.push(rows[i]);
  }
  return result;
}

function getCells(row: XmlElement): XmlElement[] {
  const cells = row.getElementsByTagName("a:tc");
  const result: XmlElement[] = [];
  for (let i = 0; i < cells.length; i++) {
    result.push(cells[i]);
  }
  return result;
}

function getCellText(cell: XmlElement): string {
  const txBody = cell.getElementsByTagName("a:txBody")[0];
  if (!txBody) return "";
  const paragraphs = txBody.getElementsByTagName("a:p");
  const parts: string[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const ts = paragraphs[i].getElementsByTagName("a:t");
    for (let j = 0; j < ts.length; j++) {
      parts.push(ts[j].textContent ?? "");
    }
  }
  return parts.join("");
}

function formatMonthlyValue(key: ScorecardKpiKey, value: MonthlyKpiValue): string {
  if (!isPresentNumber(value.value)) return "";
  if (key === "mttrDays") return value.value.toFixed(2);
  if (key === "pmCmWorkOrderRatio" || key === "pmCmCostRatio") {
    const pct = value.value.toFixed(1);
    if (value.value >= 100) return `${pct}% (No CM)`;
    const cmShare = 100 - value.value;
    if (cmShare <= 0) return `${pct}% (No CM)`;
    return `${pct}% (${(value.value / cmShare).toFixed(1)}:1)`;
  }
  return `${value.value.toFixed(2)}%`;
}

function isPresentNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function updateSlide1(doc: XmlDocument, data: MonthlyKpiPresentation): void {
  const titleShape = findShapeByName(doc, "Slide Title");
  if (titleShape) {
    setShapeText(
      titleShape,
      `Monthly Reliability KPI Scorecard, ${data.selectedBusinessUnit === "All Business Units" ? "East Zone" : data.selectedBusinessUnit}`
    );
  }

  const selectedBu =
    data.buScorecards.find((bu) => bu.businessUnit === data.selectedBusinessUnit) ??
    data.buScorecards[0];

  const tableFrame = findGraphicFrameByName(doc, "AMD-EZ Monthly KPI Scorecard");
  if (!tableFrame) {
    throw new Error('[TEMPLATE] Required frame "AMD-EZ Monthly KPI Scorecard" not found on slide 1.');
  }
  const rows = getTableRows(tableFrame);
  if (rows.length < 10) {
    throw new Error(`[TEMPLATE] Expected 10 rows on slide 1 table, found ${rows.length}.`);
  }

  // Header
  const headerCells = getCells(rows[0]);
  if (headerCells.length >= 7) {
    setCellText(headerCells[0], "Month");
    for (let i = 0; i < TABLE_METRICS.length; i++) {
      setCellText(headerCells[i + 1], TABLE_METRIC_LABELS[TABLE_METRICS[i]]);
    }
  }

  // Monthly rows Jan-Jul (rows 1-7)
  // Slide 1 shows up to 7 monthly rows before YTD/target
  for (let i = 0; i < 7; i++) {
    const row = rows[i + 1];
    const cells = getCells(row);
    const trend = selectedBu.monthlyTrend[i];
    if (!trend) {
      // clear unused monthly rows
      if (cells.length > 0) setCellText(cells[0], "");
      for (let j = 1; j < cells.length; j++) setCellText(cells[j], "");
      continue;
    }
    setCellText(cells[0], MONTH_LABELS_SHORT[trend.month - 1] ?? trend.monthLabel);
    for (let m = 0; m < TABLE_METRICS.length; m++) {
      setCellText(cells[m + 1], formatMonthlyValue(TABLE_METRICS[m], trend.values[TABLE_METRICS[m]]));
    }
  }

  // YTD row
  const ytdRow = rows[8];
  const ytdCells = getCells(ytdRow);
  setCellText(ytdCells[0], "YTD");
  for (let m = 0; m < TABLE_METRICS.length; m++) {
    setCellText(ytdCells[m + 1], formatMonthlyValue(TABLE_METRICS[m], selectedBu.ytd[TABLE_METRICS[m]]));
  }

  // TARGET row - keep static, ensure correct text
  const targetRow = rows[9];
  const targetCells = getCells(targetRow);
  if (getCellText(targetCells[0]) !== "TARGET") {
    setCellText(targetCells[0], "TARGET");
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
    setShapeText(subtitleShape, `KPI Scorecard – All BUs | ${data.reportingMonthLabel}`);
  }

  const tableFrame = findGraphicFrameByName(doc, "All Business Units KPI Scorecard");
  if (!tableFrame) {
    throw new Error('[TEMPLATE] Required frame "All Business Units KPI Scorecard" not found on slide 2.');
  }
  const rows = getTableRows(tableFrame);
  if (rows.length < 10) {
    throw new Error(`[TEMPLATE] Expected 10 rows on slide 2 table, found ${rows.length}.`);
  }

  // Header
  const headerCells = getCells(rows[0]);
  if (headerCells.length >= 7) {
    setCellText(headerCells[0], "Business Unit");
    for (let i = 0; i < TABLE_METRICS.length; i++) {
      setCellText(headerCells[i + 1], TABLE_METRIC_LABELS[TABLE_METRICS[i]]);
    }
  }

  // BU rows 1-7
  for (let i = 0; i < TEMPLATE_BU_COLUMNS.length; i++) {
    const row = rows[i + 1];
    const cells = getCells(row);
    const buName = TEMPLATE_BU_COLUMNS[i];
    const bu = data.buScorecards.find((b) => b.businessUnit === buName);
    setCellText(cells[0], buName);
    for (let m = 0; m < TABLE_METRICS.length; m++) {
      const key = TABLE_METRICS[m];
      const value = bu?.ytd[key] ?? { value: null, status: "no-data", formatted: "No Data" };
      setCellText(cells[m + 1], value.formatted);
    }
  }

  // YTD (ALL BUs) row
  const portfolioRow = rows[8];
  const portfolioCells = getCells(portfolioRow);
  setCellText(portfolioCells[0], "YTD (ALL BUs)");
  for (let m = 0; m < TABLE_METRICS.length; m++) {
    setCellText(portfolioCells[m + 1], data.portfolioYtd[TABLE_METRICS[m]].formatted);
  }

  // TARGET row
  const targetRow = rows[9];
  const targetCells = getCells(targetRow);
  if (getCellText(targetCells[0]) !== "TARGET") {
    setCellText(targetCells[0], "TARGET");
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

function buildIssueCellText(bu: BusinessUnitScorecard | undefined, key: ScorecardKpiKey): string {
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
    setShapeText(titleShape, "Three actions must be completed before the next review");
  }
  const subtitleShape = findShapeByName(doc, "Issues Subtitle");
  if (subtitleShape) {
    setShapeText(subtitleShape, `Maintenance KPI issues matrix | ${data.reportingMonthLabel}`);
  }

  const tableFrame = findGraphicFrameByName(doc, "Executive KPI Issues Matrix");
  if (!tableFrame) {
    throw new Error('[TEMPLATE] Required frame "Executive KPI Issues Matrix" not found on slide 3.');
  }
  const rows = getTableRows(tableFrame);
  if (rows.length < 7) {
    throw new Error(`[TEMPLATE] Expected 7 rows on slide 3 table, found ${rows.length}.`);
  }

  // Header
  const headerCells = getCells(rows[0]);
  if (headerCells.length >= 8) {
    setCellText(headerCells[0], "KPI");
    for (let i = 0; i < TEMPLATE_BU_COLUMNS.length; i++) {
      setCellText(headerCells[i + 1], TEMPLATE_BU_COLUMNS[i]);
    }
  }

  const issueMetricLabels: Record<ScorecardKpiKey, string> = {
    pmCompliance: "PM Compliance",
    budgetSpend: "Budget Spend",
    pmCmWorkOrderRatio: "PM:CM Ratio(WO)",
    pmCmCostRatio: "PM:CM Ratio(Cost)",
    facilityUptime: "Facility Uptime",
    mttrDays: "MTTR",
  };

  // Rows 1-6
  for (let i = 0; i < TABLE_METRICS.length; i++) {
    const key = TABLE_METRICS[i];
    const row = rows[i + 1];
    const cells = getCells(row);
    setCellText(cells[0], issueMetricLabels[key]);
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
      setShapeText(shape, actions[i] ?? "Continue monthly KPI monitoring and validation.");
    }
  }
}

export async function generateMonthlyKpiPresentation(
  data: MonthlyKpiPresentation
): Promise<Blob> {
  const templatePath = resolveTemplatePath();
  const templateBuffer = fs.readFileSync(templatePath);
  const zip = await JSZip.loadAsync(templateBuffer);

  const slideFiles: Array<{
    name: string;
    updater: (doc: XmlDocument, data: MonthlyKpiPresentation) => void;
  }> = [
    { name: "ppt/slides/slide1.xml", updater: updateSlide1 },
    { name: "ppt/slides/slide2.xml", updater: updateSlide2 },
    { name: "ppt/slides/slide3.xml", updater: updateSlide3 },
  ];

  for (const { name, updater } of slideFiles) {
    const xml = await zip.file(name)?.async("string");
    if (!xml) throw new Error(`[TEMPLATE] Missing slide XML: ${name}`);

    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "text/xml");
    if (!doc.documentElement) {
      throw new Error(`[TEMPLATE] Failed to parse ${name}`);
    }

    updater(doc, data);

    const serializer = new XMLSerializer();
    zip.file(name, serializer.serializeToString(doc));
  }

  const output = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
  return output;
}
