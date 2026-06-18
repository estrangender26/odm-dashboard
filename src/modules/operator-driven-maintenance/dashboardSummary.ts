export type OdmDashboardFilters = {
  dateFrom?: string | null;
  dateTo?: string | null;
  plant?: string | null;
  equipmentType?: string | null;
  category?: string | null;
  inspector?: string | null;
};

export type OdmDashboardRow = {
  SubmissionID: string;
  InspectionDate: Date | string | null;
  Inspector: string;
  AssetTag: string;
  AssetName: string;
  Plant: string;
  EquipmentType: string;
  EquipmentName: string;
  Category: string;
  Task: string;
  Capture1Label: string;
  Capture1Response: string;
  EscalationTrigger: string;
  EntryNotes: string;
  Status: string;
  SubmittedAt: string;
  Score: number;
  Findings: string;
  Frequency: string;
  _dbId?: number | string | null;
};

export type OdmDashboardInsight = {
  type: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  metric: string;
  recommendation: string;
  drilldown?: Record<string, unknown>;
};

export type OdmDashboardSummary = {
  totalInspections: number;
  uniqueAssets: number;
  healthScore: number;
  dataQualityScore: number;
  predictiveRisk: "Normal" | "Elevated" | "High";
  negativeFindings: number;
  notesCount: number;
  dataQualityIssueRows: number;
  insightCount: number;
  alertCount: number;
  alertLabel: string;
};

export type OdmFacilitySummary = {
  plant: string;
  totalInspections: number;
  uniqueAssets: number;
  healthScore: number;
  dataQualityScore: number;
  negativeFindings: number;
};

export type OdmFindingTheme = {
  category: string;
  distinctAssets: number;
  totalInspections: number;
  cumulativePercent: number;
};

export type OdmTrendPoint = {
  date: string;
  distinctAffectedAssets: number;
  totalNegativeInspections: number;
};

export type OdmDashboardOptions = {
  years: number[];
  months: number[];
  facilities: string[];
  equipmentTypes: string[];
  categories: string[];
  inspectors: string[];
};

export type OdmDashboardScorecard = {
  rows: OdmDashboardRow[];
  filters: OdmDashboardFilters;
  summary: OdmDashboardSummary;
  insights: OdmDashboardInsight[];
  facilityBreakdown: OdmFacilitySummary[];
  findingThemes: OdmFindingTheme[];
  trend: OdmTrendPoint[];
  notes: OdmDashboardRow[];
  options: OdmDashboardOptions;
};

const ABNORMAL_KEYWORDS = [
  "leak",
  "loose",
  "vibration",
  "vibrating",
  "noisy",
  "noise",
  "abnormal",
  "hot",
  "overheat",
  "overheating",
  "smoke",
  "blocked",
  "jammed",
  "misaligned",
  "worn",
  "crack",
  "damage",
  "fail",
  "alarm",
  "not ok",
  "not_ok",
  "ng",
  "no good",
  "defect",
  "fault",
  "error",
  "critical",
  "urgent",
  "repair",
  "replace",
  "broken",
];

const DQ_FIELDS = [
  "AssetTag",
  "AssetName",
  "Plant",
  "EquipmentType",
  "Category",
  "Task",
  "Capture1Label",
  "Capture1Response",
  "EscalationTrigger",
] as const;

const DEFAULT_INSIGHT_CONFIG = {
  spikeThresholdPct: 50,
  declineThresholdPct: -30,
  inspectorMinInspections: 5,
  dataQualityThreshold: 95,
  paretoThreshold: 80,
  inactivityDays: 7,
  coverageGapDays: 14,
  topNAssets: 5,
  rollingWindow: 3,
  minNegFindingsForRisk: 10,
  minDistinctAssetsForRisk: 5,
};

function asText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function asNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDateObject(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateKey(value: Date | string | null | undefined) {
  const date = toDateObject(value);
  return date ? date.toISOString().slice(0, 10) : "";
}

function pctChange(current: number, previous: number) {
  if (!previous) return 0;
  return Math.round(((current - previous) / previous) * 100);
}

function avg(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rollingAvg(values: number[], windowSize: number) {
  if (values.length < windowSize) return avg(values);
  return avg(values.slice(-windowSize));
}

function daysBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function formatInsightDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function mapInspectionToDashboardRow(input: Record<string, unknown>): OdmDashboardRow {
  const inspectionDate =
    toDateObject(input.inspectionDate ?? input.inspection_date) ??
    toDateObject(input.date);
  return {
    SubmissionID: asText(input.submissionId ?? input.submission_id),
    Plant: asText(input.facilityId ?? input.facility_id),
    Inspector: asText(input.inspector),
    InspectionDate: inspectionDate,
    AssetTag: asText(input.assetTag ?? input.asset_tag),
    AssetName: asText(input.assetName ?? input.asset_name),
    EquipmentType: asText(input.equipmentType ?? input.equipment_type),
    EquipmentName: asText(input.assetName ?? input.asset_name),
    Category: asText(input.category),
    Task: asText(input.task),
    Capture1Label: asText(input.capture1Label ?? input.capture1_label),
    Capture1Response: asText(input.capture1Response ?? input.capture1_response),
    EscalationTrigger: asText(input.escalationTrigger ?? input.escalation_trigger),
    EntryNotes: asText(input.entryNotes ?? input.entry_notes),
    Status: asText(input.status) || "Pending",
    Score: asNumber(input.score),
    Findings: asText(input.findings),
    SubmittedAt: asText(input.submittedAt ?? input.submitted_at),
    Frequency: asText(input.frequency),
    _dbId:
      typeof input.id === "number" || typeof input.id === "string"
        ? input.id
        : null,
  };
}

export function monthDateRange(reportingYear: number, reportingMonth: number) {
  const first = new Date(Date.UTC(reportingYear, reportingMonth - 1, 1));
  const last = new Date(Date.UTC(reportingYear, reportingMonth, 0));
  return {
    dateFrom: first.toISOString().slice(0, 10),
    dateTo: last.toISOString().slice(0, 10),
  };
}

export function filterDashboardRows(
  rows: OdmDashboardRow[],
  filters: OdmDashboardFilters = {}
) {
  const df = asText(filters.dateFrom);
  const dt = asText(filters.dateTo);
  const plant = asText(filters.plant);
  const equipmentType = asText(filters.equipmentType);
  const category = asText(filters.category);
  const inspector = asText(filters.inspector);
  return rows.filter(row => {
    const inspectionDate = toDateObject(row.InspectionDate);
    if (df && (!inspectionDate || inspectionDate < new Date(df))) return false;
    if (dt && (!inspectionDate || inspectionDate > new Date(dt))) return false;
    if (plant && row.Plant !== plant) return false;
    if (equipmentType && row.EquipmentType !== equipmentType) return false;
    if (category && row.Category !== category) return false;
    if (inspector && row.Inspector !== inspector) return false;
    return true;
  });
}

export function hasAbnormalKeyword(value: unknown) {
  const normalized = asText(value).toLowerCase();
  if (!normalized) return false;
  return ABNORMAL_KEYWORDS.some(keyword => normalized.includes(keyword));
}

export function hasNegativeFindings(row: OdmDashboardRow) {
  if (hasAbnormalKeyword(row.EntryNotes)) return true;
  if (hasAbnormalKeyword(row.Capture1Response)) return true;
  if (hasAbnormalKeyword(row.Findings)) return true;
  return false;
}

export function isAbnormalDashboardRow(row: OdmDashboardRow) {
  if (hasNegativeFindings(row)) return true;
  return /offline|down|fault|alarm|critical/i.test(row.Status);
}

export function computeHealthScore(rows: OdmDashboardRow[]) {
  const total = rows.length;
  if (!total) return 100;
  const unhealthy = rows.filter(isAbnormalDashboardRow).length;
  return 100 - (unhealthy / total) * 100;
}

export function computeDataQuality(rows: OdmDashboardRow[]) {
  const totalFields = rows.length * DQ_FIELDS.length;
  if (!totalFields) return { score: 100, issueRows: 0 };
  let filled = 0;
  let issueRows = 0;
  rows.forEach(row => {
    const missing = DQ_FIELDS.filter(field => !asText(row[field]));
    if (missing.length) issueRows += 1;
    filled += DQ_FIELDS.length - missing.length;
  });
  return { score: (filled / totalFields) * 100, issueRows };
}

export function computePredictiveRisk(rows: OdmDashboardRow[]) {
  if (!rows.length) return "Normal" as const;
  const daily = new Map<string, number>();
  let totalAbnormal = 0;
  rows.forEach(row => {
    const key = dateKey(row.InspectionDate);
    if (!key) return;
    if (!daily.has(key)) daily.set(key, 0);
    if (isAbnormalDashboardRow(row)) {
      daily.set(key, (daily.get(key) || 0) + 1);
      totalAbnormal += 1;
    }
  });
  const abnormalityRate = totalAbnormal / rows.length;
  const dates = Array.from(daily.keys()).sort();
  let slope = 0;
  if (dates.length >= 3) {
    const xs = dates.map((_, index) => index);
    const ys = dates.map(date => daily.get(date) || 0);
    const n = xs.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    for (let index = 0; index < n; index += 1) {
      sumX += xs[index];
      sumY += ys[index];
      sumXY += xs[index] * ys[index];
      sumXX += xs[index] * xs[index];
    }
    const denom = n * sumXX - sumX * sumX;
    slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  }
  if (abnormalityRate > 0.1 || slope > 0.5) return "High" as const;
  if (abnormalityRate > 0.05 || slope > 0.2) return "Elevated" as const;
  return "Normal" as const;
}

function getAssetName(row: OdmDashboardRow) {
  return row.AssetTag || row.AssetName || row.EquipmentName || row.EquipmentType || "Unknown";
}

function getCategoryName(row: OdmDashboardRow) {
  return row.EquipmentType || row.Category || row.Task || "Unknown";
}

function getInspectorName(row: OdmDashboardRow) {
  return row.Inspector || "(Unknown)";
}

function isCriticalPriority(row: OdmDashboardRow) {
  return /(critical|urgent|high priority|high-priority|emergency|shutdown|immediate|major)/.test(
    [row.EntryNotes, row.Capture1Response, row.Findings, row.Status, row.EscalationTrigger]
      .join(" ")
      .toLowerCase()
  );
}

function getCriticalContributorName(row: OdmDashboardRow) {
  return row.AssetTag;
}

function buildParetoTopContributors(rows: OdmDashboardRow[]) {
  const negativeRows = rows.filter(hasNegativeFindings);
  const groups = new Map<
    string,
    { name: string; equipmentType: string; facility: string; count: number }
  >();
  negativeRows.forEach(row => {
    const name = getCriticalContributorName(row);
    if (!name) return;
    if (!groups.has(name)) {
      groups.set(name, {
        name,
        equipmentType: getCategoryName(row),
        facility: row.Plant || "(Unknown facility)",
        count: 0,
      });
    }
    const group = groups.get(name);
    if (!group) return;
    group.count += 1;
    if (row.EquipmentType || row.Category || row.Task) {
      group.equipmentType = getCategoryName(row);
    }
    if (row.Plant) group.facility = row.Plant;
  });
  const sorted = Array.from(groups.values()).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name)
  );
  const take = sorted.length ? Math.max(1, Math.ceil(sorted.length * 0.2)) : 0;
  const total = sorted.reduce((sum, group) => sum + group.count, 0) || 1;
  let cumulative = 0;
  return sorted.slice(0, take).map(group => {
    cumulative += group.count;
    return {
      name: group.name,
      equipmentType: group.equipmentType,
      facility: group.facility,
      findingCount: group.count,
      share: Math.round((group.count / total) * 100),
      cumulative: Math.round((cumulative / total) * 100),
    };
  });
}

function normalizeInsightText(value: unknown) {
  return asText(value).toLowerCase();
}

function getInsightDrilldownType(insight: OdmDashboardInsight) {
  return asText(insight.drilldown?.type);
}

function getInsightConcentrationCategory(insight: OdmDashboardInsight) {
  return normalizeInsightText(
    insight.drilldown?.category ?? insight.drilldown?.dominantCategory
  );
}

function getCriticalContributorSet(insight: OdmDashboardInsight | undefined) {
  const contributors = insight?.drilldown?.contributors;
  if (!Array.isArray(contributors)) return new Set<string>();
  return new Set(
    contributors
      .map(item => normalizeInsightText((item as { name?: unknown })?.name))
      .filter(Boolean)
  );
}

function removeOverlappingManagementInsights(insights: OdmDashboardInsight[]) {
  const criticalInsight = insights.find(
    insight => getInsightDrilldownType(insight) === "critical-issues-immediate-action"
  );
  const criticalContributors = getCriticalContributorSet(criticalInsight);
  return insights.filter(insight => {
    if (!criticalInsight) return true;
    const drilldownType = getInsightDrilldownType(insight);
    const title = normalizeInsightText(insight.title);
    if (drilldownType === "pareto-concentration") return false;
    if (
      drilldownType === "dominant-equipment-type-negative-findings" ||
      drilldownType === "centrifugal-pump-negative-findings" ||
      title.includes("systems dominate negative findings")
    ) {
      const category = getInsightConcentrationCategory(insight);
      return !category || !criticalContributors.has(category);
    }
    return true;
  });
}

function generateTrendInsights(
  rows: OdmDashboardRow[],
  config = DEFAULT_INSIGHT_CONFIG
) {
  const insights: OdmDashboardInsight[] = [];
  const dailyMap = new Map<string, { assets: Set<string>; total: number }>();
  rows.forEach(row => {
    const key = dateKey(row.InspectionDate);
    if (!key) return;
    if (!dailyMap.has(key)) dailyMap.set(key, { assets: new Set(), total: 0 });
    const day = dailyMap.get(key);
    if (!day) return;
    if (hasNegativeFindings(row)) day.assets.add(getAssetName(row));
    day.total += 1;
  });
  const dates = Array.from(dailyMap.keys()).sort();
  if (dates.length < 4) return insights;
  const distinctArr = dates.map(date => dailyMap.get(date)?.assets.size || 0);
  const totalArr = dates.map(date => dailyMap.get(date)?.total || 0);
  const totalNegFindings = distinctArr.reduce((sum, value) => sum + value, 0);
  if (totalNegFindings < 5) return insights;
  const half = Math.floor(dates.length / 2);
  const recentDistinct = distinctArr.slice(half).reduce((sum, value) => sum + value, 0);
  const prevDistinct = distinctArr.slice(0, half).reduce((sum, value) => sum + value, 0);
  const change = pctChange(recentDistinct, prevDistinct);
  if (change >= config.spikeThresholdPct) {
    insights.push({
      type: "trend",
      severity: "high",
      title: "Negative Findings Trend Increased",
      description: `Distinct negative findings increased ${change}% compared to the previous period.`,
      metric: `${recentDistinct} vs ${prevDistinct}`,
      recommendation:
        "Review recent inspection entries and prioritize follow-up on flagged assets.",
      drilldown: {
        type: "negative-findings-trend-increased",
        change,
        recentDistinct,
        prevDistinct,
      },
    });
  } else if (change <= config.declineThresholdPct) {
    insights.push({
      type: "trend",
      severity: "info",
      title: "Negative Findings Declining",
      description: `Distinct negative findings decreased ${Math.abs(change)}% compared to the previous period.`,
      metric: `${recentDistinct} vs ${prevDistinct}`,
      recommendation:
        "Continue current maintenance approach. Monitor for sustained improvement.",
      drilldown: {
        type: "negative-findings-declining",
        change,
        recentDistinct,
        prevDistinct,
        periodSize: half,
        totalDays: dates.length,
      },
    });
  }
  if (distinctArr.length >= config.rollingWindow + 1) {
    const lastVal = distinctArr[distinctArr.length - 1];
    const rollAvg = rollingAvg(distinctArr.slice(0, -1), config.rollingWindow);
    if (rollAvg > 0 && ((lastVal - rollAvg) / rollAvg) * 100 >= config.spikeThresholdPct) {
      insights.push({
        type: "anomaly",
        severity: "critical",
        title: "Sudden Spike in Negative Findings",
        description: `A spike was detected on ${formatInsightDate(dates[dates.length - 1])}: ${lastVal} distinct affected assets vs ${Math.round(rollAvg)} recent average.`,
        metric: `${lastVal} (avg ${Math.round(rollAvg)})`,
        recommendation:
          "Immediately investigate the cause. Check for equipment failure batch or inspection scope change.",
        drilldown: {
          type: "sudden-spike-negative-findings",
          spikeDate: dates[dates.length - 1],
          lastVal,
          rollingAverage: Math.round(rollAvg),
        },
      });
    }
  }
  const recentTotal = totalArr.slice(half).reduce((sum, value) => sum + value, 0);
  const prevTotal = totalArr.slice(0, half).reduce((sum, value) => sum + value, 0);
  const totalChange = pctChange(recentTotal, prevTotal);
  if (totalChange <= config.declineThresholdPct) {
    insights.push({
      type: "trend",
      severity: "medium",
      title: "Inspection Activity Declining",
      description: `Total inspection entries decreased ${Math.abs(totalChange)}% in the recent period.`,
      metric: `${recentTotal} vs ${prevTotal}`,
      recommendation:
        "Verify inspection schedules are being followed. Check for resource constraints.",
      drilldown: {
        type: "inspection-activity-declining",
        change: totalChange,
        recentTotal,
        prevTotal,
        periodSize: half,
        totalDays: dates.length,
      },
    });
  }
  return insights;
}

function generateRiskInsights(rows: OdmDashboardRow[], config = DEFAULT_INSIGHT_CONFIG) {
  const insights: OdmDashboardInsight[] = [];
  const catData = new Map<string, { assets: Set<string>; total: number }>();
  rows.forEach(row => {
    if (!hasNegativeFindings(row)) return;
    const category = getCategoryName(row);
    const assetId = getAssetName(row);
    if (!catData.has(category)) catData.set(category, { assets: new Set(), total: 0 });
    const data = catData.get(category);
    if (!data) return;
    data.assets.add(assetId);
    data.total += 1;
  });
  if (!catData.size) return insights;
  const sorted = Array.from(catData.entries())
    .map(([category, data]) => ({
      category,
      distinct: data.assets.size,
      total: data.total,
    }))
    .sort((a, b) => b.distinct - a.distinct);
  const totalDistinct = sorted.reduce((sum, item) => sum + item.distinct, 0);
  const totalNegRecords = sorted.reduce((sum, item) => sum + item.total, 0);
  if (
    totalNegRecords >= config.minNegFindingsForRisk &&
    totalDistinct >= config.minDistinctAssetsForRisk &&
    sorted.length > 0 &&
    totalDistinct > 0
  ) {
    const topPct = Math.round((sorted[0].distinct / totalDistinct) * 100);
    if (topPct >= 40) {
      const dominantCategory = sorted[0].category || "Unknown";
      const isPumpDominant = /centrifugal|pump system|pump-system|pump/i.test(
        dominantCategory.toLowerCase()
      );
      insights.push({
        type: "risk",
        severity: topPct >= 60 ? "critical" : "high",
        title: isPumpDominant
          ? "Centrifugal Pump Systems Dominate Negative Findings"
          : `${dominantCategory} Systems Dominate Negative Findings`,
        description: `${sorted[0].category} accounts for ${sorted[0].distinct} distinct assets with ${sorted[0].total} negative findings (${topPct}% of ${totalDistinct} affected assets).`,
        metric: `${sorted[0].distinct} assets • ${sorted[0].total} findings`,
        recommendation: `Prioritize preventive maintenance planning for ${sorted[0].category.toLowerCase()} systems. Review recurring failure patterns.`,
        drilldown: {
          type: isPumpDominant
            ? "centrifugal-pump-negative-findings"
            : "dominant-equipment-type-negative-findings",
          category: sorted[0].category,
          topPercent: topPct,
          distinctAssets: sorted[0].distinct,
          recordCount: sorted[0].total,
        },
      });
    }
    let cumulative = 0;
    let paretoCount = 0;
    for (const item of sorted) {
      cumulative += item.distinct;
      paretoCount += 1;
      if ((cumulative / totalDistinct) * 100 >= config.paretoThreshold) break;
    }
    if (paretoCount < sorted.length && sorted.length >= 3) {
      const paretoCategories = sorted.slice(0, paretoCount);
      const paretoAssets = paretoCategories.reduce((sum, item) => sum + item.distinct, 0);
      const paretoRecords = paretoCategories.reduce((sum, item) => sum + item.total, 0);
      insights.push({
        type: "risk",
        severity: "medium",
        title: "Pareto Concentration Detected",
        description: `${paretoCount} equipment categories account for ${paretoAssets} distinct assets and ${paretoRecords} negative findings.`,
        metric: `${paretoCount} categories • ${paretoRecords} findings`,
        recommendation:
          "Focus corrective efforts on the top equipment categories for maximum impact.",
        drilldown: {
          type: "pareto-concentration",
          categories: paretoCategories.map(item => item.category),
          distinctCategories: paretoCount,
          distinctAssets: paretoAssets,
          recordCount: paretoRecords,
          totalCategories: sorted.length,
        },
      });
    }
  }
  const assetCounts = new Map<string, number>();
  rows.forEach(row => {
    if (!hasNegativeFindings(row)) return;
    const key = getAssetName(row);
    assetCounts.set(key, (assetCounts.get(key) || 0) + 1);
  });
  const recurring = Array.from(assetCounts.entries())
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, config.topNAssets);
  if (recurring.length >= 2) {
    insights.push({
      type: "risk",
      severity: "high",
      title: "Recurring Issues on Same Assets",
      description: `${recurring.length} assets show repeated negative findings across ${recurring.reduce((sum, item) => sum + item[1], 0)} records. Top: ${recurring[0][0]} (${recurring[0][1]} occurrences).`,
      metric: `${recurring.length} assets • ${recurring.reduce((sum, item) => sum + item[1], 0)} findings`,
      recommendation:
        "Schedule dedicated maintenance review for assets with 3+ repeated findings. Consider replacement assessment.",
      drilldown: {
        type: "recurring-issues-same-assets",
        threshold: 3,
        recurring,
      },
    });
  }
  return insights;
}

function generateInspectorInsights(
  rows: OdmDashboardRow[],
  config = DEFAULT_INSIGHT_CONFIG
) {
  const insights: OdmDashboardInsight[] = [];
  const byInspector = new Map<string, { count: number; negative: number; dates: string[] }>();
  rows.forEach(row => {
    const name = getInspectorName(row);
    if (!byInspector.has(name)) byInspector.set(name, { count: 0, negative: 0, dates: [] });
    const data = byInspector.get(name);
    if (!data) return;
    data.count += 1;
    if (hasNegativeFindings(row)) data.negative += 1;
    const key = dateKey(row.InspectionDate);
    if (key) data.dates.push(key);
  });
  if (byInspector.size < 2) return insights;
  const today = todayISO();
  const inactive = Array.from(byInspector.entries())
    .filter(([, data]) => {
      if (!data.dates.length) return true;
      const sortedDates = [...data.dates].sort();
      return daysBetween(sortedDates[sortedDates.length - 1], today) > config.inactivityDays;
    })
    .map(([name, data]) => {
      const sortedDates = [...data.dates].sort();
      return {
        name,
        lastDate: sortedDates[sortedDates.length - 1] || "unknown",
      };
    });
  const inactiveNames = new Set(inactive.map(item => item.name));
  const avgInspections = avg(Array.from(byInspector.values()).map(data => data.count));
  const lowActivity = Array.from(byInspector.entries())
    .filter(
      ([name, data]) =>
        !inactiveNames.has(name) &&
        data.count < Math.max(config.inspectorMinInspections, avgInspections * 0.3)
    )
    .map(([name]) => name);
  if (lowActivity.length >= 2) {
    insights.push({
      type: "inspector",
      severity: "medium",
      title: `${lowActivity.length} Inspectors with Low Activity`,
      description: `${lowActivity.slice(0, 3).join(", ")}${lowActivity.length > 3 ? " and others" : ""} have significantly fewer inspection entries than average (${Math.round(avgInspections)}).`,
      metric: `${lowActivity.length} inspectors • ${lowActivity.reduce((sum, name) => sum + (byInspector.get(name)?.count || 0), 0)} records`,
      recommendation:
        "Verify inspector assignments and workload distribution. Check for scheduling gaps or resource issues.",
      drilldown: {
        type: "inspectors-low-activity",
        avgInspections: Math.round(avgInspections),
        threshold: Math.max(config.inspectorMinInspections, avgInspections * 0.3),
        inspectors: lowActivity,
      },
    });
  }
  if (inactive.length >= 1) {
    insights.push({
      type: "inspector",
      severity: "low",
      title: `${inactive.length} Inactive Inspector${inactive.length > 1 ? "s" : ""}`,
      description: `${inactive.slice(0, 3).map(item => item.name).join(", ")}${inactive.length > 3 ? " and others" : ""} have no inspection activity in the last ${config.inactivityDays} days.`,
      metric: `${inactive.length} inspectors • ${inactive.reduce((sum, item) => sum + (byInspector.get(item.name)?.count || 0), 0)} records`,
      recommendation: "Confirm inspector availability and reassign coverage if needed.",
      drilldown: {
        type: "inspectors-inactive",
        inactivityDays: config.inactivityDays,
        inspectors: inactive.map(item => item.name),
      },
    });
  }
  return insights;
}

function generateCoverageInsights(
  rows: OdmDashboardRow[],
  config = DEFAULT_INSIGHT_CONFIG
) {
  const insights: OdmDashboardInsight[] = [];
  const assetDates = new Map<string, string>();
  rows.forEach(row => {
    const asset = getAssetName(row);
    const key = dateKey(row.InspectionDate);
    if (!key) return;
    if (!assetDates.has(asset) || key > (assetDates.get(asset) || "")) {
      assetDates.set(asset, key);
    }
  });
  const today = todayISO();
  const uncovered = Array.from(assetDates.entries())
    .filter(([, lastDate]) => daysBetween(lastDate, today) > config.coverageGapDays)
    .map(([asset]) => asset);
  const uncoveredSet = new Set(uncovered);
  const negAssets = new Set<string>();
  rows.forEach(row => {
    if (hasNegativeFindings(row)) negAssets.add(getAssetName(row));
  });
  const staleNeg = Array.from(negAssets).filter(asset => uncoveredSet.has(asset));
  if (uncovered.length >= 3) {
    insights.push({
      type: "coverage",
      severity: "medium",
      title: "Inspection Coverage Gaps Detected",
      description: `${uncovered.length} assets have not been inspected within the last ${config.coverageGapDays} days${staleNeg.length ? `, including ${staleNeg.length} with prior negative findings` : ""}.`,
      metric: `${uncovered.length} assets overdue${staleNeg.length ? ` • ${staleNeg.length} priority` : ""}`,
      recommendation:
        "Schedule overdue inspections. Prioritize assets with historical negative findings.",
      drilldown: {
        type: "inspection-coverage-gaps",
        gapDays: config.coverageGapDays,
        overdueAssets: uncovered,
        priorityNegativeAssets: staleNeg,
        distinctAssets: uncovered.length,
        priorityCount: staleNeg.length,
      },
    });
  }
  return insights;
}

function generateRecommendations(rows: OdmDashboardRow[]) {
  const insights: OdmDashboardInsight[] = [];
  const negCount = rows.filter(hasNegativeFindings).length;
  const negPct = rows.length > 0 ? Math.round((negCount / rows.length) * 100) : 0;
  if (negCount >= 10 && negPct >= 10) {
    insights.push({
      type: "recommendation",
      severity: "high",
      title: "High Negative Finding Rate",
      description: `${negPct}% of inspections (${negCount} entries) contain negative findings. This exceeds the 10% threshold.`,
      metric: `${negPct}% negative rate`,
      recommendation:
        "Initiate a focused maintenance campaign. Use the Pareto chart to target the highest-impact equipment categories first.",
      drilldown: { type: "negative-finding-rate-high", negCount, totalCount: rows.length, negPct },
    });
  } else if (negCount >= 10 && negPct > 0) {
    insights.push({
      type: "recommendation",
      severity: "info",
      title: "Negative Finding Rate Within Normal Range",
      description: `${negPct}% of inspections contain negative findings (${negCount} entries).`,
      metric: `${negPct}% negative rate`,
      recommendation:
        "Continue monitoring. Address individual findings through standard maintenance workflow.",
      drilldown: { type: "negative-finding-rate-normal", negCount, totalCount: rows.length, negPct },
    });
  }
  const criticalContributors = buildParetoTopContributors(rows);
  const criticalFindingCount = criticalContributors.reduce(
    (sum, item) => sum + item.findingCount,
    0
  );
  if (criticalContributors.length > 0 && criticalFindingCount > 0) {
    insights.push({
      type: "recommendation",
      severity: "critical",
      title: "Critical Issues Require Immediate Action",
      description: `${criticalContributors.length} Pareto top-20% equipment asset${criticalContributors.length !== 1 ? "s" : ""} should be raised to S/4, accounting for ${criticalFindingCount} negative finding${criticalFindingCount !== 1 ? "s" : ""}.`,
      metric: `${criticalContributors.length} S/4 equipment • ${criticalFindingCount} findings`,
      recommendation:
        "Raise S/4 maintenance notifications or work orders for these specific equipment assets first. Assign corrective actions against the highest-impact equipment.",
      drilldown: {
        type: "critical-issues-immediate-action",
        basis: "s4-equipment-asset-pareto-top-20-negative-findings",
        contributors: criticalContributors,
        distinctAssets: criticalContributors.length,
        recordCount: criticalFindingCount,
      },
    });
  }
  const explicitCriticalRows = rows.filter(
    row => hasNegativeFindings(row) && isCriticalPriority(row)
  );
  const explicitCriticalAssets = new Set(explicitCriticalRows.map(getAssetName));
  if (explicitCriticalRows.length > 0) {
    insights.push({
      type: "recommendation",
      severity: "high",
      title: "Explicit Critical Findings Detected",
      description: `${explicitCriticalAssets.size} asset${explicitCriticalAssets.size !== 1 ? "s" : ""} include explicit critical/high-priority wording across ${explicitCriticalRows.length} finding${explicitCriticalRows.length !== 1 ? "s" : ""}.`,
      metric: `${explicitCriticalAssets.size} assets • ${explicitCriticalRows.length} findings`,
      recommendation:
        "Review explicitly critical wording alongside Pareto-driven priorities.",
      drilldown: {
        type: "explicit-critical-findings",
        distinctAssets: explicitCriticalAssets.size,
        recordCount: explicitCriticalRows.length,
      },
    });
  }
  return insights;
}

export function generateDashboardInsights(rows: OdmDashboardRow[]) {
  if (!rows.length) return [];
  const insights = [
    ...generateTrendInsights(rows),
    ...generateRiskInsights(rows),
    ...generateInspectorInsights(rows),
    ...generateCoverageInsights(rows),
    ...generateRecommendations(rows),
  ];
  const finalInsights = removeOverlappingManagementInsights(insights);
  const severityWeight = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
  return finalInsights.sort(
    (a, b) => severityWeight[b.severity] - severityWeight[a.severity]
  );
}

export function buildDashboardOptions(rows: OdmDashboardRow[]): OdmDashboardOptions {
  const years = new Set<number>();
  const months = new Set<number>();
  const facilities = new Set<string>();
  const equipmentTypes = new Set<string>();
  const categories = new Set<string>();
  const inspectors = new Set<string>();
  rows.forEach(row => {
    const inspectionDate = toDateObject(row.InspectionDate);
    if (inspectionDate) {
      years.add(inspectionDate.getFullYear());
      months.add(inspectionDate.getMonth() + 1);
    }
    if (row.Plant) facilities.add(row.Plant);
    if (row.EquipmentType) equipmentTypes.add(row.EquipmentType);
    if (row.Category) categories.add(row.Category);
    if (row.Inspector) inspectors.add(row.Inspector);
  });
  return {
    years: Array.from(years).sort((a, b) => b - a),
    months: Array.from(months).sort((a, b) => b - a),
    facilities: Array.from(facilities).sort((a, b) => a.localeCompare(b)),
    equipmentTypes: Array.from(equipmentTypes).sort((a, b) => a.localeCompare(b)),
    categories: Array.from(categories).sort((a, b) => a.localeCompare(b)),
    inspectors: Array.from(inspectors).sort((a, b) => a.localeCompare(b)),
  };
}

export function buildDashboardTrend(rows: OdmDashboardRow[]): OdmTrendPoint[] {
  const dailyMap = new Map<string, { assets: Set<string>; total: number }>();
  rows.forEach(row => {
    const key = dateKey(row.InspectionDate);
    if (!key || !hasNegativeFindings(row)) return;
    const assetId = row.AssetTag || row.AssetName || row.EquipmentType || "Unknown";
    if (!dailyMap.has(key)) dailyMap.set(key, { assets: new Set(), total: 0 });
    const day = dailyMap.get(key);
    if (!day) return;
    day.assets.add(assetId);
    day.total += 1;
  });
  return Array.from(dailyMap.keys())
    .sort()
    .map(date => ({
      date,
      distinctAffectedAssets: dailyMap.get(date)?.assets.size || 0,
      totalNegativeInspections: dailyMap.get(date)?.total || 0,
    }));
}

export function buildFindingThemes(rows: OdmDashboardRow[]): OdmFindingTheme[] {
  const catData = new Map<string, { assets: Set<string>; total: number }>();
  rows.forEach(row => {
    if (!hasNegativeFindings(row)) return;
    const category = row.EquipmentType || "Unknown";
    const assetId = row.AssetTag || row.AssetName || `${row.Plant}|${category}` || "Unknown";
    if (!catData.has(category)) catData.set(category, { assets: new Set(), total: 0 });
    const data = catData.get(category);
    if (!data) return;
    data.assets.add(assetId);
    data.total += 1;
  });
  const sorted = Array.from(catData.entries())
    .map(([category, data]) => ({
      category,
      distinctAssets: data.assets.size,
      totalInspections: data.total,
    }))
    .sort((a, b) => b.distinctAssets - a.distinctAssets);
  const totalDistinct = sorted.reduce((sum, item) => sum + item.distinctAssets, 0);
  let cumulative = 0;
  return sorted.map(item => {
    cumulative += item.distinctAssets;
    return {
      ...item,
      cumulativePercent: totalDistinct
        ? Number(((cumulative / totalDistinct) * 100).toFixed(1))
        : 0,
    };
  });
}

export function buildFacilityBreakdown(rows: OdmDashboardRow[]): OdmFacilitySummary[] {
  const groups = new Map<string, OdmDashboardRow[]>();
  rows.forEach(row => {
    const plant = row.Plant || "Unspecified Facility";
    groups.set(plant, [...(groups.get(plant) || []), row]);
  });
  return Array.from(groups.entries())
    .map(([plant, plantRows]) => ({
      plant,
      totalInspections: plantRows.length,
      uniqueAssets: new Set(plantRows.map(row => row.AssetTag).filter(Boolean)).size,
      healthScore: computeHealthScore(plantRows),
      dataQualityScore: computeDataQuality(plantRows).score,
      negativeFindings: plantRows.filter(hasNegativeFindings).length,
    }))
    .sort(
      (a, b) =>
        b.negativeFindings - a.negativeFindings ||
        b.totalInspections - a.totalInspections
    );
}

export function summarizeDashboardRows(
  rows: OdmDashboardRow[],
  insights = generateDashboardInsights(rows)
): OdmDashboardSummary {
  const dq = computeDataQuality(rows);
  const criticalHigh = insights.filter(
    insight => insight.severity === "critical" || insight.severity === "high"
  ).length;
  const alertCount = criticalHigh > 0 ? criticalHigh : insights.length;
  return {
    totalInspections: rows.length,
    uniqueAssets: new Set(rows.map(row => row.AssetTag).filter(Boolean)).size,
    healthScore: computeHealthScore(rows),
    dataQualityScore: dq.score,
    predictiveRisk: computePredictiveRisk(rows),
    negativeFindings: rows.filter(hasNegativeFindings).length,
    notesCount: rows.filter(row => asText(row.EntryNotes)).length,
    dataQualityIssueRows: dq.issueRows,
    insightCount: insights.length,
    alertCount,
    alertLabel:
      criticalHigh > 0
        ? `${criticalHigh} alert${criticalHigh !== 1 ? "s" : ""}`
        : `${insights.length} insight${insights.length !== 1 ? "s" : ""}`,
  };
}

export function buildOdmDashboardScorecard(
  sourceRows: OdmDashboardRow[],
  filters: OdmDashboardFilters = {}
): OdmDashboardScorecard {
  const rows = filterDashboardRows(sourceRows, filters);
  const insights = generateDashboardInsights(rows);
  return {
    rows,
    filters,
    summary: summarizeDashboardRows(rows, insights),
    insights,
    facilityBreakdown: buildFacilityBreakdown(rows),
    findingThemes: buildFindingThemes(rows),
    trend: buildDashboardTrend(rows),
    notes: rows.filter(row => asText(row.EntryNotes)),
    options: buildDashboardOptions(sourceRows),
  };
}
