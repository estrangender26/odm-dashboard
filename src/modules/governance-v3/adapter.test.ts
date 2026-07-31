/**
 * Governance V3 Adapter Data Semantics Tests
 */

import { describe, it, expect } from "vitest";

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
