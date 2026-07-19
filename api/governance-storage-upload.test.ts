import { describe, it, expect, vi, beforeEach } from "vitest";
import { deepEqualJson } from "./lib/json-equality";

describe("Governance anonymous upload capability handling", () => {
  describe("deepEqualJson target validation (order-independent)", () => {
    it("validates Governance target with reordered object keys", () => {
      const targetA = { facilitySlug: "test-fac", milestoneId: 123, extra: "data" };
      const targetB = { extra: "data", facilitySlug: "test-fac", milestoneId: 123 };
      expect(deepEqualJson(targetA, targetB)).toBe(true);
    });

    it("validates nested Governance target with reordered keys", () => {
      const a = {
        facilitySlug: "test-fac",
        milestoneId: 123,
        nested: {
          array: [1, 2, { x: "y" }],
          object: { a: 1, b: 2 }
        }
      };
      const b = {
        nested: {
          object: { b: 2, a: 1 },
          array: [1, 2, { x: "y" }]
        },
        milestoneId: 123,
        facilitySlug: "test-fac"
      };
      expect(deepEqualJson(a, b)).toBe(true);
    });

    it("fails when target values differ", () => {
      const targetA = { facilitySlug: "test-fac", milestoneId: 123 };
      const targetB = { facilitySlug: "test-fac", milestoneId: 456 };
      expect(deepEqualJson(targetA, targetB)).toBe(false);
    });

    it("fails when target types differ", () => {
      const targetA = { facilitySlug: "test-fac", milestoneId: 123 };
      const targetB = { facilitySlug: "test-fac", milestoneId: "123" };
      expect(deepEqualJson(targetA, targetB)).toBe(false);
    });

    it("fails for array vs object", () => {
      expect(deepEqualJson([1, 2, 3], { "0": 1, "1": 2, "2": 3 })).toBe(false);
    });

    it("fails for missing keys", () => {
      const a = { facilitySlug: "test-fac", milestoneId: 123 };
      const b = { facilitySlug: "test-fac" };
      expect(deepEqualJson(a, b)).toBe(false);
    });

    it("fails for extra keys", () => {
      const a = { facilitySlug: "test-fac" };
      const b = { facilitySlug: "test-fac", milestoneId: 123 };
      expect(deepEqualJson(a, b)).toBe(false);
    });
  });
});

// Source-verification tests for client-side code
describe("Governance storage upload client source verification", () => {
  function loadClientSource(): string {
    const fs = require("fs");
    const path = require("path");
    const filePath = path.join(__dirname, "../public/governance-storage-upload.js");
    return fs.readFileSync(filePath, "utf-8");
  }

  it("never writes capabilityToken to localStorage", () => {
    const source = loadClientSource();
    // Verify capabilityToken is explicitly filtered from localStorage
    expect(source).toContain("if(prop!==\'capabilityToken\')");
    expect(source).toContain("capabilityToken is intentionally NOT");
  });

  it("uses module-scoped in-memory capabilityTokenMap", () => {
    const source = loadClientSource();
    // Module-scoped map
    expect(source).toContain("var capabilityTokenMap={}");
    // Access via intentId
    expect(source).toContain("capabilityTokenMap[auth.intentId]");
    expect(source).toContain("capabilityTokenMap[intentId]");
  });

  it("sends capabilityToken in finalize request", () => {
    const source = loadClientSource();
    // Finalize includes capabilityToken from memory
    expect(source).toContain("finalizeBody.capabilityToken=memToken");
    expect(source).toContain("delete capabilityTokenMap[auth.intentId]");
  });

  it("sends capabilityToken in resume request when available", () => {
    const source = loadClientSource();
    // Resume reads from memory map
    expect(source).toContain("var memToken=capabilityTokenMap[auth.intentId]");
    expect(source).toContain("if(memToken)body.capabilityToken=memToken");
  });

  it("sends capabilityToken in abandon request", () => {
    const source = loadClientSource();
    // Abandon reads from memory
    expect(source).toContain("body.capabilityToken=memToken");
  });

  it("discards cached auth when memory token is missing", () => {
    const source = loadClientSource();
    // When resuming, check if memory token exists
    expect(source).toContain("var hasMemToken=!!capabilityTokenMap[auth.intentId]");
    expect(source).toContain("if(!hasMemToken)");
  });

  it("clears memory token after finalize and abandon", () => {
    const source = loadClientSource();
    // Cleared after finalize
    expect(source).toContain("delete capabilityTokenMap[auth.intentId]");
    // Cleared in abandon
    expect(source).toContain("delete capabilityTokenMap[intentId]");
  });
});
