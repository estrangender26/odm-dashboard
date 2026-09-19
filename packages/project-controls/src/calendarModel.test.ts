import { describe, expect, it } from "vitest";
import {
  calendarAffectsActiveSchedule,
  formatWorkingDays,
  normalizeWorkingDays,
  validateWorkingDays,
  workingDaysEqual,
} from "./calendarModel";

describe("calendarModel", () => {
  it("normalizes Sunday 7 to 0 and drops duplicates", () => {
    expect(normalizeWorkingDays([1, 1, 7, 5])).toEqual([0, 1, 5]);
  });

  it("rejects empty and invalid workingDays", () => {
    expect(() => validateWorkingDays([])).toThrow(/at least one/i);
    expect(() => validateWorkingDays([9])).toThrow(/valid weekday/i);
    expect(validateWorkingDays([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("compares working day sets independently of order", () => {
    expect(workingDaysEqual([5, 1, 2], [1, 2, 5])).toBe(true);
    expect(workingDaysEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it("formats weekday labels Mon–Sun", () => {
    expect(formatWorkingDays([1, 2, 3, 4, 5])).toBe("Mon, Tue, Wed, Thu, Fri");
    expect(formatWorkingDays([6, 0])).toBe("Sat, Sun");
  });

  it("treats default calendar and active assignments as schedule-relevant", () => {
    expect(calendarAffectsActiveSchedule(10, 10, [])).toBe(true);
    expect(calendarAffectsActiveSchedule(10, 11, [11])).toBe(true);
    expect(calendarAffectsActiveSchedule(10, 11, [null, 12])).toBe(false);
    expect(calendarAffectsActiveSchedule(10, 11, [])).toBe(false);
  });
});
