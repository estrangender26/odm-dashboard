/**
 * Governance V3 Template-Based Presentation Generator
 *
 * Uses a committed reference PPTX as an immutable production template and
 * modifies only explicitly dynamic fields via direct XML editing.
 *
 * This preserves the approved Manila Water visual design, slide masters,
 * layouts, themes, shape coordinates, and formatting exactly.
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
import type { GovernanceV3Presentation } from "./types";

const NS = {
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
};

const TEMPLATE_FILENAME = "Onboarding Status.pptx";

const FACILITY_ORDER = ["aglipay", "htt", "eastbay", "kaysakat"];

function resolveTemplatePath(): string {
  const templatePath = path.resolve(
    fileURLToPath(import.meta.url),
    "..",
    "templates",
    TEMPLATE_FILENAME
  );
  if (fs.existsSync(templatePath)) return templatePath;
  throw new Error(
    `[GOVERNANCE V3 TEMPLATE] Template not found at ${templatePath}. ` +
      `Ensure the build copies src/modules/governance-v3/templates to dist/templates.`
  );
}
function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDateUpper(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d
    .toLocaleDateString("en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
    .toUpperCase();
}

function formatMonthYearUpper(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d
    .toLocaleDateString("en-US", { month: "short", year: "numeric" })
    .toUpperCase();
}

function formatTodayLabel(dateStr: string): string {
  return `TODAY • ${formatDateUpper(dateStr)}`;
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
  // Replace only the first paragraph and remove extra paragraphs so multi-
  // paragraph placeholder text (e.g. executive note) is not duplicated.
  setTextInParagraph(paragraphs[0], text);
  while (paragraphs.length > 1) {
    txBody.removeChild(paragraphs[1]);
  }
}

function setShapeParagraphText(
  shape: XmlElement,
  paragraphIndex: number,
  text: string
): void {
  const txBody = shape.getElementsByTagName("p:txBody")[0];
  if (!txBody) {
    throw new Error(`Shape "${getShapeName(shape)}" has no txBody.`);
  }
  const paragraphs = txBody.getElementsByTagName("a:p");
  if (paragraphIndex >= paragraphs.length) return;
  setTextInParagraph(paragraphs[paragraphIndex], text);
}

function setCellText(cell: XmlElement, text: string): void {
  const txBody = cell.getElementsByTagName("a:txBody")[0];
  if (!txBody) return;
  const paragraphs = txBody.getElementsByTagName("a:p");
  for (let i = 0; i < paragraphs.length; i++) {
    setTextInParagraph(paragraphs[i], text);
  }
}

function updateSlide1(doc: XmlDocument, data: GovernanceV3Presentation): void {
  const { facilities, executive, reportingDate } = data;
  const reportingDateLong = formatDateLong(reportingDate);

  const titleShape = findShapeByName(doc, "Slide Title");
  if (!titleShape) {
    throw new Error('[TEMPLATE] Required shape "Slide Title" not found on slide 1.');
  }
  setShapeText(titleShape, executive.headline);

  const subtitleShape = findShapeByName(doc, "Subtitle");
  if (!subtitleShape) {
    throw new Error('[TEMPLATE] Required shape "Subtitle" not found on slide 1.');
  }
  setShapeText(
    subtitleShape,
    `Milestone progress versus the sequence planned from each facility's PPP start date | Red marker = TODAY, ${reportingDateLong}`
  );

  const facilityConfig = [
    {
      slug: "aglipay",
      nameShape: "AGLIPAY STP Name",
      phaseShape: "AGLIPAY STP Phase",
      detailShape: "AGLIPAY STP Phase Detail",
      observationShape: "AGLIPAY STP Comparison",
    },
    {
      slug: "htt",
      nameShape: "HTT STP Name",
      phaseShape: "HTT STP Phase",
      detailShape: "HTT STP Phase Detail",
      observationShape: "HTT STP Comparison",
    },
    {
      slug: "eastbay",
      nameShape: "EASTBAY PH-2 TP Name",
      phaseShape: "EASTBAY PH-2 TP Phase",
      detailShape: "EASTBAY PH-2 TP Phase Detail",
      observationShape: "EASTBAY PH-2 TP Comparison",
    },
    {
      slug: "kaysakat",
      nameShape: "KAYSAKAT TP Name",
      phaseShape: "KAYSAKAT TP Phase",
      detailShape: "KAYSAKAT TP Phase Detail",
      observationShape: "KAYSAKAT TP Comparison",
    },
  ];

  for (const cfg of facilityConfig) {
    const facility = facilities.find((f) => f.slug === cfg.slug);
    if (!facility) continue;

    const nameShape = findShapeByName(doc, cfg.nameShape);
    const phaseShape = findShapeByName(doc, cfg.phaseShape);
    const detailShape = findShapeByName(doc, cfg.detailShape);
    const observationShape = findShapeByName(doc, cfg.observationShape);

    if (nameShape) setShapeText(nameShape, facility.shortName.toUpperCase());
    if (phaseShape) setShapeText(phaseShape, facility.phaseStatus);
    if (detailShape)
      setShapeText(
        detailShape,
        `PPP START  ${formatDateUpper(facility.pppStartDate)}`
      );
    if (observationShape)
      setShapeText(observationShape, facility.executiveObservation);
  }

  const actionShape = findShapeByName(doc, "Action Text");
  if (!actionShape) {
    throw new Error('[TEMPLATE] Required shape "Action Text" not found on slide 1.');
  }
  setShapeText(actionShape, executive.nextGateAction);
}

function updateSlide2(doc: XmlDocument, data: GovernanceV3Presentation): void {
  const { facilities, executive, reportingDate } = data;
  const reportingDateLong = formatDateLong(reportingDate);

  const subtitleShape = findShapeByName(doc, "Phase Slide Subtitle");
  if (!subtitleShape) {
    throw new Error('[TEMPLATE] Required shape "Phase Slide Subtitle" not found on slide 2.');
  }
  setShapeText(subtitleShape, `Calendar-based phase timeline | ${reportingDateLong}`);

  const todayShape = findShapeByName(doc, "Prominent Today Label");
  if (!todayShape) {
    throw new Error('[TEMPLATE] Required shape "Prominent Today Label" not found on slide 2.');
  }
  setShapeText(todayShape, formatTodayLabel(reportingDate));

  const facilityConfig = [
    {
      slug: "aglipay",
      nameShape: "AGLIPAY STP Timeline Name",
      phaseShape: "AGLIPAY STP Current Phase",
      startShape: "AGLIPAY STP PPP Start Label",
    },
    {
      slug: "htt",
      nameShape: "HTT STP Timeline Name",
      phaseShape: "HTT STP Current Phase",
      startShape: "HTT STP PPP Start Label",
    },
    {
      slug: "eastbay",
      nameShape: "EASTBAY PH-2 TP Timeline Name",
      phaseShape: "EASTBAY PH-2 TP Current Phase",
      startShape: "EASTBAY PH-2 TP PPP Start Label",
    },
    {
      slug: "kaysakat",
      nameShape: "KAYSAKAT TP Timeline Name",
      phaseShape: "KAYSAKAT TP Current Phase",
      startShape: "KAYSAKAT TP PPP Start Label",
    },
  ];

  for (const cfg of facilityConfig) {
    const facility = facilities.find((f) => f.slug === cfg.slug);
    if (!facility) continue;

    const nameShape = findShapeByName(doc, cfg.nameShape);
    const phaseShape = findShapeByName(doc, cfg.phaseShape);
    const startShape = findShapeByName(doc, cfg.startShape);

    if (nameShape) setShapeText(nameShape, facility.shortName.toUpperCase());
    if (phaseShape)
      setShapeText(phaseShape, `TODAY: ${facility.phaseStatus}`);
    if (startShape)
      setShapeText(
        startShape,
        `PPP START • ${formatMonthYearUpper(facility.pppStartDate)}`
      );
  }

  const gateShape = findShapeByName(doc, "Phase Decision Text");
  if (!gateShape) {
    throw new Error('[TEMPLATE] Required shape "Phase Decision Text" not found on slide 2.');
  }
  setShapeText(gateShape, executive.gateImplication);
}

function facilityPanelLabel(facilityShortName: string): string {
  return facilityShortName
    .replace(" Sewage Treatment Plant", " STP")
    .replace(" Treatment Plant", " TP")
    .replace(" Phase 2", " PH-2")
    .toUpperCase();
}

function updateSlide3(doc: XmlDocument, data: GovernanceV3Presentation): void {
  const {
    facilities,
    facilityDocumentation,
    summary,
    executive,
    reportingDate,
  } = data;
  const reportingDateLong = formatDateLong(reportingDate);

  const titleShape = findShapeByName(doc, "GOV_SLIDE_TITLE");
  if (!titleShape) {
    throw new Error('[TEMPLATE] Required shape "GOV_SLIDE_TITLE" not found on slide 3.');
  }
  setShapeText(titleShape, executive.documentationHeadline);

  const subtitleShape = findShapeByName(doc, "GOV_SLIDE_SUBTITLE");
  if (!subtitleShape) {
    throw new Error('[TEMPLATE] Required shape "GOV_SLIDE_SUBTITLE" not found on slide 3.');
  }
  setShapeText(subtitleShape, executive.documentationSubtitle);

  const sourceShape = findShapeByName(doc, "GOV_FOOTER_SOURCE");
  if (!sourceShape) {
    throw new Error('[TEMPLATE] Required shape "GOV_FOOTER_SOURCE" not found on slide 3.');
  }
  setShapeText(
    sourceShape,
    `Sources: O&M Manual Governance module • ${reportingDateLong}`
  );

  const portfolioShape = findShapeByName(doc, "DELIVERABLES_TOTAL_PANEL");
  if (!portfolioShape) {
    throw new Error('[TEMPLATE] Required shape "DELIVERABLES_TOTAL_PANEL" not found on slide 3.');
  }
  setShapeParagraphText(portfolioShape, 0, "PORTFOLIO");
  setShapeParagraphText(
    portfolioShape,
    1,
    `${summary.totalDocumentsSubmitted} / ${summary.totalDocumentsRequired}  •  ${summary.portfolioCompliancePercent}%`
  );

  const panelConfig = [
    { slug: "aglipay", shapeName: "COMP_AGLIPAY" },
    { slug: "htt", shapeName: "COMP_HTT" },
    { slug: "eastbay", shapeName: "COMP_EASTBAY" },
    { slug: "kaysakat", shapeName: "COMP_KAYSAKAT" },
  ];

  for (const cfg of panelConfig) {
    const docItem = facilityDocumentation.find(
      (d) => d.facilitySlug === cfg.slug
    );
    const facility = facilities.find((f) => f.slug === cfg.slug);
    if (!docItem || !facility) continue;

    const shape = findShapeByName(doc, cfg.shapeName);
    if (!shape) continue;
    const label = facilityPanelLabel(facility.shortName);
    setShapeParagraphText(shape, 0, label);
    setShapeParagraphText(
      shape,
      1,
      `${docItem.submittedCount} / ${docItem.requiredCount}  •  ${docItem.compliancePercent}%`
    );
  }

  const observationShape = findShapeByName(doc, "DELIVERABLES_EXECUTIVE_NOTE");
  if (!observationShape) {
    throw new Error('[TEMPLATE] Required shape "DELIVERABLES_EXECUTIVE_NOTE" not found on slide 3.');
  }
  setShapeText(observationShape, executive.portfolioObservation);

  const tableFrame = findGraphicFrameByName(doc, "DELIVERABLES_CROSSTAB_MATRIX");
  if (!tableFrame) {
    throw new Error('[TEMPLATE] Required graphic frame "DELIVERABLES_CROSSTAB_MATRIX" not found on slide 3.');
  }

  const tbl = tableFrame.getElementsByTagName("a:tbl")[0];
  if (!tbl) {
    throw new Error('[TEMPLATE] Table not found inside DELIVERABLES_CROSSTAB_MATRIX.');
  }

  const rows = tbl.getElementsByTagName("a:tr");
  if (rows.length < 17) {
    throw new Error(`[TEMPLATE] Expected 17 table rows, found ${rows.length}.`);
  }

  for (let tocIndex = 0; tocIndex < 14; tocIndex++) {
    const row = rows[tocIndex + 1];
    const cells = row.getElementsByTagName("a:tc");
    if (cells.length < 5) {
      throw new Error(
        `[TEMPLATE] TOC row ${tocIndex + 1} has ${cells.length} cells, expected 5.`
      );
    }

    const tocId = (tocIndex + 1).toString();
    for (let facilityIndex = 0; facilityIndex < 4; facilityIndex++) {
      const slug = FACILITY_ORDER[facilityIndex];
      const docItem = facilityDocumentation.find((d) => d.facilitySlug === slug);
      const submission = docItem?.submissions.find((s) => s.tocId === tocId);
      const submitted = submission?.submitted ?? false;
      setCellText(
        cells[facilityIndex + 1],
        submitted ? "✓" : "—"
      );
    }
  }

  const totalsRow = rows[15];
  const totalsCells = totalsRow.getElementsByTagName("a:tc");
  if (totalsCells.length < 5) {
    throw new Error(
      `[TEMPLATE] Totals row has ${totalsCells.length} cells, expected 5.`
    );
  }
  setCellText(totalsCells[0], "Submitted / Required");
  for (let i = 0; i < 4; i++) {
    const slug = FACILITY_ORDER[i];
    const docItem = facilityDocumentation.find((d) => d.facilitySlug === slug);
    if (!docItem) continue;
    setCellText(
      totalsCells[i + 1],
      `${docItem.submittedCount} / ${docItem.requiredCount}`
    );
  }

  const complianceRow = rows[16];
  const complianceCells = complianceRow.getElementsByTagName("a:tc");
  if (complianceCells.length < 5) {
    throw new Error(
      `[TEMPLATE] Compliance row has ${complianceCells.length} cells, expected 5.`
    );
  }
  setCellText(complianceCells[0], "Compliance");
  for (let i = 0; i < 4; i++) {
    const slug = FACILITY_ORDER[i];
    const docItem = facilityDocumentation.find((d) => d.facilitySlug === slug);
    if (!docItem) continue;
    setCellText(complianceCells[i + 1], `${docItem.compliancePercent}%`);
  }
}

export async function generateGovernanceV3Presentation(
  data: GovernanceV3Presentation
): Promise<Blob> {
  const templatePath = resolveTemplatePath();
  const templateBuffer = fs.readFileSync(templatePath);
  const zip = await JSZip.loadAsync(templateBuffer);

  const slideFiles: Array<{
    name: string;
    updater: (doc: XmlDocument, data: GovernanceV3Presentation) => void;
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
    const updatedXml = serializer.serializeToString(doc);
    zip.file(name, updatedXml);
  }

  const output = await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return new Blob([output as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}
