import { getReportingPeriodLabel, MONTH_NAMES } from "./scorecardData";
import type { OdmTemplate } from "./types";

export const OPERATOR_DRIVEN_MAINTENANCE_SOURCE_LABEL =
  "Operator-Driven Maintenance Scorecard";
export const ALL_FACILITIES_LABEL = "All Facilities";
export const ODM_EXECUTIVE_SUMMARY_TEMPLATE: OdmTemplate = "Executive Summary";
export const ODM_TEMPLATE_OPTIONS = [ODM_EXECUTIVE_SUMMARY_TEMPLATE] as const;

export type OdmInspectionsRequest = {
  reportingYear: number;
  reportingMonth: number;
  facility?: string | null;
};

export type OdmAvailableOptions = {
  years: number[];
  months: number[];
  facilities: string[];
};

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
  records: OdmInspectionRecord[];
  reportingYear: number;
  reportingMonth: number;
  reportingMonthLabel: string;
  facility: string;
  template: OdmTemplate;
};

type PersistedOdmInspectionRecord = Record<string, unknown>;

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

function asNullableId(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || typeof value === "string") return value;
  return String(value);
}

function getRecordDateText(record: OdmInspectionRecord | PersistedOdmInspectionRecord) {
  return (
    asNullableText(record.date) ??
    asNullableText(record.inspectionDate) ??
    asNullableText(record.inspection_date) ??
    asNullableText(record.submittedAt) ??
    asNullableText(record.submitted_at)
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

export function getOdmFacilityScope(value?: string | null) {
  const facility = asNullableText(value);
  return facility && facility !== ALL_FACILITIES_LABEL
    ? facility
    : ALL_FACILITIES_LABEL;
}

export function buildOdmInspectionsUrl(
  filters?: Partial<OdmInspectionsRequest>
) {
  const params = new URLSearchParams();
  const reportingYear = filters?.reportingYear;
  const reportingMonth = filters?.reportingMonth;
  if (Number.isInteger(reportingYear)) {
    params.set("reporting_year", String(reportingYear));
  }
  if (Number.isInteger(reportingMonth)) {
    params.set("reporting_month", String(reportingMonth));
  }
  const facility = getOdmFacilityScope(filters?.facility);
  if (facility !== ALL_FACILITIES_LABEL) {
    params.set("facility_id", facility);
  }
  const query = params.toString();
  return query
    ? `/api/operator-driven-maintenance/inspections?${query}`
    : "/api/operator-driven-maintenance/inspections";
}

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

async function fetchOdmInspections(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    records?: PersistedOdmInspectionRecord[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(
      payload.error
        ? `Unable to load Operator-Driven Maintenance records: ${payload.error}`
        : "Unable to load Operator-Driven Maintenance records."
    );
  }
  return Array.isArray(payload.records) ? payload.records : [];
}

export async function getAvailableOdmScorecardOptions(): Promise<OdmAvailableOptions> {
  const records = await fetchOdmInspections(buildOdmInspectionsUrl());
  const years = Array.from(
    new Set(
      records
        .map(getOdmInspectionDateParts)
        .map(parts => parts?.year)
        .filter((value): value is number => Number.isInteger(value))
    )
  ).sort((a, b) => b - a);
  const months = Array.from(
    new Set(
      records
        .map(getOdmInspectionDateParts)
        .map(parts => parts?.month)
        .filter(
          (value): value is number =>
            Number.isInteger(value) && value >= 1 && value <= 12
        )
    )
  ).sort((a, b) => b - a);
  const facilities = Array.from(
    new Set(
      records
        .map(record => asNullableText(record.facility_id ?? record.facilityId))
        .filter((value): value is string => Boolean(value))
    )
  ).sort((a, b) => a.localeCompare(b));
  return { years, months, facilities };
}

export async function getPersistedOdmScorecard(
  request: OdmInspectionsRequest,
  template: OdmTemplate = ODM_EXECUTIVE_SUMMARY_TEMPLATE
): Promise<OdmScorecardDataset> {
  const records = await fetchOdmInspections(buildOdmInspectionsUrl(request));
  if (!records.length) {
    throw new Error(
      "No database records exist for the selected Operator-Driven Maintenance reporting period and facility."
    );
  }
  return {
    records: records.map(mapPersistedOdmInspectionRecord),
    reportingYear: request.reportingYear,
    reportingMonth: request.reportingMonth,
    reportingMonthLabel: getReportingPeriodLabel(
      request.reportingMonth,
      request.reportingYear
    ),
    facility: getOdmFacilityScope(request.facility),
    template,
  };
}
