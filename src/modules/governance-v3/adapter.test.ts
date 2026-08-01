/**
 * Governance V3 Adapter Tests — Approved 19/56 Baseline
 */

import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { fetchGovernanceV3Data } from "./adapter.server";
import { db } from "@db/connection";
import { governanceUploads, governanceDeliverableStatus, governanceFacilities } from "@db/schema";
import { GOVERNANCE_TOC_ITEMS } from "./theme";
import { eq, sql, and, or } from "drizzle-orm";

// Approved 19/56 fixture: every facility × TOC cell.
const APPROVED_FIXTURE: Record<string, string[]> = {
  aglipay: ["8", "11", "12"],
  htt: ["1", "2", "3", "4", "5", "6", "7", "8", "10", "11", "12"],
  eastbay: ["2", "7", "8", "12"],
  kaysakat: ["8"],
};

describe("Canonical TOC model", () => {
  it("has exactly 14 canonical TOC deliverables", () => {
    expect(GOVERNANCE_TOC_ITEMS.length).toBe(14);
    expect(GOVERNANCE_TOC_ITEMS).not.toContain("1A");
    expect(GOVERNANCE_TOC_ITEMS).not.toContain("1C");
    expect(GOVERNANCE_TOC_ITEMS).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14",
    ]);
  });

  it("calculates 19 approved out of 56 required as 34%", () => {
    const approved = 19;
    const required = 56;
    expect(Math.round((approved / required) * 100)).toBe(34);
  });

  it("matches the approved fixture totals", () => {
    const total = Object.values(APPROVED_FIXTURE).reduce((sum, items) => sum + items.length, 0);
    expect(total).toBe(19);
  });
});

describe("Governance V3 data adapter — 19/56 baseline", () => {
  let data: Awaited<ReturnType<typeof fetchGovernanceV3Data>>;

  beforeAll(async () => {
    data = await fetchGovernanceV3Data(new Date("2026-07-31"));
  });

  it("produces exactly 56 matrix cells (14 rows × 4 facilities)", () => {
    let cells = 0;
    for (const doc of data.facilityDocumentation) {
      cells += doc.submissions.length;
    }
    expect(cells).toBe(56);
  });

  it("reports portfolio required = 56", () => {
    expect(data.summary.totalDocumentsRequired).toBe(56);
  });

  it("reports portfolio approved = 19", () => {
    expect(data.summary.totalDocumentsSubmitted).toBe(19);
  });

  it("reports portfolio compliance = 34%", () => {
    expect(data.summary.portfolioCompliancePercent).toBe(34);
  });

  it("reports facility totals exactly 3, 11, 4, and 1", () => {
    const bySlug = Object.fromEntries(data.facilityDocumentation.map(d => [d.facilitySlug, d.submittedCount]));
    expect(bySlug.aglipay).toBe(3);
    expect(bySlug.htt).toBe(11);
    expect(bySlug.eastbay).toBe(4);
    expect(bySlug.kaysakat).toBe(1);
  });

  it("matches every approved cell in the 56-cell fixture", () => {
    for (const doc of data.facilityDocumentation) {
      const expectedApproved = new Set(APPROVED_FIXTURE[doc.facilitySlug] ?? []);
      for (const sub of doc.submissions) {
        expect(sub.submitted).toBe(expectedApproved.has(sub.tocId));
      }
    }
  });

  it("reconciles matrix checkmarks with portfolio approved count", () => {
    const matrixApproved = data.facilityDocumentation.reduce(
      (sum, doc) => sum + doc.submissions.filter(s => s.submitted).length,
      0
    );
    expect(matrixApproved).toBe(data.summary.totalDocumentsSubmitted);
    expect(matrixApproved).toBe(19);
  });
});

describe("Raw uploads are evidence only", () => {
  let baseline: Awaited<ReturnType<typeof fetchGovernanceV3Data>>;
  let insertedId: number | null = null;

  beforeAll(async () => {
    baseline = await fetchGovernanceV3Data(new Date("2026-07-31"));

    // Insert a supplementary OTHER upload for eastbay
    const result = await db
      .insert(governanceUploads)
      .values({
        facilitySlug: "eastbay",
        milestoneId: "M2",
        category: "OTHER",
        tocItem: "OTHER",
        fileName: "extra-other.pdf",
        fileUrl: "data:application/pdf;base64,AA==",
        uploadedBy: "test-runner",
      })
      .returning({ id: governanceUploads.id });
    insertedId = Number(result[0].id);
  });

  afterAll(async () => {
    if (insertedId !== null) {
      await db.delete(governanceUploads).where(eq(governanceUploads.id, insertedId));
    }
  });

  it("does not change approved counts when raw uploads are added", async () => {
    const afterUpload = await fetchGovernanceV3Data(new Date("2026-07-31"));
    expect(afterUpload.summary.totalDocumentsSubmitted).toBe(baseline.summary.totalDocumentsSubmitted);
    expect(afterUpload.summary.totalDocumentsRequired).toBe(baseline.summary.totalDocumentsRequired);
    expect(afterUpload.summary.portfolioCompliancePercent).toBe(baseline.summary.portfolioCompliancePercent);
  });

  it("does not count OTHER or duplicate evidence uploads toward readiness", async () => {
    // Insert a duplicate-style evidence upload under an already-approved TOC item
    const dupResult = await db
      .insert(governanceUploads)
      .values({
        facilitySlug: "htt",
        milestoneId: "M1",
        category: "TOC-08",
        tocItem: "TOC-08",
        fileName: "duplicate-evidence.pdf",
        fileUrl: "data:application/pdf;base64,AA==",
        uploadedBy: "test-runner",
      })
      .returning({ id: governanceUploads.id });
    const dupId = Number(dupResult[0].id);

    try {
      const afterDup = await fetchGovernanceV3Data(new Date("2026-07-31"));
      expect(afterDup.summary.totalDocumentsSubmitted).toBe(19);
      expect(afterDup.facilityDocumentation.find(d => d.facilitySlug === "htt")?.submittedCount).toBe(11);
    } finally {
      await db.delete(governanceUploads).where(eq(governanceUploads.id, dupId));
    }
  });
});

describe("Status table seed", () => {
  it("has 56 rows total", async () => {
    const rows = await db.select().from(governanceDeliverableStatus);
    expect(rows.length).toBe(56);
  });

  it("has exactly 19 approved rows", async () => {
    const approved = await db
      .select()
      .from(governanceDeliverableStatus)
      .where(eq(governanceDeliverableStatus.status, "approved"));
    expect(approved.length).toBe(19);
  });

  it("has exactly 37 missing rows", async () => {
    const missing = await db
      .select()
      .from(governanceDeliverableStatus)
      .where(eq(governanceDeliverableStatus.status, "missing"));
    expect(missing.length).toBe(37);
  });

  it("does not reset a manually changed status when reapplied", async () => {
    // Change an existing approved row to submitted
    const target = await db
      .select()
      .from(governanceDeliverableStatus)
      .where(and(
        eq(governanceDeliverableStatus.facilitySlug, "kaysakat"),
        eq(governanceDeliverableStatus.tocItem, "8")
      ))
      .limit(1);
    expect(target[0].status).toBe("approved");

    await db
      .update(governanceDeliverableStatus)
      .set({ status: "submitted" })
      .where(eq(governanceDeliverableStatus.id, target[0].id));

    try {
      // Re-run the seed SQL via the same migration statement
      await db.execute(sql`
        INSERT INTO "governance_deliverable_status" ("facility_slug", "toc_item", "status")
        VALUES ('kaysakat', '8', 'approved')
        ON CONFLICT ("facility_slug", "toc_item") DO NOTHING
      `);

      const afterReSeed = await db
        .select()
        .from(governanceDeliverableStatus)
        .where(eq(governanceDeliverableStatus.id, target[0].id));
      expect(afterReSeed[0].status).toBe("submitted");
    } finally {
      // Restore baseline for other tests
      await db
        .update(governanceDeliverableStatus)
        .set({ status: "approved" })
        .where(eq(governanceDeliverableStatus.id, target[0].id));
    }
  });
});

describe("Presentation facility scope", () => {
  it("selects only the four canonical facilities in order", async () => {
    const data = await fetchGovernanceV3Data(new Date("2026-07-31"));
    expect(data.facilities.map(f => f.slug)).toEqual(["aglipay", "htt", "eastbay", "kaysakat"]);
    expect(data.facilityDocumentation.map(d => d.facilitySlug)).toEqual(["aglipay", "htt", "eastbay", "kaysakat"]);
  });

  it("every selected facility has exactly 14 canonical cells", async () => {
    const data = await fetchGovernanceV3Data(new Date("2026-07-31"));
    for (const doc of data.facilityDocumentation) {
      expect(doc.submissions.length).toBe(14);
      expect(doc.requiredCount).toBe(14);
    }
  });

  it("ignores an unrelated fifth facility without changing the 56-cell presentation", async () => {
    // Insert a temporary unrelated facility and one status row
    const otherSlug = "zz_other_test_facility";
    const inserted = await db
      .insert(governanceFacilities)
      .values({ slug: otherSlug, name: "ZZ Other Test Facility", shortName: "ZZ OTHER" })
      .returning({ id: governanceFacilities.id });
    const otherStatus = await db
      .insert(governanceDeliverableStatus)
      .values({ facilitySlug: otherSlug, tocItem: "1", status: "approved" })
      .returning({ id: governanceDeliverableStatus.id });

    try {
      const data = await fetchGovernanceV3Data(new Date("2026-07-31"));
      expect(data.summary.totalDocumentsRequired).toBe(56);
      expect(data.summary.totalDocumentsSubmitted).toBe(19);
      expect(data.facilities.map(f => f.slug)).not.toContain(otherSlug);
    } finally {
      await db.delete(governanceDeliverableStatus).where(eq(governanceDeliverableStatus.id, otherStatus[0].id));
      await db.delete(governanceFacilities).where(eq(governanceFacilities.id, inserted[0].id));
    }
  });
});

describe("Governance progress can change after deployment", () => {
  it("renders 20/56 and 36% when one missing cell becomes approved", async () => {
    // Promote aglipay TOC 5 from missing to approved
    await db
      .update(governanceDeliverableStatus)
      .set({ status: "approved" })
      .where(and(
        eq(governanceDeliverableStatus.facilitySlug, "aglipay"),
        eq(governanceDeliverableStatus.tocItem, "5")
      ));

    try {
      const data = await fetchGovernanceV3Data(new Date("2026-07-31"));
      expect(data.summary.totalDocumentsSubmitted).toBe(20);
      expect(data.summary.totalDocumentsRequired).toBe(56);
      expect(data.summary.portfolioCompliancePercent).toBe(36);
    } finally {
      await db
        .update(governanceDeliverableStatus)
        .set({ status: "missing" })
        .where(and(
          eq(governanceDeliverableStatus.facilitySlug, "aglipay"),
          eq(governanceDeliverableStatus.tocItem, "5")
        ));
    }
  });

  it("renders 18/56 and 32% when one approved cell becomes missing", async () => {
    // Demote htt TOC 11 from approved to missing
    await db
      .update(governanceDeliverableStatus)
      .set({ status: "missing" })
      .where(and(
        eq(governanceDeliverableStatus.facilitySlug, "htt"),
        eq(governanceDeliverableStatus.tocItem, "11")
      ));

    try {
      const data = await fetchGovernanceV3Data(new Date("2026-07-31"));
      expect(data.summary.totalDocumentsSubmitted).toBe(18);
      expect(data.summary.totalDocumentsRequired).toBe(56);
      expect(data.summary.portfolioCompliancePercent).toBe(32);
    } finally {
      await db
        .update(governanceDeliverableStatus)
        .set({ status: "approved" })
        .where(and(
          eq(governanceDeliverableStatus.facilitySlug, "htt"),
          eq(governanceDeliverableStatus.tocItem, "11")
        ));
    }
  });
});

describe("Status validation", () => {
  it("does not count submitted, missing or not_required as approved", async () => {
    // Temporarily set aglipay TOC 8 to each non-approved status and verify counts
    const original = await db
      .select()
      .from(governanceDeliverableStatus)
      .where(and(
        eq(governanceDeliverableStatus.facilitySlug, "aglipay"),
        eq(governanceDeliverableStatus.tocItem, "8")
      ));
    const originalStatus = original[0].status;

    for (const status of ["submitted", "missing", "not_required"] as const) {
      await db
        .update(governanceDeliverableStatus)
        .set({ status })
        .where(and(
          eq(governanceDeliverableStatus.facilitySlug, "aglipay"),
          eq(governanceDeliverableStatus.tocItem, "8")
        ));

      const data = await fetchGovernanceV3Data(new Date("2026-07-31"));
      expect(data.summary.totalDocumentsSubmitted).toBe(18);
    }

    await db
      .update(governanceDeliverableStatus)
      .set({ status: originalStatus })
      .where(and(
        eq(governanceDeliverableStatus.facilitySlug, "aglipay"),
        eq(governanceDeliverableStatus.tocItem, "8")
      ));
  });
});


describe("Approved TOC cell regression", () => {
  it("rejects the previously incorrect approved-cell mappings", () => {
    // Historical incorrect mappings that must never return as the full set.
    const wrongMappings: Record<string, string[]> = {
      aglipay: ["1", "3", "4"],
      htt: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"], // includes 9, omits 12
      eastbay: ["1", "2", "3", "4"],
      kaysakat: ["1"],
    };

    for (const [facility, wrongItems] of Object.entries(wrongMappings)) {
      const expected = new Set(APPROVED_FIXTURE[facility] ?? []);
      const wrong = new Set(wrongItems);
      expect(wrong).not.toEqual(expected);
    }
  });

  it("rejects specific incorrect historical cells", () => {
    const wrongCells: Array<{ facility: string; toc: string }> = [
      { facility: "aglipay", toc: "1" },
      { facility: "aglipay", toc: "3" },
      { facility: "aglipay", toc: "4" },
      { facility: "htt", toc: "9" },
      { facility: "eastbay", toc: "1" },
      { facility: "eastbay", toc: "3" },
      { facility: "eastbay", toc: "4" },
      { facility: "kaysakat", toc: "1" },
    ];

    for (const { facility, toc } of wrongCells) {
      expect(APPROVED_FIXTURE[facility] ?? []).not.toContain(toc);
    }
  });

  it("rejects any approval of TOC item 9 outside HTT", () => {
    for (const [facility, items] of Object.entries(APPROVED_FIXTURE)) {
      if (facility !== "htt") {
        expect(items).not.toContain("9");
      }
    }
  });
});

describe("Canonical structural guard", () => {
  let insertedIds: number[] = [];

  afterEach(async () => {
    for (const id of insertedIds) {
      await db.delete(governanceDeliverableStatus).where(eq(governanceDeliverableStatus.id, id));
    }
    insertedIds = [];
  });

  it("passes when exactly 56 canonical rows exist", async () => {
    const data = await fetchGovernanceV3Data(new Date("2026-07-31"));
    expect(data.summary.totalDocumentsRequired).toBe(56);
    expect(data.facilityDocumentation).toHaveLength(4);
  });

  it("throws when one canonical row is missing", async () => {
    // Delete aglipay TOC 8 (an approved row)
    const target = await db
      .select({ id: governanceDeliverableStatus.id })
      .from(governanceDeliverableStatus)
      .where(and(
        eq(governanceDeliverableStatus.facilitySlug, "aglipay"),
        eq(governanceDeliverableStatus.tocItem, "8")
      ))
      .limit(1);

    await db.delete(governanceDeliverableStatus).where(eq(governanceDeliverableStatus.id, target[0].id));
    insertedIds.push(target[0].id); // track for cleanup if re-inserted, but it's deleted

    await expect(fetchGovernanceV3Data(new Date("2026-07-31"))).rejects.toThrow(
      /Missing 1 combinations.*aglipay:8/
    );

    // Restore for other tests
    await db.insert(governanceDeliverableStatus).values({
      facilitySlug: "aglipay",
      tocItem: "8",
      status: "approved",
    });
  });

  it("throws and reports both missing rows when two canonical rows are absent", async () => {
    const targets = await db
      .select({ id: governanceDeliverableStatus.id, facilitySlug: governanceDeliverableStatus.facilitySlug, tocItem: governanceDeliverableStatus.tocItem })
      .from(governanceDeliverableStatus)
      .where(or(
        and(eq(governanceDeliverableStatus.facilitySlug, "aglipay"), eq(governanceDeliverableStatus.tocItem, "8")),
        and(eq(governanceDeliverableStatus.facilitySlug, "htt"), eq(governanceDeliverableStatus.tocItem, "12"))
      ));

    for (const t of targets) {
      await db.delete(governanceDeliverableStatus).where(eq(governanceDeliverableStatus.id, t.id));
    }

    await expect(fetchGovernanceV3Data(new Date("2026-07-31"))).rejects.toThrow(
      /Missing 2 combinations.*aglipay:8.*htt:12|Missing 2 combinations.*htt:12.*aglipay:8/
    );

    // Restore
    for (const t of targets) {
      await db.insert(governanceDeliverableStatus).values({
        facilitySlug: t.facilitySlug,
        tocItem: t.tocItem,
        status: t.facilitySlug === "aglipay" && t.tocItem === "8" ? "approved" : "approved",
      });
    }
  });

  it("detects duplicate rows by direct helper invocation since the database unique constraint prevents real duplicates", async () => {
    // Import the module to access the helper (it is not exported, so use module import and ts-ignore).
    const mod: any = await import("./adapter.server");
    const validate = mod.validateCanonicalDeliverableStatuses;
    expect(validate).toBeTypeOf("function");
    const rows = [
      { facilitySlug: "htt", tocItem: "1", status: "approved" },
      { facilitySlug: "htt", tocItem: "1", status: "approved" },
    ];
    expect(() =>
      validate(
        rows,
        ["htt"],
        ["1"]
      )
    ).toThrow(/Duplicate combinations.*htt:1/);
  });

  it("ignores an unrelated fifth facility", async () => {
    const otherSlug = "zz_structural_guard_test_facility";
    const inserted = await db
      .insert(governanceFacilities)
      .values({ slug: otherSlug, name: "ZZ Structural Guard Test Facility", shortName: "ZZ OTHER" })
      .returning({ id: governanceFacilities.id });
    const otherStatus = await db
      .insert(governanceDeliverableStatus)
      .values({ facilitySlug: otherSlug, tocItem: "1", status: "approved" })
      .returning({ id: governanceDeliverableStatus.id });

    try {
      const data = await fetchGovernanceV3Data(new Date("2026-07-31"));
      expect(data.summary.totalDocumentsRequired).toBe(56);
      expect(data.summary.totalDocumentsSubmitted).toBe(19);
      expect(data.facilities.map(f => f.slug)).not.toContain(otherSlug);
    } finally {
      await db.delete(governanceDeliverableStatus).where(eq(governanceDeliverableStatus.id, otherStatus[0].id));
      await db.delete(governanceFacilities).where(eq(governanceFacilities.id, inserted[0].id));
    }
  });

  it("throws when a selected facility has a noncanonical TOC row like 1A", async () => {
    const bad = await db
      .insert(governanceDeliverableStatus)
      .values({
        facilitySlug: "aglipay",
        tocItem: "1A",
        status: "approved",
      })
      .returning({ id: governanceDeliverableStatus.id });
    insertedIds.push(bad[0].id);

    await expect(fetchGovernanceV3Data(new Date("2026-07-31"))).rejects.toThrow(
      /Noncanonical TOC rows for selected facilities.*aglipay:1A/
    );
  });

  it("throws when a selected facility has a noncanonical TOC row like OTHER", async () => {
    const bad = await db
      .insert(governanceDeliverableStatus)
      .values({
        facilitySlug: "aglipay",
        tocItem: "OTHER",
        status: "approved",
      })
      .returning({ id: governanceDeliverableStatus.id });
    insertedIds.push(bad[0].id);

    await expect(fetchGovernanceV3Data(new Date("2026-07-31"))).rejects.toThrow(
      /Noncanonical TOC rows for selected facilities.*aglipay:OTHER/
    );
  });

  it("does not trigger the structural guard when only an approved status changes", async () => {
    // Promote aglipay TOC 5 from missing to approved
    await db
      .update(governanceDeliverableStatus)
      .set({ status: "approved" })
      .where(and(
        eq(governanceDeliverableStatus.facilitySlug, "aglipay"),
        eq(governanceDeliverableStatus.tocItem, "5")
      ));

    try {
      const data = await fetchGovernanceV3Data(new Date("2026-07-31"));
      expect(data.summary.totalDocumentsSubmitted).toBe(20);
      expect(data.summary.totalDocumentsRequired).toBe(56);
    } finally {
      await db
        .update(governanceDeliverableStatus)
        .set({ status: "missing" })
        .where(and(
          eq(governanceDeliverableStatus.facilitySlug, "aglipay"),
          eq(governanceDeliverableStatus.tocItem, "5")
        ));
    }
  });

  it("still renders 18/56 when one approved cell is demoted", async () => {
    await db
      .update(governanceDeliverableStatus)
      .set({ status: "missing" })
      .where(and(
        eq(governanceDeliverableStatus.facilitySlug, "htt"),
        eq(governanceDeliverableStatus.tocItem, "11")
      ));

    try {
      const data = await fetchGovernanceV3Data(new Date("2026-07-31"));
      expect(data.summary.totalDocumentsSubmitted).toBe(18);
      expect(data.summary.totalDocumentsRequired).toBe(56);
      expect(data.summary.portfolioCompliancePercent).toBe(32);
    } finally {
      await db
        .update(governanceDeliverableStatus)
        .set({ status: "approved" })
        .where(and(
          eq(governanceDeliverableStatus.facilitySlug, "htt"),
          eq(governanceDeliverableStatus.tocItem, "11")
        ));
    }
  });
});
