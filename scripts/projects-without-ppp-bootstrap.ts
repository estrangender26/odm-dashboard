/**
 * Projects without PPP — authoritative OWNER-data bootstrap CLI.
 *
 * SAFE BY DEFAULT: the command never mutates unless --apply is passed.
 *
 * Usage:
 *   npm run projects-without-ppp:bootstrap                  # dry-run only
 *   npm run projects-without-ppp:bootstrap:apply            # --apply (mutates)
 *   npm run projects-without-ppp:bootstrap -- --apply       # equivalent
 *
 * Dry-run reports: expected source records (50), valid, duplicate Tracking
 * IDs, inserts, updates, unchanged, invalid. Apply runs in ONE transaction and
 * is idempotent; it never deletes submission/file history. The target database
 * fingerprint is printed before any mutation (credentials are never exposed).
 */
import "dotenv/config";
import { runProjectsWithoutPPPBootstrap, formatBootstrapReport } from "../api/projects-without-ppp-bootstrap";
import { getConnectionFingerprint, getDatabaseUrl, getDb } from "../api/queries/connection";

async function main() {
  // Explicit apply mode is the ONLY way to mutate; bare invocation is dry-run.
  const apply = process.argv.includes("--apply");
  const dryRun = !apply;

  if (dryRun) {
    console.log("[bootstrap] DRY-RUN mode — no changes will be written. Pass --apply to execute.");
  } else {
    console.log(
      `[bootstrap] APPLY mode — target database: ${getConnectionFingerprint(getDatabaseUrl())}`,
    );
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
    console.log(
      dryRun
        ? "[bootstrap] OK — authoritative fixture invariants satisfied (dry-run; nothing written)."
        : "[bootstrap] OK — authoritative fixture applied in a single transaction.",
    );
  } finally {
    // The process exits immediately after; no explicit client teardown needed.
  }
}

main().catch((error) => {
  console.error("[bootstrap] failed:", error?.message ?? error);
  process.exit(1);
});
