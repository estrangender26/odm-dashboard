import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { sql, eq, inArray } from "drizzle-orm";
import { ganttProjects, ganttWbsNodes, ganttActivities, ganttProjectEvents } from "@db/schema";
import { appRouter } from "./router";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";

const DATABASE_URL = process.env.DATABASE_URL_TEST || "postgresql://postgres:postgres@localhost:5433/primavera_test?sslmode=disable";

const client = postgres(DATABASE_URL, { ssl: false, prepare: false, max: 5 });
const testDb = drizzle(client, { schema });

const caller = appRouter.createCaller({
  req: new Request("http://localhost/api/trpc"),
  resHeaders: new Headers(),
  user: undefined,
} as any);

function extractToken(link: string): string {
  return new URL("http://localhost" + link).searchParams.get("access")!;
}

const createdProjectIds: number[] = [];
const createdActivityIds: number[] = [];

function assertDisposableTestDatabase() {
  if (process.env.PRIMAVERA_PR1_TEST_DB !== "1") {
    throw new Error("PRIMAVERA_PR1_TEST_DB=1 is required to run these tests");
  }
  const url = new URL(DATABASE_URL);
  const dbName = url.pathname.replace(/^\//, "");
  if (!/^(primavera_test|odmtest)/.test(dbName)) {
    throw new Error(`Refusing to run tests against non-disposable database: ${dbName}`);
  }
}

describe("primaveraLite router PR1", () => {
  beforeAll(async () => {
    assertDisposableTestDatabase();
  });

  afterAll(async () => {
    if (createdActivityIds.length > 0) {
      await testDb.delete(ganttActivities).where(inArray(ganttActivities.id, createdActivityIds));
    }
    if (createdProjectIds.length > 0) {
      await testDb.delete(ganttProjectEvents).where(inArray(ganttProjectEvents.projectId, createdProjectIds));
      await testDb.delete(ganttWbsNodes).where(inArray(ganttWbsNodes.projectId, createdProjectIds));
      await testDb.delete(ganttProjects).where(inArray(ganttProjects.id, createdProjectIds));
    }
    await client.end();
  });

  it("creates a project with admin/editor/viewer tokens and root WBS node", async () => {
    const created = await caller.primaveraLite.createProject({ name: "PR1 Test Project" });
    expect(created.project).toBeDefined();
    expect(created.rootWbsNode).toBeDefined();
    expect(created.rootWbsNode.code).toBe("1");
    expect(created.adminLink).toContain("/gantt/p/");
    expect(created.editorLink).toContain("/gantt/p/");
    expect(created.viewerLink).toContain("/gantt/p/");

    createdProjectIds.push(created.project.id);

    const rows = await testDb.select({ adminHash: ganttProjects.adminTokenHash, editorHash: ganttProjects.editTokenHash, viewerHash: ganttProjects.viewTokenHash }).from(ganttProjects).where(eq(ganttProjects.slug, created.project.slug));
    expect(rows[0].adminHash).not.toBe(extractToken(created.adminLink));
    expect(rows[0].editorHash).not.toBe(extractToken(created.editorLink));
    expect(rows[0].viewerHash).not.toBe(extractToken(created.viewerLink));
    expect(rows[0].adminHash).toHaveLength(64);
  });

  it("loads project with role and returns creation event for sinceRevision: 0", async () => {
    const created = await caller.primaveraLite.createProject({ name: "PR1 Since Zero" });
    createdProjectIds.push(created.project.id);
    const adminToken = extractToken(created.adminLink);

    const loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken, sinceRevision: 0 });
    expect(loaded.role).toBe("admin");
    expect(loaded.wbsNodes.length).toBe(1);
    expect(loaded.events.length).toBeGreaterThanOrEqual(1);
    expect(loaded.events.some((e) => e.action === "create")).toBe(true);

    const noEvents = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    expect(noEvents.events.length).toBe(0);
  });

  it("editor can create an activity", async () => {
    const created = await caller.primaveraLite.createProject({ name: "PR1 Editor Activity" });
    createdProjectIds.push(created.project.id);
    const editorToken = extractToken(created.editorLink);

    const before = await caller.primaveraLite.load({ slug: created.project.slug, access: editorToken });
    const result = await caller.primaveraLite.createActivity({ slug: created.project.slug, access: editorToken, expectedRevision: before.revision, activity: { activityName: "Task A" } });
    createdActivityIds.push(result.activity.id);
    expect(result.activity.activityName).toBe("Task A");
    expect(result.revision).toBe(before.revision + 1);
  });

  it("viewer cannot mutate", async () => {
    const created = await caller.primaveraLite.createProject({ name: "PR1 Viewer Guard" });
    createdProjectIds.push(created.project.id);
    const viewerToken = extractToken(created.viewerLink);

    const loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: viewerToken });
    await expect(
      caller.primaveraLite.createActivity({ slug: created.project.slug, access: viewerToken, expectedRevision: loaded.revision, activity: { activityName: "No" } })
    ).rejects.toThrow();
  });

  it("editor cannot archive project", async () => {
    const created = await caller.primaveraLite.createProject({ name: "PR1 Editor No Archive" });
    createdProjectIds.push(created.project.id);
    const editorToken = extractToken(created.editorLink);

    const loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: editorToken });
    await expect(
      caller.primaveraLite.archiveProjectDryRun({ slug: created.project.slug, access: editorToken, expectedRevision: loaded.revision })
    ).rejects.toThrow(/admin|forbidden/i);
  });

  it("stale revision returns CONFLICT", async () => {
    const created = await caller.primaveraLite.createProject({ name: "PR1 Stale Revision" });
    createdProjectIds.push(created.project.id);
    const adminToken = extractToken(created.adminLink);

    const loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await expect(
      caller.primaveraLite.updateProjectMeta({ slug: created.project.slug, access: adminToken, expectedRevision: loaded.revision - 1, changes: { name: "Old" } })
    ).rejects.toThrow(/updated by another user|CONFLICT/);
  });

  it("admin can archive project after dry-run", async () => {
    const fresh = await caller.primaveraLite.createProject({ name: "PR1 Archive Project" });
    createdProjectIds.push(fresh.project.id);
    const freshSlug = fresh.project.slug;
    const freshAdmin = extractToken(fresh.adminLink);
    const freshEditor = extractToken(fresh.editorLink);

    const loaded = await caller.primaveraLite.load({ slug: freshSlug, access: freshAdmin });
    const activity = await caller.primaveraLite.createActivity({ slug: freshSlug, access: freshEditor, expectedRevision: loaded.revision, activity: { activityName: "Activity to archive" } });
    createdActivityIds.push(activity.activity.id);

    const loaded2 = await caller.primaveraLite.load({ slug: freshSlug, access: freshAdmin });
    const dryRun = await caller.primaveraLite.archiveProjectDryRun({ slug: freshSlug, access: freshAdmin, expectedRevision: loaded2.revision });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.wouldArchive.project).toBe(1);
    expect(dryRun.previewToken).toBeTruthy();

    const archived = await caller.primaveraLite.archiveProject({ slug: freshSlug, access: freshAdmin, expectedRevision: loaded2.revision, previewToken: dryRun.previewToken, confirmed: true });
    expect(archived.project.archivedAt).toBeTruthy();

    await expect(caller.primaveraLite.load({ slug: freshSlug, access: extractToken(fresh.viewerLink) })).rejects.toThrow();
    await expect(caller.primaveraLite.load({ slug: freshSlug, access: freshAdmin })).rejects.toThrow();
  });

  it("restores project and preserves independently archived activity", async () => {
    const fresh = await caller.primaveraLite.createProject({ name: "PR1 Restore Project" });
    createdProjectIds.push(fresh.project.id);
    const freshSlug = fresh.project.slug;
    const freshAdmin = extractToken(fresh.adminLink);
    const freshEditor = extractToken(fresh.editorLink);

    const loaded1 = await caller.primaveraLite.load({ slug: freshSlug, access: freshAdmin });
    const activeActivity = await caller.primaveraLite.createActivity({ slug: freshSlug, access: freshEditor, expectedRevision: loaded1.revision, activity: { activityName: "Active Activity" } });
    createdActivityIds.push(activeActivity.activity.id);

    const loaded2 = await caller.primaveraLite.load({ slug: freshSlug, access: freshAdmin });
    const toArchiveActivity = await caller.primaveraLite.createActivity({ slug: freshSlug, access: freshEditor, expectedRevision: loaded2.revision, activity: { activityName: "To Archive Activity" } });
    createdActivityIds.push(toArchiveActivity.activity.id);

    const loaded3 = await caller.primaveraLite.load({ slug: freshSlug, access: freshAdmin });
    const dryRunActivity = await caller.primaveraLite.archiveActivityDryRun({ slug: freshSlug, access: freshEditor, expectedRevision: loaded3.revision, activityId: toArchiveActivity.activity.id });
    await caller.primaveraLite.archiveActivity({ slug: freshSlug, access: freshEditor, expectedRevision: loaded3.revision, activityId: toArchiveActivity.activity.id, previewToken: dryRunActivity.previewToken, confirmed: true });

    const loaded4 = await caller.primaveraLite.load({ slug: freshSlug, access: freshAdmin });
    expect(loaded4.activities.length).toBe(1);

    const dryRunProject = await caller.primaveraLite.archiveProjectDryRun({ slug: freshSlug, access: freshAdmin, expectedRevision: loaded4.revision });
    await caller.primaveraLite.archiveProject({ slug: freshSlug, access: freshAdmin, expectedRevision: loaded4.revision, previewToken: dryRunProject.previewToken, confirmed: true });

    const loaded5 = await caller.primaveraLite.load({ slug: freshSlug, access: freshAdmin }).catch(() => null);
    expect(loaded5).toBeNull();

    await caller.primaveraLite.restoreProject({ slug: freshSlug, access: freshAdmin, expectedRevision: loaded4.revision + 1, confirmed: true });

    const afterRestore = await caller.primaveraLite.load({ slug: freshSlug, access: freshAdmin });
    expect(afterRestore.project.archivedAt).toBeFalsy();
    expect(afterRestore.activities.length).toBe(1);
    expect(afterRestore.activities[0].activityName).toBe("Active Activity");

    const archivedRows = await testDb
      .select({ archivedAt: ganttActivities.archivedAt })
      .from(ganttActivities)
      .where(eq(ganttActivities.id, toArchiveActivity.activity.id));
    expect(archivedRows[0].archivedAt).toBeTruthy();
  });

  it("stale restore returns CONFLICT", async () => {
    const fresh = await caller.primaveraLite.createProject({ name: "PR1 Stale Restore" });
    createdProjectIds.push(fresh.project.id);
    const freshSlug = fresh.project.slug;
    const freshAdmin = extractToken(fresh.adminLink);

    const loaded = await caller.primaveraLite.load({ slug: freshSlug, access: freshAdmin });
    const dryRunProject = await caller.primaveraLite.archiveProjectDryRun({ slug: freshSlug, access: freshAdmin, expectedRevision: loaded.revision });
    const archived = await caller.primaveraLite.archiveProject({ slug: freshSlug, access: freshAdmin, expectedRevision: loaded.revision, previewToken: dryRunProject.previewToken, confirmed: true });

    await expect(
      caller.primaveraLite.restoreProject({ slug: freshSlug, access: freshAdmin, expectedRevision: loaded.revision, confirmed: true })
    ).rejects.toThrow(/updated by another user|CONFLICT/);

    const restored = await caller.primaveraLite.restoreProject({ slug: freshSlug, access: freshAdmin, expectedRevision: archived.revision, confirmed: true });
    expect(restored.project.archivedAt).toBeFalsy();
  });

  it("archive execution without preview token fails with BAD_REQUEST", async () => {
    const fresh = await caller.primaveraLite.createProject({ name: "PR1 No Preview Token" });
    createdProjectIds.push(fresh.project.id);
    const freshSlug = fresh.project.slug;
    const freshAdmin = extractToken(fresh.adminLink);

    const loaded = await caller.primaveraLite.load({ slug: freshSlug, access: freshAdmin });
    await expect(
      caller.primaveraLite.archiveProject({ slug: freshSlug, access: freshAdmin, expectedRevision: loaded.revision, previewToken: "no-preview", confirmed: true })
    ).rejects.toThrow(/BAD_REQUEST|Invalid preview token/);
  });

  it("malformed preview token returns controlled BAD_REQUEST", async () => {
    const fresh = await caller.primaveraLite.createProject({ name: "PR1 Malformed Preview" });
    createdProjectIds.push(fresh.project.id);
    const freshSlug = fresh.project.slug;
    const freshAdmin = extractToken(fresh.adminLink);

    const loaded = await caller.primaveraLite.load({ slug: freshSlug, access: freshAdmin });
    await expect(
      caller.primaveraLite.archiveProject({ slug: freshSlug, access: freshAdmin, expectedRevision: loaded.revision, previewToken: "not-a-token", confirmed: true })
    ).rejects.toThrow(/BAD_REQUEST|Invalid preview token/);
  });

  it("expired preview token returns controlled BAD_REQUEST", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fresh = await caller.primaveraLite.createProject({ name: "PR1 Expired Preview" });
    createdProjectIds.push(fresh.project.id);
    const freshSlug = fresh.project.slug;
    const freshAdmin = extractToken(fresh.adminLink);

    const loaded = await caller.primaveraLite.load({ slug: freshSlug, access: freshAdmin });
    const dryRun = await caller.primaveraLite.archiveProjectDryRun({ slug: freshSlug, access: freshAdmin, expectedRevision: loaded.revision });

    // Travel forward so the 5-minute preview token expires.
    vi.advanceTimersByTime(6 * 60 * 1000);

    await expect(
      caller.primaveraLite.archiveProject({ slug: freshSlug, access: freshAdmin, expectedRevision: loaded.revision, previewToken: dryRun.previewToken, confirmed: true })
    ).rejects.toThrow(/expired|BAD_REQUEST/);
    vi.useRealTimers();
  }, 10_000);

  it("stale preview revision returns CONFLICT", async () => {
    const fresh = await caller.primaveraLite.createProject({ name: "PR1 Preview Stale" });
    createdProjectIds.push(fresh.project.id);
    const freshSlug = fresh.project.slug;
    const freshAdmin = extractToken(fresh.adminLink);

    const loaded = await caller.primaveraLite.load({ slug: freshSlug, access: freshAdmin });
    const dryRun = await caller.primaveraLite.archiveProjectDryRun({ slug: freshSlug, access: freshAdmin, expectedRevision: loaded.revision });

    await caller.primaveraLite.updateProjectMeta({ slug: freshSlug, access: freshAdmin, expectedRevision: loaded.revision, changes: { description: "bump" } });

    await expect(
      caller.primaveraLite.archiveProject({ slug: freshSlug, access: freshAdmin, expectedRevision: loaded.revision, previewToken: dryRun.previewToken, confirmed: true })
    ).rejects.toThrow(/Project was updated by another user|CONFLICT/);
  });

  it("activity update works when project revision differs from activity revision", async () => {
    const fresh = await caller.primaveraLite.createProject({ name: "PR1 Activity Revision" });
    createdProjectIds.push(fresh.project.id);
    const freshSlug = fresh.project.slug;
    const freshEditor = extractToken(fresh.editorLink);

    const loaded = await caller.primaveraLite.load({ slug: freshSlug, access: freshEditor });
    const activity = await caller.primaveraLite.createActivity({ slug: freshSlug, access: freshEditor, expectedRevision: loaded.revision, activity: { activityName: "Task B" } });
    createdActivityIds.push(activity.activity.id);

    const loaded2 = await caller.primaveraLite.load({ slug: freshSlug, access: freshEditor });
    const updated = await caller.primaveraLite.updateActivity({
      slug: freshSlug,
      access: freshEditor,
      expectedRevision: loaded2.revision,
      activityId: activity.activity.id,
      changes: { activityName: "Task B Updated" },
    });
    expect(updated.activity.activityName).toBe("Task B Updated");
  });

  it("cross-project IDs rejected", async () => {
    const other = await caller.primaveraLite.createProject({ name: "Other PR1" });
    createdProjectIds.push(other.project.id);
    const otherToken = extractToken(other.adminLink);

    const loaded = await caller.primaveraLite.load({ slug: other.project.slug, access: otherToken });
    await expect(
      caller.primaveraLite.updateActivity({ slug: other.project.slug, access: otherToken, expectedRevision: loaded.revision, activityId: 999999, changes: {} })
    ).rejects.toThrow();
  });

  it("unrelated pre-existing rows survive the test lifecycle", async () => {
    const survivor = await caller.primaveraLite.createProject({ name: "PR1 Survivor" });
    const slug = survivor.project.slug;
    const adminToken = extractToken(survivor.adminLink);

    const loaded = await caller.primaveraLite.load({ slug, access: adminToken });
    expect(loaded.project?.name).toBe("PR1 Survivor");

    const disposable = await caller.primaveraLite.createProject({ name: "PR1 Disposable" });
    createdProjectIds.push(disposable.project.id);
    const disposableAdmin = extractToken(disposable.adminLink);
    const disposableLoaded = await caller.primaveraLite.load({ slug: disposable.project.slug, access: disposableAdmin });
    expect(disposableLoaded.project).toBeTruthy();

    const trackedActivityIds = await testDb
      .select({ id: ganttActivities.id })
      .from(ganttActivities)
      .where(inArray(ganttActivities.projectId, createdProjectIds));
    await testDb.delete(ganttActivities).where(inArray(ganttActivities.id, trackedActivityIds.map((r) => r.id)));
    await testDb.delete(ganttProjectEvents).where(inArray(ganttProjectEvents.projectId, createdProjectIds));
    await testDb.delete(ganttWbsNodes).where(inArray(ganttWbsNodes.projectId, createdProjectIds));
    await testDb.delete(ganttProjects).where(inArray(ganttProjects.id, createdProjectIds));

    const survivorStillThere = await caller.primaveraLite.load({ slug, access: adminToken });
    expect(survivorStillThere.project?.name).toBe("PR1 Survivor");
  });
});
