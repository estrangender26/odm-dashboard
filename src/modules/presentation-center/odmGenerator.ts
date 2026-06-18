import { createPresentation } from "./pptxBuilder";
import { MONTHLY_KPI_DECK_DESIGN } from "./monthlyKpiDeckDesign";
import {
  ALL_FACILITIES_LABEL,
  getPersistedOdmScorecard,
  ODM_EXECUTIVE_SUMMARY_TEMPLATE,
  OPERATOR_DRIVEN_MAINTENANCE_SOURCE_LABEL,
  type OdmInspectionRecord,
  type OdmScorecardDataset,
} from "./odmScorecardData";
import { blobToDataUrl } from "./storage";
import type {
  DeckGenerationContext,
  GeneratedPresentation,
  OdmTemplate,
} from "./types";

type PresentationSlide = Parameters<typeof createPresentation>[0][number];
type PresentationElement = PresentationSlide["elements"][number];
type KpiStatus = "success" | "warning" | "danger" | "no-data";

const DESIGN = MONTHLY_KPI_DECK_DESIGN;
const COLORS = DESIGN.colors;
const MIN_DECK_FONT_SIZE = DESIGN.typography.min;
const ODM_NO_FINDINGS_FALLBACK =
  "No inspection findings were recorded for the selected reporting period.";
const ODM_NO_ACTIONS_FALLBACK =
  "No follow-up actions were recorded for the selected reporting period.";
const ODM_TREND_FALLBACK =
  "Insufficient historical data available for trend view.";

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
  return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function isPresentNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function uniqueTexts(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map(text).filter(Boolean)));
}

function percent(value: number | null | undefined, digits = 1) {
  return isPresentNumber(value) ? `${value.toFixed(digits)}%` : "No Data";
}

function numberValue(value: number | null | undefined) {
  return isPresentNumber(value) ? String(value) : "No Data";
}

function average(values: Array<number | null | undefined>) {
  const present = values.filter(isPresentNumber);
  if (!present.length) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

function normalizedStatus(record: OdmInspectionRecord) {
  return text(record.status).toLowerCase();
}

function hasKnownStatus(record: OdmInspectionRecord) {
  return Boolean(normalizedStatus(record));
}

function isCompletedInspection(record: OdmInspectionRecord) {
  const status = normalizedStatus(record);
  if (!status) return false;
  return ![
    "pending",
    "open",
    "in progress",
    "not started",
    "overdue",
  ].some(value => status.includes(value));
}

function hasFinding(record: OdmInspectionRecord) {
  return Boolean(text(record.findings));
}

function isClosedFinding(record: OdmInspectionRecord) {
  const status = normalizedStatus(record);
  return [
    "closed",
    "resolved",
    "complete",
    "completed",
    "done",
    "pass",
    "passed",
    "ok",
  ].some(value => status.includes(value));
}

function isOpenFinding(record: OdmInspectionRecord) {
  return hasFinding(record) && !isClosedFinding(record);
}

function isCriticalFinding(record: OdmInspectionRecord) {
  const combined = [
    record.escalationTrigger,
    record.findings,
    record.category,
    record.status,
  ]
    .map(text)
    .join(" ")
    .toLowerCase();
  return [
    "critical",
    "high",
    "urgent",
    "emergency",
    "shutdown",
    "danger",
    "unsafe",
    "severe",
  ].some(keyword => combined.includes(keyword));
}

function isOverdueInspection(record: OdmInspectionRecord) {
  return [record.status, record.escalationTrigger, record.findings]
    .map(text)
    .join(" ")
    .toLowerCase()
    .includes("overdue");
}

function recordDate(record: OdmInspectionRecord) {
  const raw = text(record.date) || text(record.inspectionDate) || text(record.submittedAt);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function weekOfMonth(record: OdmInspectionRecord) {
  const date = recordDate(record);
  if (!date) return null;
  return Math.min(5, Math.floor((date.getDate() - 1) / 7) + 1);
}

function normalizeFindingKey(record: OdmInspectionRecord) {
  return (text(record.findings) || text(record.category))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function frequencyMap(values: string[]) {
  const counts = new Map<string, number>();
  values.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

export function summarizeOdmRecords(records: OdmInspectionRecord[]) {
  const totalRecords = records.length;
  const statusRecords = records.filter(hasKnownStatus);
  const completedRecords = statusRecords.filter(isCompletedInspection).length;
  const completionRate = statusRecords.length
    ? (completedRecords / statusRecords.length) * 100
    : null;
  const equipmentHealthScore = average(records.map(record => record.score));
  const assetsCovered = uniqueTexts(
    records.map(record => text(record.assetTag) || text(record.assetName))
  ).length;
  const facilitiesCovered = uniqueTexts(records.map(record => record.facilityId))
    .length;
  const openFindings = records.filter(isOpenFinding).length;
  const criticalFindings = records.filter(
    record => hasFinding(record) && isCriticalFinding(record)
  ).length;
  const overdueInspections = records.filter(isOverdueInspection).length;
  const repeatFindings = frequencyMap(
    records.map(normalizeFindingKey).filter(Boolean)
  ).filter(([, count]) => count > 1).length;

  return {
    totalRecords,
    statusRecords: statusRecords.length,
    completionRate,
    equipmentHealthScore,
    assetsCovered,
    facilitiesCovered,
    openFindings,
    criticalFindings,
    overdueInspections,
    repeatFindings,
  };
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

function completionStatus(value: number | null): KpiStatus {
  if (!isPresentNumber(value)) return "no-data";
  if (value >= 90) return "success";
  if (value >= 75) return "warning";
  return "danger";
}

function healthStatus(value: number | null): KpiStatus {
  if (!isPresentNumber(value)) return "no-data";
  if (value >= 85) return "success";
  if (value >= 70) return "warning";
  return "danger";
}

function countStatus(value: number, inverse = false): KpiStatus {
  if (inverse) {
    if (value === 0) return "success";
    if (value <= 3) return "warning";
    return "danger";
  }
  if (value > 0) return "success";
  return "no-data";
}

export function buildOdmKpiCards(records: OdmInspectionRecord[]) {
  const summary = summarizeOdmRecords(records);
  return [
    {
      label: "Inspection Records Generated",
      value: numberValue(summary.totalRecords),
      interpretation:
        summary.totalRecords > 0
          ? "Persisted inspection records for selected scope"
          : "No persisted inspections",
      status: countStatus(summary.totalRecords),
    },
    {
      label: "Inspection Completion Rate",
      value: percent(summary.completionRate),
      interpretation: summary.statusRecords
        ? `${summary.statusRecords} records include status values`
        : "No status values recorded",
      status: completionStatus(summary.completionRate),
    },
    {
      label: "Equipment Health Score",
      value: isPresentNumber(summary.equipmentHealthScore)
        ? summary.equipmentHealthScore.toFixed(1)
        : "No Data",
      interpretation: isPresentNumber(summary.equipmentHealthScore)
        ? "Average persisted inspection score"
        : "No score values recorded",
      status: healthStatus(summary.equipmentHealthScore),
    },
    {
      label: "Assets Covered",
      value: numberValue(summary.assetsCovered),
      interpretation: "Distinct persisted asset tags/names",
      status: countStatus(summary.assetsCovered),
    },
    {
      label: "Facilities Covered",
      value: numberValue(summary.facilitiesCovered),
      interpretation: "Distinct facilities in selected scope",
      status: countStatus(summary.facilitiesCovered),
    },
    {
      label: "Open Findings",
      value: numberValue(summary.openFindings),
      interpretation: "Findings not marked closed/resolved/pass",
      status: countStatus(summary.openFindings, true),
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

function slideChrome(
  title: string,
  dataset: OdmScorecardDataset,
  subtitle?: string
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
      text: subtitle || `${dataset.reportingMonthLabel} | ${dataset.facility}`,
      x: DESIGN.margins.x,
      y: 0.88,
      w: 9.3,
      h: 0.28,
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
  fill = COLORS.cardFill
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

function bulletText(items: string[], fallback: string) {
  const visible = items.length ? items.slice(0, 4) : [fallback];
  const overflow = items.length > 4 ? `\n+${items.length - 4} more` : "";
  return `${visible.map(item => `• ${item}`).join("\n")}${overflow}`;
}

function buildExecutiveBullets(records: OdmInspectionRecord[]) {
  const summary = summarizeOdmRecords(records);
  const status = [
    `${summary.totalRecords} inspection records generated.`,
    isPresentNumber(summary.completionRate)
      ? `${percent(summary.completionRate)} inspection completion rate.`
      : "No status values recorded for completion rate.",
    `${summary.facilitiesCovered} facilities covered.`,
    `${summary.openFindings} open findings recorded.`,
  ];
  const wins: string[] = [];
  if (isPresentNumber(summary.completionRate) && summary.completionRate >= 90) {
    wins.push(`Inspection completion reached ${percent(summary.completionRate)}.`);
  }
  if (
    isPresentNumber(summary.equipmentHealthScore) &&
    summary.equipmentHealthScore >= 85
  ) {
    wins.push(
      `Average equipment health score was ${summary.equipmentHealthScore.toFixed(1)}.`
    );
  }
  if (summary.criticalFindings === 0 && summary.totalRecords > 0) {
    wins.push("No critical findings were recorded.");
  }
  if (summary.openFindings === 0 && summary.totalRecords > 0) {
    wins.push("No open findings remained in selected records.");
  }

  const risks: string[] = [];
  if (summary.criticalFindings > 0) {
    risks.push(`${summary.criticalFindings} critical/high-risk findings recorded.`);
  }
  if (summary.openFindings > 0) {
    risks.push(`${summary.openFindings} open findings require review.`);
  }
  if (summary.repeatFindings > 0) {
    risks.push(`${summary.repeatFindings} repeat finding themes detected.`);
  }
  if (summary.overdueInspections > 0) {
    risks.push(`${summary.overdueInspections} records mention overdue status.`);
  }
  if (isPresentNumber(summary.completionRate) && summary.completionRate < 75) {
    risks.push(`Completion rate is below 75% at ${percent(summary.completionRate)}.`);
  }

  return {
    status,
    wins,
    risks,
  };
}

function facilityGroups(records: OdmInspectionRecord[]) {
  const grouped = new Map<string, OdmInspectionRecord[]>();
  records.forEach(record => {
    const facility = text(record.facilityId) || "Unspecified Facility";
    grouped.set(facility, [...(grouped.get(facility) || []), record]);
  });
  return Array.from(grouped.entries())
    .map(([facility, facilityRecords]) => {
      const summary = summarizeOdmRecords(facilityRecords);
      return { facility, records: facilityRecords, summary };
    })
    .sort((a, b) => {
      const riskDelta =
        b.summary.criticalFindings +
        b.summary.openFindings -
        (a.summary.criticalFindings + a.summary.openFindings);
      return riskDelta || b.summary.totalRecords - a.summary.totalRecords;
    });
}

function metricFill(status: KpiStatus) {
  if (status === "success") return COLORS.paleGreen;
  if (status === "warning") return COLORS.paleYellow;
  if (status === "danger") return COLORS.paleRed;
  return COLORS.noData;
}

function buildFacilityTable(dataset: OdmScorecardDataset) {
  const groups = facilityGroups(dataset.records);
  const visible = groups.slice(0, 8);
  const rows = [
    [
      "Facility",
      "Inspection Records",
      "Completion Rate",
      "Equipment Health Score",
      "Open Findings",
      "Critical Findings",
    ],
    ...visible.map(group => [
      group.facility,
      String(group.summary.totalRecords),
      percent(group.summary.completionRate),
      isPresentNumber(group.summary.equipmentHealthScore)
        ? group.summary.equipmentHealthScore.toFixed(1)
        : "No Data",
      String(group.summary.openFindings),
      String(group.summary.criticalFindings),
    ]),
  ];
  const cellFills = rows.map((row, rowIndex) =>
    row.map((_, colIndex) => {
      if (rowIndex === 0) return COLORS.accentBlue;
      const summary = visible[rowIndex - 1]?.summary;
      if (!summary) return undefined;
      if (colIndex === 0) return COLORS.paleNavy;
      if (colIndex === 2) return metricFill(completionStatus(summary.completionRate));
      if (colIndex === 3) return metricFill(healthStatus(summary.equipmentHealthScore));
      if (colIndex === 4) return metricFill(countStatus(summary.openFindings, true));
      if (colIndex === 5) return metricFill(countStatus(summary.criticalFindings, true));
      return rowIndex % 2 === 0 ? COLORS.cardAltFill : COLORS.white;
    })
  );
  const cellColors = rows.map((row, rowIndex) =>
    row.map((_, colIndex) => {
      if (rowIndex === 0) return COLORS.white;
      const summary = visible[rowIndex - 1]?.summary;
      if (!summary) return undefined;
      if (colIndex === 2) return statusTextColor(completionStatus(summary.completionRate));
      if (colIndex === 3) return statusTextColor(healthStatus(summary.equipmentHealthScore));
      if (colIndex === 4) return statusTextColor(countStatus(summary.openFindings, true));
      if (colIndex === 5) return statusTextColor(countStatus(summary.criticalFindings, true));
      return COLORS.text;
    })
  );
  return { rows, cellFills, cellColors, hiddenCount: Math.max(0, groups.length - 8) };
}

function findingRecords(records: OdmInspectionRecord[]) {
  return records.filter(hasFinding);
}

function buildFindingsSections(records: OdmInspectionRecord[]) {
  const findings = findingRecords(records);
  if (!findings.length) {
    return {
      categories: [ODM_NO_FINDINGS_FALLBACK],
      critical: [ODM_NO_FINDINGS_FALLBACK],
      repeats: [ODM_NO_FINDINGS_FALLBACK],
    };
  }
  const categories = frequencyMap(
    findings.map(record => text(record.category) || "Uncategorized")
  )
    .slice(0, 5)
    .map(([category, count]) => `${category}: ${count}`);
  const critical = findings
    .filter(isCriticalFinding)
    .slice(0, 4)
    .map(
      record =>
        `${record.facilityId}: ${truncate(text(record.findings), 95)}`
    );
  const repeats = frequencyMap(findings.map(normalizeFindingKey).filter(Boolean))
    .filter(([, count]) => count > 1)
    .slice(0, 4)
    .map(([issue, count]) => `${truncate(issue, 78)}: ${count} records`);
  return {
    categories: categories.length ? categories : [ODM_NO_FINDINGS_FALLBACK],
    critical: critical.length ? critical : ["No critical/high-risk findings recorded."],
    repeats: repeats.length ? repeats : ["No repeat finding themes detected."],
  };
}

function buildTrend(records: OdmInspectionRecord[]) {
  const buckets = new Map<number, OdmInspectionRecord[]>();
  records.forEach(record => {
    const week = weekOfMonth(record);
    if (!week) return;
    buckets.set(week, [...(buckets.get(week) || []), record]);
  });
  const entries = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);
  const withStatus = entries
    .map(([week, weekRecords]) => {
      const summary = summarizeOdmRecords(weekRecords);
      return { week, summary };
    })
    .filter(entry => isPresentNumber(entry.summary.completionRate));
  if (withStatus.length < 2) return null;
  return {
    labels: withStatus.map(entry => `Week ${entry.week}`),
    values: withStatus.map(entry => entry.summary.completionRate ?? 0),
    colors: withStatus.map(entry =>
      statusFill(completionStatus(entry.summary.completionRate))
    ),
  };
}

function buildActionSections(records: OdmInspectionRecord[]) {
  const notes = records
    .filter(record => text(record.entryNotes))
    .map(
      record =>
        `${record.facilityId}: ${truncate(text(record.entryNotes), 110)}`
    );
  const openOrCritical = records.filter(
    record => isOpenFinding(record) || (hasFinding(record) && isCriticalFinding(record))
  );
  const derivedFollowUp = openOrCritical
    .slice(0, 5)
    .map(
      record =>
        `Review recorded finding at ${record.facilityId}: ${truncate(
          text(record.findings),
          95
        )}`
    );
  const facilities = facilityGroups(openOrCritical)
    .slice(0, 5)
    .map(
      group =>
        `${group.facility}: ${group.summary.openFindings} open / ${group.summary.criticalFindings} critical findings`
    );
  const missingScores = records.filter(record => !isPresentNumber(record.score)).length;
  const missingAssets = records.filter(
    record => !text(record.assetTag) && !text(record.assetName)
  ).length;
  const dataQuality = [
    missingScores > 0 ? `${missingScores} records are missing health score.` : "",
    missingAssets > 0 ? `${missingAssets} records are missing asset identifier.` : "",
  ].filter(Boolean);

  return {
    followUp: notes.length ? notes : derivedFollowUp,
    facilities,
    dataQuality,
  };
}

function sectionCard(
  title: string,
  body: string,
  x: number,
  y: number,
  w: number,
  h: number,
  accent = COLORS.accentBlue
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
      y: y + 0.28,
      w: w - 0.4,
      h: 0.32,
      fontFace: DESIGN.fonts.heading,
      fontSize: DESIGN.typography.cardTitle,
      bold: true,
      color: COLORS.navy,
    },
    {
      type: "text",
      text: body,
      x: x + 0.2,
      y: y + 0.76,
      w: w - 0.4,
      h: h - 0.9,
      fontFace: DESIGN.fonts.body,
      fontSize: MIN_DECK_FONT_SIZE,
      color: COLORS.text,
    },
  ];
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
        y: 1.1,
        w: 0.08,
        h: 4.5,
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
        text: `Reporting Period\n${dataset.reportingMonthLabel}`,
        x: 0.9,
        y: 3.1,
        w: 3.2,
        h: 0.9,
        fontFace: DESIGN.fonts.body,
        fontSize: MIN_DECK_FONT_SIZE,
        color: COLORS.text,
      },
      {
        type: "text",
        text: `Facility Scope\n${dataset.facility}`,
        x: 4.35,
        y: 3.1,
        w: 3.4,
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
  const bullets = buildExecutiveBullets(dataset.records);
  return {
    elements: [
      ...slideChrome("Executive Summary", dataset),
      ...sectionCard(
        "Program Status",
        bulletText(bullets.status, "No Data"),
        0.65,
        1.55,
        3.85,
        4.75,
        COLORS.accentBlue
      ),
      ...sectionCard(
        "Key Wins",
        bulletText(bullets.wins, "No recorded wins were identified from inspection data."),
        4.75,
        1.55,
        3.85,
        4.75,
        COLORS.success
      ),
      ...sectionCard(
        "Key Risks / Watchpoints",
        bulletText(
          bullets.risks,
          "No recorded risks or watchpoints were identified."
        ),
        8.85,
        1.55,
        3.85,
        4.75,
        COLORS.danger
      ),
    ],
  };
}

function buildKpiCardsSlide(dataset: OdmScorecardDataset): PresentationSlide {
  const cards = buildOdmKpiCards(dataset.records);
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
        colWidths: [2.75, 1.65, 1.75, 2.1, 1.8, 1.8],
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

function buildFindingsSlide(dataset: OdmScorecardDataset): PresentationSlide {
  const sections = buildFindingsSections(dataset.records);
  return {
    elements: [
      ...slideChrome("Findings and Risk Themes", dataset),
      ...sectionCard(
        "Top Finding Categories",
        bulletText(sections.categories, ODM_NO_FINDINGS_FALLBACK),
        0.65,
        1.45,
        3.85,
        4.9,
        COLORS.accentBlue
      ),
      ...sectionCard(
        "Critical / High-Risk Findings",
        bulletText(sections.critical, ODM_NO_FINDINGS_FALLBACK),
        4.75,
        1.45,
        3.85,
        4.9,
        COLORS.danger
      ),
      ...sectionCard(
        "Repeat Issues",
        bulletText(sections.repeats, ODM_NO_FINDINGS_FALLBACK),
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
  const trend = buildTrend(dataset.records);
  return {
    elements: [
      ...slideChrome(
        "Adoption and Execution Trend",
        dataset,
        "Weekly completion rate from persisted inspection records"
      ),
      ...(trend
        ? [
            {
              type: "bars" as const,
              title: "Inspection Completion Rate by Week",
              labels: trend.labels,
              values: trend.values,
              colors: trend.colors,
              x: 1.0,
              y: 1.55,
              w: 10.9,
              h: 4.75,
              max: 100,
            },
          ]
        : [
            ...cardBase(1.0, 2.3, 11.3, 2.2, COLORS.cardAltFill),
            {
              type: "text" as const,
              text: ODM_TREND_FALLBACK,
              x: 1.35,
              y: 3.05,
              w: 10.6,
              h: 0.5,
              fontFace: DESIGN.fonts.body,
              fontSize: 18,
              bold: true,
              color: COLORS.mutedText,
              align: "ctr" as const,
            },
          ]),
    ],
  };
}

function buildActionsSlide(dataset: OdmScorecardDataset): PresentationSlide {
  const sections = buildActionSections(dataset.records);
  return {
    elements: [
      ...slideChrome("Action Items and Follow-up", dataset),
      ...sectionCard(
        "Recommended Follow-up",
        bulletText(sections.followUp, ODM_NO_ACTIONS_FALLBACK),
        0.65,
        1.45,
        3.85,
        4.9,
        COLORS.accentBlue
      ),
      ...sectionCard(
        "Facilities Requiring Attention",
        bulletText(sections.facilities, ODM_NO_ACTIONS_FALLBACK),
        4.75,
        1.45,
        3.85,
        4.9,
        COLORS.warning
      ),
      ...sectionCard(
        "Data Quality / Coaching Needs",
        bulletText(sections.dataQuality, ODM_NO_ACTIONS_FALLBACK),
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
  return {
    reportingYear,
    reportingMonth,
    facility: context.facility,
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
      facility: request.facility,
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
    facility: persisted.facility,
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
