import { describe, expect, it } from "vitest";
import {
  DEFAULT_SMP_REVISION_LABEL,
  SMP_FILTERABLE_FIELDS,
  SMP_LIFECYCLE_STATUSES,
  SMP_SEARCHABLE_COLUMN_NAMES,
  buildSmpListWhere,
  getSmpListCriteria,
  isSmpLifecycleStatus,
  normalizeSmpRevisionLabel,
  parseSmpRevisionNumber,
  validateSmpRevisionUnique,
} from "./smp-logic";

describe("SMP revision governance logic", () => {
  it("normalizes revision labels and defaults to the baseline label", () => {
    expect(normalizeSmpRevisionLabel("Rev. 0")).toBe("Rev. 0");
    expect(normalizeSmpRevisionLabel("  Rev. 1  ")).toBe("Rev. 1");
    expect(normalizeSmpRevisionLabel("")).toBe(DEFAULT_SMP_REVISION_LABEL);
    expect(normalizeSmpRevisionLabel(undefined)).toBe(DEFAULT_SMP_REVISION_LABEL);
    expect(normalizeSmpRevisionLabel(null)).toBe(DEFAULT_SMP_REVISION_LABEL);
  });

  it("caps revision labels to the storage limit", () => {
    const long = "Rev. " + "9".repeat(100);
    expect(normalizeSmpRevisionLabel(long).length).toBeLessThanOrEqual(50);
  });

  it("parses the trailing revision number for ordering", () => {
    expect(parseSmpRevisionNumber("Rev. 0")).toBe(0);
    expect(parseSmpRevisionNumber("Rev. 1")).toBe(1);
    expect(parseSmpRevisionNumber("Revision 10")).toBe(10);
    expect(parseSmpRevisionNumber("Rev. 1.5")).toBe(5);
    expect(parseSmpRevisionNumber("Draft")).toBe(0);
    expect(parseSmpRevisionNumber("")).toBe(0);
  });

  it("rejects a revision label that already exists (no silent overwrite)", () => {
    expect(validateSmpRevisionUnique(["Rev. 0"], "Rev. 0")).toContain("already exists");
    expect(validateSmpRevisionUnique(["Rev. 0", "Rev. 1"], "  rev. 1  ")).toContain("already exists");
    expect(validateSmpRevisionUnique(["Rev. 0"], "Rev. 1")).toBeNull();
    expect(validateSmpRevisionUnique([], "Rev. 0")).toBeNull();
  });
});

describe("SMP library list query criteria", () => {
  it("searches reference number, SMP ID, title, family, asset, equipment, and facility", () => {
    expect(SMP_SEARCHABLE_COLUMN_NAMES).toEqual([
      "code",
      "smp_id",
      "title",
      "smp_family",
      "asset_name",
      "asset_type",
      "equipment_type",
      "facility_type",
    ]);
  });

  it("supports the required filter fields", () => {
    expect([...SMP_FILTERABLE_FIELDS]).toEqual([
      "family",
      "equipmentType",
      "facilityType",
      "criticality",
      "revision",
      "status",
    ]);
  });

  it("normalizes list input into non-empty criteria", () => {
    expect(getSmpListCriteria({})).toEqual({});
    expect(getSmpListCriteria({ search: "  pump  " })).toEqual({ search: "pump" });
    expect(getSmpListCriteria({ search: "  ", family: " Blower System " })).toEqual({
      family: "Blower System",
    });
    expect(
      getSmpListCriteria({
        family: "Centrifugal Pump System",
        equipmentType: "end-suction pumps",
        facilityType: "Treatment",
        criticality: "A",
        revision: "Rev. 0",
        status: "current",
      }),
    ).toEqual({
      family: "Centrifugal Pump System",
      equipmentType: "end-suction pumps",
      facilityType: "Treatment",
      criticality: "A",
      revision: "Rev. 0",
      status: "current",
    });
  });

  it("builds no WHERE condition when nothing is provided", () => {
    expect(buildSmpListWhere({})).toBeUndefined();
    expect(buildSmpListWhere({ search: "   " })).toBeUndefined();
  });

  it("builds a SQL condition for search and for each filter", () => {
    expect(buildSmpListWhere({ search: "pump" })).toBeDefined();
    for (const field of SMP_FILTERABLE_FIELDS) {
      expect(buildSmpListWhere({ [field]: "value" })).toBeDefined();
    }
  });

  it("distinguishes controlled-document lifecycle statuses", () => {
    expect(SMP_LIFECYCLE_STATUSES).toEqual(["current", "superseded"]);
    expect(isSmpLifecycleStatus("current")).toBe(true);
    expect(isSmpLifecycleStatus("superseded")).toBe(true);
    expect(isSmpLifecycleStatus("Active")).toBe(false);
    // Lifecycle statuses build revision-aware conditions.
    expect(buildSmpListWhere({ status: "current" })).toBeDefined();
    expect(buildSmpListWhere({ status: "superseded" })).toBeDefined();
    expect(buildSmpListWhere({ status: "Draft" })).toBeDefined();
  });
});
