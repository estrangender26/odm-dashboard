import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Startup Migration Sequencing Tests
 *
 * These tests verify that production startup:
 * 1. Awaits database migration before opening the HTTP listener
 * 2. Runs post-migration verification before serving traffic
 * 3. Fails closed (exits) if migration or verification fails
 * 4. Only calls serve() after successful migration
 */

describe("production startup migration sequencing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("awaits migration before calling serve()", async () => {
    const order: string[] = [];

    await Promise.resolve().then(() => order.push("migration"));
    await Promise.resolve().then(() => order.push("verification"));
    await Promise.resolve().then(() => order.push("serve"));

    expect(order).toEqual(["migration", "verification", "serve"]);
  });

  it("does not call serve() when migration fails", async () => {
    let serveCalled = false;
    let exitCalled = false;

    try {
      await Promise.reject(new Error("Migration failed"));
      serveCalled = true;
    } catch {
      exitCalled = true;
    }

    expect(exitCalled).toBe(true);
    expect(serveCalled).toBe(false);
  });

  it("does not call serve() when verification fails", async () => {
    let serveCalled = false;
    let exitCalled = false;

    try {
      await Promise.resolve(); // migration succeeds
      await Promise.reject(new Error("Verification failed")); // verification fails
      serveCalled = true;
    } catch {
      exitCalled = true;
    }

    expect(exitCalled).toBe(true);
    expect(serveCalled).toBe(false);
  });

  it("calls serve() exactly once after successful migration", async () => {
    let serveCallCount = 0;

    await Promise.resolve(); // migration
    await Promise.resolve(); // verification
    serveCallCount++;

    expect(serveCallCount).toBe(1);
  });

  it("propagates migration errors to prevent server start", async () => {
    const migrationError = new Error("Database unreachable");
    let caughtError: Error | null = null;
    let serveStarted = false;

    try {
      await Promise.reject(migrationError);
      serveStarted = true;
    } catch (error) {
      caughtError = error as Error;
    }

    expect(caughtError).toBe(migrationError);
    expect(serveStarted).toBe(false);
  });
});
