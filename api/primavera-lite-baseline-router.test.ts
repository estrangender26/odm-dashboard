import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and, inArray } from "drizzle-orm";
import {
  ganttProjects,
  ganttWbsNodes,
  ganttActivities,
  ganttProjectEvents,
  ganttBaselines,
  ganttBaselineActivities,
} from "@db/schema";
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
const createdBaselineIds: number[] = [];

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

describe("primaveraLite baseline router", () => {
  beforeAll(async () => {
    assertDisposableTestDatabase();
  });

  afterAll(async () => {
    if (createdBaselineIds.length > 0) {
      await testDb.delete(ganttBaselineActivities).where(
        inArray(
          ganttBaselineActivities.baselineId,
          createdBaselineIds
        )
      );
      await testDb.delete(ganttBaselines).where(inArray(ganttBaselines.id, createdBaselineIds));
    }
    const trackedActivityIds = await testDb
      .select({ id: ganttActivities.id })
      .from(ganttActivities)
      .where(inArray(ganttActivities.projectId, createdProjectIds));
    await testDb.delete(ganttActivities).where(inArray(ganttActivities.id, trackedActivityIds.map((r) => r.id)));
    await testDb.delete(ganttProjectEvents).where(inArray(ganttProjectEvents.projectId, createdProjectIds));
    await testDb.delete(ganttWbsNodes).where(inArray(ganttWbsNodes.projectId, createdProjectIds));
    await testDb.delete(ganttProjects).where(inArray(ganttProjects.id, createdProjectIds));
    await client.end();
  });

  it("admin capture success creates baseline and snapshots", async () => {
    const created = await caller.primaveraLite.createProject({ name: "Baseline Admin Capture" });
    createdProjectIds.push(created.project.id);
    const adminToken = extractToken(created.adminLink);

    const loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const editorToken = extractToken(created.editorLink);
    const activity = await caller.primaveraLite.createActivity({
      slug: created.project.slug,
      access: editorToken,
      expectedRevision: loaded.revision,
      activity: { activityName: "Task A", plannedStart: "2026-09-10", plannedFinish: "2026-09-12", originalDurationDays: 3 },
    });

    const loaded2 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.runSchedule({ slug: created.project.slug, access: adminToken, expectedRevision: loaded2.revision });

    const loaded3 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const scheduledActivity = await testDb
      .select()
      .from(ganttActivities)
      .where(eq(ganttActivities.id, activity.activity.id));

    const captured = await caller.primaveraLite.captureBaseline({
      slug: created.project.slug,
      access: adminToken,
      expectedRevision: loaded3.revision,
      name: "Baseline 1",
    });
    createdBaselineIds.push(captured.baseline.id);

    expect(captured.baseline.name).toBe("Baseline 1");
    expect(captured.activityCount).toBe(1);
    expect(captured.revision).toBe(loaded3.revision + 1);

    const snapshots = await testDb
      .select()
      .from(ganttBaselineActivities)
      .where(eq(ganttBaselineActivities.baselineId, captured.baseline.id));
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].activityId).toBe(activity.activity.id);
    expect(snapshots[0].scheduledStart).toBe(scheduledActivity[0].earlyStart);
    expect(snapshots[0].scheduledFinish).toBe(scheduledActivity[0].earlyFinish);
    expect(snapshots[0].scheduledFinish).not.toBe(scheduledActivity[0].plannedFinish);

    const events = await testDb
      .select()
      .from(ganttProjectEvents)
      .where(and(eq(ganttProjectEvents.projectId, created.project.id), eq(ganttProjectEvents.entityType, "baseline")));
    expect(events.length).toBe(1);
    expect(events[0].action).toBe("capture");
    expect(events[0].projectRevision).toBe(captured.revision);
  });

  it("editor capture is rejected", async () => {
    const created = await caller.primaveraLite.createProject({ name: "Baseline Editor Reject" });
    createdProjectIds.push(created.project.id);
    const editorToken = extractToken(created.editorLink);

    const loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: editorToken });
    await expect(
      caller.primaveraLite.captureBaseline({
        slug: created.project.slug,
        access: editorToken,
        expectedRevision: loaded.revision,
        name: "Bad",
      })
    ).rejects.toThrow(/admin|forbidden/i);
  });

  it("viewer capture is rejected", async () => {
    const created = await caller.primaveraLite.createProject({ name: "Baseline Viewer Reject" });
    createdProjectIds.push(created.project.id);
    const viewerToken = extractToken(created.viewerLink);

    const loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: viewerToken });
    await expect(
      caller.primaveraLite.captureBaseline({
        slug: created.project.slug,
        access: viewerToken,
        expectedRevision: loaded.revision,
        name: "Bad",
      })
    ).rejects.toThrow(/admin|forbidden/i);
  });

  it("stale expectedRevision rejects capture and leaves revision unchanged", async () => {
    const created = await caller.primaveraLite.createProject({ name: "Baseline Stale Revision" });
    createdProjectIds.push(created.project.id);
    const adminToken = extractToken(created.adminLink);

    const loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.updateProjectMeta({
      slug: created.project.slug,
      access: adminToken,
      expectedRevision: loaded.revision,
      changes: { description: "bump" },
    });

    const afterBump = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await expect(
      caller.primaveraLite.captureBaseline({
        slug: created.project.slug,
        access: adminToken,
        expectedRevision: loaded.revision,
        name: "Stale",
      })
    ).rejects.toThrow(/updated by another user|CONFLICT/);

    const final = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    expect(final.revision).toBe(afterBump.revision);

    const baselineRows = await testDb
      .select({ id: ganttBaselines.id })
      .from(ganttBaselines)
      .where(eq(ganttBaselines.projectId, created.project.id));
    expect(baselineRows.length).toBe(0);
  });

  it("capture bumps revision exactly once", async () => {
    const created = await caller.primaveraLite.createProject({ name: "Baseline Revision Bump" });
    createdProjectIds.push(created.project.id);
    const adminToken = extractToken(created.adminLink);

    const loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    // F-08: a baseline requires a fresh successful schedule.
    await caller.primaveraLite.runSchedule({ slug: created.project.slug, access: adminToken, expectedRevision: loaded.revision });
    const loadedSched = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const captured = await caller.primaveraLite.captureBaseline({
      slug: created.project.slug,
      access: adminToken,
      expectedRevision: loadedSched.revision,
      name: "Rev Bump",
    });
    createdBaselineIds.push(captured.baseline.id);

    expect(captured.revision).toBe(loadedSched.revision + 1);

    const reloaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    expect(reloaded.revision).toBe(captured.revision);
  });

  it("capture does not create schedule staleness", async () => {
    const created = await caller.primaveraLite.createProject({ name: "Baseline No Stale" });
    createdProjectIds.push(created.project.id);
    const adminToken = extractToken(created.adminLink);

    const loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const editorToken = extractToken(created.editorLink);
    await caller.primaveraLite.createActivity({
      slug: created.project.slug,
      access: editorToken,
      expectedRevision: loaded.revision,
      activity: { activityName: "Task A", plannedStart: "2026-09-10", plannedFinish: "2026-09-12", originalDurationDays: 3 },
    });

    const loaded2 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.runSchedule({ slug: created.project.slug, access: adminToken, expectedRevision: loaded2.revision });

    const loaded3 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    expect(loaded3.project?.scheduleOutOfDate).toBe(false);

    const captured = await caller.primaveraLite.captureBaseline({
      slug: created.project.slug,
      access: adminToken,
      expectedRevision: loaded3.revision,
      name: "No Stale",
    });
    createdBaselineIds.push(captured.baseline.id);

    const loaded4 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    expect(loaded4.project?.scheduleOutOfDate).toBe(false);
  });

  it("F-08: capture is rejected while the schedule is stale and staleness persists", async () => {
    const created = await caller.primaveraLite.createProject({ name: "Baseline Preserve Stale" });
    createdProjectIds.push(created.project.id);
    const adminToken = extractToken(created.adminLink);

    const loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const editorToken = extractToken(created.editorLink);
    await caller.primaveraLite.createActivity({
      slug: created.project.slug,
      access: editorToken,
      expectedRevision: loaded.revision,
      activity: { activityName: "Task A", plannedStart: "2026-09-10", plannedFinish: "2026-09-12", originalDurationDays: 3 },
    });

    const loaded2 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.runSchedule({ slug: created.project.slug, access: adminToken, expectedRevision: loaded2.revision });

    const loaded3 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.updateActivity({
      slug: created.project.slug,
      access: editorToken,
      expectedRevision: loaded3.revision,
      activityId: (await testDb.select({ id: ganttActivities.id }).from(ganttActivities).where(eq(ganttActivities.projectId, created.project.id)))[0].id,
      changes: { originalDurationDays: 5 },
    });

    const loaded4 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    expect(loaded4.project?.scheduleOutOfDate).toBe(true);

    // Capture must refuse while the schedule is stale.
    await expect(
      caller.primaveraLite.captureBaseline({
        slug: created.project.slug,
        access: adminToken,
        expectedRevision: loaded4.revision,
        name: "Preserve Stale",
      })
    ).rejects.toThrow(/Schedule is out of date/);

    const loaded5 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    expect(loaded5.project?.scheduleOutOfDate).toBe(true);

    const staleBaselineRows = await testDb
      .select({ id: ganttBaselines.id })
      .from(ganttBaselines)
      .where(eq(ganttBaselines.projectId, created.project.id));
    expect(staleBaselineRows.length).toBe(0);
  });

  it("only active activities are captured and archived activities are excluded", async () => {
    const created = await caller.primaveraLite.createProject({ name: "Baseline Archived Excluded" });
    createdProjectIds.push(created.project.id);
    const adminToken = extractToken(created.adminLink);
    const editorToken = extractToken(created.editorLink);

    const loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const activeActivity = await caller.primaveraLite.createActivity({
      slug: created.project.slug,
      access: editorToken,
      expectedRevision: loaded.revision,
      activity: { activityName: "Active Task" },
    });

    const loaded2 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const toArchiveActivity = await caller.primaveraLite.createActivity({
      slug: created.project.slug,
      access: editorToken,
      expectedRevision: loaded2.revision,
      activity: { activityName: "To Archive Task" },
    });

    const loaded3 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const dryRun = await caller.primaveraLite.archiveActivityDryRun({
      slug: created.project.slug,
      access: editorToken,
      expectedRevision: loaded3.revision,
      activityId: toArchiveActivity.activity.id,
    });
    await caller.primaveraLite.archiveActivity({
      slug: created.project.slug,
      access: editorToken,
      expectedRevision: loaded3.revision,
      activityId: toArchiveActivity.activity.id,
      previewToken: dryRun.previewToken,
      confirmed: true,
    });

    const loaded4 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.runSchedule({ slug: created.project.slug, access: adminToken, expectedRevision: loaded4.revision });
    const loaded5 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const captured = await caller.primaveraLite.captureBaseline({
      slug: created.project.slug,
      access: adminToken,
      expectedRevision: loaded5.revision,
      name: "Archived Excluded",
    });
    createdBaselineIds.push(captured.baseline.id);

    expect(captured.activityCount).toBe(1);

    const snapshots = await testDb
      .select()
      .from(ganttBaselineActivities)
      .where(eq(ganttBaselineActivities.baselineId, captured.baseline.id));
    expect(snapshots.map((s) => s.activityId)).toContain(activeActivity.activity.id);
    expect(snapshots.map((s) => s.activityId)).not.toContain(toArchiveActivity.activity.id);
  });

  it("snapshot is unchanged after live schedule and metadata edits", async () => {
    const created = await caller.primaveraLite.createProject({ name: "Baseline Immutable" });
    createdProjectIds.push(created.project.id);
    const adminToken = extractToken(created.adminLink);
    const editorToken = extractToken(created.editorLink);

    const loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const activity = await caller.primaveraLite.createActivity({
      slug: created.project.slug,
      access: editorToken,
      expectedRevision: loaded.revision,
      activity: { activityName: "Task A", plannedStart: "2026-09-10", plannedFinish: "2026-09-12", originalDurationDays: 3 },
    });

    const loaded2 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.runSchedule({ slug: created.project.slug, access: adminToken, expectedRevision: loaded2.revision });

    const loaded3 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const captured = await caller.primaveraLite.captureBaseline({
      slug: created.project.slug,
      access: adminToken,
      expectedRevision: loaded3.revision,
      name: "Immutable",
    });
    createdBaselineIds.push(captured.baseline.id);

    const beforeSnapshots = await testDb
      .select()
      .from(ganttBaselineActivities)
      .where(eq(ganttBaselineActivities.baselineId, captured.baseline.id));

    await caller.primaveraLite.updateActivity({
      slug: created.project.slug,
      access: editorToken,
      expectedRevision: captured.revision,
      activityId: activity.activity.id,
      changes: { activityName: "Renamed", originalDurationDays: 10, plannedStart: "2026-10-01", plannedFinish: "2026-10-05" },
    });

    const loaded4 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.runSchedule({ slug: created.project.slug, access: adminToken, expectedRevision: loaded4.revision });

    const afterSnapshots = await testDb
      .select()
      .from(ganttBaselineActivities)
      .where(eq(ganttBaselineActivities.baselineId, captured.baseline.id));

    expect(afterSnapshots.length).toBe(beforeSnapshots.length);
    for (let i = 0; i < afterSnapshots.length; i++) {
      expect(afterSnapshots[i].activityName).toBe(beforeSnapshots[i].activityName);
      expect(afterSnapshots[i].scheduledStart).toBe(beforeSnapshots[i].scheduledStart);
      expect(afterSnapshots[i].scheduledFinish).toBe(beforeSnapshots[i].scheduledFinish);
      expect(afterSnapshots[i].originalDurationDays).toBe(beforeSnapshots[i].originalDurationDays);
    }
  });

  it("snapshot survives later activity archive", async () => {
    const created = await caller.primaveraLite.createProject({ name: "Baseline Survives Archive" });
    createdProjectIds.push(created.project.id);
    const adminToken = extractToken(created.adminLink);
    const editorToken = extractToken(created.editorLink);

    const loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const activity = await caller.primaveraLite.createActivity({
      slug: created.project.slug,
      access: editorToken,
      expectedRevision: loaded.revision,
      activity: { activityName: "Task A", plannedStart: "2026-09-10", plannedFinish: "2026-09-12", originalDurationDays: 3 },
    });

    const loaded2 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.runSchedule({ slug: created.project.slug, access: adminToken, expectedRevision: loaded2.revision });

    const loaded3 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const captured = await caller.primaveraLite.captureBaseline({
      slug: created.project.slug,
      access: adminToken,
      expectedRevision: loaded3.revision,
      name: "Survives Archive",
    });
    createdBaselineIds.push(captured.baseline.id);

    const dryRun = await caller.primaveraLite.archiveActivityDryRun({
      slug: created.project.slug,
      access: editorToken,
      expectedRevision: captured.revision,
      activityId: activity.activity.id,
    });
    await caller.primaveraLite.archiveActivity({
      slug: created.project.slug,
      access: editorToken,
      expectedRevision: captured.revision,
      activityId: activity.activity.id,
      previewToken: dryRun.previewToken,
      confirmed: true,
    });

    // F-08: comparison requires a fresh schedule — archive made it stale.
    const loaded4 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.runSchedule({ slug: created.project.slug, access: adminToken, expectedRevision: loaded4.revision });

    const compare = await caller.primaveraLite.compareBaseline({
      slug: created.project.slug,
      access: adminToken,
      baselineId: captured.baseline.id,
    });

    expect(compare.comparisons.length).toBe(1);
    expect(compare.comparisons[0].activityName).toBe("Task A");
    expect(compare.comparisons[0].currentArchivedAt).toBeTruthy();
    expect(compare.comparisons[0].currentMissing).toBe(false);
  });

  it("second baseline does not mutate first baseline", async () => {
    const created = await caller.primaveraLite.createProject({ name: "Baseline Second Immutable" });
    createdProjectIds.push(created.project.id);
    const adminToken = extractToken(created.adminLink);
    const editorToken = extractToken(created.editorLink);

    const loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    // F-09: planned dates are informational; the Data Date drives early dates.
    await caller.primaveraLite.updateProjectMeta({
      slug: created.project.slug, access: adminToken, expectedRevision: loaded.revision,
      changes: { dataDate: "2026-09-10" },
    });
    const loadedMeta = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.createActivity({
      slug: created.project.slug,
      access: editorToken,
      expectedRevision: loadedMeta.revision,
      activity: { activityName: "Task A", originalDurationDays: 3 },
    });

    const loaded2 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.runSchedule({ slug: created.project.slug, access: adminToken, expectedRevision: loaded2.revision });

    const loaded3 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const first = await caller.primaveraLite.captureBaseline({
      slug: created.project.slug,
      access: adminToken,
      expectedRevision: loaded3.revision,
      name: "First",
    });
    createdBaselineIds.push(first.baseline.id);

    const firstSnapshotsBefore = await testDb
      .select()
      .from(ganttBaselineActivities)
      .where(eq(ganttBaselineActivities.baselineId, first.baseline.id));

    const loaded4 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.updateProjectMeta({
      slug: created.project.slug, access: adminToken, expectedRevision: loaded4.revision,
      changes: { dataDate: "2026-10-01" },
    });

    const loaded5 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.runSchedule({ slug: created.project.slug, access: adminToken, expectedRevision: loaded5.revision });

    const loaded6 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const second = await caller.primaveraLite.captureBaseline({
      slug: created.project.slug,
      access: adminToken,
      expectedRevision: loaded6.revision,
      name: "Second",
    });
    createdBaselineIds.push(second.baseline.id);

    const firstSnapshotsAfter = await testDb
      .select()
      .from(ganttBaselineActivities)
      .where(eq(ganttBaselineActivities.baselineId, first.baseline.id));

    expect(firstSnapshotsAfter.length).toBe(firstSnapshotsBefore.length);
    for (let i = 0; i < firstSnapshotsAfter.length; i++) {
      expect(firstSnapshotsAfter[i].scheduledStart).toBe(firstSnapshotsBefore[i].scheduledStart);
      expect(firstSnapshotsAfter[i].scheduledFinish).toBe(firstSnapshotsBefore[i].scheduledFinish);
    }

    const secondSnapshots = await testDb
      .select()
      .from(ganttBaselineActivities)
      .where(eq(ganttBaselineActivities.baselineId, second.baseline.id));
    expect(secondSnapshots.some((s) => s.scheduledStart === "2026-10-01")).toBe(true);
  });

  it("list baselines is accessible to all roles", async () => {
    const created = await caller.primaveraLite.createProject({ name: "Baseline List Roles" });
    createdProjectIds.push(created.project.id);
    const adminToken = extractToken(created.adminLink);
    const editorToken = extractToken(created.editorLink);
    const viewerToken = extractToken(created.viewerLink);

    const loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.runSchedule({ slug: created.project.slug, access: adminToken, expectedRevision: loaded.revision });
    const loadedSched = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const captured = await caller.primaveraLite.captureBaseline({
      slug: created.project.slug,
      access: adminToken,
      expectedRevision: loadedSched.revision,
      name: "Listable",
    });
    createdBaselineIds.push(captured.baseline.id);

    const adminList = await caller.primaveraLite.listBaselines({ slug: created.project.slug, access: adminToken });
    const editorList = await caller.primaveraLite.listBaselines({ slug: created.project.slug, access: editorToken });
    const viewerList = await caller.primaveraLite.listBaselines({ slug: created.project.slug, access: viewerToken });

    expect(adminList.baselines.length).toBe(1);
    expect(editorList.baselines.length).toBe(1);
    expect(viewerList.baselines.length).toBe(1);
    expect(adminList.baselines[0].activityCount).toBe(0);
  });

  it("compare baseline is accessible to all roles", async () => {
    const created = await caller.primaveraLite.createProject({ name: "Baseline Compare Roles" });
    createdProjectIds.push(created.project.id);
    const adminToken = extractToken(created.adminLink);
    const editorToken = extractToken(created.editorLink);
    const viewerToken = extractToken(created.viewerLink);

    const loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.runSchedule({ slug: created.project.slug, access: adminToken, expectedRevision: loaded.revision });
    const loadedSched = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const captured = await caller.primaveraLite.captureBaseline({
      slug: created.project.slug,
      access: adminToken,
      expectedRevision: loadedSched.revision,
      name: "Comparable",
    });
    createdBaselineIds.push(captured.baseline.id);

    await expect(
      caller.primaveraLite.compareBaseline({ slug: created.project.slug, access: adminToken, baselineId: captured.baseline.id })
    ).resolves.toBeDefined();
    await expect(
      caller.primaveraLite.compareBaseline({ slug: created.project.slug, access: editorToken, baselineId: captured.baseline.id })
    ).resolves.toBeDefined();
    await expect(
      caller.primaveraLite.compareBaseline({ slug: created.project.slug, access: viewerToken, baselineId: captured.baseline.id })
    ).resolves.toBeDefined();
  });

  it("variance calculations are correct for start and finish", async () => {
    const created = await caller.primaveraLite.createProject({ name: "Baseline Variances" });
    createdProjectIds.push(created.project.id);
    const adminToken = extractToken(created.adminLink);
    const editorToken = extractToken(created.editorLink);

    let loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    // F-09: planned dates are informational; the Data Date anchors the schedule,
    // so variance moves are driven by the Data Date.
    await caller.primaveraLite.updateProjectMeta({
      slug: created.project.slug, access: adminToken, expectedRevision: loaded.revision,
      changes: { dataDate: "2026-09-10" },
    });
    loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const activity = await caller.primaveraLite.createActivity({
      slug: created.project.slug,
      access: editorToken,
      expectedRevision: loaded.revision,
      activity: { activityName: "Task A", originalDurationDays: 1 },
    });

    loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.runSchedule({ slug: created.project.slug, access: adminToken, expectedRevision: loaded.revision });

    loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const captured = await caller.primaveraLite.captureBaseline({
      slug: created.project.slug,
      access: adminToken,
      expectedRevision: loaded.revision,
      name: "Variances",
    });
    createdBaselineIds.push(captured.baseline.id);

    const snapshot = await testDb
      .select()
      .from(ganttBaselineActivities)
      .where(eq(ganttBaselineActivities.baselineId, captured.baseline.id));
    const baselineStart = snapshot[0].scheduledStart;
    const baselineFinish = snapshot[0].scheduledFinish;

    // zero variance when unchanged
    const unchanged = await caller.primaveraLite.compareBaseline({
      slug: created.project.slug,
      access: adminToken,
      baselineId: captured.baseline.id,
    });
    expect(unchanged.comparisons[0].startVariance).toBe(0);
    expect(unchanged.comparisons[0].finishVariance).toBe(0);

    // positive variance: current later than baseline (Data Date moved forward)
    loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.updateProjectMeta({
      slug: created.project.slug, access: adminToken, expectedRevision: loaded.revision,
      changes: { dataDate: "2026-09-15" },
    });
    loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.runSchedule({ slug: created.project.slug, access: adminToken, expectedRevision: loaded.revision });

    const positive = await caller.primaveraLite.compareBaseline({
      slug: created.project.slug,
      access: adminToken,
      baselineId: captured.baseline.id,
    });
    const currentRowPositive = await testDb
      .select({ earlyStart: ganttActivities.earlyStart, earlyFinish: ganttActivities.earlyFinish })
      .from(ganttActivities)
      .where(eq(ganttActivities.id, activity.activity.id));
    const expectedPositiveStart =
      currentRowPositive[0].earlyStart && baselineStart
        ? Math.round((Date.parse(currentRowPositive[0].earlyStart) - Date.parse(baselineStart)) / 86_400_000)
        : null;
    expect(positive.comparisons[0].startVariance).toBe(expectedPositiveStart);
    expect(positive.comparisons[0].startVariance).toBeGreaterThan(0);

    // negative variance: current earlier than baseline (Data Date moved back)
    loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.updateProjectMeta({
      slug: created.project.slug, access: adminToken, expectedRevision: loaded.revision,
      changes: { dataDate: "2026-09-08" },
    });
    loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.runSchedule({ slug: created.project.slug, access: adminToken, expectedRevision: loaded.revision });

    const negative = await caller.primaveraLite.compareBaseline({
      slug: created.project.slug,
      access: adminToken,
      baselineId: captured.baseline.id,
    });
    const currentRowNegative = await testDb
      .select({ earlyStart: ganttActivities.earlyStart, earlyFinish: ganttActivities.earlyFinish })
      .from(ganttActivities)
      .where(eq(ganttActivities.id, activity.activity.id));
    const expectedNegativeStart =
      currentRowNegative[0].earlyStart && baselineStart
        ? Math.round((Date.parse(currentRowNegative[0].earlyStart) - Date.parse(baselineStart)) / 86_400_000)
        : null;
    expect(negative.comparisons[0].startVariance).toBe(expectedNegativeStart);
    expect(negative.comparisons[0].startVariance).toBeLessThan(0);
    expect(negative.comparisons[0].baselineScheduledStart).toBe(baselineStart);
    expect(negative.comparisons[0].baselineScheduledFinish).toBe(baselineFinish);
  });

  it("null-date variance behavior", async () => {
    const created = await caller.primaveraLite.createProject({ name: "Baseline Null Variance" });
    createdProjectIds.push(created.project.id);
    const adminToken = extractToken(created.adminLink);
    const editorToken = extractToken(created.editorLink);

    const loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const activity = await caller.primaveraLite.createActivity({
      slug: created.project.slug,
      access: editorToken,
      expectedRevision: loaded.revision,
      activity: { activityName: "Unscheduled Task" },
    });

    const loaded2 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.runSchedule({ slug: created.project.slug, access: adminToken, expectedRevision: loaded2.revision });

    const loaded3 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const captured = await caller.primaveraLite.captureBaseline({
      slug: created.project.slug,
      access: adminToken,
      expectedRevision: loaded3.revision,
      name: "Null Variance",
    });
    createdBaselineIds.push(captured.baseline.id);

    // A fresh schedule snapshots real dates; the null-variance path only occurs
    // when the current activity row is missing.
    const loaded4 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await testDb.delete(ganttActivities).where(eq(ganttActivities.id, activity.activity.id));

    const compare = await caller.primaveraLite.compareBaseline({
      slug: created.project.slug,
      access: adminToken,
      baselineId: captured.baseline.id,
    });
    expect(compare.comparisons[0].baselineScheduledStart).not.toBeNull();
    expect(compare.comparisons[0].currentMissing).toBe(true);
    expect(compare.comparisons[0].startVariance).toBeNull();
    expect(compare.comparisons[0].finishVariance).toBeNull();
  });

  it("invalid/empty name is rejected", async () => {
    const created = await caller.primaveraLite.createProject({ name: "Baseline Empty Name" });
    createdProjectIds.push(created.project.id);
    const adminToken = extractToken(created.adminLink);

    const loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await expect(
      caller.primaveraLite.captureBaseline({
        slug: created.project.slug,
        access: adminToken,
        expectedRevision: loaded.revision,
        name: "",
      })
    ).rejects.toThrow();
  });

  it("zero-activity baseline is allowed", async () => {
    const created = await caller.primaveraLite.createProject({ name: "Baseline Zero Activities" });
    createdProjectIds.push(created.project.id);
    const adminToken = extractToken(created.adminLink);

    const loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.runSchedule({ slug: created.project.slug, access: adminToken, expectedRevision: loaded.revision });
    const loadedSched = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const captured = await caller.primaveraLite.captureBaseline({
      slug: created.project.slug,
      access: adminToken,
      expectedRevision: loadedSched.revision,
      name: "Empty",
    });
    createdBaselineIds.push(captured.baseline.id);

    expect(captured.activityCount).toBe(0);

    const compare = await caller.primaveraLite.compareBaseline({
      slug: created.project.slug,
      access: adminToken,
      baselineId: captured.baseline.id,
    });
    expect(compare.comparisons.length).toBe(0);
  });

  it("cross-project baseline isolation", async () => {
    const projectA = await caller.primaveraLite.createProject({ name: "Baseline Project A" });
    createdProjectIds.push(projectA.project.id);
    const adminA = extractToken(projectA.adminLink);

    const projectB = await caller.primaveraLite.createProject({ name: "Baseline Project B" });
    createdProjectIds.push(projectB.project.id);
    const adminB = extractToken(projectB.adminLink);

    const loadedA = await caller.primaveraLite.load({ slug: projectA.project.slug, access: adminA });
    await caller.primaveraLite.runSchedule({ slug: projectA.project.slug, access: adminA, expectedRevision: loadedA.revision });
    const loadedA2 = await caller.primaveraLite.load({ slug: projectA.project.slug, access: adminA });
    const baselineA = await caller.primaveraLite.captureBaseline({
      slug: projectA.project.slug,
      access: adminA,
      expectedRevision: loadedA2.revision,
      name: "Project A Baseline",
    });
    createdBaselineIds.push(baselineA.baseline.id);

    await expect(
      caller.primaveraLite.compareBaseline({
        slug: projectB.project.slug,
        access: adminB,
        baselineId: baselineA.baseline.id,
      })
    ).rejects.toThrow(/not found|NOT_FOUND/i);

    await expect(
      caller.primaveraLite.listBaselines({ slug: projectB.project.slug, access: adminB })
    ).resolves.toBeDefined();
  });

  it("F-08: capture is rejected when the project has never been scheduled", async () => {
    const created = await caller.primaveraLite.createProject({ name: "Baseline Never Scheduled" });
    createdProjectIds.push(created.project.id);
    const adminToken = extractToken(created.adminLink);
    const editorToken = extractToken(created.editorLink);

    const loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.createActivity({
      slug: created.project.slug, access: editorToken, expectedRevision: loaded.revision,
      activity: { activityName: "Task A" },
    });
    const loaded2 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });

    await expect(
      caller.primaveraLite.captureBaseline({
        slug: created.project.slug, access: adminToken, expectedRevision: loaded2.revision, name: "Never",
      })
    ).rejects.toThrow(/Run the schedule before capturing a baseline/);

    const baselineRows = await testDb
      .select({ id: ganttBaselines.id })
      .from(ganttBaselines)
      .where(eq(ganttBaselines.projectId, created.project.id));
    expect(baselineRows.length).toBe(0);
  });

  it("F-08: comparison is rejected while the current schedule is stale", async () => {
    const created = await caller.primaveraLite.createProject({ name: "Baseline Stale Compare" });
    createdProjectIds.push(created.project.id);
    const adminToken = extractToken(created.adminLink);
    const editorToken = extractToken(created.editorLink);

    const loaded = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const activity = await caller.primaveraLite.createActivity({
      slug: created.project.slug, access: editorToken, expectedRevision: loaded.revision,
      activity: { activityName: "Task A", originalDurationDays: 2 },
    });
    const loaded2 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.runSchedule({ slug: created.project.slug, access: adminToken, expectedRevision: loaded2.revision });

    const loaded3 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    const captured = await caller.primaveraLite.captureBaseline({
      slug: created.project.slug, access: adminToken, expectedRevision: loaded3.revision, name: "Stale Compare",
    });
    createdBaselineIds.push(captured.baseline.id);

    // Make the schedule stale, then compare must refuse.
    const loaded4 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    await caller.primaveraLite.updateActivity({
      slug: created.project.slug, access: editorToken, expectedRevision: loaded4.revision,
      activityId: activity.activity.id, changes: { originalDurationDays: 5 },
    });
    const loaded5 = await caller.primaveraLite.load({ slug: created.project.slug, access: adminToken });
    expect(loaded5.project?.scheduleOutOfDate).toBe(true);

    await expect(
      caller.primaveraLite.compareBaseline({
        slug: created.project.slug, access: adminToken, baselineId: captured.baseline.id,
      })
    ).rejects.toThrow(/Schedule is out of date/);
  });
});
