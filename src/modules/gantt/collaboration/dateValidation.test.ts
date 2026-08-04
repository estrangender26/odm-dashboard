import { describe, it, expect } from "vitest";
import { isValidGanttDate } from "./dateValidation";

describe("isValidGanttDate", () => {
  it("accepts valid dates", () => {
    expect(isValidGanttDate("2026-08-04")).toBe(true);
    expect(isValidGanttDate("2024-02-29")).toBe(true);
    expect(isValidGanttDate("2026-08-04 14:30")).toBe(true);
  });

  it("rejects impossible calendar dates", () => {
    expect(isValidGanttDate("2026-02-31")).toBe(false);
    expect(isValidGanttDate("2023-02-29")).toBe(false);
    expect(isValidGanttDate("2026-13-01")).toBe(false);
    expect(isValidGanttDate("2026-01-00")).toBe(false);
  });

  it("rejects invalid times", () => {
    expect(isValidGanttDate("2026-08-04 25:00")).toBe(false);
    expect(isValidGanttDate("2026-08-04 12:61")).toBe(false);
  });

  it("rejects malformed strings", () => {
    expect(isValidGanttDate("Aug 4 2026")).toBe(false);
    expect(isValidGanttDate("2026/08/04")).toBe(false);
    expect(isValidGanttDate("2026-8-4")).toBe(false);
  });
});
