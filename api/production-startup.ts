import type { sql } from "drizzle-orm";

/**
 * Dependencies for production startup
 */
export interface ProductionStartupDependencies {
  /** Runs database migrations */
  ensureDatabaseReady: () => Promise<void>;
  /** Verifies post-migration schema is accessible */
  verifyDatabase: () => Promise<void>;
  /** Starts the HTTP listener */
  startListener: () => void;
  /** Logs boot stage messages */
  logBootStage?: (message: string, details?: Record<string, unknown>) => void;
  /** Logs boot errors */
  logBootError?: (stage: string, error: unknown) => void;
}

/**
 * Executes production startup sequence with fail-closed behavior.
 *
 * Sequence:
 * 1. Await database migration
 * 2. Await post-migration verification
 * 3. Start listener only if both succeed
 *
 * If migration or verification fails:
 * - Error is logged
 * - process.exit(1) is called
 * - Listener is never started
 *
 * This prevents serving traffic before the schema is verified.
 */
export async function executeProductionStartup(
  deps: ProductionStartupDependencies
): Promise<void> {
  const logStage = deps.logBootStage ?? ((msg: string) => console.log(msg));
  const logError = deps.logBootError ?? ((stage: string, err: unknown) =>
    console.error(`[${stage}]`, err)
  );

  try {
    logStage("migration start");
    await deps.ensureDatabaseReady();
    logStage("migration finish");

    logStage("post-migration verification start");
    await deps.verifyDatabase();
    logStage("post-migration verification finish");

    // Only start listener after successful migration and verification
    deps.startListener();
  } catch (error) {
    logError("migration/startup verification failed", error);
    // Exit without starting the server; Render will mark deployment as failed
    process.exit(1);
  }
}
