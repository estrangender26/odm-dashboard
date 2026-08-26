/**
 * Governance V3 Executive generator.
 *
 * Replaces text and tables inside the committed GovernanceExecutive.pptx
 * template using the shared Executive Presentation Framework.
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
  setShapeParagraphText,
  setShapeText,
  type XmlDocument,
} from "../framework";
import type { GovernanceV3Presentation } from "../../governance-v3/types";
import { renderMilestoneSymbols } from "./governance/milestoneRail";
import {
  PHASE_WINDOWS,
  addMonths,
  getShapeOff,
  miniXForMonthOffset,
  monthDiff,
  setShapeOff,
  setShapeWidth,
  timelineXForDate,
} from "./governance/slideLayout";

const TEMPLATE_FILENAME = "GovernanceExecutive.pptx";
const FACILITY_ORDER = ["aglipay", "htt", "eastbay", "kaysakat"];

/** Shape-name prefixes used by the template for per-facility markers. */
const FACILITY_SHAPE_PREFIX: Record<string, string> = {
  aglipay: "AGLIPAY STP",
  htt: "HTT STP",
  eastbay: "EASTBAY PH-2 TP",
  kaysakat: "KAYSAKAT TP",
};

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

/**
 * Move each facility's red TODAY marker on the Slide 1 mini phase bar to the
 * position implied by the reporting date relative to that facility's actual
 * PPP start date. The marker is 76200 EMU wide (dot) with a 19050 EMU line
 * centered on the same x.
 */
function updateSlide1TodayMarkers(doc: XmlDocument, data: GovernanceV3Presentation): void {
  const { facilities, reportingDate } = data;
  for (const facility of facilities) {
    const prefix = FACILITY_SHAPE_PREFIX[facility.slug];
    if (!prefix) continue;
    const dot = findShapeByName(doc, `${prefix} Today Marker Dot`);
    const line = findShapeByName(doc, `${prefix} Today Marker Line`);
    if (!dot && !line) continue;
    const offset = monthDiff(facility.pppStartDate, reportingDate);
    const x = miniXForMonthOffset(offset);
    if (dot) setShapeOff(dot, x - 38100, getShapeOff(dot).y);
    if (line) setShapeOff(line, x - 9525, getShapeOff(line).y);
  }
}

/**
 * Reposition a Slide 2 phase segment between two ISO dates on the calendar
 * timeline, preserving its row y and height.
 */
function positionSegment(
  shape: NonNullable<ReturnType<typeof findShapeByName>>,
  fromIso: string,
  toIso: string
): void {
  const x1 = timelineXForDate(fromIso);
  const x2 = timelineXForDate(toIso);
  setShapeOff(shape, x1, getShapeOff(shape).y);
  setShapeWidth(shape, Math.max(0, x2 - x1));
}

/**
 * Make the Slide 2 timeline fully data-driven:
 * - each facility's three phase segments are sized from its actual PPP start
 *   date using the approved windows (PRE-PPP = start−8mo..start, PPP =
 *   start..start+12mo, POST-PPP = start+12mo..start+20mo);
 * - the PPP START line and the TODAY dot are placed from the real dates;
 * - the prominent TODAY line is placed from the reporting date.
 */
function updateSlide2Timeline(doc: XmlDocument, data: GovernanceV3Presentation): void {
  const { facilities, reportingDate } = data;
  const todayX = timelineXForDate(reportingDate);

  const prominentLine = findShapeByName(doc, "Prominent Today Line");
  if (prominentLine) {
    setShapeOff(prominentLine, todayX - 19050, getShapeOff(prominentLine).y);
  }

  for (const facility of facilities) {
    const prefix = FACILITY_SHAPE_PREFIX[facility.slug];
    if (!prefix) continue;

    const start = facility.pppStartDate;
    const preStart = addMonths(start, -PHASE_WINDOWS.preMonths);
    const pppEnd = addMonths(start, PHASE_WINDOWS.pppMonths);
    const postEnd = addMonths(start, PHASE_WINDOWS.postMonths);

    const seg1 = findShapeByName(doc, `${prefix} Phase Segment 1`);
    const seg2 = findShapeByName(doc, `${prefix} Phase Segment 2`);
    const seg3 = findShapeByName(doc, `${prefix} Phase Segment 3`);
    const startLine = findShapeByName(doc, `${prefix} PPP Start Line`);
    const todayDot = findShapeByName(doc, `${prefix} Today Dot`);

    if (seg1) positionSegment(seg1, preStart, start);
    if (seg2) positionSegment(seg2, start, pppEnd);
    if (seg3) positionSegment(seg3, pppEnd, postEnd);
    if (startLine) setShapeOff(startLine, timelineXForDate(start), getShapeOff(startLine).y);
    if (todayDot) setShapeOff(todayDot, todayX - 85725, getShapeOff(todayDot).y);
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
      setShapeText(detailShape, `PPP START  ${formatDateUpper(facility.pppStartDate)}`);
    if (observationShape)
      setShapeText(observationShape, facility.executiveObservation);
  }

  const actionShape = findShapeByName(doc, "Action Text");
  if (!actionShape) {
    throw new Error('[TEMPLATE] Required shape "Action Text" not found on slide 1.');
  }
  setShapeText(actionShape, executive.nextGateAction);

  // Data-driven milestone symbols and TODAY markers.
  renderMilestoneSymbols(doc, facilities);
  updateSlide1TodayMarkers(doc, data);
}

function updateSlide2(doc: XmlDocument, data: GovernanceV3Presentation): void {
  const { facilities, executive, reportingDate } = data;
  const reportingDateLong = formatDateLong(reportingDate);

  const subtitleShape = findShapeByName(doc, "Phase Slide Subtitle");
  if (!subtitleShape) {
    throw new Error(
      '[TEMPLATE] Required shape "Phase Slide Subtitle" not found on slide 2.'
    );
  }
  setShapeText(subtitleShape, `Calendar-based phase timeline | ${reportingDateLong}`);

  const todayShape = findShapeByName(doc, "Prominent Today Label");
  if (!todayShape) {
    throw new Error(
      '[TEMPLATE] Required shape "Prominent Today Label" not found on slide 2.'
    );
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
    throw new Error(
      '[TEMPLATE] Required shape "Phase Decision Text" not found on slide 2.'
    );
  }
  setShapeText(gateShape, executive.gateImplication);

  // Data-driven phase segments, PPP START lines, and TODAY markers.
  updateSlide2Timeline(doc, data);
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
    throw new Error(
      '[TEMPLATE] Required shape "GOV_SLIDE_SUBTITLE" not found on slide 3.'
    );
  }
  setShapeText(subtitleShape, executive.documentationSubtitle);

  const sourceShape = findShapeByName(doc, "GOV_FOOTER_SOURCE");
  if (!sourceShape) {
    throw new Error(
      '[TEMPLATE] Required shape "GOV_FOOTER_SOURCE" not found on slide 3.'
    );
  }
  setShapeText(
    sourceShape,
    `Sources: O&M Manual Governance module • ${reportingDateLong}`
  );

  const portfolioShape = findShapeByName(doc, "DELIVERABLES_TOTAL_PANEL");
  if (!portfolioShape) {
    throw new Error(
      '[TEMPLATE] Required shape "DELIVERABLES_TOTAL_PANEL" not found on slide 3.'
    );
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
    throw new Error(
      '[TEMPLATE] Required shape "DELIVERABLES_EXECUTIVE_NOTE" not found on slide 3.'
    );
  }
  setShapeText(observationShape, executive.portfolioObservation);

  const tableFrame = findGraphicFrameByName(doc, "DELIVERABLES_CROSSTAB_MATRIX");
  if (!tableFrame) {
    throw new Error(
      '[TEMPLATE] Required graphic frame "DELIVERABLES_CROSSTAB_MATRIX" not found on slide 3.'
    );
  }

  const rows = getTableRows(tableFrame);
  if (rows.length < 17) {
    throw new Error(`[TEMPLATE] Expected 17 table rows, found ${rows.length}.`);
  }

  for (let tocIndex = 0; tocIndex < 14; tocIndex++) {
    const row = rows[tocIndex + 1];
    const cells = getCells(row);
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
      setCellText(cells[facilityIndex + 1], submitted ? "✓" : "—");
    }
  }

  const totalsRow = rows[15];
  const totalsCells = getCells(totalsRow);
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
  const complianceCells = getCells(complianceRow);
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
  const templatePath = resolveExecutiveTemplatePath(TEMPLATE_FILENAME);
  const zip = await loadPptxTemplate(templatePath);

  const slideFiles: Array<{
    name: string;
    updater: (doc: XmlDocument, data: GovernanceV3Presentation) => void;
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
