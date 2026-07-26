/**
 * Tests for Governance Validation
 */

import { describe, it, expect } from "vitest";
import { validateReportingDate, isValidDate } from "./governanceValidation";

describe("validateReportingDate", () => {
  it("should accept valid date", () => {
    const result = validateReportingDate("2026-07-25");
    expect(result.valid).toBe(true);
    expect(result.date).toBeDefined();
  });
  
  it("should reject invalid format", () => {
    const result = validateReportingDate("invalid-date");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid date format");
  });
  
  it("should reject invalid month", () => {
    const result = validateReportingDate("2026-99-99");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid month");
  });
  
  it("should reject invalid day", () => {
    const result = validateReportingDate("2026-07-99");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid day");
  });
  
  it("should reject impossible date (Feb 30)", () => {
    const result = validateReportingDate("2026-02-30");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid calendar date");
  });
  
  it("should reject non-existent date (Apr 31)", () => {
    const result = validateReportingDate("2026-04-31");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid calendar date");
  });
  
  it("should accept Feb 29 in leap year", () => {
    const result = validateReportingDate("2024-02-29");
    expect(result.valid).toBe(true);
  });
  
  it("should reject Feb 29 in non-leap year", () => {
    const result = validateReportingDate("2023-02-29");
    expect(result.valid).toBe(false);
  });
});

describe("isValidDate", () => {
  it("should return true for valid date", () => {
    expect(isValidDate("2026-07-25")).toBe(true);
  });
  
  it("should return false for invalid date", () => {
    expect(isValidDate("invalid")).toBe(false);
  });
});
