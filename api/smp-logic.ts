import { and, eq, ilike, not, or, sql, type SQL } from "drizzle-orm";
import { smpDocuments, smpDocumentRevisions } from "@db/schema";

/**
 * Pure SMP controlled-document logic, kept free of database connections so it
 * can be unit-tested without a live database.
 */

export const SMP_REVISION_LABEL_MAX_LENGTH = 50;
export const DEFAULT_SMP_REVISION_LABEL = "Rev. 0";
export const SMP_CODE_MAX_LENGTH = 50;

/**
 * Normalizes a reference number for identity comparison. The canonical
 * reference-number identity is case- and whitespace-insensitive
 * (lower(trim(code))), matching the database `code_key` maintained by the
 * migration 0034 trigger and unique index.
 */
export function normalizeSmpCodeKey(code: string): string {
  return String(code ?? "").trim().toLowerCase().slice(0, SMP_CODE_MAX_LENGTH);
}

/**
 * Normalizes a user-supplied revision label. Absent/empty values fall back to
 * the baseline label ("Rev. 0"); the result is trimmed and length-capped.
 */
export function normalizeSmpRevisionLabel(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return DEFAULT_SMP_REVISION_LABEL;
  return value.slice(0, SMP_REVISION_LABEL_MAX_LENGTH);
}

/**
 * Parses the trailing integer of a revision label for ordering.
 * "Rev. 0" -> 0, "Rev. 1" -> 1, "Revision 10" -> 10, unknown -> 0.
 */
export function parseSmpRevisionNumber(label: string): number {
  const match = /(\d+)\s*$/.exec(String(label ?? "").trim());
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Revision labels must be unique per document series: uploading a revision
 * label that already exists would silently overwrite history. Comparison is
 * case-insensitive ("rev. 1" collides with "Rev. 1"). Returns an error
 * message when the label is already present, otherwise null.
 */
export function validateSmpRevisionUnique(
  existingLabels: ReadonlyArray<string>,
  incomingLabel: string,
): string | null {
  const normalized = normalizeSmpRevisionLabel(incomingLabel);
  const key = normalized.toLowerCase();
  const exists = existingLabels.some(
    (label) => normalizeSmpRevisionLabel(label).toLowerCase() === key,
  );
  return exists ? `SMP revision "${normalized}" already exists for this document.` : null;
}

/**
 * Builds the drizzle WHERE condition for the SMP library list.
 * Search covers reference number, SMP ID, title, family, asset name/type,
 * equipment type, and facility type. Filters match exactly.
 */
export type SmpListInput = {
  search?: string;
  family?: string;
  equipmentType?: string;
  facilityType?: string;
  criticality?: string;
  revision?: string;
  status?: string;
};

/** Columns included in free-text search (reference, identity, classification). */
export const SMP_SEARCHABLE_COLUMNS = [
  smpDocuments.code,
  smpDocuments.smpId,
  smpDocuments.title,
  smpDocuments.smpFamily,
  smpDocuments.assetName,
  smpDocuments.assetType,
  smpDocuments.equipmentType,
  smpDocuments.facilityType,
] as const;

export const SMP_SEARCHABLE_COLUMN_NAMES = SMP_SEARCHABLE_COLUMNS.map((column) => column.name);

/** Exact-match filter fields supported by the library list. */
export const SMP_FILTERABLE_FIELDS = [
  "family",
  "equipmentType",
  "facilityType",
  "criticality",
  "revision",
  "status",
] as const;

/** Controlled-document lifecycle statuses understood by the status filter. */
export const SMP_LIFECYCLE_STATUSES = ["current", "superseded"] as const;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Extracts the normalized, non-empty criteria from list input. Pure and
 * directly unit-testable without SQL serialization.
 */
export function getSmpListCriteria(input: SmpListInput): {
  search?: string;
  family?: string;
  equipmentType?: string;
  facilityType?: string;
  criticality?: string;
  revision?: string;
  status?: string;
} {
  const criteria: Record<string, string | undefined> = {};
  if (input.search?.trim()) criteria.search = input.search.trim();
  if (input.family?.trim()) criteria.family = input.family.trim();
  if (input.equipmentType?.trim()) criteria.equipmentType = input.equipmentType.trim();
  if (input.facilityType?.trim()) criteria.facilityType = input.facilityType.trim();
  if (input.criticality?.trim()) criteria.criticality = input.criticality.trim();
  if (input.revision?.trim()) criteria.revision = input.revision.trim();
  if (input.status?.trim()) criteria.status = input.status.trim();
  return criteria;
}

export function buildSmpListWhere(input: SmpListInput): SQL | undefined {
  const criteria = getSmpListCriteria(input);
  const conditions: SQL[] = [];

  if (criteria.search) {
    const q = `%${escapeLike(criteria.search)}%`;
    const orClause = or(...SMP_SEARCHABLE_COLUMNS.map((column) => ilike(column, q)));
    if (orClause) conditions.push(orClause);
  }
  if (criteria.family) conditions.push(eq(smpDocuments.smpFamily, criteria.family));
  if (criteria.equipmentType) conditions.push(eq(smpDocuments.equipmentType, criteria.equipmentType));
  if (criteria.facilityType) conditions.push(eq(smpDocuments.facilityType, criteria.facilityType));
  if (criteria.criticality) conditions.push(eq(smpDocuments.criticality, criteria.criticality));
  if (criteria.revision) conditions.push(eq(smpDocuments.revision, criteria.revision));
  if (criteria.status) {
    if (criteria.status === "current") {
      // Current/active: an Active legacy series or any document with a
      // current revision.
      const orClause = or(
        eq(smpDocuments.status, "Active"),
        currentRevisionExists(),
      );
      if (orClause) conditions.push(orClause);
    } else if (criteria.status === "superseded") {
      // Superseded/archive: at least one revision but no current one.
      conditions.push(and(anyRevisionExists(), not(currentRevisionExists()))!);
    } else {
      conditions.push(eq(smpDocuments.status, criteria.status));
    }
  }

  return conditions.length ? and(...conditions) : undefined;
}

/** True when the status filter value is a controlled-document lifecycle state. */
export function isSmpLifecycleStatus(status: string): boolean {
  return (SMP_LIFECYCLE_STATUSES as readonly string[]).includes(status);
}

export type SmpRevisionSummary = {
  id: number;
  revision: string;
  revisionNumber: number;
  status: string;
};

/**
 * Resolves which previous current revision ids get backfilled to point at the
 * newly inserted revision. The ids come from a pre-insert capture, and the
 * new revision's id is defensively excluded: the new revision can never be
 * its own predecessor (no self-supersession).
 */
export function resolveSupersessionBackfill(
  previousCurrentIds: ReadonlyArray<number>,
  newRevisionId: number,
): number[] {
  return [...new Set(previousCurrentIds)].filter((id) => id !== newRevisionId);
}

/**
 * Resolves which revision's structured procedure data a detail request must
 * show. A requested revision must belong to the document (returns null when
 * it does not); otherwise the CURRENT revision is used, falling back to the
 * latest revision when no revision is current. Returns null for legacy
 * documents without revision rows. This guarantees that content from one
 * revision is never mixed with another: the resolved id scopes every
 * smp_sections / smp_tasks query.
 */
export function resolveSmpDetailRevision(
  revisions: ReadonlyArray<SmpRevisionSummary>,
  requestedRevisionId?: number,
): SmpRevisionSummary | null {
  if (requestedRevisionId != null) {
    return revisions.find((r) => r.id === requestedRevisionId) ?? null;
  }
  return revisions.find((r) => r.status === "current")
    ?? (revisions.length > 0 ? revisions[0] : null);
}

function currentRevisionExists(): SQL {
  return sql`EXISTS (SELECT 1 FROM ${smpDocumentRevisions} WHERE ${smpDocumentRevisions.documentId} = ${smpDocuments.id} AND ${smpDocumentRevisions.status} = 'current')`;
}

function anyRevisionExists(): SQL {
  return sql`EXISTS (SELECT 1 FROM ${smpDocumentRevisions} WHERE ${smpDocumentRevisions.documentId} = ${smpDocuments.id})`;
}
