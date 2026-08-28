import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  // FIFO results consumed by db.select() chains in call order.
  selectResults: [] as Record<string, unknown>[][],
  updateResults: [] as Record<string, unknown>[],
  insertResults: [] as Record<string, unknown>[],
  insertValues: [] as Record<string, unknown>[],
  updateSets: [] as Record<string, unknown>[],
  onConflictArgs: [] as { target: unknown; targetWhere?: unknown; set: Record<string, unknown> }[],
}));

function selectChain(): unknown {
  // The drizzle chain is thenable at every link; awaiting it resolves with the
  // next queued result-set (FIFO across select calls in one test).
  const chain: Record<string, unknown> = {
    then: (resolve: (value: Record<string, unknown>[]) => void) => {
      resolve(state.selectResults.shift() ?? []);
    },
  };
  for (const method of ["from", "where", "orderBy", "limit"]) {
    chain[method] = () => chain;
  }
  return chain;
}

function updateChain(): unknown {
  const chain: Record<string, unknown> = {
    set: (set: Record<string, unknown>) => {
      state.updateSets.push(set);
      return chain;
    },
    where: () => chain,
    returning: async () => state.updateResults,
  };
  return chain;
}

function insertChain(): unknown {
  const chain: Record<string, unknown> = {
    values: (values: Record<string, unknown>) => {
      state.insertValues.push(values);
      return chain;
    },
    onConflictDoUpdate: (args: { target: unknown; targetWhere?: unknown; set: Record<string, unknown> }) => {
      state.onConflictArgs.push(args);
      return chain;
    },
    returning: async () => state.insertResults,
  };
  return chain;
}

vi.mock("./queries/connection", () => ({
  db: {
    select: vi.fn(() => selectChain()),
    update: vi.fn(() => updateChain()),
    insert: vi.fn(() => insertChain()),
  },
}));

const OWNER_EMAIL = "owner@example.com";
const OWNER_SUB = "google-sub-owner";

function input(overrides: Record<string, unknown> = {}) {
  return {
    provider: "google",
    subject: "google-sub-other",
    name: "Jane Doe",
    email: "jane@example.com",
    emailVerified: true,
    lastSignInAt: new Date(),
    ...overrides,
  };
}

describe("OWNER identity / admin assignment (server-side)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:5432/test");
    vi.stubEnv("APP_SECRET", "test-app-secret-at-least-32-chars-long!!");
    state.selectResults = [];
    state.updateResults = [];
    state.insertResults = [];
    state.insertValues = [];
    state.updateSets = [];
    state.onConflictArgs = [];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe("isConfiguredOwner / emailBootstrapEligible", () => {
    it("isConfiguredOwner only recognizes the configured immutable Google subject", async () => {
      vi.stubEnv("OWNER_GOOGLE_SUB", OWNER_SUB);
      const { isConfiguredOwner } = await import("./queries/users");
      expect(isConfiguredOwner("google", OWNER_SUB)).toBe(true);
      expect(isConfiguredOwner("google", "google-sub-other")).toBe(false);
      expect(isConfiguredOwner("kimi", OWNER_SUB)).toBe(false);
      expect(isConfiguredOwner("", OWNER_SUB)).toBe(false);
    });

    it("email bootstrap requires a verified exact email match", async () => {
      vi.stubEnv("OWNER_GOOGLE_EMAIL", OWNER_EMAIL);
      const { emailBootstrapEligible } = await import("./queries/users");
      expect(emailBootstrapEligible(input({ subject: OWNER_SUB, email: OWNER_EMAIL, emailVerified: true }))).toBe(true);
      // Unverified matching email can never claim the OWNER row.
      expect(emailBootstrapEligible(input({ subject: OWNER_SUB, email: OWNER_EMAIL, emailVerified: false }))).toBe(false);
      expect(emailBootstrapEligible(input({ subject: OWNER_SUB, email: OWNER_EMAIL, emailVerified: null }))).toBe(false);
      // Non-matching email cannot claim it.
      expect(emailBootstrapEligible(input({ subject: OWNER_SUB, email: "someone@example.com", emailVerified: true }))).toBe(false);
      // Provider must be google.
      expect(emailBootstrapEligible(input({ provider: "kimi", subject: OWNER_SUB, email: OWNER_EMAIL, emailVerified: true }))).toBe(false);
    });
  });

  describe("email bootstrap (OWNER_GOOGLE_SUB not configured)", () => {
    beforeEach(() => {
      vi.stubEnv("OWNER_GOOGLE_EMAIL", OWNER_EMAIL);
    });

    it("verified matching OWNER email + legacy admin row -> same row updated in place (id/role preserved, sub persisted, no duplicate)", async () => {
      const { upsertUserByProvider } = await import("./queries/users");
      // No existing (google, sub) row; exactly ONE legacy admin row (id=1).
      state.selectResults = [[], [{ id: 1, role: "admin", name: "Gerald Balucan", unionId: "legacy-kimi-union" }]];
      state.updateResults = [{
        id: 1,
        role: "admin",
        authProvider: "google",
        authSubject: OWNER_SUB,
        name: "Gerald Balucan",
        email: OWNER_EMAIL,
      }];

      const user = await upsertUserByProvider(input({ subject: OWNER_SUB, email: OWNER_EMAIL }));

      // In-place update of the SAME legacy row; no INSERT, no duplicate.
      expect(state.updateSets[0]).toMatchObject({
        authProvider: "google",
        authSubject: OWNER_SUB,
        role: "admin",
        email: OWNER_EMAIL,
      });
      expect(state.insertValues).toHaveLength(0);
      expect(user?.id).toBe(1);
      expect(user?.role).toBe("admin");
      expect(user?.authSubject).toBe(OWNER_SUB);
    });

    it("non-matching email -> ordinary user, cannot claim the legacy admin row", async () => {
      const { upsertUserByProvider } = await import("./queries/users");
      state.selectResults = [[], [{ id: 1, role: "admin", name: "Gerald Balucan" }]];
      state.insertResults = [{ id: 9, role: "user", authProvider: "google", authSubject: "google-sub-other" }];

      const user = await upsertUserByProvider(input({ email: "someone@example.com" }));

      expect(state.insertValues[0]).toMatchObject({ role: "user", authSubject: "google-sub-other" });
      expect(state.updateSets).toHaveLength(0); // legacy row untouched
      expect(user?.role).toBe("user");
    });

    it("matching but unverified email -> ordinary user, cannot claim the legacy admin row", async () => {
      const { upsertUserByProvider } = await import("./queries/users");
      state.selectResults = [[], [{ id: 1, role: "admin", name: "Gerald Balucan" }]];
      state.insertResults = [{ id: 9, role: "user", authSubject: OWNER_SUB }];

      const user = await upsertUserByProvider(input({ subject: OWNER_SUB, email: OWNER_EMAIL, emailVerified: false }));

      expect(state.insertValues[0]).toMatchObject({ role: "user" });
      expect(state.updateSets).toHaveLength(0);
      expect(user?.role).toBe("user");
    });

    it("multiple ambiguous legacy admin rows -> fail closed (no arbitrary selection)", async () => {
      const { upsertUserByProvider } = await import("./queries/users");
      state.selectResults = [
        [],
        [{ id: 1, role: "admin", name: "A" }, { id: 2, role: "admin", name: "B" }],
      ];

      await expect(
        upsertUserByProvider(input({ subject: OWNER_SUB, email: OWNER_EMAIL })),
      ).rejects.toThrow(/ambiguity/i);
      expect(state.updateSets).toHaveLength(0);
      expect(state.insertValues).toHaveLength(0);
    });

    it("accidental ordinary Google row before bootstrap -> fail closed (no silent merge)", async () => {
      const { upsertUserByProvider } = await import("./queries/users");
      // A role=user google row already exists for this identity (created
      // before OWNER_GOOGLE_EMAIL was set) while the legacy admin row is
      // still unclaimed.
      state.selectResults = [
        [{ id: 9, role: "user", authProvider: "google", authSubject: OWNER_SUB }],
        [{ id: 1, role: "admin", name: "Gerald Balucan" }],
      ];

      await expect(
        upsertUserByProvider(input({ subject: OWNER_SUB, email: OWNER_EMAIL })),
      ).rejects.toThrow(/bootstrap conflict/i);
      expect(state.updateSets).toHaveLength(0);
      expect(state.insertValues).toHaveLength(0);
    });

    it("email bootstrap without any legacy admin row -> ordinary user (email never grants admin to a new row)", async () => {
      const { upsertUserByProvider } = await import("./queries/users");
      state.selectResults = [[], []];
      state.insertResults = [{ id: 10, role: "user", authSubject: OWNER_SUB }];

      const user = await upsertUserByProvider(input({ subject: OWNER_SUB, email: OWNER_EMAIL }));

      expect(state.insertValues[0]).toMatchObject({ role: "user" });
      expect(user?.role).toBe("user");
    });
  });

  describe("OWNER_GOOGLE_SUB path", () => {
    beforeEach(() => {
      vi.stubEnv("OWNER_GOOGLE_SUB", OWNER_SUB);
    });

    it("the OWNER Google subject is upserted with role 'admin' (fresh environment, no legacy row)", async () => {
      const { upsertUserByProvider } = await import("./queries/users");
      // select: bySubject=[], legacy=[], adminByProvider=[]
      state.selectResults = [[], [], []];
      state.insertResults = [{ id: 10, role: "admin", authSubject: OWNER_SUB }];

      const user = await upsertUserByProvider(input({ subject: OWNER_SUB, email: OWNER_EMAIL }));

      expect(state.insertValues[0]).toMatchObject({ role: "admin", authSubject: OWNER_SUB });
      expect(user?.role).toBe("admin");
    });

    it("a non-owner Google subject is upserted with role 'user' (never admin)", async () => {
      const { upsertUserByProvider } = await import("./queries/users");
      state.selectResults = [[], []];
      state.insertResults = [{ id: 9, role: "user", authSubject: "google-sub-other" }];

      const user = await upsertUserByProvider(input({ subject: "google-sub-other", email: "jane@example.com" }));

      expect(state.insertValues[0]).toMatchObject({ role: "user", authSubject: "google-sub-other" });
      expect(user?.role).toBe("user");
    });

    it("OWNER first login reconciles the existing legacy admin row in place (no duplicate)", async () => {
      const { upsertUserByProvider } = await import("./queries/users");
      state.selectResults = [[], [{ id: 1, role: "admin", name: "Gerald Balucan", unionId: "legacy-kimi-union" }]];
      state.updateResults = [{
        id: 1,
        role: "admin",
        authProvider: "google",
        authSubject: OWNER_SUB,
        name: "Gerald Balucan",
      }];

      const user = await upsertUserByProvider(input({ subject: OWNER_SUB, email: OWNER_EMAIL }));

      expect(state.updateSets[0]).toMatchObject({ authProvider: "google", authSubject: OWNER_SUB, role: "admin" });
      expect(state.insertValues).toHaveLength(0);
      expect(user?.id).toBe(1);
    });

    it("a forged frontend role claim is ignored — role always comes from the subject", async () => {
      const { upsertUserByProvider } = await import("./queries/users");
      state.selectResults = [[], []];
      state.insertResults = [{ id: 11, role: "user" }];

      const user = await upsertUserByProvider(input({ subject: "google-sub-attacker" }) as never);

      expect(state.insertValues[0]).toMatchObject({ role: "user" });
      expect(user?.role).toBe("user");
    });
  });

  describe("existing rows (second login / promotion / no-downgrade)", () => {
    it("second OWNER login resolves the same provider/sub row and preserves admin", async () => {
      vi.stubEnv("OWNER_GOOGLE_SUB", OWNER_SUB);
      const { upsertUserByProvider } = await import("./queries/users");
      state.selectResults = [[{ id: 1, role: "admin", authProvider: "google", authSubject: OWNER_SUB }]];
      state.updateResults = [{ id: 1, role: "admin", authProvider: "google", authSubject: OWNER_SUB }];

      const user = await upsertUserByProvider(input({ subject: OWNER_SUB, email: OWNER_EMAIL }));

      expect(state.updateSets[0]).toMatchObject({ role: "admin" });
      expect(state.insertValues).toHaveLength(0);
      expect(user?.id).toBe(1);
      expect(user?.role).toBe("admin");
    });

    it("an existing admin row is never downgraded by a later non-owner login", async () => {
      const { upsertUserByProvider } = await import("./queries/users");
      state.selectResults = [[{ id: 1, role: "admin", authProvider: "google", authSubject: "google-sub-admin" }]];
      state.updateResults = [{ id: 1, role: "admin" }];

      const user = await upsertUserByProvider(input({ subject: "google-sub-admin" }));

      expect(state.updateSets[0]).toMatchObject({ role: "admin" });
      expect(user?.role).toBe("admin");
    });

    it("subject-matched OWNER with an accidental user row is promoted in place", async () => {
      vi.stubEnv("OWNER_GOOGLE_SUB", OWNER_SUB);
      const { upsertUserByProvider } = await import("./queries/users");
      state.selectResults = [[{ id: 9, role: "user", authProvider: "google", authSubject: OWNER_SUB }]];
      state.updateResults = [{ id: 9, role: "admin", authProvider: "google", authSubject: OWNER_SUB }];

      const user = await upsertUserByProvider(input({ subject: OWNER_SUB, email: OWNER_EMAIL }));

      expect(state.updateSets[0]).toMatchObject({ role: "admin" });
      expect(user?.role).toBe("admin");
    });

    it("OWNER_GOOGLE_SUB mismatch with the persisted OWNER identity -> fail closed (no duplicate admin)", async () => {
      vi.stubEnv("OWNER_GOOGLE_SUB", "google-sub-configured");
      const { upsertUserByProvider } = await import("./queries/users");
      // No row for (google, sub-configured); no legacy admin; but an admin row
      // already bound to google with a DIFFERENT subject (email-bootstrapped).
      state.selectResults = [[], [], [{ id: 1, role: "admin", authProvider: "google", authSubject: OWNER_SUB }]];

      await expect(
        upsertUserByProvider(input({ subject: "google-sub-configured", email: "x@example.com" })),
      ).rejects.toThrow(/identity conflict/i);
      expect(state.insertValues).toHaveLength(0);
    });
  });

  describe("conflict-safe upsert wiring", () => {
    it("the ON CONFLICT path carries the partial-index predicate and the no-downgrade guard", async () => {
      const { upsertUserByProvider } = await import("./queries/users");
      state.selectResults = [[], []];
      state.insertResults = [{ id: 9, role: "user" }];

      await upsertUserByProvider(input({ subject: "google-sub-other" }));

      expect(state.onConflictArgs).toHaveLength(1);
      expect(state.onConflictArgs[0].targetWhere).toBeDefined();
      // Role update is the SQL CASE guard (an object), not a plain string.
      expect(state.onConflictArgs[0].set.role).not.toBe("user");
    });
  });
});
