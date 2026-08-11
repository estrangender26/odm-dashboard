import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import {
  ganttActivities,
  ganttActivityDependencies,
  ganttCalendars,
  ganttCalendarExceptions,
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

describe("Primavera Lite PR6 Scheduling Engine & runSchedule mutation", () => {
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

  it("admin and editor can runSchedule, viewer is rejected", async () => {
    const p = await createProject("PR6 Roles Test");
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    // Create an activity so there is work to schedule
    await caller.primaveraLite.createActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activity: { activityName: "Task 1", originalDurationDays: 3 },
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.viewer });

    // Viewer cannot run schedule
    await expect(
      caller.primaveraLite.runSchedule({
        slug: p.project.slug,
        access: p.viewer,
        expectedRevision: loaded.revision,
      })
    ).rejects.toThrow(/Editor or admin token required|read-only/i);

    // Editor can run schedule
    const editorRes = await caller.primaveraLite.runSchedule({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
    });
    expect(editorRes.revision).toBe(loaded.revision + 1);
    expect(editorRes.scheduledCount).toBe(1);
    expect(editorRes.project.lastScheduledAt).toBeDefined();

    // Admin can run schedule
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.admin });
    const adminRes = await caller.primaveraLite.runSchedule({
      slug: p.project.slug,
      access: p.admin,
      expectedRevision: loaded.revision,
    });
    expect(adminRes.revision).toBe(loaded.revision + 1);
  });

  it("calculates and persists CPM fields, updates lastScheduledAt, bumps revision by 1, and records an atomic scheduling event", async () => {
    const p = await createProject("PR6 CPM Flow");
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    // Add A -> B -> C network
    const resA = await caller.primaveraLite.createActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activity: { activityName: "A", originalDurationDays: 2, plannedStart: "2026-08-10" },
    });
    const resB = await caller.primaveraLite.createActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: resA.revision,
      activity: { activityName: "B", originalDurationDays: 3 },
    });
    const resC = await caller.primaveraLite.createActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: resB.revision,
      activity: { activityName: "C", originalDurationDays: 1 },
    });

    const dep1 = await caller.primaveraLite.createDependency({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: resC.revision,
      dependency: {
        predecessorActivityId: resA.activity.id,
        successorActivityId: resB.activity.id,
        dependencyType: "FS",
        lagDays: 0,
      },
    });
    const dep2 = await caller.primaveraLite.createDependency({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: dep1.revision,
      dependency: {
        predecessorActivityId: resB.activity.id,
        successorActivityId: resC.activity.id,
        dependencyType: "FS",
        lagDays: 0,
      },
    });

    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.viewer });
    const prevRevision = loaded.revision;

    // Run schedule
    const schedRes = await caller.primaveraLite.runSchedule({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: prevRevision,
      actorName: "Test Planner",
    });

    // Exactly 1 revision bump
    expect(schedRes.revision).toBe(prevRevision + 1);
    expect(schedRes.scheduledCount).toBe(3);
    expect(schedRes.criticalCount).toBe(3);

    // Reload from DB and check persisted fields
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.viewer, sinceRevision: 0 });
    expect(loaded.project!.lastScheduledAt).toBeDefined();

    const map = new Map(loaded.activities.map((a) => [a.activityName, a]));
    expect(map.get("A")).toMatchObject({
      earlyStart: "2026-08-10",
      earlyFinish: "2026-08-11",
      totalFloatDays: 0,
      freeFloatDays: 0,
    });
    expect(map.get("B")).toMatchObject({
      earlyStart: "2026-08-12",
      earlyFinish: "2026-08-14",
      totalFloatDays: 0,
      freeFloatDays: 0,
    });
    expect(map.get("C")).toMatchObject({
      earlyStart: "2026-08-17",
      earlyFinish: "2026-08-17",
      totalFloatDays: 0,
      freeFloatDays: 0,
    });

    // Verify atomic scheduling audit event
    const scheduleEvents = loaded.events.filter((e) => e.action === "schedule");
    expect(scheduleEvents).toHaveLength(1);
    expect(scheduleEvents[0]).toMatchObject({
      entityType: "project",
      action: "schedule",
      actorName: "Test Planner",
      projectRevision: prevRevision + 1,
    });
    expect(scheduleEvents[0].afterData).toMatchObject({
      scheduledCount: 3,
      criticalCount: 3,
    });
  });

  it("stale expectedRevision returns controlled CONFLICT", async () => {
    const p = await createProject("PR6 Conflict");
    const loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    await expect(
      caller.primaveraLite.runSchedule({
        slug: p.project.slug,
        access: p.editor,
        expectedRevision: loaded.revision + 999,
      })
    ).rejects.toThrow(/was updated by another user/i);
  });

  it("rejects cycles with controlled BAD_REQUEST", async () => {
    const p = await createProject("PR6 Cycles");
    const resA = await caller.primaveraLite.createActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: 1,
      activity: { activityName: "A", originalDurationDays: 1 },
    });
    const resB = await caller.primaveraLite.createActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: resA.revision,
      activity: { activityName: "B", originalDurationDays: 1 },
    });

    // Create A -> B
    await caller.primaveraLite.createDependency({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: resB.revision,
      dependency: {
        predecessorActivityId: resA.activity.id,
        successorActivityId: resB.activity.id,
        dependencyType: "FS",
        lagDays: 0,
      },
    });

    // Force a cycle B -> A directly into DB to bypass createDependency's eager cycle check
    await testDb.insert(ganttActivityDependencies).values({
      projectId: p.project.id,
      predecessorActivityId: resB.activity.id,
      successorActivityId: resA.activity.id,
      dependencyType: "FS",
      lagDays: 0,
    });

    const loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    await expect(
      caller.primaveraLite.runSchedule({
        slug: p.project.slug,
        access: p.editor,
        expectedRevision: loaded.revision,
      })
    ).rejects.toThrow(/Circular dependency detected/i);
  });

  it("project isolation: running schedule on project A does not mutate project B or its revision", async () => {
    const pA = await createProject("PR6 Iso A");
    const pB = await createProject("PR6 Iso B");

    let loadedB = await caller.primaveraLite.load({ slug: pB.project.slug, access: pB.editor });
    const resB = await caller.primaveraLite.createActivity({
      slug: pB.project.slug,
      access: pB.editor,
      expectedRevision: loadedB.revision,
      activity: { activityName: "Task B", originalDurationDays: 5 },
    });

    const initialRevB = resB.revision;

    // Run schedule on Project A
    const loadedA = await caller.primaveraLite.load({ slug: pA.project.slug, access: pA.editor });
    await caller.primaveraLite.runSchedule({
      slug: pA.project.slug,
      access: pA.editor,
      expectedRevision: loadedA.revision,
    });

    // Project B is unchanged
    loadedB = await caller.primaveraLite.load({ slug: pB.project.slug, access: pB.editor });
    expect(loadedB.revision).toBe(initialRevB);
    expect(loadedB.project!.lastScheduledAt).toBeNull();
  });

  it("proves a non-working calendar exception changes CPM dates in runSchedule", async () => {
    const p = await createProject("PR6 Exception Test");
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    // Set project data_date to Monday 2026-08-17
    await testDb
      .update(ganttProjects)
      .set({ dataDate: "2026-08-17" })
      .where(eq(ganttProjects.id, p.project.id));

    // Create a 1-day task
    const actRes = await caller.primaveraLite.createActivity({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: loaded.revision,
      activity: { activityName: "Exception Task", originalDurationDays: 1 },
    });

    // 1. Run schedule without exception: task starts & finishes Mon 2026-08-17
    const sched1 = await caller.primaveraLite.runSchedule({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: actRes.revision,
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.viewer, sinceRevision: 0 });
    const act1 = loaded.activities.find((a) => a.activityName === "Exception Task")!;
    expect(act1.earlyStart).toBe("2026-08-17");
    expect(act1.earlyFinish).toBe("2026-08-17");

    // 2. Add a non-working exception for Mon 2026-08-17 on the project's default calendar
    const calId = loaded.project!.defaultCalendarId!;
    await testDb.insert(ganttCalendarExceptions).values({
      calendarId: calId,
      exceptionDate: "2026-08-17",
      isWorking: false,
    });

    // 3. Run schedule with exception: task moves to Tue 2026-08-18!
    const sched2 = await caller.primaveraLite.runSchedule({
      slug: p.project.slug,
      access: p.editor,
      expectedRevision: sched1.revision,
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.viewer, sinceRevision: 0 });
    const act2 = loaded.activities.find((a) => a.activityName === "Exception Task")!;
    expect(act2.earlyStart).toBe("2026-08-18");
    expect(act2.earlyFinish).toBe("2026-08-18");
  });
});
