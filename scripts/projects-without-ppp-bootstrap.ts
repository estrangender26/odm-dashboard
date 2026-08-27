/**
 * Projects without PPP — authoritative OWNER-data bootstrap CLI.
 *
 * Usage (explicit execution command; NOT a casual normal-user seed action):
 *   npm run projects-without-ppp:bootstrap               # apply
 *   npm run projects-without-ppp:bootstrap -- --dry-run  # preview only
 *
 * Dry-run reports: expected source records (50), valid, duplicate Tracking
 * IDs, inserts, updates, unchanged, invalid. Repeated execution is idempotent
 * and never deletes submission/file history.
 */
import "dotenv/config";
import { runProjectsWithoutPPPBootstrap, formatBootstrapReport } from "../api/projects-without-ppp-bootstrap";
import { getDb } from "../api/queries/connection";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) {
    console.log("[bootstrap] dry-run mode — no changes will be written.");
  }

  const database = getDb();
  try {
    const report = await runProjectsWithoutPPPBootstrap(database, { dryRun });
    console.log(formatBootstrapReport(report));
    if (report.duplicateTrackingIds.length > 0) {
      console.error(
        `[bootstrap] FAILED: duplicate Tracking IDs in the authoritative fixture: ${report.duplicateTrackingIds.join(", ")}`,
      );
      process.exitCode = 1;
      return;
    }
    if (report.invalid > 0) {
      console.error(`[bootstrap] FAILED: ${report.invalid} invalid fixture records.`);
      process.exitCode = 1;
      return;
    }
    console.log("[bootstrap] OK — authoritative fixture invariants satisfied.");
  } finally {
    // The process exits immediately after; no explicit client teardown needed.
  }
}

main().catch((error) => {
  console.error("[bootstrap] failed:", error?.message ?? error);
  process.exit(1);
});
