import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { generateGovernanceV3Presentation } from "./templateGenerator";
import type { GovernanceV3Presentation } from "./types";

const APPROVED_CELLS: Record<string, number[]> = {
  aglipay: [8, 11, 12],
  htt: [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12],
  eastbay: [2, 7, 8, 12],
  kaysakat: [8],
};

const TOC_ITEMS = Array.from({ length: 14 }, (_, i) => (i + 1).toString());

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
        milestones: [],
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
        milestones: [],
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
        milestones: [],
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
        milestones: [],
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
      portfolioObservation: "Portfolio documentation readiness is 34% (19 of 56 deliverables). AGLIPAY has the lowest compliance and remains the highest onboarding risk. A recovery plan is required before the next governance review.",
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
      { slide: 1, total: 148, sp: 146, gf: 0 },
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
