import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import {
  ganttActivities,
  ganttActivityDependencies,
  ganttCalendars,
  ganttProjectEvents,
  ganttProjects,
  ganttWbsNodes,
} from "@db/schema";
import { appRouter } from "./router";

const DATABASE_URL =
  process.env.DATABASE_URL_TEST || "postgresql://postgres:postgres@localhost:5433/odmtest_pr6?sslmode=disable";
const client = postgres(DATABASE_URL, { ssl: false, prepare: false, max: 5 });
const testDb = drizzle(client, { schema });
const caller = appRouter.createCaller({
  req: new Request("http://localhost/api/trpc"),
  resHeaders: new Headers(),
  user: undefined,
} as any);
const projectIds: number[] = [];
const token = (link: string) => new URL(`http://localhost${link}`).searchParams.get("access")!;

function assertDisposableDatabase() {
  if (process.env.PRIMAVERA_PR1_TEST_DB !== "1") throw new Error("PRIMAVERA_PR1_TEST_DB=1 is required");
  if (!/^\/(primavera_test|odmtest)/.test(new URL(DATABASE_URL).pathname)) {
    throw new Error("Refusing non-disposable database");
  }
}

async function createProject(name: string) {
  const created = await caller.primaveraLite.createProject({ name });
  projectIds.push(created.project.id);
  return {
    ...created,
    admin: token(created.adminLink),
    editor: token(created.editorLink),
    viewer: token(created.viewerLink),
  };
}

async function createActivity(access: string, slug: string, revision: number, activity: Record<string, unknown>) {
  const res = await caller.primaveraLite.createActivity({
    slug,
    access,
    expectedRevision: revision,
    activity: activity as never,
  });
  return res;
}

describe("Primavera Lite PR7 Date & Progress Editing", () => {
  beforeAll(assertDisposableDatabase);
  afterAll(async () => {
    if (projectIds.length) {
      await testDb
        .delete(ganttActivityDependencies)
        .where(inArray(ganttActivityDependencies.projectId, projectIds));
      await testDb.delete(ganttProjectEvents).where(inArray(ganttProjectEvents.projectId, projectIds));
      await testDb.delete(ganttActivities).where(inArray(ganttActivities.projectId, projectIds));
      await testDb.delete(ganttCalendars).where(inArray(ganttCalendars.projectId, projectIds));
      await testDb.delete(ganttWbsNodes).where(inArray(ganttWbsNodes.projectId, projectIds));
      await testDb.delete(ganttProjects).where(inArray(ganttProjects.id, projectIds));
    }
    await client.end();
  });

  it("edits planned start/finish and persists them with a single revision bump", async () => {
    const p = await createProject("PR7 Planned Dates");
    const created = await createActivity(p.editor, p.project.slug, p.project.revision, { activityName: "Task A" });
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const res = await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: created.activity.id,
      changes: { plannedStart: "2026-08-10", plannedFinish: "2026-08-13" },
    });
    expect(res.activity.plannedStart).toBe("2026-08-10");
    expect(res.activity.plannedFinish).toBe("2026-08-13");
    expect(res.revision).toBe(loaded.revision + 1);

    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const activity = loaded.activities.find((a) => a.id === created.activity.id);
    expect(activity?.plannedStart).toBe("2026-08-10");
    expect(activity?.plannedFinish).toBe("2026-08-13");
  });

  it("edits actual start/finish independently of planned dates", async () => {
    const p = await createProject("PR7 Actual Dates");
    const created = await createActivity(p.editor, p.project.slug, p.project.revision, {
      activityName: "Task B",
      plannedStart: "2026-08-10",
      plannedFinish: "2026-08-13",
    });
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const res = await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: created.activity.id,
      changes: { actualStart: "2026-08-11", actualFinish: "2026-08-12" },
    });
    expect(res.activity.actualStart).toBe("2026-08-11");
    expect(res.activity.actualFinish).toBe("2026-08-12");
    // planned dates preserved untouched
    expect(res.activity.plannedStart).toBe("2026-08-10");
    expect(res.activity.plannedFinish).toBe("2026-08-13");
  });

  it("allows clearing actual dates back to blank", async () => {
    const p = await createProject("PR7 Clear Actual");
    const created = await createActivity(p.editor, p.project.slug, p.project.revision, { activityName: "Task C" });
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: created.activity.id,
      changes: { actualStart: "2026-08-01", actualFinish: "2026-08-02" },
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const cleared = await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: created.activity.id,
      changes: { actualStart: null, actualFinish: null },
    });
    expect(cleared.activity.actualStart).toBeNull();
    expect(cleared.activity.actualFinish).toBeNull();
  });

  it("rejects an invalid planned range (start after finish)", async () => {
    const p = await createProject("PR7 Invalid Planned");
    const created = await createActivity(p.editor, p.project.slug, p.project.revision, { activityName: "Task D" });
    const loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    await expect(
      caller.primaveraLite.updateActivity({
        slug: p.project.slug,
        access: p.editor,
        expectedRevision: loaded.revision,
        activityId: created.activity.id,
        changes: { plannedStart: "2026-08-10", plannedFinish: "2026-08-05" },
      })
    ).rejects.toThrow(/Planned start must be on or before planned finish/);
  });

  it("rejects an invalid planned range merged with an existing finish", async () => {
    const p = await createProject("PR7 Invalid Planned Merge");
    const created = await createActivity(p.editor, p.project.slug, p.project.revision, { activityName: "Task E" });
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: created.activity.id,
      changes: { plannedFinish: "2026-08-05" },
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    await expect(
      caller.primaveraLite.updateActivity({
        slug: p.project.slug,
        access: p.editor,
        expectedRevision: loaded.revision,
        activityId: created.activity.id,
        changes: { plannedStart: "2026-08-10" },
      })
    ).rejects.toThrow(/Planned start must be on or before planned finish/);
  });

  it("rejects an invalid actual range (start after finish)", async () => {
    const p = await createProject("PR7 Invalid Actual");
    const created = await createActivity(p.editor, p.project.slug, p.project.revision, { activityName: "Task F" });
    const loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    await expect(
      caller.primaveraLite.updateActivity({
        slug: p.project.slug,
        access: p.editor,
        expectedRevision: loaded.revision,
        activityId: created.activity.id,
        changes: { actualStart: "2026-08-10", actualFinish: "2026-08-09" },
      })
    ).rejects.toThrow(/Actual start must be on or before actual finish/);
  });

  it("edits Data Date at the project level (admin only) with server-side validation", async () => {
    const p = await createProject("PR7 Data Date");
    const res = await caller.primaveraLite.updateProjectMeta({
      slug: p.project.slug,
      access: p.admin,
      expectedRevision: p.project.revision,
      changes: { dataDate: "2026-08-15" },
    });
    expect(res.project.dataDate).toBe("2026-08-15");
    expect(res.revision).toBe(p.project.revision + 1);

    const loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.admin });
    expect(loaded.project?.dataDate).toBe("2026-08-15");

    // editor cannot edit project meta / Data Date
    await expect(
      caller.primaveraLite.updateProjectMeta({
        slug: p.project.slug,
        access: p.editor,
        expectedRevision: loaded.revision,
        changes: { dataDate: "2026-08-20" },
      })
    ).rejects.toThrow(/Admin token required/);

    // invalid dataDate rejected
    await expect(
      caller.primaveraLite.updateProjectMeta({
        slug: p.project.slug,
        access: p.admin,
        expectedRevision: loaded.revision,
        changes: { dataDate: "not-a-date" },
      })
    ).rejects.toThrow(/Date must be a valid YYYY-MM-DD|Invalid/);
  });

  it("keeps the viewer read-only for both activity and project mutations", async () => {
    const p = await createProject("PR7 Viewer Read Only");
    const created = await createActivity(p.editor, p.project.slug, p.project.revision, { activityName: "Task G" });
    const loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.viewer });
    await expect(
      caller.primaveraLite.updateActivity({
        slug: p.project.slug,
        access: p.viewer,
        expectedRevision: loaded.revision,
        activityId: created.activity.id,
        changes: { plannedStart: "2026-08-01" },
      })
    ).rejects.toThrow(/Editor or admin token required/);
    await expect(
      caller.primaveraLite.updateProjectMeta({
        slug: p.project.slug,
        access: p.viewer,
        expectedRevision: loaded.revision,
        changes: { dataDate: "2026-08-01" },
      })
    ).rejects.toThrow(/Admin token required/);
  });

  it("rejects a stale expectedRevision with a controlled CONFLICT", async () => {
    const p = await createProject("PR7 Stale Revision");
    const created = await createActivity(p.editor, p.project.slug, p.project.revision, { activityName: "Task H" });
    const loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: created.activity.id,
      changes: { percentComplete: 40 },
    });
    // reuse a stale revision
    await expect(
      caller.primaveraLite.updateActivity({
        slug: p.project.slug,
        access: p.editor,
        expectedRevision: loaded.revision,
        activityId: created.activity.id,
        changes: { percentComplete: 50 },
      })
    ).rejects.toThrow(/Project was updated by another user/);
  });

  it("treats a no-op edit as no revision bump and no audit event", async () => {
    const p = await createProject("PR7 No-op Edit");
    const created = await createActivity(p.editor, p.project.slug, p.project.revision, { activityName: "Task I" });
    const loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.admin });
    const eventsBefore = loaded.events.length;

    const noop = await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: created.activity.id,
      changes: { percentComplete: 0 }, // already 0
    });
    expect(noop.revision).toBe(loaded.revision);

    const loadedAfter = await caller.primaveraLite.load({ slug: p.project.slug, access: p.admin });
    expect(loadedAfter.revision).toBe(loaded.revision);
    expect(loadedAfter.events.length).toBe(eventsBefore);

    // no-op project meta (same dataDate) also does not bump revision
    await caller.primaveraLite.updateProjectMeta({
      slug: p.project.slug,
      access: p.admin,
      expectedRevision: loaded.revision,
      changes: { dataDate: "2026-08-15" },
    });
    const afterDataDate = await caller.primaveraLite.load({ slug: p.project.slug, access: p.admin });
    const noopMeta = await caller.primaveraLite.updateProjectMeta({
      slug: p.project.slug,
      access: p.admin,
      expectedRevision: afterDataDate.revision,
      changes: { dataDate: "2026-08-15" },
    });
    expect(noopMeta.revision).toBe(afterDataDate.revision);
  });

  it("records audit before/after payloads for activity date edits", async () => {
    const p = await createProject("PR7 Audit Payload");
    const created = await createActivity(p.editor, p.project.slug, p.project.revision, { activityName: "Task J" });
    const loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.admin, sinceRevision: 0 });
    await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: created.activity.id,
      changes: { plannedStart: "2026-08-10", plannedFinish: "2026-08-12" },
    });
    const loadedAfter = await caller.primaveraLite.load({ slug: p.project.slug, access: p.admin, sinceRevision: loaded.revision });
    const updateEvent = loadedAfter.events.find((e) => e.action === "update" && e.entityId === created.activity.id);
    expect(updateEvent).toBeDefined();
    const beforeData = updateEvent!.beforeData as Record<string, unknown> | null;
    const afterData = updateEvent!.afterData as Record<string, unknown> | null;
    expect(beforeData?.plannedStart).toBeNull();
    expect(afterData?.plannedStart).toBe("2026-08-10");
    expect(afterData?.plannedFinish).toBe("2026-08-12");
  });

  it("Run Schedule does not overwrite actual dates while persisting CPM fields", async () => {
    const p = await createProject("PR7 Schedule Preserves Actual");
    const created = await createActivity(p.editor, p.project.slug, p.project.revision, {
      activityName: "Task K",
      originalDurationDays: 3,
      plannedStart: "2026-08-10",
    });
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: created.activity.id,
      changes: { actualStart: "2026-08-11", actualFinish: "2026-08-12" },
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const sched = await caller.primaveraLite.runSchedule({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
    });
    expect(sched.scheduledCount).toBe(1);

    const after = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const activity = after.activities.find((a) => a.id === created.activity.id);
    expect(activity?.actualStart).toBe("2026-08-11");
    expect(activity?.actualFinish).toBe("2026-08-12");
    // CPM fields were computed
    expect(activity?.earlyStart).toBeDefined();
    expect(activity?.earlyFinish).toBeDefined();
    expect(activity?.totalFloatDays).toBeDefined();
    // planned start preserved as a user input (not overwritten by CPM)
    expect(activity?.plannedStart).toBe("2026-08-10");
  });
});
