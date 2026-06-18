import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALL_FACILITIES_LABEL,
  buildOdmInspectionsUrl,
  getAvailableOdmScorecardOptions,
  getPersistedOdmScorecard,
  mapPersistedOdmInspectionRecord,
  ODM_EXECUTIVE_SUMMARY_TEMPLATE,
} from "./odmScorecardData";

function jsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    json: async () => payload,
  } as unknown as Response;
}

describe("Operator-Driven Maintenance scorecard data", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds inspection queries from selected period and facility", () => {
    expect(
      buildOdmInspectionsUrl({
        reportingYear: 2026,
        reportingMonth: 6,
        facility: "HTT STP",
      })
    ).toBe(
      "/api/operator-driven-maintenance/inspections?reporting_year=2026&reporting_month=6&facility_id=HTT+STP"
    );
    expect(
      buildOdmInspectionsUrl({
        reportingYear: 2026,
        reportingMonth: 6,
        facility: ALL_FACILITIES_LABEL,
      })
    ).toBe(
      "/api/operator-driven-maintenance/inspections?reporting_year=2026&reporting_month=6"
    );
  });

  it("maps persisted inspection records while preserving zero scores and null text safely", () => {
    const record = mapPersistedOdmInspectionRecord({
      id: 7,
      facility_id: "HTT STP",
      status: null,
      score: 0,
      findings: "",
      entry_notes: null,
      date: "2026-06-05",
    });

    expect(record).toMatchObject({
      id: 7,
      facilityId: "HTT STP",
      status: null,
      score: 0,
      findings: null,
      entryNotes: null,
      date: "2026-06-05",
    });
  });

  it("loads available years, months, and facilities from persisted inspection rows", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        records: [
          { facility_id: "HTT STP", date: "2026-06-05" },
          { facility_id: "Aglipay STP", inspection_date: "2026-05-15" },
          { facility_id: "HTT STP", submitted_at: "2025-12-01T08:00:00Z" },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAvailableOdmScorecardOptions()).resolves.toEqual({
      years: [2026, 2025],
      months: [12, 6, 5],
      facilities: ["Aglipay STP", "HTT STP"],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/operator-driven-maintenance/inspections",
      { headers: { Accept: "application/json" } }
    );
  });

  it("rejects generation data when the selected scope has no rows", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ records: [] })));

    await expect(
      getPersistedOdmScorecard({
        reportingYear: 2026,
        reportingMonth: 6,
        facility: ALL_FACILITIES_LABEL,
      })
    ).rejects.toThrow(
      "No database records exist for the selected Operator-Driven Maintenance reporting period and facility."
    );
  });

  it("returns selected ODM records with the Executive Summary template", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          records: [
            {
              facility_id: "HTT STP",
              date: "2026-06-05",
              status: "Pass",
              score: 0,
            },
          ],
        })
      )
    );

    await expect(
      getPersistedOdmScorecard({
        reportingYear: 2026,
        reportingMonth: 6,
        facility: "HTT STP",
      })
    ).resolves.toMatchObject({
      reportingYear: 2026,
      reportingMonth: 6,
      reportingMonthLabel: "June 2026",
      facility: "HTT STP",
      template: ODM_EXECUTIVE_SUMMARY_TEMPLATE,
      records: [{ facilityId: "HTT STP", score: 0 }],
    });
  });
});
