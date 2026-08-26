/**
 * Governance V3 Adapter Unit Tests (no database required)
 *
 * Tests calculateFacilityDocumentation via dynamic import to exercise the
 * real upload-based logic without needing DATABASE_URL.
 */

import { describe, it, expect, beforeAll } from "vitest";
import type { FacilityDocumentation } from "./types";
import { aggregatePortfolioSummary } from "./adapter.server";

let calculateFacilityDocumentation: (
  facilitySlug: string,
  facilityName: string,
  deliverableStatuses: any[],
  uploads: any[]
) => FacilityDocumentation;

beforeAll(async () => {
  const mod: any = await import("./adapter.server");
  // Function is not exported; access through module for unit testing.
  calculateFacilityDocumentation = mod.calculateFacilityDocumentation;
  expect(calculateFacilityDocumentation).toBeTypeOf("function");
});

function makeUpload(overrides: Partial<{
  facilitySlug: string;
  milestoneId: string;
  tocItem: string | null;
  category: string;
  fileName: string;
  uploadedAt: Date | null;
  source: "governance_uploads" | "governance_files";
}>) {
  return {
    facilitySlug: "htt",
    milestoneId: "M1",
    tocItem: "TOC-08",
    category: "TOC-08",
    fileName: "evidence.pdf",
    uploadedAt: new Date("2026-08-01"),
    source: "governance_uploads" as const,
    ...overrides,
  };
}

describe("calculateFacilityDocumentation", () => {
  it("marks a TOC item submitted when a non-reference upload maps to it", () => {
    const result = calculateFacilityDocumentation("htt", "HTT STP", [], [
      makeUpload({ facilitySlug: "htt", tocItem: "TOC-01", category: "TOC-01" }),
      makeUpload({ facilitySlug: "htt", tocItem: "TOC-08", category: "TOC-08" }),
    ]);

    expect(result.submittedCount).toBe(2);
    expect(result.submissions.find(s => s.tocId === "1")?.submitted).toBe(true);
    expect(result.submissions.find(s => s.tocId === "8")?.submitted).toBe(true);
    expect(result.submissions.find(s => s.tocId === "2")?.submitted).toBe(false);
  });

  it("does not count reference uploads as TOC submissions", () => {
    const result = calculateFacilityDocumentation("htt", "HTT STP", [], [
      makeUpload({ facilitySlug: "htt", milestoneId: "__ref", tocItem: "TOC-01", category: "references" }),
      makeUpload({ facilitySlug: "htt", milestoneId: "__ref", tocItem: null, category: "references" }),
    ]);

    expect(result.submittedCount).toBe(0);
    expect(result.referenceCount).toBe(2);
    expect(result.milestoneFileCount).toBe(0);
    expect(result.compliancePercent).toBe(0);
  });

  it("separates another facility's uploads", () => {
    const result = calculateFacilityDocumentation("htt", "HTT STP", [], [
      makeUpload({ facilitySlug: "aglipay", tocItem: "TOC-01", category: "TOC-01" }),
      makeUpload({ facilitySlug: "htt", tocItem: "TOC-08", category: "TOC-08" }),
    ]);

    expect(result.submittedCount).toBe(1);
    expect(result.submissions.find(s => s.tocId === "8")?.submitted).toBe(true);
    expect(result.submissions.find(s => s.tocId === "1")?.submitted).toBe(false);
  });

  it("ignores uploads with non-canonical TOC identifiers", () => {
    const result = calculateFacilityDocumentation("htt", "HTT STP", [], [
      makeUpload({ facilitySlug: "htt", tocItem: "TOC-99", category: "TOC-99" }),
      makeUpload({ facilitySlug: "htt", tocItem: "OTHER", category: "OTHER" }),
      makeUpload({ facilitySlug: "htt", tocItem: null, category: "" }),
    ]);

    expect(result.submittedCount).toBe(0);
    expect(result.milestoneFileCount).toBe(3);
  });

  it("counts duplicate evidence uploads once per TOC item for submission but tracks document count", () => {
    const result = calculateFacilityDocumentation("htt", "HTT STP", [], [
      makeUpload({ facilitySlug: "htt", tocItem: "TOC-08", category: "TOC-08", fileName: "a.pdf" }),
      makeUpload({ facilitySlug: "htt", tocItem: "TOC-08", category: "TOC-08", fileName: "b.pdf" }),
    ]);

    expect(result.submittedCount).toBe(1);
    expect(result.submissions.find(s => s.tocId === "8")?.documentCount).toBe(2);
  });

  it("produces the four production-like facility scenarios", () => {
    const scenarios = [
      { slug: "kaysakat", name: "KAYSAKAT TP", missingFiles: 10, submittedTocIds: ["8", "9", "10", "11"] },
      { slug: "eastbay", name: "EASTBAY PH-2 TP", missingFiles: 16, submittedTocIds: ["2", "7", "8", "12"] },
      { slug: "htt", name: "HTT STP", missingFiles: 42, submittedTocIds: ["1", "2", "3", "4", "5", "6", "7", "8", "10", "11", "12"] },
      { slug: "aglipay", name: "AGLIPAY STP", missingFiles: 17, submittedTocIds: ["8", "11", "12"] },
    ];

    for (const scenario of scenarios) {
      const uploads = [];
      for (const tocId of scenario.submittedTocIds) {
        uploads.push(makeUpload({
          facilitySlug: scenario.slug,
          milestoneId: "M1",
          tocItem: `TOC-${tocId.padStart(2, "0")}`,
          category: `TOC-${tocId.padStart(2, "0")}`,
          fileName: `toc-${tocId}.pdf`,
        }));
      }
      uploads.push(makeUpload({
        facilitySlug: scenario.slug,
        milestoneId: "__ref",
        tocItem: "TOC-01",
        category: "references",
        fileName: "reference.pdf",
      }));

      const result = calculateFacilityDocumentation(scenario.slug, scenario.name, [], uploads);
      const submittedTocCount = scenario.submittedTocIds.length;
      expect(result.facilitySlug).toBe(scenario.slug);
      expect(result.milestoneFileCount).toBe(submittedTocCount);
      expect(result.referenceCount).toBe(1);
      expect(result.submittedCount).toBe(submittedTocCount);
      expect(result.requiredCount).toBe(14);
      expect(result.compliancePercent).toBe(Math.round((submittedTocCount / 14) * 100));
      for (const tocId of scenario.submittedTocIds) {
        expect(result.submissions.find(s => s.tocId === tocId)?.submitted).toBe(true);
      }
      const missingTocIds = Array.from({ length: 14 }, (_, i) => (i + 1).toString()).filter(id => !scenario.submittedTocIds.includes(id));
      for (const tocId of missingTocIds) {
        expect(result.submissions.find(s => s.tocId === tocId)?.submitted).toBe(false);
      }
    }
  });
});

describe("Slide 3 documentation readiness — real uploaded TOC evidence", () => {
  it("maps TOC identifiers in multiple canonical forms to the same submission", () => {
    const result = calculateFacilityDocumentation("htt", "HTT STP", [], [
      makeUpload({ facilitySlug: "htt", tocItem: "TOC-08", category: "TOC-08" }),
      makeUpload({ facilitySlug: "htt", tocItem: "08", category: "08" }),
      makeUpload({ facilitySlug: "htt", tocItem: "toc-8", category: "toc-8" }),
    ]);
    expect(result.submissions.find(s => s.tocId === "8")?.submitted).toBe(true);
    expect(result.submissions.find(s => s.tocId === "8")?.documentCount).toBe(3);
    expect(result.submittedCount).toBe(1);
  });

  it("counts only governance_uploads/governance_files evidence — status-table rows alone are not submissions", () => {
    // The third argument (deliverable status rows) is deliberately ignored:
    // Slide 3 submitted checkmarks come from real uploads only.
    const statusRows = [
      { facilitySlug: "htt", tocItem: "1", status: "approved" },
      { facilitySlug: "htt", tocItem: "2", status: "approved" },
      { facilitySlug: "htt", tocItem: "3", status: "approved" },
    ] as any[];
    const result = calculateFacilityDocumentation("htt", "HTT STP", statusRows, []);
    expect(result.submittedCount).toBe(0);
    expect(result.compliancePercent).toBe(0);
  });

  it("produces the exact approved facility compliance percentages from evidence", () => {
    const scenarios = [
      { slug: "kaysakat", name: "KAYSAKAT TP", submitted: ["8"], pct: 7 },
      { slug: "eastbay", name: "EASTBAY PH-2 TP", submitted: ["2", "7", "8", "12"], pct: 29 },
      { slug: "aglipay", name: "AGLIPAY STP", submitted: ["8", "11", "12"], pct: 21 },
      { slug: "htt", name: "HTT STP", submitted: ["1", "2", "3", "4", "5", "6", "7", "8", "10", "11", "12"], pct: 79 },
    ];
    for (const scenario of scenarios) {
      const uploads = scenario.submitted.map(tocId =>
        makeUpload({
          facilitySlug: scenario.slug,
          milestoneId: "M1",
          tocItem: `TOC-${tocId.padStart(2, "0")}`,
          category: `TOC-${tocId.padStart(2, "0")}`,
          fileName: `${tocId}.pdf`,
        })
      );
      uploads.push(makeUpload({
        facilitySlug: scenario.slug,
        milestoneId: "__ref",
        tocItem: "TOC-01",
        category: "references",
        fileName: "reference.pdf",
      }));
      const result = calculateFacilityDocumentation(scenario.slug, scenario.name, [], uploads);
      expect(result.submittedCount).toBe(scenario.submitted.length);
      expect(result.requiredCount).toBe(14);
      expect(result.compliancePercent).toBe(scenario.pct);
      expect(result.referenceCount).toBe(1);
    }
  });

  it("rolls facility submissions up into the portfolio summary (19/56 = 34%)", () => {
    const docs = [
      { facilitySlug: "kaysakat", submittedCount: 1, requiredCount: 14, referenceCount: 1, milestoneFileCount: 1 },
      { facilitySlug: "eastbay", submittedCount: 4, requiredCount: 14, referenceCount: 1, milestoneFileCount: 4 },
      { facilitySlug: "aglipay", submittedCount: 3, requiredCount: 14, referenceCount: 1, milestoneFileCount: 3 },
      { facilitySlug: "htt", submittedCount: 11, requiredCount: 14, referenceCount: 1, milestoneFileCount: 11 },
    ] as unknown as Parameters<typeof aggregatePortfolioSummary>[1];
    const facilities = [
      { slug: "aglipay", currentPhase: "PPP", phaseStatus: "PPP ACTIVE" },
      { slug: "htt", currentPhase: "PPP", phaseStatus: "PPP ACTIVE" },
      { slug: "eastbay", currentPhase: "PRE-PPP", phaseStatus: "PRE-PPP • GATE READY" },
      { slug: "kaysakat", currentPhase: "PRE-PPP", phaseStatus: "PRE-PPP • RECOVERY" },
    ] as unknown as Parameters<typeof aggregatePortfolioSummary>[0];

    const summary = aggregatePortfolioSummary(facilities, docs);
    expect(summary.totalDocumentsSubmitted).toBe(19);
    expect(summary.totalDocumentsRequired).toBe(56);
    expect(summary.portfolioCompliancePercent).toBe(34);
    expect(summary.totalReferenceFiles).toBe(4);
    expect(summary.totalMilestoneFiles).toBe(19);
  });

  it("different facility evidence records produce different documentation output", () => {
    const kaysakat = calculateFacilityDocumentation("kaysakat", "KAYSAKAT TP", [], [
      makeUpload({ facilitySlug: "kaysakat", tocItem: "TOC-08", category: "TOC-08" }),
    ]);
    const htt = calculateFacilityDocumentation("htt", "HTT STP", [], [
      makeUpload({ facilitySlug: "htt", tocItem: "TOC-01", category: "TOC-01" }),
      makeUpload({ facilitySlug: "htt", tocItem: "TOC-08", category: "TOC-08" }),
    ]);
    expect(kaysakat).not.toEqual(htt);
    expect(kaysakat.submittedCount).not.toBe(htt.submittedCount);
    expect(kaysakat.compliancePercent).not.toBe(htt.compliancePercent);
  });

  it("keeps reference files out of the TOC matrix while tracking them separately", () => {
    const result = calculateFacilityDocumentation("eastbay", "EASTBAY PH-2 TP", [], [
      makeUpload({ facilitySlug: "eastbay", milestoneId: "__ref", tocItem: "TOC-02", category: "references", fileName: "ref-a.pdf" }),
      makeUpload({ facilitySlug: "eastbay", milestoneId: "__ref", tocItem: "TOC-07", category: "references", fileName: "ref-b.pdf" }),
      makeUpload({ facilitySlug: "eastbay", milestoneId: "M1", tocItem: "TOC-08", category: "TOC-08", fileName: "evidence.pdf" }),
    ]);
    expect(result.submittedCount).toBe(1);
    expect(result.submissions.find(s => s.tocId === "2")?.submitted).toBe(false);
    expect(result.submissions.find(s => s.tocId === "7")?.submitted).toBe(false);
    expect(result.submissions.find(s => s.tocId === "8")?.submitted).toBe(true);
    expect(result.referenceCount).toBe(2);
    expect(result.milestoneFileCount).toBe(1);
  });
});

describe("governance_deliverable_status structural validation is preserved (non-fatal at fetch)", () => {
  const canonicalToc = Array.from({ length: 14 }, (_, i) => (i + 1).toString());
  const facilities = ["aglipay", "htt", "eastbay", "kaysakat"];

  function completeRows() {
    const rows: any[] = [];
    for (const f of facilities) {
      for (const toc of canonicalToc) {
        rows.push({ facilitySlug: f, tocItem: toc, status: "missing" });
      }
    }
    return rows;
  }

  it("still throws when canonical rows are missing (validator itself unchanged)", async () => {
    const mod: any = await import("./adapter.server");
    const validate = mod.validateCanonicalDeliverableStatuses;
    const rows = completeRows().filter((r) => !(r.facilitySlug === "kaysakat" && r.tocItem === "9"));
    expect(() => validate(rows, facilities, canonicalToc)).toThrow(/DATA INTEGRITY/);
  });

  it("passes when exactly 56 canonical rows exist", async () => {
    const mod: any = await import("./adapter.server");
    const validate = mod.validateCanonicalDeliverableStatuses;
    expect(() => validate(completeRows(), facilities, canonicalToc)).not.toThrow();
  });

  it("does not fail on unrelated facility rows", async () => {
    const mod: any = await import("./adapter.server");
    const validate = mod.validateCanonicalDeliverableStatuses;
    const rows = [...completeRows(), { facilitySlug: "fifth", tocItem: "1", status: "missing" }];
    expect(() => validate(rows, facilities, canonicalToc)).not.toThrow();
  });
});
