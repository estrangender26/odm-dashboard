export type KpiRecord = {
  businessUnit: string;
  reportingMonth?: number;
  reportingYear?: number;
  pmCompliance: number | null;
  pmCmWorkOrderRatio: number | null;
  budgetSpend: number | null;
  pmCmCostRatio: number | null;
  facilityUptime: number | null;
  majorWins: string[];
  majorRisks: string[];
  actionItems: string[];
};

type PersistedMonthlyKpiRecord = {
  business_unit: string;
  reporting_month: number;
  reporting_year: number;
  pm_compliance: number | null;
  budget_spend: number | null;
  pm_cm_work_order_ratio: number | null;
  pm_cm_cost_ratio: number | null;
  facility_uptime: number | null;
};

const businessUnitLabels: Record<string, string> = {
  ez: "Manila Water / EZ",
  laguna: "Laguna Water",
  clark: "Clark Water",
  tagum: "Tagum Water",
  estate: "Estate Water",
};

export const scorecardBenchmarks = [
  { key: "pmCompliance", label: "PM Compliance", benchmark: "95%" },
  { key: "pmCmWorkOrderRatio", label: "PM:CM Ratio (WO)", benchmark: "≥86%" },
  { key: "budgetSpend", label: "Budget Spend", benchmark: "95% - 105%" },
  { key: "pmCmCostRatio", label: "PM:CM Ratio (Cost)", benchmark: "≥60%" },
  { key: "facilityUptime", label: "Facility Uptime", benchmark: "99.97%" },
] as const;

export const currentMonthlyKpiScorecard: KpiRecord[] = [
  {
    businessUnit: "Manila Water / EZ",
    pmCompliance: 96.4,
    pmCmWorkOrderRatio: 88.2,
    budgetSpend: 101.3,
    pmCmCostRatio: 63.8,
    facilityUptime: 99.98,
    majorWins: ["PM compliance exceeded the 95% benchmark.", "Facility uptime remained above target."],
    majorRisks: ["Budget spend is trending near the upper control band."],
    actionItems: ["Review cost drivers for high-spend work orders.", "Keep weekly follow-up on PM closure quality."],
  },
  {
    businessUnit: "Laguna Water",
    pmCompliance: 93.1,
    pmCmWorkOrderRatio: 84.5,
    budgetSpend: 97.6,
    pmCmCostRatio: 58.9,
    facilityUptime: 99.95,
    majorWins: ["Budget spend remained inside the acceptable range."],
    majorRisks: ["PM compliance and PM:CM cost ratio are below benchmark."],
    actionItems: ["Prioritize overdue PM backlog.", "Rebalance corrective maintenance spending."],
  },
  {
    businessUnit: "Clark Water",
    pmCompliance: 97.2,
    pmCmWorkOrderRatio: 90.4,
    budgetSpend: 103.8,
    pmCmCostRatio: 65.1,
    facilityUptime: 99.99,
    majorWins: ["All core reliability KPIs are meeting benchmark."],
    majorRisks: ["Budget spend requires monitoring for scope creep."],
    actionItems: ["Validate planned-vs-actual variance assumptions."],
  },
  {
    businessUnit: "Tagum Water",
    pmCompliance: 91.8,
    pmCmWorkOrderRatio: 79.6,
    budgetSpend: 94.2,
    pmCmCostRatio: 55.4,
    facilityUptime: 99.93,
    majorWins: ["Preventive maintenance plan is visible and measurable."],
    majorRisks: ["Multiple maintenance mix KPIs are under target."],
    actionItems: ["Escalate critical asset PM recovery plan.", "Schedule reliability review with site leads."],
  },
  {
    businessUnit: "Estate Water",
    pmCompliance: 95.6,
    pmCmWorkOrderRatio: 87.3,
    budgetSpend: 99.4,
    pmCmCostRatio: 61.2,
    facilityUptime: 99.97,
    majorWins: ["Balanced spend and maintenance mix against benchmark."],
    majorRisks: ["Uptime is at threshold and should be watched."],
    actionItems: ["Confirm uptime protection actions for critical equipment."],
  },
];

function isPresentNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function monthName(month: number) {
  return new Intl.DateTimeFormat("en", { month: "long" }).format(new Date(2026, month - 1, 1));
}

function businessUnitLabel(value: string) {
  const normalized = value.toLowerCase().trim();
  return businessUnitLabels[normalized] || value;
}

function evaluatePersistedRecord(record: PersistedMonthlyKpiRecord): KpiRecord {
  const wins: string[] = [];
  const risks: string[] = [];
  const actions: string[] = [];

  if (isPresentNumber(record.pm_compliance) && record.pm_compliance >= 95) {
    wins.push("PM compliance met or exceeded the 95% benchmark.");
  } else if (isPresentNumber(record.pm_compliance)) {
    risks.push("PM compliance is below the 95% benchmark.");
    actions.push("Review overdue PM backlog and closure constraints.");
  }

  if (isPresentNumber(record.facility_uptime) && record.facility_uptime >= 99.97) {
    wins.push("Facility uptime met or exceeded the 99.97% benchmark.");
  } else if (isPresentNumber(record.facility_uptime)) {
    risks.push("Facility uptime is below the 99.97% benchmark.");
    actions.push("Confirm uptime recovery actions for critical equipment.");
  }

  if (isPresentNumber(record.budget_spend) && (record.budget_spend < 95 || record.budget_spend > 105)) {
    risks.push("Budget spend is outside the 95% to 105% control band.");
    actions.push("Validate planned-versus-actual cost drivers.");
  } else if (isPresentNumber(record.budget_spend)) {
    wins.push("Budget spend stayed within the scorecard control band.");
  }

  return {
    businessUnit: businessUnitLabel(record.business_unit),
    reportingMonth: record.reporting_month,
    reportingYear: record.reporting_year,
    pmCompliance: record.pm_compliance,
    pmCmWorkOrderRatio: record.pm_cm_work_order_ratio,
    budgetSpend: record.budget_spend,
    pmCmCostRatio: record.pm_cm_cost_ratio,
    facilityUptime: record.facility_uptime,
    majorWins: wins.length ? wins : ["Imported KPI data is available for review."],
    majorRisks: risks.length ? risks : ["No critical KPI risks identified from imported values."],
    actionItems: actions.length ? actions : ["Continue monthly KPI monitoring and validation."],
  };
}

export function getReportingMonthLabel(date = new Date()) {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(date);
}

export function getScorecardSummary(records = currentMonthlyKpiScorecard) {
  const total = records.length;
  const pmPassed = records.filter((record) => isPresentNumber(record.pmCompliance) && record.pmCompliance >= 95).length;
  const uptimePassed = records.filter((record) => isPresentNumber(record.facilityUptime) && record.facilityUptime >= 99.97).length;
  const risks = records.flatMap((record) => record.majorRisks);
  const wins = records.flatMap((record) => record.majorWins);
  return {
    highlights: [
      `${pmPassed} of ${total} business units are meeting PM compliance target.`,
      `${uptimePassed} of ${total} business units are meeting facility uptime target.`,
      "Budget spend remains inside or near governance thresholds for most business units.",
    ],
    wins: wins.slice(0, 5),
    risks: risks.slice(0, 5),
    concerns: risks.slice(0, 4),
    actions: records.flatMap((record) => record.actionItems).slice(0, 6),
  };
}

export async function getPersistedMonthlyKpiScorecard() {
  const response = await fetch("/api/monthly-kpi/records", {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Unable to load persisted Monthly KPI records.");
  const payload = (await response.json()) as { records?: PersistedMonthlyKpiRecord[] };
  const records = payload.records || [];
  if (records.length === 0) return {
    records: currentMonthlyKpiScorecard,
    reportingMonthLabel: getReportingMonthLabel(),
  };

  const latest = records.reduce((best, record) => {
    if (!best) return record;
    if (record.reporting_year !== best.reporting_year) return record.reporting_year > best.reporting_year ? record : best;
    return record.reporting_month > best.reporting_month ? record : best;
  });
  const latestPeriodRecords = records.filter(
    record => record.reporting_year === latest.reporting_year && record.reporting_month === latest.reporting_month
  );

  return {
    records: latestPeriodRecords.map(evaluatePersistedRecord),
    reportingMonthLabel: `${monthName(latest.reporting_month)} ${latest.reporting_year}`,
  };
}
