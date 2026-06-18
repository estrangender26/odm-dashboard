import { describe, expect, it } from "vitest";
import {
  buildOdmDashboardScorecard,
  filterDashboardRows,
  monthDateRange,
  type OdmDashboardRow,
} from "./dashboardSummary";

function makeRow(overrides: Partial<OdmDashboardRow> = {}): OdmDashboardRow {
  return {
    SubmissionID: "SUB-1",
    InspectionDate: "2026-06-01",
    Inspector: "Operator A",
    AssetTag: "ASSET-1",
    AssetName: "Influent Pump",
    Plant: "HTT STP",
    EquipmentType: "Pump",
    EquipmentName: "Influent Pump",
    Category: "Mechanical",
    Task: "Inspect equipment condition",
    Capture1Label: "Condition",
    Capture1Response: "OK",
    EscalationTrigger: "None",
    EntryNotes: "Normal",
    Status: "Pass",
    SubmittedAt: "2026-06-01T08:00:00Z",
    Score: 0,
    Findings: "",
    Frequency: "Daily",
    _dbId: 1,
    ...overrides,
  };
}

function dashboardValueRows() {
  return Array.from({ length: 15_932 }, (_, index) => {
    const day = (index % 30) + 1;
    return makeRow({
      SubmissionID: `SUB-${index + 1}`,
      InspectionDate: `2026-06-${String(day).padStart(2, "0")}`,
      Inspector: `Operator ${index % 8}`,
      AssetTag: `ASSET-${index % 109}`,
      Plant: index % 2 === 0 ? "HTT STP" : "Aglipay STP",
      EquipmentType: index % 3 === 0 ? "Pump" : "Motor",
      Category: index % 4 === 0 ? "Mechanical" : "Electrical",
      EscalationTrigger: index < 717 ? "" : "None",
      EntryNotes: index < 749 ? "Seal leak observed" : "Normal",
      Capture1Response: index < 749 ? "Leak" : "OK",
      Findings: index < 749 ? "Leak observed" : "",
    });
  });
}

describe("ODM dashboard summary service", () => {
  it("matches live dashboard KPI definitions for headline values", () => {
    const scorecard = buildOdmDashboardScorecard(dashboardValueRows(), {
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
    });

    expect(scorecard.summary.totalInspections).toBe(15_932);
    expect(scorecard.summary.uniqueAssets).toBe(109);
    expect(scorecard.summary.healthScore.toFixed(1)).toBe("95.3");
    expect(scorecard.summary.dataQualityScore.toFixed(1)).toBe("99.5");
    expect(scorecard.summary.predictiveRisk).toBe("Normal");
    expect(scorecard.summary.negativeFindings).toBe(749);
    expect(scorecard.summary.dataQualityIssueRows).toBe(717);
  });

  it("uses dashboard-equivalent date, plant, equipment, category, and inspector filters", () => {
    const rows = [
      makeRow({
        SubmissionID: "MATCH",
        InspectionDate: "2026-06-15",
        Plant: "HTT STP",
        EquipmentType: "Pump",
        Category: "Mechanical",
        Inspector: "Operator A",
      }),
      makeRow({
        SubmissionID: "WRONG-DATE",
        InspectionDate: "2026-07-01",
        Plant: "HTT STP",
        EquipmentType: "Pump",
        Category: "Mechanical",
        Inspector: "Operator A",
      }),
      makeRow({
        SubmissionID: "WRONG-PLANT",
        InspectionDate: "2026-06-15",
        Plant: "Aglipay STP",
        EquipmentType: "Pump",
        Category: "Mechanical",
        Inspector: "Operator A",
      }),
    ];

    expect(
      filterDashboardRows(rows, {
        dateFrom: "2026-06-01",
        dateTo: "2026-06-30",
        plant: "HTT STP",
        equipmentType: "Pump",
        category: "Mechanical",
        inspector: "Operator A",
      }).map(row => row.SubmissionID)
    ).toEqual(["MATCH"]);
  });

  it("converts reporting year and month to a dashboard date range", () => {
    expect(monthDateRange(2026, 6)).toEqual({
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
    });
  });

  it("exposes dashboard AI insight titles and recommendations from the same filtered rows", () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      makeRow({
        SubmissionID: `NEG-${index + 1}`,
        InspectionDate: `2026-06-${String((index % 6) + 1).padStart(2, "0")}`,
        AssetTag: `PUMP-${index % 3}`,
        EntryNotes: "Critical vibration and leak observed",
        Capture1Response: "Abnormal vibration",
        Findings: "Critical leak",
      })
    );
    const scorecard = buildOdmDashboardScorecard(rows, {
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
    });

    expect(scorecard.insights.map(insight => insight.title)).toContain(
      "Recurring Issues on Same Assets"
    );
    expect(scorecard.insights.map(insight => insight.recommendation).join("\n")).toContain(
      "Schedule dedicated maintenance review"
    );
  });
});
