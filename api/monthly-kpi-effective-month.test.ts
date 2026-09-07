import { describe, expect, it } from "vitest";
import {
  aggregateMonthlyKpiRecords,
  resolveEffectiveReportingMonth,
  type PersistedMonthlyKpiRecord,
} from "../src/modules/monthly-kpi/kpiAggregation";

/**
 * Monthly KPI Scorecard — effective reporting month.
 *
 * The top KPI cards, the "All Business Units" Summary Matrix row, and the BU
 * summary cards/rows must represent the scorecard at the LATEST SUBMITTED
 * reporting month whenever the user has not explicitly chosen a valid
 * submitted month. This file proves:
 *
 *   January-August = submitted; September-December = Not Submitted
 *
 *   => effective reporting month = August
 *   => PM Compliance / Facility Uptime = August standalone values
 *   => Budget Spend / PM:CM WO / PM:CM Cost / MTTR = Jan-Aug cumulative values
 *   => September-December contribute nothing
 *   => explicit valid selection of March switches the cutoff to March
 *   => year switching resolves within that year only
 */

const base = {
  pm_compliance: null,
  budget_spend: null,
  pm_cm_work_order_ratio: null,
  pm_cm_cost_ratio: null,
  mttr_days: null,
  facility_uptime: null,
};

type MonthInputs = {
  pmDone: number;
  pmTotal: number;
  actualSpend: number;
  budget: number;
  pmWo: number;
  cmWo: number;
  pmCost: number;
  cmCost: number;
  downtime: number;
  repairs: number;
  operating: number;
  facilityDowntime: number;
};

function monthInputs(month: number): MonthInputs {
  return {
    pmDone: 100 - month,
    pmTotal: 100,
    actualSpend: 100 * month + 10,
    budget: 200,
    pmWo: 40 + month,
    cmWo: 20 - (month % 3),
    pmCost: 1000 + 50 * month,
    cmCost: 500 - 10 * month,
    downtime: 60 * month + 5,
    repairs: month + 2,
    operating: 1000,
    facilityDowntime: month,
  };
}

/**
 * Full-year records for one business unit:
 * - months 1..8 are submitted with complete scorecard KPI source inputs;
 * - months 9..12 are "Not Submitted" placeholder rows that carry only a
 *   planned budget (mirroring the trailing rows the consolidated workbook
 *   creates for future months). They must never make the month submitted.
 */
function makeYearRecords(businessUnit: string, submittedThrough = 8): PersistedMonthlyKpiRecord[] {
  const records: PersistedMonthlyKpiRecord[] = [];
  for (let month = 1; month <= 12; month += 1) {
    if (month <= submittedThrough) {
      const v = monthInputs(month);
      records.push({
        ...base,
        business_unit: businessUnit,
        reporting_year: 2026,
        reporting_month: month,
        pm_orders_completed_on_time: v.pmDone,
        total_pm_orders: v.pmTotal,
        actual_spend: v.actualSpend,
        budget: v.budget,
        pm_work_orders: v.pmWo,
        cm_work_orders: v.cmWo,
        pm_cost: v.pmCost,
        cm_cost: v.cmCost,
        mttr_downtime: v.downtime,
        repair_count: v.repairs,
        facility_operating_time: v.operating,
        facility_downtime: v.facilityDowntime,
      });
    } else {
      // Planned-budget-only placeholder row: no valid KPI submission.
      records.push({
        ...base,
        business_unit: businessUnit,
        reporting_year: 2026,
        reporting_month: month,
        budget: 1000 * month,
        source_sheet: "Consolidated",
      });
    }
  }
  return records;
}

function sumField(records: PersistedMonthlyKpiRecord[], field: string) {
  return records.reduce(
    (total, record) => total + (typeof (record as Record<string, unknown>)[field] === "number" ? ((record as Record<string, unknown>)[field] as number) : 0),
    0
  );
}

function submittedRecordsThrough(records: PersistedMonthlyKpiRecord[], throughMonth: number) {
  return records.filter(
    (record) => Number(record.reporting_month) <= throughMonth && typeof record.pm_work_orders === "number"
  );
}

function expectedYtdAt(records: PersistedMonthlyKpiRecord[], throughMonth: number) {
  const period = submittedRecordsThrough(records, throughMonth);
  const pm = sumField(period, "pm_work_orders");
  const cm = sumField(period, "cm_work_orders");
  const pmCost = sumField(period, "pm_cost");
  const cmCost = sumField(period, "cm_cost");
  const downtime = sumField(period, "mttr_downtime");
  const repairs = sumField(period, "repair_count");
  return {
    budgetSpend: (sumField(period, "actual_spend") / sumField(period, "budget")) * 100,
    pmCmWorkOrderRatio: (pm / (pm + cm)) * 100,
    pmCmCostRatio: (pmCost / (pmCost + cmCost)) * 100,
    mttrDays: downtime / repairs,
  };
}

function expectedMonthlyAt(records: PersistedMonthlyKpiRecord[], month: number) {
  const record = records.find((r) => Number(r.reporting_month) === month)!;
  return {
    pmCompliance: (Number(record.pm_orders_completed_on_time) / Number(record.total_pm_orders)) * 100,
    facilityUptime:
      ((Number(record.facility_operating_time) - Number(record.facility_downtime)) /
        Number(record.facility_operating_time)) *
      100,
  };
}

const AMD_EZ = makeYearRecords("AMD-EZ");

describe("resolveEffectiveReportingMonth", () => {
  it("resolves to the latest submitted month when no month is selected", () => {
    // January-August submitted, September-December unsubmitted placeholders.
    expect(resolveEffectiveReportingMonth(AMD_EZ)).toBe(8);
  });

  it("rolls an unsubmitted selected month forward to the latest submitted month", () => {
    expect(resolveEffectiveReportingMonth(AMD_EZ, 9)).toBe(8); // September Not Submitted
    expect(resolveEffectiveReportingMonth(AMD_EZ, 10)).toBe(8);
    expect(resolveEffectiveReportingMonth(AMD_EZ, 12)).toBe(8); // December unsubmitted
    expect(resolveEffectiveReportingMonth(AMD_EZ, 1)).toBe(1); // January is submitted
  });

  it("keeps an explicit valid submitted month selection (e.g. March)", () => {
    expect(resolveEffectiveReportingMonth(AMD_EZ, 3)).toBe(3);
    expect(resolveEffectiveReportingMonth(AMD_EZ, 8)).toBe(8);
  });

  it("scopes the latest submitted month to the provided year's records only", () => {
    const year2025 = makeYearRecords("AMD-EZ", 5).map((record) => ({ ...record, reporting_year: 2025 }));
    // 2025 submitted only through May.
    expect(resolveEffectiveReportingMonth(year2025)).toBe(5);
    expect(resolveEffectiveReportingMonth(year2025, 9)).toBe(5);
    expect(resolveEffectiveReportingMonth(year2025, 3)).toBe(3);
    // A 2026 record list that extends to August must not leak into 2025.
    const mixed = [...AMD_EZ, ...year2025];
    expect(resolveEffectiveReportingMonth(mixed, 9)).toBe(8); // latest over both years is 2026-08
  });

  it("treats a month as submitted when at least one BU carries a valid scorecard KPI submission", () => {
    const leader = makeYearRecords("AMD-EZ", 8);
    const laggard = makeYearRecords("Laguna Water", 5).map((record) => ({ ...record, reporting_year: 2026 }));
    const combined = [...leader, ...laggard];
    expect(resolveEffectiveReportingMonth(combined)).toBe(8);
    // Budget-only placeholder months never count even when a row exists.
    expect(resolveEffectiveReportingMonth(AMD_EZ, 9)).toBe(8);
  });

  it("returns null when no month carries a valid submission", () => {
    const blank = AMD_EZ.filter((record) => typeof record.pm_work_orders !== "number");
    expect(resolveEffectiveReportingMonth(blank)).toBeNull();
    expect(resolveEffectiveReportingMonth(blank, 6)).toBeNull();
  });
});

describe("scorecard aggregates at the effective reporting month", () => {
  it("produces August standalone monthly KPIs and Jan-Aug cumulative YTD KPIs", () => {
    const aggregate = aggregateMonthlyKpiRecords(AMD_EZ, 2026, 8);
    const bu = aggregate.byBusinessUnitMap["AMD-EZ"];
    const ytd = expectedYtdAt(AMD_EZ, 8);
    const monthly = expectedMonthlyAt(AMD_EZ, 8);

    // Monthly KPIs = August standalone only.
    expect(bu.pmCompliance).toBeCloseTo(monthly.pmCompliance, 6);
    expect(bu.facilityUptime).toBeCloseTo(monthly.facilityUptime, 6);
    // Not August's monthly Budget Spend actual (i.e. not (810/200)*100 = 405%).
    expect(bu.budgetSpend).toBeCloseTo(ytd.budgetSpend, 6);
    expect(bu.pmCmWorkOrderRatio).toBeCloseTo(ytd.pmCmWorkOrderRatio, 6);
    expect(bu.pmCmCostRatio).toBeCloseTo(ytd.pmCmCostRatio, 6);
    expect(bu.mttrDays).toBeCloseTo(ytd.mttrDays, 6);
  });

  it("aggregates for a September request are identical to the resolved August cutoff", () => {
    // The front end now resolves the effective month before requesting, and the
    // server endpoint does the same, so a request for an unsubmitted September
    // must aggregate exactly like an August request.
    const viaSeptember = aggregateMonthlyKpiRecords(AMD_EZ, 2026, resolveEffectiveReportingMonth(AMD_EZ, 9)!);
    const viaAugust = aggregateMonthlyKpiRecords(AMD_EZ, 2026, 8);
    const resolved = aggregateMonthlyKpiRecords(AMD_EZ, 2026, resolveEffectiveReportingMonth(AMD_EZ)!);
    ["pmCompliance", "facilityUptime", "budgetSpend", "pmCmWorkOrderRatio", "pmCmCostRatio", "mttrDays"].forEach((key) => {
      expect(viaSeptember.byBusinessUnitMap["AMD-EZ"][key as "pmCompliance"]).toBeCloseTo(
        viaAugust.byBusinessUnitMap["AMD-EZ"][key as "pmCompliance"] as number,
        6
      );
      expect(viaSeptember.byBusinessUnitMap["AMD-EZ"][key as "pmCompliance"]).toBeCloseTo(
        resolved.byBusinessUnitMap["AMD-EZ"][key as "pmCompliance"] as number,
        6
      );
      expect(viaSeptember.portfolioYearAverage[key as "pmCompliance"]).toBeCloseTo(
        viaAugust.portfolioYearAverage[key as "pmCompliance"] as number,
        6
      );
    });
  });

  it("September-December placeholder months contribute nothing to the August-cutoff result", () => {
    const withTrailingPlaceholders = aggregateMonthlyKpiRecords(AMD_EZ, 2026, 8);
    const truncated = AMD_EZ.filter((record) => Number(record.reporting_month) <= 8);
    const withoutTrailingPlaceholders = aggregateMonthlyKpiRecords(truncated, 2026, 8);
    ["pmCompliance", "facilityUptime", "budgetSpend", "pmCmWorkOrderRatio", "pmCmCostRatio", "mttrDays"].forEach((key) => {
      expect(withTrailingPlaceholders.byBusinessUnitMap["AMD-EZ"][key as "pmCompliance"]).toBeCloseTo(
        withoutTrailingPlaceholders.byBusinessUnitMap["AMD-EZ"][key as "pmCompliance"] as number,
        6
      );
    });
  });

  it("explicitly selecting a submitted earlier month (March) changes the cutoff to March", () => {
    const march = aggregateMonthlyKpiRecords(AMD_EZ, 2026, resolveEffectiveReportingMonth(AMD_EZ, 3)!);
    const august = aggregateMonthlyKpiRecords(AMD_EZ, 2026, 8);
    const bu = march.byBusinessUnitMap["AMD-EZ"];
    const ytd = expectedYtdAt(AMD_EZ, 3);
    const monthly = expectedMonthlyAt(AMD_EZ, 3);

    expect(bu.pmCompliance).toBeCloseTo(monthly.pmCompliance, 6);
    expect(bu.facilityUptime).toBeCloseTo(monthly.facilityUptime, 6);
    expect(bu.budgetSpend).toBeCloseTo(ytd.budgetSpend, 6);
    expect(bu.pmCmWorkOrderRatio).toBeCloseTo(ytd.pmCmWorkOrderRatio, 6);
    expect(bu.mttrDays).toBeCloseTo(ytd.mttrDays, 6);
    // March-cutoff values must differ from the August-cutoff ones for the YTD
    // KPIs, proving the cutoff actually changed.
    expect(bu.budgetSpend).not.toBeCloseTo(august.byBusinessUnitMap["AMD-EZ"].budgetSpend as number, 6);
  });

  it("January behaves correctly as both the monthly and the YTD start", () => {
    const january = aggregateMonthlyKpiRecords(AMD_EZ, 2026, 1);
    const bu = january.byBusinessUnitMap["AMD-EZ"];
    const ytd = expectedYtdAt(AMD_EZ, 1);
    const monthly = expectedMonthlyAt(AMD_EZ, 1);
    expect(bu.pmCompliance).toBeCloseTo(monthly.pmCompliance, 6);
    expect(bu.facilityUptime).toBeCloseTo(monthly.facilityUptime, 6);
    expect(bu.budgetSpend).toBeCloseTo(ytd.budgetSpend, 6);
    expect(bu.pmCmWorkOrderRatio).toBeCloseTo(ytd.pmCmWorkOrderRatio, 6);
    expect(bu.pmCmCostRatio).toBeCloseTo(ytd.pmCmCostRatio, 6);
    expect(bu.mttrDays).toBeCloseTo(ytd.mttrDays, 6);
  });

  it("year switching recalculates the latest submitted month within that year only", () => {
    const year2025 = makeYearRecords("AMD-EZ", 5).map((record) => ({ ...record, reporting_year: 2025 }));
    const latest2025 = resolveEffectiveReportingMonth(year2025, 9)!;
    expect(latest2025).toBe(5);
    const aggregate = aggregateMonthlyKpiRecords(year2025, 2025, latest2025);
    const bu = aggregate.byBusinessUnitMap["AMD-EZ"];
    expect(bu.pmCompliance).toBeCloseTo(expectedMonthlyAt(year2025, 5).pmCompliance, 6);
    expect(bu.budgetSpend).toBeCloseTo(expectedYtdAt(year2025, 5).budgetSpend, 6);
  });
});

describe("server-side resolution over the COMPLETE portfolio (BU-scoped client must not matter)", () => {
  // Deterministic multi-BU case from the PR #411 review:
  //   AMD-EZ  submitted January-May only (the BU currently open in the page)
  //   Clark Water submitted January-August
  // The server sees every BU, so the portfolio effective month is August.
  const amdEzThroughMay = makeYearRecords("AMD-EZ", 5);
  const clarkThroughAugust = makeYearRecords("Clark Water", 8);
  const portfolio = [...amdEzThroughMay, ...clarkThroughAugust];

  it("resolves the portfolio latest submitted month (August), never the lagging BU's May", () => {
    // No request month / explicit "latest": portfolio latest = August.
    expect(resolveEffectiveReportingMonth(portfolio)).toBe(8);
    // Explicit September (Not Submitted) -> August, NOT the BU-scoped May.
    expect(resolveEffectiveReportingMonth(portfolio, 9)).toBe(8);
    expect(resolveEffectiveReportingMonth(portfolio, 12)).toBe(8);
    // Explicit May and March are valid submitted months in the full portfolio.
    expect(resolveEffectiveReportingMonth(portfolio, 5)).toBe(5);
    expect(resolveEffectiveReportingMonth(portfolio, 3)).toBe(3);
  });

  it("September-requested aggregates equal the August-cutoff portfolio result", () => {
    const viaRequestedSeptember = aggregateMonthlyKpiRecords(portfolio, 2026, resolveEffectiveReportingMonth(portfolio, 9)!);
    const viaExplicitAugust = aggregateMonthlyKpiRecords(portfolio, 2026, 8);
    const viaDefaultLatest = aggregateMonthlyKpiRecords(portfolio, 2026, resolveEffectiveReportingMonth(portfolio)!);
    ["pmCompliance", "facilityUptime", "budgetSpend", "pmCmWorkOrderRatio", "pmCmCostRatio", "mttrDays"].forEach((key) => {
      const k = key as "pmCompliance";
      expect(viaRequestedSeptember.portfolioYearAverage[k]).toBeCloseTo(viaExplicitAugust.portfolioYearAverage[k] as number, 6);
      expect(viaRequestedSeptember.portfolioYearAverage[k]).toBeCloseTo(viaDefaultLatest.portfolioYearAverage[k] as number, 6);
    });
  });

  it("keeps per-BU semantics at the August cutoff (lagging BU YTD through May, monthly KPIs null in August)", () => {
    const aggregate = aggregateMonthlyKpiRecords(portfolio, 2026, 8);
    const amdEz = aggregate.byBusinessUnitMap["AMD-EZ"];
    // AMD-EZ has no August submission, so its monthly KPIs are null there...
    expect(amdEz.pmCompliance).toBeNull();
    expect(amdEz.facilityUptime).toBeNull();
    // ...while its YTD KPIs still accumulate through its own latest data (May).
    expect(amdEz.budgetSpend).toBeCloseTo(expectedYtdAt(amdEzThroughMay, 5).budgetSpend, 6);
    expect(amdEz.pmCmWorkOrderRatio).toBeCloseTo(expectedYtdAt(amdEzThroughMay, 5).pmCmWorkOrderRatio, 6);
    expect(amdEz.mttrDays).toBeCloseTo(expectedYtdAt(amdEzThroughMay, 5).mttrDays, 6);

    // Clark Water is fully submitted through August: monthly KPIs = August
    // standalone, YTD KPIs = Jan-Aug cumulative.
    const clark = aggregate.byBusinessUnitMap["Clark Water"];
    expect(clark.pmCompliance).toBeCloseTo(expectedMonthlyAt(clarkThroughAugust, 8).pmCompliance, 6);
    expect(clark.facilityUptime).toBeCloseTo(expectedMonthlyAt(clarkThroughAugust, 8).facilityUptime, 6);
    expect(clark.budgetSpend).toBeCloseTo(expectedYtdAt(clarkThroughAugust, 8).budgetSpend, 6);
  });

  it("the portfolio August cutoff is used by the cards/All-BU row, not the lagging BU window", () => {
    const aggregate = aggregateMonthlyKpiRecords(portfolio, 2026, resolveEffectiveReportingMonth(portfolio, 9)!);
    const pya = aggregate.portfolioYearAverage;
    // With AMD-EZ absent in August, the portfolio PM Compliance and Facility
    // Uptime cards are the August values of the BUs that actually submitted
    // (Clark Water) - never the lagging BU's May figure.
    expect(pya.pmCompliance).toBeCloseTo(expectedMonthlyAt(clarkThroughAugust, 8).pmCompliance, 6);
    expect(pya.facilityUptime).toBeCloseTo(expectedMonthlyAt(clarkThroughAugust, 8).facilityUptime, 6);
    // Portfolio Budget Spend card = average of the per-BU YTD percentages at
    // the August cutoff: AMD-EZ accumulates through May only, Clark through
    // August - August never leaks from the lagging BU.
    const amdEzBudget = aggregate.byBusinessUnitMap["AMD-EZ"].budgetSpend as number;
    const clarkBudget = aggregate.byBusinessUnitMap["Clark Water"].budgetSpend as number;
    expect(pya.budgetSpend).toBeCloseTo((amdEzBudget + clarkBudget) / 2, 6);
    expect(amdEzBudget).toBeCloseTo(expectedYtdAt(amdEzThroughMay, 5).budgetSpend, 6);
    expect(clarkBudget).toBeCloseTo(expectedYtdAt(clarkThroughAugust, 8).budgetSpend, 6);
  });
});
