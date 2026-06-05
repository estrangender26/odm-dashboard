import { blobToDataUrl } from "./storage";
import type { DeckGenerationContext, DeckGenerator, GeneratedPresentation } from "./types";
import { createPresentation } from "./pptxBuilder";
import { currentMonthlyKpiScorecard, getReportingMonthLabel, getScorecardSummary, scorecardBenchmarks } from "./scorecardData";

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function kpiRows() {
  return [
    ["Business Unit", ...scorecardBenchmarks.map((benchmark) => benchmark.label)],
    ...currentMonthlyKpiScorecard.map((record) => [
      record.businessUnit,
      `${record.pmCompliance.toFixed(1)}%`,
      `${record.pmCmWorkOrderRatio.toFixed(1)}%`,
      `${record.budgetSpend.toFixed(1)}%`,
      `${record.pmCmCostRatio.toFixed(1)}%`,
      `${record.facilityUptime.toFixed(2)}%`,
    ]),
  ];
}

async function generateMonthlyKpiDeck(context: DeckGenerationContext): Promise<GeneratedPresentation> {
  const reportingMonth = context.reportingMonth || getReportingMonthLabel();
  const businessUnit = context.businessUnit || "All Business Units";
  const summary = getScorecardSummary();
  const now = new Date();
  const title = `Monthly KPI Scorecard Deck - ${reportingMonth}`;
  const blob = createPresentation([
    {
      elements: [
        { type: "text", text: "ODM Dashboard", x: 0.65, y: 0.35, w: 3.4, h: 0.35, fontSize: 14, bold: true, color: "005BAC" },
        { type: "text", text: "Monthly KPI Scorecard", x: 0.65, y: 1.55, w: 7.5, h: 0.65, fontSize: 34, bold: true, color: "0B1D44" },
        { type: "text", text: `Reporting Month: ${reportingMonth}\nBusiness Unit: ${businessUnit}`, x: 0.7, y: 2.45, w: 6.2, h: 0.8, fontSize: 18, color: "334155" },
        { type: "text", text: "Generated directly from dashboard KPI data", x: 0.7, y: 5.95, w: 6.2, h: 0.4, fontSize: 13, color: "64748B" },
        { type: "text", text: now.toLocaleString(), x: 9.0, y: 6.25, w: 3.1, h: 0.3, fontSize: 10, color: "64748B", align: "r" },
      ],
    },
    {
      elements: [
        { type: "text", text: "Executive Summary", x: 0.55, y: 0.35, w: 6, h: 0.45, fontSize: 26, bold: true, color: "0B1D44" },
        { type: "text", text: `Key KPI Highlights\n• ${summary.highlights.join("\n• ")}`, x: 0.65, y: 1.15, w: 3.85, h: 4.8, fontSize: 14, color: "1F2937", fill: "EEF6FF" },
        { type: "text", text: `Major Wins\n• ${summary.wins.join("\n• ")}`, x: 4.75, y: 1.15, w: 3.85, h: 4.8, fontSize: 14, color: "1F2937", fill: "ECFDF5" },
        { type: "text", text: `Major Risks\n• ${summary.risks.join("\n• ")}`, x: 8.85, y: 1.15, w: 3.85, h: 4.8, fontSize: 14, color: "1F2937", fill: "FEF2F2" },
      ],
    },
    {
      elements: [
        { type: "text", text: "KPI Scorecard Table", x: 0.55, y: 0.35, w: 7, h: 0.45, fontSize: 26, bold: true, color: "0B1D44" },
        { type: "table", rows: kpiRows(), x: 0.45, y: 1.05, w: 12.45, h: 4.2, fontSize: 8 },
        { type: "table", rows: [["KPI", "Benchmark"], ...scorecardBenchmarks.map((benchmark) => [benchmark.label, benchmark.benchmark])], x: 0.45, y: 5.55, w: 5.4, h: 1.1, fontSize: 8 },
      ],
    },
    {
      elements: [
        { type: "text", text: "KPI Charts Summary", x: 0.55, y: 0.35, w: 7, h: 0.45, fontSize: 26, bold: true, color: "0B1D44" },
        { type: "bars", title: "PM Compliance by Business Unit", labels: currentMonthlyKpiScorecard.map((record) => record.businessUnit), values: currentMonthlyKpiScorecard.map((record) => record.pmCompliance), x: 0.75, y: 1.05, w: 5.85, h: 4.9, max: 100 },
        { type: "bars", title: "Facility Uptime by Business Unit", labels: currentMonthlyKpiScorecard.map((record) => record.businessUnit), values: currentMonthlyKpiScorecard.map((record) => record.facilityUptime), x: 7.0, y: 1.05, w: 5.85, h: 4.9, max: 100 },
        { type: "text", text: "Green bars indicate values at or above the primary scorecard threshold.", x: 0.75, y: 6.25, w: 10.5, h: 0.3, fontSize: 11, color: "64748B" },
      ],
    },
    {
      elements: [
        { type: "text", text: "Issues and Action Items", x: 0.55, y: 0.35, w: 7, h: 0.45, fontSize: 26, bold: true, color: "0B1D44" },
        { type: "text", text: `Key Concerns\n• ${summary.concerns.join("\n• ")}`, x: 0.75, y: 1.15, w: 5.8, h: 4.9, fontSize: 15, color: "1F2937", fill: "FFF7ED" },
        { type: "text", text: `Recommended Actions & Follow-up\n• ${summary.actions.join("\n• ")}`, x: 6.85, y: 1.15, w: 5.8, h: 4.9, fontSize: 15, color: "1F2937", fill: "F8FAFC" },
      ],
    },
  ]);
  const dataUrl = await blobToDataUrl(blob);
  return {
    id: crypto.randomUUID(),
    name: `${slug(title)}.pptx`,
    type: "Monthly KPI Scorecard Deck",
    generatedDate: now.toISOString(),
    generatedBy: context.generatedBy,
    size: blob.size,
    dataUrl,
  };
}

const placeholderGenerators: DeckGenerator[] = [
  {
    id: "om-manual-governance",
    title: "Generate O&M Manual Governance Deck",
    description: "Framework placeholder for governance metrics and manual compliance summaries.",
    category: "O&M Manual Governance",
    enabled: false,
    generate: async () => Promise.reject(new Error("O&M Manual Governance generation is planned for a future release.")),
  },
  {
    id: "post-ppp-planning",
    title: "Generate Post-PPP Planning Deck",
    description: "Framework placeholder for post-PPP insights, actions, and planning outcomes.",
    category: "Post-PPP Planning",
    enabled: false,
    generate: async () => Promise.reject(new Error("Post-PPP Planning generation is planned for a future release.")),
  },
  {
    id: "gantt-progress",
    title: "Generate Gantt Progress Deck",
    description: "Framework placeholder for schedule status, milestones, and critical path updates.",
    category: "Gantt Progress",
    enabled: false,
    generate: async () => Promise.reject(new Error("Gantt Progress generation is planned for a future release.")),
  },
];

export const deckGeneratorRegistry: DeckGenerator[] = [
  {
    id: "monthly-kpi-scorecard",
    title: "Generate Monthly KPI Scorecard Deck",
    description: "Create a five-slide PowerPoint deck from the current Monthly KPI Scorecard dataset.",
    category: "Monthly KPI Scorecard",
    enabled: true,
    generate: generateMonthlyKpiDeck,
  },
  ...placeholderGenerators,
];
