/**
 * Projects without PPP — authoritative OWNER-data bootstrap loader.
 *
 * Deterministic and idempotent: upserts the 50 authoritative Projects without
 * PPP by Tracking ID (stable external identity). Repeated execution never
 * duplicates projects, and reference-metadata updates never delete submission
 * or file history (the loader only ever touches projects_without_ppp rows).
 *
 * Supports dry-run/preview mode and explicit execution only — it is NOT
 * exposed as a casual normal-user seed action.
 */
import { eq, sql } from "drizzle-orm";
import {
  PROJECTS_WITHOUT_PPP_FIXTURE,
  assertAuthoritativeProjectFixture,
} from "@db/fixtures/projects-without-ppp";
import type { AuthoritativeProjectWithoutPPP } from "@db/fixtures/projects-without-ppp";
import { projectsWithoutPPP } from "@db/schema";
import type { DrizzleDB } from "./queries/connection";

export type ProjectsWithoutPPPBootstrapReport = {
  mode: "dry-run" | "apply";
  expectedSourceRecords: number;
  valid: number;
  invalid: number;
  duplicateTrackingIds: string[];
  inserts: number;
  updates: number;
  unchanged: number;
};

const REFERENCE_FIELDS: (keyof AuthoritativeProjectWithoutPPP)[] = [
  "psCode",
  "codingMask",
  "projectPhase",
  "latestMilestone",
  "pmHeadline",
  "projectName",
  "workPackage",
  "contractPackage",
  "contractor",
  "majorProjectTag",
  "constructionManager",
  "projectManager",
  "withLSPs",
  "amdGridHead",
];

function toDbRow(record: AuthoritativeProjectWithoutPPP) {
  return {
    trackingId: record.trackingId,
    psCode: record.psCode,
    codingMask: record.codingMask,
    projectPhase: record.projectPhase,
    latestMilestone: record.latestMilestone,
    pmHeadline: record.pmHeadline,
    projectName: record.projectName,
    workPackage: record.workPackage,
    contractPackage: record.contractPackage,
    contractor: record.contractor,
    majorProjectTag: record.majorProjectTag,
    constructionManager: record.constructionManager,
    projectManager: record.projectManager,
    withLSPs: record.withLSPs,
    amdGridHead: record.amdGridHead,
  };
}

function referenceValuesChanged(
  existing: Record<string, unknown>,
  record: AuthoritativeProjectWithoutPPP,
): boolean {
  const row = toDbRow(record);
  return REFERENCE_FIELDS.some((field) => {
    const current = existing[field];
    const next = row[field];
    return String(current ?? null) !== String(next ?? null);
  });
}

export async function runProjectsWithoutPPPBootstrap(
  database: DrizzleDB,
  options: { dryRun?: boolean } = {},
): Promise<ProjectsWithoutPPPBootstrapReport> {
  const dryRun = options.dryRun !== false;
  const mode = dryRun ? "dry-run" : "apply";

  // Hard programmatic invariant: the embedded dataset must be exactly 50
  // records with 50 unique Tracking IDs. Any disagreement aborts the run.
  const { recordCount, uniqueTrackingIds } = assertAuthoritativeProjectFixture();

  const existing = await database
    .select({ trackingId: projectsWithoutPPP.trackingId })
    .from(projectsWithoutPPP);
  const existingByTrackingId = new Map(existing.map((row) => [row.trackingId, row]));

  const trackingIds = PROJECTS_WITHOUT_PPP_FIXTURE.map((r) => r.trackingId);
  const seen = new Set<string>();
  const duplicateTrackingIds = trackingIds.filter((id) => {
    if (seen.has(id)) return true;
    seen.add(id);
    return false;
  });

  let inserts = 0;
  let updates = 0;
  let unchanged = 0;

  for (const record of PROJECTS_WITHOUT_PPP_FIXTURE) {
    const current = existingByTrackingId.get(record.trackingId);
    if (!current) {
      inserts += 1;
      if (!dryRun) {
        await database.insert(projectsWithoutPPP).values(toDbRow(record));
      }
      continue;
    }

    const existingRow = await database
      .select()
      .from(projectsWithoutPPP)
      .where(eq(projectsWithoutPPP.trackingId, record.trackingId))
      .limit(1);
    const existingRecord = existingRow[0];
    if (existingRecord && referenceValuesChanged(existingRecord, record)) {
      updates += 1;
      if (!dryRun) {
        await database
          .update(projectsWithoutPPP)
          .set({ ...toDbRow(record), updatedAt: sql`now()` })
          .where(eq(projectsWithoutPPP.trackingId, record.trackingId));
      }
    } else {
      unchanged += 1;
    }
  }

  return {
    mode,
    expectedSourceRecords: recordCount,
    valid: uniqueTrackingIds,
    invalid: recordCount - uniqueTrackingIds,
    duplicateTrackingIds,
    inserts,
    updates,
    unchanged,
  };
}

export function formatBootstrapReport(report: ProjectsWithoutPPPBootstrapReport): string {
  return [
    `Projects without PPP bootstrap (${report.mode})`,
    `  expected source records : ${report.expectedSourceRecords}`,
    `  valid                   : ${report.valid}`,
    `  invalid                 : ${report.invalid}`,
    `  duplicate Tracking IDs  : ${report.duplicateTrackingIds.length > 0 ? report.duplicateTrackingIds.join(", ") : "none"}`,
    `  inserts                 : ${report.inserts}`,
    `  updates                 : ${report.updates}`,
    `  unchanged               : ${report.unchanged}`,
  ].join("\n");
}
