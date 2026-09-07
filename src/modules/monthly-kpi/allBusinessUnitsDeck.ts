/**
 * Monthly KPI — All Business Units deck (server-only).
 *
 * Programmatic pptxgenjs deck produced when the Presentation Center generates
 * the Monthly KPI Executive Scorecard for ALL BUSINESS UNITS:
 *
 *   Slide 1: cover (All Business Units, effective reporting period)
 *   For each BU in authoritative order:
 *     Slide 2N:  KPI Summary - BU name, effective period, KPI table
 *                (Group A cumulative, Group B YTD average) and commentary
 *                bullets sourced ONLY from that BU's Notes + Situation.
 *     Slide 2N+1: KPI Trends - six native charts (2x3 grid) for the six KPIs
 *                stopping at the effective reporting month.
 *
 * The existing template-based single-BU executive deck is untouched.
 */

import type { AllBusinessUnitsDeckData, BusinessUnitDeckSection, ScorecardKpiKey2 } from "./allBusinessUnitsData";
import { CHART_LABELS } from "./allBusinessUnitsData";

// pptxgenjs ships as a CommonJS module; be defensive about the default export
// shape across bundlers.
import pptxgenjs from "pptxgenjs";
const PptxGenJS =
  typeof pptxgenjs === "function"
    ? pptxgenjs
    : (pptxgenjs as unknown as { default: typeof pptxgenjs }).default;

type Pptx = InstanceType<typeof pptxgenjs>;
type Slide = ReturnType<Pptx["addSlide"]>;

const COLORS = {
  navy: "0B1D44",
  blue: "005BAC",
  cyan: "00A8D2",
  green: "0A9B6E",
  amber: "D97706",
  red: "DC2626",
  gray: "64748B",
  border: "D6DFE8",
  white: "FFFFFF",
  text: "1E293B",
};

const FONTS = {
  heading: "Arial",
  body: "Calibri",
};

function formatPeriodLabel(month: number, year: number): string {
  const names = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  return `${names[month - 1] ?? ""} ${year}`.trim();
}

function headerBand(slide: Slide, left: string, right: string) {
  slide.addShape("rect", { x: 0, y: 0, w: 10, h: 0.9, fill: { color: COLORS.navy } });
  slide.addText(left, {
    x: 0.5, y: 0.16, w: 7.5, h: 0.55,
    fontSize: 20, bold: true, color: COLORS.white, fontFace: FONTS.heading,
  });
  slide.addText(right, {
    x: 7.6, y: 0.3, w: 2.1, h: 0.4,
    fontSize: 11, color: "D9E6F2", fontFace: FONTS.body, align: "right",
  });
}

function buildCoverSlide(pptx: Pptx, data: AllBusinessUnitsDeckData) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };
  slide.addShape("rect", { x: 0, y: 0, w: 10, h: 1.9, fill: { color: COLORS.navy } });
  slide.addText("Monthly KPI Scorecard — All Business Units", {
    x: 0.5, y: 0.45, w: 9, h: 0.75,
    fontSize: 26, bold: true, color: COLORS.white, fontFace: FONTS.heading,
  });
  slide.addText(`Effective reporting period: ${data.effectiveReportingMonthLabel}`, {
    x: 0.5, y: 1.25, w: 9, h: 0.4,
    fontSize: 14, color: "D9E6F2", fontFace: FONTS.body,
  });
  slide.addText(
    `Reporting year ${data.reportingYear} · ${data.sections.length} business unit(s) · ` +
      "values use the live Monthly KPI scorecard semantics",
    { x: 0.5, y: 3.1, w: 9, h: 0.9, fontSize: 13, color: COLORS.gray, fontFace: FONTS.body }
  );
  slide.addText("Prepared from the Monthly KPI Scorecard", {
    x: 0.5, y: 4.4, w: 9, h: 0.5, fontSize: 12, color: COLORS.gray, fontFace: FONTS.body,
  });
}

type Cell = { text: string; options?: Record<string, unknown> };

function headerCell(text: string): Cell {
  return { text, options: { bold: true, color: COLORS.white, fill: { color: COLORS.navy }, align: "center" as const } };
}

function bodyCell(text: string, bold = false, align: "left" | "center" = "left"): Cell {
  return { text, options: { bold, color: bold ? COLORS.navy : COLORS.text, align } };
}

function summaryTableRows(section: BusinessUnitDeckSection): Cell[][] {
  const rows: Cell[][] = [
    [
      headerCell("KPI"),
      headerCell("Value"),
      headerCell("Benchmark"),
    ],
  ];
  for (const row of section.summary) {
    rows.push([
      bodyCell(row.label, true),
      bodyCell(row.formatted, false, "center"),
      bodyCell(row.benchmark, false, "center"),
    ]);
  }
  return rows;
}

function commentaryBullets(section: BusinessUnitDeckSection): string[] {
  const bullets: string[] = [];
  if (section.notes) {
    for (const part of section.notes.split(/\r?\n+/)) {
      const text = part.trim();
      if (text) bullets.push(text);
    }
  }
  const seen = new Set(bullets.map((value) => value.toLowerCase()));
  for (const situation of section.situationBullets) {
    const text = situation.trim();
    const key = text.toLowerCase();
    if (text && !seen.has(key)) {
      seen.add(key);
      bullets.push(text);
    }
  }
  return bullets;
}

function buildSummarySlide(pptx: Pptx, section: BusinessUnitDeckSection) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };
  headerBand(
    slide,
    `${section.businessUnit} — Monthly KPI Scorecard`,
    `KPI Summary · ${section.reportingMonthLabel}`
  );

  const rows = summaryTableRows(section);
  slide.addTable(rows, {
    x: 0.5, y: 1.15, w: 9,
    fontSize: 12,
    fontFace: FONTS.body,
    border: { type: "solid", color: COLORS.border, pt: 0.5 },
    valign: "middle",
    colW: [4.6, 2.2, 2.2],
    autoPage: false,
    rowH: 0.42,
  });

  const bullets = commentaryBullets(section);
  const bulletTop = 1.15 + rows.length * 0.42 + 0.28;
  slide.addText("Commentary — Notes & Situation", {
    x: 0.5, y: bulletTop, w: 9, h: 0.35,
    fontSize: 13, bold: true, color: COLORS.navy, fontFace: FONTS.heading,
  });
  if (bullets.length === 0) {
    slide.addText("No commentary was recorded for this reporting period.", {
      x: 0.5, y: bulletTop + 0.42, w: 9, h: 0.4,
      fontSize: 12, italic: true, color: COLORS.gray, fontFace: FONTS.body,
    });
  } else {
    slide.addText(
      bullets.slice(0, 9).map((text) => ({ text, options: { bullet: true } })),
      {
        x: 0.5, y: bulletTop + 0.42, w: 9, h: 2.7,
        fontSize: 12, color: COLORS.text, fontFace: FONTS.body, valign: "top",
      }
    );
  }
}

type ChartSeries = {
  name: string;
  values: number[];
  color: string;
};

function addLineChart(
  pptx: Pptx,
  slide: Slide,
  title: string,
  categories: string[],
  series: ChartSeries[],
  x: number,
  y: number,
  w: number,
  h: number
) {
  const chartData = series.map((entry) => ({
    name: entry.name,
    labels: categories,
    values: entry.values,
  }));
  // Title rendered as text above the chart area for crisp readability.
  slide.addText(title, {
    x, y: y - 0.26, w, h: 0.24,
    fontSize: 11, bold: true, color: COLORS.navy, fontFace: FONTS.heading,
  });
  const ChartType = (pptx as unknown as { ChartType?: { line: unknown } }).ChartType;
  const chartType = (ChartType && ChartType.line) || "line";
  slide.addChart(chartType as never, chartData as never, {
    x, y, w, h,
    showLegend: series.length > 1,
    legendPos: "b",
    legendFontSize: 8,
    catAxisLabelFontSize: 8,
    catAxisLabelColor: COLORS.gray,
    valAxisLabelFontSize: 8,
    valAxisLabelColor: COLORS.gray,
    lineSize: 1.75,
    lineDataSymbol: "circle",
    lineDataSymbolSize: 5,
    chartColors: series.map((entry) => entry.color),
    chartArea: { fill: { color: COLORS.white } },
    plotArea: { fill: { color: COLORS.white } },
  });
}

function groupASeries(pointKey: keyof BusinessUnitDeckSection["trends"][number], name: string, section: BusinessUnitDeckSection): ChartSeries {
  return {
    name,
    values: section.trends.map((point) => {
      const value = point[pointKey];
      return value === null || value === undefined ? Number.NaN : (value as number);
    }),
    color: COLORS.blue,
  };
}

function groupBSeries(
  monthlyKey: keyof BusinessUnitDeckSection["trends"][number],
  ytdKey: keyof BusinessUnitDeckSection["trends"][number],
  section: BusinessUnitDeckSection
): ChartSeries[] {
  const toValues = (key: keyof BusinessUnitDeckSection["trends"][number]) =>
    section.trends.map((point) => {
      const value = point[key];
      return value === null || value === undefined ? Number.NaN : (value as number);
    });
  return [
    { name: "Monthly Actual", values: toValues(monthlyKey), color: COLORS.cyan },
    { name: "YTD Average", values: toValues(ytdKey), color: COLORS.blue },
  ];
}

function buildTrendsSlide(pptx: Pptx, section: BusinessUnitDeckSection) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };
  headerBand(
    slide,
    `${section.businessUnit} — Monthly KPI Scorecard`,
    `KPI Trends · ${section.reportingMonthLabel}`
  );

  const categories = section.trends.map((point) => point.monthLabel);
  if (categories.length === 0) {
    slide.addText("No trend data available for the effective reporting period.", {
      x: 0.5, y: 2.2, w: 9, h: 0.6,
      fontSize: 14, italic: true, color: COLORS.gray, fontFace: FONTS.body,
    });
    return;
  }

  const chartWidth = 4.6;
  const chartHeight = 1.34;
  const gapX = 0.3;
  const gapY = 0.16;
  const originX = 0.35;
  const originY = 1.3;
  const positions: Record<ScorecardKpiKey2, { x: number; y: number }> = {
    pmCompliance: { x: originX, y: originY },
    budgetSpend: { x: originX + chartWidth + gapX, y: originY },
    pmCmWorkOrderRatio: { x: originX, y: originY + chartHeight + gapY },
    pmCmCostRatio: { x: originX + chartWidth + gapX, y: originY + chartHeight + gapY },
    mttrDays: { x: originX, y: originY + (chartHeight + gapY) * 2 },
    facilityUptime: { x: originX + chartWidth + gapX, y: originY + (chartHeight + gapY) * 2 },
  };

  const seriesByKey: Record<ScorecardKpiKey2, ChartSeries[]> = {
    pmCompliance: groupBSeries("pmComplianceMonthly", "pmComplianceYtdAverage", section),
    budgetSpend: [groupASeries("budgetSpend", "YTD / Cumulative", section)],
    pmCmWorkOrderRatio: [groupASeries("pmCmWorkOrderRatio", "YTD / Cumulative", section)],
    pmCmCostRatio: [groupASeries("pmCmCostRatio", "YTD / Cumulative", section)],
    mttrDays: [groupASeries("mttrDays", "YTD / Cumulative", section)],
    facilityUptime: groupBSeries("facilityUptimeMonthly", "facilityUptimeYtdAverage", section),
  };

  const chartOrder: ScorecardKpiKey2[] = [
    "pmCompliance",
    "budgetSpend",
    "pmCmWorkOrderRatio",
    "pmCmCostRatio",
    "mttrDays",
    "facilityUptime",
  ];

  for (const key of chartOrder) {
    const pos = positions[key];
    addLineChart(pptx, slide, CHART_LABELS[key], categories, seriesByKey[key], pos.x, pos.y, chartWidth, chartHeight);
  }
}

export async function generateAllBusinessUnitsMonthlyKpiDeck(
  data: AllBusinessUnitsDeckData
): Promise<Blob> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = "ODM Dashboard";
  pptx.company = "Program Oversight Center";
  pptx.title = `Monthly KPI Scorecard — All Business Units — ${data.effectiveReportingMonthLabel}`;

  buildCoverSlide(pptx, data);
  for (const section of data.sections) {
    buildSummarySlide(pptx, section);
    buildTrendsSlide(pptx, section);
  }

  const output = (await pptx.write({ outputType: "nodebuffer" } as never)) as Uint8Array;
  const arrayBuffer = output.buffer.slice(
    output.byteOffset,
    output.byteOffset + output.byteLength
  ) as ArrayBuffer;
  return new Blob([arrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}

export { formatPeriodLabel, commentaryBullets };
