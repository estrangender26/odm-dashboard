import { describe, expect, it } from "vitest";
import {
  assertDisposableTestDatabase,
  databaseNameFromUrl,
  resolveDisposableTestDatabaseUrl,
  runtimeResolvedDatabaseUrl,
} from "./disposable-test-db";

/**
 * These tests are pure (no database): they prove the safety boundary itself.
 *
 * The scenario they guard against is a fresh clone, where `.env.example`
 * provides DATABASE_URL and no DATABASE_URL_TEST, and a developer enables the
 * mutating Primavera integration suites.
 */

const DISPOSABLE = "postgresql://postgres:postgres@localhost:5433/primavera_test?sslmode=disable";
const PRODUCTION_LOOKING = "postgresql://odm_user:secret@prod-host.example.com/odm_production";

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...overrides } as NodeJS.ProcessEnv;
}

describe("disposable test database resolution — fail closed", () => {
  it("accepts an explicitly configured disposable database when the gate is on", () => {
    const url = resolveDisposableTestDatabaseUrl(
      env({ PRIMAVERA_PR1_TEST_DB: "1", DATABASE_URL_TEST: DISPOSABLE })
    );
    expect(url).toBe(DISPOSABLE);
  });

  it("requires PRIMAVERA_PR1_TEST_DB=1 (existing protection is preserved)", () => {
    expect(() => resolveDisposableTestDatabaseUrl(env({ DATABASE_URL_TEST: DISPOSABLE }))).toThrow(
      /PRIMAVERA_PR1_TEST_DB=1 is required/
    );
  });

  it("FRESH CLONE: refuses to run when DATABASE_URL_TEST is unset, even though DATABASE_URL is set", () => {
    // This is exactly the reviewer's scenario: .env.example supplies DATABASE_URL
    // and no DATABASE_URL_TEST. The guard must not validate the hardcoded local
    // database while the router connects to DATABASE_URL.
    const freshClone = env({ PRIMAVERA_PR1_TEST_DB: "1", DATABASE_URL: PRODUCTION_LOOKING });
    expect(() => resolveDisposableTestDatabaseUrl(freshClone)).toThrow(/DATABASE_URL_TEST is required/);
    expect(() => assertDisposableTestDatabase(freshClone)).toThrow(/refusing to fall back/i);
  });

  it("FRESH CLONE: cannot guard one database while the router executes against another", () => {
    // Proof that the two resolutions can no longer diverge: with DATABASE_URL_TEST
    // unset the guard throws, so no mutation is possible; with it set, the runtime
    // resolves the very same string the guard validated.
    const split = env({ PRIMAVERA_PR1_TEST_DB: "1", DATABASE_URL: PRODUCTION_LOOKING });
    let guarded: string | null = null;
    let threw = false;
    try {
      guarded = resolveDisposableTestDatabaseUrl(split);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(guarded).toBeNull();
    // The runtime WOULD have gone to the production-looking database, which is why
    // the explicit DATABASE_URL_TEST requirement matters.
    expect(runtimeResolvedDatabaseUrl(split)).toBe(PRODUCTION_LOOKING);

    // And with DATABASE_URL_TEST set, guard and runtime agree byte for byte.
    const safe = env({
      PRIMAVERA_PR1_TEST_DB: "1",
      DATABASE_URL_TEST: DISPOSABLE,
      DATABASE_URL: PRODUCTION_LOOKING,
    });
    expect(resolveDisposableTestDatabaseUrl(safe)).toBe(runtimeResolvedDatabaseUrl(safe));
  });

  it("refuses a non-disposable database name even when the gate is on", () => {
    for (const bad of [
      PRODUCTION_LOOKING,
      "postgresql://postgres:postgres@localhost:5433/odm_production",
      "postgresql://postgres:postgres@localhost:5432/postgres",
      "postgresql://postgres:postgres@localhost:5433/primavera_prod_clone",
    ]) {
      expect(() =>
        resolveDisposableTestDatabaseUrl(env({ PRIMAVERA_PR1_TEST_DB: "1", DATABASE_URL_TEST: bad }))
      ).toThrow(/non-disposable database/);
    }
  });

  it("accepts every disposable database-name family the suites use", () => {
    for (const name of ["primavera_test", "primavera_test_ui", "odmtest_pr3", "odmtest_pr6"]) {
      const url = `postgresql://postgres:postgres@localhost:5433/${name}?sslmode=disable`;
      expect(resolveDisposableTestDatabaseUrl(env({ PRIMAVERA_PR1_TEST_DB: "1", DATABASE_URL_TEST: url }))).toBe(url);
    }
  });

  it("refuses an unparsable DATABASE_URL_TEST and blank values", () => {
    expect(() =>
      resolveDisposableTestDatabaseUrl(env({ PRIMAVERA_PR1_TEST_DB: "1", DATABASE_URL_TEST: "not-a-url" }))
    ).toThrow(/non-disposable database|unparsable/);
    expect(() =>
      resolveDisposableTestDatabaseUrl(env({ PRIMAVERA_PR1_TEST_DB: "1", DATABASE_URL_TEST: "   " }))
    ).toThrow(/DATABASE_URL_TEST is required/);
  });

  it("never mutates the environment it inspects", () => {
    const e = env({ PRIMAVERA_PR1_TEST_DB: "1", DATABASE_URL_TEST: DISPOSABLE });
    resolveDisposableTestDatabaseUrl(e);
    expect(e.DATABASE_URL_TEST).toBe(DISPOSABLE);
    expect(e.PRIMAVERA_PR1_TEST_DB).toBe("1");
  });

  it("extracts the database name only from a parseable URL", () => {
    expect(databaseNameFromUrl(DISPOSABLE)).toBe("primavera_test");
    expect(databaseNameFromUrl("postgresql://h:5432/odmtest_pr5")).toBe("odmtest_pr5");
    expect(databaseNameFromUrl("nonsense")).toBe("");
  });
});
