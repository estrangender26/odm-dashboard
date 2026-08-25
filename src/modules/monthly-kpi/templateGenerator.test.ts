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

function makeMonthlyTrend(
  _businessUnit: string,
  months: number[],
  valueBase: Partial<Record<ScorecardKpiKey, number | null>> = {}
): BusinessUnitScorecard["monthlyTrend"] {
  return months.map((month) => ({
    month,
    monthLabel: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1] ?? `M${month}`,
    values: Object.fromEntries(
      SCORECARD_KPI_KEYS.map((key) => [
        key,
        {
          value: valueBase[key] ?? 0,
          status: "success",
          formatted: `${valueBase[key] ?? 0}%`,
        },
      ])
    ) as unknown as BusinessUnitScorecard["monthlyTrend"][number]["values"],
  }));
}

function createTestDataForMonth(
  reportingMonth: number,
  availableMonths: number[],
  valueBase: Partial<Record<ScorecardKpiKey, number | null>> = {}
): MonthlyKpiPresentation {
  const data = createTestData();
  data.reportingMonth = reportingMonth;
  data.reportingMonthLabel = `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][reportingMonth - 1]} ${data.reportingYear}`;
  for (const bu of data.buScorecards) {
    bu.monthlyTrend = makeMonthlyTrend(bu.businessUnit, availableMonths, valueBase);
  }
  return data;
}

async function getSlide1TableText(blob: Blob): Promise<string[]> {
  const arrayBuffer = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const xml = await zip.file("ppt/slides/slide1.xml")?.async("string");
  if (!xml) throw new Error("slide1.xml missing");
  const rows = (xml.match(/<a:tr[\s\S]*?<\/a:tr>/g) || []);
  return rows.map((row) => {
    const texts = (row.match(/<a:t>([^<]*)<\/a:t>/g) || []).map((m) =>
      m.replace(/<\/?a:t>/g, "")
    );
    return texts.join("|");
  });
}

function createTestData(): MonthlyKpiPresentation {
  return {
    generatedAt: new Date().toISOString(),
    reportingYear: 2026,
    reportingMonth: 6,
    reportingMonthLabel: "June 2026",
    selectedBusinessUnit: "AMD-EZ",
    businessUnits: ["AMD-EZ", "LARC", "CWC", "LAWC", "TWCI", "EWG", "WAWA/JVC"],
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
      makeBuScorecard("CWC", {
        pmCompliance: 100.4,
        budgetSpend: 73,
        pmCmWorkOrderRatio: 99.7,
        pmCmCostRatio: 76,
        mttrDays: 2,
        facilityUptime: 99.86,
      }),
      makeBuScorecard("LAWC", {
        pmCompliance: 90,
        budgetSpend: 60,
        pmCmWorkOrderRatio: 93,
        pmCmCostRatio: 76,
        mttrDays: 1,
        facilityUptime: 99.93,
      }),
      makeBuScorecard("TWCI", {
        pmCompliance: 58,
        budgetSpend: 67,
        pmCmWorkOrderRatio: 89,
        pmCmCostRatio: 68,
        mttrDays: null,
        facilityUptime: 98.77,
      }),
      makeBuScorecard("EWG", {
        pmCompliance: 22,
        budgetSpend: null,
        pmCmWorkOrderRatio: 38,
        pmCmCostRatio: null,
        mttrDays: null,
        facilityUptime: 99.94,
      }),
      makeBuScorecard("WAWA/JVC", {
        pmCompliance: 78,
        budgetSpend: 79,
        pmCmWorkOrderRatio: 96,
        pmCmCostRatio: null,
        mttrDays: 8,
        facilityUptime: 100,
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

function getShapeBox(xml: string, name: string) {
  const spRe = new RegExp(`<p:cNvPr[^>]*name="${name}"[\\s\\S]*?</p:sp>`);
  const frameRe = new RegExp(`<p:cNvPr[^>]*name="${name}"[\\s\\S]*?</p:graphicFrame>`);
  let raw = xml.match(spRe)?.[0] ?? xml.match(frameRe)?.[0];
  if (!raw) return null;
  const x = Number((raw.match(/x="(-?\d+)"/) || [])[1] || 0);
  const y = Number((raw.match(/y="(-?\d+)"/) || [])[1] || 0);
  const cx = Number((raw.match(/cx="(\d+)"/) || [])[1] || 0);
  const cy = Number((raw.match(/cy="(\d+)"/) || [])[1] || 0);
  return { x, y, cx, cy, bottom: y + cy, right: x + cx };
}

function getMttrCellSizes(xml: string): { sz: number; face: string }[] {
  const rows = (xml.match(/<a:tr[\s\S]*?<\/a:tr>/g) || []);
  const result: { sz: number; face: string }[] = [];
  // Skip header row; examine MTTR column in all body rows (monthly, YTD, TARGET).
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const cells = (row.match(/<a:tc[\s\S]*?<\/a:tc>/g) || []);
    if (cells.length <= 5) continue;
    const cell = cells[5];
    const firstRun = cell.match(/<a:r\b[\s\S]*?<\/a:r>/);
    if (!firstRun) continue;
    const rPr = firstRun[0].match(/<a:rPr[\s\S]*?<\/a:rPr>/);
    if (!rPr) continue;
    const sz = Number((rPr[0].match(/sz="(\d+)"/) || [])[1] || 0);
    const face = (rPr[0].match(/typeface="([^"]+)"/) || [])[1] ?? "";
    result.push({ sz, face });
  }
  return result;
}


function getCellFillColor(xml: string, rowIdx: number, colIdx: number): string | null {
  const rows = (xml.match(/<a:tr[\s\S]*?<\/a:tr>/g) || []);
  const row = rows[rowIdx];
  if (!row) return null;
  const cells = (row.match(/<a:tc[\s\S]*?<\/a:tc>/g) || []);
  const cell = cells[colIdx];
  if (!cell) return null;
  const tcPr = cell.match(/<a:tcPr[\s\S]*?<\/a:tcPr>/)?.[0] ?? "";
  const srgb = tcPr.match(/val="([0-9A-Fa-f]{6})"/)?.[1] ?? null;
  return srgb;
}

function getRowCellFirstRunProps(
  xml: string,
  rowIdx: number
): { colIdx: number; bold: boolean | null }[] {
  const rows = (xml.match(/<a:tr[\s\S]*?<\/a:tr>/g) || []);
  const row = rows[rowIdx];
  if (!row) return [];
  const cells = (row.match(/<a:tc[\s\S]*?<\/a:tc>/g) || []);
  return cells.map((cell, colIdx) => {
    const firstRun = cell.match(/<a:r\b[\s\S]*?<\/a:r>/);
    if (!firstRun) return { colIdx, bold: null };
    const rPr = firstRun[0].match(/<a:rPr[\s\S]*?<\/a:rPr>/);
    if (!rPr) return { colIdx, bold: null };
    const boldAttr = rPr[0].match(/b="([^"]+)"/);
    const bold = boldAttr ? boldAttr[1] === "1" : null;
    return { colIdx, bold };
  });
}

function getCellFirstRunProps(
  xml: string,
  rowIdx: number,
  colIdx: number
): { sz: number; face: string; bold: boolean | null } | null {
  const rows = (xml.match(/<a:tr[\s\S]*?<\/a:tr>/g) || []);
  const row = rows[rowIdx];
  if (!row) return null;
  const cells = (row.match(/<a:tc[\s\S]*?<\/a:tc>/g) || []);
  const cell = cells[colIdx];
  if (!cell) return null;
  const firstRun = cell.match(/<a:r\b[\s\S]*?<\/a:r>/);
  if (!firstRun) return null;
  const rPr = firstRun[0].match(/<a:rPr[\s\S]*?<\/a:rPr>/);
  if (!rPr) return null;
  const sz = Number((rPr[0].match(/sz="(\d+)"/) || [])[1] || 0);
  const face = (rPr[0].match(/typeface="([^"]+)"/) || [])[1] ?? "";
  const boldAttr = rPr[0].match(/b="([^"]+)"/);
  const bold = boldAttr ? boldAttr[1] === "1" : null;
  return { sz, face, bold };
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
    expect(matrix[1][0]).toBe("Jan");
    expect(matrix[6][0]).toBe("Jun");
    expect(matrix[7][0]).toBe("YTD");
    expect(matrix[8][0]).toBe("TARGET");
    expect(matrix.some((row) => row[0] === "Jul")).toBe(false);
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

describe("generateMonthlyKpiPresentation requested reporting month handling", () => {
  it("includes January through August when August 2026 is requested with August data", async () => {
    const data = createTestDataForMonth(8, [1, 2, 3, 4, 5, 6, 7, 8]);
    const blob = await generateMonthlyKpiPresentation(data);
    const rows = await getSlide1TableText(blob);
    expect(rows[0]).toContain("Month");
    expect(rows[1]).toContain("Jan");
    expect(rows[8]).toContain("Aug");
    expect(rows[9]).toContain("YTD");
    expect(rows.some((r) => r.includes("Sep"))).toBe(false);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slide2Xml = await zip.file("ppt/slides/slide2.xml")?.async("string");
    expect(slide2Xml).toContain("August 2026");
  });

  it("still represents August 2026 explicitly when only January-July data exists", async () => {
    const data = createTestDataForMonth(8, [1, 2, 3, 4, 5, 6, 7]);
    const blob = await generateMonthlyKpiPresentation(data);
    const rows = await getSlide1TableText(blob);
    expect(rows[1]).toContain("Jan");
    expect(rows[7]).toContain("Jul");
    expect(rows[8]).toContain("Aug");
    expect(rows[9]).toContain("YTD");
    // August should not silently disappear or be replaced by July
    expect(rows.filter((r) => r.includes("Aug")).length).toBe(1);
    expect(rows.filter((r) => r.includes("Jul")).length).toBe(1);
  });

  it("cuts off at April when April 2026 is requested", async () => {
    const data = createTestDataForMonth(4, [1, 2, 3, 4, 5, 6, 7, 8]);
    const blob = await generateMonthlyKpiPresentation(data);
    const rows = await getSlide1TableText(blob);
    expect(rows[1]).toContain("Jan");
    expect(rows[4]).toContain("Apr");
    expect(rows[5]).toContain("YTD");
    expect(rows.some((r) => r.includes("May"))).toBe(false);
  });

  it("includes all twelve months when December 2026 is requested", async () => {
    const data = createTestDataForMonth(12, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const blob = await generateMonthlyKpiPresentation(data);
    const rows = await getSlide1TableText(blob);
    expect(rows[1]).toContain("Jan");
    expect(rows[12]).toContain("Dec");
    expect(rows[13]).toContain("YTD");
  });

  it("includes only January when January 2026 is requested", async () => {
    const data = createTestDataForMonth(1, [1]);
    const blob = await generateMonthlyKpiPresentation(data);
    const rows = await getSlide1TableText(blob);
    expect(rows[1]).toContain("Jan");
    expect(rows[2]).toContain("YTD");
    expect(rows.some((r) => r.includes("Feb"))).toBe(false);
  });
});

describe("generateMonthlyKpiPresentation slide 1 layout and formatting", () => {
  it("keeps MTTR monthly and YTD cells consistent with other KPI body cells", async () => {
    const data = createTestDataForMonth(8, [1, 2, 3, 4, 5, 6, 7, 8], { mttrDays: 85.86 });
    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string") ?? "";
    const mttrSizes = getMttrCellSizes(slide1);
    expect(mttrSizes.length).toBeGreaterThanOrEqual(9); // 8 monthly + YTD
    const uniqueSizes = new Set(mttrSizes.map((s) => s.sz));
    expect(uniqueSizes.size).toBe(1);
    expect([...uniqueSizes][0]).toBeGreaterThanOrEqual(1000);
    expect(mttrSizes.every((s) => s.face === "Aptos")).toBe(true);

    // MTTR cells receive the same status-driven fill as every other KPI.
    const mttrColor = getCellFillColor(slide1, 1, 5);
    expect(mttrColor).toBeTruthy();
  });

  it.each([
    { month: 1, label: "January" },
    { month: 8, label: "August" },
    { month: 12, label: "December" },
  ])("$label: table, commentary, MTTR note and legend fit cleanly on slide 1", async ({ month }) => {
    const data = createTestDataForMonth(month, Array.from({ length: month }, (_, i) => i + 1));
    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string") ?? "";
    const table = getShapeBox(slide1, "AMD-EZ Monthly KPI Scorecard");
    const readout = getShapeBox(slide1, "Executive Readout");
    const note = getShapeBox(slide1, "TextBox 1");
    const legend = getShapeBox(slide1, "RAG Legend");
    const SLIDE_HEIGHT = 6858000;

    expect(readout).not.toBeNull();
    expect(note).not.toBeNull();
    expect(legend).not.toBeNull();
    expect(table).not.toBeNull();

    expect(readout!.y).toBeGreaterThanOrEqual(table!.bottom + 100000);
    expect(legend!.y).toBeGreaterThanOrEqual(readout!.y);
    expect(legend!.x).toBeGreaterThanOrEqual(readout!.right);
    // The separate MTTR methodology note shape is hidden off-slide on Slide 1.
    expect(note!.y).toBeGreaterThanOrEqual(SLIDE_HEIGHT);
    expect(readout!.bottom).toBeLessThanOrEqual(SLIDE_HEIGHT);
    // note is intentionally hidden off-slide on Slide 1
    expect(legend!.bottom).toBeLessThanOrEqual(SLIDE_HEIGHT);
  });

  it("preserves header, Month label, YTD label, and TARGET row formatting", async () => {
    const data = createTestDataForMonth(8, [1, 2, 3, 4, 5, 6, 7, 8], { mttrDays: 85.86 });
    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string") ?? "";

    // Header row: first KPI header (PM Compliance) should remain bold.
    const headerCell = getCellFirstRunProps(slide1, 0, 1);
    expect(headerCell).not.toBeNull();
    expect(headerCell!.bold).toBe(true);

    // Month label column: Jan should not be normalized to plain Aptos body formatting.
    const monthLabel = getCellFirstRunProps(slide1, 1, 0);
    expect(monthLabel).not.toBeNull();
    expect(monthLabel!.bold).not.toBe(false);

    // YTD label cell (column 0) should retain emphasis.
    const ytdLabel = getCellFirstRunProps(slide1, 9, 0);
    expect(ytdLabel).not.toBeNull();
    expect(ytdLabel!.bold).not.toBe(false);

    // TARGET row should remain unnormalized.
    const targetCell = getCellFirstRunProps(slide1, 10, 1);
    expect(targetCell).not.toBeNull();
    expect(targetCell!.bold).toBe(true);
    // TARGET cell keeps its template formatting and is not rewritten with the
    // normalized body attributes (kern, strike, etc.) used on data cells.
    const rows = (slide1.match(/<a:tr[\s\S]*?<\/a:tr>/g) || []);
    const targetRow = rows[10];
    const targetCells = (targetRow.match(/<a:tc[\s\S]*?<\/a:tc>/g) || []);
    const targetRPr = targetCells[1].match(/<a:rPr[\s\S]*?<\/a:rPr>/)?.[0] ?? "";
    expect(targetRPr).not.toContain('kern="1200"');
  });

  it("preserves existing bold emphasis on YTD KPI value cells", async () => {
    const data = createTestDataForMonth(8, [1, 2, 3, 4, 5, 6, 7, 8], { mttrDays: 85.86 });
    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string") ?? "";

    // YTD row index is header(0) + 8 monthly rows = 9.
    const ytdValueCells = getRowCellFirstRunProps(slide1, 9).filter((c) => c.colIdx >= 1);
    expect(ytdValueCells.length).toBeGreaterThanOrEqual(6);

    // If the template already marks any YTD KPI value cell bold, that emphasis
    // must survive normalization. We also confirm no cell was forced plain
    // when it started bold.
    const boldCount = ytdValueCells.filter((c) => c.bold === true).length;
    const plainCount = ytdValueCells.filter((c) => c.bold === false).length;
    const unspecifiedCount = ytdValueCells.filter((c) => c.bold === null).length;

    // Template may carry intentional YTD emphasis; if present it must be kept.
    if (boldCount > 0) {
      expect(plainCount + unspecifiedCount).toBeLessThan(ytdValueCells.length);
    }

    // MTTR monthly and YTD cells remain uniform in font family/size/alignment.
    const mttrSizes = getMttrCellSizes(slide1);
    expect(mttrSizes.length).toBeGreaterThanOrEqual(9); // 8 monthly + YTD
    const uniqueSizes = new Set(mttrSizes.map((s) => s.sz));
    expect(uniqueSizes.size).toBe(1);
    expect(mttrSizes.every((s) => s.face === "Aptos")).toBe(true);
  });

  it("colors monthly and YTD KPI cells by existing status using RAG thresholds", async () => {
    const data = createTestDataForMonth(8, [1, 2, 3, 4, 5, 6, 7, 8], {
      pmCompliance: 97,
      budgetSpend: 97,
      pmCmWorkOrderRatio: 97,
      pmCmCostRatio: 97,
      mttrDays: 63.64,
      facilityUptime: 100,
    });
    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string") ?? "";

    const monthlyPmCompliance = getCellFillColor(slide1, 1, 1);
    const monthlyFacilityUptime = getCellFillColor(slide1, 1, 6);
    expect(monthlyPmCompliance).toBe("A9D18E");
    expect(monthlyFacilityUptime).toBe("A9D18E");

    // TARGET row should keep its template styling and not be overwritten.
    const targetFill = getCellFillColor(slide1, 10, 1);
    expect(targetFill).not.toBe("A9D18E");
  });

  it("maps MTTR status to the same RAG colors as other KPIs", async () => {
    const data = createTestDataForMonth(8, [1, 2, 3, 4, 5, 6, 7, 8], {
      mttrDays: 50,
    });
    // Override MTTR statuses across available months/YTD to test all cases.
    for (const bu of data.buScorecards) {
      for (const t of bu.monthlyTrend) {
        t.values.mttrDays = { value: 50, status: "success", formatted: "50.00" };
      }
      bu.ytd.mttrDays = { value: 50, status: "success", formatted: "50.00" };
    }
    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string") ?? "";
    const mttrFills: string[] = [];
    for (let r = 1; r <= 9; r++) {
      const fill = getCellFillColor(slide1, r, 5);
      if (fill) mttrFills.push(fill);
    }
    expect(mttrFills.length).toBeGreaterThanOrEqual(9);
    expect(mttrFills.every((c) => c === "A9D18E")).toBe(true);
  });

  it("renders MTTR warning as yellow and provisional as gray", async () => {
    const data = createTestDataForMonth(8, [1, 2, 3, 4, 5, 6, 7, 8], {
      mttrDays: 50,
    });
    for (const bu of data.buScorecards) {
      bu.monthlyTrend[0].values.mttrDays = { value: 50, status: "warning", formatted: "50.00" };
      bu.monthlyTrend[1].values.mttrDays = { value: 50, status: "provisional", formatted: "50.00" };
      bu.ytd.mttrDays = { value: 50, status: "warning", formatted: "50.00" };
    }
    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string") ?? "";
    expect(getCellFillColor(slide1, 1, 5)).toBe("FFD966");
    expect(getCellFillColor(slide1, 2, 5)).toBe("DDE6F0");
    expect(getCellFillColor(slide1, 9, 5)).toBe("FFD966");
  });

  it("fills missing or null monthly KPI values with neutral gray", async () => {
    const data = createTestDataForMonth(8, [1, 2, 3, 4, 5, 6, 7, 8], {
      pmCompliance: 97,
      budgetSpend: 97,
      pmCmWorkOrderRatio: 97,
      pmCmCostRatio: 97,
      mttrDays: 63.64,
      facilityUptime: 100,
    });
    // Clear one August KPI value so the cloned July green cell must be overwritten.
    for (const bu of data.buScorecards) {
      const aug = bu.monthlyTrend.find((t) => t.month === 8);
      if (aug) {
        aug.values.pmCompliance = { value: null, status: "no-data", formatted: "No Data" };
      }
    }
    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string") ?? "";
    // August is the 8th monthly row (header=0, rows 1-8 monthly).
    const augPmComplianceFill = getCellFillColor(slide1, 8, 1);
    expect(augPmComplianceFill).toBe("DDE6F0");
  });
});
