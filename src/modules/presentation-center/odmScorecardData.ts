import { getReportingPeriodLabel, MONTH_NAMES } from "./scorecardData";
import type { OdmTemplate } from "./types";
import {
  monthDateRange,
  type OdmDashboardFilters,
  type OdmDashboardInsight,
  type OdmDashboardOptions,
  type OdmDashboardRow,
  type OdmDashboardScorecard,
} from "../operator-driven-maintenance/dashboardSummary";

export const OPERATOR_DRIVEN_MAINTENANCE_SOURCE_LABEL =
  "Operator-Driven Maintenance Scorecard";
export const ALL_FACILITIES_LABEL = "All Facilities";
export const ODM_EXECUTIVE_SUMMARY_TEMPLATE: OdmTemplate = "Executive Summary";
export const ODM_TEMPLATE_OPTIONS = [ODM_EXECUTIVE_SUMMARY_TEMPLATE] as const;

export type OdmInspectionsRequest = {
  reportingYear?: number;
  reportingMonth?: number;
  dateFrom?: string | null;
  dateTo?: string | null;
  facility?: string | null;
  equipmentType?: string | null;
  category?: string | null;
  inspector?: string | null;
};

export type OdmAvailableOptions = OdmDashboardOptions;

export type OdmInspectionRecord = {
  id?: number | string | null;
  submissionId?: string | null;
  facilityId: string;
  inspector?: string | null;
  inspectionDate?: string | null;
  assetTag?: string | null;
  assetName?: string | null;
  equipmentType?: string | null;
  category?: string | null;
  task?: string | null;
  capture1Label?: string | null;
  capture1Response?: string | null;
  escalationTrigger?: string | null;
  entryNotes?: string | null;
  status?: string | null;
  score?: number | null;
  findings?: string | null;
  date?: string | null;
  submittedAt?: string | null;
  frequency?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
};

export type OdmScorecardDataset = {
  records: OdmDashboardRow[];
  scorecard: OdmDashboardScorecard;
  reportingYear: number;
  reportingMonth: number;
  reportingMonthLabel: string;
  dateFrom: string;
  dateTo: string;
  facility: string;
  equipmentType: string;
  category: string;
  inspector: string;
  template: OdmTemplate;
};

type PersistedOdmInspectionRecord = Record<string, unknown>;
type PersistedOdmSummaryResponse = Partial<OdmDashboardScorecard> & {
  records?: PersistedOdmInspectionRecord[];
  rows?: PersistedOdmInspectionRecord[];
  error?: string;
};

function asNullableText(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function asRequiredText(value: unknown, fallback = "Unspecified Facility") {
  return asNullableText(value) ?? fallback;
}

function asNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = asNullableNumber(value);
  return parsed ?? fallback;
}

function asNullableId(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || typeof value === "string") return value;
  return String(value);
}

function getRecordDateText(record: OdmInspectionRecord | PersistedOdmInspectionRecord) {
  const source = record as Record<string, unknown>;
  return (
    asNullableText(source.date) ??
    asNullableText(source.inspectionDate) ??
    asNullableText(source.inspection_date) ??
    asNullableText(source.submittedAt) ??
    asNullableText(source.submitted_at)
  );
}

export function getOdmInspectionDateParts(
  record: OdmInspectionRecord | PersistedOdmInspectionRecord
) {
  const raw = getRecordDateText(record);
  if (!raw) return null;
  const text = raw.trim();
  const isoMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    if (Number.isInteger(year) && month >= 1 && month <= 12) {
      return { year, month, label: `${MONTH_NAMES[month - 1]} ${year}` };
    }
  }

  const usMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usMatch) {
    const month = Number(usMatch[1]);
    const year = Number(usMatch[3]);
    if (Number.isInteger(year) && month >= 1 && month <= 12) {
      return { year, month, label: `${MONTH_NAMES[month - 1]} ${year}` };
    }
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = parsed.getMonth() + 1;
    return { year, month, label: `${MONTH_NAMES[month - 1]} ${year}` };
  }

  return null;
}

export function getOdmMonthDateRange(reportingYear: number, reportingMonth: number) {
  return monthDateRange(reportingYear, reportingMonth);
}

export function getOdmFacilityScope(value?: string | null) {
  const facility = asNullableText(value);
  return facility && facility !== ALL_FACILITIES_LABEL
    ? facility
    : ALL_FACILITIES_LABEL;
}

function getOptionalScope(value?: string | null) {
  return asNullableText(value) ?? "";
}

function getRequestDateRange(filters?: Partial<OdmInspectionsRequest>) {
  const dateFrom = asNullableText(filters?.dateFrom);
  const dateTo = asNullableText(filters?.dateTo);
  return { dateFrom: dateFrom ?? "", dateTo: dateTo ?? "" };
}

function getDashboardPeriodLabel(
  dateFrom: string,
  dateTo: string,
  reportingMonth: number,
  reportingYear: number
) {
  if (dateFrom && dateTo) {
    if (Number.isInteger(reportingYear) && Number.isInteger(reportingMonth)) {
      const monthRange = monthDateRange(reportingYear, reportingMonth);
      if (dateFrom === monthRange.dateFrom && dateTo === monthRange.dateTo) {
        return getReportingPeriodLabel(reportingMonth, reportingYear);
      }
    }
    return `${dateFrom} to ${dateTo}`;
  }
  if (dateFrom) return `From ${dateFrom}`;
  if (dateTo) return `Through ${dateTo}`;
  return "All Dates";
}

export function buildOdmSummaryUrl(filters?: Partial<OdmInspectionsRequest>) {
  const params = new URLSearchParams();
  const { dateFrom, dateTo } = getRequestDateRange(filters);
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo) params.set("date_to", dateTo);

  const facility = getOdmFacilityScope(filters?.facility);
  if (facility !== ALL_FACILITIES_LABEL) params.set("facility_id", facility);

  const equipmentType = getOptionalScope(filters?.equipmentType);
  const category = getOptionalScope(filters?.category);
  const inspector = getOptionalScope(filters?.inspector);
  if (equipmentType) params.set("equipment_type", equipmentType);
  if (category) params.set("category", category);
  if (inspector) params.set("inspector", inspector);

  const query = params.toString();
  return query
    ? `/api/operator-driven-maintenance/summary?${query}`
    : "/api/operator-driven-maintenance/summary";
}

export const buildOdmInspectionsUrl = buildOdmSummaryUrl;

export function mapPersistedOdmInspectionRecord(
  record: PersistedOdmInspectionRecord
): OdmInspectionRecord {
  return {
    id: asNullableId(record.id),
    submissionId: asNullableText(record.submission_id ?? record.submissionId),
    facilityId: asRequiredText(record.facility_id ?? record.facilityId),
    inspector: asNullableText(record.inspector),
    inspectionDate: asNullableText(record.inspection_date ?? record.inspectionDate),
    assetTag: asNullableText(record.asset_tag ?? record.assetTag),
    assetName: asNullableText(record.asset_name ?? record.assetName),
    equipmentType: asNullableText(record.equipment_type ?? record.equipmentType),
    category: asNullableText(record.category),
    task: asNullableText(record.task),
    capture1Label: asNullableText(record.capture1_label ?? record.capture1Label),
    capture1Response: asNullableText(
      record.capture1_response ?? record.capture1Response
    ),
    escalationTrigger: asNullableText(
      record.escalation_trigger ?? record.escalationTrigger
    ),
    entryNotes: asNullableText(record.entry_notes ?? record.entryNotes),
    status: asNullableText(record.status),
    score: asNullableNumber(record.score),
    findings: asNullableText(record.findings),
    date: asNullableText(record.date),
    submittedAt: asNullableText(record.submitted_at ?? record.submittedAt),
    frequency: asNullableText(record.frequency),
    updatedBy: asNullableText(record.updated_by ?? record.updatedBy),
    updatedAt: asNullableText(record.updated_at ?? record.updatedAt),
  };
}

function normalizeDashboardRow(record: PersistedOdmInspectionRecord): OdmDashboardRow {
  const rawDate =
    record.InspectionDate ??
    record.inspectionDate ??
    record.inspection_date ??
    record.date ??
    null;
  return {
    SubmissionID: asNullableText(record.SubmissionID ?? record.submission_id) ?? "",
    InspectionDate: asNullableText(rawDate),
    Inspector: asNullableText(record.Inspector ?? record.inspector) ?? "",
    AssetTag: asNullableText(record.AssetTag ?? record.asset_tag) ?? "",
    AssetName: asNullableText(record.AssetName ?? record.asset_name) ?? "",
    Plant:
      asNullableText(record.Plant ?? record.facility_id ?? record.facilityId) ?? "",
    EquipmentType:
      asNullableText(record.EquipmentType ?? record.equipment_type) ?? "",
    EquipmentName:
      asNullableText(record.EquipmentName ?? record.asset_name ?? record.assetName) ??
      "",
    Category: asNullableText(record.Category ?? record.category) ?? "",
    Task: asNullableText(record.Task ?? record.task) ?? "",
    Capture1Label:
      asNullableText(record.Capture1Label ?? record.capture1_label) ?? "",
    Capture1Response:
      asNullableText(record.Capture1Response ?? record.capture1_response) ?? "",
    EscalationTrigger:
      asNullableText(record.EscalationTrigger ?? record.escalation_trigger) ?? "",
    EntryNotes: asNullableText(record.EntryNotes ?? record.entry_notes) ?? "",
    Status: asNullableText(record.Status ?? record.status) ?? "Pending",
    SubmittedAt: asNullableText(record.SubmittedAt ?? record.submitted_at) ?? "",
    Score: asNumber(record.Score ?? record.score),
    Findings: asNullableText(record.Findings ?? record.findings) ?? "",
    Frequency: asNullableText(record.Frequency ?? record.frequency) ?? "",
    _dbId: asNullableId(record._dbId ?? record.id),
  };
}

function normalizeInsights(value: unknown): OdmDashboardInsight[] {
  return Array.isArray(value) ? (value as OdmDashboardInsight[]) : [];
}

function normalizeOptions(value: unknown): OdmDashboardOptions {
  const options = (value ?? {}) as Partial<OdmDashboardOptions>;
  return {
    years: Array.isArray(options.years) ? options.years : [],
    months: Array.isArray(options.months) ? options.months : [],
    facilities: Array.isArray(options.facilities) ? options.facilities : [],
    equipmentTypes: Array.isArray(options.equipmentTypes)
      ? options.equipmentTypes
      : [],
    categories: Array.isArray(options.categories) ? options.categories : [],
    inspectors: Array.isArray(options.inspectors) ? options.inspectors : [],
  };
}

function normalizeOdmSummary(payload: PersistedOdmSummaryResponse): OdmDashboardScorecard {
  const rows = (Array.isArray(payload.rows) ? payload.rows : payload.records ?? []).map(
    normalizeDashboardRow
  );
  const summary = payload.summary ?? {
    totalInspections: rows.length,
    uniqueAssets: 0,
    healthScore: 100,
    dataQualityScore: 100,
    predictiveRisk: "Normal" as const,
    negativeFindings: 0,
    notesCount: 0,
    dataQualityIssueRows: 0,
    insightCount: 0,
    alertCount: 0,
    alertLabel: "0 insights",
  };
  return {
    rows,
    filters: (payload.filters ?? {}) as OdmDashboardFilters,
    summary,
    insights: normalizeInsights(payload.insights),
    facilityBreakdown: Array.isArray(payload.facilityBreakdown)
      ? payload.facilityBreakdown
      : [],
    findingThemes: Array.isArray(payload.findingThemes)
      ? payload.findingThemes
      : [],
    trend: Array.isArray(payload.trend) ? payload.trend : [],
    notes: Array.isArray(payload.notes)
      ? payload.notes.map(normalizeDashboardRow)
      : rows.filter(row => row.EntryNotes),
    options: normalizeOptions(payload.options),
  };
}

async function fetchOdmSummary(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json().catch(() => ({}))) as PersistedOdmSummaryResponse;
  if (!response.ok) {
    throw new Error(
      payload.error
        ? `Unable to load Operator-Driven Maintenance dashboard summary: ${payload.error}`
        : "Unable to load Operator-Driven Maintenance dashboard summary."
    );
  }
  return normalizeOdmSummary(payload);
}

export async function getAvailableOdmScorecardOptions(): Promise<OdmAvailableOptions> {
  const scorecard = await fetchOdmSummary(buildOdmSummaryUrl());
  return scorecard.options;
}

export async function getPersistedOdmScorecard(
  request: OdmInspectionsRequest,
  template: OdmTemplate = ODM_EXECUTIVE_SUMMARY_TEMPLATE
): Promise<OdmScorecardDataset> {
  const dateRange = getRequestDateRange(request);
  const scorecard = await fetchOdmSummary(buildOdmSummaryUrl(request));
  if (!scorecard.rows.length) {
    throw new Error(
      "No database records exist for the selected Operator-Driven Maintenance dashboard scope."
    );
  }

  const reportingYear = Number(request.reportingYear);
  const reportingMonth = Number(request.reportingMonth);
  const reportingMonthLabel = getDashboardPeriodLabel(
    dateRange.dateFrom,
    dateRange.dateTo,
    reportingMonth,
    reportingYear
  );
  return {
    records: scorecard.rows,
    scorecard,
    reportingYear,
    reportingMonth,
    reportingMonthLabel,
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
    facility: getOdmFacilityScope(request.facility),
    equipmentType: getOptionalScope(request.equipmentType),
    category: getOptionalScope(request.category),
    inspector: getOptionalScope(request.inspector),
    template,
  };
}
