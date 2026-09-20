import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray, and } from "drizzle-orm";
import {
  ganttProjects,
  ganttCalendars,
  ganttCalendarExceptions,
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
 * M2B calendar persistence-SEAM suite.
 *
 * Covers what the existing calendar suite does not:
 *   - cross-project containment for every migrated operation (the hardening)
 *   - refusal leaves no side effect (calendar, exception, revision, audit)
 *   - the calendar cluster respects the project lock and expectedRevision under
 *     genuinely concurrent transactions
 */

const DATABASE_URL = resolveDisposableTestDatabaseUrl();

const client = postgres(DATABASE_URL, { ssl: false, prepare: false, max: 5 });
const testDb = drizzle(client, { schema });

const caller = appRouter.createCaller({
  req: new Request("http://localhost/api/trpc"),
  resHeaders: new Headers(),
  user: undefined,
} as any);

const tok = (l: string) => new URL("http://localhost" + l).searchParams.get("access")!;

const createdProjectIds: number[] = [];

type Project = { id: number; slug: string; admin: string; editor: string };

async function makeProject(name: string): Promise<Project> {
  const created = await caller.primaveraLite.createProject({ name });
  createdProjectIds.push(created.project.id);
  const project: Project = {
    id: created.project.id,
    slug: created.project.slug,
    admin: tok(created.adminLink),
    editor: tok(created.editorLink),
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

/** The project's own calendars, from the DEFAULT one createProject mints, in id order. */
async function calendarIds(project: Project): Promise<number[]> {
  const rows = await testDb
    .select({ id: ganttCalendars.id })
    .from(ganttCalendars)
    .where(eq(ganttCalendars.projectId, project.id))
    .orderBy(ganttCalendars.id);
  return rows.map((r) => r.id);
}

async function addCalendar(project: Project, name: string): Promise<number> {
  const created = await caller.primaveraLite.createCalendar({
    slug: project.slug,
    access: project.editor,
    expectedRevision: await revision(project),
    calendar: { name, workingDays: [1, 2, 3, 4, 5] },
  });
  return created.calendar.id;
}

async function addException(project: Project, calendarId: number, date: string): Promise<number> {
  const created = await caller.primaveraLite.createCalendarException({
    slug: project.slug,
    access: project.editor,
    expectedRevision: await revision(project),
    calendarId,
    exception: { exceptionDate: date, isWorking: false, description: "holiday" },
  });
  return created.exception.id;
}

/** Everything a refused cross-project attempt must not have touched. */
async function snapshotOf(project: Project) {
  const cals = await testDb
    .select({ id: ganttCalendars.id, name: ganttCalendars.name, workingDays: ganttCalendars.workingDays })
    .from(ganttCalendars)
    .where(eq(ganttCalendars.projectId, project.id))
    .orderBy(ganttCalendars.id);
  const calIds = cals.map((c) => c.id);
  const exceptions = calIds.length
    ? await testDb
        .select({
          id: ganttCalendarExceptions.id,
          calendarId: ganttCalendarExceptions.calendarId,
          exceptionDate: ganttCalendarExceptions.exceptionDate,
          isWorking: ganttCalendarExceptions.isWorking,
          description: ganttCalendarExceptions.description,
        })
        .from(ganttCalendarExceptions)
        .where(inArray(ganttCalendarExceptions.calendarId, calIds))
        .orderBy(ganttCalendarExceptions.id)
    : [];
  const events = await testDb
    .select({ id: ganttProjectEvents.id, entityType: ganttProjectEvents.entityType, action: ganttProjectEvents.action })
    .from(ganttProjectEvents)
    .where(eq(ganttProjectEvents.projectId, project.id))
    .orderBy(ganttProjectEvents.id);
  const [row] = await testDb
    .select({ revision: ganttProjects.revision })
    .from(ganttProjects)
    .where(eq(ganttProjects.id, project.id));
  return { calendars: cals, exceptions, events, revision: row.revision };
}

describe("primaveraLite calendar persistence seam (M2B)", () => {
  beforeAll(() => {
    assertDisposableTestDatabase();
  });

  afterAll(async () => {
    if (createdProjectIds.length > 0) {
      const baselines = await testDb
        .select({ id: ganttBaselines.id })
        .from(ganttBaselines)
        .where(inArray(ganttBaselines.projectId, createdProjectIds));
      if (baselines.length > 0) {
        await testDb
          .delete(ganttBaselineActivities)
          .where(inArray(ganttBaselineActivities.baselineId, baselines.map((b) => b.id)));
        await testDb.delete(ganttBaselines).where(inArray(ganttBaselines.id, baselines.map((b) => b.id)));
      }
      const calIds = (
        await testDb
          .select({ id: ganttCalendars.id })
          .from(ganttCalendars)
          .where(inArray(ganttCalendars.projectId, createdProjectIds))
      ).map((c) => c.id);
      if (calIds.length > 0) {
        await testDb
          .delete(ganttCalendarExceptions)
          .where(inArray(ganttCalendarExceptions.calendarId, calIds));
      }
      const activityRows = await testDb
        .select({ id: ganttActivities.id })
        .from(ganttActivities)
        .where(inArray(ganttActivities.projectId, createdProjectIds));
      if (activityRows.length > 0) {
        await testDb
          .delete(ganttActivities)
          .where(inArray(ganttActivities.id, activityRows.map((a) => a.id)));
      }
      await testDb.delete(ganttProjectEvents).where(inArray(ganttProjectEvents.projectId, createdProjectIds));
      await testDb.delete(ganttWbsNodes).where(inArray(ganttWbsNodes.projectId, createdProjectIds));
      await testDb.delete(ganttCalendars).where(inArray(ganttCalendars.projectId, createdProjectIds));
      await testDb.delete(ganttProjects).where(inArray(ganttProjects.id, createdProjectIds));
    }
    await client.end();
  });

  it("refuses every cross-project calendar operation and mutates nothing", async () => {
    const a = await makeProject("Seam Cal X-Project A");
    const b = await makeProject("Seam Cal X-Project B");

    const aCalendar = await addCalendar(a, "A Calendar");
    const bCalendar = await addCalendar(b, "B Calendar");
    const bException = await addException(b, bCalendar, "2026-12-25");

    const bBefore = await snapshotOf(b);
    const aBefore = await snapshotOf(a);

    // 1. update a calendar that belongs to B, using A's credential
    await expect(
      caller.primaveraLite.updateCalendar({
        slug: a.slug,
        access: a.editor,
        expectedRevision: await revision(a),
        calendarId: bCalendar,
        changes: { name: "Hijacked" },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // 2. create an exception against B's calendar
    await expect(
      caller.primaveraLite.createCalendarException({
        slug: a.slug,
        access: a.editor,
        expectedRevision: await revision(a),
        calendarId: bCalendar,
        exception: { exceptionDate: "2026-12-24", isWorking: false },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // 3. update an exception that belongs to B
    await expect(
      caller.primaveraLite.updateCalendarException({
        slug: a.slug,
        access: a.editor,
        expectedRevision: await revision(a),
        exceptionId: bException,
        changes: { isWorking: true },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // 4. delete an exception that belongs to B
    await expect(
      caller.primaveraLite.deleteCalendarException({
        slug: a.slug,
        access: a.editor,
        expectedRevision: await revision(a),
        exceptionId: bException,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // B is untouched in every respect, and A never advanced.
    expect(await snapshotOf(b)).toEqual(bBefore);
    expect(await snapshotOf(a)).toEqual(aBefore);
    expect(await revision(a)).toBe(aBefore.revision);
    expect(await revision(b)).toBe(bBefore.revision);

    // A's own calendar and B's own calendar are still distinct and intact.
    expect(bBefore.calendars.some((c) => c.name === "B Calendar")).toBe(true);
    expect(aCalendar).not.toBe(bCalendar);
  });

  it("refuses a stale revision at the calendar gate without side effects", async () => {
    const project = await makeProject("Seam Cal Revision Gate");
    const calendarId = await addCalendar(project, "Gate Calendar");
    const before = await snapshotOf(project);

    await expect(
      caller.primaveraLite.updateCalendar({
        slug: project.slug,
        access: project.editor,
        expectedRevision: before.revision + 5,
        calendarId,
        changes: { name: "Must Not Apply" },
      })
    ).rejects.toMatchObject({ code: "CONFLICT", message: "Project was updated by another user" });

    expect(await snapshotOf(project)).toEqual(before);
  });

  it("refuses a duplicate calendar name and a duplicate exception date", async () => {
    const project = await makeProject("Seam Cal Uniqueness");
    await addCalendar(project, "Duplicate Me");
    const calendarId = await addCalendar(project, "Exception Host");
    await addException(project, calendarId, "2026-11-01");

    const before = await snapshotOf(project);

    await expect(
      caller.primaveraLite.createCalendar({
        slug: project.slug,
        access: project.editor,
        expectedRevision: await revision(project),
        calendar: { name: "Duplicate Me", workingDays: [1, 2, 3] },
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "A calendar with this name already exists in the project",
    });

    await expect(
      caller.primaveraLite.createCalendarException({
        slug: project.slug,
        access: project.editor,
        expectedRevision: await revision(project),
        calendarId,
        exception: { exceptionDate: "2026-11-01", isWorking: true },
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "An exception already exists for this date",
    });

    expect(await snapshotOf(project)).toEqual(before);
  });

  it("serialises concurrent calendar edits so the project revision advances exactly once", async () => {
    const project = await makeProject("Seam Cal Concurrency");
    const calendarId = await addCalendar(project, "Race Calendar");
    const rev = await revision(project);
    const before = await snapshotOf(project);

    // Two editors submit at the same revision, at the same moment.
    const results = await Promise.allSettled([
      caller.primaveraLite.updateCalendar({
        slug: project.slug,
        access: project.editor,
        expectedRevision: rev,
        calendarId,
        changes: { name: "Race Winner" },
      }),
      caller.primaveraLite.updateCalendar({
        slug: project.slug,
        access: project.editor,
        expectedRevision: rev,
        calendarId,
        changes: { name: "Race Loser" },
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(
      /updated by another user|CONFLICT/i
    );

    const after = await snapshotOf(project);
    // Exactly one revision bump for the whole race.
    expect(after.revision).toBe(rev + 1);
    // Exactly one calendar-update audit event, and only the winner persisted.
    // Which of the two racers wins is not deterministic; that exactly one did is.
    const calendarUpdates = after.events.filter((e) => e.entityType === "calendar" && e.action === "update");
    expect(calendarUpdates.length).toBe(1);
    const raced = after.calendars.filter((c) => c.id === calendarId);
    expect(raced.length).toBe(1);
    expect(["Race Winner", "Race Loser"]).toContain(raced[0].name);
    // The losing attempt left no trace at all: exactly one of the two names exists.
    const raceNames = after.calendars.filter((c) => c.name === "Race Winner" || c.name === "Race Loser");
    expect(raceNames.length).toBe(1);
    expect(before.events.length + 1).toBe(after.events.length);
  });
});
