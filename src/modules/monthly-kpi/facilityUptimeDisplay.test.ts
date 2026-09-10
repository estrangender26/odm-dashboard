import { describe, expect, it } from "vitest";
import { formatFacilityUptimePercent } from "./facilityUptimeDisplay";

/**
 * PR #427 — Facility Uptime display precision.
 *
 * Max two decimals; authoritative exact 100 reads "100%"; a below-100 value is
 * truncated so it can NEVER be displayed as 100% / 100.00%.
 */
describe("formatFacilityUptimePercent — Facility Uptime display rule", () => {
  it("displays authoritative exact 100 as 100% (never 100.00%)", () => {
    expect(formatFacilityUptimePercent(100)).toBe("100%");
    expect(formatFacilityUptimePercent(100)).not.toBe("100.00%");
  });

  it("keeps ordinary two-decimal values unchanged", () => {
    expect(formatFacilityUptimePercent(99.94)).toBe("99.94%");
    expect(formatFacilityUptimePercent(99.91)).toBe("99.91%");
    expect(formatFacilityUptimePercent(99.61)).toBe("99.61%");
    expect(formatFacilityUptimePercent(99.77)).toBe("99.77%");
    expect(formatFacilityUptimePercent(99.92)).toBe("99.92%");
    expect(formatFacilityUptimePercent(99.98)).toBe("99.98%");
    expect(formatFacilityUptimePercent(99.89)).toBe("99.89%");
  });

  it("applies the existing presentation convention: trailing zeros are trimmed", () => {
    // Existing scorecard convention shows 99.9% (not 99.90%).
    expect(formatFacilityUptimePercent(99.9)).toBe("99.9%");
    expect(formatFacilityUptimePercent(99)).toBe("99%");
    expect(formatFacilityUptimePercent(0)).toBe("0%");
  });

  it("truncates the below-100 edge instead of rounding it up to 100%", () => {
    expect(formatFacilityUptimePercent(99.99621384219294)).toBe("99.99%");
    expect(formatFacilityUptimePercent(99.999)).toBe("99.99%");
    expect(formatFacilityUptimePercent(99.995)).toBe("99.99%");
    expect(formatFacilityUptimePercent(99.999999999)).toBe("99.99%");
    expect(formatFacilityUptimePercent(99.99621384219294)).not.toBe("100%");
    expect(formatFacilityUptimePercent(99.99621384219294)).not.toBe("100.00%");
  });

  it("never displays a below-100 value as 100% and never overstates the value", () => {
    const samples = [
      0, 12.345, 50.005, 88.888, 95.551, 97.99, 98.999, 99.001, 99.1, 99.45,
      99.899, 99.904, 99.949, 99.991, 99.9949, 99.9962, 99.9999,
    ];
    for (const value of samples) {
      const display = formatFacilityUptimePercent(value);
      expect(display.endsWith("%")).toBe(true);
      expect(display).not.toBe("100%");
      expect(display).not.toBe("100.00%");
      const shown = Number(display.replace("%", ""));
      expect(shown).toBeLessThanOrEqual(value + 1e-9);
      expect(value - shown).toBeLessThan(0.01);
    }
  });

  it("keeps the existing two-decimal convention for above-100 values", () => {
    expect(formatFacilityUptimePercent(100.4)).toBe("100.4%");
    expect(formatFacilityUptimePercent(101.23)).toBe("101.23%");
  });

  it("returns an empty display for non-finite input", () => {
    expect(formatFacilityUptimePercent(Number.NaN)).toBe("");
    expect(formatFacilityUptimePercent(Number.POSITIVE_INFINITY)).toBe("");
  });
});
