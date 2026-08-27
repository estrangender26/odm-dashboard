import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  bySubject: [] as Record<string, unknown>[],
  legacy: [] as Record<string, unknown>[],
  insertRows: [] as Record<string, unknown>[],
  updateRows: [] as Record<string, unknown>[],
  insertValues: [] as Record<string, unknown>[],
  updateSets: [] as Record<string, unknown>[],
  onConflictArgs: [] as { target: unknown; targetWhere?: unknown; set: Record<string, unknown> }[],
}));

vi.mock("./queries/connection", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({ limit: vi.fn(async () => state.legacy) })),
          limit: vi.fn(async () => state.bySubject),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((set: Record<string, unknown>) => {
        state.updateSets.push(set);
        return { where: vi.fn(() => ({ returning: vi.fn(async () => state.updateRows) })) };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        state.insertValues.push(values);
        return {
          onConflictDoUpdate: vi.fn((args: { target: unknown; targetWhere?: unknown; set: Record<string, unknown> }) => {
            state.onConflictArgs.push(args);
            return { returning: vi.fn(async () => state.insertRows) };
          }),
        };
      }),
    })),
  },
}));

describe("OWNER identity / admin assignment (server-side)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:5432/test");
    vi.stubEnv("APP_SECRET", "test-app-secret-at-least-32-chars-long!!");
    vi.stubEnv("OWNER_GOOGLE_SUB", "google-sub-owner");
    state.bySubject = [];
    state.legacy = [];
    state.insertRows = [];
    state.updateRows = [];
    state.insertValues = [];
    state.updateSets = [];
    state.onConflictArgs = [];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("isConfiguredOwner only recognizes the configured immutable Google subject", async () => {
    const { isConfiguredOwner } = await import("./queries/users");
    expect(isConfiguredOwner("google", "google-sub-owner")).toBe(true);
    expect(isConfiguredOwner("google", "google-sub-other")).toBe(false);
    // A provider other than google can never become OWNER through this path.
    expect(isConfiguredOwner("kimi", "google-sub-owner")).toBe(false);
    expect(isConfiguredOwner("", "google-sub-owner")).toBe(false);
  });

  it("a non-owner Google subject is upserted with role 'user' (never admin)", async () => {
    const { upsertUserByProvider } = await import("./queries/users");
    state.insertRows = [{ id: 9, role: "user", authProvider: "google", authSubject: "google-sub-other" }];

    const user = await upsertUserByProvider({
      provider: "google",
      subject: "google-sub-other",
      name: "Jane",
      email: "jane@example.com",
      lastSignInAt: new Date(),
    });

    expect(state.insertValues[0]).toMatchObject({ role: "user", authProvider: "google", authSubject: "google-sub-other" });
    expect(user?.role).toBe("user");
  });

  it("the OWNER Google subject is upserted with role 'admin'", async () => {
    const { upsertUserByProvider } = await import("./queries/users");
    state.insertRows = [{ id: 10, role: "admin", authProvider: "google", authSubject: "google-sub-owner" }];

    const user = await upsertUserByProvider({
      provider: "google",
      subject: "google-sub-owner",
      name: "Gerald Balucan",
      email: "owner@example.com",
      lastSignInAt: new Date(),
    });

    expect(state.insertValues[0]).toMatchObject({ role: "admin", authSubject: "google-sub-owner" });
    expect(user?.role).toBe("admin");
  });

  it("OWNER first login reconciles the existing legacy admin row in place (no duplicate)", async () => {
    const { upsertUserByProvider } = await import("./queries/users");
    // Existing production OWNER row from the Kimi era: role=admin, no provider columns.
    state.legacy = [{ id: 1, role: "admin", name: "Gerald Balucan", unionId: "legacy-kimi-union" }];
    state.updateRows = [{
      id: 1,
      role: "admin",
      authProvider: "google",
      authSubject: "google-sub-owner",
      name: "Gerald Balucan",
      email: "owner@example.com",
    }];

    const user = await upsertUserByProvider({
      provider: "google",
      subject: "google-sub-owner",
      name: "Gerald Balucan",
      email: "owner@example.com",
      lastSignInAt: new Date(),
    });

    // The legacy row is UPDATEd in place; no INSERT is issued.
    expect(state.updateSets[0]).toMatchObject({
      authProvider: "google",
      authSubject: "google-sub-owner",
      role: "admin",
    });
    expect(state.insertValues).toHaveLength(0);
    expect(user?.id).toBe(1);
  });

  it("a forged frontend role claim is ignored — role always comes from the subject", async () => {
    const { upsertUserByProvider } = await import("./queries/users");
    state.insertRows = [{ id: 11, role: "user" }];

    const user = await upsertUserByProvider({
      provider: "google",
      subject: "google-sub-attacker",
      name: "Attacker",
      email: "attacker@example.com",
      lastSignInAt: new Date(),
    } as never); // no role field exists in the input contract

    expect(state.insertValues[0]).toMatchObject({ role: "user" });
    expect(user?.role).toBe("user");
  });

  it("an existing admin row is never downgraded by a later login (no role=admin strip)", async () => {
    const { upsertUserByProvider } = await import("./queries/users");
    // Existing (google, owner-sub) row already admin; a re-login goes through
    // the ON CONFLICT DO UPDATE path with a CASE guard preserving admin.
    state.bySubject = [{ id: 1, role: "admin", authProvider: "google", authSubject: "google-sub-owner" }];
    state.insertRows = [{ id: 1, role: "admin" }];

    await upsertUserByProvider({
      provider: "google",
      subject: "google-sub-owner",
      name: "Gerald Balucan",
      email: "owner@example.com",
      lastSignInAt: new Date(),
    });

    expect(state.onConflictArgs).toHaveLength(1);
    // The role update is the SQL CASE guard (an object), not a plain "user" string.
    expect(state.onConflictArgs[0].set.role).not.toBe("user");
    expect(state.onConflictArgs[0].targetWhere).toBeDefined();
  });
});
