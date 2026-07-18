import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { executeProductionStartup } from "./production-startup";

/**
 * Production Startup Migration Sequencing Tests
 *
 * Uses deferred promises to prove exact sequencing and blocking behavior.
 */

describe("executeProductionStartup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks listener while migration is pending", async () => {
    const { promise: migrationPromise, resolve: resolveMigration } = createDeferred<void>();
    const { promise: verificationPromise, resolve: resolveVerification } = createDeferred<void>();
    const { promise: listenerPromise, resolve: resolveListener } = createDeferred<void>();

    const deps = {
      ensureDatabaseReady: vi.fn().mockReturnValue(migrationPromise),
      verifyDatabase: vi.fn().mockReturnValue(verificationPromise),
      startListener: vi.fn().mockReturnValue(listenerPromise),
    };

    const startupPromise = executeProductionStartup(deps);

    // Migration is still pending - listener should not be called
    expect(deps.ensureDatabaseReady).toHaveBeenCalledTimes(1);
    expect(deps.verifyDatabase).not.toHaveBeenCalled();
    expect(deps.startListener).not.toHaveBeenCalled();

    resolveMigration();
    await tick();

    // Now verification is running
    expect(deps.verifyDatabase).toHaveBeenCalledTimes(1);
    expect(deps.startListener).not.toHaveBeenCalled();

    resolveVerification();
    await tick();

    // Now listener should be called
    expect(deps.startListener).toHaveBeenCalledTimes(1);

    resolveListener();
    await startupPromise;
  });

  it("blocks listener while verification is pending", async () => {
    const { promise: migrationPromise, resolve: resolveMigration } = createDeferred<void>();
    const { promise: verificationPromise, resolve: resolveVerification } = createDeferred<void>();

    const deps = {
      ensureDatabaseReady: vi.fn().mockReturnValue(migrationPromise),
      verifyDatabase: vi.fn().mockReturnValue(verificationPromise),
      startListener: vi.fn().mockResolvedValue(undefined),
    };

    const startupPromise = executeProductionStartup(deps);

    resolveMigration();
    await tick();

    // Verification is still pending - listener should not be called
    expect(deps.verifyDatabase).toHaveBeenCalledTimes(1);
    expect(deps.startListener).not.toHaveBeenCalled();

    resolveVerification();
    await startupPromise;

    // Now listener should be called
    expect(deps.startListener).toHaveBeenCalledTimes(1);
  });

  it("starts listener once after both migration and verification resolve", async () => {
    const deps = {
      ensureDatabaseReady: vi.fn().mockResolvedValue(undefined),
      verifyDatabase: vi.fn().mockResolvedValue(undefined),
      startListener: vi.fn().mockResolvedValue(undefined),
    };

    await executeProductionStartup(deps);

    expect(deps.startListener).toHaveBeenCalledTimes(1);
  });

  it("rejects with migration error when migration fails", async () => {
    const migrationError = new Error("Connection refused");

    const deps = {
      ensureDatabaseReady: vi.fn().mockRejectedValue(migrationError),
      verifyDatabase: vi.fn(),
      startListener: vi.fn(),
    };

    await expect(executeProductionStartup(deps)).rejects.toBe(migrationError);

    expect(deps.verifyDatabase).not.toHaveBeenCalled();
    expect(deps.startListener).not.toHaveBeenCalled();
  });

  it("rejects with verification error when verification fails", async () => {
    const verificationError = new Error("Table not found");

    const deps = {
      ensureDatabaseReady: vi.fn().mockResolvedValue(undefined),
      verifyDatabase: vi.fn().mockRejectedValue(verificationError),
      startListener: vi.fn(),
    };

    await expect(executeProductionStartup(deps)).rejects.toBe(verificationError);
    expect(deps.startListener).not.toHaveBeenCalled();
  });

  it("rejects with listener error when listener fails", async () => {
    const listenerError = new Error("Port already in use");

    const deps = {
      ensureDatabaseReady: vi.fn().mockResolvedValue(undefined),
      verifyDatabase: vi.fn().mockResolvedValue(undefined),
      startListener: vi.fn().mockRejectedValue(listenerError),
    };

    await expect(executeProductionStartup(deps)).rejects.toBe(listenerError);
  });

  it("calls dependencies in exact order: migration -> verification -> listener", async () => {
    const order: string[] = [];

    const deps = {
      ensureDatabaseReady: vi.fn().mockImplementation(async () => {
        order.push("migration");
      }),
      verifyDatabase: vi.fn().mockImplementation(async () => {
        order.push("verification");
      }),
      startListener: vi.fn().mockImplementation(async () => {
        order.push("listener");
      }),
    };

    await executeProductionStartup(deps);

    expect(order).toEqual(["migration", "verification", "listener"]);
  });

  it("calls every dependency exactly once", async () => {
    const deps = {
      ensureDatabaseReady: vi.fn().mockResolvedValue(undefined),
      verifyDatabase: vi.fn().mockResolvedValue(undefined),
      startListener: vi.fn().mockResolvedValue(undefined),
    };

    await executeProductionStartup(deps);

    expect(deps.ensureDatabaseReady).toHaveBeenCalledTimes(1);
    expect(deps.verifyDatabase).toHaveBeenCalledTimes(1);
    expect(deps.startListener).toHaveBeenCalledTimes(1);
  });
});

// Helper to create deferred promises for testing async sequencing
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

// Helper to yield control to the event loop
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
