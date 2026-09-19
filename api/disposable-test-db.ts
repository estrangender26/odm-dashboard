/**
 * TEST-ONLY infrastructure — the ONE authoritative disposable-test database
 * resolution for the Primavera Lite mutating integration suites.
 *
 * NEVER import this module from production code.
 *
 * Why this exists
 * ---------------
 * Each Primavera integration suite used to resolve its own observer/cleanup URL
 * as `process.env.DATABASE_URL_TEST || "<hardcoded localhost>"`, while the
 * runtime under test (`api/queries/connection.ts`) resolves
 * `process.env.DATABASE_URL_TEST || process.env.DATABASE_URL`. With
 * DATABASE_URL_TEST unset those two disagree: the guard validated the hardcoded
 * local database while the production router inside the test connected to
 * DATABASE_URL. In that misconfiguration the mutating tests would create and
 * delete projects, activities, baselines and audit events in a database the
 * guard never inspected — the exact failure the guard exists to prevent.
 *
 * The rule (fail closed, applied before any mutation)
 * --------------------------------------------------
 *   1. `PRIMAVERA_PR1_TEST_DB=1` must be set. (Existing protection, unchanged.)
 *   2. `DATABASE_URL_TEST` must be set EXPLICITLY. There is NO fallback: a
 *      mutating integration suite must never inherit a normal `DATABASE_URL`.
 *   3. The database name must start with `primavera_test` or `odmtest`.
 *   4. The resolved URL must be byte-identical to the URL the runtime resolves,
 *      so the guard, the router under test, the observer connection and the
 *      cleanup connection provably share ONE database.
 *
 * Because the runtime prefers `DATABASE_URL_TEST` over `DATABASE_URL`, rule 2
 * makes rule 4 true by construction — and it is asserted rather than assumed.
 */

const DISPOSABLE_DB_NAME_PATTERN = /^(primavera_test|odmtest)/;

export const DISPOSABLE_TEST_DB_REQUIREMENT =
  "Primavera mutating integration tests require a DISPOSABLE database: set " +
  "PRIMAVERA_PR1_TEST_DB=1 and DATABASE_URL_TEST to a disposable database whose " +
  "name starts with \"primavera_test\" or \"odmtest\" (see .env.example).";

/** Database name from a connection URL, or "" when it cannot be parsed. */
export function databaseNameFromUrl(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
}

/**
 * The URL the runtime itself would connect to, resolved exactly the way
 * `api/queries/connection.ts` resolves it. Read-only mirror of that rule: it
 * exists so the test infrastructure can PROVE it is pointing at the same
 * database the router will use, and it never changes production behaviour.
 */
export function runtimeResolvedDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  return env.DATABASE_URL_TEST || env.DATABASE_URL;
}

/**
 * Resolve the disposable test database, or throw before anything can mutate.
 *
 * Throws when the disposable-test configuration is missing, ambiguous,
 * inconsistent or unsafe — including the fresh-clone case where `.env.example`
 * supplies only `DATABASE_URL` and no `DATABASE_URL_TEST`.
 */
export function resolveDisposableTestDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string {
  if (env.PRIMAVERA_PR1_TEST_DB !== "1") {
    throw new Error(`PRIMAVERA_PR1_TEST_DB=1 is required to run these tests. ${DISPOSABLE_TEST_DB_REQUIREMENT}`);
  }

  const configured = env.DATABASE_URL_TEST?.trim();
  if (!configured) {
    // Fail closed: never silently fall back to DATABASE_URL for a mutating suite.
    throw new Error(
      `DATABASE_URL_TEST is required and must be set explicitly to a disposable database ` +
        `(refusing to fall back to DATABASE_URL, which may not be disposable). ${DISPOSABLE_TEST_DB_REQUIREMENT}`
    );
  }

  const dbName = databaseNameFromUrl(configured);
  if (!DISPOSABLE_DB_NAME_PATTERN.test(dbName)) {
    throw new Error(
      `Refusing to run tests against non-disposable database: ${dbName || "<unparsable DATABASE_URL_TEST>"}. ` +
        DISPOSABLE_TEST_DB_REQUIREMENT
    );
  }

  // Prove the guard and the router under test cannot point at different databases.
  const runtimeUrl = runtimeResolvedDatabaseUrl(env);
  if (runtimeUrl !== configured) {
    throw new Error(
      "Refusing to run tests: the runtime under test would connect to a different database than the one " +
        `the guard validated. ${DISPOSABLE_TEST_DB_REQUIREMENT}`
    );
  }

  return configured;
}

/** Throwing assertion form, for suites that only need the fail-closed check. */
export function assertDisposableTestDatabase(env: NodeJS.ProcessEnv = process.env): void {
  resolveDisposableTestDatabaseUrl(env);
}
