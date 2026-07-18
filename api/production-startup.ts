/**
 * Dependencies for production startup
 */
export interface ProductionStartupDependencies {
  /** Runs database migrations */
  ensureDatabaseReady: () => Promise<void>;
  /** Verifies post-migration schema is accessible */
  verifyDatabase: () => Promise<void>;
  /** Starts the HTTP listener - may be async */
  startListener: () => Promise<void> | void;
}

/**
 * Executes production startup sequence.
 *
 * Sequence:
 * 1. Await database migration
 * 2. Await post-migration verification
 * 3. Start listener only after both succeed
 *
 * Any error (migration, verification, or listener) propagates to the caller.
 * The caller (boot.ts) handles error logging and process termination.
 */
export async function executeProductionStartup(
  deps: ProductionStartupDependencies
): Promise<void> {
  // Step 1: Run database migrations
  await deps.ensureDatabaseReady();

  // Step 2: Verify post-migration schema is accessible
  await deps.verifyDatabase();

  // Step 3: Start the HTTP listener only after successful migration and verification
  await deps.startListener();
}
