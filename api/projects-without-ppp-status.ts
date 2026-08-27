/**
 * Projects without PPP — masterdata submission status derivation.
 *
 * Status is DERIVED from actual successfully finalized current submission
 * evidence (rows in project_without_ppp_files with superseded_at IS NULL).
 * There is no manually editable status column anywhere: removing the only
 * active submission evidence (safe superseding) derives a project back to
 * Not Submitted automatically.
 */

export const MASTERDATA_SUBMISSION_STATUSES = ["submitted", "not_submitted"] as const;
export type MasterdataSubmissionStatus = (typeof MASTERDATA_SUBMISSION_STATUSES)[number];

export function deriveProjectSubmissionStatus(
  currentFileCount: number,
): MasterdataSubmissionStatus {
  return currentFileCount > 0 ? "submitted" : "not_submitted";
}

export type SubmissionAggregates = {
  totalProjects: number;
  submitted: number;
  notSubmitted: number;
  /** Submission Rate % = submitted projects / total projects × 100 */
  submissionRate: number;
};

export function computeSubmissionAggregates(
  statuses: MasterdataSubmissionStatus[],
  totalProjects = statuses.length,
): SubmissionAggregates {
  const submitted = statuses.filter((s) => s === "submitted").length;
  const notSubmitted = statuses.length - submitted;
  const submissionRate =
    totalProjects > 0 ? Math.round((submitted / totalProjects) * 100) : 0;
  return { totalProjects, submitted, notSubmitted, submissionRate };
}

/**
 * Count of distinct projects that have at least one current submission file
 * submitted within the given window (used for Submitted Today / This Week KPIs).
 * KPI counts projects, not uploaded files.
 */
export function countDistinctProjectsSubmittedInWindow(
  rows: Array<{ projectId: number; submittedAt: Date | null }>,
  windowStart: Date,
  now: Date = new Date(),
): number {
  const seen = new Set<number>();
  for (const row of rows) {
    if (!row.submittedAt) continue;
    const at = new Date(row.submittedAt).getTime();
    if (at >= windowStart.getTime() && at <= now.getTime()) {
      seen.add(row.projectId);
    }
  }
  return seen.size;
}

export function startOfUtcDay(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function startOfUtcWeek(now: Date = new Date()): Date {
  const d = startOfUtcDay(now);
  // Monday-based ISO week: move back to the most recent Monday.
  const day = d.getUTCDay(); // 0 = Sunday
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d;
}
