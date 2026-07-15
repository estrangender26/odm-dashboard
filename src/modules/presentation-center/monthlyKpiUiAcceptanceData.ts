import type { PersistedMonthlyKpiRecord } from "../monthly-kpi/kpiAggregation";

const ACCEPTANCE_BUSINESS_UNITS = [
  "AMD-EZ",
  "Laguna Water",
  "Clark Water",
  "Tagum Water",
  "Estate Water",
  "LARC",
] as const;

export const monthlyKpiUiAcceptanceRecords: PersistedMonthlyKpiRecord[] =
  ACCEPTANCE_BUSINESS_UNITS.flatMap((businessUnit, businessUnitIndex) =>
    Array.from({ length: 5 }, (_, monthIndex) => {
      const reportingMonth = monthIndex + 1;
      const offset = businessUnitIndex + reportingMonth;
      return {
        id: `ui-acceptance-${businessUnitIndex + 1}-${reportingMonth}`,
        business_unit: businessUnit,
        reporting_month: reportingMonth,
        reporting_year: 2026,
        pm_compliance: 91 + (offset % 9),
        budget_spend: 94 + (offset % 13),
        pm_cm_work_order_ratio: 80 + (offset % 17),
        pm_cm_cost_ratio: 55 + (offset % 16),
        mttr_days: Number((1.5 + offset / 3).toFixed(1)),
        facility_uptime: offset % 4 === 0 ? 100 : 99.9 + (offset % 3) * 0.03,
        notes:
          reportingMonth === 5
            ? `${businessUnit} May 2026 UI acceptance commentary.`
            : null,
        source_file_name: "monthly-kpi-ui-acceptance-mode",
      };
    })
  );

export function getMonthlyKpiUiAcceptanceRecords(url: string) {
  const parsed = new URL(url, "http://localhost");
  const reportingYearValue = parsed.searchParams.get("reporting_year");
  const reportingMonthValue = parsed.searchParams.get("reporting_month");
  const reportingYear = reportingYearValue ? Number(reportingYearValue) : null;
  const reportingMonth = reportingMonthValue
    ? Number(reportingMonthValue)
    : null;
  const businessUnit = parsed.searchParams.get("business_unit");

  return monthlyKpiUiAcceptanceRecords.filter(record => {
    if (
      Number.isInteger(reportingYear) &&
      record.reporting_year !== reportingYear
    ) {
      return false;
    }
    if (
      Number.isInteger(reportingMonth) &&
      record.reporting_month !== reportingMonth
    ) {
      return false;
    }
    return !businessUnit || record.business_unit === businessUnit;
  });
}
