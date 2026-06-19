import { inflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPresentation } from "./pptxBuilder";
import {
  ALL_FACILITIES_LABEL,
  ODM_EXECUTIVE_SUMMARY_TEMPLATE,
  type OdmScorecardDataset,
} from "./odmScorecardData";
import {
  buildOdmKpiCards,
  buildOdmSlides,
  generateOperatorDrivenMaintenanceDeck,
  ODM_DECK_TITLE,
  ODM_NO_ACTIONS_FALLBACK,
  ODM_NO_FINDINGS_FALLBACK,
  ODM_TREND_FALLBACK,
  OPERATOR_DRIVEN_MAINTENANCE_SOURCE_LABEL,
  summarizeOdmRecords,
} from "./odmGenerator";
import type {
  OdmDashboardInsight,
  OdmDashboardRow,
  OdmDashboardScorecard,
} from "../operator-driven-maintenance/dashboardSummary";

type OdmSlide = ReturnType<typeof buildOdmSlides>[number];

function jsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    json: async () => payload,
  } as unknown as Response;
}

function makeRow(overrides: Partial<OdmDashboardRow> = {}): OdmDashboardRow {
  return {
    SubmissionID: "SUB-1",
    InspectionDate: "2026-06-04",
    Inspector: "Operator A",
    AssetTag: "P-100",
    AssetName: "Influent Pump",
    Plant: "HTT STP",
    EquipmentType: "Pump",
    EquipmentName: "Influent Pump",
    Category: "Mechanical",
    Task: "Inspect pump condition",
    Capture1Label: "Condition",
    Capture1Response: "OK",
    EscalationTrigger: "None",
    EntryNotes: "",
    Status: "Pass",
    SubmittedAt: "2026-06-04T08:00:00Z",
    Score: 0,
    Findings: "",
    Frequency: "Daily",
    _dbId: 1,
    ...overrides,
  };
}

const dashboardInsight: OdmDashboardInsight = {
  type: "risk",
  severity: "high",
  title: "Recurring Issues on Same Assets",
  description:
    "3 assets show repeated negative findings across dashboard-filtered records.",
  metric: "3 assets - 24 findings",
  recommendation:
    "Schedule dedicated maintenance review for assets with repeated findings.",
  drilldown: { type: "recurring-issues-same-assets" },
};

function makeScorecard(overrides: Partial<OdmDashboardScorecard> = {}) {
  const rows = [
    makeRow({
      EntryNotes: "Inspect pump seal next shift.",
      Capture1Response: "Leak",
      Findings: "Critical pump vibration recorded.",
    }),
  ];
  const scorecard: OdmDashboardScorecard = {
    rows,
    filters: {
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
      plant: "HTT STP",
      equipmentType: "Pump",
      category: "Mechanical",
      inspector: "Operator A",
    },
    summary: {
      totalInspections: 15_932,
      uniqueAssets: 109,
      healthScore: 95.3,
      dataQualityScore: 99.5,
      predictiveRisk: "Normal",
      negativeFindings: 749,
      notesCount: 1,
      dataQualityIssueRows: 717,
      insightCount: 2,
      alertCount: 2,
      alertLabel: "2 alerts",
    },
    insights: [
      dashboardInsight,
      {
        ...dashboardInsight,
        severity: "medium",
        title: "Inspection Coverage Gaps Detected",
        metric: "5 assets overdue",
        recommendation: "Schedule overdue inspections for assets with gaps.",
      },
    ],
    facilityBreakdown: [
      {
        plant: "HTT STP",
        totalInspections: 8_000,
        uniqueAssets: 60,
        healthScore: 95.3,
        dataQualityScore: 99.5,
        negativeFindings: 400,
      },
      {
        plant: "Aglipay STP",
        totalInspections: 7_932,
        uniqueAssets: 49,
        healthScore: 96.1,
        dataQualityScore: 99.8,
        negativeFindings: 349,
      },
    ],
    findingThemes: [
      {
        category: "Pump",
        distinctAssets: 25,
        totalInspections: 300,
        cumulativePercent: 60,
      },
    ],
    trend: [
      {
        date: "2026-06-04",
        distinctAffectedAssets: 6,
        totalNegativeInspections: 12,
      },
    ],
    notes: rows,
    options: {
      years: [2026],
      months: [6],
      facilities: ["HTT STP"],
      equipmentTypes: ["Pump"],
      categories: ["Mechanical"],
      inspectors: ["Operator A"],
    },
    ...overrides,
  };
  return scorecard;
}

function makeDataset(
  scorecard = makeScorecard(),
  overrides: Partial<OdmScorecardDataset> = {}
): OdmScorecardDataset {
  return {
    records: scorecard.rows,
    scorecard,
    reportingYear: 2026,
    reportingMonth: 6,
    reportingMonthLabel: "June 2026",
    dateFrom: "2026-06-01",
    dateTo: "2026-06-30",
    facility: "HTT STP",
    equipmentType: "Pump",
    category: "Mechanical",
    inspector: "Operator A",
    template: ODM_EXECUTIVE_SUMMARY_TEMPLATE,
    ...overrides,
  };
}

function slideText(slide: OdmSlide) {
  return slide.elements
    .flatMap(element => {
      if (element.type === "text") return [element.text];
      if (element.type === "table") return element.rows.flat();
      if (element.type === "bars") return [element.title, ...element.labels];
      return [];
    })
    .join("\n");
}

function explicitFontSizes(slides: OdmSlide[]) {
  return slides.flatMap(slide =>
    slide.elements.flatMap(element => {
      if (element.type === "text" || element.type === "table") {
        return element.fontSize === undefined ? [] : [element.fontSize];
      }
      return [];
    })
  );
}

function expectGeneratorDatasetMatchesDashboardSummary(
  dataset: OdmScorecardDataset,
  scorecard: OdmDashboardScorecard
) {
  expect(dataset.scorecard.summary).toMatchObject(scorecard.summary);
  expect(buildOdmKpiCards(dataset).map(card => [card.label, card.value])).toEqual([
    ["Total Inspections", "15,932"],
    ["Unique Assets", "109"],
    ["Health Score", "95.3%"],
    ["Data Quality / Completion Rate", "99.5%"],
    ["Predictive Risk", "Normal"],
    ["Alerts / AI Insights", "2 alerts"],
  ]);
  expect(
    dataset.scorecard.insights.map(insight => ({
      title: insight.title,
      severity: insight.severity,
      recommendation: insight.recommendation,
    }))
  ).toEqual(
    scorecard.insights.map(insight => ({
      title: insight.title,
      severity: insight.severity,
      recommendation: insight.recommendation,
    }))
  );
}

function readUint16(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes: Uint8Array, offset: number) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

async function readZipEntries(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const decoder = new TextDecoder();
  const entries = new Map<string, string>();
  let eocdOffset = -1;
  const eocdSearchStart = Math.max(0, bytes.length - 66000);

  for (let offset = bytes.length - 22; offset >= eocdSearchStart; offset -= 1) {
    if (readUint32(bytes, offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  expect(eocdOffset).toBeGreaterThanOrEqual(0);

  const entryCount = readUint16(bytes, eocdOffset + 10);
  let offset = readUint32(bytes, eocdOffset + 16);

  for (let index = 0; index < entryCount; index += 1) {
    const compressionMethod = readUint16(bytes, offset + 10);
    const compressedSize = readUint32(bytes, offset + 20);
    const fileNameLength = readUint16(bytes, offset + 28);
    const extraLength = readUint16(bytes, offset + 30);
    const commentLength = readUint16(bytes, offset + 32);
    const localHeaderOffset = readUint32(bytes, offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    const name = decoder.decode(bytes.slice(nameStart, nameEnd));
    const localFileNameLength = readUint16(bytes, localHeaderOffset + 26);
    const localExtraLength = readUint16(bytes, localHeaderOffset + 28);
    const contentStart =
      localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const contentEnd = contentStart + compressedSize;
    const compressed = bytes.slice(contentStart, contentEnd);
    const content =
      compressionMethod === 0
        ? compressed
        : compressionMethod === 8
          ? inflateRawSync(compressed)
          : null;
    expect(content).not.toBeNull();
    entries.set(name, decoder.decode(content ?? new Uint8Array()));
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

class MockFileReader {
  result: string | ArrayBuffer | null = null;
  onload:
    | ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown)
    | null = null;

  readAsDataURL() {
    this.result =
      "data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,dGVzdA==";
    this.onload?.call(
      this as unknown as FileReader,
      {} as ProgressEvent<FileReader>
    );
  }
}

describe("Operator-Driven Maintenance presentation generator", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the seven-slide scorecard with required titles and footer", () => {
    const slides = buildOdmSlides(makeDataset(), new Date("2026-06-18T00:00:00Z"));
    const deckText = slides.map(slideText).join("\n");

    expect(slides).toHaveLength(7);
    expect(deckText).toContain(ODM_DECK_TITLE);
    expect(deckText).toContain("Executive Summary");
    expect(deckText).toContain("ODM KPI Cards");
    expect(deckText).toContain("Facility Breakdown");
    expect(deckText).toContain("Findings and Risk Themes");
    expect(deckText).toContain("Adoption and Execution Trend");
    expect(deckText).toContain("Action Items and Follow-up");
    expect(deckText).toContain(
      `June 2026 | HTT STP | ${OPERATOR_DRIVEN_MAINTENANCE_SOURCE_LABEL}`
    );
    expect(deckText).toContain(
      `Generated from ${OPERATOR_DRIVEN_MAINTENANCE_SOURCE_LABEL}`
    );
    expect(Math.min(...explicitFontSizes(slides))).toBeGreaterThanOrEqual(14);
  });

  it("renders dashboard headline values and AI insight content exactly", () => {
    const dataset = makeDataset();
    const slides = buildOdmSlides(dataset);
    const deckText = slides.map(slideText).join("\n");

    expect(buildOdmKpiCards(dataset).map(card => [card.label, card.value])).toEqual([
      ["Total Inspections", "15,932"],
      ["Unique Assets", "109"],
      ["Health Score", "95.3%"],
      ["Data Quality / Completion Rate", "99.5%"],
      ["Predictive Risk", "Normal"],
      ["Alerts / AI Insights", "2 alerts"],
    ]);
    expect(deckText).toContain("15,932 total inspections");
    expect(deckText).toContain("109 unique assets");
    expect(deckText).toContain("Health Score: 95.3%");
    expect(deckText).toContain("Data Quality / Completion Rate: 99.5%");
    expect(deckText).toContain("Predictive Risk: Normal");
    expect(deckText).toContain("Recurring Issues on Same Assets");
    expect(deckText).toContain("Schedule dedicated maintenance review");
    expect(deckText).toContain("Inspect pump seal next shift.");
  });

  it("keeps the generator dataset aligned with the mocked dashboard summary response", () => {
    const scorecard = makeScorecard();
    const dataset = makeDataset(scorecard);

    expectGeneratorDatasetMatchesDashboardSummary(dataset, scorecard);
  });

  it("uses clean fallbacks when insights, notes, findings, or trend data are missing", () => {
    const scorecard = makeScorecard({
      insights: [],
      findingThemes: [],
      trend: [],
      notes: [],
      rows: [makeRow({ EntryNotes: "", Findings: "", Capture1Response: "OK" })],
      summary: {
        ...makeScorecard().summary,
        insightCount: 0,
        alertCount: 0,
        alertLabel: "0 insights",
      },
    });
    const slides = buildOdmSlides(makeDataset(scorecard));
    const deckText = slides.map(slideText).join("\n");

    expect(deckText).toContain("No AI operational insights were generated");
    expect(deckText).toContain(ODM_NO_FINDINGS_FALLBACK);
    expect(deckText).toContain(ODM_NO_ACTIONS_FALLBACK);
    expect(deckText).toContain(ODM_TREND_FALLBACK);
    expect(deckText).not.toContain("vendor support");
    expect(deckText).not.toContain("fake");
  });

  it("summarizes records with dashboard definitions and preserves explicit zero scores", () => {
    const rows = [
      makeRow({ AssetTag: "A-1", Score: 0, EntryNotes: "Normal" }),
      makeRow({
        AssetTag: "A-2",
        Score: 0,
        EntryNotes: "Pump leak observed",
        Capture1Response: "Leak",
      }),
    ];

    expect(summarizeOdmRecords(rows)).toMatchObject({
      totalInspections: 2,
      uniqueAssets: 2,
      healthScore: 50,
      dataQualityScore: 100,
      predictiveRisk: "High",
      negativeFindings: 1,
    });
  });

  it("writes a valid PPTX package with seven slide parts and ODM dashboard content", async () => {
    const blob = await createPresentation(buildOdmSlides(makeDataset()));
    const entries = await readZipEntries(blob);
    const slidePaths = Array.from(entries.keys()).filter(path =>
      /^ppt\/slides\/slide\d+\.xml$/.test(path)
    );
    const slideXml = slidePaths.map(path => entries.get(path)).join("\n");

    expect(slidePaths).toHaveLength(7);
    expect(entries.has("ppt/presentation.xml")).toBe(true);
    expect(slideXml).toContain(ODM_DECK_TITLE);
    expect(slideXml).toContain("15,932");
    expect(slideXml).toContain("95.3%");
    expect(slideXml).toContain("Recurring Issues on Same Assets");
    expect(slideXml).toContain("Inspect pump seal next shift.");
  });

  it("passes selected date range and dashboard filters to the ODM summary endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(makeScorecard()));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("FileReader", MockFileReader);
    vi.stubGlobal("crypto", { randomUUID: () => "odm-deck-id" });

    const deck = await generateOperatorDrivenMaintenanceDeck({
      generatedBy: "Test User",
      reportingYear: 2026,
      reportingMonth: 6,
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
      facility: "HTT STP",
      equipmentType: "Pump",
      category: "Mechanical",
      inspector: "Operator A",
      template: ODM_EXECUTIVE_SUMMARY_TEMPLATE,
    });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toBe(
      "/api/operator-driven-maintenance/summary?date_from=2026-06-01&date_to=2026-06-30&facility_id=HTT+STP&equipment_type=Pump&category=Mechanical&inspector=Operator+A"
    );
    expect(calledUrl).not.toContain("reporting_month");
    expect(deck).toMatchObject({
      id: "odm-deck-id",
      generatorId: "operator-driven-maintenance",
      generatorName: "Operator Driven Maintenance Deck",
      reportingYear: 2026,
      reportingMonth: 6,
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
      facility: "HTT STP",
      equipmentType: "Pump",
      category: "Mechanical",
      inspector: "Operator A",
      template: ODM_EXECUTIVE_SUMMARY_TEMPLATE,
      generatedBy: "Test User",
    });
  });

  it("keeps dashboard all-date scope when context omits explicit dashboard dates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        makeScorecard({
          rows: [makeRow({ Plant: ALL_FACILITIES_LABEL })],
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("FileReader", MockFileReader);
    vi.stubGlobal("crypto", { randomUUID: () => "odm-month-bounds-id" });

    const deck = await generateOperatorDrivenMaintenanceDeck({
      generatedBy: "Test User",
      reportingYear: 2026,
      reportingMonth: 6,
      facility: ALL_FACILITIES_LABEL,
      template: ODM_EXECUTIVE_SUMMARY_TEMPLATE,
    });

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "/api/operator-driven-maintenance/summary"
    );
    expect(deck.reportingYear).toBeUndefined();
    expect(deck.reportingMonth).toBeUndefined();
    expect(deck.dateFrom).toBeUndefined();
    expect(deck.dateTo).toBeUndefined();
  });
});
