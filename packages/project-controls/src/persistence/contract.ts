/**
 * PERSISTENCE CONTRACT for Lihok project controls (M2A).
 *
 * This module is the seam between the authoritative project-controls domain and
 * whatever stores it. It declares TYPES, INTERFACES and CONTRACT SEMANTICS only:
 *
 *   - NO Drizzle, NO postgres, NO SQL, NO connection, NO migration logic
 *   - NO tRPC, NO React, NO ODM import, NO authentication, NO rate limiting
 *   - the package must stay independent of its persistence implementation
 *
 * The contract is deliberately scoped to what the M2A pilot actually exercises:
 * the BASELINE cluster (capture, list, compare). It is not a speculative
 * "everything the domain will ever need" interface — operations are added when a
 * real consumer is migrated onto them.
 *
 * HOST OBLIGATIONS (what any implementation must guarantee)
 * --------------------------------------------------------
 *  1. `withProjectWrite` owns the transaction AND the project-level lock, and
 *     enforces, before `work` runs, in this order:
 *        (a) the project row exists,
 *        (b) the project is not archived,
 *        (c) `gate.expectedRevision` equals the project's current revision.
 *     A refusal must surface through the host's own transport error type with
 *     the host's own codes/messages — this contract is transport-agnostic and
 *     never dictates the error shape.
 *  2. Everything `work` does against that scope happens in ONE transaction. It
 *     must be impossible to capture a baseline without the lock and the
 *     revision gate above.
 *  3. `withProjectRead` runs `work` inside ONE consistent read transaction.
 *  4. `listBaselines` is a plain read: it must NOT open a transaction.
 */

import type { ScheduleCalendarInput } from "../schedulingEngine";

/* ──────────────────────────────────────────────────────────────────────────
 * Identity
 * ────────────────────────────────────────────────────────────────────────── */

declare const projectRefBrand: unique symbol;

/**
 * An opaque reference to one project, used to address every operation here.
 *
 * Deliberately NOT the raw integer primary key: that key is a host-internal
 * serial (an FK target) and must never become the conceptual cross-host project
 * identity — two deployments writing independently would collide on it. The
 * branding is type-level only, so at runtime a ProjectRef is the plain encoded
 * string and nothing about serialization changes.
 *
 * Canonical encoding (contract semantics): the host's stable project key encoded
 * as a decimal string. `toProjectRef` / `internalProjectKey` are the ONLY
 * sanctioned conversions, so a host value can never be passed where a reference
 * is expected by accident.
 */
export type ProjectRef = string & { readonly [projectRefBrand]: "ProjectRef" };

/** Encode a host project key as an opaque {@link ProjectRef}. */
export function toProjectRef(internalProjectKey: string | number): ProjectRef {
  return String(internalProjectKey) as ProjectRef;
}

/** Decode a {@link ProjectRef} back to the host's project key (as a string). */
export function internalProjectKey(project: ProjectRef): string {
  return String(project);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Revisions — two DIFFERENT concepts, never interchangeable
 * ────────────────────────────────────────────────────────────────────────── */

declare const projectRevisionBrand: unique symbol;
declare const rowRevisionBrand: unique symbol;

/**
 * PROJECT revision: the optimistic-concurrency authority for a whole project.
 *
 * It is the value a caller passes back as `expectedRevision`, and the value
 * every mutation advances by exactly one. Branded number, so at runtime it is
 * an ordinary number: no wrapper object, no serialization change.
 */
export type ProjectRevision = number & { readonly [projectRevisionBrand]: "ProjectRevision" };

/**
 * ROW revision: the per-row evolution counter carried by individual records.
 *
 * It is NOT a concurrency gate and must never be compared against a
 * `ProjectRevision`. M2A does not touch row revisions (the baseline tables have
 * none), so this type is declared only to keep the two concepts distinct at the
 * type level; a constructor arrives with its first real consumer.
 */
export type RowRevision = number & { readonly [rowRevisionBrand]: "RowRevision" };

/** Brand a stored/checked project revision. */
export function asProjectRevision(value: number): ProjectRevision {
  return value as ProjectRevision;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Stored records (the shapes a store must be able to hand back)
 * ────────────────────────────────────────────────────────────────────────── */

/** The subset of a project row the baseline cluster depends on. */
export interface ProjectRecord {
  readonly projectRef: ProjectRef;
  /** Optimistic-concurrency authority (see {@link ProjectRevision}). */
  readonly revision: ProjectRevision;
  /** Data Date; drives statusing roll-up and progress rules. */
  readonly dataDate: string | null;
  /** Calendar used by activities with no calendar of their own. */
  readonly defaultCalendarId: number | null;
  readonly archivedAt: Date | null;
}

/** A project activity, as stored. Dates are calendar-day strings (YYYY-MM-DD). */
export interface ActivityRecord {
  readonly id: number;
  readonly wbsNodeId: number;
  readonly activityCode: string | null;
  readonly activityName: string;
  readonly activityType: string | null;
  readonly sortOrder: number;
  readonly calendarId: number | null;
  readonly originalDurationDays: number;
  readonly remainingDurationDays: number;
  readonly percentComplete: number;
  readonly status: string | null;
  readonly earlyStart: string | null;
  readonly earlyFinish: string | null;
  readonly actualStart: string | null;
  readonly actualFinish: string | null;
  readonly archivedAt: Date | null;
}

/** A WBS node, as stored. */
export interface WbsNodeRecord {
  readonly id: number;
  readonly code: string;
  readonly name: string;
}

/**
 * A project calendar, as stored.
 *
 * The baseline cluster reads only `name` (snapshot labels); the calendar cluster
 * also reads `workingDays` to decide whether an edit is a no-op. One DTO serves
 * both, so the contract has a single calendar shape.
 */
export interface CalendarRecord {
  readonly id: number;
  readonly projectRef: ProjectRef;
  readonly name: string;
  readonly workingDays: readonly number[];
  readonly hoursPerDay: string;
  readonly timezone: string;
  readonly createdAt: Date | null;
  readonly updatedAt: Date | null;
}

/** One calendar exception: a dated override of the calendar's working pattern. */
export interface CalendarExceptionRecord {
  readonly id: number;
  readonly calendarId: number;
  /** Calendar day, YYYY-MM-DD. */
  readonly exceptionDate: string;
  readonly isWorking: boolean;
  readonly workingHours: string | null;
  readonly description: string | null;
  readonly createdAt: Date | null;
  readonly updatedAt: Date | null;
}

/**
 * A captured baseline header.
 *
 * The snapshot itself is a set of {@link BaselineSnapshotRecord} rows. Note the
 * approved snapshot is intentionally LOSSY: it records approved dates and
 * duration, and captures NO dependencies. Widening it is a product/schema
 * decision, not a contract detail, and is explicitly out of M2A scope.
 */
export interface BaselineRecord {
  /** Project-scoped baseline key (the value `compareBaseline` is addressed by). */
  readonly id: number;
  readonly projectRef: ProjectRef;
  readonly publicId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly activityCount: number;
  /** The project revision the baseline was captured at. */
  readonly projectRevision: ProjectRevision;
  readonly capturedAt: Date | null;
  readonly capturedByName: string | null;
  readonly createdAt: Date | null;
}

/** One frozen baseline activity row. */
export interface BaselineSnapshotRecord {
  readonly id: number;
  readonly activityId: number;
  readonly activityCode: string | null;
  readonly activityName: string;
  readonly wbsNodeId: number;
  readonly wbsCode: string | null;
  readonly wbsName: string | null;
  readonly calendarId: number | null;
  readonly calendarName: string | null;
  readonly originalDurationDays: number;
  readonly scheduledStart: string | null;
  readonly scheduledFinish: string | null;
  readonly sortOrder: number;
}

/**
 * F-08 schedule staleness: whether the project has ever been scheduled, and
 * whether the current schedule has since been invalidated by an audited change.
 * A store answers this from its own audit ledger; the rule itself is domain
 * semantics (`isScheduleOutOfDate`) and stays authoritative in the package.
 */
export interface ScheduleFreshness {
  readonly everScheduled: boolean;
  readonly outOfDate: boolean;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Read/write scopes
 * ────────────────────────────────────────────────────────────────────────── */

/** Which activities to read. */
export interface ActivityQuery {
  /**
   * `"exclude"` skips archived rows (the capture path). Defaults to
   * `"include"`, the natural whole-project read (the comparison path, which must
   * still see archived rows so an archived baseline activity can be reported as
   * archived instead of silently disappearing).
   *
   * No ordering is part of this contract beyond the capture path's documented
   * order; an implementation must not invent an ORDER BY that reorders rows a
   * consumer already observes.
   */
  readonly archived?: "exclude" | "include";
}

/** Which WBS nodes to read. */
export interface WbsNodeQuery {
  /** Restrict to these node ids. Omitted means every node of the project. */
  readonly ids?: readonly number[];
}

/** Reads available inside a project scope (one transaction). */
export interface ProjectReadScope {
  /** The project row, or null when it does not exist. */
  readProject(): Promise<ProjectRecord | null>;
  readScheduleFreshness(): Promise<ScheduleFreshness>;
  /**
   * Activities of this project only. With `archived: "exclude"`, ordered by
   * WBS node, then sort order, then id — the approved capture order.
   */
  readActivities(query?: ActivityQuery): Promise<readonly ActivityRecord[]>;
  readWbsNodes(query?: WbsNodeQuery): Promise<readonly WbsNodeRecord[]>;
  readCalendars(ids: readonly number[]): Promise<readonly CalendarRecord[]>;
  /**
   * One calendar OF THIS PROJECT, or null. Never returns a calendar that belongs
   * to another project, whatever id is supplied.
   */
  readCalendar(calendarId: number): Promise<CalendarRecord | null>;
  /** Every calendar of this project. */
  readProjectCalendars(): Promise<readonly CalendarRecord[]>;
  /**
   * One exception OF THIS PROJECT, or null. Project ownership is resolved through
   * the exception's calendar, so a foreign exception id can never be addressed.
   */
  readCalendarException(exceptionId: number): Promise<CalendarExceptionRecord | null>;
  /** Every exception of one of this project's calendars. */
  readCalendarExceptions(
    calendarId: number
  ): Promise<readonly CalendarExceptionRecord[]>;
  /**
   * Resolve the effective calendar for an activity: the activity's own calendar,
   * else the project default, else the built-in default. Returns the same shape
   * the scheduling engine consumes.
   */
  resolveCalendar(
    calendarId: number | null,
    defaultCalendarId: number | null
  ): Promise<ScheduleCalendarInput>;
  /** Frozen snapshot rows of that baseline, in approved baseline order. */
  readBaselineSnapshots(baselineId: number): Promise<readonly BaselineSnapshotRecord[]>;
}

/** A new baseline header. The store owns its identities. */
export interface NewBaselineRecord {
  readonly name: string;
  readonly description: string | null;
  readonly activityCount: number;
  /** The revision this capture is recorded against (post-bump). */
  readonly projectRevision: ProjectRevision;
  /** Explicit attribution. The caller decides the value; see {@link NewAuditEvent}. */
  readonly capturedByName: string;
}

/** A new frozen baseline activity row. */
export interface NewBaselineSnapshotRecord {
  /** The baseline these rows belong to (the one just inserted in this scope). */
  readonly baselineId: number;
  readonly activityId: number;
  readonly activityCode: string | null;
  readonly activityName: string;
  readonly wbsNodeId: number;
  readonly wbsCode: string | null;
  readonly wbsName: string | null;
  readonly calendarId: number | null;
  readonly calendarName: string | null;
  readonly originalDurationDays: number;
  readonly scheduledStart: string | null;
  readonly scheduledFinish: string | null;
  readonly sortOrder: number;
}

/**
 * An audit event to append.
 *
 * `actorName` is REQUIRED and explicit: the store never invents attribution, so
 * a host that knows who acted records it, and a host that does not passes its
 * own fallback. M2A deliberately preserves ODM's existing fallback behaviour.
 */
export interface NewAuditEvent {
  readonly entityType: string;
  readonly entityId: number | null;
  readonly action: string;
  readonly actorName: string;
  readonly beforeData: unknown;
  readonly afterData: unknown;
  readonly projectRevision: ProjectRevision;
}

/** A new calendar. The store owns its identity. */
export interface NewCalendarRecord {
  readonly name: string;
  readonly workingDays: readonly number[];
}

/** The full replacement state of a calendar edit. */
export interface CalendarUpdate {
  readonly name: string;
  readonly workingDays: readonly number[];
}

/** A new calendar exception. */
export interface NewCalendarExceptionRecord {
  readonly calendarId: number;
  readonly exceptionDate: string;
  readonly isWorking: boolean;
  readonly description: string | null;
}

/** The full replacement state of a calendar-exception edit. */
export interface CalendarExceptionUpdate {
  readonly exceptionDate: string;
  readonly isWorking: boolean;
  readonly description: string | null;
}

/** Writes available inside a locked project scope. */
export interface ProjectWriteScope extends ProjectReadScope {
  /** Advance the project revision by exactly one, returning the new value. */
  bumpProjectRevision(): Promise<ProjectRevision>;
  /** Insert the baseline header. The store assigns its keys. */
  insertBaseline(record: NewBaselineRecord): Promise<BaselineRecord>;
  /** Insert the frozen snapshot rows. */
  insertBaselineSnapshots(rows: readonly NewBaselineSnapshotRecord[]): Promise<void>;
  /** Append one audit event. */
  appendAuditEvent(event: NewAuditEvent): Promise<void>;
  /** Insert a calendar into this project. */
  insertCalendar(record: NewCalendarRecord): Promise<CalendarRecord>;
  /** Replace a calendar's editable state; returns the stored result. */
  updateCalendar(calendarId: number, update: CalendarUpdate): Promise<CalendarRecord>;
  /** Insert an exception against one of this project's calendars. */
  insertCalendarException(
    record: NewCalendarExceptionRecord
  ): Promise<CalendarExceptionRecord>;
  /** Replace an exception's editable state; returns the stored result. */
  updateCalendarException(
    exceptionId: number,
    update: CalendarExceptionUpdate
  ): Promise<CalendarExceptionRecord>;
  /** Permanently remove one of this project's exceptions. */
  deleteCalendarException(exceptionId: number): Promise<void>;
}

/** Preconditions a write scope enforces before running its work. */
export interface ProjectWriteGate {
  readonly expectedRevision: number;
}

/* ──────────────────────────────────────────────────────────────────────────
 * The store
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The persistence port for the baseline cluster.
 *
 * A store is supplied by the host; the package never ships one. Implementations
 * MUST satisfy the HOST OBLIGATIONS documented at the top of this file.
 */
export interface ProjectControlsStore {
  /** Every baseline of the project, oldest first. A plain read, no transaction. */
  listBaselines(project: ProjectRef): Promise<readonly BaselineRecord[]>;
  /**
   * One baseline belonging to `project`, or null. A plain read, no transaction:
   * callers that must fail fast on a missing baseline do so before opening one.
   */
  readBaseline(project: ProjectRef, baselineId: number): Promise<BaselineRecord | null>;
  /** Run `work` inside ONE consistent read transaction for `project`. */
  withProjectRead<T>(
    project: ProjectRef,
    work: (scope: ProjectReadScope) => Promise<T>
  ): Promise<T>;
  /**
   * Lock `project`, enforce the gate, then run `work` inside ONE transaction.
   * This is the ONLY way to obtain a {@link ProjectWriteScope}, which is what
   * makes an un-atomic baseline capture unrepresentable.
   */
  withProjectWrite<T>(
    project: ProjectRef,
    gate: ProjectWriteGate,
    work: (scope: ProjectWriteScope) => Promise<T>
  ): Promise<T>;
}
