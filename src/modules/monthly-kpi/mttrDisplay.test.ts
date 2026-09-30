import { describe, expect, it } from "vitest";
import { formatMttrDays, formatMttrDaysWithUnit } from "./mttrDisplay";

/**
 * MTTR (days) display precision.
 *
 * Presentation-only rule: at most two decimals, no needless trailing zeros and
 * whole numbers stay whole. A sub-day MTTR such as 0.67 must NEVER be rounded
 * to a whole "1".
 */
describe("formatMttrDays — MTTR (days) display rule", () => {
  it("satisfies the required display table", () => {
    expect(formatMttrDays(0)).toBe("0");
    expect(formatMttrDays(1)).toBe("1");
    expect(formatMttrDays(2)).toBe("2");
    expect(formatMttrDays(1.2)).toBe("1.2");
    expect(formatMttrDays(0.5)).toBe("0.5");
    expect(formatMttrDays(1.25)).toBe("1.25");
    expect(formatMttrDays(0.67)).toBe("0.67");
    expect(formatMttrDays(0.6666666666666666)).toBe("0.67");
    expect(formatMttrDays(1.2366666666666666)).toBe("1.24");
    expect(formatMttrDays(2.5)).toBe("2.5");
    expect(formatMttrDays(2)).toBe("2");
  });

  it("never rounds a sub-day MTTR up to a whole day (the reported regression)", () => {
    expect(formatMttrDays(0.6666666666666666)).toBe("0.67");
    expect(formatMttrDays(0.6666666666666666)).not.toBe("1");
    expect(formatMttrDays(0.67)).not.toBe("1");
    expect(formatMttrDays(0.5)).not.toBe("1");
    expect(formatMttrDays(1.2366666666666666)).toBe("1.24");
    expect(formatMttrDays(1.2366666666666666)).not.toBe("1");
  });

  it("keeps whole numbers whole (never 0.00 / 1.00 / 2.00)", () => {
    expect(formatMttrDays(0)).toBe("0");
    expect(formatMttrDays(1)).toBe("1");
    expect(formatMttrDays(2)).toBe("2");
    expect(formatMttrDays(12)).toBe("12");
    expect(formatMttrDays(0)).not.toBe("0.00");
    expect(formatMttrDays(2)).not.toBe("2.00");
  });

  it("trims needless trailing zeros", () => {
    expect(formatMttrDays(2.5)).toBe("2.5");
    expect(formatMttrDays(1.2)).toBe("1.2");
    expect(formatMttrDays(2.5)).not.toBe("2.50");
    expect(formatMttrDays(3.1)).not.toBe("3.10");
  });

  it("rounds half up at the second decimal, including binary-noise cases", () => {
    // 1.005 is stored as 1.00499999999999989; it must still read 1.01.
    expect(formatMttrDays(1.005)).toBe("1.01");
    expect(formatMttrDays(0.125)).toBe("0.13");
    expect(formatMttrDays(0.665)).toBe("0.67");
  });

  it("never emits more than two decimals", () => {
    const samples = [
      0, 0.6666666666666666, 1.2366666666666666, 1.25, 2.5, 3.14159, 1 / 3,
      10 / 3, 0.001, 0.004, 0.005, 99.999, 42.2511, 7, 0.5,
    ];
    for (const value of samples) {
      const display = formatMttrDays(value);
      const decimals = display.includes(".") ? display.split(".")[1].length : 0;
      expect(decimals).toBeLessThanOrEqual(2);
      // No trailing zero survives the trim.
      expect(display.endsWith("0") && display.includes(".")).toBe(false);
    }
  });

  it("round-trips back to the authoritative value within one hundredth", () => {
    const samples = [0, 0.6666666666666666, 1.2366666666666666, 2.5, 1.25, 42.2511];
    for (const value of samples) {
      expect(Math.abs(Number(formatMttrDays(value)) - value)).toBeLessThanOrEqual(0.005 + 1e-9);
    }
  });

  it("returns an empty display for non-finite input", () => {
    expect(formatMttrDays(Number.NaN)).toBe("");
    expect(formatMttrDays(Number.POSITIVE_INFINITY)).toBe("");
    expect(formatMttrDays(Number.NEGATIVE_INFINITY)).toBe("");
  });

  it("applies the identical rule with the \" days\" unit suffix", () => {
    expect(formatMttrDaysWithUnit(0)).toBe("0 days");
    expect(formatMttrDaysWithUnit(1)).toBe("1 days");
    expect(formatMttrDaysWithUnit(2)).toBe("2 days");
    expect(formatMttrDaysWithUnit(0.6666666666666666)).toBe("0.67 days");
    expect(formatMttrDaysWithUnit(1.2366666666666666)).toBe("1.24 days");
    expect(formatMttrDaysWithUnit(2.5)).toBe("2.5 days");
    expect(formatMttrDaysWithUnit(Number.NaN)).toBe("");
    for (const value of [0, 0.6666666666666666, 1.25, 2.5]) {
      expect(formatMttrDaysWithUnit(value)).toBe(`${formatMttrDays(value)} days`);
    }
  });
});
