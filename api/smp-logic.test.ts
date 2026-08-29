import { describe, expect, it } from "vitest";
import {
  DEFAULT_SMP_REVISION_LABEL,
  SMP_FILTERABLE_FIELDS,
  SMP_LIFECYCLE_STATUSES,
  SMP_SEARCHABLE_COLUMN_NAMES,
  buildSmpListWhere,
  getSmpListCriteria,
  isSmpLifecycleStatus,
  normalizeSmpCodeKey,
  normalizeSmpRevisionLabel,
  parseSmpRevisionNumber,
  resolveSmpDetailRevision,
  resolveSupersessionBackfill,
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

describe("SMP reference-number identity", () => {
  it("normalizes reference numbers case- and whitespace-insensitively", () => {
    expect(normalizeSmpCodeKey("MW-ENGG-SP-1.0")).toBe("mw-engg-sp-1.0");
    expect(normalizeSmpCodeKey("  mw-engg-sp-1.0  ")).toBe("mw-engg-sp-1.0");
    expect(normalizeSmpCodeKey("MW-ENGG-SP-1.0")).toBe(normalizeSmpCodeKey("mw-engg-sp-1.0"));
    expect(normalizeSmpCodeKey("")).toBe("");
  });
});

describe("SMP revision-scoped structured data", () => {
  const revisions = [
    { id: 1, revision: "Rev. 0", revisionNumber: 0, status: "superseded" },
    { id: 2, revision: "Rev. 1", revisionNumber: 1, status: "current" },
  ];

  it("defaults to the current revision", () => {
    expect(resolveSmpDetailRevision(revisions)?.id).toBe(2);
  });

  it("falls back to the latest revision when nothing is current", () => {
    expect(resolveSmpDetailRevision([
      { id: 1, revision: "Rev. 0", revisionNumber: 0, status: "superseded" },
    ])?.id).toBe(1);
  });

  it("returns null for legacy documents without revisions", () => {
    expect(resolveSmpDetailRevision([])).toBeNull();
  });

  it("respects an explicitly requested revision", () => {
    expect(resolveSmpDetailRevision(revisions, 1)?.id).toBe(1);
    expect(resolveSmpDetailRevision(revisions, 2)?.id).toBe(2);
  });

  it("never resolves a revision that does not belong to the document", () => {
    expect(resolveSmpDetailRevision(revisions, 99)).toBeNull();
  });

  it("cannot mix Rev. 0 and Rev. 1 content: requesting Rev. 0 resolves to Rev. 0 only", () => {
    const rev0 = resolveSmpDetailRevision(revisions, 1);
    expect(rev0).not.toBeNull();
    // The resolved id is the single scoping key for sections/tasks queries.
    expect(rev0!.id).toBe(1);
    expect(rev0!.revision).toBe("Rev. 0");
    // Rev. 1 content is never reachable while Rev. 0 is selected.
    expect(resolveSmpDetailRevision(revisions, 1)!.id).not.toBe(2);
  });
});

describe("SMP supersession backfill planning", () => {
  it("never lets a revision be its own predecessor (no self-supersession)", () => {
    // Normal case: previous current (7) points at the new revision (8).
    expect(resolveSupersessionBackfill([7], 8)).toEqual([7]);
    // Defensive: if the new revision id somehow appeared in the captured set,
    // it is excluded — a revision can never supersede itself.
    expect(resolveSupersessionBackfill([8], 8)).toEqual([]);
    expect(resolveSupersessionBackfill([7, 8, 9], 8)).toEqual([7, 9]);
    // No previous current revision → nothing to backfill.
    expect(resolveSupersessionBackfill([], 8)).toEqual([]);
    // Duplicate ids are deduplicated.
    expect(resolveSupersessionBackfill([7, 7], 8)).toEqual([7]);
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
