import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALL_FACILITIES_LABEL,
  buildOdmSummaryUrl,
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

function summaryPayload(overrides: Record<string, unknown> = {}) {
  return {
    rows: [
      {
        SubmissionID: "SUB-1",
        InspectionDate: "2026-06-05",
        Plant: "HTT STP",
        Inspector: "Operator A",
        AssetTag: "P-100",
        AssetName: "Influent Pump",
        EquipmentType: "Pump",
        EquipmentName: "Influent Pump",
        Category: "Mechanical",
        Task: "Inspect pump",
        Capture1Label: "Condition",
        Capture1Response: "OK",
        EscalationTrigger: "None",
        EntryNotes: "",
        Status: "Pass",
        SubmittedAt: "2026-06-05T08:00:00Z",
        Score: 0,
        Findings: "",
        Frequency: "Daily",
      },
    ],
    summary: {
      totalInspections: 1,
      uniqueAssets: 1,
      healthScore: 100,
      dataQualityScore: 100,
      predictiveRisk: "Normal",
      negativeFindings: 0,
      notesCount: 0,
      dataQualityIssueRows: 0,
      insightCount: 0,
      alertCount: 0,
      alertLabel: "0 insights",
    },
    insights: [],
    facilityBreakdown: [],
    findingThemes: [],
    trend: [],
    notes: [],
    filters: {},
    options: {
      years: [2026, 2025],
      months: [12, 6, 5],
      facilities: ["Aglipay STP", "HTT STP"],
      equipmentTypes: ["Motor", "Pump"],
      categories: ["Electrical", "Mechanical"],
      inspectors: ["Operator A", "Operator B"],
    },
    ...overrides,
  };
}

describe("Operator-Driven Maintenance scorecard data", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds dashboard summary queries only from explicit dashboard filters", () => {
    expect(
      buildOdmSummaryUrl({
        dateFrom: "2026-06-01",
        dateTo: "2026-06-30",
        facility: "HTT STP",
        equipmentType: "Pump",
        category: "Mechanical",
        inspector: "Operator A",
      })
    ).toBe(
      "/api/operator-driven-maintenance/summary?date_from=2026-06-01&date_to=2026-06-30&facility_id=HTT+STP&equipment_type=Pump&category=Mechanical&inspector=Operator+A"
    );
    expect(
      buildOdmSummaryUrl({
        reportingYear: 2026,
        reportingMonth: 6,
        facility: "HTT STP",
        equipmentType: "Pump",
      })
    ).toBe("/api/operator-driven-maintenance/summary?facility_id=HTT+STP&equipment_type=Pump");
    expect(
      buildOdmSummaryUrl({
        reportingYear: 2026,
        reportingMonth: 6,
        facility: ALL_FACILITIES_LABEL,
      })
    ).toBe("/api/operator-driven-maintenance/summary");
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

  it("loads available years, months, facilities, and dashboard filters from summary options", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(summaryPayload()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAvailableOdmScorecardOptions()).resolves.toEqual({
      years: [2026, 2025],
      months: [12, 6, 5],
      facilities: ["Aglipay STP", "HTT STP"],
      equipmentTypes: ["Motor", "Pump"],
      categories: ["Electrical", "Mechanical"],
      inspectors: ["Operator A", "Operator B"],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/operator-driven-maintenance/summary",
      { headers: { Accept: "application/json" } }
    );
  });

  it("rejects generation data when the selected dashboard scope has no rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(summaryPayload({ rows: [] })))
    );

    await expect(
      getPersistedOdmScorecard({
        reportingYear: 2026,
        reportingMonth: 6,
        facility: ALL_FACILITIES_LABEL,
      })
    ).rejects.toThrow(
      "No database records exist for the selected Operator-Driven Maintenance dashboard scope."
    );
  });

  it("returns selected ODM scorecard data with dashboard summary values", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          summaryPayload({
            summary: {
              totalInspections: 15_932,
              uniqueAssets: 109,
              healthScore: 95.3,
              dataQualityScore: 99.5,
              predictiveRisk: "Normal",
              negativeFindings: 749,
              notesCount: 1,
              dataQualityIssueRows: 717,
              insightCount: 2,
              alertCount: 2,
              alertLabel: "2 alerts",
            },
          })
        )
      )
    );

    await expect(
      getPersistedOdmScorecard({
        reportingYear: 2026,
        reportingMonth: 6,
        dateFrom: "2026-06-01",
        dateTo: "2026-06-30",
        facility: "HTT STP",
        equipmentType: "Pump",
        category: "Mechanical",
        inspector: "Operator A",
      })
    ).resolves.toMatchObject({
      reportingYear: 2026,
      reportingMonth: 6,
      reportingMonthLabel: "June 2026",
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
      facility: "HTT STP",
      equipmentType: "Pump",
      category: "Mechanical",
      inspector: "Operator A",
      template: ODM_EXECUTIVE_SUMMARY_TEMPLATE,
      scorecard: {
        summary: {
          totalInspections: 15_932,
          uniqueAssets: 109,
          healthScore: 95.3,
          dataQualityScore: 99.5,
          predictiveRisk: "Normal",
        },
      },
    });
  });

  it("keeps the dashboard all-date scope when no explicit dates are selected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(summaryPayload())));

    await expect(
      getPersistedOdmScorecard({
        reportingYear: 2026,
        reportingMonth: 6,
        facility: ALL_FACILITIES_LABEL,
      })
    ).resolves.toMatchObject({
      reportingMonthLabel: "All Dates",
      dateFrom: "",
      dateTo: "",
      facility: ALL_FACILITIES_LABEL,
    });
  });
});
