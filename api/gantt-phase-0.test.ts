import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  collectDescendantIds,
  GanttDomainError,
  validateDependencyGraph,
  validateHierarchyAssignment,
} from "./gantt-domain";
import {
  ganttDependencyInputSchema,
  ganttProjectPlanSchema,
  ganttTaskInputSchema,
} from "@contracts/gantt";

describe("Gantt Phase 0 domain integrity", () => {
  const taskIds = [1, 2, 3, 4];

  it("supports multiple predecessors and all canonical relationship types", () => {
    const dependencies = [
      { predecessorTaskId: 1, successorTaskId: 3, relationshipType: "FS", lag: 0, lagUnit: "day" },
      { predecessorTaskId: 2, successorTaskId: 3, relationshipType: "SS", lag: 2, lagUnit: "day" },
      { predecessorTaskId: 3, successorTaskId: 4, relationshipType: "FF", lag: -1, lagUnit: "day" },
    ];
    dependencies.forEach(item => expect(ganttDependencyInputSchema.parse(item)).toEqual(item));
    expect(() => validateDependencyGraph(taskIds, dependencies)).not.toThrow();
  });

  it("rejects self-links, duplicates, cross-project task IDs, and cycles before a write", () => {
    const invalidGraphs = [
      [{ predecessorTaskId: 1, successorTaskId: 1 }],
      [{ predecessorTaskId: 1, successorTaskId: 2 }, { predecessorTaskId: 1, successorTaskId: 2 }],
      [{ predecessorTaskId: 1, successorTaskId: 99 }],
      [{ predecessorTaskId: 1, successorTaskId: 2 }, { predecessorTaskId: 2, successorTaskId: 1 }],
    ];
    for (const graph of invalidGraphs) {
      expect(() => validateDependencyGraph(taskIds, graph)).toThrow(GanttDomainError);
    }
  });

  it("leaves the previous dependency set unchanged when validation fails", () => {
    const persisted = [{ predecessorTaskId: 1, successorTaskId: 2 }];
    const snapshot = structuredClone(persisted);
    const proposed = [...persisted, { predecessorTaskId: 2, successorTaskId: 1 }];
    expect(() => validateDependencyGraph(taskIds, proposed)).toThrow("Dependency cycle detected");
    expect(persisted).toEqual(snapshot);
  });

  it("rejects hierarchy cycles and collects descendants for atomic subtree deletion", () => {
    const hierarchy = [
      { id: 1, parentId: null },
      { id: 2, parentId: 1 },
      { id: 3, parentId: 2 },
      { id: 4, parentId: null },
    ];
    expect(() => validateHierarchyAssignment(hierarchy, 1, 3)).toThrow("descendants");
    expect(() => validateHierarchyAssignment(hierarchy, 2, 99)).toThrow("unavailable");
    expect(collectDescendantIds(hierarchy, 1).sort()).toEqual([1, 2, 3]);
  });
});

describe("Gantt Phase 0 canonical round trip", () => {
  it("preserves hierarchy, types, dates, category, order, dependencies, and assignments", () => {
    const task = ganttTaskInputSchema.parse({
      frontendTaskUid: "68ecfa38-e6e0-426c-bf80-1099ff3c5bdf",
      parentId: 11,
      name: "Commissioning milestone",
      taskType: "milestone",
      category: "Commissioning",
      sortOrder: 42,
      plannedStart: "2026-08-01",
      plannedEnd: "2026-08-01",
      actualStart: null,
      actualEnd: null,
      duration: 0,
      actualDuration: null,
      progress: 0,
      status: "Not Started",
      owner: "Project Controls",
      notes: "Round-trip marker",
    });
    const plan = ganttProjectPlanSchema.parse({
      project: { name: "Phase 0 fixture", statusDate: "2026-07-15" },
      tasks: [task],
      dependencies: [{
        predecessorTaskId: 10,
        successorTaskId: 11,
        relationshipType: "SF",
        lag: -2,
        lagUnit: "day",
      }],
      assignments: [{ taskId: 11, resourceId: "resource-1", units: 0.5, role: "Planner" }],
    });
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });
});

describe("Gantt Phase 0 route safety guards", () => {
  it("contains no runtime Gantt DDL, public procedure, global reset, or JSON rehydration endpoint", () => {
    const root = resolve(import.meta.dirname, "..");
    const ganttRouter = readFileSync(resolve(root, "api/gantt-router.ts"), "utf8");
    const projectsRouter = readFileSync(resolve(root, "api/gantt-projects-router.ts"), "utf8");
    const planner = readFileSync(resolve(root, "src/pages/GanttPlanner.tsx"), "utf8");
    const serverSource = `${ganttRouter}\n${projectsRouter}`;
    expect(serverSource).not.toMatch(/DROP\s+TABLE|CREATE\s+TABLE|TRUNCATE/i);
    expect(serverSource).not.toContain("publicQuery");
    expect(serverSource).not.toContain("resetGantt");
    expect(projectsRouter).not.toContain("adoptToCurrentSession");
    expect(projectsRouter).not.toContain("JSON.parse");
    expect(planner).not.toContain("resetMut.mutateAsync");
  });
});

describe("Gantt Phase 0 scope isolation", () => {
  it("keeps user and signed anonymous ownership mutually isolated", async () => {
    vi.stubEnv("APP_SECRET", "phase-0-test-secret-at-least-32-bytes");
    const { ganttScopeOwnsProject, resolveGanttScope, ganttScopeCookieName } = await import("./gantt-scope");
    const anonymousHeaders = new Headers({ host: "localhost:5173", cookie: "gantt_anon_session=client-selected" });
    const firstResponseHeaders = new Headers();
    const first = await resolveGanttScope({
      req: new Request("http://localhost:5173/api/trpc", { headers: anonymousHeaders }),
      resHeaders: firstResponseHeaders,
    });
    expect(first.kind).toBe("anonymous");
    if (first.kind !== "anonymous") throw new Error("Expected anonymous scope");
    expect(first.sessionId).not.toBe("client-selected");
    const setCookie = firstResponseHeaders.get("set-cookie");
    expect(setCookie).toContain(`${ganttScopeCookieName}=`);
    const signedCookie = setCookie!.split(";")[0];
    const second = await resolveGanttScope({
      req: new Request("http://localhost:5173/api/trpc", { headers: { host: "localhost:5173", cookie: signedCookie } }),
      resHeaders: new Headers(),
    });
    expect(second).toEqual(first);

    const userScope = { kind: "user", userId: 7, isAdmin: false } as const;
    expect(ganttScopeOwnsProject(userScope, { userId: 7, sessionId: null })).toBe(true);
    expect(ganttScopeOwnsProject(userScope, { userId: 8, sessionId: null })).toBe(false);
    expect(ganttScopeOwnsProject(first, { userId: null, sessionId: first.sessionId })).toBe(true);
    expect(ganttScopeOwnsProject(first, { userId: 7, sessionId: first.sessionId })).toBe(false);
  });
});
