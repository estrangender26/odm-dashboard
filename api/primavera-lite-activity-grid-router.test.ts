import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import { ganttActivities, ganttActivityDependencies, ganttCalendars, ganttProjectEvents, ganttProjects, ganttWbsNodes } from "@db/schema";
import { appRouter } from "./router";

const DATABASE_URL = process.env.DATABASE_URL_TEST || "postgresql://postgres:postgres@localhost:5433/odmtest_pr3?sslmode=disable";
const client = postgres(DATABASE_URL, { ssl: false, prepare: false, max: 5 });
const testDb = drizzle(client, { schema });
const caller = appRouter.createCaller({ req: new Request("http://localhost/api/trpc"), resHeaders: new Headers(), user: undefined } as any);
const projectIds: number[] = [];
const token = (link: string) => new URL(`http://localhost${link}`).searchParams.get("access")!;

function assertDisposableDatabase() {
  if (process.env.PRIMAVERA_PR1_TEST_DB !== "1") throw new Error("PRIMAVERA_PR1_TEST_DB=1 is required");
  if (!/^\/(primavera_test|odmtest)/.test(new URL(DATABASE_URL).pathname)) throw new Error("Refusing non-disposable database");
}

async function createProject(name: string) {
  const created = await caller.primaveraLite.createProject({ name });
  projectIds.push(created.project.id);
  return { ...created, admin: token(created.adminLink), editor: token(created.editorLink), viewer: token(created.viewerLink) };
}

describe("Primavera Lite PR3 Activity Grid", () => {
  beforeAll(assertDisposableDatabase);
  afterAll(async () => {
    if (projectIds.length) {
      await testDb.delete(ganttActivityDependencies).where(inArray(ganttActivityDependencies.projectId, projectIds));
      await testDb.delete(ganttActivities).where(inArray(ganttActivities.projectId, projectIds));
      await testDb.delete(ganttProjectEvents).where(inArray(ganttProjectEvents.projectId, projectIds));
      await testDb.delete(ganttWbsNodes).where(inArray(ganttWbsNodes.projectId, projectIds));
      await testDb.delete(ganttCalendars).where(inArray(ganttCalendars.projectId, projectIds));
      await testDb.delete(ganttProjects).where(inArray(ganttProjects.id, projectIds));
    }
    await client.end();
  });

  it("creates deterministic contiguous order and accepts nullable calendar", async () => {
    const project = await createProject("PR3 Create Order");
    let loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const first = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "First", calendarId: null } });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const second = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "Second" } });
    expect([first.activity.sortOrder, second.activity.sortOrder]).toEqual([0, 1]);
  });

  it("reorders within WBS atomically and rejects stale reorder", async () => {
    const project = await createProject("PR3 Reorder");
    let loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const a = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "A" } });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const b = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "B" } });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const moved = await caller.primaveraLite.reorderActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: b.activity.id, targetWbsNodeId: b.activity.wbsNodeId, newSortOrder: 0 });
    expect(moved.revision).toBe(loaded.revision + 1);
    const after = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    expect(after.activities.map((row) => [row.id, row.sortOrder])).toEqual([[b.activity.id, 0], [a.activity.id, 1]]);
    await expect(caller.primaveraLite.reorderActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: a.activity.id, targetWbsNodeId: a.activity.wbsNodeId, newSortOrder: 0 })).rejects.toThrow(/updated by another user/i);
  });

  it("moves across leaf WBS nodes and normalizes both groups", async () => {
    const project = await createProject("PR3 Cross WBS");
    let loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const left = await caller.primaveraLite.createWbsNode({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, parentNodeId: project.rootWbsNode.id, name: "Left" });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const right = await caller.primaveraLite.createWbsNode({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, parentNodeId: project.rootWbsNode.id, name: "Right" });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const a = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, wbsNodeId: left.node.id, activity: { activityName: "A" } });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const b = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, wbsNodeId: left.node.id, activity: { activityName: "B" } });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    await caller.primaveraLite.reorderActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: a.activity.id, targetWbsNodeId: right.node.id, newSortOrder: 0 });
    const after = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    expect(after.activities.find((row) => row.id === a.activity.id)).toMatchObject({ wbsNodeId: right.node.id, sortOrder: 0 });
    expect(after.activities.find((row) => row.id === b.activity.id)).toMatchObject({ wbsNodeId: left.node.id, sortOrder: 0 });
  });

  it("validates calendar ownership, WBS ownership/leaf state, and edit boundaries", async () => {
    const project = await createProject("PR3 Validation");
    const other = await createProject("PR3 Other");
    const [calendar] = await testDb.insert(ganttCalendars).values({ projectId: project.project.id, name: "Project Calendar" }).returning();
    const [foreignCalendar] = await testDb.insert(ganttCalendars).values({ projectId: other.project.id, name: "Foreign Calendar" }).returning();
    let loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const activity = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "Valid", originalDurationDays: 0, percentComplete: 100, actualFinish: "2026-08-10", calendarId: calendar.id } });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    await expect(caller.primaveraLite.updateActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: activity.activity.id, changes: { calendarId: foreignCalendar.id } })).rejects.toThrow(/Calendar not found/i);
    await expect(caller.primaveraLite.updateActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: activity.activity.id, changes: { wbsNodeId: other.rootWbsNode.id } })).rejects.toThrow(/WBS node not found/i);
    await expect(caller.primaveraLite.updateActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: activity.activity.id, changes: {} })).rejects.toThrow();
    await expect(caller.primaveraLite.updateActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: activity.activity.id, changes: { percentComplete: 101 } })).rejects.toThrow();
    await expect(caller.primaveraLite.updateActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: activity.activity.id, changes: { originalDurationDays: -1 } })).rejects.toThrow();
  });

  it("viewer cannot reorder and successful edit writes exactly one revisioned audit event", async () => {
    const project = await createProject("PR3 Audit");
    let loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const activity = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "Before" } });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    await expect(caller.primaveraLite.reorderActivity({ slug: project.project.slug, access: project.viewer, expectedRevision: loaded.revision, activityId: activity.activity.id, targetWbsNodeId: activity.activity.wbsNodeId, newSortOrder: 0 })).rejects.toThrow(/Editor or admin/i);
    const updated = await caller.primaveraLite.updateActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: activity.activity.id, changes: { activityName: "After" } });
    const events = await testDb.select().from(ganttProjectEvents).where(eq(ganttProjectEvents.projectId, project.project.id));
    const updateEvents = events.filter((event) => event.entityId === activity.activity.id && event.action === "update");
    expect(updateEvents).toHaveLength(1);
    expect(updateEvents[0].projectRevision).toBe(updated.revision);
  });

  it("restores an archived activity and rejects invalid attempts", async () => {
    const project = await createProject("PR3 Restore");
    let loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const activity = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "To Restore", activityId: "AR-01" } });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const dryRun = await caller.primaveraLite.archiveActivityDryRun({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: activity.activity.id });
    const archived = await caller.primaveraLite.archiveActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: activity.activity.id, previewToken: dryRun.previewToken, confirmed: true });
    expect(archived.activity.archivedAt).not.toBeNull();

    // Reject restore by viewer
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    await expect(caller.primaveraLite.restoreActivity({ slug: project.project.slug, access: project.viewer, expectedRevision: loaded.revision, activityId: activity.activity.id })).rejects.toThrow(/Editor or admin/i);

    // Reject restore with stale revision
    await expect(caller.primaveraLite.restoreActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision - 1, activityId: activity.activity.id })).rejects.toThrow(/updated by another user/i);

    // Successful restore
    const restored = await caller.primaveraLite.restoreActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: activity.activity.id, actorName: "Restorer" });
    expect(restored.activity.id).toBe(activity.activity.id);
    expect(restored.activity.archivedAt).toBeNull();
    expect(restored.revision).toBe(loaded.revision + 1);

    // Load includes restored activity by default; includeArchived returns it too
    const after = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    expect(after.activities.some((a) => a.id === activity.activity.id)).toBe(true);
    const withArchived = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor, includeArchived: true });
    expect(withArchived.activities.some((a) => a.id === activity.activity.id)).toBe(true);

    // Audit event recorded
    const events = await testDb.select().from(ganttProjectEvents).where(eq(ganttProjectEvents.projectId, project.project.id));
    const restoreEvents = events.filter((e) => e.entityId === activity.activity.id && e.action === "restore");
    expect(restoreEvents).toHaveLength(1);
    expect(restoreEvents[0].actorName).toBe("Restorer");
    expect(restoreEvents[0].projectRevision).toBe(restored.revision);

    // Reject restoring already-active activity
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    await expect(caller.primaveraLite.restoreActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: activity.activity.id })).rejects.toThrow(/not archived/i);
  });

  it("refuses to restore an activity whose original WBS node is archived", async () => {
    const project = await createProject("PR3 Restore WBS Block");
    let loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const childWbs = await caller.primaveraLite.createWbsNode({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, parentNodeId: project.rootWbsNode.id, name: "Child WBS" });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const activity = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, wbsNodeId: childWbs.node.id, activity: { activityName: "Child Activity" } });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const dryRun = await caller.primaveraLite.archiveActivityDryRun({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: activity.activity.id });
    await caller.primaveraLite.archiveActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: activity.activity.id, previewToken: dryRun.previewToken, confirmed: true });

    // Archive the WBS node that owns the activity. Need admin for WBS archive.
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.admin });
    const wbsDryRun = await caller.primaveraLite.archiveWbsNodeDryRun({ slug: project.project.slug, access: project.admin, expectedRevision: loaded.revision, nodeId: activity.activity.wbsNodeId });
    await caller.primaveraLite.archiveWbsNode({ slug: project.project.slug, access: project.admin, expectedRevision: loaded.revision, nodeId: activity.activity.wbsNodeId, previewToken: wbsDryRun.previewToken, confirmed: true });

    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor, includeArchived: true });
    await expect(caller.primaveraLite.restoreActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: activity.activity.id })).rejects.toThrow(/WBS node is archived/i);
  });

  it("F-03: duplicate active Activity IDs are rejected on create", async () => {
    const project = await createProject("PR3 Duplicate Create");
    let loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const first = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "First", activityId: "AID-1" } });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    await expect(
      caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "Second", activityId: "AID-1" } })
    ).rejects.toThrow(/same Activity ID already exists/i);
  });

  it("F-03: duplicate active Activity IDs are rejected on update", async () => {
    const project = await createProject("PR3 Duplicate Update");
    let loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const first = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "First", activityId: "AID-1" } });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const second = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "Second", activityId: "AID-2" } });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    await expect(
      caller.primaveraLite.updateActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: second.activity.id, changes: { activityId: "AID-1" } })
    ).rejects.toThrow(/same Activity ID already exists/i);
  });

  it("F-03: blank and whitespace-only Activity IDs normalize to NULL; case is preserved", async () => {
    const project = await createProject("PR3 ID Normalization");
    let loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const blank = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "Blank", activityId: "   " } });
    expect(blank.activity.activityId).toBeNull();
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const padded = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "Padded", activityId: " A-100 " } });
    expect(padded.activity.activityId).toBe("A-100");
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const lower = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "Lower", activityId: "a-100" } });
    expect(lower.activity.activityId).toBe("a-100"); // case-sensitive: distinct from "A-100"
  });

  it("refuses to restore an activity if its activityId collides with an active activity", async () => {
    const project = await createProject("PR3 Restore Collision");
    let loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const first = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "To Archive", activityId: "AID-1" } });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const dryRun = await caller.primaveraLite.archiveActivityDryRun({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: first.activity.id });
    await caller.primaveraLite.archiveActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: first.activity.id, previewToken: dryRun.previewToken, confirmed: true });

    // Archived IDs do not reserve the identifier: a new active row may reuse it.
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor, includeArchived: true });
    const second = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "Active Same ID", activityId: "AID-1" } });
    expect(second.activity.activityId).toBe("AID-1");

    // Restoring the archived row now collides with the active one.
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor, includeArchived: true });
    await expect(caller.primaveraLite.restoreActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: first.activity.id })).rejects.toThrow(/same Activity ID already exists/i);
  });

  it("preserves all activity fields during restore", async () => {
    const project = await createProject("PR3 Restore Preserve");
    let loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const activity = await caller.primaveraLite.createActivity({
      slug: project.project.slug,
      access: project.editor,
      expectedRevision: loaded.revision,
      activity: {
        activityName: "Preserve Me",
        activityId: "PRESERVE-1",
        originalDurationDays: 10,
        plannedStart: "2026-08-01",
        plannedFinish: "2026-08-10",
        actualStart: "2026-08-02",
        actualFinish: null,
        percentComplete: 50,
      },
    });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const dryRun = await caller.primaveraLite.archiveActivityDryRun({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: activity.activity.id });
    await caller.primaveraLite.archiveActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: activity.activity.id, previewToken: dryRun.previewToken, confirmed: true });

    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor, includeArchived: true });
    const restored = await caller.primaveraLite.restoreActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: activity.activity.id });
    expect(restored.activity).toMatchObject({
      id: activity.activity.id,
      activityName: "Preserve Me",
      activityId: "PRESERVE-1",
      originalDurationDays: 10,
      plannedStart: "2026-08-01",
      plannedFinish: "2026-08-10",
      actualStart: "2026-08-02",
      actualFinish: null,
      percentComplete: 50,
      wbsNodeId: activity.activity.wbsNodeId,
      archivedAt: null,
    });
  });

  it("does not restore dependencies that were archived alongside the activity", async () => {
    const project = await createProject("PR3 Restore Cascade Dep");
    let loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const a = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "A" } });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const b = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "B" } });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const dep = await caller.primaveraLite.createDependency({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, dependency: { predecessorActivityId: a.activity.id, successorActivityId: b.activity.id, dependencyType: "FS", lagDays: 0 } });

    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const dryRun = await caller.primaveraLite.archiveActivityDryRun({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: a.activity.id });
    await caller.primaveraLite.archiveActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: a.activity.id, previewToken: dryRun.previewToken, confirmed: true });

    let afterArchive = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor, includeArchived: true });
    expect(afterArchive.dependencies.find((d) => d.id === dep.dependency.id)?.archivedAt).not.toBeNull();

    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor, includeArchived: true });
    const restored = await caller.primaveraLite.restoreActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: a.activity.id });
    expect(restored.hasArchivedDependencies).toBe(true);

    let afterRestore = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor, includeArchived: true });
    expect(afterRestore.dependencies.find((d) => d.id === dep.dependency.id)?.archivedAt).not.toBeNull();
  });

  it("leaves independently archived dependencies archived when restoring an activity", async () => {
    const project = await createProject("PR3 Independent Dep Archive");
    let loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const a = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "A" } });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const b = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "B" } });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const dep = await caller.primaveraLite.createDependency({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, dependency: { predecessorActivityId: a.activity.id, successorActivityId: b.activity.id, dependencyType: "FS", lagDays: 0 } });

    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const depDryRun = await caller.primaveraLite.archiveDependencyDryRun({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, dependencyId: dep.dependency.id });
    await caller.primaveraLite.archiveDependency({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, dependencyId: dep.dependency.id, previewToken: depDryRun.previewToken, confirmed: true });

    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const actDryRun = await caller.primaveraLite.archiveActivityDryRun({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: a.activity.id });
    await caller.primaveraLite.archiveActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: a.activity.id, previewToken: actDryRun.previewToken, confirmed: true });

    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor, includeArchived: true });
    const restored = await caller.primaveraLite.restoreActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: a.activity.id });
    expect(restored.hasArchivedDependencies).toBe(true);

    let afterRestore = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor, includeArchived: true });
    expect(afterRestore.dependencies.find((d) => d.id === dep.dependency.id)?.archivedAt).not.toBeNull();
  });

  it("leaves dependencies archived when the other endpoint activity is also archived", async () => {
    const project = await createProject("PR3 Both Activities Archived");
    let loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const a = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "A" } });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const b = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "B" } });
    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const dep = await caller.primaveraLite.createDependency({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, dependency: { predecessorActivityId: a.activity.id, successorActivityId: b.activity.id, dependencyType: "FS", lagDays: 0 } });

    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    let dryRun = await caller.primaveraLite.archiveActivityDryRun({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: a.activity.id });
    await caller.primaveraLite.archiveActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: a.activity.id, previewToken: dryRun.previewToken, confirmed: true });

    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor, includeArchived: true });
    dryRun = await caller.primaveraLite.archiveActivityDryRun({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: b.activity.id });
    await caller.primaveraLite.archiveActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: b.activity.id, previewToken: dryRun.previewToken, confirmed: true });

    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor, includeArchived: true });
    const restored = await caller.primaveraLite.restoreActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: a.activity.id });
    expect(restored.hasArchivedDependencies).toBe(true);

    let afterRestore = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor, includeArchived: true });
    expect(afterRestore.dependencies.find((d) => d.id === dep.dependency.id)?.archivedAt).not.toBeNull();
    // Restored activity A is active; B remains archived, so dependency must stay archived.
    expect(afterRestore.activities.find((row) => row.id === a.activity.id)?.archivedAt).toBeNull();
    expect(afterRestore.activities.find((row) => row.id === b.activity.id)?.archivedAt).not.toBeNull();
  });

  it("marks the project schedule as stale after restoring an activity", async () => {
    const project = await createProject("PR3 Restore Stale");
    let loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    const activity = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "Task", originalDurationDays: 2, plannedStart: "2026-08-01", plannedFinish: "2026-08-02" } });

    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    await caller.primaveraLite.runSchedule({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision });

    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    expect(loaded.project?.scheduleOutOfDate).toBe(false);

    const dryRun = await caller.primaveraLite.archiveActivityDryRun({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: activity.activity.id });
    await caller.primaveraLite.archiveActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: activity.activity.id, previewToken: dryRun.previewToken, confirmed: true });

    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor, includeArchived: true });
    await caller.primaveraLite.restoreActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activityId: activity.activity.id });

    loaded = await caller.primaveraLite.load({ slug: project.project.slug, access: project.editor });
    expect(loaded.project?.scheduleOutOfDate).toBe(true);
  });
});
