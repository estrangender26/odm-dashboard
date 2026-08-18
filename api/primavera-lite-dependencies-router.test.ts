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
async function revision(p: Awaited<ReturnType<typeof project>>) {
  return (await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor })).revision;
}
async function archiveDependencyFlow(p: Awaited<ReturnType<typeof project>>, dependencyId: number) {
  const expectedRevision = await revision(p);
  const preview = await caller.primaveraLite.archiveDependencyDryRun({ slug: p.project.slug, access: p.editor, expectedRevision, dependencyId });
  return caller.primaveraLite.archiveDependency({ slug: p.project.slug, access: p.editor, expectedRevision, dependencyId, previewToken: preview.previewToken, confirmed: true });
}
async function archiveActivityFlow(p: Awaited<ReturnType<typeof project>>, activityId: number) {
  const expectedRevision = await revision(p);
  const preview = await caller.primaveraLite.archiveActivityDryRun({ slug: p.project.slug, access: p.editor, expectedRevision, activityId });
  return caller.primaveraLite.archiveActivity({ slug: p.project.slug, access: p.editor, expectedRevision, activityId, previewToken: preview.previewToken, confirmed: true });
}
async function restoreDependencyFlow(p: Awaited<ReturnType<typeof project>>, dependencyId: number, access?: string) {
  return caller.primaveraLite.restoreDependency({ slug: p.project.slug, access: access ?? p.editor, expectedRevision: await revision(p), dependencyId, confirmed: true });
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

  it("listDependencies excludes archived by default and includeArchived returns them with all fields preserved", async () => {
    const p = await project("PR-DEP-RESTORE Listing"); const a = await activity(p, "A"); const b = await activity(p, "B");
    const kept = await createDependency(p, a.id, b.id, "FS", 0);
    const toArchive = await createDependency(p, a.id, b.id, "SF", -3);
    await archiveDependencyFlow(p, toArchive.dependency.id);

    // Default behavior unchanged: active only, for both explicit false and absent flag.
    const defaults = await caller.primaveraLite.listDependencies({ slug: p.project.slug, access: p.viewer });
    expect(defaults.dependencies.map((row) => row.id)).toEqual([kept.dependency.id]);
    const explicitFalse = await caller.primaveraLite.listDependencies({ slug: p.project.slug, access: p.viewer, includeArchived: false });
    expect(explicitFalse.dependencies.map((row) => row.id)).toEqual([kept.dependency.id]);

    // includeArchived returns active + archived, id-ordered, with relationship fields intact.
    const all = await caller.primaveraLite.listDependencies({ slug: p.project.slug, access: p.viewer, includeArchived: true });
    expect(all.dependencies.map((row) => row.id)).toEqual([kept.dependency.id, toArchive.dependency.id]);
    const archivedRow = all.dependencies.find((row) => row.id === toArchive.dependency.id)!;
    expect(archivedRow.archivedAt).not.toBeNull();
    expect(archivedRow).toMatchObject({ predecessorActivityId: a.id, successorActivityId: b.id, dependencyType: "SF", lagDays: -3 });

    // Cross-project isolation: another project's includeArchived listing never leaks these rows.
    const other = await project("PR-DEP-RESTORE Other");
    const foreign = await caller.primaveraLite.listDependencies({ slug: other.project.slug, access: other.viewer, includeArchived: true });
    expect(foreign.dependencies).toEqual([]);
  });

  it("restore preserves id/type/lag/endpoints and rejects already-active, stale revision and viewer", async () => {
    const p = await project("PR-DEP-RESTORE Guards"); const a = await activity(p, "A"); const b = await activity(p, "B");
    const created = await createDependency(p, a.id, b.id, "FF", 4);
    await archiveDependencyFlow(p, created.dependency.id);

    // Viewer cannot restore.
    await expect(restoreDependencyFlow(p, created.dependency.id, p.viewer)).rejects.toThrow(/Editor or admin/i);
    // Stale revision is a controlled conflict and must not restore.
    const current = await revision(p);
    await expect(caller.primaveraLite.restoreDependency({ slug: p.project.slug, access: p.editor, expectedRevision: current - 1, dependencyId: created.dependency.id, confirmed: true })).rejects.toMatchObject({ code: "CONFLICT" });
    // Failed attempts above must not advance the project revision.
    expect(await revision(p)).toBe(current);

    const restored = await restoreDependencyFlow(p, created.dependency.id);
    expect(restored.dependency).toMatchObject({ id: created.dependency.id, predecessorActivityId: a.id, successorActivityId: b.id, dependencyType: "FF", lagDays: 4 });
    expect(restored.dependency.archivedAt).toBeNull();
    // Successful restore advances the revision exactly once.
    expect(restored.revision).toBe(current + 1);
    expect(await revision(p)).toBe(current + 1);

    // Restoring an already-active dependency is rejected without another revision bump.
    await expect(restoreDependencyFlow(p, created.dependency.id)).rejects.toThrow(/Archived dependency not found/i);
    expect(await revision(p)).toBe(current + 1);
  });

  it("restore is blocked by archived endpoints, duplicate active dependency and cycles", async () => {
    const p = await project("PR-DEP-RESTORE Safety"); const a = await activity(p, "A"); const b = await activity(p, "B");

    // Archived predecessor blocks restore (dependency archived via activity cascade).
    const dep = await createDependency(p, a.id, b.id, "FS", 0);
    await archiveActivityFlow(p, a.id);
    const before = await revision(p);
    await expect(restoreDependencyFlow(p, dep.dependency.id)).rejects.toThrow(/Archived activities/i);
    expect(await revision(p)).toBe(before);
    await caller.primaveraLite.restoreActivity({ slug: p.project.slug, access: p.editor, expectedRevision: await revision(p), activityId: a.id });

    // Archived successor blocks restore.
    await archiveActivityFlow(p, b.id);
    await expect(restoreDependencyFlow(p, dep.dependency.id)).rejects.toThrow(/Archived activities/i);
    await caller.primaveraLite.restoreActivity({ slug: p.project.slug, access: p.editor, expectedRevision: await revision(p), activityId: b.id });

    // Duplicate active dependency blocks restore: same endpoints + type re-created while archived.
    const replacement = await createDependency(p, a.id, b.id, "FS", 9);
    await expect(restoreDependencyFlow(p, dep.dependency.id)).rejects.toThrow(/Duplicate active dependency/i);
    await archiveDependencyFlow(p, replacement.dependency.id);

    // Cycle-producing restore is blocked: B -> A became active while A -> B was archived.
    const reverse = await createDependency(p, b.id, a.id, "FS", 0);
    await expect(restoreDependencyFlow(p, dep.dependency.id)).rejects.toThrow(/circular/i);

    // Removing the reverse edge makes the same restore succeed.
    await archiveDependencyFlow(p, reverse.dependency.id);
    const restored = await restoreDependencyFlow(p, dep.dependency.id);
    expect(restored.dependency.archivedAt).toBeNull();
  });

  it("dependency archive and restore both flip the schedule to Out of Date through revision/event semantics", async () => {
    const p = await project("PR-DEP-RESTORE Staleness"); const a = await activity(p, "A"); const b = await activity(p, "B");
    const dep = await createDependency(p, a.id, b.id, "FS", 0);

    await caller.primaveraLite.runSchedule({ slug: p.project.slug, access: p.editor, expectedRevision: await revision(p) });
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.viewer });
    expect(loaded.project?.scheduleOutOfDate).toBe(false);

    await archiveDependencyFlow(p, dep.dependency.id);
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.viewer });
    expect(loaded.project?.scheduleOutOfDate).toBe(true);

    await caller.primaveraLite.runSchedule({ slug: p.project.slug, access: p.editor, expectedRevision: await revision(p) });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.viewer });
    expect(loaded.project?.scheduleOutOfDate).toBe(false);

    await restoreDependencyFlow(p, dep.dependency.id);
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.viewer });
    expect(loaded.project?.scheduleOutOfDate).toBe(true);
  });

  it("PR #359 acceptance: activity restore leaves the dependency archived until it is explicitly restored", async () => {
    const p = await project("PR-DEP-RESTORE Acceptance"); const a = await activity(p, "A"); const b = await activity(p, "B");
    // 1. A -> B active. 2-3. Archiving A cascades the dependency to archived.
    const dep = await createDependency(p, a.id, b.id, "FS", 2);
    await archiveActivityFlow(p, a.id);
    let all = await caller.primaveraLite.listDependencies({ slug: p.project.slug, access: p.editor, includeArchived: true });
    expect(all.dependencies.find((row) => row.id === dep.dependency.id)?.archivedAt).not.toBeNull();

    // 4-5. Restoring A reports archived dependencies and does NOT auto-restore them.
    const restoredActivity = await caller.primaveraLite.restoreActivity({ slug: p.project.slug, access: p.editor, expectedRevision: await revision(p), activityId: a.id });
    expect(restoredActivity.hasArchivedDependencies).toBe(true);
    expect((await caller.primaveraLite.listDependencies({ slug: p.project.slug, access: p.editor })).dependencies).toEqual([]);

    // 6. The archived listing the panel uses still shows it.
    all = await caller.primaveraLite.listDependencies({ slug: p.project.slug, access: p.editor, includeArchived: true });
    expect(all.dependencies.map((row) => row.id)).toEqual([dep.dependency.id]);

    // 7-10. Explicit restore succeeds with both endpoints active; same row returns, no duplicate created.
    const restored = await restoreDependencyFlow(p, dep.dependency.id);
    expect(restored.dependency).toMatchObject({ id: dep.dependency.id, predecessorActivityId: a.id, successorActivityId: b.id, dependencyType: "FS", lagDays: 2 });
    const active = await caller.primaveraLite.listDependencies({ slug: p.project.slug, access: p.viewer });
    expect(active.dependencies.map((row) => row.id)).toEqual([dep.dependency.id]);
    const rows = await testDb.select().from(ganttActivityDependencies).where(eq(ganttActivityDependencies.projectId, p.project.id));
    expect(rows).toHaveLength(1);
  });
});
