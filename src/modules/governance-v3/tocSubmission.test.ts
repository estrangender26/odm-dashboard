import { describe, it, expect } from "vitest";
import {
  normalizeTocIdentifier,
  isSupplementaryUpload,
  calculateFacilityTocSubmissions,
  calculatePortfolioSubmittedFromDocumentations,
} from "./tocSubmission";

describe("TOC identifier normalization", () => {
  it.each([
    ["TOC-08", "8"],
    ["toc-12", "12"],
    ["TOC-02", "2"],
    ["A7", "7"],
    ["1A", "1A"],
    ["1C", "1C"],
    ["TOC-1A", "1A"],
    ["TOC-1C", "1C"],
    ["TOC-07", "7"],
    ["08", "8"],
  ])("normalizes %p -> %p", (raw, expected) => {
    expect(normalizeTocIdentifier(raw)).toBe(expected);
  });

  it("returns null for null/empty input", () => {
    expect(normalizeTocIdentifier(null)).toBeNull();
    expect(normalizeTocIdentifier("")).toBeNull();
  });
});

describe("Supplementary upload classification", () => {
  it("classifies OTHER and references as supplementary", () => {
    expect(isSupplementaryUpload("OTHER", "TOC-08")).toBe(true);
    expect(isSupplementaryUpload("references", "TOC-08")).toBe(true);
  });

  it("classifies unknown TOC items as supplementary", () => {
    expect(isSupplementaryUpload("TOC-99", "TOC-99")).toBe(true);
    expect(isSupplementaryUpload("UNKNOWN", null)).toBe(true);
  });

  it("does not classify valid TOC items as supplementary", () => {
    expect(isSupplementaryUpload("TOC-08", "TOC-08")).toBe(false);
    expect(isSupplementaryUpload("A7", "A7")).toBe(false);
    expect(isSupplementaryUpload("TOC-1A", "TOC-1A")).toBe(false);
  });
});

describe("Duplicate uploads", () => {
  it("counts the same facility + TOC item only once", () => {
    const result = calculateFacilityTocSubmissions("htt", [
      { facilitySlug: "htt", tocItem: "TOC-08", category: "TOC-08", fileName: "a.pdf" },
      { facilitySlug: "htt", tocItem: "TOC-08", category: "TOC-08", fileName: "b.pdf" },
      { facilitySlug: "htt", tocItem: "TOC-12", category: "TOC-12", fileName: "c.pdf" },
      { facilitySlug: "htt", tocItem: "A7", category: "A7", fileName: "d.pdf" },
    ]);

    expect(result.submittedTocIds.size).toBe(3);
    expect([...result.submittedTocIds].sort()).toEqual(["12", "7", "8"]);
  });

  it("counts duplicates across different facilities separately", () => {
    const htt = calculateFacilityTocSubmissions("htt", [
      { facilitySlug: "htt", tocItem: "TOC-08", category: "TOC-08", fileName: "a.pdf" },
    ]);
    const eastbay = calculateFacilityTocSubmissions("eastbay", [
      { facilitySlug: "eastbay", tocItem: "TOC-08", category: "TOC-08", fileName: "b.pdf" },
    ]);

    expect(htt.submittedTocIds.size).toBe(1);
    expect(eastbay.submittedTocIds.size).toBe(1);
  });
});

describe("Supplementary upload exclusion", () => {
  it("excludes OTHER uploads from facility counts", () => {
    const result = calculateFacilityTocSubmissions("eastbay", [
      { facilitySlug: "eastbay", tocItem: "TOC-12", category: "TOC-12", fileName: "a.pdf" },
      { facilitySlug: "eastbay", tocItem: "OTHER", category: "OTHER", fileName: "b.pdf" },
      { facilitySlug: "eastbay", tocItem: "TOC-08", category: "TOC-08", fileName: "c.pdf" },
      { facilitySlug: "eastbay", tocItem: "TOC-02", category: "TOC-02", fileName: "d.pdf" },
      { facilitySlug: "eastbay", tocItem: "OTHER", category: "OTHER", fileName: "e.pdf" },
    ]);

    expect(result.submittedTocIds.size).toBe(3);
    expect([...result.submittedTocIds].sort()).toEqual(["12", "2", "8"]);
  });

  it("excludes facility 'all' reference uploads", () => {
    const result = calculateFacilityTocSubmissions("all", [
      { facilitySlug: "all", tocItem: "references", category: "references", fileName: "IOM.pdf" },
    ]);

    expect(result.submittedTocIds.size).toBe(0);
  });
});

describe("Portfolio to matrix reconciliation", () => {
  it("portfolio submitted equals visible matrix checkmarks", () => {
    const facilityDocumentations = [
      {
        submissions: [
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
        ],
      },
      {
        submissions: [
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: true },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
        ],
      },
      {
        submissions: [
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: true },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: true },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: true },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
        ],
      },
      {
        submissions: [
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: true },
          { submitted: true },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: true },
          { submitted: false },
          { submitted: false },
          { submitted: false },
          { submitted: false },
        ],
      },
    ];

    const visibleMatrixSubmitted = calculatePortfolioSubmittedFromDocumentations(facilityDocumentations);
    const portfolioSubmitted = facilityDocumentations.reduce(
      (sum, doc) => sum + doc.submissions.filter((s) => s.submitted).length,
      0
    );

    expect(visibleMatrixSubmitted).toBe(portfolioSubmitted);
    expect(visibleMatrixSubmitted).toBe(7);
  });

  it("reconciles with the real-world data shape from the database", () => {
    // Simulated 2026-07-31 upload records (normalized view)
    const uploads = [
      { facilitySlug: "kaysakat", tocItem: "TOC-08", category: "TOC-08", fileName: "wir1.pdf" },
      { facilitySlug: "kaysakat", tocItem: "TOC-08", category: "TOC-08", fileName: "wir2.pdf" },
      { facilitySlug: "eastbay", tocItem: "TOC-12", category: "TOC-12", fileName: "asset.pdf" },
      { facilitySlug: "eastbay", tocItem: "OTHER", category: "OTHER", fileName: "punchlist.pdf" },
      { facilitySlug: "eastbay", tocItem: "TOC-08", category: "TOC-08", fileName: "reports.pdf" },
      { facilitySlug: "eastbay", tocItem: "OTHER", category: "OTHER", fileName: "test1.pdf" },
      { facilitySlug: "eastbay", tocItem: "TOC-02", category: "TOC-02", fileName: "pfd.pdf" },
      { facilitySlug: "eastbay", tocItem: "TOC-12", category: "TOC-12", fileName: "spare.pdf" },
      { facilitySlug: "htt", tocItem: "TOC-08", category: "TOC-08", fileName: "inlet.pdf" },
      { facilitySlug: "htt", tocItem: "TOC-12", category: "TOC-12", fileName: "spare.xlsx" },
      { facilitySlug: "htt", tocItem: "A7", category: "A7", fileName: "spare.xlsx" },
      { facilitySlug: "htt", tocItem: "TOC-08", category: "TOC-08", fileName: "electrical.pdf" },
      { facilitySlug: "all", tocItem: "references", category: "references", fileName: "IOM.pdf" },
    ];

    const facilities = ["aglipay", "kaysakat", "eastbay", "htt"];
    const perFacility = facilities.map((slug) =>
      calculateFacilityTocSubmissions(slug, uploads)
    );

    expect(perFacility[0].submittedTocIds.size).toBe(0); // aglipay
    expect(perFacility[1].submittedTocIds.size).toBe(1); // kaysakat
    expect(perFacility[2].submittedTocIds.size).toBe(3); // eastbay
    expect(perFacility[3].submittedTocIds.size).toBe(3); // htt

    const portfolioSubmitted = perFacility.reduce(
      (sum, doc) => sum + doc.submittedTocIds.size,
      0
    );
    expect(portfolioSubmitted).toBe(7);
  });
});
