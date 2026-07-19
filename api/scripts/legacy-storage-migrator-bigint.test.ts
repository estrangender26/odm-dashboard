/**
 * BigInt Type Coercion Tests
 *
 * Tests for proper bigint comparison in ledger validation.
 */

import { describe, it, expect } from "vitest";

describe("BigInt Comparison", () => {
  it("compares bigint values correctly", () => {
    // PostgreSQL returns bigint as string or number depending on driver
    const dbValue = "415592" as any; // From PostgreSQL
    const computedValue = 415592; // JavaScript number

    // String !== Number
    expect(dbValue !== computedValue).toBe(true);

    // BigInt comparison works
    expect(BigInt(dbValue) !== BigInt(computedValue)).toBe(false);
    expect(BigInt(dbValue) === BigInt(computedValue)).toBe(true);
  });

  it("handles large values as BigInt", () => {
    const largeValue = "9223372036854775807"; // Max bigint
    expect(() => BigInt(largeValue)).not.toThrow();
    expect(BigInt(largeValue).toString()).toBe(largeValue);
  });

  it("compares zero values", () => {
    const dbZero = "0";
    const jsZero = 0;

    expect(BigInt(dbZero) === BigInt(jsZero)).toBe(true);
  });
});
