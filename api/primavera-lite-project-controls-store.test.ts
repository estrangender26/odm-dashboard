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
import { assertDisposableTestDatabase, resolveDisposableTestDatabaseUrl } from "./disposable-test-db";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";

/**
 * M2A persistence-SEAM suite.
 *
 * The baseline procedures now reach persistence through the ODM baseline store,
 * which owns the transaction, the project lock and the write gate (project
 * exists -> not archived -> expectedRevision matches). These tests cover what the
 * EXISTING baseline suites do not: that a refusal at that gate is complete — it
 * leaves the project, the baseline tables and the audit ledger untouched — and
 * that the store's listing still matches the canonical query.
 */

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

type Project = { id: number; slug: string; admin: string; editor: string };

async function makeProject(name: string): Promise<Project> {
  const created = await caller.primaveraLite.createProject({ name });
  createdProjectIds.push(created.project.id);
  const project: Project = {
    id: created.project.id,
    slug: created.project.slug,
    admin: extractToken(created.adminLink),
    editor: extractToken(created.editorLink),
  };
  const loaded = await caller.primaveraLite.load({ slug: project.slug, access: project.admin });
  await caller.primaveraLite.updateProjectMeta({
    slug: project.slug,
    access: project.admin,
    expectedRevision: loaded.revision,
    changes: { dataDate: "2026-09-10" },
  });
  return project;
}

async function revision(project: Project): Promise<number> {
  const loaded = await caller.primaveraLite.load({ slug: project.slug, access: project.admin });
  return loaded.revision;
}

/**
 * Revision straight from the row, for cases where the public read path refuses
 * (an archived project is not loadable), so a refusal can still be proven inert.
 */
async function rawRevision(project: Project): Promise<number> {
  const [row] = await testDb
    .select({ revision: ganttProjects.revision })
    .from(ganttProjects)
    .where(eq(ganttProjects.id, project.id));
  return row.revision;
}

async function addActivity(project: Project, activityName: string): Promise<void> {
  await caller.primaveraLite.createActivity({
    slug: project.slug,
    access: project.editor,
    expectedRevision: await revision(project),
    activity: { activityName, originalDurationDays: 3 },
  });
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

/** Record everything a refused capture must not have touched. */
async function sideEffects(project: Project) {
  const [baselines, events, snapshots] = await Promise.all([
    testDb.select().from(ganttBaselines).where(eq(ganttBaselines.projectId, project.id)),
    testDb
      .select()
      .from(ganttProjectEvents)
      .where(
        and(
          eq(ganttProjectEvents.projectId, project.id),
          eq(ganttProjectEvents.entityType, "baseline")
        )
      ),
    testDb
      .select({ id: ganttBaselineActivities.id })
      .from(ganttBaselineActivities)
      .where(
        inArray(
          ganttBaselineActivities.baselineId,
          testDb
            .select({ id: ganttBaselines.id })
            .from(ganttBaselines)
            .where(eq(ganttBaselines.projectId, project.id))
        )
      ),
  ]);
  return { baselines: baselines.length, events: events.length, snapshots: snapshots.length };
}

describe("primaveraLite baseline persistence seam (M2A)", () => {
  beforeAll(() => {
    assertDisposableTestDatabase();
  });

  afterAll(async () => {
    if (createdBaselineIds.length > 0) {
      await testDb
        .delete(ganttBaselineActivities)
        .where(inArray(ganttBaselineActivities.baselineId, createdBaselineIds));
      await testDb.delete(ganttBaselines).where(inArray(ganttBaselines.id, createdBaselineIds));
    }
    if (createdProjectIds.length > 0) {
      const activityRows = await testDb
        .select({ id: ganttActivities.id })
        .from(ganttActivities)
        .where(inArray(ganttActivities.projectId, createdProjectIds));
      await testDb
        .delete(ganttActivities)
        .where(inArray(ganttActivities.id, activityRows.map((r) => r.id)));
      await testDb.delete(ganttProjectEvents).where(inArray(ganttProjectEvents.projectId, createdProjectIds));
      await testDb.delete(ganttWbsNodes).where(inArray(ganttWbsNodes.projectId, createdProjectIds));
      await testDb.delete(ganttProjects).where(inArray(ganttProjects.id, createdProjectIds));
    }
    await client.end();
  });

  it("refuses capture on an archived project through the store gate, writing nothing", async () => {
    const project = await makeProject("Seam Archived Gate");
    await addActivity(project, "Task A");
    await runSchedule(project);

    const before = await rawRevision(project);
    const beforeEffects = await sideEffects(project);

    // Simulate an archived project directly (no archive procedure needed, and
    // deliberately NOT bumping the revision so the gate's archived check — not
    // its revision check — is what must fire).
    await testDb
      .update(ganttProjects)
      .set({ archivedAt: new Date() })
      .where(eq(ganttProjects.id, project.id));

    await expect(
      caller.primaveraLite.captureBaseline({
        slug: project.slug,
        access: project.admin,
        expectedRevision: before,
        name: "Must Not Exist",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Project is archived" });

    expect(await rawRevision(project)).toBe(before);
    expect(await sideEffects(project)).toEqual(beforeEffects);
    expect(beforeEffects).toEqual({ baselines: 0, events: 0, snapshots: 0 });
  });

  it("refuses a stale revision at the gate before any side effect", async () => {
    const project = await makeProject("Seam Revision Gate");
    await addActivity(project, "Task A");
    await runSchedule(project);

    const current = await revision(project);

    await expect(
      caller.primaveraLite.captureBaseline({
        slug: project.slug,
        access: project.admin,
        expectedRevision: current + 5,
        name: "Must Not Exist",
      })
    ).rejects.toMatchObject({ code: "CONFLICT", message: "Project was updated by another user" });

    // The gate runs inside the locked transaction and before any write.
    expect(await revision(project)).toBe(current);
    expect(await sideEffects(project)).toEqual({ baselines: 0, events: 0, snapshots: 0 });
  });

  it("captures through the store exactly once per call: one baseline, one snapshot set, one audit event", async () => {
    const project = await makeProject("Seam Capture");
    await addActivity(project, "Task A");
    await runSchedule(project);

    const before = await revision(project);
    const baselineId = await capture(project, "Seam Baseline");

    expect(await revision(project)).toBe(before + 1);

    const effects = await sideEffects(project);
    expect(effects).toEqual({ baselines: 1, events: 1, snapshots: 1 });

    const [baseline] = await testDb
      .select()
      .from(ganttBaselines)
      .where(eq(ganttBaselines.id, baselineId));
    expect(baseline.activityCount).toBe(1);
    expect(baseline.projectRevision).toBe(before + 1);

    const [event] = await testDb
      .select()
      .from(ganttProjectEvents)
      .where(
        and(
          eq(ganttProjectEvents.projectId, project.id),
          eq(ganttProjectEvents.entityType, "baseline")
        )
      );
    expect(event.action).toBe("capture");
    expect(event.projectRevision).toBe(before + 1);
    // Actor attribution is unchanged by the seam: no actorName supplied still
    // persists the existing fallback.
    expect(event.actorName).toBe("Anonymous");
    expect(baseline.capturedByName).toBe("Anonymous");
  });

  it("lists baselines through the store in the same order as the canonical query", async () => {
    const project = await makeProject("Seam Listing");
    await addActivity(project, "Task A");
    await runSchedule(project);

    await capture(project, "First");
    await capture(project, "Second");
    await capture(project, "Third");

    const listed = await caller.primaveraLite.listBaselines({
      slug: project.slug,
      access: project.admin,
    });

    const canonical = await testDb
      .select({ id: ganttBaselines.id })
      .from(ganttBaselines)
      .where(eq(ganttBaselines.projectId, project.id))
      .orderBy(ganttBaselines.createdAt);

    expect(listed.baselines.map((b) => b.id)).toEqual(canonical.map((b) => b.id));
    expect(listed.baselines.map((b) => b.name)).toEqual(["First", "Second", "Third"]);
    // `projectId` is still exposed on the API surface exactly as before the seam.
    expect(listed.baselines.every((b) => b.projectId === project.id)).toBe(true);
  });
});
