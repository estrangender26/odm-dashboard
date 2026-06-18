import { blobToDataUrl } from "./storage";
import type {
  DeckGenerationContext,
  DeckGenerator,
  GeneratedPresentation,
} from "./types";
import { createPresentation } from "./pptxBuilder";
import {
  EXECUTIVE_SCORECARD_TEMPLATE,
  getPersistedMonthlyKpiScorecard,
  getScorecardSummary,
  scorecardBenchmarks,
  type KpiRecord,
  type MonthlyKpiScorecardDataset,
} from "./scorecardData";

type PresentationSlide = Parameters<typeof createPresentation>[0][number];
type PresentationElement = PresentationSlide["elements"][number];

export const MONTHLY_KPI_NOTES_FALLBACK =
  "No commentary was recorded for the selected reporting period.";

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function formatDeckValue(value: number | null | undefined, digits = 2) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(digits)}%`
    : "--";
}

function formatPmCmEquivalentRatio(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  if (value >= 100) return "No CM";
  const cmShare = 100 - value;
  if (cmShare <= 0) return "No CM";
  return `${(value / cmShare).toFixed(1)}:1`;
}

function formatDeckPmCmRatio(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${formatDeckValue(value)}\n(${formatPmCmEquivalentRatio(value)})`;
}

export function buildMonthlyKpiTableRows(records: KpiRecord[]) {
  return [
    ["Business Unit", ...scorecardBenchmarks.map(benchmark => benchmark.label)],
    ...records.map(record => [
      record.businessUnit,
      formatDeckValue(record.pmCompliance),
      formatDeckValue(record.budgetSpend),
      formatDeckPmCmRatio(record.pmCmWorkOrderRatio),
      formatDeckPmCmRatio(record.pmCmCostRatio),
      formatDeckValue(record.mttrDays, 2).replace("%", " days"),
      formatDeckValue(record.facilityUptime),
      record.notes || "",
    ]),
  ];
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
    template: context.template ?? EXECUTIVE_SCORECARD_TEMPLATE,
  };
}

function chartElementForMetric(
  records: KpiRecord[],
  metric: "pmCompliance" | "facilityUptime",
  title: string,
  x: number
): PresentationElement {
  const rows = records.filter(
    record =>
      typeof record[metric] === "number" && Number.isFinite(record[metric])
  );
  if (!rows.length) {
    return {
      type: "text",
      text: `${title}\nNo chartable values were recorded for this metric.`,
      x,
      y: 1.05,
      w: 5.85,
      h: 4.9,
      fontSize: 14,
      color: "334155",
      fill: "F8FAFC",
    };
  }
  return {
    type: "bars",
    title,
    labels: rows.map(record => record.businessUnit),
    values: rows.map(record => record[metric] as number),
    x,
    y: 1.05,
    w: 5.85,
    h: 4.9,
    max: 100,
  };
}

export function buildMonthlyKpiNotesText(records: KpiRecord[]) {
  const notes = records
    .map(record => ({
      businessUnit: record.businessUnit,
      note: record.notes?.trim() || "",
    }))
    .filter(record => record.note);
  if (!notes.length) return MONTHLY_KPI_NOTES_FALLBACK;
  return notes
    .map(record => `${record.businessUnit}\n${record.note}`)
    .join("\n\n");
}

export function buildMonthlyKpiSlides(
  dataset: MonthlyKpiScorecardDataset,
  generatedAt = new Date()
): PresentationSlide[] {
  const scorecardRecords = dataset.records;
  const reportingMonth = dataset.reportingMonthLabel;
  const businessUnit = dataset.businessUnit;
  const summary = getScorecardSummary(scorecardRecords);
  const titleScope = `${businessUnit} | ${reportingMonth}`;

  return [
    {
      elements: [
        {
          type: "text",
          text: "ODM Dashboard",
          x: 0.65,
          y: 0.35,
          w: 3.4,
          h: 0.35,
          fontSize: 14,
          bold: true,
          color: "005BAC",
        },
        {
          type: "text",
          text: `Monthly KPI Scorecard\n${businessUnit}\n${reportingMonth}`,
          x: 0.65,
          y: 1.25,
          w: 8.2,
          h: 1.95,
          fontSize: 34,
          bold: true,
          color: "0B1D44",
        },
        {
          type: "text",
          text: `Reporting Period: ${reportingMonth}\nBusiness Unit: ${businessUnit}`,
          x: 0.7,
          y: 3.65,
          w: 6.2,
          h: 0.8,
          fontSize: 18,
          color: "334155",
        },
        {
          type: "text",
          text: "Generated directly from persisted Monthly KPI records",
          x: 0.7,
          y: 5.85,
          w: 6.2,
          h: 0.4,
          fontSize: 13,
          color: "64748B",
        },
        {
          type: "text",
          text: generatedAt.toLocaleString(),
          x: 8.4,
          y: 6.25,
          w: 3.7,
          h: 0.3,
          fontSize: 10,
          color: "64748B",
          align: "r",
        },
      ],
    },
    {
      elements: [
        {
          type: "text",
          text: `Executive Summary\n${titleScope}`,
          x: 0.55,
          y: 0.35,
          w: 8.5,
          h: 0.75,
          fontSize: 24,
          bold: true,
          color: "0B1D44",
        },
        {
          type: "text",
          text: `Key KPI Highlights\n• ${summary.highlights.join("\n• ")}`,
          x: 0.65,
          y: 1.25,
          w: 3.85,
          h: 4.8,
          fontSize: 14,
          color: "1F2937",
          fill: "EEF6FF",
        },
        {
          type: "text",
          text: `Major Wins\n• ${summary.wins.join("\n• ")}`,
          x: 4.75,
          y: 1.25,
          w: 3.85,
          h: 4.8,
          fontSize: 14,
          color: "1F2937",
          fill: "ECFDF5",
        },
        {
          type: "text",
          text: `Major Risks\n• ${summary.risks.join("\n• ")}`,
          x: 8.85,
          y: 1.25,
          w: 3.85,
          h: 4.8,
          fontSize: 14,
          color: "1F2937",
          fill: "FEF2F2",
        },
      ],
    },
    {
      elements: [
        {
          type: "text",
          text: `KPI Scorecard Table\n${titleScope}`,
          x: 0.55,
          y: 0.35,
          w: 8.5,
          h: 0.75,
          fontSize: 24,
          bold: true,
          color: "0B1D44",
        },
        {
          type: "table",
          rows: buildMonthlyKpiTableRows(scorecardRecords),
          x: 0.45,
          y: 1.2,
          w: 12.45,
          h: 4.2,
          fontSize: 8,
        },
        {
          type: "table",
          rows: [
            ["KPI", "Benchmark"],
            ...scorecardBenchmarks.map(benchmark => [
              benchmark.label,
              benchmark.benchmark,
            ]),
          ],
          x: 0.45,
          y: 5.7,
          w: 5.4,
          h: 1.1,
          fontSize: 8,
        },
      ],
    },
    {
      elements: [
        {
          type: "text",
          text: `KPI Charts Summary\n${titleScope}`,
          x: 0.55,
          y: 0.35,
          w: 8.5,
          h: 0.75,
          fontSize: 24,
          bold: true,
          color: "0B1D44",
        },
        chartElementForMetric(
          scorecardRecords,
          "pmCompliance",
          "PM Compliance by Business Unit",
          0.75
        ),
        chartElementForMetric(
          scorecardRecords,
          "facilityUptime",
          "Facility Uptime by Business Unit",
          7.0
        ),
        {
          type: "text",
          text: "Charts include only persisted numeric values; explicit zero values remain zero.",
          x: 0.75,
          y: 6.25,
          w: 10.5,
          h: 0.3,
          fontSize: 11,
          color: "64748B",
        },
      ],
    },
    {
      elements: [
        {
          type: "text",
          text: `Issues and Action Items\n${titleScope}`,
          x: 0.55,
          y: 0.35,
          w: 9.2,
          h: 0.75,
          fontSize: 24,
          bold: true,
          color: "0B1D44",
        },
        {
          type: "text",
          text: "Recorded Notes",
          x: 0.75,
          y: 1.15,
          w: 4.2,
          h: 0.35,
          fontSize: 16,
          bold: true,
          color: "0B1D44",
        },
        {
          type: "text",
          text: buildMonthlyKpiNotesText(scorecardRecords),
          x: 0.75,
          y: 1.6,
          w: 11.7,
          h: 4.9,
          fontSize: 14,
          color: "1F2937",
          fill: "F8FAFC",
        },
      ],
    },
  ];
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
  const blob = createPresentation(buildMonthlyKpiSlides(persisted, now));
  const dataUrl = await blobToDataUrl(blob);
  return {
    id: crypto.randomUUID(),
    name: `${slug(title)}.pptx`,
    type: "Monthly KPI Scorecard Deck",
    generatedDate: now.toISOString(),
    generatedBy: context.generatedBy,
    size: blob.size,
    dataUrl,
    reportingYear: persisted.reportingYear,
    reportingMonth: persisted.reportingMonth,
    businessUnit: persisted.businessUnit,
    template: persisted.template,
  };
}

const placeholderGenerators: DeckGenerator[] = [
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
    title: "O&M Manual Governance Deck",
    description:
      "Reserved generator for manual governance metrics, ownership, review cadence, compliance gaps, and approval workflow summaries.",
    category: "O&M Manual Governance",
    status: "coming-soon",
    slideOutline: [
      "Governance snapshot",
      "Owner matrix",
      "Review cadence",
      "Compliance gaps",
      "Approval actions",
    ],
    enabled: false,
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
    id: "operator-driven-maintenance",
    title: "Operator Driven Maintenance Deck",
    description:
      "Reserved generator for operator-driven maintenance adoption, inspection outcomes, finding trends, and site coaching needs.",
    category: "Operator Driven Maintenance",
    status: "coming-soon",
    slideOutline: [
      "ODM adoption",
      "Inspection outcomes",
      "Finding trends",
      "Coaching needs",
      "Next-cycle actions",
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
      "Create a five-slide PowerPoint deck from persisted Monthly KPI database records.",
    category: "Monthly KPI Scorecard",
    status: "active",
    slideOutline: [
      "Title and reporting scope",
      "Executive summary",
      "KPI scorecard table",
      "KPI charts summary",
      "Issues and action items",
    ],
    enabled: true,
    generate: generateMonthlyKpiDeck,
  },
  ...placeholderGenerators,
];
