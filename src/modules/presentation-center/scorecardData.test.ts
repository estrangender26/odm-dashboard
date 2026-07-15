import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALL_BUSINESS_UNITS_LABEL,
  buildMonthlyKpiRecordsUrl,
  EXECUTIVE_SCORECARD_TEMPLATE,
  getAvailableMonthlyKpiOptions,
  getPersistedMonthlyKpiScorecard,
  isMonthlyKpiUiAcceptanceMode,
  MONTHLY_KPI_TEMPLATE_OPTIONS,
  scorecardBenchmarks,
} from "./scorecardData";

function jsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    json: async () => payload,
  } as Response;
}

describe("Monthly KPI presentation scorecard data", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("builds records endpoint queries with reporting period filters", () => {
    expect(
      buildMonthlyKpiRecordsUrl({
        reportingYear: 2026,
        reportingMonth: 5,
        businessUnit: ALL_BUSINESS_UNITS_LABEL,
      })
    ).toBe("/api/monthly-kpi/records?reporting_year=2026&reporting_month=5");
  });

  it("includes selected business unit when not using All Business Units", () => {
    expect(
      buildMonthlyKpiRecordsUrl({
        reportingYear: 2026,
        reportingMonth: 5,
        businessUnit: "ez",
      })
    ).toBe(
      "/api/monthly-kpi/records?reporting_year=2026&reporting_month=5&business_unit=AMD-EZ"
    );
  });

  it("loads available years, months, and business units from persisted records", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        records: [
          { business_unit: "ez", reporting_year: 2026, reporting_month: 5 },
          {
            business_unit: "Laguna Water",
            reporting_year: 2025,
            reporting_month: 12,
          },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAvailableMonthlyKpiOptions()).resolves.toEqual({
      years: [2026, 2025],
      months: [12, 5],
      businessUnits: ["AMD-EZ", "Laguna Water"],
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/monthly-kpi/records", {
      headers: { Accept: "application/json" },
    });
  });

  it("maps persisted records while preserving notes, nulls, and explicit zeros", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          records: [
            {
              business_unit: "ez",
              reporting_year: 2026,
              reporting_month: 5,
              pm_compliance: 0,
              budget_spend: null,
              pm_cm_work_order_ratio: "86.5",
              pm_cm_cost_ratio: null,
              mttr_days: "",
              facility_uptime: "99.97",
              notes: "Pump station breaker replacement completed.",
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          records: [
            {
              business_unit: "ez",
              reporting_year: 2026,
              reporting_month: 1,
              pm_compliance: 95,
              budget_spend: 100,
              pm_cm_work_order_ratio: 86,
              pm_cm_cost_ratio: 60,
              mttr_days: 3,
              facility_uptime: 99.97,
              notes: null,
            },
          ],
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const dataset = await getPersistedMonthlyKpiScorecard(
      {
        reportingYear: 2026,
        reportingMonth: 5,
        businessUnit: "AMD-EZ",
      },
      EXECUTIVE_SCORECARD_TEMPLATE
    );

    expect(dataset).toMatchObject({
      reportingYear: 2026,
      reportingMonth: 5,
      reportingMonthLabel: "May 2026",
      businessUnit: "AMD-EZ",
      template: EXECUTIVE_SCORECARD_TEMPLATE,
    });
    expect(dataset.records[0]).toMatchObject({
      businessUnit: "AMD-EZ",
      pmCompliance: 0,
      budgetSpend: null,
      pmCmWorkOrderRatio: 86.5,
      pmCmCostRatio: null,
      mttrDays: null,
      facilityUptime: 99.97,
      notes: "Pump station breaker replacement completed.",
    });
    expect(dataset.ytdRecords).toHaveLength(1);
    expect(dataset.ytdRecords[0]).toMatchObject({
      reportingMonth: 1,
      pmCompliance: 95,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/monthly-kpi/records?reporting_year=2026&reporting_month=5&business_unit=AMD-EZ",
      { headers: { Accept: "application/json" } }
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/monthly-kpi/records?reporting_year=2026&business_unit=AMD-EZ",
      { headers: { Accept: "application/json" } }
    );
  });

  it("rejects no-data responses instead of falling back to bundled sample data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ records: [] }))
    );

    await expect(
      getPersistedMonthlyKpiScorecard({
        reportingYear: 2026,
        reportingMonth: 6,
        businessUnit: ALL_BUSINESS_UNITS_LABEL,
      })
    ).rejects.toThrow(
      "No database records exist for the selected Monthly KPI reporting period and business unit."
    );
  });

  it("keeps Executive Scorecard as the only available template", () => {
    expect(MONTHLY_KPI_TEMPLATE_OPTIONS).toEqual(["Executive Scorecard"]);
  });

  it("uses the exact Facility Uptime benchmark label in presentation data", () => {
    expect(scorecardBenchmarks.find((item) => item.key === "facilityUptime")?.benchmark).toBe("=100%");
  });

  it("only enables the Monthly KPI UI acceptance adapter in explicit development mode", () => {
    expect(
      isMonthlyKpiUiAcceptanceMode({
        DEV: true,
        PROD: false,
        VITE_MONTHLY_KPI_UI_ACCEPTANCE_MODE: "true",
      })
    ).toBe(true);
    expect(
      isMonthlyKpiUiAcceptanceMode({
        DEV: false,
        PROD: true,
        VITE_MONTHLY_KPI_UI_ACCEPTANCE_MODE: "true",
      })
    ).toBe(false);
    expect(
      isMonthlyKpiUiAcceptanceMode({
        DEV: true,
        PROD: false,
        VITE_MONTHLY_KPI_UI_ACCEPTANCE_MODE: "false",
      })
    ).toBe(false);
  });

  it("uses representative acceptance records without calling the API when explicitly enabled", async () => {
    vi.stubEnv("VITE_MONTHLY_KPI_UI_ACCEPTANCE_MODE", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAvailableMonthlyKpiOptions()).resolves.toEqual({
      years: [2026],
      months: [5, 4, 3, 2, 1],
      businessUnits: [
        "AMD-EZ",
        "Laguna Water",
        "Clark Water",
        "Tagum Water",
        "Estate Water",
        "LARC",
      ],
    });
    const dataset = await getPersistedMonthlyKpiScorecard({
      reportingYear: 2026,
      reportingMonth: 5,
      businessUnit: "Clark Water",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(dataset.records).toHaveLength(1);
    expect(dataset.ytdRecords).toHaveLength(5);
    expect(dataset.records[0]).toMatchObject({
      businessUnit: "Clark Water",
      reportingMonth: 5,
      reportingYear: 2026,
      notes: "Clark Water May 2026 UI acceptance commentary.",
    });
  });
});
