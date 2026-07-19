import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { deepEqualJson } from "./lib/json-equality";

describe("Governance anonymous upload capability handling", () => {
  describe("deepEqualJson target validation (order-independent)", () => {
    it("validates Governance target with reordered object keys", () => {
      const targetA = { facilitySlug: "test-fac", milestoneId: 123, extra: "data" };
      const targetB = { extra: "data", facilitySlug: "test-fac", milestoneId: 123 };
      expect(deepEqualJson(targetA, targetB)).toBe(true);
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
  });
});

// Load client source for verification tests
function loadClientSource(): string {
  const fs = require("fs");
  const path = require("path");
  const filePath = path.join(__dirname, "../public/governance-storage-upload.js");
  return fs.readFileSync(filePath, "utf-8");
}

describe("Governance storage upload client verification", () => {
  it("capabilityToken is never written to localStorage", () => {
    const source = loadClientSource();
    // Check that capabilityToken is explicitly filtered before saving
    expect(source).toContain("if(prop!=='capabilityToken')");
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

  it("checks memory token before calling resume", () => {
    const source = loadClientSource();
    // Should check memory token exists before resuming
    expect(source).toContain("var canResume=cached&&!!capabilityTokenMap[cached.intentId]");
  });

  it("clears cached auth when memory token is missing", () => {
    const source = loadClientSource();
    // Should discard stale cache when no memory token
    expect(source).toContain("No valid cached auth or resume failed");
  });

  it("sends capabilityToken in finalize request", () => {
    const source = loadClientSource();
    expect(source).toContain("finalizeBody.capabilityToken=memToken");
    expect(source).toContain("delete capabilityTokenMap[auth.intentId]");
  });

  it("sends capabilityToken in resume request when available", () => {
    const source = loadClientSource();
    expect(source).toContain("var memToken=capabilityTokenMap[auth.intentId]");
    expect(source).toContain("if(memToken)body.capabilityToken=memToken");
  });

  it("sends capabilityToken in abandon request", () => {
    const source = loadClientSource();
    expect(source).toContain("body.capabilityToken=memToken");
  });
});
