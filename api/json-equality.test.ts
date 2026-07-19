import { describe, it, expect } from "vitest";
import { deepEqualJson } from "./lib/json-equality";

describe("deepEqualJson", () => {
  it("returns true for identical primitives", () => {
    expect(deepEqualJson(1, 1)).toBe(true);
    expect(deepEqualJson("hello", "hello")).toBe(true);
    expect(deepEqualJson(true, true)).toBe(true);
    expect(deepEqualJson(null, null)).toBe(true);
  });

  it("returns false for different primitives", () => {
    expect(deepEqualJson(1, 2)).toBe(false);
    expect(deepEqualJson("hello", "world")).toBe(false);
    expect(deepEqualJson(true, false)).toBe(false);
  });

  it("returns false for null vs undefined", () => {
    expect(deepEqualJson(null, undefined)).toBe(false);
    expect(deepEqualJson(undefined, null)).toBe(false);
  });

  it("returns false for type mismatches", () => {
    expect(deepEqualJson(1, "1")).toBe(false);
    expect(deepEqualJson("1", 1)).toBe(false);
    expect(deepEqualJson(true, "true")).toBe(false);
    expect(deepEqualJson(0, false)).toBe(false);
  });

  describe("objects", () => {
    it("returns true for objects with same keys in different order", () => {
      const a = { a: 1, b: 2, c: 3 };
      const b = { c: 3, b: 2, a: 1 };
      expect(deepEqualJson(a, b)).toBe(true);
    });

    it("returns true for nested objects with reordered keys", () => {
      const a = { x: { a: 1, b: 2 }, y: 3 };
      const b = { y: 3, x: { b: 2, a: 1 } };
      expect(deepEqualJson(a, b)).toBe(true);
    });

    it("returns false when object values differ", () => {
      const a = { a: 1, b: 2 };
      const b = { a: 1, b: 3 };
      expect(deepEqualJson(a, b)).toBe(false);
    });

    it("returns false when object types differ", () => {
      const a = { a: 1, b: 2 };
      const b = { a: 1, b: "2" };
      expect(deepEqualJson(a, b)).toBe(false);
    });

    it("returns false when keys are missing", () => {
      const a = { a: 1, b: 2 };
      const b = { a: 1 };
      expect(deepEqualJson(a, b)).toBe(false);
    });

    it("returns false when extra keys exist", () => {
      const a = { a: 1 };
      const b = { a: 1, b: 2 };
      expect(deepEqualJson(a, b)).toBe(false);
    });

    it("returns true for empty objects", () => {
      expect(deepEqualJson({}, {})).toBe(true);
    });
  });

  describe("arrays", () => {
    it("returns true for arrays with same elements in same order", () => {
      expect(deepEqualJson([1, 2, 3], [1, 2, 3])).toBe(true);
    });

    it("returns false for arrays with different order (order preserved)", () => {
      expect(deepEqualJson([1, 2, 3], [3, 2, 1])).toBe(false);
    });

    it("returns true for nested arrays", () => {
      expect(deepEqualJson([[1, 2], [3, 4]], [[1, 2], [3, 4]])).toBe(true);
    });

    it("returns false for arrays with different lengths", () => {
      expect(deepEqualJson([1, 2], [1, 2, 3])).toBe(false);
    });

    it("returns true for empty arrays", () => {
      expect(deepEqualJson([], [])).toBe(true);
    });
  });

  describe("array vs object", () => {
    it("returns false for array vs object", () => {
      expect(deepEqualJson([1, 2, 3], { "0": 1, "1": 2, "2": 3 })).toBe(false);
      expect(deepEqualJson({ "0": 1, "1": 2 }, [1, 2])).toBe(false);
    });
  });

  describe("complex nested structures", () => {
    it("returns true for deeply nested equal structures", () => {
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

    it("returns false for deeply nested unequal structures", () => {
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
          array: [1, 2, { x: "z" }] // Different value here
        },
        milestoneId: 123,
        facilitySlug: "test-fac"
      };
      expect(deepEqualJson(a, b)).toBe(false);
    });
  });
});
