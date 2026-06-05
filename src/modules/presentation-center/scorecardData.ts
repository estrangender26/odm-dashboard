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
  "amd-ez": "AMD-EZ",
  ez: "AMD-EZ",
  "laguna water": "Laguna Water",
  laguna: "Laguna Water",
  "clark water": "Clark Water",
  clark: "Clark Water",
  "tagum water": "Tagum Water",
  tagum: "Tagum Water",
  "estate water": "Estate Water",
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

function businessUnitLabel(value: string) {
  const normalized = value.toLowerCase().trim();
  return businessUnitLabels[normalized] || value;
}

function averageKpiValues(values: Array<number | null | undefined>) {
  const valid = values.filter(isPresentNumber);
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function aggregatePersistedMonthlyKpiRecords(records: PersistedMonthlyKpiRecord[]) {
  const byBusinessUnit = new Map<string, PersistedMonthlyKpiRecord[]>();
  records.forEach((record) => {
    const label = businessUnitLabel(record.business_unit);
    byBusinessUnit.set(label, [...(byBusinessUnit.get(label) || []), record]);
  });

  return Array.from(byBusinessUnit.entries()).map(([businessUnit, unitRecords]) =>
    evaluateAggregatedRecord({
      businessUnit,
      reportingYear: unitRecords[0]?.reporting_year,
      pmCompliance: averageKpiValues(unitRecords.map((record) => record.pm_compliance)),
      pmCmWorkOrderRatio: averageKpiValues(unitRecords.map((record) => record.pm_cm_work_order_ratio)),
      budgetSpend: averageKpiValues(unitRecords.map((record) => record.budget_spend)),
      pmCmCostRatio: averageKpiValues(unitRecords.map((record) => record.pm_cm_cost_ratio)),
      facilityUptime: averageKpiValues(unitRecords.map((record) => record.facility_uptime)),
      majorWins: [],
      majorRisks: [],
      actionItems: [],
    })
  );
}

function evaluateAggregatedRecord(record: KpiRecord): KpiRecord {
  const wins: string[] = [];
  const risks: string[] = [];
  const actions: string[] = [];

  if (isPresentNumber(record.pmCompliance) && record.pmCompliance >= 95) {
    wins.push("PM compliance met or exceeded the 95% benchmark.");
  } else if (isPresentNumber(record.pmCompliance)) {
    risks.push("PM compliance is below the 95% benchmark.");
    actions.push("Review overdue PM backlog and closure constraints.");
  }

  if (isPresentNumber(record.facilityUptime) && record.facilityUptime >= 99.97) {
    wins.push("Facility uptime met or exceeded the 99.97% benchmark.");
  } else if (isPresentNumber(record.facilityUptime)) {
    risks.push("Facility uptime is below the 99.97% benchmark.");
    actions.push("Confirm uptime recovery actions for critical equipment.");
  }

  if (isPresentNumber(record.budgetSpend) && (record.budgetSpend < 95 || record.budgetSpend > 105)) {
    risks.push("Budget spend is outside the 95% to 105% control band.");
    actions.push("Validate planned-versus-actual cost drivers.");
  } else if (isPresentNumber(record.budgetSpend)) {
    wins.push("Budget spend stayed within the scorecard control band.");
  }

  return {
    ...record,
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

function getSelectedMonthlyKpiContext() {
  const now = new Date();
  const reportingYear = Number(window.localStorage.getItem("monthlyKpiSelectedYear")) || now.getFullYear();
  return { reportingYear };
}

export async function getPersistedMonthlyKpiScorecard() {
  const context = getSelectedMonthlyKpiContext();
  const params = new URLSearchParams({
    reporting_year: String(context.reportingYear),
  });
  const response = await fetch(`/api/monthly-kpi/records?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Unable to load persisted Monthly KPI records.");
  const payload = (await response.json()) as { records?: PersistedMonthlyKpiRecord[] };
  const records = payload.records || [];
  if (records.length === 0) {
    throw new Error("No KPI data available for selected year.");
  }

  return {
    records: aggregatePersistedMonthlyKpiRecords(records),
    reportingMonthLabel: String(context.reportingYear),
    businessUnit: "All Business Units",
  };
}
