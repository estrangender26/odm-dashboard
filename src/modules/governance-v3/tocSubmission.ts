/**
 * Canonical TOC submission counting utilities (pure, no DB dependency)
 *
 * Single source of truth for how a facility's uploads become visible
 * checkmarks on the Governance TOC matrix.
 *
 * Rules:
 * 1. Only uploads whose normalized TOC item is in GOVERNANCE_TOC_ITEMS count.
 * 2. Uploads with category "OTHER" or "references" are supplementary and
 *    are always excluded from readiness calculations.
 * 3. Multiple uploads for the same facility + normalized TOC item count once
 *    (distinct deliverable, not raw file count).
 */

import { GOVERNANCE_TOC_ITEMS } from "./theme";

export interface UploadLike {
  facilitySlug: string;
  tocItem: string | null;
  category: string;
  fileName: string;
}

/**
 * Normalize a raw TOC identifier from the database to the format used by
 * GOVERNANCE_TOC_ITEMS.
 *
 * Examples:
 *   "TOC-08" -> "8"
 *   "toc-12" -> "12"
 *   "A7"     -> "7"
 *   "1A"     -> "1A"  (kept as-is)
 *   null/empty -> null
 */
export function normalizeTocIdentifier(rawToc: string | null): string | null {
  if (!rawToc) return null;

  let normalized = rawToc.replace(/^TOC-/i, "");
  normalized = normalized.replace(/^0+(\d)/, "$1");

  if (/^[A-Za-z]\d+$/.test(normalized)) {
    const match = normalized.match(/\d+/);
    if (match) normalized = match[0];
  }

  return normalized;
}

/**
 * Determine whether an upload is supplementary and should be excluded from
 * TOC readiness counts.
 */
export function isSupplementaryUpload(category: string, tocItem: string | null): boolean {
  if (category === "OTHER" || category === "references") return true;
  const normalized = normalizeTocIdentifier(tocItem);
  return !normalized || !GOVERNANCE_TOC_ITEMS.includes(normalized as any);
}

/**
 * Return the set of distinct normalized TOC items for a facility that should
 * appear as matrix checkmarks, plus per-item document counts (for display).
 */
export function calculateFacilityTocSubmissions(
  facilitySlug: string,
  uploads: UploadLike[]
): { submittedTocIds: Set<string>; documentCounts: Map<string, number> } {
  const submittedTocIds = new Set<string>();
  const documentCounts = new Map<string, number>();

  for (const upload of uploads) {
    if (upload.facilitySlug !== facilitySlug) continue;
    if (isSupplementaryUpload(upload.category, upload.tocItem)) continue;

    const normalizedToc = normalizeTocIdentifier(upload.tocItem)!;
    submittedTocIds.add(normalizedToc);
    documentCounts.set(normalizedToc, (documentCounts.get(normalizedToc) || 0) + 1);
  }

  return { submittedTocIds, documentCounts };
}

/**
 * Canonical portfolio submitted count from the visible matrix:
 * sum of all facility checkmarks.
 *
 * This must equal summary.totalDocumentsSubmitted and the executive summary.
 */
export function calculatePortfolioSubmittedFromDocumentations(
  facilityDocumentations: { submissions: { submitted: boolean }[] }[]
): number {
  return facilityDocumentations.reduce(
    (sum, doc) => sum + doc.submissions.filter((s) => s.submitted).length,
    0
  );
}
