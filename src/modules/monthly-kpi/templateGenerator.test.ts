import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { generateMonthlyKpiPresentation } from "./templateGenerator";
import type { BusinessUnitScorecard, MonthlyKpiPresentation, ScorecardKpiKey } from "./types";

const SCORECARD_KPI_KEYS: ScorecardKpiKey[] = [
  "pmCompliance",
  "budgetSpend",
  "pmCmWorkOrderRatio",
  "pmCmCostRatio",
  "mttrDays",
  "facilityUptime",
];

function makeBuScorecard(
  businessUnit: string,
  overrides: Partial<Record<ScorecardKpiKey, number | null>> = {}
): BusinessUnitScorecard {
  const ytd = Object.fromEntries(
    SCORECARD_KPI_KEYS.map((key) => [
      key,
      {
        value: overrides[key] ?? 0,
        status: "success",
        formatted: `${overrides[key] ?? 0}%`,
      },
    ])
  ) as Record<ScorecardKpiKey, { value: number | null; status: string; formatted: string }>;

  return {
    businessUnit,
    monthlyTrend: [],
    ytd: ytd as unknown as BusinessUnitScorecard["ytd"],
    notes: null,
    majorWins: [],
    majorRisks: ["Test risk."],
    actionItems: ["Test action."],
  };
}

function createTestData(): MonthlyKpiPresentation {
  return {
    generatedAt: new Date().toISOString(),
    reportingYear: 2026,
    reportingMonth: 6,
    reportingMonthLabel: "June 2026",
    selectedBusinessUnit: "AMD-EZ",
    businessUnits: ["AMD-EZ", "LARC"],
    buScorecards: [
      makeBuScorecard("AMD-EZ", {
        pmCompliance: 97.8,
        budgetSpend: 98,
        pmCmWorkOrderRatio: 79,
        pmCmCostRatio: 73.8,
        mttrDays: 29,
        facilityUptime: 100,
      }),
      makeBuScorecard("LARC", {
        pmCompliance: 100,
        budgetSpend: 27,
        pmCmWorkOrderRatio: 90,
        pmCmCostRatio: 63,
        mttrDays: 1,
        facilityUptime: 99.9,
      }),
    ],
    portfolioYtd: {
      pmCompliance: { value: 80, status: "warning", formatted: "80.00%" },
      budgetSpend: { value: 54, status: "warning", formatted: "54.00%" },
      pmCmWorkOrderRatio: { value: 83, status: "warning", formatted: "83.0% (4.9:1)" },
      pmCmCostRatio: { value: 71, status: "warning", formatted: "71.0% (2.4:1)" },
      mttrDays: { value: 27, status: "provisional", formatted: "27.00 days" },
      facilityUptime: { value: 99.77, status: "warning", formatted: "99.77%" },
    },
    executive: {
      slide1Observation: "AMD-EZ YTD performance: PM compliance 97.80%, budget spend 98.00%, MTTR 29.00 days. Test risk.",
      slide2Observation: "Portfolio executive readout for all business units.",
      slide3Actions: ["Action one.", "Action two.", "Action three."],
      dataNote: "Data note: MTTR remains provisional. Reporting period: June 2026.",
    },
  };
}

function getShapeCounts(xml: string) {
  return {
    total: (xml.match(/<p:sp>/g) || []).length + (xml.match(/<p:graphicFrame>/g) || []).length,
    sp: (xml.match(/<p:sp>/g) || []).length,
    gf: (xml.match(/<p:graphicFrame>/g) || []).length,
  };
}

function getTableMatrix(xml: string): string[][] {
  const matrix: string[][] = [];
  const rows = (xml.match(/<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g) || []);
  for (const row of rows) {
    const cells = (row.match(/<a:tc\b[^>]*>[\s\S]*?<\/a:tc>/g) || []);
    const rowTexts: string[] = [];
    for (const cell of cells) {
      const texts = (cell.match(/<a:t>([^<]*)<\/a:t>/g) || [])
        .map((t) => t.replace(/^<a:t>/, "").replace(/<\/a:t>$/, ""));
      rowTexts.push(texts.join(""));
    }
    matrix.push(rowTexts);
  }
  return matrix;
}

describe("generateMonthlyKpiPresentation", () => {
  it("generates a valid 3-slide PPTX blob with correct MIME type", async () => {
    const blob = await generateMonthlyKpiPresentation(createTestData());
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(blob.size).toBeGreaterThan(1000);

    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    for (let i = 1; i <= 3; i++) {
      const xml = await zip.file(`ppt/slides/slide${i}.xml`)?.async("string");
      expect(xml).toBeDefined();
    }
  });

  it("preserves template shape structure across all slides", async () => {
    const blob = await generateMonthlyKpiPresentation(createTestData());
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const expected = [
      { slide: 1, total: 5, sp: 4, gf: 1 },
      { slide: 2, total: 7, sp: 6, gf: 1 },
      { slide: 3, total: 14, sp: 13, gf: 1 },
    ];
    for (const exp of expected) {
      const xml = await zip.file(`ppt/slides/slide${exp.slide}.xml`)?.async("string");
      expect(xml).toBeDefined();
      expect(getShapeCounts(xml!)).toEqual({ total: exp.total, sp: exp.sp, gf: exp.gf });
    }
  });

  it("renders key slide titles", async () => {
    const blob = await generateMonthlyKpiPresentation(createTestData());
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string");
    const slide2 = await zip.file("ppt/slides/slide2.xml")?.async("string");
    const slide3 = await zip.file("ppt/slides/slide3.xml")?.async("string");
    expect(slide1).toContain("Monthly Reliability KPI Scorecard");
    expect(slide2).toContain("Reliability KPI Scorecard");
    expect(slide3).toContain("Three actions must be completed before the next review");
  });

  it("populates the East Zone monthly KPI table", async () => {
    const blob = await generateMonthlyKpiPresentation(createTestData());
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xml = await zip.file("ppt/slides/slide1.xml")?.async("string");
    expect(xml).toBeDefined();
    const matrix = getTableMatrix(xml!);
    expect(matrix[0]).toContain("Month");
    expect(matrix[8][0]).toBe("YTD");
    expect(matrix[9][0]).toBe("TARGET");
  });

  it("populates the All-BU KPI table", async () => {
    const blob = await generateMonthlyKpiPresentation(createTestData());
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xml = await zip.file("ppt/slides/slide2.xml")?.async("string");
    expect(xml).toBeDefined();
    const matrix = getTableMatrix(xml!);
    expect(matrix[0]).toContain("Business Unit");
    expect(matrix[8][0]).toBe("YTD (ALL BUs)");
    expect(matrix[9][0]).toBe("TARGET");
  });

  it("populates the issues matrix", async () => {
    const blob = await generateMonthlyKpiPresentation(createTestData());
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xml = await zip.file("ppt/slides/slide3.xml")?.async("string");
    expect(xml).toBeDefined();
    const matrix = getTableMatrix(xml!);
    expect(matrix[0]).toContain("KPI");
    expect(matrix.length).toBeGreaterThanOrEqual(7);
    expect(matrix[1][0]).toBe("PM Compliance");
  });

  it("matches the approved template font size floor", async () => {
    // The approved Scorecard Status template uses 9.5 pt as its smallest font size. The recovery restores the approved template, so we assert the generated deck preserves that same floor rather than an arbitrary larger minimum.
    const blob = await generateMonthlyKpiPresentation(createTestData());
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    let allXml = "";
    for (let i = 1; i <= 3; i++) {
      allXml += await zip.file(`ppt/slides/slide${i}.xml`)?.async("string") ?? "";
    }
    const sizes = (allXml.match(/ sz="(\d+)"/g) || [])
      .map((m) => Number(m.replace(' sz="', "").replace('"', "")));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(950);
  });

  it("has no legacy or placeholder proxy text", async () => {
    const blob = await generateMonthlyKpiPresentation(createTestData());
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    for (let i = 1; i <= 3; i++) {
      const xml = await zip.file(`ppt/slides/slide${i}.xml`)?.async("string");
      expect(xml).toBeDefined();
      expect(xml!.toLowerCase()).not.toContain("proxy");
      expect(xml!.toLowerCase()).not.toContain("placeholder");
      expect(xml!.toLowerCase()).not.toContain("coming soon");
    }
  });

  it("renders executive readout text", async () => {
    const blob = await generateMonthlyKpiPresentation(createTestData());
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xml = await zip.file("ppt/slides/slide1.xml")?.async("string");
    expect(xml).toContain("AMD-EZ YTD performance:");
  });
});
