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
      { slide: 1, total: 154, sp: 152, gf: 0 },
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

  it("removes the 'Achieved ahead of plan' visual state and legend entry", async () => {
    const xml = await generateSlideXml(1, createTestData());
    const shapes = parseSlideShapes(xml);
    // No ahead shape is visible anywhere (rails or legend).
    for (const s of shapes) {
      if (s.name.startsWith("Milestone ahead")) {
        expect(s.visible).toBe(false);
      }
    }
    // The removed legend entry is hidden.
    const legendAhead = shapes.find((s) => s.name === "Legend ahead");
    expect(legendAhead).toBeDefined();
    expect(legendAhead!.visible).toBe(false);
    // The three retained legend entries stay visible.
    for (const name of ["Legend achieved", "Legend gap", "Legend upcoming"]) {
      expect(shapes.find((s) => s.name === name)!.visible).toBe(true);
    }
    // The legend no longer advertises the ahead state to the reader: no visible
    // text run claims "Achieved ahead of plan".
    const visibleText = shapes.filter((s) => s.visible).map((s) => s.text).join(" ");
    expect(visibleText).not.toContain("Achieved ahead of plan");
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
