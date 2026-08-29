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
import { activityTimelineModel } from "@/modules/gantt/primavera-lite/timelineModel";
import { format } from "date-fns";
import {
  PR345_ACTIVITY_A_INITIAL,
  PR345_ACTIVITY_B,
  PR345_ACTIVITY_C,
  PR345_AFTER_SCHEDULE,
  PR345_DATA_DATE,
  PR345_MANUAL_ACTUAL_FINISH,
} from "@/modules/gantt/primavera-lite/pr345SmokeFixture";
import { PROJECT_DATA_DATE_REQUIRED_FOR_100_MESSAGE } from "@/modules/gantt/primavera-lite/activityGridModel";

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
      changes: { actualStart: "2026-08-11" },
    });
    expect(res.activity.actualStart).toBe("2026-08-11");
    const res2 = await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: res.revision,
      activityId: created.activity.id,
      // Recording an Actual Finish is the explicit completion transition (F-10).
      changes: { actualFinish: "2026-08-12", percentComplete: 100 },
    });
    expect(res2.activity.actualFinish).toBe("2026-08-12");
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
      changes: { actualStart: "2026-08-01", actualFinish: "2026-08-02", percentComplete: 100 },
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
      changes: { actualStart: "2026-08-11", actualFinish: "2026-08-12", percentComplete: 100 },
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
      activityId: created.activity.id, changes: { actualFinish: "2026-08-12", percentComplete: 100 },
    });
    expect(completed.activity.actualFinish).toBe("2026-08-12");
    expect(completed.activity.percentComplete).toBe(100);

    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const progressOnly = await caller.primaveraLite.updateActivity({
      slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
      activityId: created.activity.id, changes: { actualFinish: null, percentComplete: 100 },
    });
    expect(progressOnly.activity.actualFinish).toBeNull();
    // Rule 1: actualStart is null, so clearing actualFinish sets % Complete to 0%
    expect(progressOnly.activity.percentComplete).toBe(0);
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

  it("Rule 1: Clearing Actual Finish sets % Complete = 99% if Actual Start exists, 0% if Actual Start is null", async () => {
    const p = await createProject("PR7 Clear Rules");
    await caller.primaveraLite.updateProjectMeta({
      slug: p.project.slug,
      access: p.admin,
      expectedRevision: p.project.revision,
      changes: { dataDate: "2026-08-13" },
    });
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    // Task 1: has Actual Start ("2026-08-10") and Actual Finish ("2026-08-12"), % Complete = 100
    const t1 = await createActivity(p.editor, p.project.slug, loaded.revision, {
      activityName: "Task With Actual Start",
      actualStart: "2026-08-10",
      actualFinish: "2026-08-12",
    });
    expect(t1.activity.percentComplete).toBe(100);

    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    // Task 2: has Actual Finish ("2026-08-12") but no Actual Start, % Complete = 100
    const t2 = await createActivity(p.editor, p.project.slug, loaded.revision, {
      activityName: "Task Without Actual Start",
      actualFinish: "2026-08-12",
    });
    expect(t2.activity.percentComplete).toBe(100);

    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    // Clearing Actual Finish on t1 (has Actual Start) -> % Complete = 99%
    const cleared1 = await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: t1.activity.id,
      changes: { actualFinish: null },
    });
    expect(cleared1.activity.actualFinish).toBeNull();
    expect(cleared1.activity.percentComplete).toBe(99);

    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    // Clearing Actual Finish on t2 (no Actual Start) -> % Complete = 0%
    const cleared2 = await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: t2.activity.id,
      changes: { actualFinish: null },
    });
    expect(cleared2.activity.actualFinish).toBeNull();
    expect(cleared2.activity.percentComplete).toBe(0);

    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    // Explicit % Complete < 100 supplied in same edit takes precedence
    await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: t1.activity.id,
      changes: { actualFinish: "2026-08-12", percentComplete: 100 },
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    const explicitCleared = await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: t1.activity.id,
      changes: { actualFinish: null, percentComplete: 45 },
    });
    expect(explicitCleared.activity.actualFinish).toBeNull();
    expect(explicitCleared.activity.percentComplete).toBe(45);
  });

  it("Rule 2: Setting % Complete to 100 requires a valid Project Data Date and does not fall back to today", async () => {
    const p = await createProject("PR7 No Data Date");
    // Project created with dataDate = null
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const created = await createActivity(p.editor, p.project.slug, loaded.revision, {
      activityName: "Task",
      percentComplete: 0,
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    // Attempting % Complete = 100 without Project Data Date must be rejected with a clear validation error
    await expect(
      caller.primaveraLite.updateActivity({
        slug: p.project.slug,
        access: p.editor,
        expectedRevision: loaded.revision,
        activityId: created.activity.id,
        changes: { percentComplete: 100 },
      })
    ).rejects.toThrow(PROJECT_DATA_DATE_REQUIRED_FOR_100_MESSAGE);

    await expect(
      caller.primaveraLite.createActivity({
        slug: p.project.slug,
        access: p.editor,
        expectedRevision: loaded.revision,
        activity: { activityName: "Create at 100", percentComplete: 100 },
      })
    ).rejects.toThrow(PROJECT_DATA_DATE_REQUIRED_FOR_100_MESSAGE);
  });

  it("Rule 3: Data Date earlier than Actual Start is rejected on 100% edit", async () => {
    const p = await createProject("PR7 DD Before Start");
    await caller.primaveraLite.updateProjectMeta({
      slug: p.project.slug,
      access: p.admin,
      expectedRevision: p.project.revision,
      changes: { dataDate: "2026-08-13" },
    });
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    const created = await createActivity(p.editor, p.project.slug, loaded.revision, {
      activityName: "Task with later Actual Start",
      actualStart: "2026-08-14",
      percentComplete: 25,
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    // Data Date is 2026-08-13, but Actual Start is 2026-08-14.
    // Setting % Complete to 100 would auto-populate 2026-08-13, violating Actual Start <= Actual Finish.
    // Must be rejected with a clear validation error.
    await expect(
      caller.primaveraLite.updateActivity({
        slug: p.project.slug,
        access: p.editor,
        expectedRevision: loaded.revision,
        activityId: created.activity.id,
        changes: { percentComplete: 100 },
      })
    ).rejects.toThrow(/precedes Actual Start/);

    // User may manually enter a valid Actual Finish (e.g. 2026-08-14) which sets % Complete = 100
    const manualSuccess = await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: created.activity.id,
      changes: { actualFinish: "2026-08-14", percentComplete: 100 },
    });
    expect(manualSuccess.activity.actualFinish).toBe("2026-08-14");
    expect(manualSuccess.activity.percentComplete).toBe(100);
  });

  it("Rule 4: Exact PR345 Production Reproduction smoke data fixture", async () => {
    // Data Date = 2026-08-13
    const p = await createProject("PR345 Smoke Reproduction");
    await caller.primaveraLite.updateProjectMeta({
      slug: p.project.slug,
      access: p.admin,
      expectedRevision: p.project.revision,
      changes: { dataDate: "2026-08-13" },
    });
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    // Activity A: Planned Start 2026-08-13, Planned Finish 2026-08-17, Actual Start 2026-08-14, Actual Finish null, % Complete 25, Original Duration 5
    const actA = await createActivity(p.editor, p.project.slug, loaded.revision, {
      activityName: "Activity A",
      plannedStart: "2026-08-13",
      plannedFinish: "2026-08-17",
      actualStart: "2026-08-14",
      actualFinish: null,
      percentComplete: 25,
      originalDurationDays: 5,
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    // Activity B: no complete planned date pair, Original Duration 5
    const actB = await createActivity(p.editor, p.project.slug, loaded.revision, {
      activityName: "Activity B",
      originalDurationDays: 5,
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    // Activity C: no planned dates, Original Duration 2
    const actC = await createActivity(p.editor, p.project.slug, loaded.revision, {
      activityName: "Activity C",
      originalDurationDays: 2,
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    // Dependencies: A -> B FS lag 0, B -> C FS lag 0
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

    // 1. Attempting A % Complete = 100 with Data Date (2026-08-13) before Actual Start (2026-08-14) is rejected
    await expect(
      caller.primaveraLite.updateActivity({
        slug: p.project.slug,
        access: p.editor,
        expectedRevision: loaded.revision,
        activityId: actA.activity.id,
        changes: { percentComplete: 100 },
      })
    ).rejects.toThrow(/precedes Actual Start/);

    // 2. Manual valid Actual Finish sets A = 100
    const aManual = await caller.primaveraLite.updateActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activityId: actA.activity.id,
      changes: { actualFinish: PR345_MANUAL_ACTUAL_FINISH, percentComplete: 100 },
    });
    expect(aManual.activity.actualFinish).toBe(PR345_MANUAL_ACTUAL_FINISH);
    expect(aManual.activity.percentComplete).toBe(100);

    // 3. Run Schedule anchors B from A Actual Finish (2026-08-14 Fri)
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const sched = await caller.primaveraLite.runSchedule({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
    });
    expect(sched.scheduledCount).toBe(3);

    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const aAfter = loaded.activities.find((a) => a.id === actA.activity.id)!;
    const bAfter = loaded.activities.find((a) => a.id === actB.activity.id)!;
    const cAfter = loaded.activities.find((a) => a.id === actC.activity.id)!;

    // A: Early dates equal Actual dates
    expect(aAfter.earlyStart).toBe(PR345_AFTER_SCHEDULE.A.earlyStart);
    expect(aAfter.earlyFinish).toBe(PR345_AFTER_SCHEDULE.A.earlyFinish);
    expect(aAfter.actualStart).toBe(PR345_AFTER_SCHEDULE.A.actualStart);
    expect(aAfter.actualFinish).toBe(PR345_AFTER_SCHEDULE.A.actualFinish);
    expect(aAfter.percentComplete).toBe(100);
    expect(aAfter.originalDurationDays).toBe(5);
    expect(aAfter.lateStart).toBe(PR345_AFTER_SCHEDULE.A.earlyStart);
    expect(aAfter.lateFinish).toBe(PR345_AFTER_SCHEDULE.A.earlyFinish);

    // B: Starts Mon 2026-08-17 (next working day after Fri 2026-08-14). 5 working days -> finishes Fri 2026-08-21
    expect(bAfter.earlyStart).toBe(PR345_AFTER_SCHEDULE.B.earlyStart);
    expect(bAfter.earlyFinish).toBe(PR345_AFTER_SCHEDULE.B.earlyFinish);
    expect(bAfter.originalDurationDays).toBe(5);

    // C: Starts Mon 2026-08-24 (next working day after Fri 2026-08-21). 2 working days -> finishes Tue 2026-08-25
    expect(cAfter.earlyStart).toBe(PR345_AFTER_SCHEDULE.C.earlyStart);
    expect(cAfter.earlyFinish).toBe(PR345_AFTER_SCHEDULE.C.earlyFinish);
    expect(cAfter.originalDurationDays).toBe(2);

    // 4. Planned dates are NOT rewritten by schedule run
    expect(aAfter.plannedStart).toBe(PR345_AFTER_SCHEDULE.A.plannedStart);
    expect(aAfter.plannedFinish).toBe(PR345_AFTER_SCHEDULE.A.plannedFinish);
    expect(bAfter.plannedStart).toBeNull();
    expect(bAfter.plannedFinish).toBeNull();
    expect(cAfter.plannedStart).toBeNull();
    expect(cAfter.plannedFinish).toBeNull();

    // Timeline/grid/CPM fields agree
    const iso = (date: Date) => format(date, "yyyy-MM-dd");
    const aModel = activityTimelineModel(aAfter);
    const bModel = activityTimelineModel(bAfter);
    const cModel = activityTimelineModel(cAfter);
    expect(aModel.primary?.source).toBe("planned");
    expect([iso(aModel.planned!.start), iso(aModel.planned!.finish)]).toEqual(["2026-08-13", "2026-08-17"]);
    expect(aModel.actual.kind).toBe("closed");
    expect([iso(aModel.cpm!.start), iso(aModel.cpm!.finish)]).toEqual(["2026-08-14", "2026-08-14"]);
    expect(bModel.planned).toBeNull();
    expect(bModel.primary?.source).toBe("cpm");
    expect([iso(bModel.cpm!.start), iso(bModel.cpm!.finish)]).toEqual(["2026-08-17", "2026-08-21"]);
    expect(cModel.planned).toBeNull();
    expect(cModel.primary?.source).toBe("cpm");
    expect([iso(cModel.cpm!.start), iso(cModel.cpm!.finish)]).toEqual(["2026-08-24", "2026-08-25"]);
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

  it("F-10: explicit contradictions are rejected — completed status with 0%", async () => {
    const p = await createProject("PR7 V1 Completed Zero");
    const created = await createActivity(p.editor, p.project.slug, p.project.revision, { activityName: "Task" });
    const loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    await expect(
      caller.primaveraLite.updateActivity({
        slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
        activityId: created.activity.id, changes: { status: "completed", percentComplete: 0 },
      })
    ).rejects.toThrow(/Completed status requires 100% complete/);
  });

  it("F-10: Actual Finish with <100% is rejected; the explicit transition (AF + 100%) completes", async () => {
    const p = await createProject("PR7 V2 Finish Partial");
    const created = await createActivity(p.editor, p.project.slug, p.project.revision, { activityName: "Task", percentComplete: 25 });
    const loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    await expect(
      caller.primaveraLite.updateActivity({
        slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
        activityId: created.activity.id, changes: { actualFinish: "2026-08-14" },
      })
    ).rejects.toThrow(/Actual Finish requires 100% complete/);

    const done = await caller.primaveraLite.updateActivity({
      slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
      activityId: created.activity.id, changes: { actualFinish: "2026-08-14", percentComplete: 100 },
    });
    expect(done.activity.actualFinish).toBe("2026-08-14");
    expect(done.activity.percentComplete).toBe(100);
  });

  it("F-10: unknown status and in-progress/not-started contradictions are rejected", async () => {
    const p = await createProject("PR7 V5/V6/V7 Status");
    const created = await createActivity(p.editor, p.project.slug, p.project.revision, { activityName: "Task" });
    const loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    await expect(
      caller.primaveraLite.updateActivity({
        slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
        activityId: created.activity.id, changes: { status: "done" },
      })
    ).rejects.toThrow(/Unknown activity status/);
    await expect(
      caller.primaveraLite.updateActivity({
        slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
        activityId: created.activity.id, changes: { status: "in-progress", percentComplete: 0 },
      })
    ).rejects.toThrow(/In-progress status requires progress strictly between 0% and 100%/);
    await expect(
      caller.primaveraLite.updateActivity({
        slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
        activityId: created.activity.id, changes: { status: "not-started", percentComplete: 30 },
      })
    ).rejects.toThrow(/Not-started status cannot have progress or actual dates/);
  });

  it("F-10: T2 un-completion clears Actual Finish, derives remaining and derives status", async () => {
    const p = await createProject("PR7 T2 Uncomplete");
    await caller.primaveraLite.updateProjectMeta({
      slug: p.project.slug, access: p.admin, expectedRevision: p.project.revision,
      changes: { dataDate: "2026-08-13" },
    });
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const created = await createActivity(p.editor, p.project.slug, loaded.revision, { activityName: "Task", percentComplete: 0 });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const completed = await caller.primaveraLite.updateActivity({
      slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
      activityId: created.activity.id, changes: { percentComplete: 100 },
    });
    expect(completed.activity.actualFinish).toBe("2026-08-13");
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const reduced = await caller.primaveraLite.updateActivity({
      slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
      activityId: created.activity.id, changes: { percentComplete: 60, remainingDurationDays: 2 },
    });
    expect(reduced.activity.percentComplete).toBe(60);
    expect(reduced.activity.actualFinish).toBeNull();
    expect(reduced.activity.remainingDurationDays).toBe(2);
    expect(reduced.activity.status).toBe("in-progress");
  });
});
