/**
 * @lihok/project-controls/persistence — the persistence CONTRACT.
 *
 * Public entry point for the persistence subpath, deliberately separate from the
 * domain entry point (`@lihok/project-controls`): the domain API stays curated
 * and does not grow storage concerns, and consumers cannot reach an
 * implementation through here because there is none — this package declares what
 * a store must do, never how to do it.
 *
 * Boundary rules enforced by src/lib/project-controls-boundary.test.ts:
 *   - contract types and semantics only; no Drizzle/postgres/tRPC/React/ODM
 *   - no persistence IMPLEMENTATION may live in this package
 *   - consumers import this subpath, never a path inside it
 */

export {
  // identity
  toProjectRef,
  internalProjectKey,
  // revisions
  asProjectRevision,
} from "./contract";

export type {
  // identity
  ProjectRef,
  // revisions — two distinct concepts, never interchangeable
  ProjectRevision,
  RowRevision,
  // stored records
  ProjectRecord,
  ActivityRecord,
  WbsNodeRecord,
  CalendarRecord,
  BaselineRecord,
  BaselineSnapshotRecord,
  ScheduleFreshness,
  // query shapes
  ActivityQuery,
  WbsNodeQuery,
  // write shapes
  NewBaselineRecord,
  NewBaselineSnapshotRecord,
  NewAuditEvent,
  // scopes and the port
  ProjectReadScope,
  ProjectWriteScope,
  ProjectWriteGate,
  ProjectControlsStore,
} from "./contract";
