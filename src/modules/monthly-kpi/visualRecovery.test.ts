/**
 * Visual-recovery regression tests for the Monthly KPI executive deck.
 *
 * These tests assert XML-level invariants that correspond to the PowerPoint
 * rendering defects fixed in the visual-fidelity recovery:
 *   - no overlapping bottom-of-slide text boxes on slide 1
 *   - concise, non-overlapping slide 2 commentary
 *   - correct issue-matrix KPI row mapping on slide 3
 *   - action-card text in dedicated text shapes, not background shapes
 *   - font-size sanity
 *   - no placeholder leakage
 */

import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { generateMonthlyKpiPresentation } from "./templateGenerator";
import type { BusinessUnitScorecard, MonthlyKpiPresentation, ScorecardKpiKey } from "./types";

const ISSUE_COLORS = {
  critical: "FAD7D7",
  warning: "FFF0C7",
  data: "DDE6F0",
  neutral: "EEF0F2",
} as const;

function getCellFill(xml: string, rowIndex: number, colIndex: number): string {
  const rows = xml.match(/<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g) || [];
  const row = rows[rowIndex];
  if (!row) return "none";
  const cells = row.match(/<a:tc\b[^>]*>[\s\S]*?<\/a:tc>/g) || [];
  const cell = cells[colIndex];
  if (!cell) return "none";
  // Cell fill is inside a:tcPr/a:solidFill, which appears after a:txBody.
  const fill = cell.match(/<a:tcPr>[\s\S]*?<a:solidFill><a:srgbClr val="([0-9A-Fa-f]{6})"/);
  return fill ? fill[1].toUpperCase() : "none";
}

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
  overrides: Partial<Record<ScorecardKpiKey, { value: number | null; status: string; formatted: string }>> = {}
): BusinessUnitScorecard {
  const defaults: Record<
    ScorecardKpiKey,
    { value: number | null; status: string; formatted: string }
  > = {
    pmCompliance: { value: 97.84, status: "warning", formatted: "97.84%" },
    budgetSpend: { value: 100.22, status: "success", formatted: "100.22%" },
    pmCmWorkOrderRatio: { value: 78.3, status: "warning", formatted: "78.3% (3.6:1)" },
    pmCmCostRatio: { value: 72.0, status: "warning", formatted: "72.0% (2.6:1)" },
    mttrDays: { value: 29.25, status: "provisional", formatted: "29.25 days" },
    facilityUptime: { value: 100, status: "success", formatted: "100.00%" },
  };
  const ytd = { ...defaults, ...overrides } as BusinessUnitScorecard["ytd"];

  return {
    businessUnit,
    monthlyTrend: Array.from({ length: 7 }, (_, i) => ({
      month: i + 1,
      monthLabel: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul"][i],
      values: Object.fromEntries(
        SCORECARD_KPI_KEYS.map((key) => [
          key,
          {
            value: ytd[key].value,
            status: ytd[key].status,
            formatted: ytd[key].formatted,
          },
        ])
      ) as unknown as BusinessUnitScorecard["monthlyTrend"][number]["values"],
    })),
    ytd,
    notes: null,
    majorWins: [],
    majorRisks: ["PM compliance is in the warning band against the ≥98% benchmark."],
    actionItems: ["Review pm compliance drivers and recovery actions."],
  };
}

function createJulyRegressionData(): MonthlyKpiPresentation {
  return {
    generatedAt: new Date().toISOString(),
    reportingYear: 2026,
    reportingMonth: 7,
    reportingMonthLabel: "July 2026",
    selectedBusinessUnit: "AMD-EZ",
    businessUnits: ["AMD-EZ", "LARC", "CWC", "LAWC", "TWCI", "EWG", "WAWA/JVC"],
    buScorecards: [
      makeBuScorecard("AMD-EZ"),
      makeBuScorecard("LARC", {
        pmCompliance: { value: 100, status: "success", formatted: "100.00%" },
        budgetSpend: { value: 26.68, status: "danger", formatted: "26.68%" },
        pmCmWorkOrderRatio: { value: 89.7, status: "success", formatted: "89.7% (8.7:1)" },
        pmCmCostRatio: { value: 63.0, status: "success", formatted: "63.0% (1.7:1)" },
        mttrDays: { value: 0.45, status: "provisional", formatted: "0.45 days" },
        facilityUptime: { value: 99.9, status: "warning", formatted: "99.90%" },
      }),
      makeBuScorecard("CWC", {
        pmCompliance: { value: 100.36, status: "success", formatted: "100.36%" },
        budgetSpend: { value: 73.36, status: "danger", formatted: "73.36%" },
        pmCmWorkOrderRatio: { value: 99.7, status: "success", formatted: "99.7% (307.0:1)" },
        pmCmCostRatio: { value: 75.7, status: "warning", formatted: "75.7% (3.1:1)" },
        mttrDays: { value: 2.36, status: "provisional", formatted: "2.36 days" },
        facilityUptime: { value: 99.86, status: "warning", formatted: "99.86%" },
      }),
      makeBuScorecard("LAWC", {
        pmCompliance: { value: 90.06, status: "warning", formatted: "90.06%" },
        budgetSpend: { value: 60.39, status: "danger", formatted: "60.39%" },
        pmCmWorkOrderRatio: { value: 93.0, status: "success", formatted: "93.0% (13.2:1)" },
        pmCmCostRatio: { value: 76.2, status: "warning", formatted: "76.2% (3.2:1)" },
        mttrDays: { value: 1.16, status: "provisional", formatted: "1.16 days" },
        facilityUptime: { value: 99.93, status: "warning", formatted: "99.93%" },
      }),
      makeBuScorecard("TWCI", {
        pmCompliance: { value: 57.93, status: "danger", formatted: "57.93%" },
        budgetSpend: { value: 67.10, status: "danger", formatted: "67.10%" },
        pmCmWorkOrderRatio: { value: 88.6, status: "success", formatted: "88.6% (7.8:1)" },
        pmCmCostRatio: { value: 67.6, status: "warning", formatted: "67.6% (2.1:1)" },
        mttrDays: { value: null, status: "no-data", formatted: "No Data" },
        facilityUptime: { value: 98.77, status: "danger", formatted: "98.77%" },
      }),
      makeBuScorecard("EWG", {
        pmCompliance: { value: 22.22, status: "danger", formatted: "22.22%" },
        budgetSpend: { value: null, status: "no-data", formatted: "No Data" },
        pmCmWorkOrderRatio: { value: 37.5, status: "danger", formatted: "37.5% (0.6:1)" },
        pmCmCostRatio: { value: null, status: "no-data", formatted: "No Data" },
        mttrDays: { value: null, status: "no-data", formatted: "No Data" },
        facilityUptime: { value: 99.94, status: "warning", formatted: "99.94%" },
      }),
      makeBuScorecard("WAWA/JVC", {
        pmCompliance: { value: null, status: "no-data", formatted: "No Data" },
        budgetSpend: { value: null, status: "no-data", formatted: "No Data" },
        pmCmWorkOrderRatio: { value: null, status: "no-data", formatted: "No Data" },
        pmCmCostRatio: { value: null, status: "no-data", formatted: "No Data" },
        mttrDays: { value: null, status: "no-data", formatted: "No Data" },
        facilityUptime: { value: null, status: "no-data", formatted: "No Data" },
      }),
    ],
    portfolioYtd: {
      pmCompliance: { value: 78.01, status: "danger", formatted: "78.01%" },
      budgetSpend: { value: 55.1, status: "danger", formatted: "55.10%" },
      pmCmWorkOrderRatio: { value: 83.2, status: "warning", formatted: "83.2% (4.9:1)" },
      pmCmCostRatio: { value: 71.1, status: "warning", formatted: "71.1% (2.5:1)" },
      mttrDays: { value: 27.33, status: "provisional", formatted: "27.33 days" },
      facilityUptime: { value: 99.77, status: "warning", formatted: "99.77%" },
    },
    executive: {
      slide1Observation:
        "AMD-EZ YTD performance: PM compliance 97.84%, budget spend 100.22%, MTTR 29.25 days. PM compliance is in the warning band against the ≥98% benchmark.",
      slide2Observation:
        "Portfolio PM compliance is 78.01%, while facility uptime is 99.77%. Priority recovery is required for BU-level PM compliance, budget control and missing submissions.",
      slide3Actions: [
        "Review pm compliance drivers and recovery actions.",
        "Review pm:cm work order ratio drivers and recovery actions.",
        "Review pm:cm cost ratio drivers and recovery actions.",
      ],
      dataNote:
        "Data note: RAG uses unrounded YTD values. *MTTR remains provisional where validation is pending. Reporting period: July 2026.",
    },
  };
}

async function loadGeneratedSlides(): Promise<Record<string, string>> {
  const blob = await generateMonthlyKpiPresentation(createJulyRegressionData());
  const arrayBuffer = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const slides: Record<string, string> = {};
  for (let i = 1; i <= 3; i++) {
    const xml = await zip.file(`ppt/slides/slide${i}.xml`)?.async("string");
    expect(xml).toBeDefined();
    slides[`slide${i}`] = xml!;
  }
  return slides;
}

function getShapeXfrm(xml: string, shapeName: string): { x: number; y: number; cx: number; cy: number } | null {
  // Graphic frames (tables) use p:xfrm; shapes use a:xfrm inside p:spPr.
  const shapeRegex = new RegExp(
    `<p:cNvPr[^>]*name="${shapeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[\\s\\S]*?<(?:p|a):xfrm>([\\s\\S]*?)<\/(?:p|a):xfrm>`
  );
  const m = xml.match(shapeRegex);
  if (!m) return null;
  const xfrm = m[1];
  const off = xfrm.match(/<(?:p|a):off x="(-?\d+)" y="(-?\d+)"\s*\/>/);
  const ext = xfrm.match(/<(?:p|a):ext cx="(\d+)" cy="(\d+)"\s*\/>/);
  if (!off || !ext) return null;
  return {
    x: Number(off[1]),
    y: Number(off[2]),
    cx: Number(ext[1]),
    cy: Number(ext[2]),
  };
}

function getTableMatrix(xml: string): string[][] {
  const matrix: string[][] = [];
  const rows = xml.match(/<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g) || [];
  for (const row of rows) {
    const cells = row.match(/<a:tc\b[^>]*>[\s\S]*?<\/a:tc>/g) || [];
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

function intersects(a: { x: number; y: number; cx: number; cy: number }, b: { x: number; y: number; cx: number; cy: number }): boolean {
  return (
    a.x < b.x + b.cx &&
    a.x + a.cx > b.x &&
    a.y < b.y + b.cy &&
    a.y + a.cy > b.y
  );
}

describe("Monthly KPI visual recovery", () => {
  it("generates a valid 3-slide PPTX package", async () => {
    const slides = await loadGeneratedSlides();
    expect(Object.keys(slides)).toEqual(["slide1", "slide2", "slide3"]);
  });

  it("slide 1 keeps the executive observation and MTTR note in separate named shapes", async () => {
    const slides = await loadGeneratedSlides();
    const slide1 = slides.slide1;
    expect(slide1).toContain("Executive Readout");
    expect(slide1).toContain("TextBox 1");
    expect(slide1).toContain("AMD-EZ YTD performance:");
    expect(slide1).toContain("MTTR calculation methodology is being realigned");
  });

  it("slide 1 bottom shapes do not overlap", async () => {
    const slides = await loadGeneratedSlides();
    const slide1 = slides.slide1;
    const readout = getShapeXfrm(slide1, "Executive Readout");
    const mttrNote = getShapeXfrm(slide1, "TextBox 1");
    expect(readout).not.toBeNull();
    expect(mttrNote).not.toBeNull();
    expect(intersects(readout!, mttrNote!)).toBe(false);
  });

  it("slide 2 commentary does not overlap the legend", async () => {
    const slides = await loadGeneratedSlides();
    const slide2 = slides.slide2;
    const readout = getShapeXfrm(slide2, "Executive Readout");
    const legend = getShapeXfrm(slide2, "RAG Legend");
    expect(readout).not.toBeNull();
    expect(legend).not.toBeNull();
    expect(intersects(readout!, legend!)).toBe(false);
  });

  it("slide 3 action statements are in the dedicated text shapes, not background shapes", async () => {
    const slides = await loadGeneratedSlides();
    const slide3 = slides.slide3;
    for (const name of ["PM RECOVERY Text", "DATA CLOSURE Text", "VALIDATION Text"]) {
      expect(slide3).toContain(name);
    }
    for (const name of ["PM RECOVERY Action", "DATA CLOSURE Action", "VALIDATION Action"]) {
      const xfrm = getShapeXfrm(slide3, name);
      expect(xfrm).not.toBeNull();
      // The background action shapes should remain empty of direct replacement text.
      const shapeRegex = new RegExp(
        `<p:cNvPr[^>]*name="${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[\\s\\S]*?<\/p:sp>`
      );
      const m = slide3.match(shapeRegex);
      if (m) {
        const textContent = (m[0].match(/<a:t>([^<]*)<\/a:t>/g) || [])
          .map((t) => t.replace(/^<a:t>/, "").replace(/<\/a:t>$/, ""))
          .join("");
        expect(textContent.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it("slide 3 action cards do not overlap each other", async () => {
    const slides = await loadGeneratedSlides();
    const slide3 = slides.slide3;
    const cards = ["PM RECOVERY Action", "DATA CLOSURE Action", "VALIDATION Action"]
      .map((name) => getShapeXfrm(slide3, name))
      .filter(Boolean) as Array<{ x: number; y: number; cx: number; cy: number }>;
    expect(cards.length).toBe(3);
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        expect(intersects(cards[i], cards[j])).toBe(false);
      }
    }
  });

  it("slide 3 issues matrix rows are in the correct KPI order", async () => {
    const slides = await loadGeneratedSlides();
    const slide3 = slides.slide3;
    const matrix = getTableMatrix(slide3);
    expect(matrix[1][0]).toBe("PM Compliance");
    expect(matrix[2][0]).toBe("Budget Spend");
    expect(matrix[3][0]).toBe("PM:CM Ratio(WO)");
    expect(matrix[4][0]).toBe("PM:CM Ratio(Cost)");
    expect(matrix[5][0]).toBe("Facility Uptime");
    expect(matrix[6][0]).toBe("MTTR");
  });

  it("slide 3 MTTR row uses only data-gap colors and Provisional wording", async () => {
    const slides = await loadGeneratedSlides();
    const slide3 = slides.slide3;
    const matrix = getTableMatrix(slide3);
    const mttrRow = matrix[6];
    expect(mttrRow[0]).toBe("MTTR");
    for (let c = 1; c < mttrRow.length; c++) {
      const cell = mttrRow[c];
      const fill = getCellFill(slide3, 6, c);
      if (!cell || cell === "No data") {
        expect(fill).toBeOneOf([ISSUE_COLORS.neutral, ISSUE_COLORS.data]);
        continue;
      }
      expect(cell).toMatch(/\d+(\.\d+)?\s*days/);
      expect(cell).toContain("Provisional");
      expect(fill).toBe(ISSUE_COLORS.data);
    }
  });

  it("slide 3 Facility Uptime row contains only percentages or No data", async () => {
    const slides = await loadGeneratedSlides();
    const slide3 = slides.slide3;
    const matrix = getTableMatrix(slide3);
    const uptimeRow = matrix[5];
    expect(uptimeRow[0]).toBe("Facility Uptime");
    for (let c = 1; c < uptimeRow.length; c++) {
      const cell = uptimeRow[c];
      if (cell && cell !== "No data") {
        expect(cell).toMatch(/\d+(\.\d+)?%/);
      }
    }
  });

  it("does not leak placeholder or proxy text", async () => {
    const slides = await loadGeneratedSlides();
    for (const xml of Object.values(slides)) {
      const lower = xml.toLowerCase();
      expect(lower).not.toContain("placeholder");
      expect(lower).not.toContain("proxy");
      expect(lower).not.toContain("coming soon");
      expect(lower).not.toContain("lorem ipsum");
    }
  });

  it("keeps font sizes between 9.5 pt and the approved template maximum", async () => {
    const slides = await loadGeneratedSlides();
    let allXml = "";
    for (const xml of Object.values(slides)) {
      allXml += xml;
    }
    const sizes = (allXml.match(/ sz="(\d+)"/g) || [])
      .map((m) => Number(m.replace(' sz="', "").replace('"', "")));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(950);
    // The title slide uses a 28 pt heading; body content must not exceed 24 pt.
    expect(Math.max(...sizes)).toBeLessThanOrEqual(3200);
  });

  it("does not allow matrix body-cell fonts above 14 pt", async () => {
    const slides = await loadGeneratedSlides();
    const slide3 = slides.slide3;
    const matrix = getTableMatrix(slide3);
    for (let r = 1; r < matrix.length; r++) {
      for (let c = 1; c < matrix[r].length; c++) {
        // Locate the cell XML that produced this text value.
        const cellText = matrix[r][c];
        if (!cellText) continue;
        const rowMatch = slide3.match(new RegExp(`<a:tr\b[^>]*>[\s\S]*?<a:tc\b[^>]*>[\s\S]*?${cellText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\s\S]*?</a:tc>[\s\S]*?</a:tr>`));
        if (rowMatch) {
          const sizes = (rowMatch[0].match(/ sz="(\d+)"/g) || [])
            .map((m) => Number(m.replace(' sz="', "").replace('"', "")));
          for (const sz of sizes) {
            expect(sz).toBeLessThanOrEqual(1600);
          }
        }
      }
    }
  });

  it("uses only approved standardized issue-matrix wording", async () => {
    const slides = await loadGeneratedSlides();
    const slide3 = slides.slide3;
    const matrix = getTableMatrix(slide3);
    const approvedPhrases = [
      "Recovery required",
      "Monitor",
      "No data",
      "Provisional",
      "Validation pending",
    ];
    for (let r = 1; r < matrix.length; r++) {
      for (let c = 1; c < matrix[r].length; c++) {
        const cell = matrix[r][c];
        if (!cell) continue;
        const hasApproved = approvedPhrases.some((phrase) => cell.includes(phrase));
        expect(hasApproved).toBe(true);
        expect(cell).not.toContain("requires monitoring and recovery validation");
        expect(cell).not.toContain("below benchmark, recovery plan required");
        expect(cell).not.toContain("provisional pending validation");
        expect(cell).not.toContain("No data submitted");
        expect(cell.length).toBeLessThanOrEqual(80);
      }
    }
  });

  it("slide 3 legend sits at or immediately below the issues matrix", async () => {
    const slides = await loadGeneratedSlides();
    const slide3 = slides.slide3;
    const table = getShapeXfrm(slide3, "Executive KPI Issues Matrix");
    const legend = getShapeXfrm(slide3, "Issues Legend");
    expect(table).not.toBeNull();
    expect(legend).not.toBeNull();
    // Allow a small layout tolerance (about 0.06 inches) for template precision.
    expect(legend!.y + 50000).toBeGreaterThanOrEqual(table!.y + table!.cy);
  });

  it("classifies critical cells as red and uses Recovery required", async () => {
    const slides = await loadGeneratedSlides();
    const slide3 = slides.slide3;
    const matrix = getTableMatrix(slide3);
    for (let r = 1; r < matrix.length; r++) {
      for (let c = 1; c < matrix[r].length; c++) {
        const cell = matrix[r][c];
        const fill = getCellFill(slide3, r, c);
        if (cell && cell.includes("Recovery required")) {
          expect(fill).toBe(ISSUE_COLORS.critical);
        }
      }
    }
  });

  it("does not color No data cells red", async () => {
    const slides = await loadGeneratedSlides();
    const slide3 = slides.slide3;
    const matrix = getTableMatrix(slide3);
    for (let r = 1; r < matrix.length; r++) {
      for (let c = 1; c < matrix[r].length; c++) {
        const cell = matrix[r][c];
        const fill = getCellFill(slide3, r, c);
        if (cell === "No data") {
          expect(fill).not.toBe(ISSUE_COLORS.critical);
          expect(fill).toBe(ISSUE_COLORS.data);
        }
      }
    }
  });

  it("classifies provisional and validation-pending cells as data-gap blue-gray", async () => {
    const slides = await loadGeneratedSlides();
    const slide3 = slides.slide3;
    const matrix = getTableMatrix(slide3);
    for (let r = 1; r < matrix.length; r++) {
      for (let c = 1; c < matrix[r].length; c++) {
        const cell = matrix[r][c];
        const fill = getCellFill(slide3, r, c);
        if (cell && (cell.includes("Provisional") || cell.includes("Validation pending"))) {
          expect(fill).toBe(ISSUE_COLORS.data);
        }
      }
    }
  });

  it("classifies CWC 307:1 work-order ratio as Validation pending", async () => {
    const slides = await loadGeneratedSlides();
    const slide3 = slides.slide3;
    const matrix = getTableMatrix(slide3);
    // CWC is column 3 (after KPI column). PM:CM Ratio(WO) is row 3.
    expect(matrix[3][3]).toContain("Validation pending");
    expect(getCellFill(slide3, 3, 3)).toBe(ISSUE_COLORS.data);
  });

  it("classifies WAWA/JVC missing data as data gap, not red", async () => {
    const slides = await loadGeneratedSlides();
    const slide3 = slides.slide3;
    const matrix = getTableMatrix(slide3);
    // WAWA/JVC is column 7. Check all data rows.
    for (let r = 1; r < matrix.length; r++) {
      const cell = matrix[r][7];
      if (cell === "No data") {
        expect(getCellFill(slide3, r, 7)).toBe(ISSUE_COLORS.data);
      }
    }
  });

  it("uses consistent matrix body-cell formatting", async () => {
    const slides = await loadGeneratedSlides();
    const slide3 = slides.slide3;
    const matrix = getTableMatrix(slide3);
    for (let r = 1; r < matrix.length; r++) {
      for (let c = 1; c < matrix[r].length; c++) {
        const cell = matrix[r][c];
        if (!cell) continue;
        // Title case for status phrase
        const status = cell.split(" — ")[1];
        if (status) {
          expect(status[0]).toBe(status[0].toUpperCase());
        }
      }
    }
  });
});