import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { executeProductionStartup } from "./production-startup";

/**
 * Production Startup Migration Sequencing Tests
 *
 * These tests verify that executeProductionStartup:
 * 1. Awaits database migration before opening the HTTP listener
 * 2. Runs post-migration verification before serving traffic
 * 3. Fails closed (exits) if migration or verification fails
 * 4. Only calls startListener() after successful migration
 */

describe("executeProductionStartup", () => {
  const mockExit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock process.exit to prevent actual exit during tests
    vi.spyOn(process, "exit").mockImplementation(mockExit as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls dependencies in correct order: migration, verification, listener", async () => {
    const order: string[] = [];

    const deps = {
      ensureDatabaseReady: vi.fn().mockImplementation(async () => {
        order.push("migration");
      }),
      verifyDatabase: vi.fn().mockImplementation(async () => {
        order.push("verification");
      }),
      startListener: vi.fn().mockImplementation(() => {
        order.push("listener");
      }),
      logBootStage: vi.fn(),
      logBootError: vi.fn(),
    };

    await executeProductionStartup(deps);

    expect(order).toEqual(["migration", "verification", "listener"]);
    expect(deps.ensureDatabaseReady).toHaveBeenCalledTimes(1);
    expect(deps.verifyDatabase).toHaveBeenCalledTimes(1);
    expect(deps.startListener).toHaveBeenCalledTimes(1);
  });

  it("does not call startListener when migration fails", async () => {
    const migrationError = new Error("Connection refused");

    const deps = {
      ensureDatabaseReady: vi.fn().mockRejectedValue(migrationError),
      verifyDatabase: vi.fn(),
      startListener: vi.fn(),
      logBootStage: vi.fn(),
      logBootError: vi.fn(),
    };

    // Wrap in try/catch since process.exit throws in tests
    try {
      await executeProductionStartup(deps);
    } catch {
      // Expected - process.exit throws
    }

    expect(deps.ensureDatabaseReady).toHaveBeenCalledTimes(1);
    expect(deps.verifyDatabase).not.toHaveBeenCalled();
    expect(deps.startListener).not.toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("does not call startListener when verification fails", async () => {
    const verificationError = new Error("Table not found");

    const deps = {
      ensureDatabaseReady: vi.fn().mockResolvedValue(undefined),
      verifyDatabase: vi.fn().mockRejectedValue(verificationError),
      startListener: vi.fn(),
      logBootStage: vi.fn(),
      logBootError: vi.fn(),
    };

    try {
      await executeProductionStartup(deps);
    } catch {
      // Expected - process.exit throws
    }

    expect(deps.ensureDatabaseReady).toHaveBeenCalledTimes(1);
    expect(deps.verifyDatabase).toHaveBeenCalledTimes(1);
    expect(deps.startListener).not.toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("calls startListener exactly once after successful migration", async () => {
    const deps = {
      ensureDatabaseReady: vi.fn().mockResolvedValue(undefined),
      verifyDatabase: vi.fn().mockResolvedValue(undefined),
      startListener: vi.fn(),
      logBootStage: vi.fn(),
      logBootError: vi.fn(),
    };

    await executeProductionStartup(deps);

    expect(deps.startListener).toHaveBeenCalledTimes(1);
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("logs boot stages during startup sequence", async () => {
    const logStages: string[] = [];

    const deps = {
      ensureDatabaseReady: vi.fn().mockResolvedValue(undefined),
      verifyDatabase: vi.fn().mockResolvedValue(undefined),
      startListener: vi.fn(),
      logBootStage: vi.fn((msg: string) => logStages.push(msg)),
      logBootError: vi.fn(),
    };

    await executeProductionStartup(deps);

    expect(logStages).toContain("migration start");
    expect(logStages).toContain("migration finish");
    expect(logStages).toContain("post-migration verification start");
    expect(logStages).toContain("post-migration verification finish");
  });

  it("logs error and exits when migration fails", async () => {
    const logErrors: Array<{ stage: string; error: unknown }> = [];

    const deps = {
      ensureDatabaseReady: vi.fn().mockRejectedValue(new Error("DB down")),
      verifyDatabase: vi.fn(),
      startListener: vi.fn(),
      logBootStage: vi.fn(),
      logBootError: vi.fn((stage: string, error: unknown) => {
        logErrors.push({ stage, error });
      }),
    };

    try {
      await executeProductionStartup(deps);
    } catch {
      // Expected
    }

    expect(logErrors.length).toBeGreaterThan(0);
    expect(logErrors[0].stage).toBe("migration/startup verification failed");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("uses default console logging when log functions not provided", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const deps = {
      ensureDatabaseReady: vi.fn().mockResolvedValue(undefined),
      verifyDatabase: vi.fn().mockResolvedValue(undefined),
      startListener: vi.fn(),
    };

    await executeProductionStartup(deps);

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
