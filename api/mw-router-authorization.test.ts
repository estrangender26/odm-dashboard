/**
 * ODM destructive-endpoint authorization — containment tests.
 *
 * Incident under containment: on 2026-09-16 production `public.mw_inspections`
 * lost ~14,171 historical rows (16,543 -> 2,372). `mw.resetAll` — an
 * unauthenticated `DELETE FROM mw_inspections` with no WHERE clause, reachable
 * as `POST /api/trpc/mw.resetAll` — is the primary application-level suspect,
 * and `mw.deleteInspection` / `mw.updateInspection` were also public.
 *
 * What is proven here:
 *   1. anonymous resetAll is rejected;
 *   2. anonymous deleteInspection is rejected;
 *   3. anonymous updateInspection is rejected;
 *   4. rejection performs ZERO database mutations;
 *   5. authorized behaviour follows the declared role policy;
 *   6. the frontend Clear control cannot invoke the destructive endpoint;
 *   7. direct API invocation is protected even when frontend controls are bypassed;
 *   8. ordinary read-only dashboard behaviour still works anonymously;
 *   9. import behaviour matches the explicitly chosen (anonymous) policy;
 *  10. the canonical dedup key claimed by the router matches the schema constraint.
 *
 * The real procedure code runs against `api/mw-router-fake-db.ts`, so
 * authorization middleware, input validation, statements and audit writes are
 * all exercised. No destructive call is ever made against production.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRouter, authedQuery, adminQuery, publicQuery } from "./middleware";
import type { TrpcContext } from "./context";

// ── Mocks (hoisted before the router is imported) ──
vi.mock("./queries/connection", async () => {
  const helper = await import("./mw-router-fake-db");
  const cache = new Map<string, unknown>();
  return {
    db: helper.fakeDb,
    getDb: () => helper.fakeDb,
    ensureDbReady: async () => undefined,
    cacheGet: (key: string) => cache.get(key),
    cacheSet: (key: string, value: unknown) => {
      cache.set(key, value);
    },
    cacheInvalidate: () => cache.clear(),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ op: "eq", column, value }),
  sql: Object.assign(
    (_template: unknown, ...values: unknown[]) => ({ __sql: true, values }),
    { raw: (value: string) => ({ raw: value }) },
  ),
}));

// ── Imports after mocks ──
import { mwRouter, MW_RESET_ALL_CONFIRMATION } from "./mw-router";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createContext } from "./context";
import {
  fakeDbState,
  inspectionMutations,
  resetFakeDbState,
  seedInspection,
} from "./mw-router-fake-db";

const router = createRouter({ mw: mwRouter });

const anonymousContext = (): TrpcContext => ({
  req: new Request("http://localhost/api/trpc"),
  resHeaders: new Headers(),
});

const userContext = (): TrpcContext => ({
  req: new Request("http://localhost/api/trpc"),
  resHeaders: new Headers(),
  user: { id: 2, name: "Operator", email: "operator@example.com", role: "user" } as unknown as TrpcContext["user"],
});

const adminContext = (): TrpcContext => ({
  req: new Request("http://localhost/api/trpc"),
  resHeaders: new Headers(),
  user: { id: 1, name: "Owner", email: "owner@example.com", role: "admin" } as unknown as TrpcContext["user"],
});

const anonymousCaller = () => router.createCaller(anonymousContext());
const userCaller = () => router.createCaller(userContext());
const adminCaller = () => router.createCaller(adminContext());

const inspectionCount = () => fakeDbState.inspections.length;

/** Shape accepted by the `mw.importExcel` input schema (facilityId/inspector/category are required). */
interface ImportRowInput {
  facilityId: string;
  inspector: string;
  category: string;
  assetTag: string;
  task: string;
  date: string;
  submittedAt: string;
  status: string;
}

function importRow(overrides: Partial<ImportRowInput> = {}): ImportRowInput {
  return {
    facilityId: "Balara Water Pumping Station",
    inspector: "Operator A",
    category: "Inspection",
    assetTag: "WS-WPS-BAL-00999",
    task: "Check for leaks",
    date: "2026-09-15",
    submittedAt: "2026-09-15T10:00:00.000Z",
    status: "Active",
    ...overrides,
  };
}

beforeEach(() => {
  resetFakeDbState();
});

describe("ODM containment — anonymous callers cannot mutate inspection data", () => {
  it("anonymous resetAll is rejected even with the exact confirmation phrase", async () => {
    seedInspection({ id: 238513 });
    seedInspection({ id: 238514 });

    await expect(
      anonymousCaller().mw.resetAll({ confirm: MW_RESET_ALL_CONFIRMATION }),
    ).rejects.toThrow(/Authentication required/i);

    expect(inspectionCount()).toBe(2);
    expect(inspectionMutations()).toEqual([]);
    expect(fakeDbState.audit).toEqual([]);
  });

  it("anonymous resetAll is rejected before input validation, so the endpoint cannot be probed", async () => {
    seedInspection({ id: 238513 });

    // The pre-containment frontend sent exactly this payload.
    await expect(anonymousCaller().mw.resetAll({} as never)).rejects.toThrow(
      /Authentication required/i,
    );

    // A payload that fails the schema must still produce UNAUTHORIZED, never a
    // BAD_REQUEST that reveals the confirmation phrase to an anonymous caller.
    await expect(anonymousCaller().mw.resetAll({ confirm: "WRONG" } as never)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });

    expect(inspectionCount()).toBe(1);
    expect(inspectionMutations()).toEqual([]);
  });

  it("anonymous deleteInspection is rejected and the row survives", async () => {
    const row = seedInspection({ id: 240882, assetTag: "WS-WPS-KIN-00110" });

    await expect(anonymousCaller().mw.deleteInspection({ id: 240882 })).rejects.toThrow(
      /Authentication required/i,
    );

    expect(fakeDbState.inspections.some((r) => r.id === row.id)).toBe(true);
    expect(inspectionMutations()).toEqual([]);
  });

  it("anonymous updateInspection is rejected and the row is unchanged", async () => {
    const row = seedInspection({ id: 240882, status: "Active" });

    await expect(
      anonymousCaller().mw.updateInspection({ id: 240882, status: "Cleared" }),
    ).rejects.toThrow(/Authentication required/i);

    expect(row.status).toBe("Active");
    expect(inspectionMutations()).toEqual([]);
  });

  it("direct HTTP POST /api/trpc/mw.resetAll without a session is rejected with 401 and mutates nothing", async () => {
    seedInspection({ id: 238513 });
    seedInspection({ id: 238514 });

    // Same handler wiring as api/boot.ts: fetchRequestHandler + appRouter + createContext.
    const response = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: new Request("http://localhost/api/trpc/mw.resetAll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: { confirm: MW_RESET_ALL_CONFIRMATION } }),
      }),
      router,
      createContext,
    });

    expect(response.status).toBe(401);
    const payload = (await response.json()) as { error?: { json?: { data?: { code?: string } } } };
    expect(payload.error?.json?.data?.code).toBe("UNAUTHORIZED");
    expect(inspectionCount()).toBe(2);
    expect(inspectionMutations()).toEqual([]);
  });
});

describe("ODM containment — authenticated non-OWNER callers", () => {
  it("non-admin resetAll is rejected (FORBIDDEN) with zero mutations", async () => {
    seedInspection({ id: 238513 });

    await expect(
      userCaller().mw.resetAll({ confirm: MW_RESET_ALL_CONFIRMATION }),
    ).rejects.toThrow(/Insufficient permissions/i);

    expect(inspectionCount()).toBe(1);
    expect(inspectionMutations()).toEqual([]);
  });

  it("non-admin deleteInspection is rejected (FORBIDDEN) with zero mutations", async () => {
    seedInspection({ id: 240882 });

    await expect(userCaller().mw.deleteInspection({ id: 240882 })).rejects.toThrow(
      /Insufficient permissions/i,
    );

    expect(inspectionCount()).toBe(1);
    expect(inspectionMutations()).toEqual([]);
  });

  it("authenticated updateInspection succeeds and is audited (authenticated write)", async () => {
    const row = seedInspection({ id: 240882, status: "Active" });

    const result = await userCaller().mw.updateInspection({ id: 240882, status: "Cleared" });

    expect(result.success).toBe(true);
    expect(result.affected).toBe(1);
    expect(row.status).toBe("Cleared");

    expect(fakeDbState.audit).toHaveLength(1);
    expect(fakeDbState.audit[0]).toMatchObject({
      operation: "update_inspection",
      actorId: 2,
      actorRole: "user",
      resource: "mw_inspections#240882",
      affectedCount: 1,
      correlationId: result.correlationId,
    });
  });
});

describe("ODM containment — OWNER-only guarded whole-dataset deletion", () => {
  it("admin resetAll without the typed confirmation is rejected and mutates nothing", async () => {
    seedInspection({ id: 238513 });

    await expect(adminCaller().mw.resetAll({} as never)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    expect(inspectionCount()).toBe(1);
    expect(inspectionMutations()).toEqual([]);
    expect(fakeDbState.audit).toEqual([]);
  });

  it("admin resetAll with a wrong confirmation phrase is rejected and mutates nothing", async () => {
    seedInspection({ id: 238513 });

    await expect(
      adminCaller().mw.resetAll({ confirm: "delete all odm inspections" } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(inspectionCount()).toBe(1);
    expect(inspectionMutations()).toEqual([]);
  });

  it("admin resetAll with the exact phrase deletes the dataset and records an audit row", async () => {
    seedInspection({ id: 238513 });
    seedInspection({ id: 238514 });
    seedInspection({ id: 238515 });

    const result = await adminCaller().mw.resetAll({ confirm: MW_RESET_ALL_CONFIRMATION });

    expect(result.success).toBe(true);
    expect(result.removed).toBe(3);
    expect(inspectionCount()).toBe(0);

    expect(fakeDbState.audit).toHaveLength(1);
    expect(fakeDbState.audit[0]).toMatchObject({
      operation: "reset_all",
      actorId: 1,
      actorRole: "admin",
      resource: "mw_inspections",
      affectedCount: 3,
      correlationId: result.correlationId,
    });
  });

  it("admin deleteInspection removes exactly one row and records an audit row", async () => {
    seedInspection({ id: 240882 });
    seedInspection({ id: 240883 });

    const result = await adminCaller().mw.deleteInspection({ id: 240882 });

    expect(result.removed).toBe(1);
    expect(inspectionCount()).toBe(1);
    expect(fakeDbState.audit[0]).toMatchObject({
      operation: "delete_inspection",
      actorId: 1,
      actorRole: "admin",
      resource: "mw_inspections#240882",
      affectedCount: 1,
      correlationId: result.correlationId,
    });
  });
});

describe("ODM containment — retrieval and import policy", () => {
  it("the read-only dashboard still works anonymously", async () => {
    seedInspection({ id: 238513 });
    seedInspection({ id: 238514 });

    const rows = await anonymousCaller().mw.listInspections();
    expect(rows).toHaveLength(2);

    const single = await anonymousCaller().mw.getInspection({ id: 238513 });
    expect(single?.id).toBe(238513);

    expect(inspectionMutations()).toEqual([]);
  });

  it("anonymous importExcel remains permitted by explicit policy and is attributed", async () => {
    const result = await anonymousCaller().mw.importExcel({ rows: [importRow()], filename: "odm.xlsx" });

    expect(result.success).toBe(true);
    expect(result.processed).toBe(1);
    expect(inspectionCount()).toBe(1);

    // Anonymous import is the module's operator data-entry path, and every call
    // is attributable even though it is unauthenticated.
    expect(fakeDbState.audit).toHaveLength(1);
    expect(fakeDbState.audit[0]).toMatchObject({
      operation: "import_excel",
      actorId: null,
      actorRole: "anonymous",
      resource: "mw_inspections",
      affectedCount: 1,
      correlationId: result.correlationId,
    });

    // An import can never remove a row.
    const deletes = inspectionMutations().filter((call) => call.kind === "delete");
    expect(deletes).toEqual([]);
  });

  it("importExcel updates an existing row on the canonical key and still deletes nothing", async () => {
    const existing = seedInspection({
      id: 240900,
      assetTag: "WS-WPS-BAL-00999",
      task: "Check for leaks",
      date: "2026-09-15",
      submittedAt: "2026-09-15T10:00:00.000Z",
      inspector: "Old Inspector",
    });

    await anonymousCaller().mw.importExcel({
      rows: [importRow({ inspector: "New Inspector" })],
      filename: "odm.xlsx",
    });

    expect(inspectionCount()).toBe(1);
    expect(existing.id).toBe(240900);
    expect(existing.inspector).toBe("New Inspector");
    expect(inspectionMutations().filter((call) => call.kind === "delete")).toEqual([]);
  });
});

describe("ODM containment — source-level regression guards", () => {
  const routerSource = readFileSync(resolve(process.cwd(), "api/mw-router.ts"), "utf8");
  const dashboardSource = readFileSync(
    resolve(process.cwd(), "public/mw-dashboard.html"),
    "utf8",
  );

  function procedureBlock(name: string): string {
    const start = routerSource.indexOf(`\n  ${name}:`);
    if (start < 0) throw new Error(`procedure ${name} not found in api/mw-router.ts`);
    const nextProcedure = routerSource.indexOf("\n  },", start);
    const end = nextProcedure > start ? nextProcedure : routerSource.indexOf("\n});", start);
    return routerSource.slice(start, end);
  }

  it("declares the intended authorization boundary for every procedure", () => {
    expect(publicQuery).toBeDefined();
    expect(authedQuery).toBeDefined();
    expect(adminQuery).toBeDefined();

    expect(procedureBlock("listInspections")).toContain("publicQuery");
    expect(procedureBlock("getInspection")).toContain("publicQuery");
    expect(procedureBlock("importExcel")).toContain("importExcel: publicQuery");
    expect(procedureBlock("updateInspection")).toContain("updateInspection: authedQuery");
    expect(procedureBlock("deleteInspection")).toContain("deleteInspection: adminQuery");
    expect(procedureBlock("resetAll")).toContain("resetAll: adminQuery");

    // The regression that caused the incident: a public server-side DELETE.
    expect(routerSource).not.toContain("resetAll: publicQuery");
    expect(routerSource).not.toContain("deleteInspection: publicQuery");
    expect(routerSource).not.toContain("updateInspection: publicQuery");
  });

  it("resetAll requires an exact typed confirmation and audits the affected count", () => {
    const block = procedureBlock("resetAll");
    expect(block).toContain("z.literal(MW_RESET_ALL_CONFIRMATION)");
    expect(block).toContain("recordMwInspectionAudit");
    expect(block).toContain("MwAuditOperation.resetAll");
    expect(routerSource).toContain('export const MW_RESET_ALL_CONFIRMATION = "DELETE ALL ODM INSPECTIONS"');
  });

  it("every ODM mutation audits inside the same transaction as its write", () => {
    for (const name of ["importExcel", "updateInspection", "deleteInspection", "resetAll"]) {
      const block = procedureBlock(name);
      expect(block, `${name} must run in a transaction`).toContain("db.transaction");
      expect(block, `${name} must record an audit row`).toContain("recordMwInspectionAudit");
    }
    // No mutating statement may run outside a transaction any more.
    expect(routerSource).not.toContain("await db.delete(mwInspections)");
    expect(routerSource).not.toContain("await db.update(mwInspections)");
  });

  it("the router's conflict target matches the schema's canonical uniqueness rule", () => {
    const schemaSource = readFileSync(resolve(process.cwd(), "db/schema.ts"), "utf8");

    const schemaConstraint = /unique\("mw_inspections_dedup"\)\.on\(([^)]*)\)/.exec(schemaSource);
    expect(schemaConstraint, "mw_inspections_dedup constraint not found").not.toBeNull();
    const schemaColumns = schemaConstraint![1]
      .split(",")
      .map((part) => part.trim().replace(/^table\./, ""))
      .sort();

    const conflictTarget = /target: \[([^\]]*)\]/.exec(routerSource);
    expect(conflictTarget, "onConflictDoUpdate target not found").not.toBeNull();
    const routerColumns = conflictTarget![1]
      .split(",")
      .map((part) => part.trim().replace(/^mwInspections\./, ""))
      .sort();

    expect(routerColumns).toEqual(["assetTag", "date", "submittedAt", "task"]);
    expect(schemaColumns).toEqual(routerColumns);
  });

  it("the Clear control no longer exists anywhere in the dashboard", () => {
    // No code path in the dashboard may call the OWNER-only endpoint.
    expect(dashboardSource).not.toContain("/mw.resetAll");
    expect(dashboardSource).not.toContain("resetAll");
    expect(dashboardSource).not.toContain("resetDatabase");

    // The control itself, its click handler and its local-clear plumbing are gone:
    // the dashboard has no destructive or data-clearing affordance at all.
    for (const removed of [
      "clearDataBtn",
      "clearStorage",
      "clearLocalCopy",
      "btn-ghost-warn",
      "LS_FILENAME",
    ]) {
      expect(dashboardSource, `removed Clear plumbing must not reappear: ${removed}`).not.toContain(
        removed,
      );
    }

    // The header's remaining actions are non-destructive: Refresh (read-only) and
    // Ask AI. The only tRPC endpoints the dashboard can reach at all are the two
    // non-destructive ones — a destructive call cannot be re-added by a button.
    expect(dashboardSource).toContain('id="refreshBtn"');
    expect(dashboardSource).toContain('id="askAiBtn"');

    const calledEndpoints = [...dashboardSource.matchAll(/apiCall\(\s*'([^']+)'/g)]
      .map((match) => match[1])
      .sort();
    expect(calledEndpoints).toEqual(["/mw.importExcel", "/mw.listInspections"]);

    const refreshHandler = /document\.getElementById\('refreshBtn'\)\.addEventListener\([\s\S]*?\n\}\);/.exec(
      dashboardSource,
    );
    expect(refreshHandler, "refreshBtn handler not found").not.toBeNull();
    expect(refreshHandler![0]).toContain("loadFromDatabase()");
    expect(refreshHandler![0]).not.toContain("apiCall(");

    // Removing the button must not remove the offline/localStorage read fallback.
    expect(dashboardSource).toContain("function loadFromStorage()");
    expect(dashboardSource).toContain("function saveToStorage()");
    expect(dashboardSource).toContain("const LS_KEY = 'mwc_odm_data';");
  });

  it("documents the chosen boundary, including the deliberate anonymous import decision", () => {
    const doc = readFileSync(resolve(process.cwd(), "docs/odm-inspection-authorization.md"), "utf8");
    for (const required of [
      "resetAll",
      "deleteInspection",
      "updateInspection",
      "importExcel",
      "listInspections",
      "adminQuery",
      "authedQuery",
      "publicQuery",
    ]) {
      expect(doc, `docs/odm-inspection-authorization.md must mention ${required}`).toContain(required);
    }
  });
});
