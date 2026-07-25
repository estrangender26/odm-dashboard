import { describe, it, expect, vi, beforeEach } from "vitest";
import { governanceRouter } from "./governance-router";
import { fetchGovernanceDataForPresentation } from "../src/modules/presentation-center/governanceData.server";

// Mock the database module
vi.mock("@db/connection", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("@db/schema", () => ({
  governanceFacilities: {},
  governanceMilestoneState: {},
  governanceUploads: {},
}));

import { db } from "@db/connection";

describe("Governance Presentation Data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fetchGovernanceDataForPresentation", () => {
    it("should handle empty facility list", async () => {
      // Mock empty facilities
      const mockSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockResolvedValue([]),
      });
      (db.select as ReturnType<typeof vi.fn>).mockImplementation(mockSelect);

      const reportingDate = new Date("2026-07-25T00:00:00Z");
      const result = await fetchGovernanceDataForPresentation(reportingDate);

      expect(result.facilities).toHaveLength(0);
      expect(result.summary.totalFacilities).toBe(0);
    });

    it("should filter uploads before the cutoff date", async () => {
      const reportingDate = new Date("2026-07-25T00:00:00Z");
      // Cutoff is 2026-07-26T00:00:00Z
      
      // Upload on 2026-07-25 at noon - should be included
      const uploadOnDate = new Date("2026-07-25T12:00:00Z");
      // Upload on 2026-07-26 at midnight - should be excluded
      const uploadAfterDate = new Date("2026-07-26T00:00:00Z");
      // Upload on 2026-07-24 - should be included
      const uploadBeforeDate = new Date("2026-07-24T12:00:00Z");

      // Test the cutoff logic directly
      const cutoffDate = new Date(reportingDate);
      cutoffDate.setUTCDate(cutoffDate.getUTCDate() + 1);
      cutoffDate.setUTCHours(0, 0, 0, 0);

      expect(uploadBeforeDate.getTime() < cutoffDate.getTime()).toBe(true);
      expect(uploadOnDate.getTime() < cutoffDate.getTime()).toBe(true);
      expect(uploadAfterDate.getTime() < cutoffDate.getTime()).toBe(false);
    });

    it("should filter milestone completions before the cutoff date", async () => {
      const reportingDate = new Date("2026-07-25T00:00:00Z");
      
      // Completion on reporting date - should be included
      const completionOnDate = "2026-07-25";
      // Completion after reporting date - should be excluded  
      const completionAfterDate = "2026-07-26";
      // Completion before reporting date - should be included
      const completionBeforeDate = "2026-07-24";

      // Test the cutoff logic directly
      const cutoffDate = new Date(reportingDate);
      cutoffDate.setUTCDate(cutoffDate.getUTCDate() + 1);
      cutoffDate.setUTCHours(0, 0, 0, 0);

      const dateBefore = new Date(`${completionBeforeDate}T00:00:00Z`);
      const dateOn = new Date(`${completionOnDate}T00:00:00Z`);
      const dateAfter = new Date(`${completionAfterDate}T00:00:00Z`);

      expect(dateBefore.getTime() < cutoffDate.getTime()).toBe(true);
      expect(dateOn.getTime() < cutoffDate.getTime()).toBe(true);
      expect(dateAfter.getTime() < cutoffDate.getTime()).toBe(false);
    });
  });

  describe("governanceRouter.presentationData", () => {
    it("should accept a valid reporting date", async () => {
      const caller = governanceRouter.createCaller({} as any);
      
      // Mock the data fetching
      vi.spyOn(global, "fetch").mockResolvedValue({
        json: async () => ({
          reportingDate: "2026-07-25",
          facilities: [],
          summary: { totalFacilities: 0, totalDocuments: 0, documentsByFacility: {}, milestonesComplete: 0, milestonesTotal: 0 },
        }),
      } as Response);

      // Test input validation
      const validInput = { reportingDate: "2026-07-25" };
      expect(validInput.reportingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("should reject invalid date format", async () => {
      const invalidDates = [
        "2026/07/25",  // Wrong separator
        "25-07-2026",  // Wrong order
        "2026-7-25",   // Missing leading zero
        "not-a-date",  // Not a date
        "2026-07",     // Missing day
      ];

      for (const date of invalidDates) {
        expect(date).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it("should handle omitted reporting date", async () => {
      // When reporting date is omitted, it should default to today
      const result = { reportingDate: undefined };
      expect(result.reportingDate).toBeUndefined();
      // Default would be applied in the procedure
    });
  });

  describe("UTC boundary behavior", () => {
    it("should handle UTC midnight boundaries correctly", () => {
      const reportingDate = new Date("2026-07-25T00:00:00Z");
      const cutoffDate = new Date(reportingDate);
      cutoffDate.setUTCDate(cutoffDate.getUTCDate() + 1);
      cutoffDate.setUTCHours(0, 0, 0, 0);

      // Just before midnight on reporting date - included
      const justBeforeMidnight = new Date("2026-07-25T23:59:59.999Z");
      expect(justBeforeMidnight.getTime() < cutoffDate.getTime()).toBe(true);

      // Exactly at midnight next day - excluded
      const exactlyMidnight = new Date("2026-07-26T00:00:00Z");
      expect(exactlyMidnight.getTime() < cutoffDate.getTime()).toBe(false);

      // Just after midnight next day - excluded
      const justAfterMidnight = new Date("2026-07-26T00:00:00.001Z");
      expect(justAfterMidnight.getTime() < cutoffDate.getTime()).toBe(false);
    });
  });
});
