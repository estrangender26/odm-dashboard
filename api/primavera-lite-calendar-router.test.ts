import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import {
  ganttActivities,
  ganttActivityDependencies,
  ganttCalendarExceptions,
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

async function eventCount(projectId: number) {
  const rows = await testDb.select({ id: ganttProjectEvents.id }).from(ganttProjectEvents).where(eq(ganttProjectEvents.projectId, projectId));
  return rows.length;
}

describe("Primavera Lite Calendar Management", () => {
  beforeAll(assertDisposableDatabase);
  afterAll(async () => {
    if (projectIds.length) {
      await testDb.delete(ganttActivityDependencies).where(inArray(ganttActivityDependencies.projectId, projectIds));
      await testDb.delete(ganttProjectEvents).where(inArray(ganttProjectEvents.projectId, projectIds));
      await testDb.delete(ganttActivities).where(inArray(ganttActivities.projectId, projectIds));
      const cals = await testDb.select({ id: ganttCalendars.id }).from(ganttCalendars).where(inArray(ganttCalendars.projectId, projectIds));
      if (cals.length) {
        await testDb.delete(ganttCalendarExceptions).where(inArray(ganttCalendarExceptions.calendarId, cals.map((c) => c.id)));
      }
      await testDb.delete(ganttCalendars).where(inArray(ganttCalendars.projectId, projectIds));
      await testDb.delete(ganttWbsNodes).where(inArray(ganttWbsNodes.projectId, projectIds));
      await testDb.delete(ganttProjects).where(inArray(ganttProjects.id, projectIds));
    }
    await client.end();
  });

  it("createCalendar: editor/admin succeed, viewer rejected, duplicate/invalid/stale rejected, isolation", async () => {
    const p = await createProject("Cal Create");
    const other = await createProject("Cal Other");
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    await expect(caller.primaveraLite.createCalendar({
      slug: p.project.slug, access: p.viewer, expectedRevision: loaded.revision,
      calendar: { name: "No", workingDays: [1, 2, 3, 4, 5] },
    })).rejects.toThrow(/Editor or admin/i);

    const editorCal = await caller.primaveraLite.createCalendar({
      slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
      calendar: { name: "Editor Cal", workingDays: [1, 2, 3, 4, 5] },
    });
    expect(editorCal.calendar.name).toBe("Editor Cal");
    expect(editorCal.revision).toBe(loaded.revision + 1);
    expect(editorCal.calendar.hoursPerDay).toBeTruthy();
    expect(editorCal.calendar.timezone).toBeTruthy();

    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.admin });
    const adminCal = await caller.primaveraLite.createCalendar({
      slug: p.project.slug, access: p.admin, expectedRevision: loaded.revision,
      calendar: { name: "Admin Cal", workingDays: [6, 0] },
    });
    expect(adminCal.calendar.workingDays).toEqual([0, 6]);

    await expect(caller.primaveraLite.createCalendar({
      slug: p.project.slug, access: p.editor, expectedRevision: adminCal.revision,
      calendar: { name: "Editor Cal", workingDays: [1] },
    })).rejects.toThrow(/already exists/i);

    await expect(caller.primaveraLite.createCalendar({
      slug: p.project.slug, access: p.editor, expectedRevision: adminCal.revision,
      calendar: { name: "Bad Days", workingDays: [9] },
    })).rejects.toThrow(/weekday/i);

    await expect(caller.primaveraLite.createCalendar({
      slug: p.project.slug, access: p.editor, expectedRevision: 0,
      calendar: { name: "Stale", workingDays: [1] },
    })).rejects.toThrow(/updated by another user/i);

    const otherLoaded = await caller.primaveraLite.load({ slug: other.project.slug, access: other.editor });
    expect(otherLoaded.calendars.some((c: { name: string }) => c.name === "Editor Cal")).toBe(false);
  });

  it("updateCalendar: rename preserves id, workingDays update, duplicate rejected, no-op no bump", async () => {
    const p = await createProject("Cal Update");
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const created = await caller.primaveraLite.createCalendar({
      slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
      calendar: { name: "Alpha", workingDays: [1, 2, 3, 4, 5] },
    });
    await caller.primaveraLite.createCalendar({
      slug: p.project.slug, access: p.editor, expectedRevision: created.revision,
      calendar: { name: "Beta", workingDays: [1] },
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    const renamed = await caller.primaveraLite.updateCalendar({
      slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
      calendarId: created.calendar.id, changes: { name: "Alpha Renamed" },
    });
    expect(renamed.calendar.id).toBe(created.calendar.id);
    expect(renamed.calendar.name).toBe("Alpha Renamed");
    expect(renamed.revision).toBe(loaded.revision + 1);

    await expect(caller.primaveraLite.updateCalendar({
      slug: p.project.slug, access: p.editor, expectedRevision: renamed.revision,
      calendarId: created.calendar.id, changes: { name: "Beta" },
    })).rejects.toThrow(/already exists/i);

    const days = await caller.primaveraLite.updateCalendar({
      slug: p.project.slug, access: p.editor, expectedRevision: renamed.revision,
      calendarId: created.calendar.id, changes: { workingDays: [1, 2, 3, 4, 5, 6] },
    });
    expect(days.calendar.workingDays).toEqual([1, 2, 3, 4, 5, 6]);

    const beforeRev = days.revision;
    const eventsBefore = await eventCount(p.project.id);
    const noop = await caller.primaveraLite.updateCalendar({
      slug: p.project.slug, access: p.editor, expectedRevision: beforeRev,
      calendarId: created.calendar.id, changes: { name: "Alpha Renamed", workingDays: [1, 2, 3, 4, 5, 6] },
    });
    expect(noop.revision).toBe(beforeRev);
    expect(noop.noop).toBe(true);
    expect(await eventCount(p.project.id)).toBe(eventsBefore);

    await expect(caller.primaveraLite.updateCalendar({
      slug: p.project.slug, access: p.editor, expectedRevision: 1,
      calendarId: created.calendar.id, changes: { name: "Nope" },
    })).rejects.toThrow(/updated by another user/i);
  });

  it("setProjectDefaultCalendar: admin only, isolation, no-op", async () => {
    const p = await createProject("Cal Default");
    const other = await createProject("Cal Default Other");
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.admin });
    const extra = await caller.primaveraLite.createCalendar({
      slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
      calendar: { name: "Alt", workingDays: [1, 2, 3] },
    });

    await expect(caller.primaveraLite.setProjectDefaultCalendar({
      slug: p.project.slug, access: p.editor, expectedRevision: extra.revision, calendarId: extra.calendar.id,
    })).rejects.toThrow(/Admin token required/i);
    await expect(caller.primaveraLite.setProjectDefaultCalendar({
      slug: p.project.slug, access: p.viewer, expectedRevision: extra.revision, calendarId: extra.calendar.id,
    })).rejects.toThrow(/Admin token required/i);

    const otherCal = (await caller.primaveraLite.load({ slug: other.project.slug, access: other.admin })).calendars[0];
    await expect(caller.primaveraLite.setProjectDefaultCalendar({
      slug: p.project.slug, access: p.admin, expectedRevision: extra.revision, calendarId: otherCal.id,
    })).rejects.toThrow(/Calendar not found/i);

    const set = await caller.primaveraLite.setProjectDefaultCalendar({
      slug: p.project.slug, access: p.admin, expectedRevision: extra.revision, calendarId: extra.calendar.id,
    });
    expect(set.project.defaultCalendarId).toBe(extra.calendar.id);
    expect(set.revision).toBe(extra.revision + 1);

    const eventsBefore = await eventCount(p.project.id);
    const noop = await caller.primaveraLite.setProjectDefaultCalendar({
      slug: p.project.slug, access: p.admin, expectedRevision: set.revision, calendarId: extra.calendar.id,
    });
    expect(noop.revision).toBe(set.revision);
    expect(await eventCount(p.project.id)).toBe(eventsBefore);
  });

  it("exceptions: create/update/delete, uniqueness, isolation, stale revision", async () => {
    const p = await createProject("Cal Exceptions");
    const other = await createProject("Cal Ex Other");
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    const calId = loaded.calendars[0].id;

    const created = await caller.primaveraLite.createCalendarException({
      slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
      calendarId: calId,
      exception: { exceptionDate: "2026-08-17", isWorking: false, description: "Holiday" },
    });
    expect(created.exception.exceptionDate).toBe("2026-08-17");
    expect(created.exception.workingHours).toBeNull();
    expect(created.revision).toBe(loaded.revision + 1);

    await expect(caller.primaveraLite.createCalendarException({
      slug: p.project.slug, access: p.editor, expectedRevision: created.revision,
      calendarId: calId,
      exception: { exceptionDate: "2026-08-17", isWorking: true },
    })).rejects.toThrow(/already exists/i);

    const moved = await caller.primaveraLite.updateCalendarException({
      slug: p.project.slug, access: p.editor, expectedRevision: created.revision,
      exceptionId: created.exception.id,
      changes: { exceptionDate: "2026-08-18" },
    });
    expect(moved.exception.exceptionDate).toBe("2026-08-18");

    const flipped = await caller.primaveraLite.updateCalendarException({
      slug: p.project.slug, access: p.editor, expectedRevision: moved.revision,
      exceptionId: created.exception.id,
      changes: { isWorking: true },
    });
    expect(flipped.exception.isWorking).toBe(true);

    const desc = await caller.primaveraLite.updateCalendarException({
      slug: p.project.slug, access: p.editor, expectedRevision: flipped.revision,
      exceptionId: created.exception.id,
      changes: { description: "note only" },
    });
    expect(desc.exception.description).toBe("note only");

    const otherLoaded = await caller.primaveraLite.load({ slug: other.project.slug, access: other.editor });
    await expect(caller.primaveraLite.updateCalendarException({
      slug: other.project.slug, access: other.editor, expectedRevision: otherLoaded.revision,
      exceptionId: created.exception.id,
      changes: { description: "steal" },
    })).rejects.toThrow(/not found/i);

    await expect(caller.primaveraLite.deleteCalendarException({
      slug: p.project.slug, access: p.editor, expectedRevision: 0,
      exceptionId: created.exception.id,
    })).rejects.toThrow(/updated by another user/i);

    const deleted = await caller.primaveraLite.deleteCalendarException({
      slug: p.project.slug, access: p.editor, expectedRevision: desc.revision,
      exceptionId: created.exception.id,
    });
    expect(deleted.revision).toBe(desc.revision + 1);
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    expect(loaded.calendars[0].exceptions).toHaveLength(0);
  });

  it("proves schedule staleness rules for unused vs used calendars and archived-only usage", async () => {
    const p = await createProject("Cal Stale");
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });

    const activity = await caller.primaveraLite.createActivity({
      slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
      activity: { activityName: "A1", originalDurationDays: 2, plannedStart: "2026-08-10" },
    });
    await caller.primaveraLite.runSchedule({
      slug: p.project.slug, access: p.editor, expectedRevision: activity.revision,
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    expect(loaded.project!.scheduleOutOfDate).toBe(false);

    const unused = await caller.primaveraLite.createCalendar({
      slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
      calendar: { name: "Unused", workingDays: [1, 2, 3, 4, 5] },
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    expect(loaded.project!.scheduleOutOfDate).toBe(false);

    await caller.primaveraLite.updateCalendar({
      slug: p.project.slug, access: p.editor, expectedRevision: unused.revision,
      calendarId: unused.calendar.id, changes: { name: "Unused Renamed" },
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    expect(loaded.project!.scheduleOutOfDate).toBe(false);

    await caller.primaveraLite.updateCalendar({
      slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
      calendarId: unused.calendar.id, changes: { workingDays: [1, 2, 3, 4, 5, 6] },
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    expect(loaded.project!.scheduleOutOfDate).toBe(false);

    const assigned = await caller.primaveraLite.updateActivity({
      slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
      activityId: activity.activity.id,
      changes: { calendarId: unused.calendar.id },
    });
    await caller.primaveraLite.runSchedule({
      slug: p.project.slug, access: p.editor, expectedRevision: assigned.revision,
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    expect(loaded.project!.scheduleOutOfDate).toBe(false);

    await caller.primaveraLite.updateCalendar({
      slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
      calendarId: unused.calendar.id, changes: { workingDays: [1, 2, 3, 4, 5] },
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    expect(loaded.project!.scheduleOutOfDate).toBe(true);

    await caller.primaveraLite.runSchedule({
      slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    expect(loaded.project!.scheduleOutOfDate).toBe(false);

    const ex = await caller.primaveraLite.createCalendarException({
      slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
      calendarId: unused.calendar.id,
      exception: { exceptionDate: "2026-08-11", isWorking: false },
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    expect(loaded.project!.scheduleOutOfDate).toBe(true);

    await caller.primaveraLite.runSchedule({
      slug: p.project.slug, access: p.editor, expectedRevision: ex.revision,
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    expect(loaded.project!.scheduleOutOfDate).toBe(false);

    await caller.primaveraLite.updateCalendarException({
      slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
      exceptionId: ex.exception.id, changes: { description: "only note" },
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    expect(loaded.project!.scheduleOutOfDate).toBe(false);

    await caller.primaveraLite.updateCalendarException({
      slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
      exceptionId: ex.exception.id, changes: { isWorking: true },
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    expect(loaded.project!.scheduleOutOfDate).toBe(true);

    const afterFlip = await caller.primaveraLite.runSchedule({
      slug: p.project.slug, access: p.editor, expectedRevision: loaded.revision,
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.admin });
    expect(loaded.project!.scheduleOutOfDate).toBe(false);

    await caller.primaveraLite.setProjectDefaultCalendar({
      slug: p.project.slug, access: p.admin, expectedRevision: afterFlip.revision,
      calendarId: unused.calendar.id,
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.admin });
    expect(loaded.project!.scheduleOutOfDate).toBe(true);

    const p2 = await createProject("Cal Archived Only");
    loaded = await caller.primaveraLite.load({ slug: p2.project.slug, access: p2.editor });
    const custom = await caller.primaveraLite.createCalendar({
      slug: p2.project.slug, access: p2.editor, expectedRevision: loaded.revision,
      calendar: { name: "Archived Only", workingDays: [1, 2, 3, 4, 5] },
    });
    const act2 = await caller.primaveraLite.createActivity({
      slug: p2.project.slug, access: p2.editor, expectedRevision: custom.revision,
      activity: { activityName: "Soon archived", calendarId: custom.calendar.id, originalDurationDays: 1, plannedStart: "2026-08-10" },
    });
    const dry = await caller.primaveraLite.archiveActivityDryRun({
      slug: p2.project.slug, access: p2.editor, expectedRevision: act2.revision, activityId: act2.activity.id,
    });
    const archived = await caller.primaveraLite.archiveActivity({
      slug: p2.project.slug, access: p2.editor, expectedRevision: act2.revision,
      activityId: act2.activity.id, previewToken: dry.previewToken, confirmed: true,
    });
    await caller.primaveraLite.runSchedule({
      slug: p2.project.slug, access: p2.editor, expectedRevision: archived.revision,
    });
    loaded = await caller.primaveraLite.load({ slug: p2.project.slug, access: p2.editor });
    await caller.primaveraLite.updateCalendar({
      slug: p2.project.slug, access: p2.editor, expectedRevision: loaded.revision,
      calendarId: custom.calendar.id, changes: { workingDays: [1, 2, 3, 4, 5, 6] },
    });
    loaded = await caller.primaveraLite.load({ slug: p2.project.slug, access: p2.editor });
    expect(loaded.project!.scheduleOutOfDate).toBe(false);
  });

  it("changing default calendar changes unassigned activity dates after Run Schedule", async () => {
    const p = await createProject("Cal Default Semantics");
    let loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.admin });
    const satCal = await caller.primaveraLite.createCalendar({
      slug: p.project.slug, access: p.admin, expectedRevision: loaded.revision,
      calendar: { name: "Sat Week", workingDays: [1, 2, 3, 4, 5, 6] },
    });
    const act = await caller.primaveraLite.createActivity({
      slug: p.project.slug, access: p.editor, expectedRevision: satCal.revision,
      activity: { activityName: "Unassigned", originalDurationDays: 6, plannedStart: "2026-08-10" },
    });
    await caller.primaveraLite.runSchedule({
      slug: p.project.slug, access: p.editor, expectedRevision: act.revision,
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    expect(loaded.activities[0].earlyFinish).toBe("2026-08-17");

    const set = await caller.primaveraLite.setProjectDefaultCalendar({
      slug: p.project.slug, access: p.admin, expectedRevision: loaded.revision,
      calendarId: satCal.calendar.id,
    });
    await caller.primaveraLite.runSchedule({
      slug: p.project.slug, access: p.editor, expectedRevision: set.revision,
    });
    loaded = await caller.primaveraLite.load({ slug: p.project.slug, access: p.editor });
    expect(loaded.activities[0].earlyFinish).toBe("2026-08-15");
  });
});
