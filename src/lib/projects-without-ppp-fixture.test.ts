import { describe, expect, it } from "vitest";
import {
  PROJECTS_WITHOUT_PPP_FIXTURE,
  PPP_EXCLUDED_TRACKING_IDS,
  assertAuthoritativeProjectFixture,
} from "@db/fixtures/projects-without-ppp";

describe("authoritative Projects without PPP fixture", () => {
  it("contains exactly 50 projects", () => {
    expect(PROJECTS_WITHOUT_PPP_FIXTURE).toHaveLength(50);
    const { recordCount } = assertAuthoritativeProjectFixture();
    expect(recordCount).toBe(50);
  });

  it("has 50 unique Tracking IDs", () => {
    const trackingIds = PROJECTS_WITHOUT_PPP_FIXTURE.map((r) => r.trackingId);
    expect(new Set(trackingIds).size).toBe(50);
    const { uniqueTrackingIds } = assertAuthoritativeProjectFixture();
    expect(uniqueTrackingIds).toBe(50);
  });

  it("excludes the six PPP Tracking IDs", () => {
    expect(PPP_EXCLUDED_TRACKING_IDS).toHaveLength(6);
    const trackingIds = new Set(PROJECTS_WITHOUT_PPP_FIXTURE.map((r) => r.trackingId));
    for (const pppId of PPP_EXCLUDED_TRACKING_IDS) {
      expect(trackingIds.has(pppId)).toBe(false);
    }
  });

  it("contains no demo/fake records", () => {
    const names = PROJECTS_WITHOUT_PPP_FIXTURE.map((r) => r.projectName?.toLowerCase() ?? "");
    const suspicious = names.filter((n) =>
      ["demo", "sample", "test project", "placeholder", "dummy"].some((s) => n.includes(s)),
    );
    expect(suspicious).toEqual([]);
    // Every record must carry the identity fields from the OWNER source.
    for (const record of PROJECTS_WITHOUT_PPP_FIXTURE) {
      expect(record.trackingId.length).toBeGreaterThan(0);
      expect(record.psCode.length).toBeGreaterThan(0);
    }
  });

  it("normalizes the OWNER header typo AMD Grid Heqd -> AMD Grid Head field", () => {
    // The field is literally named amdGridHead; every non-blank value must be a
    // real person from the OWNER source (spot-check known values).
    const heads = PROJECTS_WITHOUT_PPP_FIXTURE.map((r) => r.amdGridHead).filter(Boolean);
    expect(heads.length).toBeGreaterThan(0);
    expect(heads).toContain("Joey Delos Santos");
    expect(heads).toContain("Mark Angelo Paglicawan");
    expect(heads).toContain("Clayton Ramil");
  });

  it("preserves blanks as null without inventing values", () => {
    const blanks = PROJECTS_WITHOUT_PPP_FIXTURE.filter((r) => r.amdGridHead === null);
    expect(blanks.length).toBeGreaterThan(0);
    for (const record of PROJECTS_WITHOUT_PPP_FIXTURE) {
      // "No CM" / "No PM" are literal OWNER values, not blanks.
      expect(record.constructionManager === "").toBe(false);
      expect(record.projectManager === "").toBe(false);
    }
  });

  it("asserts the 50/50 invariant and reports discrepancies instead of mutating", () => {
    expect(() =>
      assertAuthoritativeProjectFixture([
        ...PROJECTS_WITHOUT_PPP_FIXTURE.slice(0, 49),
      ]),
    ).toThrow(/expected exactly 50 records/);

    expect(() =>
      assertAuthoritativeProjectFixture([
        ...PROJECTS_WITHOUT_PPP_FIXTURE.slice(0, 49),
        { ...PROJECTS_WITHOUT_PPP_FIXTURE[0] },
      ]),
    ).toThrow(/unique Tracking IDs/);
  });
});
