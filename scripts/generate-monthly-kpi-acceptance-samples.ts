import fs from "node:fs/promises";
import path from "node:path";
import { buildMonthlyKpiTemplateSlides } from "../src/modules/presentation-center/generators";
import { createMonthlyKpiTemplatePresentation } from "../src/modules/presentation-center/monthlyKpiTemplate";
import {
  ALL_BUSINESS_UNITS_LABEL,
  EXECUTIVE_SCORECARD_TEMPLATE,
  MONTH_NAMES,
  type KpiRecord,
  type MonthlyKpiScorecardDataset,
} from "../src/modules/presentation-center/scorecardData";

const repoRoot = path.resolve(import.meta.dirname, "..");
const templatePath = path.join(
  repoRoot,
  "public/templates/monthly-kpi-scorecard-template.potx"
);
const outputDirectory = path.join(repoRoot, "docs/samples");

const businessUnits = ["AMD-EZ", "Laguna Water", "Clark Water", "LARC"];

function record(
  businessUnit: string,
  reportingMonth: number,
  overrides: Partial<KpiRecord> = {}
): KpiRecord {
  const offset = businessUnits.indexOf(businessUnit) + reportingMonth;
  return {
    businessUnit,
    reportingMonth,
    reportingYear: 2026,
    pmCompliance: 91 + (offset % 9),
    budgetSpend: 94 + (offset % 13),
    pmCmWorkOrderRatio: 80 + (offset % 17),
    pmCmCostRatio: 55 + (offset % 16),
    mttrDays: Number((1.5 + offset / 3).toFixed(1)),
    facilityUptime: offset % 4 === 0 ? 100 : 99.9 + (offset % 3) * 0.03,
    notes: `${businessUnit} May 2026 acceptance fixture commentary.`,
    majorWins: [],
    majorRisks: [],
    actionItems: [],
    ...overrides,
  };
}

function individualDataset(
  businessUnit: string,
  reportingMonth = 5,
  overrides: Partial<MonthlyKpiScorecardDataset> = {}
): MonthlyKpiScorecardDataset {
  const ytdRecords = Array.from({ length: reportingMonth }, (_, index) =>
    record(businessUnit, index + 1, {
      notes:
        index + 1 === reportingMonth
          ? `${businessUnit} ${MONTH_NAMES[reportingMonth - 1]} 2026 acceptance fixture commentary.`
          : null,
    })
  );
  return {
    records: [ytdRecords[ytdRecords.length - 1]],
    ytdRecords,
    reportingYear: 2026,
    reportingMonth,
    reportingMonthLabel: `${MONTH_NAMES[reportingMonth - 1]} 2026`,
    businessUnit,
    template: EXECUTIVE_SCORECARD_TEMPLATE,
    ...overrides,
  };
}

function portfolioDataset(records: KpiRecord[]): MonthlyKpiScorecardDataset {
  return {
    records,
    ytdRecords: records,
    reportingYear: 2026,
    reportingMonth: 5,
    reportingMonthLabel: "May 2026",
    businessUnit: ALL_BUSINESS_UNITS_LABEL,
    template: EXECUTIVE_SCORECARD_TEMPLATE,
  };
}

async function writeDeck(
  filename: string,
  dataset: MonthlyKpiScorecardDataset,
  template: Uint8Array
) {
  const blob = await createMonthlyKpiTemplatePresentation(
    template,
    buildMonthlyKpiTemplateSlides(dataset)
  );
  await fs.writeFile(
    path.join(outputDirectory, filename),
    new Uint8Array(await blob.arrayBuffer())
  );
}

await fs.mkdir(outputDirectory, { recursive: true });
const template = await fs.readFile(templatePath);

for (const businessUnit of businessUnits) {
  await writeDeck(
    `monthly-kpi-scorecard-${businessUnit.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-may-2026.pptx`,
    individualDataset(businessUnit),
    template
  );
}

const portfolioUnits = [
  "AMD-EZ",
  "Laguna Water",
  "Clark Water",
  "Tagum Water",
  "Estate Water",
  "LARC",
];
await writeDeck(
  "monthly-kpi-scorecard-portfolio-may-2026.pptx",
  portfolioDataset(
    portfolioUnits.map((businessUnit, index) =>
      record(businessUnit, 5, {
        pmCmCostRatio: index === 1 ? null : 58 + index * 2,
        notes: `${businessUnit} portfolio acceptance fixture commentary.`,
      })
    )
  ),
  template
);

const stressUnits = Array.from(
  { length: 12 },
  (_, index) => portfolioUnits[index] ?? `Acceptance BU ${index + 1}`
);
await writeDeck(
  "monthly-kpi-scorecard-portfolio-12-bu-continuation-may-2026.pptx",
  portfolioDataset(
    stressUnits.map((businessUnit, index) =>
      record(businessUnit, 5, {
        pmCompliance: 90 + index,
        notes: `${businessUnit} continuation fixture commentary.`,
      })
    )
  ),
  template
);

await writeDeck(
  "monthly-kpi-scorecard-amd-ez-12-month-continuation-december-2026.pptx",
  individualDataset("AMD-EZ", 12),
  template
);

const longToken = "UNBROKEN-COMMENTARY-".repeat(14);
const longCommentaryRecord = record("AMD-EZ", 5, {
  notes: `First paragraph: the maintenance team documented a detailed sequence of inspection findings, corrective work, spare-parts constraints, and follow-up ownership so the complete operational context remains available to reviewers.\n\nSecond paragraph: ${longToken}\n\nThird paragraph: the team will verify completion evidence at the next monthly review and retain the original wording across continuation slides.`,
  majorWins: [
    "Completed the preventive-maintenance backlog review and assigned owners for every overdue work order.",
    "Validated the uptime recovery plan with operations, maintenance, and supply-chain representatives.",
  ],
  majorRisks: [
    "Extended lead times for critical rotating-equipment spares could delay permanent corrective work.",
    "Repeated short-duration interruptions require trend review before the next reporting cutoff.",
  ],
  actionItems: [
    "Confirm purchase-order dates, responsible owners, and escalation paths for every constrained spare.",
    "Attach inspection evidence and closure notes to the related maintenance work orders.",
    "Review the full risk register with the business-unit leadership team before month end.",
  ],
});
await writeDeck(
  "monthly-kpi-scorecard-amd-ez-long-commentary-may-2026.pptx",
  individualDataset("AMD-EZ", 5, {
    records: [longCommentaryRecord],
    ytdRecords: [
      ...Array.from({ length: 4 }, (_, index) =>
        record("AMD-EZ", index + 1, { notes: null })
      ),
      longCommentaryRecord,
    ],
  }),
  template
);

console.log(`Generated Monthly KPI acceptance samples in ${outputDirectory}`);
