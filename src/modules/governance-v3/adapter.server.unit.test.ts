/**
 * Governance V3 Adapter Unit Tests (no database required)
 *
 * Tests calculateFacilityDocumentation via dynamic import to exercise the
 * real upload-based logic without needing DATABASE_URL.
 */

import { describe, it, expect, beforeAll } from "vitest";
import type { FacilityDocumentation } from "./types";

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
