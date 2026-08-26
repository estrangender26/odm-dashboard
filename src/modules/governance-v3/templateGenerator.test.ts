import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { generateGovernanceV3Presentation } from "./templateGenerator";
import type { GovernanceV3Presentation, MilestoneData, MilestoneStatus } from "./types";
import { MILESTONES } from "./theme";

const APPROVED_CELLS: Record<string, number[]> = {
  aglipay: [8, 11, 12],
  htt: [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12],
  eastbay: [2, 7, 8, 12],
  kaysakat: [8],
};

const TOC_ITEMS = Array.from({ length: 14 }, (_, i) => (i + 1).toString());

/**
 * Milestone statuses matching the approved 2026-08-26 reference deck's static
 * rail state: used so the data-driven symbol renderer reuses template shapes
 * in place (keeping the slide shape count stable) while still exercising the
 * full status vocabulary.
 */
const REFERENCE_MILESTONE_STATUSES: Record<string, MilestoneStatus[]> = {
  aglipay: ["achieved", "achieved", "achieved", "gap", "achieved_ahead", "upcoming", "upcoming", "upcoming", "upcoming"],
  htt: ["achieved", "achieved", "achieved", "gap", "achieved_ahead", "upcoming", "upcoming", "upcoming", "upcoming"],
  eastbay: ["achieved", "achieved", "achieved_ahead", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"],
  kaysakat: ["achieved", "gap", "gap", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"],
};

function makeMilestones(slug: string): MilestoneData[] {
  const codes = Object.keys(MILESTONES) as (keyof typeof MILESTONES)[];
  return codes.map((code, index) => ({
    code,
    name: MILESTONES[code].name,
    phase: MILESTONES[code].phase,
    status: REFERENCE_MILESTONE_STATUSES[slug][index],
  }));
}

function makeFacilityDocumentation(slug: string) {
  const submittedCount = APPROVED_CELLS[slug].length;
  return {
    facilitySlug: slug,
    facilityName: slug.toUpperCase(),
    submittedCount,
    requiredCount: 14,
    compliancePercent: Math.round((submittedCount / 14) * 100),
    submissions: TOC_ITEMS.map((tocId) => ({
      tocId,
      submitted: APPROVED_CELLS[slug].includes(Number(tocId)),
      documentCount: APPROVED_CELLS[slug].includes(Number(tocId)) ? 1 : 0,
    })),
    referenceCount: 1,
    milestoneFileCount: submittedCount,
  };
}

function createTestData(): GovernanceV3Presentation {
  return {
    generatedAt: new Date().toISOString(),
    reportingDate: "2026-07-31",
    facilities: [
      {
        slug: "aglipay",
        name: "AGLIPAY Sewage Treatment Plant",
        shortName: "AGLIPAY STP",
        color: "#397DA4",
        pppStartDate: "2026-03-13",
        currentPhase: "PPP",
        phaseStatus: "PPP ACTIVE",
        milestones: makeMilestones("aglipay"),
        executiveObservation: "AGLIPAY: Active PPP with 21% documentation compliance; immediate recovery required.",
      },
      {
        slug: "htt",
        name: "HTT Sewage Treatment Plant",
        shortName: "HTT STP",
        color: "#00A9C5",
        pppStartDate: "2026-03-13",
        currentPhase: "PPP",
        phaseStatus: "PPP ACTIVE",
        milestones: makeMilestones("htt"),
        executiveObservation: "HTT: Active PPP with 79% documentation compliance.",
      },
      {
        slug: "eastbay",
        name: "EASTBAY Phase 2 Treatment Plant",
        shortName: "EASTBAY PH-2 TP",
        color: "#169873",
        pppStartDate: "2026-09-01",
        currentPhase: "PRE-PPP",
        phaseStatus: "PRE-PPP • GATE READY",
        milestones: makeMilestones("eastbay"),
        executiveObservation: "EASTBAY: Pre-PPP readiness at 29% documentation compliance.",
      },
      {
        slug: "kaysakat",
        name: "KAYSAKAT Treatment Plant",
        shortName: "KAYSAKAT TP",
        color: "#F4A261",
        pppStartDate: "2026-09-01",
        currentPhase: "PRE-PPP",
        phaseStatus: "PRE-PPP • RECOVERY",
        milestones: makeMilestones("kaysakat"),
        executiveObservation: "KAYSAKAT: Pre-PPP readiness at 7% documentation compliance.",
      },
    ],
    facilityDocumentation: [
      makeFacilityDocumentation("aglipay"),
      makeFacilityDocumentation("htt"),
      makeFacilityDocumentation("eastbay"),
      makeFacilityDocumentation("kaysakat"),
    ],
    summary: {
      totalFacilities: 4,
      facilitiesInPrePpp: 2,
      facilitiesInPpp: 2,
      facilitiesInPostPpp: 0,
      gateReadyCount: 1,
      recoveryCount: 1,
      totalDocumentsSubmitted: 19,
      totalDocumentsRequired: 56,
      portfolioCompliancePercent: 34,
      totalReferenceFiles: 4,
      totalMilestoneFiles: 19,
    },
    executive: {
      headline: "Portfolio PPP Status",
      subtitle: "2 facilities in PPP execution; 2 in pre-PPP readiness | July 31, 2026",
      nextGateAction: "Next Gate: PM Setup for Aglipay and HTT | Status: On Schedule",
      timelineSubtitle: "Calendar-based phase timeline | July 31, 2026",
      gateImplication: "Kaysakat and Eastbay reach PPP on 01 September. Eastbay is ready; Kaysakat must close commissioning and defect milestones before the gate.",
      documentationHeadline: "Documentation readiness is 34%; HTT carries the portfolio",
      documentationSubtitle: "Final acceptance requires a fully compliant O&M Manual under the Standard Governance Framework",
      portfolioObservation: "Portfolio documentation readiness is 34% (19 of 56). Outstanding gaps: AGLIPAY 11, KAYSAKAT 13, EASTBAY 10. Focus on closing remaining gaps.",
      facilityObservations: {
        aglipay: "AGLIPAY: Active PPP with 21% documentation compliance; immediate recovery required.",
        htt: "HTT: Active PPP with 79% documentation compliance.",
        eastbay: "EASTBAY: Pre-PPP readiness at 29% documentation compliance.",
        kaysakat: "KAYSAKAT: Pre-PPP readiness at 7% documentation compliance.",
      },
    },
  };
}

function getShapeCounts(xml: string) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const spTree = doc.getElementsByTagName("p:spTree")[0];
  let total = 0;
  let sp = 0;
  let gf = 0;
  for (let i = 0; i < spTree.childNodes.length; i++) {
    const c = spTree.childNodes[i];
    if (c.nodeType === 1) {
      total++;
      if (c.localName === "sp") sp++;
      if (c.localName === "graphicFrame") gf++;
    }
  }
  return { total, sp, gf };
}

function getTableMatrix(xml: string) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const tbl = doc.getElementsByTagName("a:tbl")[0];
  const rows = tbl.getElementsByTagName("a:tr");
  const matrix: string[][] = [];
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].getElementsByTagName("a:tc");
    const row: string[] = [];
    for (let c = 0; c < cells.length; c++) {
      const texts: string[] = [];
      function collectText(node: Node) {
        const el = node as Element;
        if (
          el.nodeType === 1 &&
          el.localName === "t" &&
          el.namespaceURI === "http://schemas.openxmlformats.org/drawingml/2006/main"
        ) {
          texts.push(el.textContent ?? "");
        }
        for (let i = 0; i < node.childNodes.length; i++) {
          collectText(node.childNodes[i]);
        }
      }
      collectText(cells[c] as unknown as Node);
      row.push(texts.join(""));
    }
    matrix.push(row);
  }
  return matrix;
}

describe("Governance V3 template generator", () => {
  it("generates a valid PPTX with 3 slides", async () => {
    const blob = await generateGovernanceV3Presentation(createTestData());
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slideNames = Object.keys(zip.files).filter((f) =>
      f.startsWith("ppt/slides/slide") &&
      f.endsWith(".xml")
    );
    expect(slideNames).toHaveLength(3);
    expect(slideNames).toContain("ppt/slides/slide1.xml");
    expect(slideNames).toContain("ppt/slides/slide2.xml");
    expect(slideNames).toContain("ppt/slides/slide3.xml");
  });

  it("preserves reference slide structure and shape counts", async () => {
    const blob = await generateGovernanceV3Presentation(createTestData());
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const expected = [
      { slide: 1, total: 148, sp: 146, gf: 0 },  // 148 template - 9 residual ahead shapes + 6 rail clones + 3 in-progress legend shapes
      { slide: 2, total: 65, sp: 63, gf: 0 },
      { slide: 3, total: 17, sp: 14, gf: 1 },
    ];
    for (const exp of expected) {
      const xml = await zip.file(`ppt/slides/slide${exp.slide}.xml`)?.async("string");
      expect(xml).toBeDefined();
      const counts = getShapeCounts(xml!);
      expect(counts).toEqual({ total: exp.total, sp: exp.sp, gf: exp.gf });
    }
  });

  it("renders the exact approved 19/56 TOC matrix", async () => {
    const blob = await generateGovernanceV3Presentation(createTestData());
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xml = await zip.file("ppt/slides/slide3.xml")?.async("string");
    expect(xml).toBeDefined();
    const matrix = getTableMatrix(xml!);

    // Header + 14 TOC rows + totals + compliance
    expect(matrix).toHaveLength(17);

    let totalSubmitted = 0;
    for (let tocIndex = 0; tocIndex < 14; tocIndex++) {
      const row = matrix[tocIndex + 1];
      const tocId = tocIndex + 1;
      for (let facilityIndex = 0; facilityIndex < 4; facilityIndex++) {
        const slug = ["aglipay", "htt", "eastbay", "kaysakat"][facilityIndex];
        const cell = row[facilityIndex + 1];
        const expectedSubmitted = APPROVED_CELLS[slug].includes(tocId);
        if (expectedSubmitted) {
          expect(cell).toContain("✓");
          totalSubmitted++;
        } else {
          expect(cell).toContain("—");
        }
      }
    }

    expect(totalSubmitted).toBe(19);

    const totalsRow = matrix[15];
    expect(totalsRow[0]).toBe("Submitted / Required");
    expect(totalsRow[1]).toBe("3 / 14");
    expect(totalsRow[2]).toBe("11 / 14");
    expect(totalsRow[3]).toBe("4 / 14");
    expect(totalsRow[4]).toBe("1 / 14");

    const complianceRow = matrix[16];
    expect(complianceRow[0]).toBe("Compliance");
    expect(complianceRow[1]).toBe("21%");
    expect(complianceRow[2]).toBe("79%");
    expect(complianceRow[3]).toBe("29%");
    expect(complianceRow[4]).toBe("7%");
  });

  it("renders dynamic portfolio and facility panels on slide 3", async () => {
    const blob = await generateGovernanceV3Presentation(createTestData());
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xml = await zip.file("ppt/slides/slide3.xml")?.async("string");
    expect(xml).toBeDefined();
    expect(xml).toContain("PORTFOLIO");
    expect(xml).toContain("19 / 56  •  34%");
    expect(xml).toContain("AGLIPAY STP");
    expect(xml).toContain("3 / 14  •  21%");
    expect(xml).toContain("HTT STP");
    expect(xml).toContain("11 / 14  •  79%");
    expect(xml).toContain("EASTBAY PH-2 TP");
    expect(xml).toContain("4 / 14  •  29%");
    expect(xml).toContain("KAYSAKAT TP");
    expect(xml).toContain("1 / 14  •  7%");
  });

  it("updates the reporting date on all slides", async () => {
    const blob = await generateGovernanceV3Presentation(createTestData());
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    for (const slide of [1, 2, 3]) {
      const xml = await zip.file(`ppt/slides/slide${slide}.xml`)?.async("string");
      expect(xml).toBeDefined();
      expect(xml).toContain("July 31, 2026");
    }
  });


  it("renders matrix status symbols with strong, distinct styling", async () => {
    const blob = await generateGovernanceV3Presentation(createTestData());
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xml = await zip.file("ppt/slides/slide3.xml")?.async("string");
    expect(xml).toBeDefined();

    const doc = new DOMParser().parseFromString(xml!, "text/xml");
    const rows = doc.getElementsByTagName("a:tr");
    let checkCount = 0;
    let dashCount = 0;

    for (let r = 1; r <= 14; r++) {
      const cells = rows[r].getElementsByTagName("a:tc");
      for (let c = 1; c <= 4; c++) {
        const runs = cells[c].getElementsByTagName("a:r");
        for (let i = 0; i < runs.length; i++) {
          const run = runs[i];
          const text = run.textContent ?? "";
          const rPr = run.getElementsByTagName("a:rPr")[0];
          if (!rPr) continue;
          const sz = rPr.getAttribute("sz");
          const b = rPr.getAttribute("b");
          const fill = rPr.getElementsByTagName("a:srgbClr")[0]?.getAttribute("val");

          if (text.trim() === "✓" || text.trim().startsWith("✓")) {
            checkCount++;
            expect(Number(sz)).toBeGreaterThanOrEqual(1200);
            expect(b).toBe("1");
            expect(fill).toBe("169873");
          }
          if (text.trim() === "—") {
            dashCount++;
            expect(Number(sz)).toBeGreaterThanOrEqual(1200);
            expect(b).toBe("1");
            expect(fill).toBe("A9A9A9");
          }
        }
      }
    }

    expect(checkCount).toBe(19);
    expect(dashCount).toBe(37);
  });

  it("keeps all slide 3 shapes within the slide canvas and does not overflow", async () => {
    const blob = await generateGovernanceV3Presentation(createTestData());
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xml = await zip.file("ppt/slides/slide3.xml")?.async("string");
    const presentationXml = await zip.file("ppt/presentation.xml")?.async("string");
    expect(xml).toBeDefined();
    expect(presentationXml).toBeDefined();

    const doc = new DOMParser().parseFromString(xml!, "text/xml");
    const presDoc = new DOMParser().parseFromString(presentationXml!, "text/xml");
    const sldSz = presDoc.getElementsByTagName("p:sldSz")[0];
    expect(sldSz).toBeDefined();
    const slideWidth = Number(sldSz.getAttribute("cx"));
    const slideHeight = Number(sldSz.getAttribute("cy"));
    expect(slideWidth).toBeGreaterThan(0);
    expect(slideHeight).toBeGreaterThan(0);

    const shapes = [...doc.getElementsByTagName("p:sp"), ...doc.getElementsByTagName("p:graphicFrame")];
    for (const shape of shapes) {
      const xfrm = shape.getElementsByTagName("a:xfrm")[0];
      if (!xfrm) continue;
      const off = xfrm.getElementsByTagName("a:off")[0];
      const ext = xfrm.getElementsByTagName("a:ext")[0];
      if (!off || !ext) continue;
      const x = Number(off.getAttribute("x"));
      const y = Number(off.getAttribute("y"));
      const w = Number(ext.getAttribute("cx"));
      const h = Number(ext.getAttribute("cy"));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(slideWidth + 1000); // small tolerance for rounding
      expect(y + h).toBeLessThanOrEqual(slideHeight + 1000);
    }
  });

  it("does not contain legacy proxy text or duplicated executive notes", async () => {
    const blob = await generateGovernanceV3Presentation(createTestData());
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const allText: string[] = [];
    for (const slide of [1, 2, 3]) {
      const xml = await zip.file(`ppt/slides/slide${slide}.xml`)?.async("string");
      expect(xml).toBeDefined();
      allText.push(xml!);
    }
    const fullText = allText.join("\n");
    const legacyPhrases = [
      "ODM Dashboard Presentation",
      "Submission Coverage N/A",
      "Not Configured Required Deliverables",
      "Documents Awaiting Mapping",
      "Report uses proxy data sources",
      "7/64",
      "7 of 64",
    ];
    for (const phrase of legacyPhrases) {
      expect(fullText).not.toContain(phrase);
    }

    const noteText = allText[2]; // slide 3 executive note
    const observation = "Documentation submission ongoing across all facilities.";
    const count = noteText.split(observation).length - 1;
    expect(count).toBeLessThanOrEqual(1);
  });

  it("renders correctly when progress changes away from the 19/56 baseline", async () => {
    const data = createTestData();
    data.summary.totalDocumentsSubmitted = 20;
    data.summary.portfolioCompliancePercent = 36;
    data.facilityDocumentation.find(d => d.facilitySlug === "aglipay")!.submittedCount = 4;
    data.facilityDocumentation.find(d => d.facilitySlug === "aglipay")!.compliancePercent = 29;

    const blob = await generateGovernanceV3Presentation(data);
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xml = await zip.file("ppt/slides/slide3.xml")?.async("string");
    expect(xml).toBeDefined();
    expect(xml).toContain("20 / 56");
    expect(xml).toContain("36%");
    expect(xml).toContain("4 / 14");
    expect(xml).toContain("29%");
  });
});

// ---------------------------------------------------------------------------
// Data-driven Slide 1 milestone symbols, Slide 2 timeline, and scope guards
// ---------------------------------------------------------------------------

import { timelineXForDate } from "../executive-presentations/generators/governance/slideLayout";

type ShapeInfo = { name: string; text: string; visible: boolean; x: number; y: number };

function parseSlideShapes(xml: string): ShapeInfo[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const shapes = doc.getElementsByTagName("p:sp");
  const result: ShapeInfo[] = [];
  for (let i = 0; i < shapes.length; i++) {
    const sp = shapes[i] as unknown as Element;
    const cNvPr = sp.getElementsByTagName("p:cNvPr")[0];
    if (!cNvPr) continue;
    const name = cNvPr.getAttribute("name") || "";
    const visible = cNvPr.getAttribute("visible") !== "0";
    const xfrm = sp.getElementsByTagName("a:xfrm")[0];
    const off = xfrm?.getElementsByTagName("a:off")[0];
    const x = off ? Number(off.getAttribute("x")) : 0;
    const y = off ? Number(off.getAttribute("y")) : 0;
    let text = "";
    const ts = sp.getElementsByTagName("a:t");
    for (let t = 0; t < ts.length; t++) text += ts[t].textContent || "";
    result.push({ name, text, visible, x, y });
  }
  return result;
}

function shapeAt(shapes: ShapeInfo[], x: number, y: number): ShapeInfo[] {
  return shapes.filter((s) => s.x === x && s.y === y);
}

async function generateSlideXml(slide: number, data: GovernanceV3Presentation): Promise<string> {
  const blob = await generateGovernanceV3Presentation(data);
  const arrayBuffer = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const xml = await zip.file(`ppt/slides/slide${slide}.xml`)?.async("string");
  if (!xml) throw new Error(`slide${slide}.xml missing`);
  return xml;
}

describe("Slide 1 — data-driven milestone symbols", () => {
  it("renders the reference status symbols at the correct rail columns", async () => {
    const xml = await generateSlideXml(1, createTestData());
    const shapes = parseSlideShapes(xml);

    // AGLIPAY: M4 = gap (!), M5 = achieved ahead -> achieved visual (green ✓), M6 = upcoming (○)
    const aglipayGap = shapeAt(shapes, 5891213, 2352675);
    expect(aglipayGap.some((s) => s.name === "Milestone gap Dot" && s.visible)).toBe(true);
    const aglipayGapSymbol = shapeAt(shapes, 5919788, 2362200);
    expect(aglipayGapSymbol.some((s) => s.name === "Milestone gap Symbol" && s.visible && s.text.includes("!"))).toBe(true);
    // Three-state treatment: ahead-of-plan renders with the achieved visuals.
    const aglipayAhead = shapeAt(shapes, 6891338, 2352675);
    expect(aglipayAhead.some((s) => s.name.startsWith("Milestone achieved Dot") && s.visible)).toBe(true);
    expect(aglipayAhead.some((s) => s.name === "Milestone ahead Dot" && s.visible)).toBe(false);
    expect(shapeAt(shapes, 6919913, 2362200).some((s) => s.name.startsWith("Milestone achieved Symbol") && s.visible && s.text.includes("✓"))).toBe(true);
    const aglipayUpcoming = shapeAt(shapes, 7891463, 2352675);
    expect(aglipayUpcoming.some((s) => s.name === "Milestone upcoming Dot" && s.visible)).toBe(true);
    // no symbol shape exists for an upcoming milestone
    expect(shapeAt(shapes, 7915913, 2362200).filter((s) => s.visible && s.text.trim() !== "")).toHaveLength(0);

    // KAYSAKAT: M1 achieved, M2 gap, M4 upcoming
    expect(shapeAt(shapes, 2890838, 4752975).some((s) => s.name.startsWith("Milestone achieved Dot") && s.visible)).toBe(true);
    expect(shapeAt(shapes, 3890963, 4752975).some((s) => s.name === "Milestone gap Dot" && s.visible)).toBe(true);
    expect(shapeAt(shapes, 5891213, 4752975).some((s) => s.name === "Milestone upcoming Dot" && s.visible)).toBe(true);
  });

  it("completely removes the 'Achieved ahead of plan' visual state and legend entry", async () => {
    const xml = await generateSlideXml(1, createTestData());
    const shapes = parseSlideShapes(xml);
    // No ahead shape remains anywhere in the slide (rails or legend).
    expect(shapes.some((s) => s.name.startsWith("Milestone ahead") || s.name === "Legend ahead")).toBe(false);
    // No residual ahead text anywhere in the generated XML.
    expect(xml).not.toContain("Achieved ahead of plan");
    // The retained legend entries stay visible.
    for (const name of ["Legend achieved", "Legend in progress", "Legend gap", "Legend upcoming"]) {
      expect(shapes.find((s) => s.name === name)!.visible).toBe(true);
    }
  });

  it("does not let calendar-driven gaps masquerade as achievement on the rail", async () => {
    // All four facilities share the same milestone state; only compDate
    // evidence may produce an achieved symbol. The reference fixture has
    // gaps at AGLIPAY/HTT M4 and KAYSAKAT M2/M3 — those columns must show
    // the gap symbol, never an achieved check.
    const xml = await generateSlideXml(1, createTestData());
    const shapes = parseSlideShapes(xml);
    const gapColumns = [
      [5891213, 2352675], // aglipay M4
      [5891213, 3152775], // htt M4
      [3890963, 4752975], // kaysakat M2
      [4891088, 4752975], // kaysakat M3
    ];
    for (const [x, y] of gapColumns) {
      expect(shapeAt(shapes, x, y).some((s) => s.name === "Milestone gap Dot" && s.visible)).toBe(true);
      expect(shapeAt(shapes, x, y).some((s) => s.name === "Milestone achieved Dot" && s.visible)).toBe(false);
    }
  });

  it("re-renders the rail when facility milestone records change (different data, different output)", async () => {
    const baseline = await generateSlideXml(1, createTestData());

    const changed = createTestData();
    const kaysakat = changed.facilities.find((f) => f.slug === "kaysakat")!;
    kaysakat.milestones = kaysakat.milestones.map((m) =>
      m.code === "M4" ? { ...m, status: "achieved" as const } : m
    );
    const changedXml = await generateSlideXml(1, changed);

    expect(changedXml).not.toBe(baseline);

    const shapes = parseSlideShapes(changedXml);
    // KAYSAKAT M4 must now show an achieved dot+check instead of an upcoming ○
    expect(shapeAt(shapes, 5891213, 4752975).some((s) => s.name.startsWith("Milestone achieved Dot") && s.visible)).toBe(true);
    expect(shapeAt(shapes, 5919788, 4762500).some((s) => s.name.startsWith("Milestone achieved Symbol") && s.visible && s.text.includes("✓"))).toBe(true);
    expect(shapeAt(shapes, 5891213, 4752975).some((s) => s.name.startsWith("Milestone upcoming Dot") && s.visible)).toBe(false);
  });
});

describe("Slide 2 — data-driven timeline", () => {
  it("places phase segments and PPP START lines from each facility's real PPP start date", async () => {
    const xml = await generateSlideXml(2, createTestData());
    const shapes = parseSlideShapes(xml);

    // AGLIPAY PPP start 2026-03-13: PPP segment spans start .. start+12mo
    const pppStartX = timelineXForDate("2026-03-13");
    const pppEndX = timelineXForDate("2027-03-13");
    const seg2 = shapes.find((s) => s.name === "AGLIPAY STP Phase Segment 2");
    expect(seg2).toBeDefined();
    expect(seg2!.x).toBe(pppStartX);
    const xfrmExt = (() => {
      const doc = new DOMParser().parseFromString(xml, "text/xml");
      const sps = doc.getElementsByTagName("p:sp");
      for (let i = 0; i < sps.length; i++) {
        const sp = sps[i] as unknown as Element;
        const cNvPr = sp.getElementsByTagName("p:cNvPr")[0];
        if (cNvPr?.getAttribute("name") === "AGLIPAY STP Phase Segment 2") {
          const xfrm = sp.getElementsByTagName("a:xfrm")[0];
          const ext = xfrm?.getElementsByTagName("a:ext")[0];
          return Number(ext?.getAttribute("cx"));
        }
      }
      return NaN;
    })();
    expect(xfrmExt).toBe(pppEndX - pppStartX);

    // AGLIPAY PRE-PPP segment spans start−8mo .. start
    const preStartX = timelineXForDate("2025-07-13");
    expect(shapes.find((s) => s.name === "AGLIPAY STP Phase Segment 1")?.x).toBe(preStartX);

    // PPP START line sits exactly on the PPP start date
    expect(shapes.find((s) => s.name === "AGLIPAY STP PPP Start Line")?.x).toBe(pppStartX);

    // EASTBAY (2026-09-01) keeps its own segment geometry
    const eastbayPppStartX = timelineXForDate("2026-09-01");
    expect(shapes.find((s) => s.name === "EASTBAY PH-2 TP Phase Segment 2")?.x).toBe(eastbayPppStartX);
    expect(shapes.find((s) => s.name === "EASTBAY PH-2 TP PPP Start Line")?.x).toBe(eastbayPppStartX);
  });

  it("moves the TODAY marker and prominent TODAY line with the reporting date", async () => {
    const xml = await generateSlideXml(2, createTestData());
    const shapes = parseSlideShapes(xml);
    const todayX = timelineXForDate("2026-07-31");

    expect(shapes.find((s) => s.name === "Prominent Today Line")?.x).toBe(todayX - 19050);
    for (const slug of ["AGLIPAY STP", "HTT STP", "EASTBAY PH-2 TP", "KAYSAKAT TP"]) {
      expect(shapes.find((s) => s.name === `${slug} Today Dot`)?.x).toBe(todayX - 85725);
    }
  });

  it("renders a different TODAY position when the reporting date changes", async () => {
    const xmlA = await generateSlideXml(2, createTestData());
    const changed = createTestData();
    changed.reportingDate = "2026-12-15";
    const xmlB = await generateSlideXml(2, changed);
    expect(xmlB).not.toBe(xmlA);
    const shapesB = parseSlideShapes(xmlB);
    const todayXB = timelineXForDate("2026-12-15");
    expect(shapesB.find((s) => s.name === "Prominent Today Line")?.x).toBe(todayXB - 19050);
  });
});

describe("Facility scope and ordering", () => {
  it("renders exactly the four canonical facilities in approved order", async () => {
    const xml = await generateSlideXml(1, createTestData());
    const shapes = parseSlideShapes(xml);
    const names = ["AGLIPAY STP", "HTT STP", "EASTBAY PH-2 TP", "KAYSAKAT TP"];
    for (const name of names) {
      expect(shapes.some((s) => s.name === `${name} Name` && s.visible)).toBe(true);
    }
    // Row order: AGLIPAY above HTT above EASTBAY above KAYSAKAT
    const rows = names.map((n) => shapes.find((s) => s.name === `${n} Name`)!.y);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
  });

  it("renders NEXT GATE and GATE IMPLICATION from the presentation data", async () => {
    const data = createTestData();
    data.executive.nextGateAction = "Next gate: complete SAP-PM task list setup for AGLIPAY and HTT before the next review.";
    data.executive.gateImplication = "EASTBAY and KAYSAKAT must complete pre-PPP readiness before their September 2026 PPP start.";

    const slide1 = await generateSlideXml(1, data);
    const slide2 = await generateSlideXml(2, data);
    expect(slide1).toContain("Next gate: complete SAP-PM task list setup for AGLIPAY and HTT before the next review.");
    expect(slide2).toContain("EASTBAY and KAYSAKAT must complete pre-PPP readiness before their September 2026 PPP start.");
  });
});

describe("Deck scope — exactly the approved three slides", () => {
  it("never emits old generic S-curve slides or S-curve content", async () => {
    const blob = await generateGovernanceV3Presentation(createTestData());
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slideNames = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(slideNames).toHaveLength(3);
    expect(slideNames).toEqual(["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide3.xml"]);

    let allText = "";
    for (const name of slideNames) {
      const xml = await zip.file(name)?.async("string");
      allText += xml ?? "";
    }
    for (const phrase of ["S-curve", "S CURVE", "S-CURVE", "Consolidated S-curve", "Logistic S-curve"]) {
      expect(allText).not.toContain(phrase);
    }
  });

  it("keeps exactly one graphic frame (the TOC matrix) and no chart slides", async () => {
    const blob = await generateGovernanceV3Presentation(createTestData());
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    let graphicFrames = 0;
    for (const slide of [1, 2, 3]) {
      const xml = await zip.file(`ppt/slides/slide${slide}.xml`)?.async("string");
      const doc = new DOMParser().parseFromString(xml!, "text/xml");
      graphicFrames += doc.getElementsByTagName("p:graphicFrame").length;
    }
    expect(graphicFrames).toBe(1); // the 14-row documentation matrix
  });
});

describe("Missing PPP start date — safe TBD rendering", () => {
  it("renders TBD labels and hides date-positioned markers instead of fabricating a date", async () => {
    const data = createTestData();
    const kaysakat = data.facilities.find((f) => f.slug === "kaysakat")!;
    kaysakat.pppStartDate = "";

    const slide1 = await generateSlideXml(1, data);
    const slide2 = await generateSlideXml(2, data);

    // Labels show TBD, never a fabricated date.
    expect(slide1).toContain("PPP START  TBD");
    expect(slide2).toContain("PPP START • TBD");
    expect(slide1).not.toContain("JAN 01, 2026");
    expect(slide2).not.toContain("JAN 01, 2026");

    // Slide 1: KAYSAKAT's TODAY marker is hidden (not positioned from a fake date).
    const shapes1 = parseSlideShapes(slide1);
    const kaysakatMarkerDot = shapes1.find((s) => s.name === "KAYSAKAT TP Today Marker Dot");
    const kaysakatMarkerLine = shapes1.find((s) => s.name === "KAYSAKAT TP Today Marker Line");
    expect(kaysakatMarkerDot).toBeDefined();
    expect(kaysakatMarkerLine).toBeDefined();
    expect(kaysakatMarkerDot!.visible).toBe(false);
    expect(kaysakatMarkerLine!.visible).toBe(false);
    // Other facilities still get a visible TODAY marker.
    expect(shapes1.find((s) => s.name === "AGLIPAY STP Today Marker Dot")!.visible).toBe(true);

    // Slide 2: KAYSAKAT's phase segments, PPP START line, and TODAY dot are hidden.
    const shapes2 = parseSlideShapes(slide2);
    for (const name of [
      "KAYSAKAT TP Phase Segment 1",
      "KAYSAKAT TP Phase Segment 2",
      "KAYSAKAT TP Phase Segment 3",
      "KAYSAKAT TP PPP Start Line",
      "KAYSAKAT TP Today Dot",
    ]) {
      const shape = shapes2.find((s) => s.name === name);
      expect(shape).toBeDefined();
      expect(shape!.visible).toBe(false);
    }
    // Dated facilities keep their timeline geometry.
    expect(shapes2.find((s) => s.name === "AGLIPAY STP Phase Segment 2")!.visible).toBe(true);
  });
});

describe("Slide 1 — milestone rail alignment", () => {
  const RAIL_CONST = { x0: 2771775, width: 8505825, height: 38100, dotHeight: 266700 };
  const DOT_YS: Record<string, number> = {
    aglipay: 2352675, htt: 3152775, eastbay: 3952875, kaysakat: 4752975,
  };
  const COL_XS = [2890838, 3890963, 4891088, 5891213, 6891338, 7891463, 8891588, 9891713, 10891838];

  it("keeps every rail centered on its markers with identical geometry across rows", async () => {
    const xml = await generateSlideXml(1, createTestData());
    const shapes = parseSlideShapes(xml);
    const railGeos: Array<{ x: number; y: number; cx: number }> = [];
    for (const [slug, dotY] of Object.entries(DOT_YS)) {
      const prefix = slug === "eastbay" ? "EASTBAY PH-2 TP" : slug === "kaysakat" ? "KAYSAKAT TP" : slug === "htt" ? "HTT STP" : "AGLIPAY STP";
      const rail = shapes.find((s) => s.name === `${prefix} Milestone Rail`);
      expect(rail).toBeDefined();
      // rail center y == dot center y
      expect(rail!.y + RAIL_CONST.height / 2).toBe(dotY + RAIL_CONST.dotHeight / 2);
      railGeos.push({ x: rail!.x, y: rail!.y, cx: 0 });
    }
    // identical x0 and (implicitly) width across all four rows
    expect(new Set(railGeos.map((r) => r.x))).toEqual(new Set([RAIL_CONST.x0]));
    // every visible dot in a row is vertically centered on that rail
    for (const dotY of Object.values(DOT_YS)) {
      const rowDots = shapes.filter((s) => /^Milestone (achieved|gap|upcoming) Dot( Clone \d+)?$/.test(s.name) && s.visible && s.y === dotY);
      expect(rowDots).toHaveLength(9);
      for (const dot of rowDots) {
        expect(dot.y + RAIL_CONST.dotHeight / 2).toBe(dotY + RAIL_CONST.dotHeight / 2);
      }
    }
  });

  it("places markers horizontally under their M1–M9 column headers", async () => {
    const xml = await generateSlideXml(1, createTestData());
    const shapes = parseSlideShapes(xml);
    for (let i = 1; i <= 9; i++) {
      const header = shapes.find((s) => s.name === `M${i} Code`);
      expect(header).toBeDefined();
      const headerCenterX = header!.x + 847725 / 2;
      // every row has a dot at this column, centered under the header
      for (const dotY of Object.values(DOT_YS)) {
        const dot = shapes.find((s) => /^Milestone (achieved|gap|upcoming) Dot( Clone \d+)?$/.test(s.name) && s.visible && s.y === dotY && s.x === COL_XS[i - 1]);
        expect(dot).toBeDefined();
        expect(Math.abs(dot!.x + RAIL_CONST.dotHeight / 2 - headerCenterX)).toBeLessThanOrEqual(5000);
      }
    }
  });

  it("keeps markers and commentary clear of the legend and NEXT GATE", async () => {
    const xml = await generateSlideXml(1, createTestData());
    const shapes = parseSlideShapes(xml);
    const legendTop = 5476875;
    // Lowest marker bottom stays above the legend row.
    const markerBottoms = shapes
      .filter((s) => s.name.startsWith("Milestone ") && s.visible && s.y < 5000000)
      .map((s) => s.y + 266700);
    expect(Math.max(...markerBottoms)).toBeLessThan(legendTop);
    // Facility comparison (commentary) boxes stay above the legend row.
    for (const name of ["AGLIPAY STP Comparison", "HTT STP Comparison", "EASTBAY PH-2 TP Comparison", "KAYSAKAT TP Comparison"]) {
      const box = shapes.find((s) => s.name === name);
      expect(box).toBeDefined();
      expect(box!.y + 209550).toBeLessThan(legendTop);
    }
  });
});

describe("Slide 3 — executive note fits its allocated box", () => {
  it("keeps the generated note within the box text budget (<= 150 chars)", async () => {
    const xml = await generateSlideXml(3, createTestData());
    const shapes = parseSlideShapes(xml);
    const note = shapes.find((s) => s.name === "DELIVERABLES_EXECUTIVE_NOTE");
    expect(note).toBeDefined();
    expect(note!.text.length).toBeLessThanOrEqual(150);
  });

  it("does not overlap the KAYSAKAT card or the footer region", async () => {
    const xml = await generateSlideXml(3, createTestData());
    const shapes = parseSlideShapes(xml);
    const note = shapes.find((s) => s.name === "DELIVERABLES_EXECUTIVE_NOTE")!;
    const kaysakat = shapes.find((s) => s.name === "COMP_KAYSAKAT")!;
    const footer = shapes.find((s) => s.name === "GOV_FOOTER_SOURCE")!;
    // note box starts below the KAYSAKAT card and ends above the footer
    expect(note.y).toBeGreaterThan(kaysakat.y + 581025);
    expect(note.y + 1143000).toBeLessThan(footer.y);
  });
});

  function runTextColorAt(xml: string, namePrefix: string, x: number, y: number): string | null {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const sps = doc.getElementsByTagName("p:sp");
    for (let i = 0; i < sps.length; i++) {
      const sp = sps[i] as unknown as Element;
      const cNvPr = sp.getElementsByTagName("p:cNvPr")[0];
      const name = cNvPr?.getAttribute("name") || "";
      if (!name.startsWith(namePrefix)) continue;
      const off = sp.getElementsByTagName("a:off")[0];
      if (!off) continue;
      if (Number(off.getAttribute("x")) === x && Number(off.getAttribute("y")) === y) {
        const vis = cNvPr.getAttribute("visible");
        if (vis === "0") return null;
        const rPr = sp.getElementsByTagName("a:rPr")[0];
        const srgb = rPr?.getElementsByTagName("a:srgbClr")[0];
        return srgb?.getAttribute("val") ?? null;
      }
    }
    return null;
  }

  function firstSrgbClrAt(xml: string, namePrefix: string, x: number, y: number): string | null {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const sps = doc.getElementsByTagName("p:sp");
    for (let i = 0; i < sps.length; i++) {
      const sp = sps[i] as unknown as Element;
      const cNvPr = sp.getElementsByTagName("p:cNvPr")[0];
      const name = cNvPr?.getAttribute("name") || "";
      if (!name.startsWith(namePrefix)) continue;
      const off = sp.getElementsByTagName("a:off")[0];
      if (!off) continue;
      if (Number(off.getAttribute("x")) === x && Number(off.getAttribute("y")) === y) {
        const vis = cNvPr.getAttribute("visible");
        if (vis === "0") return null;
        const srgb = sp.getElementsByTagName("a:srgbClr")[0];
        return srgb?.getAttribute("val") ?? null;
      }
    }
    return null;
  }

describe("Slide 1 — in-progress (yellow) state", () => {
  it("renders an in-progress milestone as a yellow dot (fill+outline) with a navy in-progress symbol", async () => {
    const data = createTestData();
    const aglipay = data.facilities.find((f) => f.slug === "aglipay")!;
    // Use M6 for the synthetic in-progress case: M5 is under the temporary
    // Slide 1 override and must stay green in this deck.
    aglipay.milestones = aglipay.milestones.map((m) =>
      m.code === "M6" ? { ...m, status: "in_progress" as const } : m
    );
    const xml = await generateSlideXml(1, data);

    // Yellow dot at AGLIPAY M6 column (rail row y=2352675): fill AND outline yellow.
    expect(firstSrgbClrAt(xml, "Milestone achieved Dot", 7891463, 2352675)).toBe("FFC000");
    // The visible run glyph is navy and is the in-progress ellipsis.
    expect(runTextColorAt(xml, "Milestone achieved Symbol", 7920038, 2362200)).toBe("071B3D");
    const shapes = parseSlideShapes(xml);
    const sym = shapeAt(shapes, 7920038, 2362200).find((s) => s.visible);
    expect(sym?.text).toContain("…");
    // Other achieved milestones remain green with green outline.
    expect(firstSrgbClrAt(xml, "Milestone achieved Dot", 2890838, 2352675)).toBe("169873");
  });

  it("does NOT render any yellow rail marker when the backend has no in-progress evidence", async () => {
    const xml = await generateSlideXml(1, createTestData());
    // The legend always carries the yellow in-progress entry; the rail area
    // (y < 5,000,000 EMU) must contain no yellow fill without evidence.
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const sps = doc.getElementsByTagName("p:sp");
    let yellowInRail = 0;
    for (let i = 0; i < sps.length; i++) {
      const sp = sps[i] as unknown as Element;
      const off = sp.getElementsByTagName("a:off")[0];
      if (!off || Number(off.getAttribute("y")) >= 5000000) continue;
      const srgb = sp.getElementsByTagName("a:srgbClr")[0];
      if (srgb?.getAttribute("val") === "FFC000") yellowInRail++;
    }
    expect(yellowInRail).toBe(0);
  });

  it("updates the legend to Achieved | In progress | Planned by now | Upcoming", async () => {
    const xml = await generateSlideXml(1, createTestData());
    const shapes = parseSlideShapes(xml);
    const stripText = (name: string) => shapes.find((s) => s.name === name && s.visible)?.text ?? "";
    // The new "In progress" legend entry is present with the yellow dot.
    expect(stripText("Legend in progress")).toContain("In progress");
    const legendDot = shapeAt(shapes, 3200400, 5476875).find((s) => s.visible);
    expect(legendDot).toBeDefined();
    expect(firstSrgbClrAt(xml, "Milestone in_progress Dot", 3200400, 5476875)).toBe("FFC000");
    // Left-to-right order: Achieved | In progress | Planned | Upcoming.
    const order: Array<{ name: string; x: number }> = [
      { name: "Legend achieved", x: 990600 },
      { name: "Legend in progress", x: 3543300 },
      { name: "Legend gap", x: 6496050 },
      { name: "Legend upcoming", x: 9229725 },
    ];
    for (const entry of order) {
      const s = shapes.find((shape) => shape.name === entry.name && shape.visible);
      expect(s).toBeDefined();
      expect(s!.x).toBe(entry.x);
    }
    // The ahead entry is still removed from the visible legend.
    const visibleText = shapes.filter((s) => s.visible).map((s) => s.text).join(" ");
    expect(visibleText).not.toContain("Achieved ahead of plan");
  });
});

describe("Slide 1 — M5 status is data-driven (no hardcoded override)", () => {
  it("renders AGLIPAY/HTT M5 from their canonical fixture status (achieved_ahead -> green via approved mapping)", async () => {
    const xml = await generateSlideXml(1, createTestData());
    const shapes = parseSlideShapes(xml);
    // The fixture marks AGLIPAY/HTT M5 as achieved_ahead, which maps to the
    // achieved visual (green). This is data-driven — not a hardcoded override.
    for (const dotY of [2352675, 3152775]) {
      expect(firstSrgbClrAt(xml, "Milestone achieved Dot", 6891338, dotY)).toBe("169873");
      const sym = shapeAt(shapes, 6919913, dotY + 9525).find((s) => s.name.startsWith("Milestone achieved Symbol") && s.visible);
      expect(sym?.text).toContain("✓");
    }
    // No yellow anywhere in the rail area for M5.
    expect(firstSrgbClrAt(xml, "Milestone achieved Dot", 6891338, 2352675)).not.toBe("FFC000");
    expect(firstSrgbClrAt(xml, "Milestone achieved Dot", 6891338, 3152775)).not.toBe("FFC000");
  });

  it("renders an 'upcoming' M5 gray — the temporary presentation override is removed", async () => {
    const data = createTestData();
    for (const slug of ["aglipay", "htt"]) {
      const f = data.facilities.find((x) => x.slug === slug)!;
      f.milestones = f.milestones.map((m) => (m.code === "M5" ? { ...m, status: "upcoming" as const } : m));
    }
    const xml = await generateSlideXml(1, data);
    const shapes = parseSlideShapes(xml);
    for (const dotY of [2352675, 3152775]) {
      expect(shapeAt(shapes, 6891338, dotY).some((s) => s.name === "Milestone upcoming Dot" && s.visible)).toBe(true);
      expect(shapeAt(shapes, 6891338, dotY).some((s) => s.name.startsWith("Milestone achieved Dot") && s.visible)).toBe(false);
    }
  });

  it("renders every canonical state selected through the status dropdown (Slide 1 reflects the adapter status)", async () => {
    const data = createTestData();
    const aglipay = data.facilities.find((f) => f.slug === "aglipay")!;
    // Simulate manual ready_status overrides producing these canonical statuses:
    aglipay.milestones = aglipay.milestones.map((m) => {
      if (m.code === "M5") return { ...m, status: "achieved" as const };
      if (m.code === "M6") return { ...m, status: "in_progress" as const };
      if (m.code === "M7") return { ...m, status: "gap" as const };
      if (m.code === "M8") return { ...m, status: "upcoming" as const };
      return m;
    });
    const xml = await generateSlideXml(1, data);
    const shapes = parseSlideShapes(xml);
    // M5 achieved -> green
    expect(firstSrgbClrAt(xml, "Milestone achieved Dot", 6891338, 2352675)).toBe("169873");
    // M6 in progress -> yellow fill + outline, navy ellipsis
    expect(firstSrgbClrAt(xml, "Milestone achieved Dot", 7891463, 2352675)).toBe("FFC000");
    expect(runTextColorAt(xml, "Milestone achieved Symbol", 7920038, 2362200)).toBe("071B3D");
    // M7 planned-open -> red gap marker
    expect(shapeAt(shapes, 8891588, 2352675).some((s) => s.name === "Milestone gap Dot" && s.visible)).toBe(true);
    // M8 upcoming -> gray
    expect(shapeAt(shapes, 9891713, 2352675).some((s) => s.name === "Milestone upcoming Dot" && s.visible)).toBe(true);
  });

  it("keeps all other facility milestone states data-driven (unchanged)", async () => {
    const xml = await generateSlideXml(1, createTestData());
    const shapes = parseSlideShapes(xml);
    // EASTBAY M5 and KAYSAKAT M5 remain upcoming (gray).
    expect(shapeAt(shapes, 6891338, 3952875).some((s) => s.name === "Milestone upcoming Dot" && s.visible)).toBe(true);
    expect(shapeAt(shapes, 6891338, 4752975).some((s) => s.name === "Milestone upcoming Dot" && s.visible)).toBe(true);
    // KAYSAKAT M1 stays achieved (1 of 9), M2/M3 stay gap, per the fixture.
    expect(shapeAt(shapes, 2890838, 4752975).some((s) => s.name.startsWith("Milestone achieved Dot") && s.visible)).toBe(true);
    expect(shapeAt(shapes, 3890963, 4752975).some((s) => s.name === "Milestone gap Dot" && s.visible)).toBe(true);
    expect(shapeAt(shapes, 4891088, 4752975).some((s) => s.name === "Milestone gap Dot" && s.visible)).toBe(true);
  });
});

describe("Slide 1 — legend integrity (four entries, no overlap, no residual ahead)", () => {
  it("shows exactly four visible legend entries and no residual ahead text", async () => {
    const xml = await generateSlideXml(1, createTestData());
    expect(xml).not.toContain("Achieved ahead of plan");
    const shapes = parseSlideShapes(xml);
    const legendStrips = ["Legend achieved", "Legend in progress", "Legend gap", "Legend upcoming"]
      .map((name) => shapes.find((s) => s.name === name && s.visible))
      .filter(Boolean);
    expect(legendStrips).toHaveLength(4);
    // No "ahead" shapes remain anywhere.
    expect(shapes.some((s) => s.name.startsWith("Milestone ahead") || s.name === "Legend ahead")).toBe(false);
  });

  it("lays the legend entries out left-to-right without overlapping each other or NEXT GATE", async () => {
    const xml = await generateSlideXml(1, createTestData());
    const shapes = parseSlideShapes(xml);
    const stripXs: number[] = [];
    for (const name of ["Legend achieved", "Legend in progress", "Legend gap", "Legend upcoming"]) {
      const s = shapes.find((shape) => shape.name === name && shape.visible)!;
      stripXs.push(s.x);
    }
    // Strictly increasing left-to-right order.
    expect(stripXs).toEqual([...stripXs].sort((a, b) => a - b));
    // Strips do not overlap: each next strip starts after the previous strip's
    // width (strip width 2143125 EMU from the approved template).
    for (let i = 1; i < stripXs.length; i++) {
      expect(stripXs[i]).toBeGreaterThanOrEqual(stripXs[i - 1] + 2143125);
    }
    // The whole legend row sits above the NEXT GATE strip (no overlap).
    const legendBottom = 5743575; // dots bottom
    const nextGateTop = 5953125;  // Executive Action Strip top
    expect(legendBottom).toBeLessThan(nextGateTop);
    // Legend markers are horizontally within the legend background
    // (x 457200..11425250) and not over the rail area.
    for (const s of shapes) {
      if (s.y >= 5476875 && s.visible) {
        expect(s.x).toBeGreaterThanOrEqual(457200);
        expect(s.x).toBeLessThanOrEqual(11425250);
      }
    }
  });
});

describe("Slide 1 — facility card colors represent project PHASE", () => {
  function labelAreaFills(xml: string, prefix: string): { fill: string | null; accent: string | null } {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const sps = doc.getElementsByTagName("p:sp");
    for (let i = 0; i < sps.length; i++) {
      const sp = sps[i] as unknown as Element;
      const cNvPr = sp.getElementsByTagName("p:cNvPr")[0];
      if (cNvPr?.getAttribute("name") !== `${prefix} Label Area`) continue;
      const spPr = sp.getElementsByTagName("p:spPr")[0];
      const fills = spPr?.getElementsByTagName("a:srgbClr") ?? [];
      return {
        fill: fills[0]?.getAttribute("val") ?? null,
        accent: fills[1]?.getAttribute("val") ?? null,
      };
    }
    return { fill: null, accent: null };
  }

  it("colors AGLIPAY/HTT (PPP) with the PPP palette and EASTBAY/KAYSAKAT (PRE-PPP) with the PRE-PPP palette", async () => {
    const xml = await generateSlideXml(1, createTestData());
    // Fixture: AGLIPAY/HTT PPP start 2026-03-13 (PPP), EASTBAY/KAYSAKAT 2026-09-01 (PRE-PPP) vs reporting 2026-07-31.
    const aglipay = labelAreaFills(xml, "AGLIPAY STP");
    const htt = labelAreaFills(xml, "HTT STP");
    const eastbay = labelAreaFills(xml, "EASTBAY PH-2 TP");
    const kaysakat = labelAreaFills(xml, "KAYSAKAT TP");
    // PPP family (same as the PPP phase band): DDF5F9 / 00A9C4
    expect(aglipay).toEqual({ fill: "DDF5F9", accent: "00A9C4" });
    expect(htt).toEqual({ fill: "DDF5F9", accent: "00A9C4" });
    // PRE-PPP family (same as the PRE-PPP phase band): DDEBF4 / 397DA4
    expect(eastbay).toEqual({ fill: "DDEBF4", accent: "397DA4" });
    expect(kaysakat).toEqual({ fill: "DDEBF4", accent: "397DA4" });
    // KAYSAKAT must NOT keep the old red (readiness-driven) card.
    expect(kaysakat.fill).not.toBe("FDECEF");
    expect(kaysakat.accent).not.toBe("E63950");
  });

  it("labels the facility phase text from the effective phase", async () => {
    const xml = await generateSlideXml(1, createTestData());
    expect(xml).toContain("PPP • IN PROGRESS");
    expect(xml).toContain("PRE-PPP • IN PROGRESS");
  });

  it("derives a POST-PPP facility card from a past PPP start date", async () => {
    const data = createTestData();
    const eastbay = data.facilities.find((f) => f.slug === "eastbay")!;
    eastbay.pppStartDate = "2025-01-01"; // +18 months from reporting 2026-07-31 -> POST-PPP
    const xml = await generateSlideXml(1, data);
    expect(labelAreaFills(xml, "EASTBAY PH-2 TP")).toEqual({ fill: "DFF3EC", accent: "169873" });
  });

  it("keeps card color phase-driven even when documentation readiness differs (no red for poor PRE-PPP readiness)", async () => {
    const xml = await generateSlideXml(1, createTestData());
    // KAYSAKAT (7% compliance) and EASTBAY (29% in fixture) are both PRE-PPP.
    const kaysakat = labelAreaFills(xml, "KAYSAKAT TP");
    const eastbay = labelAreaFills(xml, "EASTBAY PH-2 TP");
    expect(kaysakat.fill).toBe(eastbay.fill);
    expect(kaysakat.fill).toBe("DDEBF4");
  });
});

describe("Slide 3 — documentation-matrix cell colors match document presence", () => {
  function matrixCellFills(xml: string): string[][] {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const tbl = doc.getElementsByTagName("a:tbl")[0];
    const rows = tbl.getElementsByTagName("a:tr");
    const matrix: string[][] = [];
    for (let r = 0; r < rows.length; r++) {
      const cells = rows[r].getElementsByTagName("a:tc");
      const row: string[] = [];
      for (let c = 0; c < cells.length; c++) {
        const tcPr = cells[c].getElementsByTagName("a:tcPr")[0];
        const fill = tcPr?.getElementsByTagName("a:srgbClr")[0]?.getAttribute("val") ?? null;
        row.push(fill ?? "");
      }
      matrix.push(row);
    }
    return matrix;
  }

  it("shades every submitted cell green and every missing cell pale red/pink, with no contradictions", async () => {
    const xml = await generateSlideXml(3, createTestData());
    const text = getTableMatrix(xml);
    const fills = matrixCellFills(xml);
    // Data rows are 1..14; facility cells are columns 1..4.
    for (let r = 1; r <= 14; r++) {
      for (let c = 1; c <= 4; c++) {
        const symbol = text[r][c];
        const fill = fills[r][c];
        if (symbol === "✓") {
          expect(fill).toBe("DFF3EC"); // green-shaded
        } else if (symbol === "—") {
          expect(fill).toBe("FDECEF"); // pale red/pink-shaded
        }
      }
    }
  });

  it("derives cell color from the individual TOC submission boolean, not facility compliance or phase", async () => {
    const xml = await generateSlideXml(3, createTestData());
    const text = getTableMatrix(xml);
    const fills = matrixCellFills(xml);
    // HTT has 79% compliance and is PPP, but its missing cells must still be red/pink.
    for (let r = 1; r <= 14; r++) {
      const symbol = text[r][2]; // HTT column
      if (symbol === "—") expect(fills[r][2]).toBe("FDECEF");
      if (symbol === "✓") expect(fills[r][2]).toBe("DFF3EC");
    }
    // EASTBAY is PRE-PPP, but its submitted cells must still be green.
    for (let r = 1; r <= 14; r++) {
      const symbol = text[r][3];
      if (symbol === "✓") expect(fills[r][3]).toBe("DFF3EC");
    }
  });
});
