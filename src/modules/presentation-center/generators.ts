import { blobToDataUrl } from "./storage";
import type {
  DeckGenerationContext,
  DeckGenerator,
  GeneratedPresentation,
} from "./types";
import { createPresentation } from "./pptxBuilder";
import {
  createMonthlyKpiTemplatePresentation,
  loadMonthlyKpiTemplate,
  type MonthlyKpiTemplateSlide,
  type MonthlyKpiTemplateStatus,
} from "./monthlyKpiTemplate";
import {
  MONTHLY_KPI_DECK_DESIGN,
  MONTHLY_KPI_DECK_SOURCE_LABEL,
} from "./monthlyKpiDeckDesign";
import {
  generateOperatorDrivenMaintenanceDeck,
  OPERATOR_DRIVEN_MAINTENANCE_SOURCE_LABEL,
} from "./odmGenerator";
import {
  generateGovernancePresentation,
} from "./governanceGenerator";
import {
  generateGovernanceV3Presentation,
} from "@/modules/governance-v3/generator";
import {
  ALL_BUSINESS_UNITS_LABEL,
  EXECUTIVE_SCORECARD_TEMPLATE,
  getPersistedMonthlyKpiScorecard,
  getScorecardSummary,
  MONTH_NAMES,
  type KpiRecord,
  type MonthlyKpiScorecardDataset,
} from "./scorecardData";

type PresentationSlide = Parameters<typeof createPresentation>[0][number];
type PresentationElement = PresentationSlide["elements"][number];
type ShapeElement = Extract<PresentationElement, { type: "shape" }>;
type TableElement = Extract<PresentationElement, { type: "table" }>;

export const MONTHLY_KPI_NOTES_FALLBACK =
  "No commentary was recorded for the selected reporting period.";

export { MONTHLY_KPI_DECK_DESIGN, MONTHLY_KPI_DECK_SOURCE_LABEL };

const DESIGN = MONTHLY_KPI_DECK_DESIGN;
const COLORS = DESIGN.colors;
const MIN_DECK_FONT_SIZE = DESIGN.typography.min;

type KpiMetric =
  | "pmCompliance"
  | "budgetSpend"
  | "pmCmWorkOrderRatio"
  | "pmCmCostRatio"
  | "mttrDays"
  | "facilityUptime";

type KpiStatus = "success" | "warning" | "danger" | "no-data";

const kpiColumns: Array<{
  key: KpiMetric;
  label: string;
  benchmark: string;
}> = [
  { key: "pmCompliance", label: "PM Compliance", benchmark: "95%" },
  {
    key: "budgetSpend",
    label: "Budget Spend",
    benchmark: "95.00% – 105.00%",
  },
  {
    key: "pmCmWorkOrderRatio",
    label: "PM:CM Ratio (WO)",
    benchmark: "≥86% (6:1)",
  },
  {
    key: "pmCmCostRatio",
    label: "PM:CM Ratio (Cost)",
    benchmark: "≥60% (1.5:1)",
  },
  { key: "mttrDays", label: "MTTR", benchmark: "Decreasing Trend" },
  { key: "facilityUptime", label: "Facility Uptime", benchmark: "=100%" },
];

const matrixBusinessUnitOrder = [
  ALL_BUSINESS_UNITS_LABEL,
  "AMD-EZ",
  "Laguna Water",
  "Clark Water",
  "Tagum Water",
  "Estate Water",
  "LARC",
];

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function isPresentNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function requireMonthlyKpiContext(context: DeckGenerationContext) {
  const reportingYear = Number(context.reportingYear);
  const reportingMonth = Number(context.reportingMonth);
  if (!Number.isInteger(reportingYear) || !Number.isInteger(reportingMonth)) {
    throw new Error(
      "Select a valid reporting year and month before generating."
    );
  }
  return {
    reportingYear,
    reportingMonth,
    businessUnit: context.businessUnit,
    template:
      context.template === EXECUTIVE_SCORECARD_TEMPLATE
        ? context.template
        : EXECUTIVE_SCORECARD_TEMPLATE,
  };
}

function formatPercent(value: number | null | undefined, digits = 2) {
  return isPresentNumber(value) ? `${value.toFixed(digits)}%` : "No Data";
}

function formatPmCmEquivalentRatio(value: number | null | undefined) {
  if (!isPresentNumber(value)) return "No Data";
  if (value >= 100) return "No CM";
  const cmShare = 100 - value;
  if (cmShare <= 0) return "No CM";
  return `${(value / cmShare).toFixed(1)}:1`;
}

function formatMetricValue(
  metric: KpiMetric,
  value: number | null | undefined
) {
  if (!isPresentNumber(value)) return "No Data";
  if (metric === "mttrDays") return `${value.toFixed(2)} days`;
  if (metric === "pmCmWorkOrderRatio" || metric === "pmCmCostRatio") {
    return `${formatPercent(value)} (${formatPmCmEquivalentRatio(value)})`;
  }
  return formatPercent(value);
}

function formatCardValue(metric: KpiMetric, value: number | null | undefined) {
  if (!isPresentNumber(value)) return "No Data";
  if (metric === "mttrDays") return value.toFixed(2);
  return `${value.toFixed(2)}%`;
}

function getKpiStatus(
  metric: KpiMetric,
  value: number | null | undefined
): KpiStatus {
  if (!isPresentNumber(value)) return "no-data";
  if (metric === "pmCompliance") {
    if (value >= 95) return "success";
    if (value >= 90) return "warning";
    return "danger";
  }
  if (metric === "budgetSpend") {
    if (value >= 95 && value <= 105) return "success";
    if ((value >= 90 && value < 95) || (value > 105 && value <= 110)) {
      return "warning";
    }
    return "danger";
  }
  if (metric === "pmCmWorkOrderRatio") {
    if (value >= 86) return "success";
    if (value >= 75) return "warning";
    return "danger";
  }
  if (metric === "pmCmCostRatio") {
    if (value >= 60) return "success";
    if (value >= 50) return "warning";
    return "danger";
  }
  if (metric === "facilityUptime") {
    if (value >= 99.97) return "success";
    if (value >= 99) return "warning";
    return "danger";
  }
  return "success";
}

function statusFill(status: KpiStatus) {
  if (status === "success") return COLORS.success;
  if (status === "warning") return COLORS.warning;
  if (status === "danger") return COLORS.danger;
  return COLORS.noData;
}

function statusTextColor(status: KpiStatus) {
  return status === "warning" || status === "no-data"
    ? COLORS.text
    : COLORS.white;
}

function templateMetricStatuses(record: KpiRecord) {
  return kpiColumns.map(column =>
    getKpiStatus(column.key, record[column.key])
  ) as MonthlyKpiTemplateStatus[];
}

function averageMetric(records: KpiRecord[], metric: KpiMetric) {
  const values = records
    .map(record => record[metric])
    .filter((value): value is number => isPresentNumber(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function aggregateRecords(
  records: KpiRecord[],
  businessUnit = ALL_BUSINESS_UNITS_LABEL
): KpiRecord {
  return {
    businessUnit,
    reportingMonth: records[0]?.reportingMonth,
    reportingYear: records[0]?.reportingYear,
    pmCompliance: averageMetric(records, "pmCompliance"),
    budgetSpend: averageMetric(records, "budgetSpend"),
    pmCmWorkOrderRatio: averageMetric(records, "pmCmWorkOrderRatio"),
    pmCmCostRatio: averageMetric(records, "pmCmCostRatio"),
    mttrDays: averageMetric(records, "mttrDays"),
    facilityUptime: averageMetric(records, "facilityUptime"),
    notes: null,
    majorWins: records.flatMap(record => record.majorWins),
    majorRisks: records.flatMap(record => record.majorRisks),
    actionItems: records.flatMap(record => record.actionItems),
  };
}

function emptyRecord(
  businessUnit: string,
  reportingMonth: number,
  reportingYear: number
): KpiRecord {
  return {
    businessUnit,
    reportingMonth,
    reportingYear,
    pmCompliance: null,
    budgetSpend: null,
    pmCmWorkOrderRatio: null,
    pmCmCostRatio: null,
    mttrDays: null,
    facilityUptime: null,
    notes: null,
    majorWins: [],
    majorRisks: [],
    actionItems: [],
  };
}

function recordsForMonth(records: KpiRecord[], month: number) {
  return records.filter(record => Number(record.reportingMonth) === month);
}

function monthName(month: number) {
  return MONTH_NAMES[month - 1] || `Month ${month}`;
}

function footer(dataset: MonthlyKpiScorecardDataset): PresentationElement[] {
  const text = `${dataset.reportingMonthLabel} | ${dataset.businessUnit} | ${MONTHLY_KPI_DECK_SOURCE_LABEL}`;
  return [
    {
      type: "shape",
      x: 0,
      y: DESIGN.margins.footerTop,
      w: DESIGN.slide.width,
      h: DESIGN.margins.footerHeight,
      fill: DESIGN.footer.fill,
      line: DESIGN.footer.fill,
    },
    {
      type: "text",
      text,
      x: DESIGN.margins.x,
      y: DESIGN.margins.footerTop + 0.07,
      w: 12.25,
      h: 0.28,
      fontSize: DESIGN.typography.footer,
      fontFace: DESIGN.fonts.body,
      color: DESIGN.footer.color,
      align: "r",
    },
  ];
}

function slideTitle(title: string, subtitle?: string): PresentationElement[] {
  return [
    {
      type: "shape",
      x: 0,
      y: 0,
      w: DESIGN.slide.width,
      h: 0.16,
      fill: COLORS.navy,
      line: COLORS.navy,
    },
    {
      type: "shape",
      x: 0,
      y: 0.16,
      w: DESIGN.slide.width,
      h: 0.05,
      fill: COLORS.accentBlue,
      line: COLORS.accentBlue,
    },
    {
      type: "text",
      text: title,
      x: DESIGN.margins.x,
      y: 0.34,
      w: 8.8,
      h: 0.46,
      fontSize: DESIGN.typography.slideTitle,
      fontFace: DESIGN.fonts.title,
      bold: true,
      color: COLORS.accentBlue,
    },
    ...(subtitle
      ? [
          {
            type: "text" as const,
            text: subtitle,
            x: DESIGN.margins.x,
            y: 0.86,
            w: 9.3,
            h: 0.36,
            fontSize: DESIGN.typography.subtitle,
            fontFace: DESIGN.fonts.body,
            color: COLORS.mutedText,
          },
        ]
      : []),
  ];
}

function limitBullets(items: string[], fallback: string) {
  const filtered = items.filter(Boolean);
  const displayItems = filtered.length ? filtered : [fallback];
  if (displayItems.length <= 4) return displayItems;
  return [...displayItems.slice(0, 3), `+${displayItems.length - 3} more`];
}

function bulletText(items: string[]) {
  return items.map(item => `• ${item}`).join("\n");
}

function cardShape(
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  line = DESIGN.cards.border
): ShapeElement {
  return { type: "shape", x, y, w, h, fill, line };
}

function summaryCard(
  title: string,
  bullets: string[],
  fill: string,
  x: number
): PresentationElement[] {
  return [
    cardShape(x, 1.35, 3.85, 4.75, DESIGN.cards.fill),
    {
      type: "shape",
      x,
      y: 1.35,
      w: 3.85,
      h: 0.56,
      fill,
      line: fill,
    },
    {
      type: "text",
      text: title,
      x: x + 0.2,
      y: 1.48,
      w: 3.45,
      h: 0.38,
      fontSize: DESIGN.typography.sectionHeading,
      fontFace: DESIGN.fonts.heading,
      bold: true,
      color: COLORS.white,
    },
    {
      type: "text",
      text: bulletText(bullets),
      x: x + 0.2,
      y: 2.08,
      w: 3.45,
      h: 3.55,
      fontSize: DESIGN.typography.body,
      fontFace: DESIGN.fonts.body,
      color: COLORS.text,
    },
  ];
}

function metricValues(record: KpiRecord) {
  return kpiColumns.map(column =>
    formatMetricValue(column.key, record[column.key])
  );
}

export function buildMonthlyKpiTableRows(records: KpiRecord[]) {
  return [
    ["Business Unit", ...kpiColumns.map(column => column.label)],
    ...records.map(record => [record.businessUnit, ...metricValues(record)]),
  ];
}

function styledMetricTable(
  rows: string[][],
  records: KpiRecord[],
  x: number,
  y: number,
  w: number,
  h: number,
  firstColumnLabel = true
): TableElement {
  const cellFills = rows.map((row, rowIndex) =>
    row.map((_, colIndex) => {
      if (rowIndex === 0) return DESIGN.table.headerFill;
      if (colIndex === 0) return DESIGN.table.firstColumnFill;
      const metric = kpiColumns[colIndex - 1]?.key;
      if (!metric) return COLORS.white;
      return statusFill(getKpiStatus(metric, records[rowIndex - 1]?.[metric]));
    })
  );
  const cellColors = rows.map((row, rowIndex) =>
    row.map((_, colIndex) => {
      if (rowIndex === 0) return COLORS.white;
      if (colIndex === 0) return COLORS.text;
      const metric = kpiColumns[colIndex - 1]?.key;
      if (!metric) return COLORS.text;
      return statusTextColor(
        getKpiStatus(metric, records[rowIndex - 1]?.[metric])
      );
    })
  );
  const cellBold = rows.map((row, rowIndex) =>
    row.map(
      (_, colIndex) => rowIndex === 0 || (firstColumnLabel && colIndex === 0)
    )
  );
  const headerHeight = 0.44;
  const bodyRowHeight =
    rows.length > 1
      ? Math.max(0.52, (h - headerHeight) / (rows.length - 1))
      : h;
  return {
    type: "table",
    rows,
    cellFills,
    cellColors,
    cellBold,
    x,
    y,
    w,
    h,
    fontSize: DESIGN.typography.body,
    fontFace: DESIGN.fonts.body,
    rowHeights:
      rows.length > 1
        ? [
            headerHeight,
            ...Array.from({ length: rows.length - 1 }, () => bodyRowHeight),
          ]
        : [h],
  };
}

export function buildYtdScorecardRows(
  dataset: MonthlyKpiScorecardDataset,
  months = Array.from(
    { length: dataset.reportingMonth },
    (_, index) => index + 1
  )
) {
  const ytdRecords = dataset.ytdRecords?.length
    ? dataset.ytdRecords
    : dataset.records;
  const records = months.map(month => {
    const monthRecords = recordsForMonth(ytdRecords, month);
    return monthRecords.length
      ? aggregateRecords(monthRecords, monthName(month))
      : emptyRecord(monthName(month), month, dataset.reportingYear);
  });
  return {
    records,
    rows: [
      ["Month", ...kpiColumns.map(column => column.label)],
      ...records.map(record => [record.businessUnit, ...metricValues(record)]),
    ],
  };
}

function buildYtdScorecardSlides(dataset: MonthlyKpiScorecardDataset) {
  const monthNumbers = Array.from(
    { length: dataset.reportingMonth },
    (_, index) => index + 1
  );
  const chunks =
    monthNumbers.length > 6
      ? [monthNumbers.slice(0, 6), monthNumbers.slice(6)]
      : [monthNumbers];
  return chunks.map(months => {
    const first = monthName(months[0]);
    const last = monthName(months[months.length - 1]);
    const { rows, records } = buildYtdScorecardRows(dataset, months);
    return {
      elements: [
        ...slideTitle(
          "Year-to-Date Scorecard",
          `${first} to ${last} ${dataset.reportingYear}`
        ),
        {
          ...styledMetricTable(rows, records, 0.45, 1.35, 12.45, 4.95),
          colWidths: [1.55, 1.75, 1.7, 1.95, 1.95, 1.65, 1.9],
        },
        ...footer(dataset),
      ],
    };
  });
}

function recordsForYtdAverageMatrix(dataset: MonthlyKpiScorecardDataset) {
  const records = dataset.ytdRecords?.length
    ? dataset.ytdRecords
    : dataset.records;
  return records.filter(record => {
    const month = Number(record.reportingMonth);
    return (
      Number(record.reportingYear) === dataset.reportingYear &&
      month >= 1 &&
      month <= dataset.reportingMonth
    );
  });
}

function buildBusinessUnitYtdAverage(
  businessUnit: string,
  records: KpiRecord[],
  dataset: MonthlyKpiScorecardDataset
) {
  const unitRecords = records.filter(
    record => record.businessUnit === businessUnit
  );
  return unitRecords.length
    ? aggregateRecords(unitRecords, businessUnit)
    : emptyRecord(businessUnit, dataset.reportingMonth, dataset.reportingYear);
}

export function buildYtdAverageMatrixRows(dataset: MonthlyKpiScorecardDataset) {
  const ytdRecords = recordsForYtdAverageMatrix(dataset);
  const businessUnitAverages = matrixBusinessUnitOrder
    .slice(1)
    .map(businessUnit =>
      buildBusinessUnitYtdAverage(businessUnit, ytdRecords, dataset)
    );
  const portfolioAverage = aggregateRecords(
    businessUnitAverages,
    ALL_BUSINESS_UNITS_LABEL
  );
  const matrixRecords = [portfolioAverage, ...businessUnitAverages];
  return {
    records: matrixRecords,
    rows: buildMonthlyKpiTableRows(matrixRecords),
  };
}

export function buildPortfolioKpiCards(records: KpiRecord[]) {
  const portfolio = aggregateRecords(records, ALL_BUSINESS_UNITS_LABEL);
  return kpiColumns.map(column => ({
    ...column,
    value: portfolio[column.key],
    displayValue: formatCardValue(column.key, portfolio[column.key]),
    ratioSubtitle:
      column.key === "pmCmWorkOrderRatio" || column.key === "pmCmCostRatio"
        ? formatPmCmEquivalentRatio(portfolio[column.key])
        : column.key === "mttrDays" && isPresentNumber(portfolio.mttrDays)
          ? "Days"
          : "",
    status: getKpiStatus(column.key, portfolio[column.key]),
  }));
}

function buildPortfolioCardElements(
  records: KpiRecord[]
): PresentationElement[] {
  const cards = buildPortfolioKpiCards(records);
  return cards.flatMap((card, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = 0.58 + col * 4.22;
    const y = 1.36 + row * 2.54;
    const w = 3.9;
    const h = 2.14;
    const fill = statusFill(card.status);
    return [
      cardShape(x, y, w, h, DESIGN.cards.fill),
      {
        type: "shape",
        x,
        y,
        w: 0.12,
        h,
        fill,
        line: fill,
      } as ShapeElement,
      {
        type: "shape",
        x: x + 0.12,
        y,
        w: w - 0.12,
        h: 0.44,
        fill: COLORS.navy,
        line: COLORS.navy,
      } as ShapeElement,
      {
        type: "text",
        text: card.label,
        x: x + 0.28,
        y: y + 0.1,
        w: w - 0.48,
        h: 0.34,
        fontSize: DESIGN.typography.cardTitle,
        fontFace: DESIGN.fonts.heading,
        bold: true,
        color: COLORS.white,
      },
      {
        type: "text",
        text: card.displayValue,
        x: x + 0.28,
        y: y + 0.66,
        w: w - 0.5,
        h: 0.5,
        fontSize: DESIGN.typography.kpiValue,
        fontFace: DESIGN.fonts.numeric,
        bold: true,
        color: fill,
      },
      {
        type: "text",
        text: `Benchmark: ${card.benchmark}`,
        x: x + 0.28,
        y: y + 1.2,
        w: w - 0.5,
        h: 0.34,
        fontSize: DESIGN.typography.body,
        fontFace: DESIGN.fonts.body,
        color: COLORS.text,
      },
      ...(card.ratioSubtitle
        ? [
            {
              type: "text" as const,
              text: card.ratioSubtitle,
              x: x + 0.28,
              y: y + 1.58,
              w: w - 0.5,
              h: 0.32,
              fontSize: DESIGN.typography.body,
              fontFace: DESIGN.fonts.body,
              color: COLORS.mutedText,
            },
          ]
        : []),
    ];
  });
}

function chartElementForMetric(
  records: KpiRecord[],
  metric: "pmCompliance" | "facilityUptime",
  title: string,
  x: number
): PresentationElement {
  const rows = records.filter(record => isPresentNumber(record[metric]));
  if (!rows.length) {
    return {
      type: "text",
      text: `${title}\nNo chartable values were recorded for this metric.`,
      x,
      y: 1.45,
      w: 5.9,
      h: 4.6,
      fontSize: DESIGN.typography.body,
      fontFace: DESIGN.fonts.body,
      color: COLORS.noDataText,
      fill: DESIGN.cards.alternateFill,
    };
  }
  return {
    type: "bars",
    title,
    labels: rows.map(record => record.businessUnit),
    values: rows.map(record => record[metric] as number),
    colors: rows.map(record =>
      statusFill(getKpiStatus(metric, record[metric]))
    ),
    x,
    y: 1.35,
    w: 5.9,
    h: 4.9,
    max: 100,
  };
}

export function buildMonthlyKpiNotesText(records: KpiRecord[]) {
  const notes = records
    .map(record => ({
      businessUnit: record.businessUnit,
      note: record.notes ?? "",
    }))
    .filter(record => record.note.trim());
  if (!notes.length) return MONTHLY_KPI_NOTES_FALLBACK;
  return notes
    .map(record => `${record.businessUnit}\n${record.note}`)
    .join("\n\n");
}

function buildNotesElements(records: KpiRecord[]): PresentationElement[] {
  const notes = records
    .map(record => ({
      businessUnit: record.businessUnit,
      note: record.notes ?? "",
    }))
    .filter(record => record.note.trim());
  if (!notes.length) {
    return [
      cardShape(0.75, 1.55, 11.75, 1.2, DESIGN.cards.alternateFill),
      {
        type: "text",
        text: MONTHLY_KPI_NOTES_FALLBACK,
        x: 0.95,
        y: 1.9,
        w: 11.35,
        h: 0.4,
        fontSize: DESIGN.typography.subtitle,
        fontFace: DESIGN.fonts.body,
        color: COLORS.noDataText,
      },
    ];
  }
  const visible = notes.slice(0, 3);
  const elements = visible.flatMap((note, index) => {
    const y = 1.35 + index * 1.55;
    return [
      cardShape(0.75, y, 11.75, 1.32, DESIGN.cards.fill),
      {
        type: "shape",
        x: 0.75,
        y,
        w: 0.13,
        h: 1.32,
        fill: COLORS.accentBlue,
        line: COLORS.accentBlue,
      },
      {
        type: "text",
        text: note.businessUnit,
        x: 0.98,
        y: y + 0.16,
        w: 2.8,
        h: 0.32,
        fontSize: DESIGN.typography.cardTitle,
        fontFace: DESIGN.fonts.heading,
        bold: true,
        color: COLORS.accentBlue,
      },
      {
        type: "text",
        text: note.note,
        x: 3.75,
        y: y + 0.16,
        w: 8.45,
        h: 0.94,
        fontSize: DESIGN.typography.body,
        fontFace: DESIGN.fonts.body,
        color: COLORS.text,
      },
    ] as PresentationElement[];
  });
  if (notes.length > visible.length) {
    elements.push({
      type: "text",
      text: `+${notes.length - visible.length} more notes not shown`,
      x: 0.95,
      y: 6.05,
      w: 6,
      h: 0.34,
      fontSize: DESIGN.typography.body,
      fontFace: DESIGN.fonts.body,
      bold: true,
      color: COLORS.mutedText,
    });
  }
  return elements;
}

function buildCoverSlide(
  dataset: MonthlyKpiScorecardDataset,
  generatedAt: Date
): PresentationSlide {
  return {
    elements: [
      {
        type: "shape",
        x: 0,
        y: 0,
        w: DESIGN.slide.width,
        h: 0.24,
        fill: COLORS.navy,
        line: COLORS.navy,
      },
      {
        type: "shape",
        x: 0,
        y: 0.24,
        w: DESIGN.slide.width,
        h: 0.08,
        fill: COLORS.accentBlue,
        line: COLORS.accentBlue,
      },
      {
        type: "shape",
        x: 0.75,
        y: 1.12,
        w: 0.1,
        h: 3.65,
        fill: COLORS.accentBlue,
        line: COLORS.accentBlue,
      },
      {
        type: "text",
        text: MONTHLY_KPI_DECK_SOURCE_LABEL,
        x: 0.98,
        y: 1.22,
        w: 7.65,
        h: 1.12,
        fontSize: DESIGN.typography.coverTitle,
        fontFace: DESIGN.fonts.title,
        bold: true,
        color: COLORS.navy,
      },
      {
        type: "text",
        text: "Monthly KPI Scorecard",
        x: 1,
        y: 2.42,
        w: 7.3,
        h: 0.38,
        fontSize: DESIGN.typography.sectionHeading,
        fontFace: DESIGN.fonts.body,
        color: COLORS.mutedText,
      },
      cardShape(0.98, 3.35, 2.8, 1.02, DESIGN.cards.alternateFill),
      {
        type: "text",
        text: "Reporting Period",
        x: 1.18,
        y: 3.5,
        w: 2.35,
        h: 0.26,
        fontSize: MIN_DECK_FONT_SIZE,
        fontFace: DESIGN.fonts.body,
        bold: true,
        color: COLORS.mutedText,
      },
      {
        type: "text",
        text: dataset.reportingMonthLabel,
        x: 1.18,
        y: 3.82,
        w: 2.35,
        h: 0.34,
        fontSize: 20,
        fontFace: DESIGN.fonts.heading,
        bold: true,
        color: COLORS.navy,
      },
      cardShape(4.05, 3.35, 3.35, 1.02, DESIGN.cards.alternateFill),
      {
        type: "text",
        text: "Business Unit Scope",
        x: 4.25,
        y: 3.5,
        w: 2.9,
        h: 0.26,
        fontSize: MIN_DECK_FONT_SIZE,
        fontFace: DESIGN.fonts.body,
        bold: true,
        color: COLORS.mutedText,
      },
      {
        type: "text",
        text: dataset.businessUnit,
        x: 4.25,
        y: 3.82,
        w: 2.9,
        h: 0.34,
        fontSize: 20,
        fontFace: DESIGN.fonts.heading,
        bold: true,
        color: COLORS.navy,
      },
      {
        type: "shape",
        x: 8.95,
        y: 1.22,
        w: 3.35,
        h: 3.55,
        fill: COLORS.paleBlue,
        line: COLORS.border,
      },
      {
        type: "shape",
        x: 9.3,
        y: 1.72,
        w: 2.45,
        h: 0.24,
        fill: COLORS.navy,
        line: COLORS.navy,
      },
      {
        type: "shape",
        x: 9.3,
        y: 2.44,
        w: 2.05,
        h: 0.24,
        fill: COLORS.accentBlue,
        line: COLORS.accentBlue,
      },
      {
        type: "shape",
        x: 9.3,
        y: 3.16,
        w: 2.75,
        h: 0.24,
        fill: COLORS.success,
        line: COLORS.success,
      },
      {
        type: "shape",
        x: 9.3,
        y: 3.88,
        w: 1.75,
        h: 0.24,
        fill: COLORS.warning,
        line: COLORS.warning,
      },
      {
        type: "text",
        text: `Generated from ${MONTHLY_KPI_DECK_SOURCE_LABEL}`,
        x: 0.78,
        y: 5.72,
        w: 5.9,
        h: 0.35,
        fontSize: MIN_DECK_FONT_SIZE,
        fontFace: DESIGN.fonts.body,
        color: COLORS.mutedText,
      },
      {
        type: "text",
        text: generatedAt.toLocaleString(),
        x: 7.1,
        y: 5.72,
        w: 5.2,
        h: 0.35,
        fontSize: MIN_DECK_FONT_SIZE,
        fontFace: DESIGN.fonts.body,
        color: COLORS.mutedText,
        align: "r",
      },
      ...footer(dataset),
    ],
  };
}

export function buildMonthlyKpiSlides(
  dataset: MonthlyKpiScorecardDataset,
  generatedAt = new Date()
): PresentationSlide[] {
  const scorecardRecords = dataset.records;
  const summary = getScorecardSummary(scorecardRecords);
  const ytdSlides = buildYtdScorecardSlides(dataset);
  const matrix = buildYtdAverageMatrixRows(dataset);

  return [
    buildCoverSlide(dataset, generatedAt),
    {
      elements: [
        ...slideTitle("Executive Summary", dataset.reportingMonthLabel),
        ...summaryCard(
          "Key KPI Highlights",
          limitBullets(
            summary.highlights,
            "Persisted KPI records are available for review."
          ),
          COLORS.accentBlue,
          0.65
        ),
        ...summaryCard(
          "Major Wins",
          limitBullets(
            summary.wins,
            "No major wins were recorded from the selected KPI data."
          ),
          COLORS.success,
          4.75
        ),
        ...summaryCard(
          "Major Risks",
          limitBullets(
            summary.risks,
            "No major risks were recorded from the selected KPI data."
          ),
          COLORS.danger,
          8.85
        ),
        ...footer(dataset),
      ],
    },
    ...ytdSlides,
    {
      elements: [
        ...slideTitle(
          "YTD Average KPI Matrix",
          `January–${monthName(dataset.reportingMonth)} ${dataset.reportingYear}`
        ),
        {
          ...styledMetricTable(
            matrix.rows,
            matrix.records,
            0.45,
            1.35,
            12.45,
            4.85
          ),
          colWidths: [2.3, 1.58, 1.55, 1.9, 1.9, 1.42, 1.8],
        },
        ...footer(dataset),
      ],
    },
    {
      elements: [
        ...slideTitle(
          "Portfolio Average KPI Cards",
          dataset.reportingMonthLabel
        ),
        ...buildPortfolioCardElements(scorecardRecords),
        ...footer(dataset),
      ],
    },
    {
      elements: [
        ...slideTitle("Business Unit Breakdown", dataset.reportingMonthLabel),
        cardShape(0.48, 1.28, 6.05, 5.06, DESIGN.cards.fill),
        cardShape(6.78, 1.28, 6.05, 5.06, DESIGN.cards.fill),
        chartElementForMetric(
          scorecardRecords,
          "pmCompliance",
          "PM Compliance by Business Unit",
          0.6
        ),
        chartElementForMetric(
          scorecardRecords,
          "facilityUptime",
          "Facility Uptime by Business Unit",
          6.9
        ),
        ...footer(dataset),
      ],
    },
    {
      elements: [
        ...slideTitle(
          "Notes, Issues, and Follow-up Actions",
          dataset.reportingMonthLabel
        ),
        ...buildNotesElements(scorecardRecords),
        ...footer(dataset),
      ],
    },
  ];
}

const TEMPLATE_BENCHMARK_ROW = [
  "TARGET",
  "95.00%",
  "95%–105%",
  "≥86% (6:1)",
  "≥60% (1.5:1)",
  "DOWNWARD",
  "=100%",
] as const;

const TEMPLATE_COMMENTARY_SLOTS = 5;
const TEMPLATE_COMMENTARY_MAX_CHARACTERS = 110;
const TEMPLATE_COMMENTARY_MAX_UNBROKEN_CHARACTERS = 64;

function splitCommentaryText(value: string) {
  const chunks: string[] = [];
  for (const paragraph of value
    .split(/\r?\n+/)
    .map(part => part.trim())
    .filter(Boolean)) {
    const tokens = paragraph.match(/\S+/g) ?? [];
    let line = "";
    const appendLine = () => {
      if (line) chunks.push(line);
      line = "";
    };
    for (const token of tokens) {
      const tokenParts =
        token.length > TEMPLATE_COMMENTARY_MAX_UNBROKEN_CHARACTERS
          ? (token.match(
              new RegExp(
                `.{1,${TEMPLATE_COMMENTARY_MAX_UNBROKEN_CHARACTERS}}`,
                "g"
              )
            ) ?? [])
          : [token];
      for (const tokenPart of tokenParts) {
        const candidate = line ? `${line} ${tokenPart}` : tokenPart;
        if (candidate.length > TEMPLATE_COMMENTARY_MAX_CHARACTERS && line) {
          appendLine();
          line = tokenPart;
        } else {
          line = candidate;
        }
      }
    }
    appendLine();
  }
  return chunks.map((chunk, index) =>
    index === 0 ? chunk : `(continued) ${chunk}`
  );
}

function templateCommentaryPages(dataset: MonthlyKpiScorecardDataset) {
  const summary = getScorecardSummary(dataset.records);
  const recordedNotes = dataset.records
    .map(record => record.notes?.trim())
    .filter((note): note is string => Boolean(note));
  const candidates = [
    ...summary.highlights,
    ...summary.wins,
    ...summary.risks,
    ...recordedNotes,
    ...dataset.records.flatMap(record => record.actionItems),
  ].filter(Boolean);
  const unique = Array.from(new Set(candidates));
  const fallbacks = [
    "No additional KPI highlights were recorded for this period.",
    "No additional major wins were recorded for this period.",
    "No additional major risks were recorded for this period.",
    "No additional follow-up actions were recorded for this period.",
  ];
  const commentary = unique.length
    ? [
        ...unique,
        ...fallbacks.slice(
          0,
          Math.max(0, TEMPLATE_COMMENTARY_SLOTS - unique.length)
        ),
      ]
    : [MONTHLY_KPI_NOTES_FALLBACK, ...fallbacks];
  const wrapped = Array.from(new Set(commentary)).flatMap(splitCommentaryText);
  return Array.from(
    { length: Math.ceil(wrapped.length / TEMPLATE_COMMENTARY_SLOTS) },
    (_, index) =>
      wrapped.slice(
        index * TEMPLATE_COMMENTARY_SLOTS,
        index * TEMPLATE_COMMENTARY_SLOTS + TEMPLATE_COMMENTARY_SLOTS
      )
  );
}

function blankTemplateRow(columnCount: number) {
  return Array.from({ length: columnCount }, () => "");
}

function blankTemplateStatuses(columnCount: number) {
  return Array.from(
    { length: columnCount },
    () => "none" as MonthlyKpiTemplateStatus
  );
}

function individualTemplateSlides(
  dataset: MonthlyKpiScorecardDataset
): MonthlyKpiTemplateSlide[] {
  const header = [
    "Month",
    "PM Compliance",
    "Budget Spend",
    "PM:CM Ratio (# of WO's)",
    "PM:CM Ratio (Cost)",
    "MTTR (days)",
    "Facility Uptime",
    "Notifications",
  ];
  const sourceRecords = (
    dataset.ytdRecords?.length ? dataset.ytdRecords : dataset.records
  ).filter(record => {
    const month = Number(record.reportingMonth);
    return (
      record.businessUnit === dataset.businessUnit &&
      Number(record.reportingYear) === dataset.reportingYear &&
      month >= 1 &&
      month <= dataset.reportingMonth
    );
  });
  const monthNumbers = Array.from(
    { length: dataset.reportingMonth },
    (_, index) => index + 1
  );
  const monthChunks = Array.from(
    { length: Math.ceil(monthNumbers.length / 5) },
    (_, index) => monthNumbers.slice(index * 5, index * 5 + 5)
  );
  const ytdRecord = sourceRecords.length
    ? aggregateRecords(sourceRecords, "YTD")
    : emptyRecord("YTD", dataset.reportingMonth, dataset.reportingYear);

  const commentaryPages = templateCommentaryPages(dataset);
  const slideCount = Math.max(monthChunks.length, commentaryPages.length);

  const periodLabel = (months: number[]) => {
    if (months.length === 0) return dataset.reportingMonthLabel;
    const first = MONTH_NAMES[months[0] - 1]?.slice(0, 3) ?? `M${months[0]}`;
    const last =
      MONTH_NAMES[months[months.length - 1] - 1]?.slice(0, 3) ??
      `M${months[months.length - 1]}`;
    return months.length === 1
      ? `${first} ${dataset.reportingYear}`
      : `${first}–${last} ${dataset.reportingYear}`;
  };

  return Array.from({ length: slideCount }, (_, slideIndex) => {
    const months = monthChunks[slideIndex] ?? [];
    const monthRecords = months.map(month => {
      const records = recordsForMonth(sourceRecords, month);
      return records.length
        ? aggregateRecords(records, MONTH_NAMES[month - 1]?.slice(0, 3))
        : emptyRecord(
            MONTH_NAMES[month - 1]?.slice(0, 3) || `M${month}`,
            month,
            dataset.reportingYear
          );
    });
    const monthRows = monthRecords.map(record => [
      record.businessUnit,
      ...metricValues(record),
      "No Data",
    ]);
    const monthStatuses = monthRecords.map(record => [
      "none" as const,
      ...templateMetricStatuses(record),
      "no-data" as const,
    ]);
    while (monthRows.length < 5) {
      monthRows.push(blankTemplateRow(8));
      monthStatuses.push(blankTemplateStatuses(8));
    }
    const isCommentaryContinuation = slideIndex >= monthChunks.length;
    const pageSuffix =
      slideCount > 1 ? ` (${slideIndex + 1}/${slideCount})` : "";
    const title = isCommentaryContinuation
      ? `${dataset.businessUnit} Notes – ${dataset.reportingMonthLabel}${pageSuffix}`
      : slideCount > 1
        ? `${dataset.businessUnit} KPI – ${periodLabel(months)}${pageSuffix}`
        : `${dataset.businessUnit} KPI – ${dataset.reportingMonthLabel}`;
    const ytdRow = isCommentaryContinuation
      ? blankTemplateRow(8)
      : ["YTD", ...metricValues(ytdRecord), "No Data"];
    const ytdStatuses = isCommentaryContinuation
      ? blankTemplateStatuses(8)
      : [
          "none" as const,
          ...templateMetricStatuses(ytdRecord),
          "no-data" as const,
        ];
    return {
      sourceSlide: 1,
      title,
      tableName: "Table 2",
      rows: [
        header,
        ...monthRows,
        ytdRow,
        ["BASELINE", ...Array.from({ length: 7 }, () => "No Data")],
        [...TEMPLATE_BENCHMARK_ROW, "No Data"],
      ],
      statuses: [
        blankTemplateStatuses(8),
        ...monthStatuses,
        ytdStatuses,
        blankTemplateStatuses(8),
        blankTemplateStatuses(8),
      ],
      commentary: commentaryPages[slideIndex] ?? [
        `KPI table continued for ${periodLabel(months)}.`,
        "No additional KPI highlights were recorded for this continuation page.",
        "No additional major wins were recorded for this continuation page.",
        "No additional major risks were recorded for this continuation page.",
        "No additional follow-up actions were recorded for this continuation page.",
      ],
    };
  });
}

function portfolioTemplateSlides(
  dataset: MonthlyKpiScorecardDataset
): MonthlyKpiTemplateSlide[] {
  const header = [
    "Business Unit",
    "PM Compliance",
    "Budget Spend",
    "PM:CM Ratio (# of WO's)",
    "PM:CM Ratio (Cost)",
    "MTTR (days)",
    "Facility Uptime",
  ];
  const businessUnitOrder = new Map(
    matrixBusinessUnitOrder.slice(1).map((unit, index) => [unit, index])
  );
  const records = dataset.records
    .map((record, sourceIndex) => ({ record, sourceIndex }))
    .sort((a, b) => {
      const aOrder = businessUnitOrder.get(a.record.businessUnit);
      const bOrder = businessUnitOrder.get(b.record.businessUnit);
      if (aOrder !== undefined || bOrder !== undefined) {
        return (
          (aOrder ?? Number.MAX_VALUE) - (bOrder ?? Number.MAX_VALUE) ||
          a.sourceIndex - b.sourceIndex
        );
      }
      return a.sourceIndex - b.sourceIndex;
    })
    .map(({ record }) => record);
  const chunks = Array.from(
    { length: Math.ceil(records.length / 5) },
    (_, index) => records.slice(index * 5, index * 5 + 5)
  );
  return chunks.map((chunk, chunkIndex) => {
    const rows = chunk.map(record => [
      record.businessUnit,
      ...metricValues(record),
    ]);
    const statuses = chunk.map(record => [
      "none" as const,
      ...templateMetricStatuses(record),
    ]);
    while (rows.length < 5) {
      rows.push(blankTemplateRow(7));
      statuses.push(blankTemplateStatuses(7));
    }
    const pageSuffix =
      chunks.length > 1 ? ` (${chunkIndex + 1}/${chunks.length})` : "";
    return {
      sourceSlide: 2,
      title: `All BUs KPI Scorecard – ${dataset.reportingMonthLabel}${pageSuffix}`,
      tableName: "Table 0",
      rows: [header, ...rows, [...TEMPLATE_BENCHMARK_ROW]],
      statuses: [
        blankTemplateStatuses(7),
        ...statuses,
        blankTemplateStatuses(7),
      ],
    };
  });
}

export function buildMonthlyKpiTemplateSlides(
  dataset: MonthlyKpiScorecardDataset
) {
  return dataset.businessUnit === ALL_BUSINESS_UNITS_LABEL
    ? portfolioTemplateSlides(dataset)
    : individualTemplateSlides(dataset);
}

export async function generateMonthlyKpiDeck(
  context: DeckGenerationContext
): Promise<GeneratedPresentation> {
  const request = requireMonthlyKpiContext(context);
  const persisted = await getPersistedMonthlyKpiScorecard(
    {
      reportingYear: request.reportingYear,
      reportingMonth: request.reportingMonth,
      businessUnit: request.businessUnit,
    },
    request.template
  );
  const now = new Date();
  const title = `Monthly KPI Scorecard - ${persisted.businessUnit} - ${persisted.reportingMonthLabel}`;
  const template = await loadMonthlyKpiTemplate();
  const blob = await createMonthlyKpiTemplatePresentation(
    template,
    buildMonthlyKpiTemplateSlides(persisted)
  );
  const dataUrl = await blobToDataUrl(blob);
  const name = `${slug(title)}.pptx`;
  const generatedAt = now.toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    type: "Monthly KPI Scorecard Deck",
    generatedDate: generatedAt,
    generatedBy: context.generatedBy,
    size: blob.size,
    dataUrl,
    generatorId: "monthly-kpi-scorecard",
    generatorName: "Monthly KPI Scorecard Deck",
    reportingYear: persisted.reportingYear,
    reportingMonth: persisted.reportingMonth,
    businessUnit: persisted.businessUnit,
    template: persisted.template,
    filename: name,
    generatedAt,
  };
}


/**
 * Generate Governance V3 presentation (Manila Water template)
 */
async function generateGovernanceV3Deck(
  context: DeckGenerationContext
): Promise<GeneratedPresentation> {
  const { generatedBy } = context;
  
  // Fetch V3 data from API
  const today = new Date().toISOString().split("T")[0];
  const response = await fetch(`/api/governance/presentation-v3?reporting_date=${encodeURIComponent(today)}`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch V3 governance data: ${response.status}`);
  }
  
  const data = await response.json();
  
  if (!data || !data.facilities) {
    throw new Error("Invalid V3 governance data response");
  }
  
  // Generate the presentation
  const blob = await generateGovernanceV3Presentation(data);
  
  // Convert to data URL
  const dataUrl = await blobToDataUrl(blob);
  
  const generatedAt = new Date().toISOString();
  const name = `O&M Governance Onboarding Progress - ${data.reportingDate}.pptx`;
  
  return {
    id: `gov-v3-${Date.now()}`,
    name,
    type: "pptx",
    generatedDate: generatedAt,
    generatedBy: generatedBy || "ODM User",
    size: blob.size,
    dataUrl,
    generatorId: "om-manual-governance-v3",
    generatorName: "O&M Manual Governance V3 Deck",
    category: "O&M Manual Governance",
    dateFrom: data.reportingDate,
    filename: name,
    generatedAt,
  };
}

const placeholderGenerators: DeckGenerator[] = [
  {
    id: "om-manual-governance-v3",
    title: "O&M Manual Governance V3 Deck",
    description:
      "Generate a three-slide executive presentation matching the Manila Water template exactly. Uses live governance data.",
    category: "O&M Manual Governance",
    status: "active",
    slideOutline: [
      "Executive Dashboard with milestone matrix and status symbols",
      "Calendar-based phase timeline with PPP markers",
      "Documentation readiness matrix with compliance summary",
    ],
    enabled: true,
    generate: generateGovernanceV3Deck,
  },
  {
    id: "om-manual-library",
    title: "O&M Manual Library Deck",
    description:
      "Reserved generator for summarizing manual inventory, document coverage, version history, and library readiness across ODM facilities.",
    category: "O&M Manual Library",
    status: "coming-soon",
    slideOutline: [
      "Library overview",
      "Document coverage",
      "Revision status",
      "Missing manuals",
      "Next actions",
    ],
    enabled: false,
  },
  {
    id: "om-manual-governance",
    title: "O&M Manual Governance Onboarding Progress Deck",
    description:
      "Generate a three-slide executive presentation with live governance data. Uses proxy metrics (milestone-count).",
    category: "O&M Manual Governance",
    status: "active",
    slideOutline: [
      "Executive Dashboard with KPI cards and facility summary table",
      "S-Curve Analysis by Facility (four panels)",
      "Submission Coverage Proxy and Executive Actions",
    ],
    enabled: true,
    generate: generateGovernancePresentation,
  },
  {
    id: "post-ppp-planning",
    title: "Post-PPP Planning Deck",
    description:
      "Reserved generator for post-PPP transition insights, planning priorities, handover risks, and implementation roadmap updates.",
    category: "Post-PPP Planning",
    status: "coming-soon",
    slideOutline: [
      "Transition overview",
      "Planning priorities",
      "Handover risks",
      "Implementation roadmap",
      "Decision log",
    ],
    enabled: false,
  },
  {
    id: "maintenance-planning",
    title: "Maintenance Planning Deck",
    description:
      "Reserved generator for planned maintenance workload, resource forecasts, backlog posture, and readiness actions.",
    category: "Maintenance Planning",
    status: "coming-soon",
    slideOutline: [
      "Planning summary",
      "Workload forecast",
      "Resource needs",
      "Backlog posture",
      "Readiness actions",
    ],
    enabled: false,
  },
  {
    id: "standard-maintenance-procedures",
    title: "Standard Maintenance Procedures Deck",
    description:
      "Reserved generator for SMP coverage, procedure maturity, safety-critical steps, and standardization priorities.",
    category: "Standard Maintenance Procedures",
    status: "coming-soon",
    slideOutline: [
      "SMP coverage",
      "Procedure maturity",
      "Safety-critical steps",
      "Standardization gaps",
      "Publishing plan",
    ],
    enabled: false,
  },
  {
    id: "gantt-planner",
    title: "Gantt Planner Deck",
    description:
      "Reserved generator for schedule baselines, milestone status, critical path movement, and upcoming planning decisions.",
    category: "Gantt Planner",
    status: "coming-soon",
    slideOutline: [
      "Schedule overview",
      "Milestone status",
      "Critical path",
      "Lookahead plan",
      "Schedule risks",
    ],
    enabled: false,
  },
  {
    id: "executive-dashboard",
    title: "Executive Dashboard Deck",
    description:
      "Reserved generator for executive-level performance summaries, portfolio risks, decisions required, and leadership action items.",
    category: "Executive Dashboard",
    status: "coming-soon",
    slideOutline: [
      "Executive snapshot",
      "Portfolio performance",
      "Top risks",
      "Decisions required",
      "Leadership actions",
    ],
    enabled: false,
  },
];

export const deckGeneratorRegistry: DeckGenerator[] = [
  {
    id: "monthly-kpi-scorecard",
    title: "Monthly KPI Scorecard Deck",
    description:
      "Create a PowerPoint scorecard from persisted Monthly KPI records using the approved scorecard template.",
    category: "Monthly KPI Scorecard",
    status: "active",
    slideOutline: [
      "Template scorecard for the selected business-unit scope",
      "YTD KPI table or portfolio comparison matrix",
      "Template commentary area when available",
    ],
    enabled: true,
    generate: generateMonthlyKpiDeck,
  },
  {
    id: "operator-driven-maintenance",
    title: "Operator Driven Maintenance Deck",
    description:
      "Create an Operator-Driven Maintenance scorecard deck from persisted inspection records, findings, statuses, scores, assets, and facilities.",
    category: "Operator Driven Maintenance",
    status: "active",
    slideOutline: [
      "Cover and reporting scope",
      "Executive summary",
      "ODM KPI cards",
      "Facility breakdown",
      "Findings and risk themes",
      "Adoption and execution trend",
      "Action items and follow-up",
    ],
    enabled: true,
    generate: generateOperatorDrivenMaintenanceDeck,
  },
  ...placeholderGenerators,
];

export { OPERATOR_DRIVEN_MAINTENANCE_SOURCE_LABEL };
