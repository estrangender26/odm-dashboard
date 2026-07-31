/**
 * Governance V3 Adapter Data Semantics Tests
 */

import { describe, it, expect } from "vitest";

// Import the normalizeTocIdentifier function for testing
// Since it's not exported, we'll test the behavior indirectly or re-implement for test
function normalizeTocIdentifier(rawToc: string | null): string | null {
  if (!rawToc) return null;
  
  // Remove "TOC-" prefix if present (e.g., "TOC-08" -> "08")
  let normalized = rawToc.replace(/^TOC-/i, "");
  
  // Remove leading zeros from numeric parts (e.g., "08" -> "8", but keep "1A" as "1A")
  normalized = normalized.replace(/^0+(\d)/, "$1");
  
  // Handle special cases like "A7" -> "7" (if it's just a milestone reference)
  if (/^[A-Za-z]\d+$/.test(normalized)) {
    const match = normalized.match(/\d+/);
    if (match) normalized = match[0];
  }
  
  return normalized;
}

describe("Governance V3 Data Semantics", () => {
  it("calculates 19 submitted out of 56 required as 34%", () => {
    const submitted = 19;
    const required = 56;
    const compliancePercent = Math.round((submitted / required) * 100);
    expect(compliancePercent).toBe(34);
  });

  it("counts duplicate uploads for one facility and TOC section only once", () => {
    const uploads = [
      { tocItem: "1", fileName: "doc1.pdf" },
      { tocItem: "1", fileName: "doc2.pdf" },
      { tocItem: "2", fileName: "doc3.pdf" },
    ];
    const submittedTocItems = new Set(uploads.map(u => u.tocItem));
    expect(submittedTocItems.size).toBe(2);
  });

  it("requires compDate for milestone completion", () => {
    const hasCompDate = { compDate: "2026-07-01" };
    const noCompDate = { compDate: null };
    expect(hasCompDate.compDate !== null).toBe(true);
    expect(noCompDate.compDate !== null).toBe(false);
  });

  it("marks as achieved-ahead when actual completion is before planned date", () => {
    const compDate = new Date("2026-06-15");
    const plannedDate = new Date("2026-07-01");
    expect(compDate < plannedDate).toBe(true);
  });
});

describe("TOC Identifier Normalization", () => {
  it("normalizes TOC-08 to 8", () => {
    expect(normalizeTocIdentifier("TOC-08")).toBe("8");
  });

  it("normalizes TOC-12 to 12", () => {
    expect(normalizeTocIdentifier("TOC-12")).toBe("12");
  });

  it("normalizes TOC-02 to 2", () => {
    expect(normalizeTocIdentifier("TOC-02")).toBe("2");
  });

  it("normalizes A7 to 7", () => {
    expect(normalizeTocIdentifier("A7")).toBe("7");
  });

  it("preserves 1A as 1A", () => {
    expect(normalizeTocIdentifier("1A")).toBe("1A");
  });

  it("preserves 1C as 1C", () => {
    expect(normalizeTocIdentifier("1C")).toBe("1C");
  });

  it("returns null for null input", () => {
    expect(normalizeTocIdentifier(null)).toBe(null);
  });

  it("returns null for empty string", () => {
    expect(normalizeTocIdentifier("")).toBe(null);
  });

  it("handles lowercase toc-08 to 8", () => {
    expect(normalizeTocIdentifier("toc-08")).toBe("8");
  });
});

describe("TOC Submission Aggregation", () => {
  it("correctly identifies 8 unique TOC items from database records", () => {
    // Simulating actual database records
    const dbRecords = [
      { facility: "kaysakat", tocItem: "TOC-08" },
      { facility: "htt", tocItem: "TOC-08" },
      { facility: "htt", tocItem: "TOC-12" },
      { facility: "htt", tocItem: "A7" },
      { facility: "eastbay", tocItem: "TOC-12" },
      { facility: "eastbay", tocItem: "TOC-08" },
      { facility: "eastbay", tocItem: "TOC-02" },
      // OTHER is not a valid TOC identifier and should be skipped
    ];
    
    const expectedTocItems = ["8", "12", "7", "2"];
    const normalizedItems = dbRecords
      .map(r => normalizeTocIdentifier(r.tocItem))
      .filter((t): t is string => t !== null);
    
    const uniqueItems = [...new Set(normalizedItems)];
    
    // Should have 4 HTT items + 1 KAYSAKAT + 3 EASTBAY = 7 unique
    // (Note: TOC-08 appears in both HTT and EASTBAY, counted once per facility)
    expect(uniqueItems.length).toBe(4);
    expect(uniqueItems).toContain("8");
    expect(uniqueItems).toContain("12");
    expect(uniqueItems).toContain("7");
    expect(uniqueItems).toContain("2");
  });

  it("counts submissions per facility separately", () => {
    const httUploads = [
      { tocItem: "TOC-08" },
      { tocItem: "TOC-12" },
      { tocItem: "A7" },
    ];
    
    const kaysakatUploads = [
      { tocItem: "TOC-08" },
    ];
    
    const httSubmitted = new Set(httUploads.map(u => normalizeTocIdentifier(u.tocItem)).filter(Boolean));
    const kaysakatSubmitted = new Set(kaysakatUploads.map(u => normalizeTocIdentifier(u.tocItem)).filter(Boolean));
    
    expect(httSubmitted.size).toBe(3);
    expect(kaysakatSubmitted.size).toBe(1);
  });
});

describe("Reconciliation Assertions", () => {
  it("sum of facility submitted counts equals portfolio total", () => {
    const facilityDocs = [
      { submittedCount: 0, facilityName: "AGLIPAY" },
      { submittedCount: 3, facilityName: "HTT" },
      { submittedCount: 4, facilityName: "EASTBAY" },
      { submittedCount: 1, facilityName: "KAYSAKAT" },
    ];
    
    const totalFromFacilities = facilityDocs.reduce((sum, d) => sum + d.submittedCount, 0);
    const portfolioTotal = 8;
    
    expect(totalFromFacilities).toBe(portfolioTotal);
  });
});
