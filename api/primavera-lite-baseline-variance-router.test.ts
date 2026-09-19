import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and, inArray, isNull } from "drizzle-orm";
import {
  ganttProjects,
  ganttWbsNodes,
  ganttActivities,
  ganttActivityDependencies,
  ganttProjectEvents,
  ganttBaselines,
  ganttBaselineActivities,
  ganttCalendars,
} from "@db/schema";
import { appRouter } from "./router";
import { assertDisposableTestDatabase, resolveDisposableTestDatabaseUrl } from "./disposable-test-db";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";

const DATABASE_URL = resolveDisposableTestDatabaseUrl();

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
const createdBaselineIds: number[] = [];


// ---------------------------------------------------------------------------
// Helpers — every one of them uses the PUBLIC router API unless a test
// deliberately reaches for the database to simulate a hard delete.
// ---------------------------------------------------------------------------

type Project = { id: number; slug: string; admin: string; editor: string; viewer: string };

async function makeProject(name: string, dataDate = "2026-09-10"): Promise<Project> {
  const created = await caller.primaveraLite.createProject({ name });
  createdProjectIds.push(created.project.id);
  const project: Project = {
    id: created.project.id,
    slug: created.project.slug,
    admin: extractToken(created.adminLink),
    editor: extractToken(created.editorLink),
    viewer: extractToken(created.viewerLink),
  };
  const loaded = await caller.primaveraLite.load({ slug: project.slug, access: project.admin });
  await caller.primaveraLite.updateProjectMeta({
    slug: project.slug,
    access: project.admin,
    expectedRevision: loaded.revision,
    changes: { dataDate },
  });
  return project;
}

async function revision(project: Project): Promise<number> {
  const loaded = await caller.primaveraLite.load({ slug: project.slug, access: project.admin });
  return loaded.revision;
}

async function addActivity(
  project: Project,
  activity: {
    activityName: string;
    originalDurationDays: number;
    plannedStart?: string;
    plannedFinish?: string;
    calendarId?: number;
  }
): Promise<number> {
  const created = await caller.primaveraLite.createActivity({
    slug: project.slug,
    access: project.editor,
    expectedRevision: await revision(project),
    activity,
  });
  return created.activity.id;
}

async function runSchedule(project: Project): Promise<void> {
  await caller.primaveraLite.runSchedule({
    slug: project.slug,
    access: project.admin,
    expectedRevision: await revision(project),
  });
}

async function capture(project: Project, name: string): Promise<number> {
  const captured = await caller.primaveraLite.captureBaseline({
    slug: project.slug,
    access: project.admin,
    expectedRevision: await revision(project),
    name,
  });
  createdBaselineIds.push(captured.baseline.id);
  return captured.baseline.id;
}

async function setDataDate(project: Project, dataDate: string): Promise<void> {
  await caller.primaveraLite.updateProjectMeta({
    slug: project.slug,
    access: project.admin,
    expectedRevision: await revision(project),
    changes: { dataDate },
  });
}

async function compare(project: Project, baselineId: number, access?: string) {
  return caller.primaveraLite.compareBaseline({
    slug: project.slug,
    access: access ?? project.admin,
    baselineId,
  });
}

async function snapshotsOf(baselineId: number) {
  return testDb
    .select()
    .from(ganttBaselineActivities)
    .where(eq(ganttBaselineActivities.baselineId, baselineId))
    .orderBy(ganttBaselineActivities.id);
}

describe("primaveraLite baseline variance foundation", () => {
  beforeAll(async () => {
    assertDisposableTestDatabase();
  });

  afterAll(async () => {
    if (createdBaselineIds.length > 0) {
      await testDb
        .delete(ganttBaselineActivities)
        .where(inArray(ganttBaselineActivities.baselineId, createdBaselineIds));
      await testDb.delete(ganttBaselines).where(inArray(ganttBaselines.id, createdBaselineIds));
    }
    // Dependencies reference activities, so they must go first.
    await testDb
      .delete(ganttActivityDependencies)
      .where(inArray(ganttActivityDependencies.projectId, createdProjectIds));
    const trackedActivityIds = await testDb
      .select({ id: ganttActivities.id })
      .from(ganttActivities)
      .where(inArray(ganttActivities.projectId, createdProjectIds));
    await testDb
      .delete(ganttActivities)
      .where(inArray(ganttActivities.id, trackedActivityIds.map((r) => r.id)));
    await testDb.delete(ganttProjectEvents).where(inArray(ganttProjectEvents.projectId, createdProjectIds));
    await testDb.delete(ganttWbsNodes).where(inArray(ganttWbsNodes.projectId, createdProjectIds));
    await testDb.delete(ganttProjects).where(inArray(ganttProjects.id, createdProjectIds));
    await client.end();
  });

  it("reports project baseline/forecast dates and zero variance for an unchanged plan", async () => {
    const project = await makeProject("Variance Project Summary");
    await addActivity(project, { activityName: "Task A", originalDurationDays: 3 });
    await addActivity(project, { activityName: "Task B", originalDurationDays: 2 });
    await runSchedule(project);
    const baselineId = await capture(project, "Approved Rev A");

    const result = await compare(project, baselineId);

    const snapshots = await snapshotsOf(baselineId);
    expect(result.comparisons.length).toBe(2);

    // Project-level approved reference comes from the frozen snapshots.
    expect(result.project.baselineActivityCount).toBe(2);
    expect(result.project.baselineStart).toBe(snapshots[0].scheduledStart);
    const latestSnapshotFinish = snapshots
      .map((s) => s.scheduledFinish)
      .filter(Boolean)
      .sort()
      .at(-1);
    expect(result.project.baselineFinish).toBe(latestSnapshotFinish);

    // Nothing moved.
    expect(result.project.startVariance).toBe(0);
    expect(result.project.finishVariance).toBe(0);
    expect(result.project.currentStart).not.toBeNull();
    expect(result.project.currentFinish).not.toBeNull();

    for (const row of result.comparisons) {
      expect(row.startVariance).toBe(0);
      expect(row.finishVariance).toBe(0);
      expect(row.durationVariance).toBe(0);
      expect(row.status).toBe("on-baseline");
      expect(row.currentDurationDays).toBe(row.baselineDurationDays);
    }
    expect(result.project.statusCounts["on-baseline"]).toBe(2);
    expect(result.project.newSinceBaselineCount).toBe(0);
    expect(result.project.removedSinceBaselineCount).toBe(0);
    expect(result.newSinceBaseline).toEqual([]);
  });

  it("reports project completion later as a positive finish variance and earlier as negative", async () => {
    const project = await makeProject("Variance Project Finish");
    await addActivity(project, { activityName: "Task A", originalDurationDays: 3 });
    await runSchedule(project);
    const baselineId = await capture(project, "Approved Rev A");

    const unchanged = await compare(project, baselineId);
    expect(unchanged.project.finishVariance).toBe(0);

    await setDataDate(project, "2026-09-15");
    await runSchedule(project);
    const later = await compare(project, baselineId);
    expect(later.project.finishVariance).toBeGreaterThan(0);
    expect(later.project.finishVariance).toBe(later.comparisons[0].finishVariance ?? 0);

    await setDataDate(project, "2026-09-08");
    await runSchedule(project);
    const earlier = await compare(project, baselineId);
    expect(earlier.project.finishVariance).toBeLessThan(0);
  });

  it("reports duration variance in working days, positive and negative", async () => {
    const project = await makeProject("Variance Duration");
    const activityId = await addActivity(project, { activityName: "Task A", originalDurationDays: 3 });
    await runSchedule(project);
    const baselineId = await capture(project, "Approved Rev A");

    const unchanged = await compare(project, baselineId);
    expect(unchanged.comparisons[0].baselineDurationDays).toBe(3);
    expect(unchanged.comparisons[0].currentDurationDays).toBe(3);
    expect(unchanged.comparisons[0].durationVariance).toBe(0);

    // Longer forecast duration.
    await caller.primaveraLite.updateActivity({
      slug: project.slug,
      access: project.editor,
      expectedRevision: await revision(project),
      activityId,
      changes: { originalDurationDays: 8 },
    });
    await runSchedule(project);
    const longer = await compare(project, baselineId);
    expect(longer.comparisons[0].baselineDurationDays).toBe(3);
    expect(longer.comparisons[0].currentDurationDays).toBe(8);
    expect(longer.comparisons[0].durationVariance).toBe(5);
    expect(longer.comparisons[0].finishVariance).toBeGreaterThan(0);

    // Shorter forecast duration.
    await caller.primaveraLite.updateActivity({
      slug: project.slug,
      access: project.editor,
      expectedRevision: await revision(project),
      activityId,
      changes: { originalDurationDays: 2 },
    });
    await runSchedule(project);
    const shorter = await compare(project, baselineId);
    expect(shorter.comparisons[0].currentDurationDays).toBe(2);
    expect(shorter.comparisons[0].durationVariance).toBe(-1);
    expect(shorter.comparisons[0].finishVariance).toBeLessThan(0);
  });

  it("reports work added after the baseline explicitly, with no invented baseline dates", async () => {
    const project = await makeProject("Variance New Activity");
    await addActivity(project, { activityName: "Task A", originalDurationDays: 3 });
    await runSchedule(project);
    const baselineId = await capture(project, "Approved Rev A");

    const addedId = await addActivity(project, { activityName: "Task B (added later)", originalDurationDays: 4 });
    await runSchedule(project);

    const result = await compare(project, baselineId);

    // The shipped contract stays "one row per approved baseline activity".
    expect(result.comparisons.length).toBe(1);
    expect(result.comparisons[0].activityName).toBe("Task A");

    expect(result.newSinceBaseline.length).toBe(1);
    const added = result.newSinceBaseline[0];
    expect(added.activityId).toBe(addedId);
    expect(added.activityName).toBe("Task B (added later)");
    expect(added.status).toBe("new-since-baseline");
    expect(added.statusLabel).toBe("New since baseline");
    expect(added.hasBaseline).toBe(false);
    // No fabricated baseline truth.
    expect(added.snapshotId).toBeNull();
    expect(added.baselineScheduledStart).toBeNull();
    expect(added.baselineScheduledFinish).toBeNull();
    expect(added.baselineDurationDays).toBeNull();
    expect(added.startVariance).toBeNull();
    expect(added.finishVariance).toBeNull();
    expect(added.durationVariance).toBeNull();
    // Its current forecast is still reported.
    expect(added.currentScheduledStart).not.toBeNull();
    expect(added.currentDurationDays).toBe(4);

    expect(result.project.newSinceBaselineCount).toBe(1);
    expect(result.project.statusCounts["new-since-baseline"]).toBe(1);
    // The added activity is part of the current project finish.
    expect(result.project.currentFinish).not.toBeNull();
  });

  it("keeps approved history and reports null variance when a baseline activity is archived", async () => {
    const project = await makeProject("Variance Archived Activity");
    const activityId = await addActivity(project, { activityName: "Task A", originalDurationDays: 3 });
    await runSchedule(project);
    const baselineId = await capture(project, "Approved Rev A");
    const before = await snapshotsOf(baselineId);

    const dryRun = await caller.primaveraLite.archiveActivityDryRun({
      slug: project.slug,
      access: project.editor,
      expectedRevision: await revision(project),
      activityId,
    });
    await caller.primaveraLite.archiveActivity({
      slug: project.slug,
      access: project.editor,
      expectedRevision: await revision(project),
      activityId,
      previewToken: dryRun.previewToken,
      confirmed: true,
    });
    await runSchedule(project);

    const result = await compare(project, baselineId);
    const row = result.comparisons[0];

    expect(row.activityName).toBe("Task A");
    expect(row.currentArchivedAt).toBeTruthy();
    expect(row.currentMissing).toBe(false);
    // An archived activity is not in the current schedule, so it has no
    // current forecast to compare: variances are "not applicable", not 0.
    expect(row.status).toBe("removed");
    expect(row.currentScheduledStart).toBeNull();
    expect(row.currentScheduledFinish).toBeNull();
    expect(row.currentDurationDays).toBeNull();
    expect(row.startVariance).toBeNull();
    expect(row.finishVariance).toBeNull();
    expect(row.durationVariance).toBeNull();
    // Approved truth is intact.
    expect(row.baselineScheduledStart).toBe(before[0].scheduledStart);
    expect(row.baselineScheduledFinish).toBe(before[0].scheduledFinish);
    expect(result.project.removedSinceBaselineCount).toBe(1);
  });

  it("keeps approved history when a baseline activity is hard deleted", async () => {
    const project = await makeProject("Variance Deleted Activity");
    const activityId = await addActivity(project, { activityName: "Task A", originalDurationDays: 3 });
    await runSchedule(project);
    const baselineId = await capture(project, "Approved Rev A");
    const before = await snapshotsOf(baselineId);

    await testDb.delete(ganttActivities).where(eq(ganttActivities.id, activityId));
    await runSchedule(project);

    const result = await compare(project, baselineId);
    const row = result.comparisons[0];
    expect(row.currentMissing).toBe(true);
    expect(row.status).toBe("removed");
    expect(row.startVariance).toBeNull();
    expect(row.finishVariance).toBeNull();
    expect(row.durationVariance).toBeNull();

    const after = await snapshotsOf(baselineId);
    expect(after).toEqual(before);
  });

  it("baseline stays immutable across rename, WBS move, progress, remaining and dependency changes", async () => {
    const project = await makeProject("Variance Immutability");
    const activityId = await addActivity(project, { activityName: "Task A", originalDurationDays: 3 });
    const secondActivityId = await addActivity(project, { activityName: "Task B", originalDurationDays: 2 });
    await runSchedule(project);
    const baselineId = await capture(project, "Approved Rev A");
    const before = await snapshotsOf(baselineId);

    // Rename + duration + progress + remaining duration.
    await caller.primaveraLite.updateActivity({
      slug: project.slug,
      access: project.editor,
      expectedRevision: await revision(project),
      activityId,
      changes: {
        activityName: "Task A renamed",
        activityId: "A-999",
        percentComplete: 50,
        remainingDurationDays: 6,
      },
    });

    // Rename the WBS node the activity actually sits on, then move the activity
    // to a different WBS node.
    const [activityRow] = await testDb
      .select({ wbsNodeId: ganttActivities.wbsNodeId })
      .from(ganttActivities)
      .where(eq(ganttActivities.id, activityId));

    // A project may only have one parentless node (its root), so the new leaf
    // branch hangs off the existing root.
    const [rootNode] = await testDb
      .select({ id: ganttWbsNodes.id })
      .from(ganttWbsNodes)
      .where(and(eq(ganttWbsNodes.projectId, project.id), isNull(ganttWbsNodes.parentNodeId)));
    const createdWbs = await caller.primaveraLite.createWbsNode({
      slug: project.slug,
      access: project.editor,
      expectedRevision: await revision(project),
      parentNodeId: rootNode.id,
      name: "New Branch",
    });
    await caller.primaveraLite.renameWbsNode({
      slug: project.slug,
      access: project.editor,
      expectedRevision: await revision(project),
      nodeId: activityRow.wbsNodeId,
      name: "Renamed original branch",
    });
    await caller.primaveraLite.updateActivity({
      slug: project.slug,
      access: project.editor,
      expectedRevision: await revision(project),
      activityId,
      changes: { wbsNodeId: createdWbs.node.id },
    });

    // A dependency, a Data Date change, then a recalculation.
    await caller.primaveraLite.createDependency({
      slug: project.slug,
      access: project.editor,
      expectedRevision: await revision(project),
      dependency: {
        predecessorActivityId: activityId,
        successorActivityId: secondActivityId,
        dependencyType: "FS",
        lagDays: 2,
      },
    });
    await setDataDate(project, "2026-09-14");
    await runSchedule(project);

    const after = await snapshotsOf(baselineId);
    // Byte-identical approved reference: no drift of any kind.
    expect(after).toEqual(before);

    const result = await compare(project, baselineId);
    expect(result.baseline.name).toBe("Approved Rev A");
    expect(result.comparisons[0].baselineScheduledStart).toBe(before[0].scheduledStart);
    expect(result.comparisons[0].baselineScheduledFinish).toBe(before[0].scheduledFinish);
    expect(result.comparisons[0].baselineDurationDays).toBe(3);
    expect(result.comparisons[0].originalDurationDays).toBe(3);
    // The edits did move the current schedule, and that is real variance.
    expect(result.comparisons[0].status).toBe("late");
    expect(result.comparisons[0].finishVariance).toBeGreaterThan(0);
  });

  it("derives current duration from actuals for completed work instead of the engine's zero remaining", async () => {
    const project = await makeProject("Variance Completed Duration");
    const activityId = await addActivity(project, { activityName: "Task A", originalDurationDays: 2 });
    await runSchedule(project);
    const baselineId = await capture(project, "Approved Rev A");

    await caller.primaveraLite.updateActivity({
      slug: project.slug,
      access: project.editor,
      expectedRevision: await revision(project),
      activityId,
      changes: {
        percentComplete: 100,
        actualStart: "2026-09-10",
        actualFinish: "2026-09-17",
      },
    });
    await runSchedule(project);

    const result = await compare(project, baselineId);
    const row = result.comparisons[0];
    expect(row.baselineDurationDays).toBe(2);
    // 2026-09-10 .. 2026-09-17 spans 6 working days (Mon-Fri + Mon), not 0.
    expect(row.currentDurationDays).toBe(6);
    expect(row.durationVariance).toBe(4);
  });

  it("baseline creation never changes schedule or progress truth", async () => {
    const project = await makeProject("Variance No Progress Mutation");
    const activityId = await addActivity(project, { activityName: "Task A", originalDurationDays: 3 });
    await runSchedule(project);

    const readTruth = async () => {
      const [row] = await testDb
        .select({
          earlyStart: ganttActivities.earlyStart,
          earlyFinish: ganttActivities.earlyFinish,
          lateStart: ganttActivities.lateStart,
          lateFinish: ganttActivities.lateFinish,
          totalFloatDays: ganttActivities.totalFloatDays,
          freeFloatDays: ganttActivities.freeFloatDays,
          percentComplete: ganttActivities.percentComplete,
          actualStart: ganttActivities.actualStart,
          actualFinish: ganttActivities.actualFinish,
          remainingDurationDays: ganttActivities.remainingDurationDays,
          originalDurationDays: ganttActivities.originalDurationDays,
          dataDate: ganttProjects.dataDate,
        })
        .from(ganttActivities)
        .innerJoin(ganttProjects, eq(ganttActivities.projectId, ganttProjects.id))
        .where(eq(ganttActivities.id, activityId));
      return row;
    };

    const before = await readTruth();
    const baselineId = await capture(project, "Approved Rev A");
    const afterCapture = await readTruth();
    expect(afterCapture).toEqual(before);

    await compare(project, baselineId);
    const afterCompare = await readTruth();
    expect(afterCompare).toEqual(before);
  });

  it("exposes the variance comparison to a viewer without granting capture", async () => {
    const project = await makeProject("Variance Viewer Read");
    await addActivity(project, { activityName: "Task A", originalDurationDays: 3 });
    await runSchedule(project);
    const baselineId = await capture(project, "Approved Rev A");

    const viewerResult = await compare(project, baselineId, project.viewer);
    expect(viewerResult.project.baselineFinish).not.toBeNull();
    expect(viewerResult.project.finishVariance).toBe(0);
    expect(viewerResult.comparisons[0].durationVariance).toBe(0);

    await expect(
      caller.primaveraLite.captureBaseline({
        slug: project.slug,
        access: project.viewer,
        expectedRevision: await revision(project),
        name: "Viewer cannot do this",
      })
    ).rejects.toThrow(/admin|forbidden/i);
  });

  it("reports a newer baseline as the project's rebaseline while preserving the earlier one", async () => {
    const project = await makeProject("Variance Rebaseline");
    await addActivity(project, { activityName: "Task A", originalDurationDays: 3 });
    await runSchedule(project);
    const firstBaselineId = await capture(project, "Approved Rev A");
    const firstSnapshots = await snapshotsOf(firstBaselineId);

    await setDataDate(project, "2026-09-20");
    await runSchedule(project);
    const secondBaselineId = await capture(project, "Approved Rev B");

    expect(secondBaselineId).toBeGreaterThan(firstBaselineId);

    // The earlier baseline is history, not a casualty of the rebaseline.
    expect(await snapshotsOf(firstBaselineId)).toEqual(firstSnapshots);

    const againstFirst = await compare(project, firstBaselineId);
    expect(againstFirst.project.finishVariance).toBeGreaterThan(0);

    const againstSecond = await compare(project, secondBaselineId);
    expect(againstSecond.project.finishVariance).toBe(0);
    expect(againstSecond.baseline.name).toBe("Approved Rev B");

    const listed = await caller.primaveraLite.listBaselines({
      slug: project.slug,
      access: project.admin,
    });
    expect(listed.baselines.length).toBe(2);
    // Capture is append-only, and the audit trail records each capture.
    const events = await testDb
      .select()
      .from(ganttProjectEvents)
      .where(and(eq(ganttProjectEvents.projectId, project.id), eq(ganttProjectEvents.entityType, "baseline")));
    expect(events.length).toBe(2);
    expect(events.every((e) => e.action === "capture")).toBe(true);
  });

  it("serialises concurrent baseline captures so a project can never end up with a half-written baseline", async () => {
    const project = await makeProject("Variance Concurrency");
    await addActivity(project, { activityName: "Task A", originalDurationDays: 3 });
    await runSchedule(project);
    const rev = await revision(project);

    // Two admins press "capture" at the same revision at the same moment.
    const results = await Promise.allSettled([
      caller.primaveraLite.captureBaseline({
        slug: project.slug,
        access: project.admin,
        expectedRevision: rev,
        name: "Race A",
      }),
      caller.primaveraLite.captureBaseline({
        slug: project.slug,
        access: project.admin,
        expectedRevision: rev,
        name: "Race B",
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(
      /updated by another user|CONFLICT/i
    );

    const winner = (fulfilled[0] as PromiseFulfilledResult<{ baseline: { id: number } }>).value;
    createdBaselineIds.push(winner.baseline.id);

    // Exactly one baseline, with a complete snapshot, and exactly one audit event.
    const baselineRows = await testDb
      .select()
      .from(ganttBaselines)
      .where(eq(ganttBaselines.projectId, project.id));
    expect(baselineRows.length).toBe(1);
    expect(baselineRows[0].activityCount).toBe(1);
    expect((await snapshotsOf(winner.baseline.id)).length).toBe(1);

    const events = await testDb
      .select()
      .from(ganttProjectEvents)
      .where(and(eq(ganttProjectEvents.projectId, project.id), eq(ganttProjectEvents.entityType, "baseline")));
    expect(events.length).toBe(1);

    // The project revision advanced exactly once for the whole race.
    expect(await revision(project)).toBe(rev + 1);
  });

  it("measures a completed activity's duration on its OWN calendar, not the calendar it was approved under", async () => {
    const project = await makeProject("Variance Calendar Authority");
    // The baseline is approved under the project default (Mon-Fri) calendar.
    const [defaultCalendar] = await testDb
      .select({ id: ganttCalendars.id })
      .from(ganttCalendars)
      .where(eq(ganttCalendars.projectId, project.id));
    const sixDayWeek = await caller.primaveraLite.createCalendar({
      slug: project.slug,
      access: project.editor,
      expectedRevision: await revision(project),
      calendar: { name: "Six-day week", workingDays: [1, 2, 3, 4, 5, 6] },
    });

    const activityId = await addActivity(project, {
      activityName: "Task A",
      originalDurationDays: 6,
      calendarId: defaultCalendar.id,
    });
    await runSchedule(project);
    const baselineId = await capture(project, "Approved Rev A");

    const frozen = await snapshotsOf(baselineId);
    expect(frozen[0].calendarId).toBe(defaultCalendar.id);
    expect(frozen[0].originalDurationDays).toBe(6);

    // The SAME work is now recorded completed across a Saturday and the activity
    // is moved to the six-day week. Nothing about the work changed.
    await caller.primaveraLite.updateActivity({
      slug: project.slug,
      access: project.editor,
      expectedRevision: await revision(project),
      activityId,
      changes: {
        percentComplete: 100,
        actualStart: "2026-09-10",
        actualFinish: "2026-09-16",
        calendarId: sixDayWeek.calendar.id,
      },
    });
    await runSchedule(project);

    const result = await compare(project, baselineId);
    const row = result.comparisons[0];

    // The actual span 2026-09-10..2026-09-16 is 6 working days on the activity's
    // own six-day calendar and only 5 on the approved Mon-Fri calendar. Measuring
    // it against the approved calendar used to report a 1-day SHRINK (-1) for an
    // unchanged duration; the duration must follow the activity's own calendar,
    // exactly as the scheduling engine selects it.
    expect(row.baselineDurationDays).toBe(6);
    expect(row.currentDurationDays).toBe(6);
    expect(row.durationVariance).toBe(0);

    // Unfinished work stays calendar-independent: its duration is the duration the
    // engine places, so moving an unfinished activity between calendars is not
    // variance either.
    const openId = await addActivity(project, {
      activityName: "Task B open",
      originalDurationDays: 4,
      calendarId: defaultCalendar.id,
    });
    await runSchedule(project);
    await capture(project, "Second");
    await caller.primaveraLite.updateActivity({
      slug: project.slug,
      access: project.editor,
      expectedRevision: await revision(project),
      activityId: openId,
      changes: { calendarId: sixDayWeek.calendar.id },
    });
    await runSchedule(project);
    const secondBaselineId = (
      await caller.primaveraLite.listBaselines({ slug: project.slug, access: project.admin })
    ).baselines.slice(-1)[0].id;
    const afterMove = await compare(project, secondBaselineId);
    const openRow = afterMove.comparisons.find((r: any) => r.activityId === openId);
    expect(openRow).toBeDefined();
    expect(openRow!.baselineDurationDays).toBe(4);
    expect(openRow!.currentDurationDays).toBe(4);
    expect(openRow!.durationVariance).toBe(0);
  });
});
