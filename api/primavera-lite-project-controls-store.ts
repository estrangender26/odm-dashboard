/**
 * ODM host implementation of the project-controls persistence port.
 *
 * This is the ONE adapter that connects @lihok/project-controls/persistence to
 * ODM's Drizzle/Postgres storage. It is deliberately the only place in ODM that
 * reaches its owned tables:
 *
 *   M2A (baseline cluster)  gantt_baselines, gantt_baseline_activities
 *   M2B (calendar cluster)  gantt_calendars,  gantt_calendar_exceptions
 *
 * What lives here (persistence responsibilities):
 *   - the baseline / calendar / calendar-exception queries and writes
 *   - the project-scoped read scope (project, activities, WBS, calendars)
 *   - the project-scoped write scope (revision bump, inserts, audit)
 *   - the transaction boundaries, the project lock and the write gate
 *   - project-scoped reads: a calendar or exception id belonging to another
 *     project resolves to nothing, so cross-project access is impossible here
 *
 * What deliberately does NOT live here:
 *   - rate limiting, tRPC procedure declarations, request parsing
 *   - token resolution and authorization policy
 *   - domain decisions: name uniqueness, working-day rules, no-op detection,
 *     schedule relevance, comparison/variance semantics (router + package)
 *   - response mapping for the API surface (router concern)
 *
 * The shared low-level primitives (lock, revision bump, the single audit writer,
 * the F-08 freshness read, calendar resolution) remain owned by the router and
 * are INJECTED here rather than re-implemented: there is exactly one
 * implementation of each, so this seam adds no second source of truth.
 */

import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import {
  ganttActivities,
  ganttBaselineActivities,
  ganttBaselines,
  ganttCalendarExceptions,
  ganttCalendars,
  ganttProjects,
  ganttWbsNodes,
} from "@db/schema";
import type { ScheduleCalendarInput } from "@lihok/project-controls";
import {
  asProjectRevision,
  internalProjectKey,
  toProjectRef,
  type ActivityQuery,
  type ActivityRecord,
  type BaselineRecord,
  type BaselineSnapshotRecord,
  type CalendarExceptionRecord,
  type CalendarExceptionUpdate,
  type CalendarRecord,
  type CalendarUpdate,
  type NewAuditEvent,
  type NewBaselineRecord,
  type NewBaselineSnapshotRecord,
  type NewCalendarExceptionRecord,
  type NewCalendarRecord,
  type ProjectControlsStore,
  type ProjectReadScope,
  type ProjectRecord,
  type ProjectRef,
  type ProjectWriteGate,
  type ProjectWriteScope,
  type ScheduleFreshness,
  type WbsNodeQuery,
  type WbsNodeRecord,
} from "@lihok/project-controls/persistence";
import { db } from "./queries/connection";

/** The ODM transaction handle this adapter runs inside. */
type Tx = PgTransaction<any, any, any>;

/** The host context the single ODM audit writer needs (a subset of AccessContext). */
export interface ProjectControlsAuditContext {
  projectId: number;
  projectRevision: number;
  actorName?: string;
}

/**
 * Host capabilities the adapter depends on. Every entry is an existing ODM
 * primitive — the adapter never re-implements one.
 */
export interface ProjectControlsStoreHostDependencies {
  /** Serialise concurrent writers on one project row (`SELECT … FOR UPDATE`). */
  lockProject(tx: Tx, projectId: number): Promise<void>;
  /** Advance the project revision by exactly one, returning the new value. */
  bumpProjectRevision(tx: Tx, projectId: number): Promise<number>;
  /** ODM's single audit writer; keeps the current actor fallback in one place. */
  insertEvent(
    tx: Tx,
    ctx: ProjectControlsAuditContext,
    entityType: string,
    action: string,
    entityId?: number,
    before?: unknown,
    after?: unknown
  ): Promise<void>;
  /** F-08: has the project ever been scheduled, and is that schedule now stale? */
  readScheduleFreshness(
    q: Tx,
    projectId: number
  ): Promise<{ everScheduled: boolean; outOfDate: boolean }>;
  /** Effective calendar for an activity (own calendar, else project default). */
  resolveActivityCalendar(
    tx: Tx,
    projectId: number,
    calendarId: number | null | undefined,
    defaultCalendarId: number | null | undefined
  ): Promise<ScheduleCalendarInput>;
}

function toProjectRecord(row: typeof ganttProjects.$inferSelect): ProjectRecord {
  return {
    projectRef: toProjectRef(row.id),
    revision: asProjectRevision(row.revision),
    dataDate: row.dataDate,
    defaultCalendarId: row.defaultCalendarId,
    archivedAt: row.archivedAt,
  };
}

function toActivityRecord(row: typeof ganttActivities.$inferSelect): ActivityRecord {
  return {
    id: row.id,
    wbsNodeId: row.wbsNodeId,
    activityCode: row.activityId ?? null,
    activityName: row.activityName,
    activityType: row.activityType ?? null,
    sortOrder: row.sortOrder,
    calendarId: row.calendarId,
    originalDurationDays: row.originalDurationDays,
    remainingDurationDays: row.remainingDurationDays,
    percentComplete: row.percentComplete,
    status: row.status,
    earlyStart: row.earlyStart,
    earlyFinish: row.earlyFinish,
    actualStart: row.actualStart,
    actualFinish: row.actualFinish,
    archivedAt: row.archivedAt,
  };
}

function toBaselineRecord(row: typeof ganttBaselines.$inferSelect): BaselineRecord {
  return {
    id: row.id,
    projectRef: toProjectRef(row.projectId),
    publicId: row.publicId,
    name: row.name,
    description: row.description,
    activityCount: row.activityCount,
    projectRevision: asProjectRevision(row.projectRevision),
    capturedAt: row.capturedAt,
    capturedByName: row.capturedByName,
    createdAt: row.createdAt,
  };
}

function toSnapshotRecord(
  row: typeof ganttBaselineActivities.$inferSelect
): BaselineSnapshotRecord {
  return {
    id: row.id,
    activityId: row.activityId,
    activityCode: row.activityCode,
    activityName: row.activityName,
    wbsNodeId: row.wbsNodeId,
    wbsCode: row.wbsCode,
    wbsName: row.wbsName,
    calendarId: row.calendarId,
    calendarName: row.calendarName,
    originalDurationDays: row.originalDurationDays,
    scheduledStart: row.scheduledStart,
    scheduledFinish: row.scheduledFinish,
    sortOrder: row.sortOrder,
  };
}

function toCalendarRecord(row: typeof ganttCalendars.$inferSelect): CalendarRecord {
  return {
    id: row.id,
    projectRef: toProjectRef(row.projectId),
    name: row.name,
    workingDays: row.workingDays,
    hoursPerDay: row.hoursPerDay,
    timezone: row.timezone,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCalendarExceptionRecord(
  row: typeof ganttCalendarExceptions.$inferSelect
): CalendarExceptionRecord {
  return {
    id: row.id,
    calendarId: row.calendarId,
    exceptionDate: row.exceptionDate,
    isWorking: row.isWorking,
    workingHours: row.workingHours,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Ids of one project's calendars, used as an ownership filter so a foreign
 * calendar or exception id can never resolve, whatever id a caller supplies.
 */
function ownedCalendarIds(tx: Tx, projectId: number) {
  return tx
    .select({ id: ganttCalendars.id })
    .from(ganttCalendars)
    .where(eq(ganttCalendars.projectId, projectId));
}

/** Reads over one transaction, scoped to one project. */
function createReadScope(tx: Tx, projectId: number, deps: ProjectControlsStoreHostDependencies): ProjectReadScope {
  return {
    async readProject() {
      const [row] = await tx.select().from(ganttProjects).where(eq(ganttProjects.id, projectId));
      return row ? toProjectRecord(row) : null;
    },

    async readScheduleFreshness(): Promise<ScheduleFreshness> {
      return deps.readScheduleFreshness(tx, projectId);
    },

    async readActivities(query?: ActivityQuery): Promise<readonly ActivityRecord[]> {
      const excludeArchived = query?.archived === "exclude";
      const condition = excludeArchived
        ? and(eq(ganttActivities.projectId, projectId), isNull(ganttActivities.archivedAt))
        : eq(ganttActivities.projectId, projectId);
      const builder = tx.select().from(ganttActivities).where(condition);
      // The capture path is order-sensitive (approved capture order); the
      // whole-project read is NOT ordered, exactly as before this seam existed.
      const rows = excludeArchived
        ? await builder.orderBy(
            asc(ganttActivities.wbsNodeId),
            asc(ganttActivities.sortOrder),
            asc(ganttActivities.id)
          )
        : await builder;
      return rows.map(toActivityRecord);
    },

    async readWbsNodes(query?: WbsNodeQuery): Promise<readonly WbsNodeRecord[]> {
      const ids = query?.ids;
      const rows = ids
        ? ids.length > 0
          ? await tx.select().from(ganttWbsNodes).where(inArray(ganttWbsNodes.id, [...ids]))
          : []
        : await tx.select().from(ganttWbsNodes).where(eq(ganttWbsNodes.projectId, projectId));
      return rows.map((row) => ({ id: row.id, code: row.code, name: row.name }));
    },

    async readCalendars(ids: readonly number[]): Promise<readonly CalendarRecord[]> {
      if (ids.length === 0) return [];
      // Project-scoped as well as id-scoped: the calendar half of the shared
      // id-scoping NIT is hardened here, so a foreign calendar id cannot resolve.
      const rows = await tx
        .select()
        .from(ganttCalendars)
        .where(
          and(
            inArray(ganttCalendars.id, [...ids]),
            eq(ganttCalendars.projectId, projectId)
          )
        );
      return rows.map(toCalendarRecord);
    },

    async readCalendar(calendarId: number): Promise<CalendarRecord | null> {
      const [row] = await tx
        .select()
        .from(ganttCalendars)
        .where(and(eq(ganttCalendars.id, calendarId), eq(ganttCalendars.projectId, projectId)));
      return row ? toCalendarRecord(row) : null;
    },

    async readProjectCalendars(): Promise<readonly CalendarRecord[]> {
      const rows = await tx
        .select()
        .from(ganttCalendars)
        .where(eq(ganttCalendars.projectId, projectId));
      return rows.map(toCalendarRecord);
    },

    async readCalendarException(exceptionId: number): Promise<CalendarExceptionRecord | null> {
      const [row] = await tx
        .select()
        .from(ganttCalendarExceptions)
        .where(
          and(
            eq(ganttCalendarExceptions.id, exceptionId),
            inArray(ganttCalendarExceptions.calendarId, ownedCalendarIds(tx, projectId))
          )
        );
      return row ? toCalendarExceptionRecord(row) : null;
    },

    async readCalendarExceptions(
      calendarId: number
    ): Promise<readonly CalendarExceptionRecord[]> {
      const rows = await tx
        .select()
        .from(ganttCalendarExceptions)
        .where(
          and(
            eq(ganttCalendarExceptions.calendarId, calendarId),
            inArray(ganttCalendarExceptions.calendarId, ownedCalendarIds(tx, projectId))
          )
        );
      return rows.map(toCalendarExceptionRecord);
    },

    async resolveCalendar(
      calendarId: number | null,
      defaultCalendarId: number | null
    ): Promise<ScheduleCalendarInput> {
      return deps.resolveActivityCalendar(tx, projectId, calendarId, defaultCalendarId);
    },

    async readBaselineSnapshots(baselineId: number): Promise<readonly BaselineSnapshotRecord[]> {
      const rows = await tx
        .select()
        .from(ganttBaselineActivities)
        .where(eq(ganttBaselineActivities.baselineId, baselineId))
        .orderBy(asc(ganttBaselineActivities.sortOrder), asc(ganttBaselineActivities.id));
      return rows.map(toSnapshotRecord);
    },
  };
}

/** Reads plus the baseline and calendar writes, all inside one locked transaction. */
function createWriteScope(
  tx: Tx,
  projectId: number,
  deps: ProjectControlsStoreHostDependencies
): ProjectWriteScope {
  return {
    ...createReadScope(tx, projectId, deps),

    async bumpProjectRevision() {
      return asProjectRevision(await deps.bumpProjectRevision(tx, projectId));
    },

    async insertBaseline(record: NewBaselineRecord): Promise<BaselineRecord> {
      const [row] = await tx
        .insert(ganttBaselines)
        .values({
          projectId,
          publicId: randomUUID(),
          name: record.name,
          description: record.description,
          activityCount: record.activityCount,
          projectRevision: record.projectRevision,
          capturedByName: record.capturedByName,
        })
        .returning();
      return toBaselineRecord(row);
    },

    async insertBaselineSnapshots(rows: readonly NewBaselineSnapshotRecord[]): Promise<void> {
      if (rows.length === 0) return;
      await tx.insert(ganttBaselineActivities).values(
        rows.map((row) => ({
          baselineId: row.baselineId,
          activityId: row.activityId,
          activityCode: row.activityCode,
          activityName: row.activityName,
          wbsNodeId: row.wbsNodeId,
          wbsCode: row.wbsCode,
          wbsName: row.wbsName,
          calendarId: row.calendarId,
          calendarName: row.calendarName,
          originalDurationDays: row.originalDurationDays,
          scheduledStart: row.scheduledStart,
          scheduledFinish: row.scheduledFinish,
          sortOrder: row.sortOrder,
        }))
      );
    },

    async appendAuditEvent(event: NewAuditEvent): Promise<void> {
      await deps.insertEvent(
        tx,
        { projectId, projectRevision: event.projectRevision, actorName: event.actorName },
        event.entityType,
        event.action,
        event.entityId ?? undefined,
        event.beforeData,
        event.afterData
      );
    },

    async insertCalendar(record: NewCalendarRecord): Promise<CalendarRecord> {
      const [row] = await tx
        .insert(ganttCalendars)
        .values({
          projectId,
          name: record.name,
          workingDays: [...record.workingDays],
        })
        .returning();
      return toCalendarRecord(row);
    },

    async updateCalendar(calendarId: number, update: CalendarUpdate): Promise<CalendarRecord> {
      const [row] = await tx
        .update(ganttCalendars)
        .set({
          name: update.name,
          workingDays: [...update.workingDays],
          updatedAt: new Date(),
        })
        .where(and(eq(ganttCalendars.id, calendarId), eq(ganttCalendars.projectId, projectId)))
        .returning();
      return toCalendarRecord(row);
    },

    async insertCalendarException(
      record: NewCalendarExceptionRecord
    ): Promise<CalendarExceptionRecord> {
      const [row] = await tx
        .insert(ganttCalendarExceptions)
        .values({
          calendarId: record.calendarId,
          exceptionDate: record.exceptionDate,
          isWorking: record.isWorking,
          description: record.description,
          // The application never populates exception hours; the column stays null.
          workingHours: null,
        })
        .returning();
      return toCalendarExceptionRecord(row);
    },

    async updateCalendarException(
      exceptionId: number,
      update: CalendarExceptionUpdate
    ): Promise<CalendarExceptionRecord> {
      const [row] = await tx
        .update(ganttCalendarExceptions)
        .set({
          exceptionDate: update.exceptionDate,
          isWorking: update.isWorking,
          description: update.description,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ganttCalendarExceptions.id, exceptionId),
            inArray(ganttCalendarExceptions.calendarId, ownedCalendarIds(tx, projectId))
          )
        )
        .returning();
      return toCalendarExceptionRecord(row);
    },

    async deleteCalendarException(exceptionId: number): Promise<void> {
      await tx
        .delete(ganttCalendarExceptions)
        .where(
          and(
            eq(ganttCalendarExceptions.id, exceptionId),
            inArray(ganttCalendarExceptions.calendarId, ownedCalendarIds(tx, projectId))
          )
        );
    },
  };
}

/**
 * Build the ODM project-controls store. The router injects its own primitives,
 * so this adapter duplicates none of them.
 */
export function createPrimaveraLiteProjectControlsStore(
  deps: ProjectControlsStoreHostDependencies
): ProjectControlsStore {
  const projectIdOf = (project: ProjectRef): number => Number(internalProjectKey(project));

  return {
    async listBaselines(project: ProjectRef): Promise<readonly BaselineRecord[]> {
      // A plain read: deliberately NOT wrapped in a transaction, as before.
      const rows = await db
        .select()
        .from(ganttBaselines)
        .where(eq(ganttBaselines.projectId, projectIdOf(project)))
        .orderBy(asc(ganttBaselines.createdAt));
      return rows.map(toBaselineRecord);
    },

    async readBaseline(project: ProjectRef, baselineId: number): Promise<BaselineRecord | null> {
      // Also a plain read, so a caller that fails fast on a missing baseline does
      // so BEFORE opening a transaction — the pre-seam boundary, preserved.
      const [row] = await db
        .select()
        .from(ganttBaselines)
        .where(
          and(
            eq(ganttBaselines.id, baselineId),
            eq(ganttBaselines.projectId, projectIdOf(project))
          )
        );
      return row ? toBaselineRecord(row) : null;
    },

    async withProjectRead<T>(
      project: ProjectRef,
      work: (scope: ProjectReadScope) => Promise<T>
    ): Promise<T> {
      const projectId = projectIdOf(project);
      return db.transaction(async (tx) => work(createReadScope(tx, projectId, deps)));
    },

    async withProjectWrite<T>(
      project: ProjectRef,
      gate: ProjectWriteGate,
      work: (scope: ProjectWriteScope) => Promise<T>
    ): Promise<T> {
      const projectId = projectIdOf(project);
      return db.transaction(async (tx) => {
        await deps.lockProject(tx, projectId);

        const [projectRow] = await tx
          .select()
          .from(ganttProjects)
          .where(eq(ganttProjects.id, projectId));
        if (!projectRow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        }
        if (projectRow.archivedAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Project is archived" });
        }
        if (projectRow.revision !== gate.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }

        return work(createWriteScope(tx, projectId, deps));
      });
    },
  };
}
