import { createPresentation } from "./pptxBuilder";
import { MONTHLY_KPI_DECK_DESIGN } from "./monthlyKpiDeckDesign";
import {
  getOdmMonthDateRange,
  getPersistedOdmScorecard,
  ODM_EXECUTIVE_SUMMARY_TEMPLATE,
  OPERATOR_DRIVEN_MAINTENANCE_SOURCE_LABEL,
  type OdmScorecardDataset,
} from "./odmScorecardData";
import { blobToDataUrl } from "./storage";
import type {
  DeckGenerationContext,
  GeneratedPresentation,
  OdmTemplate,
} from "./types";
import {
  hasNegativeFindings,
  summarizeDashboardRows,
  type OdmDashboardInsight,
  type OdmDashboardRow,
  type OdmDashboardScorecard,
  type OdmDashboardSummary,
} from "../operator-driven-maintenance/dashboardSummary";

type PresentationSlide = Parameters<typeof createPresentation>[0][number];
type PresentationElement = PresentationSlide["elements"][number];
type KpiStatus = "success" | "warning" | "danger" | "no-data";

const DESIGN = MONTHLY_KPI_DECK_DESIGN;
const COLORS = DESIGN.colors;
const MIN_DECK_FONT_SIZE = DESIGN.typography.min;
const ODM_NO_FINDINGS_FALLBACK =
  "No inspection findings were recorded for the selected dashboard scope.";
const ODM_NO_ACTIONS_FALLBACK =
  "No follow-up actions were recorded for the selected dashboard scope.";
const ODM_TREND_FALLBACK =
  "No dashboard negative-finding trend was available for the selected scope.";

export { OPERATOR_DRIVEN_MAINTENANCE_SOURCE_LABEL };
export const ODM_DECK_TITLE = OPERATOR_DRIVEN_MAINTENANCE_SOURCE_LABEL;
export const ODM_DECK_TYPE = "Operator Driven Maintenance Deck";

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function text(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function numberText(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function percent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

function uniqueTexts(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map(text).filter(Boolean)));
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

function scoreStatus(value: number): KpiStatus {
  if (value >= 95) return "success";
  if (value >= 85) return "warning";
  return "danger";
}

function riskStatus(value: OdmDashboardSummary["predictiveRisk"]): KpiStatus {
  if (value === "Normal") return "success";
  if (value === "Elevated") return "warning";
  return "danger";
}

function summaryAlertStatus(
  summary: OdmDashboardSummary,
  insights: OdmDashboardInsight[]
): KpiStatus {
  if (!summary.alertCount) return "success";
  if (insights.some(insight => insight.severity === "critical")) return "danger";
  if (insights.some(insight => insight.severity === "high")) return "warning";
  return "success";
}

export function summarizeOdmRecords(records: OdmDashboardRow[]) {
  return summarizeDashboardRows(records);
}

function getScorecard(
  input: OdmScorecardDataset | OdmDashboardScorecard | OdmDashboardRow[]
) {
  if (Array.isArray(input)) {
    const summary = summarizeDashboardRows(input);
    return {
      rows: input,
      summary,
      insights: [],
      facilityBreakdown: [],
      findingThemes: [],
      trend: [],
      notes: input.filter(row => text(row.EntryNotes)),
    } as Pick<
      OdmDashboardScorecard,
      | "rows"
      | "summary"
      | "insights"
      | "facilityBreakdown"
      | "findingThemes"
      | "trend"
      | "notes"
    >;
  }
  if ("scorecard" in input) return input.scorecard;
  return input;
}

export function buildOdmKpiCards(
  input: OdmScorecardDataset | OdmDashboardScorecard | OdmDashboardRow[]
) {
  const scorecard = getScorecard(input);
  const summary = scorecard.summary;
  return [
    {
      label: "Total Inspections",
      value: numberText(summary.totalInspections),
      interpretation: "Dashboard-filtered inspection records",
      status: summary.totalInspections > 0 ? "success" : "no-data",
    },
    {
      label: "Unique Assets",
      value: numberText(summary.uniqueAssets),
      interpretation: "Distinct dashboard asset tags",
      status: summary.uniqueAssets > 0 ? "success" : "no-data",
    },
    {
      label: "Health Score",
      value: percent(summary.healthScore),
      interpretation: "Dashboard abnormality-based health calculation",
      status: scoreStatus(summary.healthScore),
    },
    {
      label: "Data Quality / Completion Rate",
      value: percent(summary.dataQualityScore),
      interpretation: "Dashboard required-field completion score",
      status: scoreStatus(summary.dataQualityScore),
    },
    {
      label: "Predictive Risk",
      value: summary.predictiveRisk,
      interpretation: "Dashboard trend and abnormality risk signal",
      status: riskStatus(summary.predictiveRisk),
    },
    {
      label: "Alerts / AI Insights",
      value: summary.alertLabel,
      interpretation: `${summary.insightCount} dashboard AI insight${summary.insightCount === 1 ? "" : "s"}`,
      status: summaryAlertStatus(summary, scorecard.insights),
    },
  ] as const;
}

function footer(dataset: OdmScorecardDataset): PresentationElement[] {
  const footerText = `${dataset.reportingMonthLabel} | ${dataset.facility} | ${OPERATOR_DRIVEN_MAINTENANCE_SOURCE_LABEL}`;
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
      text: footerText,
      x: DESIGN.margins.x,
      y: DESIGN.margins.footerTop + 0.08,
      w: DESIGN.slide.width - DESIGN.margins.x * 2,
      h: 0.26,
      fontFace: DESIGN.fonts.body,
      fontSize: DESIGN.typography.footer,
      color: DESIGN.footer.color,
    },
  ];
}

function scopeSubtitle(dataset: OdmScorecardDataset) {
  const filters = [
    dataset.facility,
    dataset.equipmentType ? `Equipment: ${dataset.equipmentType}` : "",
    dataset.category ? `Category: ${dataset.category}` : "",
    dataset.inspector ? `Inspector: ${dataset.inspector}` : "",
  ].filter(Boolean);
  return `${dataset.dateFrom} to ${dataset.dateTo} | ${filters.join(" | ")}`;
}

function slideChrome(
  title: string,
  dataset: OdmScorecardDataset,
  subtitle = scopeSubtitle(dataset)
): PresentationElement[] {
  return [
    {
      type: "shape",
      x: 0,
      y: 0,
      w: DESIGN.slide.width,
      h: 0.2,
      fill: COLORS.navy,
      line: COLORS.navy,
    },
    {
      type: "shape",
      x: 0,
      y: 0.2,
      w: DESIGN.slide.width,
      h: 0.08,
      fill: COLORS.accentBlue,
      line: COLORS.accentBlue,
    },
    {
      type: "text",
      text: title,
      x: DESIGN.margins.x,
      y: 0.42,
      w: 9.3,
      h: 0.45,
      fontFace: DESIGN.fonts.title,
      fontSize: 26,
      bold: true,
      color: COLORS.navy,
    },
    {
      type: "text",
      text: subtitle,
      x: DESIGN.margins.x,
      y: 0.88,
      w: 11.6,
      h: 0.3,
      fontFace: DESIGN.fonts.body,
      fontSize: DESIGN.typography.body,
      color: COLORS.mutedText,
    },
    ...footer(dataset),
  ];
}

function cardBase(
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string = COLORS.cardFill
): PresentationElement[] {
  return [
    {
      type: "shape",
      x,
      y,
      w,
      h,
      fill,
      line: COLORS.border,
    },
  ];
}

function bulletText(items: string[], fallback: string, limit = 4) {
  const visible = items.length ? items.slice(0, limit) : [fallback];
  const overflow = items.length > limit ? `\n+${items.length - limit} more` : "";
  return `${visible.map(item => `- ${item}`).join("\n")}${overflow}`;
}

function sectionCard(
  title: string,
  body: string,
  x: number,
  y: number,
  w: number,
  h: number,
  accent: string = COLORS.accentBlue
): PresentationElement[] {
  return [
    ...cardBase(x, y, w, h),
    {
      type: "shape",
      x,
      y,
      w,
      h: 0.14,
      fill: accent,
      line: accent,
    },
    {
      type: "text",
      text: title,
      x: x + 0.2,
      y: y + 0.26,
      w: w - 0.4,
      h: 0.34,
      fontFace: DESIGN.fonts.heading,
      fontSize: DESIGN.typography.cardTitle,
      bold: true,
      color: COLORS.navy,
    },
    {
      type: "text",
      text: body,
      x: x + 0.2,
      y: y + 0.72,
      w: w - 0.4,
      h: h - 0.85,
      fontFace: DESIGN.fonts.body,
      fontSize: MIN_DECK_FONT_SIZE,
      color: COLORS.text,
    },
  ];
}

function insightLabel(insight: OdmDashboardInsight) {
  return `${insight.severity.toUpperCase()}: ${insight.title} (${insight.metric})`;
}

function buildExecutiveBullets(dataset: OdmScorecardDataset) {
  const { summary, insights } = dataset.scorecard;
  const status = [
    `${numberText(summary.totalInspections)} total inspections in dashboard scope.`,
    `${numberText(summary.uniqueAssets)} unique assets inspected.`,
    `Health Score: ${percent(summary.healthScore)}.`,
    `Data Quality / Completion Rate: ${percent(summary.dataQualityScore)}.`,
    `Predictive Risk: ${summary.predictiveRisk}.`,
  ];
  const insightBullets = insights.map(insightLabel);
  const scope = [
    `Date Range: ${dataset.dateFrom} to ${dataset.dateTo}.`,
    `Plant / Facility: ${dataset.facility}.`,
    dataset.equipmentType ? `Equipment Type: ${dataset.equipmentType}.` : "",
    dataset.category ? `Category: ${dataset.category}.` : "",
    dataset.inspector ? `Inspector: ${dataset.inspector}.` : "",
  ].filter(Boolean);
  return { status, insightBullets, scope };
}

function buildCoverSlide(
  dataset: OdmScorecardDataset,
  generatedAt: Date
): PresentationSlide {
  return {
    elements: [
      {
        type: "shape",
        x: 0,
        y: 0,
        w: DESIGN.slide.width,
        h: 0.28,
        fill: COLORS.navy,
        line: COLORS.navy,
      },
      {
        type: "shape",
        x: 0,
        y: 0.28,
        w: DESIGN.slide.width,
        h: 0.1,
        fill: COLORS.accentBlue,
        line: COLORS.accentBlue,
      },
      {
        type: "shape",
        x: 0.58,
        y: 1.08,
        w: 0.08,
        h: 4.55,
        fill: COLORS.accentBlue,
        line: COLORS.accentBlue,
      },
      {
        type: "text",
        text: ODM_DECK_TITLE,
        x: 0.88,
        y: 1.08,
        w: 9.4,
        h: 0.75,
        fontFace: DESIGN.fonts.title,
        fontSize: DESIGN.typography.coverTitle,
        bold: true,
        color: COLORS.navy,
      },
      {
        type: "text",
        text: dataset.facility,
        x: 0.9,
        y: 2.0,
        w: 5.9,
        h: 0.42,
        fontFace: DESIGN.fonts.heading,
        fontSize: 20,
        bold: true,
        color: COLORS.accentBlue,
      },
      {
        type: "text",
        text: dataset.reportingMonthLabel,
        x: 7.0,
        y: 2.0,
        w: 3.2,
        h: 0.42,
        fontFace: DESIGN.fonts.heading,
        fontSize: 20,
        bold: true,
        color: COLORS.accentBlue,
        align: "r",
      },
      {
        type: "text",
        text: `Dashboard Date Range\n${dataset.dateFrom} to ${dataset.dateTo}`,
        x: 0.9,
        y: 3.1,
        w: 3.45,
        h: 0.9,
        fontFace: DESIGN.fonts.body,
        fontSize: MIN_DECK_FONT_SIZE,
        color: COLORS.text,
      },
      {
        type: "text",
        text: `Facility Scope\n${dataset.facility}`,
        x: 4.6,
        y: 3.1,
        w: 3.15,
        h: 0.9,
        fontFace: DESIGN.fonts.body,
        fontSize: MIN_DECK_FONT_SIZE,
        color: COLORS.text,
      },
      {
        type: "text",
        text: `Template\n${dataset.template}`,
        x: 8.0,
        y: 3.1,
        w: 3.0,
        h: 0.9,
        fontFace: DESIGN.fonts.body,
        fontSize: MIN_DECK_FONT_SIZE,
        color: COLORS.text,
      },
      {
        type: "text",
        text: `Generated from ${OPERATOR_DRIVEN_MAINTENANCE_SOURCE_LABEL}`,
        x: 0.9,
        y: 5.82,
        w: 7.35,
        h: 0.32,
        fontFace: DESIGN.fonts.body,
        fontSize: MIN_DECK_FONT_SIZE,
        color: COLORS.mutedText,
      },
      {
        type: "text",
        text: generatedAt.toLocaleString("en", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        x: 8.5,
        y: 5.82,
        w: 3.45,
        h: 0.32,
        fontFace: DESIGN.fonts.body,
        fontSize: MIN_DECK_FONT_SIZE,
        color: COLORS.mutedText,
        align: "r",
      },
      ...footer(dataset),
    ],
  };
}

function buildExecutiveSummarySlide(dataset: OdmScorecardDataset): PresentationSlide {
  const bullets = buildExecutiveBullets(dataset);
  return {
    elements: [
      ...slideChrome("Executive Summary", dataset),
      ...sectionCard(
        "Dashboard Status",
        bulletText(bullets.status, "No dashboard data was available.", 5),
        0.65,
        1.55,
        3.85,
        4.75,
        COLORS.accentBlue
      ),
      ...sectionCard(
        "AI Operational Insights",
        bulletText(
          bullets.insightBullets,
          "No AI operational insights were generated for this scope."
        ),
        4.75,
        1.55,
        3.85,
        4.75,
        COLORS.warning
      ),
      ...sectionCard(
        "Dashboard Scope",
        bulletText(bullets.scope, "No dashboard filters were applied."),
        8.85,
        1.55,
        3.85,
        4.75,
        COLORS.success
      ),
    ],
  };
}

function buildKpiCardsSlide(dataset: OdmScorecardDataset): PresentationSlide {
  const cards = buildOdmKpiCards(dataset);
  const elements: PresentationElement[] = [
    ...slideChrome("ODM KPI Cards", dataset),
  ];
  cards.forEach((card, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = 0.65 + col * 4.12;
    const y = 1.45 + row * 2.48;
    const status = card.status;
    elements.push(
      ...cardBase(x, y, 3.75, 2.05, COLORS.white),
      {
        type: "shape",
        x,
        y,
        w: 0.14,
        h: 2.05,
        fill: statusFill(status),
        line: statusFill(status),
      },
      {
        type: "text",
        text: card.label,
        x: x + 0.28,
        y: y + 0.2,
        w: 3.25,
        h: 0.36,
        fontFace: DESIGN.fonts.heading,
        fontSize: MIN_DECK_FONT_SIZE,
        bold: true,
        color: COLORS.navy,
      },
      {
        type: "text",
        text: card.value,
        x: x + 0.28,
        y: y + 0.72,
        w: 3.25,
        h: 0.5,
        fontFace: DESIGN.fonts.numeric,
        fontSize: 28,
        bold: true,
        color: COLORS.accentBlue,
      },
      {
        type: "text",
        text: card.interpretation,
        x: x + 0.28,
        y: y + 1.42,
        w: 3.25,
        h: 0.42,
        fontFace: DESIGN.fonts.body,
        fontSize: MIN_DECK_FONT_SIZE,
        color: COLORS.mutedText,
      }
    );
  });
  return { elements };
}

function metricFill(status: KpiStatus) {
  if (status === "success") return COLORS.paleGreen;
  if (status === "warning") return COLORS.paleYellow;
  if (status === "danger") return COLORS.paleRed;
  return COLORS.noData;
}

function buildFacilityTable(dataset: OdmScorecardDataset) {
  const visible = dataset.scorecard.facilityBreakdown.slice(0, 8);
  const rows = [
    [
      "Facility",
      "Total Inspections",
      "Unique Assets",
      "Health Score",
      "Data Quality",
      "Negative Findings",
    ],
    ...visible.map(group => [
      group.plant,
      numberText(group.totalInspections),
      numberText(group.uniqueAssets),
      percent(group.healthScore),
      percent(group.dataQualityScore),
      numberText(group.negativeFindings),
    ]),
  ];
  const cellFills = rows.map((row, rowIndex) =>
    row.map((_, colIndex) => {
      if (rowIndex === 0) return COLORS.accentBlue;
      const group = visible[rowIndex - 1];
      if (!group) return undefined;
      if (colIndex === 0) return COLORS.paleNavy;
      if (colIndex === 3) return metricFill(scoreStatus(group.healthScore));
      if (colIndex === 4) return metricFill(scoreStatus(group.dataQualityScore));
      if (colIndex === 5) {
        return group.negativeFindings ? COLORS.paleYellow : COLORS.paleGreen;
      }
      return rowIndex % 2 === 0 ? COLORS.cardAltFill : COLORS.white;
    })
  );
  const cellColors = rows.map((row, rowIndex) =>
    row.map((_, colIndex) => {
      if (rowIndex === 0) return COLORS.white;
      const group = visible[rowIndex - 1];
      if (!group) return undefined;
      if (colIndex === 3) return statusTextColor(scoreStatus(group.healthScore));
      if (colIndex === 4) return statusTextColor(scoreStatus(group.dataQualityScore));
      return COLORS.text;
    })
  );
  return {
    rows: visible.length ? rows : [["Facility", "Status"], [dataset.facility, "No Data"]],
    cellFills: visible.length ? cellFills : [[COLORS.accentBlue, COLORS.accentBlue]],
    cellColors: visible.length ? cellColors : [[COLORS.white, COLORS.white]],
    hiddenCount: Math.max(0, dataset.scorecard.facilityBreakdown.length - 8),
  };
}

function buildFacilityBreakdownSlide(dataset: OdmScorecardDataset): PresentationSlide {
  const table = buildFacilityTable(dataset);
  return {
    elements: [
      ...slideChrome("Facility Breakdown", dataset),
      {
        type: "table",
        rows: table.rows,
        cellFills: table.cellFills,
        cellColors: table.cellColors,
        x: 0.55,
        y: 1.45,
        w: 12.2,
        h: 4.75,
        colWidths:
          table.rows[0].length === 6
            ? [2.75, 1.65, 1.55, 1.75, 1.75, 1.95]
            : [5.5, 5.5],
        rowHeights: table.rows.map(() => 0.48),
        fontFace: DESIGN.fonts.body,
        fontSize: MIN_DECK_FONT_SIZE,
      },
      ...(table.hiddenCount
        ? [
            {
              type: "text" as const,
              text: `+${table.hiddenCount} more facilities not shown`,
              x: 0.65,
              y: 6.25,
              w: 4.5,
              h: 0.3,
              fontFace: DESIGN.fonts.body,
              fontSize: MIN_DECK_FONT_SIZE,
              color: COLORS.mutedText,
            },
          ]
        : []),
    ],
  };
}

function findingThemeBullets(dataset: OdmScorecardDataset) {
  return dataset.scorecard.findingThemes.slice(0, 5).map(theme => {
    return `${theme.category}: ${numberText(theme.distinctAssets)} assets, ${numberText(theme.totalInspections)} negative inspections`;
  });
}

function highPriorityInsights(dataset: OdmScorecardDataset) {
  return dataset.scorecard.insights
    .filter(insight => ["critical", "high", "medium"].includes(insight.severity))
    .slice(0, 5)
    .map(insightLabel);
}

function buildFindingsSlide(dataset: OdmScorecardDataset): PresentationSlide {
  const themes = findingThemeBullets(dataset);
  const insights = highPriorityInsights(dataset);
  const negativeRows = dataset.records
    .filter(hasNegativeFindings)
    .slice(0, 5)
    .map(row => {
      const detail = text(row.Findings) || text(row.EntryNotes) || text(row.Capture1Response);
      return `${row.Plant || "Unspecified Facility"}: ${truncate(detail, 95)}`;
    });
  return {
    elements: [
      ...slideChrome("Findings and Risk Themes", dataset),
      ...sectionCard(
        "Dashboard Finding Themes",
        bulletText(themes, ODM_NO_FINDINGS_FALLBACK),
        0.65,
        1.45,
        3.85,
        4.9,
        COLORS.accentBlue
      ),
      ...sectionCard(
        "AI Risk Signals",
        bulletText(insights, "No medium-or-higher AI risk signals were generated."),
        4.75,
        1.45,
        3.85,
        4.9,
        COLORS.danger
      ),
      ...sectionCard(
        "Persisted Findings / Notes",
        bulletText(negativeRows, ODM_NO_FINDINGS_FALLBACK),
        8.85,
        1.45,
        3.85,
        4.9,
        COLORS.warning
      ),
    ],
  };
}

function buildTrendSlide(dataset: OdmScorecardDataset): PresentationSlide {
  const visible = dataset.scorecard.trend.slice(-8);
  if (!visible.length) {
    return {
      elements: [
        ...slideChrome(
          "Adoption and Execution Trend",
          dataset,
          "Daily dashboard negative-finding trend from filtered inspections"
        ),
        ...cardBase(1.0, 2.3, 11.3, 2.2, COLORS.cardAltFill),
        {
          type: "text",
          text: ODM_TREND_FALLBACK,
          x: 1.35,
          y: 3.05,
          w: 10.6,
          h: 0.5,
          fontFace: DESIGN.fonts.body,
          fontSize: 18,
          bold: true,
          color: COLORS.mutedText,
          align: "ctr",
        },
      ],
    };
  }
  const rows = [
    ["Date", "Distinct Affected Assets", "Negative Inspections"],
    ...visible.map(point => [
      point.date,
      numberText(point.distinctAffectedAssets),
      numberText(point.totalNegativeInspections),
    ]),
  ];
  return {
    elements: [
      ...slideChrome(
        "Adoption and Execution Trend",
        dataset,
        "Daily dashboard negative-finding trend from filtered inspections"
      ),
      {
        type: "table",
        rows,
        cellFills: rows.map((row, rowIndex) =>
          row.map(() => (rowIndex === 0 ? COLORS.accentBlue : undefined))
        ),
        cellColors: rows.map((row, rowIndex) =>
          row.map(() => (rowIndex === 0 ? COLORS.white : COLORS.text))
        ),
        x: 1.05,
        y: 1.55,
        w: 11.25,
        h: 4.7,
        colWidths: [3.2, 4.0, 4.05],
        rowHeights: rows.map(() => 0.48),
        fontFace: DESIGN.fonts.body,
        fontSize: MIN_DECK_FONT_SIZE,
      },
    ],
  };
}

function uniqueRecommendations(insights: OdmDashboardInsight[]) {
  return uniqueTexts(insights.map(insight => insight.recommendation)).map(item =>
    truncate(item, 120)
  );
}

function persistedNotes(dataset: OdmScorecardDataset) {
  return dataset.scorecard.notes.slice(0, 5).map(row => {
    return `${row.Plant || "Unspecified Facility"}: ${truncate(text(row.EntryNotes), 110)}`;
  });
}

function followUpFindings(dataset: OdmScorecardDataset) {
  return dataset.records
    .filter(row => text(row.Findings) || hasNegativeFindings(row))
    .slice(0, 5)
    .map(row => {
      const detail = text(row.Findings) || text(row.EntryNotes) || text(row.Capture1Response);
      return `${row.Plant || "Unspecified Facility"}: ${truncate(detail, 110)}`;
    });
}

function buildActionsSlide(dataset: OdmScorecardDataset): PresentationSlide {
  const recommendations = uniqueRecommendations(dataset.scorecard.insights);
  const notes = persistedNotes(dataset);
  const findings = followUpFindings(dataset);
  return {
    elements: [
      ...slideChrome("Action Items and Follow-up", dataset),
      ...sectionCard(
        "Dashboard Insight Recommendations",
        bulletText(recommendations, ODM_NO_ACTIONS_FALLBACK),
        0.65,
        1.45,
        3.85,
        4.9,
        COLORS.accentBlue
      ),
      ...sectionCard(
        "Persisted Operator Notes",
        bulletText(notes, "No operator notes were recorded for the selected dashboard scope."),
        4.75,
        1.45,
        3.85,
        4.9,
        COLORS.warning
      ),
      ...sectionCard(
        "Findings for Review",
        bulletText(findings, ODM_NO_FINDINGS_FALLBACK),
        8.85,
        1.45,
        3.85,
        4.9,
        COLORS.danger
      ),
    ],
  };
}

export function buildOdmSlides(
  dataset: OdmScorecardDataset,
  generatedAt = new Date()
): PresentationSlide[] {
  return [
    buildCoverSlide(dataset, generatedAt),
    buildExecutiveSummarySlide(dataset),
    buildKpiCardsSlide(dataset),
    buildFacilityBreakdownSlide(dataset),
    buildFindingsSlide(dataset),
    buildTrendSlide(dataset),
    buildActionsSlide(dataset),
  ];
}

function requireOdmContext(context: DeckGenerationContext) {
  const reportingYear = Number(context.reportingYear);
  const reportingMonth = Number(context.reportingMonth);
  if (!Number.isInteger(reportingYear) || !Number.isInteger(reportingMonth)) {
    throw new Error(
      "Select a valid reporting year and month before generating."
    );
  }
  const fallbackRange = getOdmMonthDateRange(reportingYear, reportingMonth);
  return {
    reportingYear,
    reportingMonth,
    dateFrom: text(context.dateFrom) || fallbackRange.dateFrom,
    dateTo: text(context.dateTo) || fallbackRange.dateTo,
    facility: context.facility,
    equipmentType: context.equipmentType,
    category: context.category,
    inspector: context.inspector,
    template:
      context.template === ODM_EXECUTIVE_SUMMARY_TEMPLATE
        ? context.template
        : ODM_EXECUTIVE_SUMMARY_TEMPLATE,
  };
}

export async function generateOperatorDrivenMaintenanceDeck(
  context: DeckGenerationContext
): Promise<GeneratedPresentation> {
  const request = requireOdmContext(context);
  const persisted = await getPersistedOdmScorecard(
    {
      reportingYear: request.reportingYear,
      reportingMonth: request.reportingMonth,
      dateFrom: request.dateFrom,
      dateTo: request.dateTo,
      facility: request.facility,
      equipmentType: request.equipmentType,
      category: request.category,
      inspector: request.inspector,
    },
    request.template as OdmTemplate
  );
  const now = new Date();
  const title = `${ODM_DECK_TITLE} - ${persisted.facility} - ${persisted.reportingMonthLabel}`;
  const blob = await createPresentation(buildOdmSlides(persisted, now));
  const dataUrl = await blobToDataUrl(blob);
  const name = `${slug(title)}.pptx`;
  const generatedAt = now.toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    type: ODM_DECK_TYPE,
    generatedDate: generatedAt,
    generatedBy: context.generatedBy,
    size: blob.size,
    dataUrl,
    generatorId: "operator-driven-maintenance",
    generatorName: "Operator Driven Maintenance Deck",
    reportingYear: persisted.reportingYear,
    reportingMonth: persisted.reportingMonth,
    dateFrom: persisted.dateFrom,
    dateTo: persisted.dateTo,
    facility: persisted.facility,
    equipmentType: persisted.equipmentType,
    category: persisted.category,
    inspector: persisted.inspector,
    template: persisted.template,
    filename: name,
    generatedAt,
  };
}

export {
  ODM_NO_ACTIONS_FALLBACK,
  ODM_NO_FINDINGS_FALLBACK,
  ODM_TREND_FALLBACK,
};
