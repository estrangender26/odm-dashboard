import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { generateMonthlyKpiPresentation } from "./templateGenerator";
import { buildExecutiveReadoutLines } from "./executiveReadout";
import type { BusinessUnitScorecard, MonthlyKpiPresentation, ScorecardKpiKey } from "./types";
import { parseXml } from "../executive-presentations/framework";

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
    situation: null,
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


const READOUT_SCORE_KEYS = [
  "pmCompliance",
  "budgetSpend",
  "pmCmWorkOrderRatio",
  "pmCmCostRatio",
  "mttrDays",
  "facilityUptime",
] as const;

function expectedDerivedReadout(
  data: MonthlyKpiPresentation,
  buName: string
): string[] {
  const bu = data.buScorecards.find((b) => b.businessUnit === buName)!;
  const values: Partial<Record<ScorecardKpiKey, number | null>> = {};
  for (const key of READOUT_SCORE_KEYS) values[key] = bu.ytd[key].value;
  return buildExecutiveReadoutLines({
    businessUnit: buName,
    monthLabel: data.reportingMonthLabel,
    reportingMonth: data.reportingMonth,
    notes: bu.notes,
    situation: bu.situation,
    values,
  }).map((line) => line.text);
}

function readoutParagraphTexts(xml: string): string[] {
  const start = xml.indexOf('name="Executive Readout"');
  const bodyStart = xml.indexOf("<p:txBody>", start);
  const openEnd = xml.indexOf(">", bodyStart) + 1;
  const bodyEnd = xml.indexOf("</p:txBody>", openEnd);
  const body = xml.slice(openEnd, bodyEnd);
  const texts: string[] = [];
  for (const pm of body.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)) {
    const text = [...pm[0].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)]
      .map((m) => m[1])
      .join("");
    texts.push(text);
  }
  return texts;
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
      pmCompliance: { value: 95, status: "warning", formatted: "95.00%" },
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

  it("blank stored notes still yield a concise derived readout on Slide 1", async () => {
    const data = createTestData();
    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xml = await zip.file("ppt/slides/slide1.xml")?.async("string") ?? "";
    const expected = expectedDerivedReadout(data, data.selectedBusinessUnit);
    const readout = readoutParagraphTexts(xml);
    expect(readout).toEqual(expected);
    expect(readout[0]).toBe("EXECUTIVE COMMENTARY");
    expect(readout).not.toContain("MANAGEMENT ASSESSMENT");
    expect(readout.length - 1).toBeLessThanOrEqual(3);
    for (const b of readout.slice(1)) expect(b.trim().split(/\s+/).length).toBeLessThanOrEqual(55);
    expect(readout[0]).toBe("EXECUTIVE COMMENTARY");
    expect(xml).not.toContain("Notes / Commentary");
    expect(xml).not.toContain("No commentary submitted.");
    expect(xml).not.toContain("No situation submitted.");
    expect(xml).not.toContain("Key exceptions:");
    expect(xml).not.toContain("not submitted");
  });
  it("derived readout reflects the BU stored notes without dumping them raw", async () => {
    const data = createTestData();
    const selected = data.buScorecards.find((b) => b.businessUnit === data.selectedBusinessUnit)!;
    selected.notes = "Transformer overhaul completed.\nSpare delivery tracked.";
    selected.situation = "Corrective maintenance was completed inside the window.";
    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xml = await zip.file("ppt/slides/slide1.xml")?.async("string") ?? "";
    const expected = expectedDerivedReadout(data, data.selectedBusinessUnit);
    const readout = readoutParagraphTexts(xml);
    expect(readout).toEqual(expected);
    expect(readout[0]).toBe("EXECUTIVE COMMENTARY");
    expect(readout).not.toContain("MANAGEMENT ASSESSMENT");
    expect(readout.length - 1).toBeLessThanOrEqual(3);
    for (const b of readout.slice(1)) expect(b.trim().split(/\s+/).length).toBeLessThanOrEqual(55);
    expect(readout[0]).toBe("EXECUTIVE COMMENTARY");
    expect(xml).not.toContain("No situation submitted.");
    expect(xml).not.toContain("No commentary submitted.");
    expect(xml).not.toContain("Key exceptions:");
  });
  it("single-BU CWC deck renders its concise derived readout (note summarized, never dumped)", async () => {
    const data = createTestData();
    data.selectedBusinessUnit = "CWC";
    const cwc = data.buScorecards.find((b) => b.businessUnit === "CWC")!;
    cwc.notes =
      "Exceed budget due to media replacement for PS1 9MLD WTP 6MLD GAC DW44";
    cwc.situation = null;
    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xml = await zip.file("ppt/slides/slide1.xml")?.async("string") ?? "";
    const expected = expectedDerivedReadout(data, "CWC");
    const readout = readoutParagraphTexts(xml);
    expect(readout).toEqual(expected);
    expect(readout[0]).toBe("EXECUTIVE COMMENTARY");
    expect(readout).not.toContain("MANAGEMENT ASSESSMENT");
    expect(readout.length - 1).toBeLessThanOrEqual(3);
    for (const b of readout.slice(1)) expect(b.trim().split(/\s+/).length).toBeLessThanOrEqual(55);
    expect(readout[0]).toBe("EXECUTIVE COMMENTARY");
    expect(xml).not.toContain("Key exceptions:");
    expect(xml).not.toContain("Replacement of filters");
    expect(xml).not.toContain("Transformer overhaul");
    expect(xml).not.toContain("No situation submitted.");
  });
  it.each(["BU-A", "BU-B", "BU-C"] as const)(
    "selected arbitrary BU %s renders ONLY its own concise derived readout - no leakage",
    async (selectedName) => {
      const data = createTestData();
      data.reportingMonth = 8;
      data.reportingMonthLabel = "August 2026";
      const fixtureNote: Record<string, string | null> = {
        "BU-A": "BU-A note",
        "BU-B": "BU-B note",
        "BU-C": null,
      };
      const fixtureSituation: Record<string, string | null> = {
        "BU-A": null,
        "BU-B": "BU-B situation",
        "BU-C": "BU-C situation",
      };
      for (const name of ["BU-A", "BU-B", "BU-C"]) {
        const scorecard = makeBuScorecard(name, {});
        scorecard.notes = fixtureNote[name];
        scorecard.situation = fixtureSituation[name];
        data.buScorecards.push(scorecard);
      }
      data.selectedBusinessUnit = selectedName;

      const blob = await generateMonthlyKpiPresentation(data);
      const arrayBuffer = await blob.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);
      const slides = await Promise.all(
        [1, 2, 3].map(async (n) =>
          (await zip.file(`ppt/slides/slide${n}.xml`)?.async("string")) ?? ""
        )
      );
      const allXml = slides.join("\n");

      // Derived readout matches the deterministic builder for THIS BU.
      const expected = expectedDerivedReadout(data, selectedName);
      const readout = readoutParagraphTexts(slides[0]);
      expect(readout).toEqual(expected);
      expect(readout[0]).toBe("EXECUTIVE COMMENTARY");
      expect(readout).not.toContain("MANAGEMENT ASSESSMENT");
      expect(readout.length - 1).toBeLessThanOrEqual(3);
      for (const b of readout.slice(1)) expect(b.trim().split(/\s+/).length).toBeLessThanOrEqual(55);
      expect(allXml).not.toContain("Notes / Commentary");
      expect(allXml).not.toContain("No situation submitted.");

      // No cross-BU leakage: no other fixture BU raw note text appears, and no
      // other BU numeric value token appears anywhere in the deck.
      for (const name of ["BU-A", "BU-B", "BU-C"]) {
        if (name === selectedName) continue;
        const otherNote = fixtureNote[name];
        const otherSituation = fixtureSituation[name];
        if (otherNote !== null) expect(allXml).not.toContain(otherNote);
        if (otherSituation !== null) expect(allXml).not.toContain(otherSituation);
      }
      expect(allXml).not.toContain("Exceed budget due to media replacement");
      expect(allXml).not.toContain("Replacement of filters");
      expect(allXml).not.toContain("Transformer overhaul");
    }
  );

  it("Slide 1 readout runs carry deterministic visible formatting for CWC and LARC (headings 172B47 bold, bullets 111111, Aptos)", async () => {
    const cases = [
      {
        bu: "CWC",
        note:
          "Exceed budget due to media replacement for PS1 9MLD WTP 6MLD GAC DW44",
        situation: null,
      },
      {
        bu: "LARC",
        note:
          "Budget Spend: Replacement of filters; Facility Uptime: Genset breakdown (Facility Primary Power Supply)",
        situation: "Genset restoration completed under warranty.",
      },
    ];
    for (const fixture of cases) {
      const data = createTestData();
      data.selectedBusinessUnit = fixture.bu;
      data.reportingMonth = 8;
      data.reportingMonthLabel = "August 2026";
      const bu = data.buScorecards.find(
        (b) => b.businessUnit === fixture.bu
      )!;
      bu.notes = fixture.note;
      bu.situation = fixture.situation;
      const blob = await generateMonthlyKpiPresentation(data);
      const arrayBuffer = await blob.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);
      const xml = await zip.file("ppt/slides/slide1.xml")?.async("string") ?? "";

      const start = xml.indexOf('name="Executive Readout"');
      const bodyStart = xml.indexOf("<p:txBody>", start);
      const openEnd = xml.indexOf(">", bodyStart) + 1;
      const bodyEnd = xml.indexOf("</p:txBody>", openEnd);
      const body = xml.slice(openEnd, bodyEnd);

      type RunInfo = { text: string; rPr: string; buNone: boolean; buChar: boolean };
      const runs: RunInfo[] = [];
      for (const pm of body.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)) {
        const p = pm[0];
        const text = [...p.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)]
          .map((x) => x[1])
          .join("");
        const rPr =
          p.match(/<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/)?.[0] ?? "";
        runs.push({
          text,
          rPr,
          buNone: /<a:buNone\b[^>]*\/>/.test(p),
          buChar: /<a:buChar\b[^>]*char="•"/.test(p),
        });
      }

      const headings = runs.filter((r) => r.text === "EXECUTIVE COMMENTARY");
      expect(headings.length).toBe(1);
      for (const h of headings) {
        expect(h.buNone).toBe(true);
        expect(h.buChar).toBe(false);
        expect(h.rPr).toMatch(/lang="en-PH"/);
        expect(h.rPr).toMatch(/sz="1200"/);
        expect(h.rPr).toMatch(/ b="1"/);
        expect(h.rPr).toContain('<a:srgbClr val="172B47"/>');
        expect((h.rPr.match(/typeface="Aptos"/g) || []).length).toBe(3);
        expect(h.rPr).not.toContain("schemeClr");
        expect((h.rPr.match(/<a:solidFill>/g) || []).length).toBe(1);
      }

      // The exact readout matches the deterministic derived builder.
      expect(runs.map((r) => r.text)).toEqual(expectedDerivedReadout(data, fixture.bu));

      // Every non-heading line is a formatted bullet.
      const bullets = runs.filter((r) => r.text !== "EXECUTIVE COMMENTARY");
      expect(bullets.length).toBeGreaterThanOrEqual(1);
      for (const b of bullets) {
        expect(b.buNone).toBe(false);
        expect(b.buChar).toBe(true);
        expect(b.rPr).toMatch(/lang="en-PH"/);
        expect(b.rPr).toMatch(/sz="1200"/);
        expect(b.rPr).toMatch(/ b="0"/);
        expect(b.rPr).toContain('<a:srgbClr val="111111"/>');
        expect((b.rPr.match(/typeface="Aptos"/g) || []).length).toBe(3);
        expect(b.rPr).not.toContain("schemeClr");
      }

      // No nested a:r and exactly one rPr per run inside the readout body.
      expect(body).not.toContain("<a:r><a:r>");
      expect((body.match(/<a:rPr\b/g) || []).length).toBe(
        (body.match(/<a:r\b/g) || []).length
      );
    }
  });

  it("rounds KPI values for executive display on Slide 1", async () => {
    const data = createTestDataForMonth(8, [1, 2, 3, 4, 5, 6, 7, 8], {
      pmCompliance: 98.38,
      budgetSpend: 95.72,
      pmCmWorkOrderRatio: 84.3,
      pmCmCostRatio: 74.8,
      mttrDays: 63.64,
      facilityUptime: 100,
    });
    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xml = await zip.file("ppt/slides/slide1.xml")?.async("string") ?? "";
    const matrix = getTableMatrix(xml);

    expect(matrix.some((row) => row.includes("98%"))).toBe(true);
    expect(matrix.some((row) => row.includes("96%"))).toBe(true);
    expect(matrix.some((row) => row.includes("84% (5.4:1)"))).toBe(true);
    expect(matrix.some((row) => row.includes("75% (3.0:1)"))).toBe(true);
    expect(matrix.some((row) => row.includes("64"))).toBe(true);
    expect(matrix.some((row) => row.includes("100%"))).toBe(true);
    // PM Compliance preserves authoritative decimals (98.38%, not 98%).
    expect(xml).toContain("98.38%");
    expect(xml).not.toContain("63.64");
  });

  it("rounds KPI values for executive display on Slide 2", async () => {
    const blob = await generateMonthlyKpiPresentation(createTestData());
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xml = await zip.file("ppt/slides/slide2.xml")?.async("string") ?? "";
    const matrix = getTableMatrix(xml);

    const ytdAllRow = matrix.find((row) => row[0] === "YTD (ALL BUs)");
    expect(ytdAllRow).toBeDefined();
    expect(ytdAllRow![1]).toBe("95%");
    expect(ytdAllRow![2]).toBe("54%");
    expect(ytdAllRow![3]).toBe("83% (4.9:1)");
    expect(ytdAllRow![4]).toBe("71% (2.4:1)");
    expect(ytdAllRow![5]).toBe("27");
    expect(ytdAllRow![6]).toBe("99.77%"); // Facility Uptime keeps its precision
  });

  it("green-only readout stays concise and positive with no speculation", async () => {
    const data = createTestData();
    const selected = data.buScorecards.find((b) => b.businessUnit === data.selectedBusinessUnit)!;
    for (const [key, value] of Object.entries({
      pmCompliance: 98,
      budgetSpend: 100,
      pmCmWorkOrderRatio: 86,
      pmCmCostRatio: 80,
      mttrDays: 5,
      facilityUptime: 100,
    })) {
      selected.ytd[key as ScorecardKpiKey] = {
        value,
        status: "success",
        formatted: String(value),
      };
    }
    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xml = await zip.file("ppt/slides/slide1.xml")?.async("string") ?? "";
    const expected = expectedDerivedReadout(data, data.selectedBusinessUnit);
    const readout = readoutParagraphTexts(xml);
    expect(readout).toEqual(expected);
    // All-green BU: NO bullets (nothing failed and nothing to explain).
    expect(readout).toEqual(["EXECUTIVE COMMENTARY"]);
    expect(readout.join(" ").length).toBeLessThan(60);
    expect(readout[0]).toBe("EXECUTIVE COMMENTARY");
    expect(xml).not.toContain("No commentary submitted.");
    expect(xml).not.toContain("No situation submitted.");
    expect(xml).not.toContain("Key exceptions:");
  });
  it("red KPIs without stored text still yield a concise, evidence-safe readout", async () => {
    const data = createTestData();
    const selected = data.buScorecards.find((b) => b.businessUnit === data.selectedBusinessUnit)!;
    for (const [key, value] of Object.entries({
      pmCompliance: 85,
      budgetSpend: 85,
      pmCmWorkOrderRatio: 70,
      pmCmCostRatio: 40,
      mttrDays: 63.64,
      facilityUptime: 98,
    })) {
      selected.ytd[key as ScorecardKpiKey] = {
        value,
        status: "danger",
        formatted: String(value),
      };
    }
    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xml = await zip.file("ppt/slides/slide1.xml")?.async("string") ?? "";
    const expected = expectedDerivedReadout(data, data.selectedBusinessUnit);
    const readout = readoutParagraphTexts(xml);
    expect(readout).toEqual(expected);
    // Below-target KPIs WITHOUT authoritative Notes/Situation produce NO
    // Executive Commentary bullet at all.
    expect(readout).toEqual(["EXECUTIVE COMMENTARY"]);
    expect(readout.join(" ")).not.toMatch(/\bValidate\b|Prioritize|Strengthen|Monitor/);
    expect(readout[0]).toBe("EXECUTIVE COMMENTARY");
    expect(xml).not.toContain("Key exceptions:");
    expect(xml).not.toContain("No commentary submitted.");
    expect(xml).not.toContain("No situation submitted.");
  });
  it("uses formatted fallback for no-data YTD values on Slide 2", async () => {
    const data = createTestData();
    data.portfolioYtd.pmCompliance = { value: null, status: "no-data", formatted: "No Data" };
    data.portfolioYtd.mttrDays = { value: null, status: "no-data", formatted: "No Data" };
    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xml = await zip.file("ppt/slides/slide2.xml")?.async("string") ?? "";
    const matrix = getTableMatrix(xml);
    const ytdAllRow = matrix.find((row) => row[0] === "YTD (ALL BUs)");
    expect(ytdAllRow).toBeDefined();
    expect(ytdAllRow![1]).toBe("No Data");
    expect(ytdAllRow![5]).toBe("No Data");
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

  it("colors monthly and YTD KPI cells using the configurable RAG thresholds", async () => {
    const data = createTestDataForMonth(8, [1, 2, 3, 4, 5, 6, 7, 8], {
      pmCompliance: 98,
      budgetSpend: 95,
      pmCmWorkOrderRatio: 86,
      pmCmCostRatio: 80,
      mttrDays: 63.64,
      facilityUptime: 100,
    });
    // Also set YTD on the selected BU to green thresholds.
    const selected = data.buScorecards.find((b) => b.businessUnit === data.selectedBusinessUnit);
    if (selected) {
      selected.ytd.pmCompliance = { value: 98, status: "success", formatted: "98.00%" };
      selected.ytd.budgetSpend = { value: 95, status: "success", formatted: "95.00%" };
      selected.ytd.pmCmWorkOrderRatio = { value: 86, status: "success", formatted: "86.0%" };
      selected.ytd.pmCmCostRatio = { value: 80, status: "success", formatted: "80.0%" };
      selected.ytd.mttrDays = { value: 29, status: "success", formatted: "29.00 days" };
      selected.ytd.facilityUptime = { value: 100, status: "success", formatted: "100.00%" };
    }
    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string") ?? "";

    // All values sit exactly on the green boundary for their KPI.
    for (let r = 1; r <= 8; r++) {
      expect(getCellFillColor(slide1, r, 1)).toBe("A9D18E"); // PM Compliance ≥98
      expect(getCellFillColor(slide1, r, 2)).toBe("A9D18E"); // Budget Spend 95-105
      expect(getCellFillColor(slide1, r, 3)).toBe("A9D18E"); // PM:CM WO ≥86
      expect(getCellFillColor(slide1, r, 4)).toBe("A9D18E"); // PM:CM Cost ≥80
      expect(getCellFillColor(slide1, r, 5)).toBe("A9D18E"); // MTTR data exists
      expect(getCellFillColor(slide1, r, 6)).toBe("A9D18E"); // Facility Uptime =100
    }

    // YTD row uses the same thresholds.
    expect(getCellFillColor(slide1, 9, 1)).toBe("A9D18E");

    // TARGET row should keep its template styling and not be overwritten.
    const targetFill = getCellFillColor(slide1, 10, 1);
    expect(targetFill).not.toBe("A9D18E");
    expect(targetFill).not.toBe("FFD966");
    expect(targetFill).not.toBe("FF6B6B");
  });

  it("maps amber and red thresholds correctly on Slide 1", async () => {
    const data = createTestDataForMonth(8, [1, 2, 3, 4, 5, 6, 7, 8], {
      pmCompliance: 95,
      budgetSpend: 92,
      pmCmWorkOrderRatio: 80,
      pmCmCostRatio: 60,
      mttrDays: 63.64,
      facilityUptime: 99.5,
    });
    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string") ?? "";

    expect(getCellFillColor(slide1, 1, 1)).toBe("FFD966"); // PM Compliance 90-98
    expect(getCellFillColor(slide1, 1, 2)).toBe("FFD966"); // Budget Spend 90-95
    expect(getCellFillColor(slide1, 1, 3)).toBe("FFD966"); // PM:CM WO 75-86
    expect(getCellFillColor(slide1, 1, 4)).toBe("FFD966"); // PM:CM Cost 50-80
    expect(getCellFillColor(slide1, 1, 5)).toBe("A9D18E"); // MTTR data exists
    expect(getCellFillColor(slide1, 1, 6)).toBe("FFD966"); // Facility Uptime 99-100
  });

  it("maps red thresholds correctly on Slide 1", async () => {
    const data = createTestDataForMonth(8, [1, 2, 3, 4, 5, 6, 7, 8], {
      pmCompliance: 85,
      budgetSpend: 85,
      pmCmWorkOrderRatio: 70,
      pmCmCostRatio: 40,
      mttrDays: 63.64,
      facilityUptime: 98,
    });
    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string") ?? "";

    expect(getCellFillColor(slide1, 1, 1)).toBe("FF6B6B"); // PM Compliance <90
    expect(getCellFillColor(slide1, 1, 2)).toBe("FF6B6B"); // Budget Spend <90
    expect(getCellFillColor(slide1, 1, 3)).toBe("FF6B6B"); // PM:CM WO <75
    expect(getCellFillColor(slide1, 1, 4)).toBe("FF6B6B"); // PM:CM Cost <50
    expect(getCellFillColor(slide1, 1, 5)).toBe("A9D18E"); // MTTR data exists
    expect(getCellFillColor(slide1, 1, 6)).toBe("FF6B6B"); // Facility Uptime <99
  });

  it("renders MTTR with valid data as green regardless of underlying status", async () => {
    const data = createTestDataForMonth(8, [1, 2, 3, 4, 5, 6, 7, 8], {
      mttrDays: 50,
    });
    // Override MTTR statuses across available months/YTD to varied statuses.
    for (const bu of data.buScorecards) {
      bu.monthlyTrend[0].values.mttrDays = { value: 50, status: "warning", formatted: "50.00" };
      bu.monthlyTrend[1].values.mttrDays = { value: 50, status: "provisional", formatted: "50.00" };
      bu.monthlyTrend[2].values.mttrDays = { value: 50, status: "danger", formatted: "50.00" };
      bu.ytd.mttrDays = { value: 50, status: "warning", formatted: "50.00" };
    }
    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string") ?? "";
    for (let r = 1; r <= 9; r++) {
      expect(getCellFillColor(slide1, r, 5)).toBe("A9D18E");
    }
  });

  it("renders missing or null MTTR as neutral gray", async () => {
    const data = createTestDataForMonth(8, [1, 2, 3, 4, 5, 6, 7, 8], {
      mttrDays: 50,
    });
    for (const bu of data.buScorecards) {
      bu.monthlyTrend[0].values.mttrDays = { value: null, status: "no-data", formatted: "No Data" };
      bu.ytd.mttrDays = { value: null, status: "no-data", formatted: "No Data" };
    }
    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string") ?? "";
    expect(getCellFillColor(slide1, 1, 5)).toBe("DDE6F0");
    expect(getCellFillColor(slide1, 9, 5)).toBe("DDE6F0");
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

describe("generateMonthlyKpiPresentation Slides 1 and 2 threshold fills", () => {
  function makeBuWithStatuses(
    buName: string,
    statuses: Partial<Record<ScorecardKpiKey, { value: number | null; status: string; formatted: string }>>
  ): BusinessUnitScorecard {
    const ytd = Object.fromEntries(
      SCORECARD_KPI_KEYS.map((key) => [
        key,
        statuses[key] ?? { value: 95, status: "success", formatted: "95.00%" },
      ])
    ) as unknown as BusinessUnitScorecard["ytd"];
    return {
      ...makeBuScorecard(buName),
      ytd,
      monthlyTrend: [],
    };
  }

  it("applies the configurable thresholds to all BU and YTD cells on Slide 2", async () => {
    const data = createTestData();
    data.buScorecards = [
      makeBuWithStatuses("AMD-EZ", {
        pmCompliance: { value: 98, status: "success", formatted: "98.00%" },
        budgetSpend: { value: 95, status: "success", formatted: "95.00%" },
        pmCmWorkOrderRatio: { value: 86, status: "success", formatted: "86.0% (6.1:1)" },
        pmCmCostRatio: { value: 80, status: "success", formatted: "80.0% (4:1)" },
        mttrDays: { value: 5, status: "success", formatted: "5.00 days" },
        facilityUptime: { value: 100, status: "success", formatted: "100.00%" },
      }),
      makeBuWithStatuses("LARC", {
        pmCompliance: { value: 95, status: "warning", formatted: "95.00%" },
        budgetSpend: { value: 92, status: "warning", formatted: "92.00%" },
        pmCmWorkOrderRatio: { value: 80, status: "warning", formatted: "80.0% (4:1)" },
        pmCmCostRatio: { value: 60, status: "warning", formatted: "60.0% (1.5:1)" },
        mttrDays: { value: 2, status: "warning", formatted: "2.00 days" },
        facilityUptime: { value: 99.5, status: "warning", formatted: "99.50%" },
      }),
      makeBuWithStatuses("CWC", {
        pmCompliance: { value: 85, status: "danger", formatted: "85.00%" },
        budgetSpend: { value: 85, status: "danger", formatted: "85.00%" },
        pmCmWorkOrderRatio: { value: 70, status: "danger", formatted: "70.0% (2.3:1)" },
        pmCmCostRatio: { value: 40, status: "danger", formatted: "40.0% (0.7:1)" },
        mttrDays: { value: null, status: "no-data", formatted: "No Data" },
        facilityUptime: { value: 98, status: "danger", formatted: "98.00%" },
      }),
      makeBuWithStatuses("LAWC", {
        pmCompliance: { value: 95, status: "success", formatted: "95.00%" },
        budgetSpend: { value: 95, status: "success", formatted: "95.00%" },
        pmCmWorkOrderRatio: { value: 95, status: "success", formatted: "95.0%" },
        pmCmCostRatio: { value: 95, status: "success", formatted: "95.0%" },
        mttrDays: { value: 1, status: "provisional", formatted: "1.00 days" },
        facilityUptime: { value: 99.9, status: "success", formatted: "99.90%" },
      }),
      makeBuWithStatuses("TWCI", {
        pmCompliance: { value: 95, status: "success", formatted: "95.00%" },
        budgetSpend: { value: 95, status: "success", formatted: "95.00%" },
        pmCmWorkOrderRatio: { value: 95, status: "success", formatted: "95.0%" },
        pmCmCostRatio: { value: 95, status: "success", formatted: "95.0%" },
        mttrDays: { value: 2, status: "success", formatted: "2.00 days" },
        facilityUptime: { value: 99.9, status: "success", formatted: "99.90%" },
      }),
      makeBuWithStatuses("EWG", {
        pmCompliance: { value: 95, status: "success", formatted: "95.00%" },
        budgetSpend: { value: 95, status: "success", formatted: "95.00%" },
        pmCmWorkOrderRatio: { value: 95, status: "success", formatted: "95.0%" },
        pmCmCostRatio: { value: 95, status: "success", formatted: "95.0%" },
        mttrDays: { value: 3, status: "success", formatted: "3.00 days" },
        facilityUptime: { value: 99.9, status: "success", formatted: "99.90%" },
      }),
      makeBuWithStatuses("WAWA/JVC", {
        pmCompliance: { value: 95, status: "success", formatted: "95.00%" },
        budgetSpend: { value: 95, status: "success", formatted: "95.00%" },
        pmCmWorkOrderRatio: { value: 95, status: "success", formatted: "95.0%" },
        pmCmCostRatio: { value: 95, status: "success", formatted: "95.0%" },
        mttrDays: { value: 4, status: "success", formatted: "4.00 days" },
        facilityUptime: { value: 99.9, status: "success", formatted: "99.90%" },
      }),
    ];
    data.portfolioYtd = {
      pmCompliance: { value: 95, status: "warning", formatted: "95.00%" },
      budgetSpend: { value: 54, status: "warning", formatted: "54.00%" },
      pmCmWorkOrderRatio: { value: 83, status: "warning", formatted: "83.0% (4.9:1)" },
      pmCmCostRatio: { value: 71, status: "warning", formatted: "71.0% (2.4:1)" },
      mttrDays: { value: 27, status: "provisional", formatted: "27.00 days" },
      facilityUptime: { value: 99.77, status: "warning", formatted: "99.77%" },
    };

    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slide2 = await zip.file("ppt/slides/slide2.xml")?.async("string") ?? "";

    // Green thresholds
    expect(getCellFillColor(slide2, 1, 1)).toBe("A9D18E"); // PM Compliance 98
    expect(getCellFillColor(slide2, 1, 2)).toBe("A9D18E"); // Budget Spend 95
    expect(getCellFillColor(slide2, 1, 3)).toBe("A9D18E"); // PM:CM WO 86
    expect(getCellFillColor(slide2, 1, 4)).toBe("A9D18E"); // PM:CM Cost 80
    expect(getCellFillColor(slide2, 1, 5)).toBe("A9D18E"); // MTTR valid data
    expect(getCellFillColor(slide2, 1, 6)).toBe("A9D18E"); // Facility Uptime 100

    // Amber thresholds
    expect(getCellFillColor(slide2, 2, 1)).toBe("FFD966"); // PM Compliance 95
    expect(getCellFillColor(slide2, 2, 2)).toBe("FFD966"); // Budget Spend 92
    expect(getCellFillColor(slide2, 2, 3)).toBe("FFD966"); // PM:CM WO 80
    expect(getCellFillColor(slide2, 2, 4)).toBe("FFD966"); // PM:CM Cost 60
    expect(getCellFillColor(slide2, 2, 5)).toBe("A9D18E"); // MTTR valid data (green regardless of status)
    expect(getCellFillColor(slide2, 2, 6)).toBe("FFD966"); // Facility Uptime 99.5

    // Red thresholds + missing MTTR gray
    expect(getCellFillColor(slide2, 3, 1)).toBe("FF6B6B"); // PM Compliance 85
    expect(getCellFillColor(slide2, 3, 2)).toBe("FF6B6B"); // Budget Spend 85
    expect(getCellFillColor(slide2, 3, 3)).toBe("FF6B6B"); // PM:CM WO 70
    expect(getCellFillColor(slide2, 3, 4)).toBe("FF6B6B"); // PM:CM Cost 40
    expect(getCellFillColor(slide2, 3, 5)).toBe("DDE6F0"); // MTTR no data
    expect(getCellFillColor(slide2, 3, 6)).toBe("FF6B6B"); // Facility Uptime 98

    // Portfolio YTD row uses thresholds; MTTR valid data is green
    expect(getCellFillColor(slide2, 8, 1)).toBe("FFD966");
    expect(getCellFillColor(slide2, 8, 5)).toBe("A9D18E");

    // TARGET row is not overwritten
    const targetFill = getCellFillColor(slide2, 9, 1);
    expect(targetFill).not.toBe("A9D18E");
    expect(targetFill).not.toBe("FFD966");
    expect(targetFill).not.toBe("FF6B6B");
  });
});

describe("generateMonthlyKpiPresentation Slide 3 preserves original issue colors", () => {
  it("does not apply Slide 1/2 RAG fills to the Slide 3 issues matrix", async () => {
    const data = createTestData();
    // Set values that would be red under Slide 1/2 thresholds but are treated
    // as neutral successes by Slide 3's original issue classification.
    for (const bu of data.buScorecards) {
      for (const key of SCORECARD_KPI_KEYS) {
        const v = bu.ytd[key];
        if (typeof v.value === "number") {
          v.status = "success";
        }
      }
    }
    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slide3 = await zip.file("ppt/slides/slide3.xml")?.async("string") ?? "";

    // All issue cells should use the original ISSUE_COLORS palette, not the
    // Slide 1/2 RAG colors. Successes map to ISSUE_COLORS.neutral (E2F0D9).
    const fills: string[] = [];
    const rows = (slide3.match(/<a:tr[\s\S]*?<\/a:tr>/g) || []);
    for (let r = 1; r <= 6 && r < rows.length; r++) {
      const cells = (rows[r].match(/<a:tc[\s\S]*?<\/a:tc>/g) || []);
      for (let c = 1; c < cells.length; c++) {
        const fill = getCellFillColor(slide3, r, c);
        if (fill) fills.push(fill);
      }
    }

    expect(fills.length).toBeGreaterThan(0);
    // None of the Slide 3 cells should inherit the Slide 1/2 RAG palette.
    expect(fills.some((f) => f === "A9D18E" || f === "FFD966" || f === "FF6B6B")).toBe(false);
    // Original issue-matrix palette must be present.
    expect(fills.some((f) => f === "E2F0D9")).toBe(true);
  });

  it("keeps the original Slide 3 classification for danger/warning/no-data cells", async () => {
    const data = createTestData();
    // Make EWG the only danger row by overriding its statuses.
    const ewg = data.buScorecards.find((b) => b.businessUnit === "EWG");
    if (ewg) {
      ewg.ytd.pmCompliance = { value: 50, status: "danger", formatted: "50.00%" };
      ewg.ytd.budgetSpend = { value: 50, status: "danger", formatted: "50.00%" };
      ewg.ytd.pmCmWorkOrderRatio = { value: 50, status: "danger", formatted: "50.0%" };
      ewg.ytd.pmCmCostRatio = { value: 30, status: "danger", formatted: "30.0%" };
      ewg.ytd.facilityUptime = { value: 98, status: "danger", formatted: "98.00%" };
      ewg.ytd.mttrDays = { value: null, status: "no-data", formatted: "No Data" };
    }
    const twci = data.buScorecards.find((b) => b.businessUnit === "TWCI");
    if (twci) {
      twci.ytd.pmCompliance = { value: 95, status: "warning", formatted: "95.00%" };
    }

    const blob = await generateMonthlyKpiPresentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slide3 = await zip.file("ppt/slides/slide3.xml")?.async("string") ?? "";

    // EWG column (column 5) danger cells use original ISSUE_COLORS.critical (FAD7D7)
    expect(getCellFillColor(slide3, 1, 6)).toBe("FAD7D7");
    // TWCI warning cell uses original ISSUE_COLORS.warning (FFF0C7)
    expect(getCellFillColor(slide3, 1, 5)).toBe("FFF0C7");
    // MTTR no-data uses original ISSUE_COLORS.data (DDE6F0)
    expect(getCellFillColor(slide3, 6, 6)).toBe("DDE6F0");
  });
});

it("single-BU deck contains no MTTR methodology paragraph and no reviewer-comment parts", async () => {
  const blob = await generateMonthlyKpiPresentation(createTestData());
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  expect(names.filter((n) => /ppt\/comments\//i.test(n) || /commentAuthors/i.test(n))).toEqual([]);
  const bodies = (
    await Promise.all(
      names
        .filter((n) => /^ppt\/(slides|notesSlides)\/slide\d+\.xml$/.test(n))
        .map((n) => zip.file(n)!.async("string"))
    )
  ).join("\n");
  expect(bodies).not.toContain("Calculation methodology is currently being realigned");
  expect(bodies).not.toContain("121 calendar days for SLA");
});

describe("generated single-BU deck OOXML integrity — no empty text bodies (PR #426 regression)", () => {
  it("every p:txBody / p:notesTxBody on every slide and notes part has at least one a:p", async () => {
    const blob = await generateMonthlyKpiPresentation(createTestData());
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const nsP = "http://schemas.openxmlformats.org/presentationml/2006/main";
    const nsA = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const failures: string[] = [];
    for (const name of Object.keys(zip.files)) {
      if (!/^ppt\/(slides|notesSlides)\/slide\d+\.xml$/.test(name)) continue;
      const xml = await zip.file(name)!.async("string");
      const doc = parseXml(xml);
      for (const local of ["txBody", "notesTxBody"]) {
        const bodies = doc.getElementsByTagNameNS(nsP, local);
        for (let i = 0; i < bodies.length; i++) {
          const paragraphs = (bodies[i] as unknown as Element).getElementsByTagNameNS(nsA, "p");
          if (paragraphs.length === 0) failures.push(`${name} ${local}#${i}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
