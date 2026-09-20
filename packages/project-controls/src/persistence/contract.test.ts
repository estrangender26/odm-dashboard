import { describe, expect, it } from "vitest";
import type { ScheduleCalendarInput } from "../schedulingEngine";
import {
  asProjectRevision,
  internalProjectKey,
  toProjectRef,
  type ActivityRecord,
  type BaselineRecord,
  type BaselineSnapshotRecord,
  type CalendarRecord,
  type NewAuditEvent,
  type NewBaselineRecord,
  type NewBaselineSnapshotRecord,
  type ProjectControlsStore,
  type ProjectReadScope,
  type ProjectRecord,
  type ProjectRef,
  type ProjectWriteGate,
  type ProjectWriteScope,
  type ScheduleFreshness,
  type WbsNodeRecord,
} from "./index";

/**
 * CONTRACT test: proves the persistence port is implementable with NO database,
 * NO Drizzle and NO ODM import.
 *
 * The in-memory store below is TEST-ONLY. It is deliberately not a second
 * production implementation: it stores nothing durably, implements no scheduling
 * or variance algorithm (it never re-derives a date, a duration or a variance —
 * it stores and returns what it was given), and the anti-fork guard counts only
 * non-test files as implementations.
 *
 * It also demonstrates that the port is transport-agnostic: this fake refuses
 * with its OWN error type, not ODM's.
 */

/* ── A refusal type owned by the IMPLEMENTATION, never by the contract ───── */

type ViolationCode = "project-missing" | "project-archived" | "revision-conflict";

class StoreViolation extends Error {
  constructor(readonly code: ViolationCode) {
    super(code);
    this.name = "StoreViolation";
  }
}

/* ── In-memory state ─────────────────────────────────────────────────────── */

/** The snapshot record plus the link the in-memory store filters by. */
type StoredSnapshot = BaselineSnapshotRecord & { baselineIdFor: number };

interface ProjectState {
  revision: number;
  dataDate: string | null;
  defaultCalendarId: number | null;
  archived: boolean;
  activities: ActivityRecord[];
  wbsNodes: WbsNodeRecord[];
  calendars: CalendarRecord[];
  baselines: BaselineRecord[];
  snapshots: StoredSnapshot[];
  events: NewAuditEvent[];
  /** Set when capture inserted a baseline, so the test can assert its rows. */
  nextBaselineId: number;
}

function makeState(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    revision: 1,
    dataDate: "2026-01-31",
    defaultCalendarId: 7,
    archived: false,
    activities: [],
    wbsNodes: [],
    calendars: [],
    baselines: [],
    snapshots: [],
    events: [],
    nextBaselineId: 1,
    ...overrides,
  };
}

function makeActivity(id: number, overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id,
    wbsNodeId: 100 + id,
    activityCode: `A${id}`,
    activityName: `Activity ${id}`,
    activityType: "task",
    sortOrder: id,
    calendarId: null,
    originalDurationDays: 5,
    remainingDurationDays: 5,
    percentComplete: 0,
    status: null,
    earlyStart: "2026-01-05",
    earlyFinish: "2026-01-09",
    actualStart: null,
    actualFinish: null,
    archivedAt: null,
    ...overrides,
  };
}

/**
 * A complete in-memory implementation of the port. If the contract ever grows a
 * member that needs a database, this type stops compiling.
 */
function createInMemoryStore(
  states: Map<string, ProjectState>,
  freshness: ScheduleFreshness = { everScheduled: true, outOfDate: false }
): ProjectControlsStore & { stateOf(project: ProjectRef): ProjectState } {
  const stateOf = (project: ProjectRef): ProjectState => {
    const state = states.get(internalProjectKey(project));
    if (!state) throw new StoreViolation("project-missing");
    return state;
  };

  const readScope = (project: ProjectRef): ProjectReadScope => {
    const state = stateOf(project);
    return {
      async readProject(): Promise<ProjectRecord | null> {
        return {
          projectRef: project,
          revision: asProjectRevision(state.revision),
          dataDate: state.dataDate,
          defaultCalendarId: state.defaultCalendarId,
          archivedAt: state.archived ? new Date("2026-01-01T00:00:00Z") : null,
        };
      },
      async readScheduleFreshness(): Promise<ScheduleFreshness> {
        return freshness;
      },
      async readActivities(query) {
        const rows =
          query?.archived === "exclude"
            ? state.activities.filter((a) => a.archivedAt == null)
            : state.activities;
        return query?.archived === "exclude"
          ? [...rows].sort(
              (a, b) => a.wbsNodeId - b.wbsNodeId || a.sortOrder - b.sortOrder || a.id - b.id
            )
          : rows;
      },
      async readWbsNodes(query) {
        return query?.ids ? state.wbsNodes.filter((n) => query.ids!.includes(n.id)) : state.wbsNodes;
      },
      async readCalendars(ids) {
        return state.calendars.filter((c) => ids.includes(c.id));
      },
      async resolveCalendar(calendarId, defaultCalendarId): Promise<ScheduleCalendarInput> {
        const target = calendarId ?? defaultCalendarId;
        const found = state.calendars.find((c) => c.id === target);
        return found
          ? { id: found.id, name: found.name, workingDays: [1, 2, 3, 4, 5] }
          : { id: 0, name: "Default Calendar", workingDays: [1, 2, 3, 4, 5] };
      },
      async readBaselineSnapshots(baselineId) {
        return state.snapshots
          .filter((s) => s.baselineIdFor === baselineId)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
      },
    };
  };

  const writeScope = (project: ProjectRef): ProjectWriteScope => {
    const state = stateOf(project);
    return {
      ...readScope(project),
      async bumpProjectRevision() {
        state.revision += 1;
        return asProjectRevision(state.revision);
      },
      async insertBaseline(record: NewBaselineRecord): Promise<BaselineRecord> {
        const stored: BaselineRecord = {
          id: state.nextBaselineId++,
          projectRef: project,
          publicId: `public-${state.baselines.length + 1}`,
          name: record.name,
          description: record.description,
          activityCount: record.activityCount,
          projectRevision: record.projectRevision,
          capturedAt: null,
          capturedByName: record.capturedByName,
          createdAt: null,
        };
        state.baselines.push(stored);
        return stored;
      },
      async insertBaselineSnapshots(rows: readonly NewBaselineSnapshotRecord[]) {
        for (const row of rows) {
          state.snapshots.push({ ...row, id: state.snapshots.length + 1, baselineIdFor: row.baselineId });
        }
      },
      async appendAuditEvent(event: NewAuditEvent) {
        state.events.push(event);
      },
    };
  };

  return {
    stateOf,
    async listBaselines(project) {
      return stateOf(project).baselines;
    },
    async readBaseline(project, baselineId) {
      return stateOf(project).baselines.find((b) => b.id === baselineId) ?? null;
    },
    async withProjectRead(project, work) {
      return work(readScope(project));
    },
    async withProjectWrite(project, gate: ProjectWriteGate, work) {
      const state = stateOf(project);
      if (state.archived) throw new StoreViolation("project-archived");
      if (state.revision !== gate.expectedRevision) throw new StoreViolation("revision-conflict");
      return work(writeScope(project));
    },
  };
}

function seed(): { states: Map<string, ProjectState>; project: ProjectRef } {
  const project = toProjectRef(42);
  const states = new Map<string, ProjectState>();
  states.set("42", makeState({
    activities: [makeActivity(2), makeActivity(1)],
    wbsNodes: [
      { id: 102, code: "1.2", name: "Second" },
      { id: 101, code: "1.1", name: "First" },
    ],
    calendars: [{ id: 7, name: "Project Default" }],
  }));
  return { states, project };
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("persistence contract can be implemented without Drizzle/Postgres", () => {
  it("conforms to the port (a DB-backed member would break this assignment)", () => {
    const { states } = seed();
    const store: ProjectControlsStore = createInMemoryStore(states);
    expect(typeof store.withProjectWrite).toBe("function");
  });

  it("carries an opaque project reference that round-trips without changing identity", () => {
    const project = toProjectRef(42);
    expect(internalProjectKey(project)).toBe("42");
    expect(internalProjectKey(toProjectRef("42"))).toBe("42");
    // The reference is a plain string at runtime: nothing about serialization changes.
    expect(JSON.stringify({ p: project })).toBe('{"p":"42"}');
  });

  it("keeps project and row revisions distinct types while staying plain numbers at runtime", () => {
    const revision = asProjectRevision(7);
    expect(revision).toBe(7);
    expect(JSON.stringify({ r: revision })).toBe('{"r":7}');
    // @ts-expect-error a ROW revision is not a PROJECT revision
    const wrong: import("./index").RowRevision = revision;
    expect(wrong).toBe(7);
  });

  it("expresses baseline capture: gate, single revision bump, one audit event, explicit actor", async () => {
    const { states, project } = seed();
    const store = createInMemoryStore(states);

    const captured = await store.withProjectWrite(
      project,
      { expectedRevision: 1 },
      async (scope) => {
        const activities = await scope.readActivities({ archived: "exclude" });
        const revision = await scope.bumpProjectRevision();
        const baseline = await scope.insertBaseline({
          name: "Approved plan",
          description: null,
          activityCount: activities.length,
          projectRevision: revision,
          capturedByName: "Admin Person",
        });
        await scope.insertBaselineSnapshots(
          activities.map((a) => ({
            baselineId: baseline.id,
            activityId: a.id,
            activityCode: a.activityCode,
            activityName: a.activityName,
            wbsNodeId: a.wbsNodeId,
            wbsCode: null,
            wbsName: null,
            calendarId: a.calendarId,
            calendarName: null,
            originalDurationDays: a.originalDurationDays,
            scheduledStart: a.earlyStart,
            scheduledFinish: a.earlyFinish,
            sortOrder: a.sortOrder,
          }))
        );
        await scope.appendAuditEvent({
          entityType: "baseline",
          entityId: baseline.id,
          action: "capture",
          actorName: "Admin Person",
          beforeData: null,
          afterData: { baselineId: baseline.id },
          projectRevision: revision,
        });
        return baseline;
      }
    );

    expect(captured.activityCount).toBe(2);
    expect(captured.projectRevision).toBe(2);

    const state = store.stateOf(project);
    expect(state.revision).toBe(2); // advanced exactly once
    expect(state.events).toHaveLength(1); // exactly one audit event
    expect(state.events[0].action).toBe("capture");
    expect(state.events[0].actorName).toBe("Admin Person"); // attribution is explicit, never invented
    expect(state.events[0].projectRevision).toBe(2);
    expect(state.snapshots.length).toBe(2);
  });

  it("refuses a stale revision, an archived project and an unknown project", async () => {
    const { states, project } = seed();
    const store = createInMemoryStore(states);
    const noop = async () => "ran";

    await expect(store.withProjectWrite(project, { expectedRevision: 99 }, noop)).rejects.toThrow(
      "revision-conflict"
    );
    await expect(store.withProjectWrite(project, { expectedRevision: 1 }, noop)).resolves.toBe("ran");
    await expect(store.withProjectWrite(toProjectRef(9999), { expectedRevision: 1 }, noop)).rejects.toThrow(
      "project-missing"
    );

    states.get("42")!.archived = true;
    await expect(store.withProjectWrite(project, { expectedRevision: 1 }, noop)).rejects.toThrow(
      "project-archived"
    );
  });

  it("expresses baseline listing, ordered reads and comparison inputs", async () => {
    const { states, project } = seed();
    const store = createInMemoryStore(states);
    const state = store.stateOf(project);

    state.baselines.push(
      { id: 1, projectRef: project, publicId: null, name: "First", description: null,
        activityCount: 2, projectRevision: asProjectRevision(2), capturedAt: null,
        capturedByName: null, createdAt: null },
      { id: 2, projectRef: project, publicId: null, name: "Second", description: null,
        activityCount: 2, projectRevision: asProjectRevision(3), capturedAt: null,
        capturedByName: null, createdAt: null }
    );

    const listed = await store.listBaselines(project);
    expect(listed.map((b) => b.name)).toEqual(["First", "Second"]);
    expect(await store.readBaseline(project, 2)).toMatchObject({ name: "Second" });
    expect(await store.readBaseline(project, 404)).toBeNull();

    await store.withProjectRead(project, async (scope) => {
      // The capture path is ordered by WBS node, then sort order, then id.
      const ordered = await scope.readActivities({ archived: "exclude" });
      expect(ordered.map((a) => a.id)).toEqual([1, 2]);

      // Archived rows are visible to the comparison path and excluded from capture.
      state.activities.push(makeActivity(3, { archivedAt: new Date("2026-01-01T00:00:00Z") }));
      expect((await scope.readActivities()).length).toBe(3);
      expect((await scope.readActivities({ archived: "exclude" })).length).toBe(2);

      const calendar = await scope.resolveCalendar(null, state.defaultCalendarId);
      expect(calendar.name).toBe("Project Default");

      const project0 = await scope.readProject();
      expect(project0?.dataDate).toBe("2026-01-31");
      expect(project0?.revision).toBe(1);
    });
  });

  it("leaves the comparison algorithm to the domain, not to the store", async () => {
    // The store hands back rows the domain compares; it never computes variance.
    const { states, project } = seed();
    const store = createInMemoryStore(states);
    const members = Object.keys(store).sort();
    expect(members).toEqual([
      "listBaselines",
      "readBaseline",
      "stateOf",
      "withProjectRead",
      "withProjectWrite",
    ]);
    expect(members.some((m) => /variance|compare|schedule/i.test(m))).toBe(false);
    expect(await store.listBaselines(project)).toEqual([]);
  });
});
