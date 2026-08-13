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

  it("sets Duration % Complete to 100 atomically when Actual Finish is supplied, without inventing dates from percent", async () => {
    const p = await createProject("PR7 Duration Complete");
    const created = await createActivity(p.editor, p.project.slug, p.project.revision, {
      activityName: "Task", percentComplete: 20,
    });
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const completed = await caller.primaveraLite.updateActivity({
      slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
      activityId: created.activity.id, changes: { actualFinish: "2026-08-12", percentComplete: 25 },
    });
    expect(completed.activity.actualFinish).toBe("2026-08-12");
    expect(completed.activity.percentComplete).toBe(100);

    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const progressOnly = await caller.primaveraLite.updateActivity({
      slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
      activityId: created.activity.id, changes: { actualFinish: null, percentComplete: 100 },
    });
    expect(progressOnly.activity.actualFinish).toBeNull();
    expect(progressOnly.activity.percentComplete).toBe(99);
  });

  it("changing % Complete to 100 auto-populates Actual Finish = Project Data Date", async () => {
    const p = await createProject("PR7 Auto Data Date");
    await caller.primaveraLite.updateProjectMeta({
      slug: p.project.slug,
      access: p.admin,
      expectedRevision: p.project.revision,
      changes: { dataDate: "2026-08-13" },
    });
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const created = await createActivity(p.editor, p.project.slug, loaded.revision, {
      activityName: "Task Auto Finish",
      percentComplete: 0,
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    // Changing % Complete from 0 to 100 auto-populates Actual Finish = Project Data Date (2026-08-13)
    const updated = await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: created.activity.id,
      changes: { percentComplete: 100 },
    });
    expect(updated.activity.percentComplete).toBe(100);
    expect(updated.activity.actualFinish).toBe("2026-08-13");

    // Manually changing Actual Finish to another valid date while remaining 100%
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const manualFinish = await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: created.activity.id,
      changes: { actualFinish: "2026-08-14" },
    });
    expect(manualFinish.activity.percentComplete).toBe(100);
    expect(manualFinish.activity.actualFinish).toBe("2026-08-14");

    // Reducing % Complete below 100 automatically clears Actual Finish
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const reduced = await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: created.activity.id,
      changes: { percentComplete: 60 },
    });
    expect(reduced.activity.percentComplete).toBe(60);
    expect(reduced.activity.actualFinish).toBeNull();
  });

  it("synchronizes duration and planned dates with working-day calendar math across weekends", async () => {
    const p = await createProject("PR7 Duration Sync");
    // Friday 2026-08-14 start, duration 5 working days -> finishes Thursday 2026-08-20 (spans 7 calendar days)
    const created = await createActivity(p.editor, p.project.slug, p.project.revision, {
      activityName: "Weekend Task",
      plannedStart: "2026-08-14",
      originalDurationDays: 5,
    });
    expect(created.activity.plannedStart).toBe("2026-08-14");
    expect(created.activity.plannedFinish).toBe("2026-08-20");
    expect(created.activity.originalDurationDays).toBe(5);

    // Editing duration to 6 working days -> recalculates Planned Finish to Friday 2026-08-21
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const updatedDur = await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: created.activity.id,
      changes: { originalDurationDays: 6 },
    });
    expect(updatedDur.activity.originalDurationDays).toBe(6);
    expect(updatedDur.activity.plannedFinish).toBe("2026-08-21");

    // Editing Planned Finish to Monday 2026-08-24 -> recalculates duration to 7 working days
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const updatedFinish = await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: created.activity.id,
      changes: { plannedFinish: "2026-08-24" },
    });
    expect(updatedFinish.activity.plannedFinish).toBe("2026-08-24");
    expect(updatedFinish.activity.originalDurationDays).toBe(7);

    // Editing Planned Start to Monday 2026-08-17 -> shifts Planned Finish with duration = 7 to Tuesday 2026-08-25
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const updatedStart = await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: created.activity.id,
      changes: { plannedStart: "2026-08-17" },
    });
    expect(updatedStart.activity.plannedStart).toBe("2026-08-17");
    expect(updatedStart.activity.originalDurationDays).toBe(7);
    expect(updatedStart.activity.plannedFinish).toBe("2026-08-25");
  });

  it("End-to-End PR345 acceptance scenario: A -> B -> C integrated scheduling and actuals", async () => {
    // 1. Setup project with Data Date = 2026-08-13 (Thursday)
    const p = await createProject("PR345 Acceptance Project");
    await caller.primaveraLite.updateProjectMeta({
      slug: p.project.slug,
      access: p.admin,
      expectedRevision: p.project.revision,
      changes: { dataDate: "2026-08-13" },
    });
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    // Create A (plannedStart 2026-08-13, originalDuration 5 -> plannedFinish 2026-08-19)
    const actA = await createActivity(p.editor, p.project.slug, loaded.revision, {
      activityName: "Activity A",
      plannedStart: "2026-08-13",
      originalDurationDays: 5,
      actualStart: "2026-08-13",
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    // Create B (originalDuration 5, plannedStart 2026-08-13)
    const actB = await createActivity(p.editor, p.project.slug, loaded.revision, {
      activityName: "Activity B",
      plannedStart: "2026-08-13",
      originalDurationDays: 5,
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    // Create C (originalDuration 2, plannedStart 2026-08-13)
    const actC = await createActivity(p.editor, p.project.slug, loaded.revision, {
      activityName: "Activity C",
      plannedStart: "2026-08-13",
      originalDurationDays: 2,
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    // Create dependencies: A -> B (FS lag 0), B -> C (FS lag 0)
    await caller.primaveraLite.createDependency({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      dependency: { predecessorActivityId: actA.activity.id, successorActivityId: actB.activity.id, dependencyType: "FS", lagDays: 0 },
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    await caller.primaveraLite.createDependency({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      dependency: { predecessorActivityId: actB.activity.id, successorActivityId: actC.activity.id, dependencyType: "FS", lagDays: 0 },
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    // A. Setting A to 100% auto-populates Actual Finish = Data Date (2026-08-13)
    const a100 = await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: actA.activity.id,
      changes: { percentComplete: 100 },
    });
    expect(a100.activity.percentComplete).toBe(100);
    expect(a100.activity.actualFinish).toBe("2026-08-13");

    // B. Actual Finish can then be manually changed while remaining 100%
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const aManual = await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: actA.activity.id,
      changes: { actualFinish: "2026-08-13" },
    });
    expect(aManual.activity.actualFinish).toBe("2026-08-13");
    expect(aManual.activity.percentComplete).toBe(100);

    // E. Run Schedule uses A's Actual Finish (2026-08-13 Thu) as the FS anchor for B
    // B starts Friday 2026-08-14, 5 working days -> finishes Thursday 2026-08-20
    // F. B propagates to C: C starts Friday 2026-08-21, 2 working days -> finishes Monday 2026-08-24
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const sched = await caller.primaveraLite.runSchedule({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
    });
    expect(sched.scheduledCount).toBe(3);

    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const bAfterSched = loaded.activities.find((a) => a.id === actB.activity.id)!;
    const cAfterSched = loaded.activities.find((a) => a.id === actC.activity.id)!;

    expect(bAfterSched.earlyStart).toBe("2026-08-14");
    expect(bAfterSched.earlyFinish).toBe("2026-08-20");
    expect(cAfterSched.earlyStart).toBe("2026-08-21");
    expect(cAfterSched.earlyFinish).toBe("2026-08-24");

    // H. Planned dates remain unchanged by actualized scheduling
    expect(bAfterSched.plannedStart).toBe("2026-08-13");
    expect(bAfterSched.plannedFinish).toBe("2026-08-19");
    expect(cAfterSched.plannedStart).toBe("2026-08-13");
    expect(cAfterSched.plannedFinish).toBe("2026-08-14");
  });
});
