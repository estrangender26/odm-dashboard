import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import { ganttActivities, ganttCalendars, ganttProjectEvents, ganttProjects, ganttWbsNodes } from "@db/schema";
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
    const activity = await caller.primaveraLite.createActivity({ slug: project.project.slug, access: project.editor, expectedRevision: loaded.revision, activity: { activityName: "Valid", originalDurationDays: 0, percentComplete: 100, calendarId: calendar.id } });
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
});
