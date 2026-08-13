import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, asc } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import { ganttActivities, ganttActivityDependencies, ganttProjectEvents, ganttProjects, ganttWbsNodes } from "@db/schema";
import { appRouter } from "./router";

const DATABASE_URL = process.env.DATABASE_URL_TEST || "postgresql://postgres:postgres@localhost:5433/odmtest_pr5?sslmode=disable";
const client = postgres(DATABASE_URL, { ssl: false, prepare: false, max: 5 });
const testDb = drizzle(client, { schema });
const caller = appRouter.createCaller({ req: new Request("http://localhost/api/trpc"), resHeaders: new Headers(), user: undefined } as any);
const projectIds: number[] = [];
const token = (link: string) => new URL(`http://localhost${link}`).searchParams.get("access")!;

function assertDisposableDatabase() {
  if (process.env.PRIMAVERA_PR1_TEST_DB !== "1") throw new Error("PRIMAVERA_PR1_TEST_DB=1 is required");
  if (!/^\/(primavera_test|odmtest)/.test(new URL(DATABASE_URL).pathname)) throw new Error("Refusing non-disposable database");
}
async function project(name: string) {
  const created = await caller.primaveraLite.createProject({ name });
  projectIds.push(created.project.id);
  return { ...created, admin: token(created.adminLink), editor: token(created.editorLink), viewer: token(created.viewerLink) };
}
async function activity(p: Awaited<ReturnType<typeof project>>, name: string) {
  const loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
  return (await caller.primaveraLite.createActivity({ slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision, activity: { activityName: name } })).activity;
}
async function createDependency(p: Awaited<ReturnType<typeof project>>, predecessorActivityId: number, successorActivityId: number, dependencyType: "FS" | "SS" | "FF" | "SF", lagDays: number) {
  const loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
  return caller.primaveraLite.createDependency({ slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision, dependency: { predecessorActivityId, successorActivityId, dependencyType, lagDays } });
}

describe("Primavera Lite PR5 dependencies", () => {
  beforeAll(assertDisposableDatabase);
  afterAll(async () => {
    if (projectIds.length) {
      await testDb.delete(ganttActivityDependencies).where(inArray(ganttActivityDependencies.projectId, projectIds));
      await testDb.delete(ganttProjectEvents).where(inArray(ganttProjectEvents.projectId, projectIds));
      await testDb.delete(ganttActivities).where(inArray(ganttActivities.projectId, projectIds));
      await testDb.delete(ganttWbsNodes).where(inArray(ganttWbsNodes.projectId, projectIds));
      await testDb.delete(ganttProjects).where(inArray(ganttProjects.id, projectIds));
    }
    await client.end();
  });

  it("creates all four relationship types with positive, zero and negative whole-day lag", async () => {
    const p = await project("PR5 Types");
    const a = await activity(p, "A"); const b = await activity(p, "B");
    const values = [["FS", 0], ["SS", 2], ["FF", -2], ["SF", 5]] as const;
    for (const [type, lag] of values) await createDependency(p, a.id, b.id, type, lag);
    const loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.viewer });
    expect(loaded.dependencies.map((row) => [row.dependencyType, row.lagDays])).toEqual(values);
    const listed = await caller.primaveraLite.listDependencies({ slug: p.project.slug, access: p.viewer });
    expect(listed.dependencies.map((row) => [row.dependencyType, row.lagDays])).toEqual(values);
  });

  it("rejects self-links, duplicates, cycles, cross-project and archived activity IDs", async () => {
    const p = await project("PR5 Validation"); const other = await project("PR5 Other");
    const a = await activity(p, "A"); const b = await activity(p, "B"); const c = await activity(p, "C"); const foreign = await activity(other, "Foreign");
    await createDependency(p, a.id, b.id, "FS", 0);
    await expect(createDependency(p, a.id, b.id, "FS", 7)).rejects.toThrow(/Duplicate/i);
    await expect(createDependency(p, a.id, b.id, "SS", 0)).resolves.toMatchObject({ dependency: { dependencyType: "SS" } });
    await createDependency(p, b.id, c.id, "FS", 0);
    await expect(createDependency(p, c.id, a.id, "FS", 0)).rejects.toThrow(/circular/i);
    await expect(createDependency(p, a.id, a.id, "FS", 0)).rejects.toThrow(/itself/i);
    await expect(createDependency(p, a.id, foreign.id, "FS", 0)).rejects.toThrow(/belong to this project/i);
    await testDb.update(ganttActivities).set({ archivedAt: new Date() }).where(eq(ganttActivities.id, c.id));
    await expect(createDependency(p, a.id, c.id, "SS", 0)).rejects.toThrow(/Archived activities/i);
  });

  it("returns controlled stale conflicts and enforces viewer read-only", async () => {
    const p = await project("PR5 Auth"); const a = await activity(p, "A"); const b = await activity(p, "B");
    const loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    await expect(caller.primaveraLite.createDependency({ slug: p.project.slug, access: p.viewer, expectedRevision: loaded.revision, dependency: { predecessorActivityId: a.id, successorActivityId: b.id, dependencyType: "FS", lagDays: 0 } })).rejects.toThrow(/Editor or admin/i);
    await caller.primaveraLite.updateProjectMeta({ slug: p.project.slug, access: p.admin, expectedRevision: loaded.revision, changes: { status: "Changed" } });
    await expect(caller.primaveraLite.createDependency({ slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision, dependency: { predecessorActivityId: a.id, successorActivityId: b.id, dependencyType: "FS", lagDays: 0 } })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("updates, archives and restores with exactly one revisioned audit event per mutation", async () => {
    const p = await project("PR5 Lifecycle"); const a = await activity(p, "A"); const b = await activity(p, "B");
    const created = await createDependency(p, a.id, b.id, "FS", 0);
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const updated = await caller.primaveraLite.updateDependency({ slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision, dependencyId: created.dependency.id, changes: { dependencyType: "SS", lagDays: -3 } });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const preview = await caller.primaveraLite.archiveDependencyDryRun({ slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision, dependencyId: created.dependency.id });
    const archived = await caller.primaveraLite.archiveDependency({ slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision, dependencyId: created.dependency.id, previewToken: preview.previewToken, confirmed: true });
    const restored = await caller.primaveraLite.restoreDependency({ slug: p.project.slug, access: p.editor, expectedRevision: archived.revision, dependencyId: created.dependency.id, confirmed: true });
    expect(updated.dependency).toMatchObject({ dependencyType: "SS", lagDays: -3 });
    expect(restored.dependency.archivedAt).toBeNull();
    const events = await testDb.select().from(ganttProjectEvents).where(eq(ganttProjectEvents.projectId, p.project.id)).orderBy(asc(ganttProjectEvents.projectRevision), asc(ganttProjectEvents.id));
    const dependencyEvents = events.filter((event) => event.entityType === "dependency" && event.entityId === created.dependency.id);
    expect(dependencyEvents.map((event) => event.action)).toEqual(["create", "update", "archive", "restore"]);
    expect(new Set(dependencyEvents.map((event) => event.projectRevision)).size).toBe(4);
  });
});
