# ODM Primavera Lite Online

## Software Architecture Document

**Version:** 1.0  
**Status:** Draft — Architecture & Implementation Plan  
**Date:** 2026-08-04  
**Authority:** Lihok Technologies Architecture Governance  
**Repository:** estrangender26/odm-dashboard  
**Primary Route:** `/gantt`  
**Legacy Route (to be retired):** `/gantt-planner`

---

## 1. Document Control

| Attribute | Value |
|-----------|-------|
| Version | 1.0 |
| Status | Draft |
| Author | Codex (Lihok Engineering) |
| Reviewers | TBD |
| Target Merge | After PR breakdown completion |

### 1.1 Scope

This document defines the target architecture, database schema, API design, component hierarchy, and phased implementation plan for **ODM Primavera Lite Online**, the next-generation Gantt/scheduling module for ODM Dashboard.

### 1.2 Objectives

- Replace the legacy `/gantt-planner` with a Primavera P6 Web-equivalent collaborative scheduling system.
- Preserve the valuable work from PR #328 (link sharing, revision control, audit events, calendars, optimistic locking, security model).
- Eliminate all reliance on `tasksData`/`linksData` JSON blobs and browser-session ownership.
- Provide multi-user collaboration, unlimited WBS levels, critical path, baselines, resources, and progress updating.

### 1.3 Constraints

- Database: Supabase PostgreSQL only.
- Supabase Storage: used only for attachments, drawings, exports, imports, PDFs, and supporting documents.
- No production data deletion during architecture phase.
- No deployment or PR creation during architecture phase.
- Must align with [Lihok Technology Standards](./Technology-Standards.md) and [Enterprise Architecture v1.0](./Enterprise-Architecture-v1.0.md).

---

## 2. Executive Summary

ODM Primavera Lite Online is a browser-based project-scheduling system. It targets feature parity with Primavera P6 Web Essentials while remaining operable by a small engineering team.

The module is built on the foundation of PR #328, which introduced:

- Public link sharing (editor + viewer tokens).
- Project-level revision counters.
- Optimistic locking for task and dependency mutations.
- Append-only audit events (`gantt_project_events`).
- Calendar tables (`gantt_calendars`, `gantt_calendar_exceptions`).
- Rate limiting, trusted proxy client-IP handling, and request-body guards.

This architecture document carries those concepts forward and layers on:

- A normalized WBS/activity/relationship data model.
- Server-side CPM scheduling engine.
- Drag-drop WBS and timeline editing.
- Baselines and progress updating.
- Resource assignments.
- A phased retirement path for `/gantt-planner`.

---

## 3. Context & Background

### 3.1 Current State

- `/gantt-planner` uses `gantt_projects.tasks_data` and `gantt_projects.links_data` JSON columns as the source of truth.
- `gantt_tasks` and `gantt_dependencies` exist but are secondary; the planner often rebuilds them from JSON.
- `gantt_projects` rows are historically anonymous-session-owned.
- A destructive `resetGantt` endpoint can drop and recreate legacy tables.

### 3.2 PR #328 Foundation

PR #328 added the collaborative link-sharing layer on top of the existing schema:

- `public_id`, `slug`, `edit_token_hash`, `view_token_hash`, `revision`, `sharing_enabled` on `gantt_projects`.
- `revision` and `updated_by_name` on `gantt_tasks` and `gantt_dependencies`.
- New tables: `gantt_project_events`, `gantt_calendars`, `gantt_calendar_exceptions`.
- A new `sharedGanttRouter` with token-based authorization.

### 3.3 Decision to Retire Legacy Planner

The legacy planner's JSON-centric data model cannot support:

- Reliable concurrent editing.
- Fine-grained audit history.
- Unlimited WBS levels without full re-serialization.
- Resource assignments or baselines.
- A clean migration path to a multi-tenant schedule model.

Therefore, the legacy planner will be retired after the new module reaches feature parity.

---

## 4. Goals & Non-Goals

### 4.1 Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Multiple concurrent users per project | P0 |
| 2 | Shareable editor and viewer links | P0 |
| 3 | Revision control + optimistic locking | P0 |
| 4 | Append-only audit history | P0 |
| 5 | Unlimited projects | P0 |
| 6 | Unlimited WBS levels | P0 |
| 7 | Activities with metadata, constraints, calendars | P0 |
| 8 | Relationships (FS, SS, FF, SF) with lag | P0 |
| 9 | Calendars and calendar exceptions | P0 |
| 10 | Critical path and total float | P1 |
| 11 | Baselines and variance reporting | P1 |
| 12 | Progress updating (% complete, actual dates) | P1 |
| 13 | Resource assignments (hours/units) | P2 |
| 14 | Polling-based real-time collaboration (WebSockets future) | P1 |
| 15 | Import/export (XER/MPP/Excel future, CSV MVP) | P2 |

### 4.2 Non-Goals

- Full Primavera P6 Enterprise portfolio management.
- Cost loading and earned-value cost curves in Phase 1.
- WebSocket real-time collaboration in Phase 1 (polling is acceptable).
- Native mobile app in Phase 1.
- Supabase Storage for schedule master data.
- Preservation of legacy planner UI components in the new module.

---

## 5. Architectural Principles

1. **Database-first scheduling.** The normalized tables are the source of truth; the frontend computes derived values for display only.
2. **No JSON schedule blobs.** `tasksData`/`linksData` are retired; use relational WBS, activities, and dependencies.
3. **Project-scoped isolation.** Every schedule entity belongs to exactly one `gantt_projects` row.
4. **Optimistic concurrency.** Every mutating request carries an `expectedRevision`; the server bumps `revision` atomically on success.
5. **Append-only audit.** Every committed mutation writes one `gantt_project_events` row with `projectRevision`, `beforeData`, `afterData`, and `actorName`.
6. **Transaction atomicity.** Entity change + revision bump + audit event happen in one database transaction.
7. **Token-based sharing.** Editor and viewer links are opaque tokens; only SHA-256 hashes are stored.
8. **Calendar-aware scheduling.** All date math respects `gantt_calendars` working days and `gantt_calendar_exceptions`.
9. **Incremental migration.** Legacy data remains untouched until an explicit retirement PR.
10. **Small reviewable PRs.** Each PR delivers one vertical slice with tests, type checks, and documentation.

---

## 6. Frontend Architecture

### 6.1 Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React 19 + TypeScript |
| Build | Vite |
| Router | React Router v7 |
| RPC | tRPC + @tanstack/react-query |
| UI | Radix UI + Tailwind CSS |
| State | Zustand for client UI state; TanStack Query for server state |
| Drag/Drop | @dnd-kit/core + @dnd-kit/sortable |
| Date/Calendar | date-fns + custom calendar engine |
| Virtualization | @tanstack/react-virtual |
| Charts/Exports | Recharts for S-curves; SheetJS for Excel; PDF future |

### 6.2 Route Structure

| Route | Purpose | Auth |
|-------|---------|------|
| `/gantt` | Project landing / list | Authenticated |
| `/gantt/new` | Create new project | Authenticated |
| `/gantt/p/:slug` | Shared workspace via editor/viewer token | Token |
| `/gantt/project/:slug` | Owner/admin authenticated workspace | Authenticated |
| `/gantt/project/:slug/settings` | Sharing, calendars, baselines | Authenticated |
| `/gantt-planner` | Legacy planner (retired after parity) | Existing |

### 6.3 Page/Component Hierarchy

```
App
└── /gantt
    └── GanttLandingPage
        ├── GanttProjectList
        ├── NewProjectButton
        └── ImportProjectButton
└── /gantt/p/:slug
    └── SharedGanttProjectPage (existing, expanded)
        ├── GanttWorkspaceShell
        │   ├── GanttToolbar
        │   ├── GanttTimeline (virtualized)
        │   ├── WBSOutliner (virtualized)
        │   ├── ActivityDetailPanel
        │   ├── DependencyCanvas
        │   └── AuditSidebar
        ├── ShareDialog
        ├── CalendarDialog
        └── BaselineDialog
```

### 6.4 State Management

#### Server State (TanStack Query)

- Query key: `['gantt', 'project', slug, { sinceRevision }]`.
- Polling interval: 5 seconds when window is focused; 30 seconds when blurred.
- Mutations invalidate project query and append local optimistic update.

#### Client State (Zustand)

- `uiStore`: selection, expanded WBS nodes, active detail panel, zoom level, view dates.
- `scheduleStore`: local working copy of activities/dependencies for drag-drop and what-if edits; committed only after explicit save.

#### URL State

- `?view=timeline|wbs|resources`
- `?zoom=day|week|month|quarter|year`
- `?selectedActivityId=123`

---

## 7. Backend Architecture

### 7.1 Runtime & Routers

- Runtime: Node.js + Hono (existing `api/boot.ts`).
- RPC: tRPC 11 with `createRouter` + `publicQuery` (existing middleware).
- New router: `api/primavera-lite-router.ts` (or extend `api/shared-gantt-router.ts`).
- Existing `api/gantt-router.ts` and `api/gantt-projects-router.ts` remain untouched until retirement PR.

### 7.2 Router Design

```
primaveraLiteRouter
├── project
│   ├── create
│   ├── load
│   ├── updateMeta
│   ├── delete (soft-delete future, hard-delete MVP)
│   └── share
├── wbs
│   ├── createNode
│   ├── updateNode
│   ├── moveNode
│   └── deleteNode
├── activity
│   ├── createActivity
│   ├── updateActivity
│   ├── deleteActivity
│   └── batchUpdate
├── dependency
│   ├── createDependency
│   ├── updateDependency
│   └── deleteDependency
├── calendar
│   ├── createCalendar
│   ├── updateCalendar
│   └── createException
├── baseline
│   ├── captureBaseline
│   ├── listBaselines
│   └── restoreBaseline
├── resource
│   ├── createResource
│   ├── updateResource
│   └── assignResource
├── schedule
│   ├── runSchedule (CPM)
│   └── getCriticalPath
└── events
    └── pollEvents
```

### 7.3 Transaction Boundaries

Every mutation uses one Drizzle transaction:

1. Validate input + optimistic-lock predicate.
2. Acquire project-level row lock (`SELECT ... FOR UPDATE` on `gantt_projects`).
3. Apply entity change.
4. Bump `gantt_projects.revision`.
5. Insert `gantt_project_events` with the new revision.
6. Commit.

If any step fails, the transaction rolls back. No committed entity change exists without its matching revision and audit event.

### 7.4 Security Model

| Role | Access |
|------|--------|
| Owner (authenticated) | Full CRUD, sharing settings, baselines, calendars |
| Editor (token) | Create/update/delete activities/dependencies/WBS, no project settings |
| Viewer (token) | Read-only + poll events |
| Anonymous legacy | No access to new module (legacy only) |

- Token verification: hash incoming token, compare to stored hash, derive role.
- Rate limits: per-project-limited editor/viewer actions; per-client IP limits on public endpoints.
- Input guards: strict Zod schemas; request-body byte limits; maximum activities/dependencies per project.

### 7.5 Audit Pipeline

Every mutation writes:

```
gantt_project_events (
  projectId,
  entityType: 'project'|'wbs'|'activity'|'dependency'|'calendar'|'baseline'|'resource',
  entityId,
  action: 'create'|'update'|'delete',
  actorName,
  beforeData: jsonb,
  afterData: jsonb,
  projectRevision: integer, -- exact revision produced by this transaction
  createdAt
)
```

---

## 8. Database Schema

### 8.1 Schema Design Notes

- All tables use snake_case columns; Drizzle schema maps to camelCase TypeScript fields.
- All foreign keys to `gantt_projects` use `ON DELETE CASCADE`.
- All schedule tables include `project_id` for project-scoped queries and row-level security policies.
- `revision` is on `gantt_activities`, `gantt_dependencies`, and `gantt_projects` for optimistic locking.

### 8.2 Core Tables

#### gantt_projects

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | Internal numeric id |
| public_id | uuid unique | External opaque id |
| slug | varchar unique | URL slug |
| name | varchar(255) | Project name |
| project_name | varchar(255) | Optional alternate name |
| start_date | varchar(20) | Planned project start (YYYY-MM-DD) |
| finish_date | varchar(20) | Scheduled project finish |
| data_date | varchar(20) | Progress/data date |
| status | varchar(50) | Active, Completed, etc. |
| description | text | |
| default_calendar_id | integer FK | Default project calendar |
| sharing_enabled | integer | 0/1 |
| edit_token_hash | varchar(64) | SHA-256 of editor token |
| view_token_hash | varchar(64) | SHA-256 of viewer token |
| revision | integer | Project revision counter |
| last_scheduled_at | timestamp | Last CPM run |
| created_by | varchar | Owner name/id |
| owner_id | integer | Authenticated owner id |
| tenant_id | varchar | Future multi-tenant |
| created_at | timestamp | |
| updated_at | timestamp | |

Retained from PR #328 and extended; **no `tasksData`/`linksData` columns**.

#### gantt_calendars

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| project_id | integer FK → gantt_projects | |
| name | varchar(255) | |
| working_days | integer[] | ISO day numbers [1,2,3,4,5] |
| hours_per_day | numeric(4,2) | |
| timezone | varchar(100) | |
| is_default | boolean | |
| created_at | timestamp | |
| updated_at | timestamp | |

#### gantt_calendar_exceptions

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| calendar_id | integer FK → gantt_calendars | |
| exception_date | date | |
| is_working | boolean | |
| working_hours | numeric(4,2) | |
| description | varchar(500) | |

#### gantt_wbs_nodes

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| project_id | integer FK → gantt_projects | |
| parent_node_id | integer FK → gantt_wbs_nodes | NULL = root level |
| code | varchar(100) | WBS code e.g. "1.2.3" |
| name | varchar(500) | |
| description | text | |
| sort_order | integer | |
| is_leaf | boolean | FALSE for summary nodes; activities attach to leaves |
| created_at | timestamp | |
| updated_at | timestamp | |

Indexes: `(project_id, parent_node_id)`, `(project_id, code)`, `(project_id, sort_order)`.

#### gantt_activities

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| project_id | integer FK → gantt_projects | |
| wbs_node_id | integer FK → gantt_wbs_nodes | Required leaf node |
| frontend_activity_uid | varchar(64) unique | Stable client id |
| activity_id | varchar(100) | Optional user-defined ID |
| activity_name | varchar(500) | |
| activity_type | varchar(20) | task, milestone, level_of_effort |
| calendar_id | integer FK → gantt_calendars | |
| original_duration | integer | Working days |
| remaining_duration | integer | Working days |
| planned_start | varchar(20) | YYYY-MM-DD |
| planned_finish | varchar(20) | YYYY-MM-DD |
| early_start | varchar(20) | CPM output |
| early_finish | varchar(20) | CPM output |
| late_start | varchar(20) | CPM output |
| late_finish | varchar(20) | CPM output |
| total_float | integer | Working days |
| free_float | integer | Working days |
| actual_start | varchar(20) | |
| actual_finish | varchar(20) | |
| percent_complete | integer | 0–100 |
| status | varchar(50) | NotStarted, InProgress, Completed |
| constraint_type | varchar(20) | None, StartOn, FinishOn, StartNoEarlierThan, etc. |
| constraint_date | varchar(20) | |
| notes | text | |
| revision | integer | Optimistic lock |
| updated_by_name | varchar(255) | |
| created_at | timestamp | |
| updated_at | timestamp | |

Indexes: `(project_id, wbs_node_id)`, `(project_id, activity_id)`, `(frontend_activity_uid)`.

#### gantt_dependencies

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| project_id | integer FK → gantt_projects | |
| predecessor_activity_id | integer FK → gantt_activities | |
| successor_activity_id | integer FK → gantt_activities | |
| dependency_type | varchar(10) | FS, SS, FF, SF |
| lag_days | integer | |
| revision | integer | Optimistic lock |
| updated_by_name | varchar(255) | |
| created_at | timestamp | |
| updated_at | timestamp | |

Indexes: `(project_id, predecessor_activity_id)`, `(project_id, successor_activity_id)`, unique `(project_id, predecessor_activity_id, successor_activity_id, dependency_type)`.

#### gantt_activity_constraints

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| activity_id | integer FK → gantt_activities | |
| constraint_type | varchar(20) | |
| constraint_date | varchar(20) | |
| description | varchar(500) | |

#### gantt_baselines

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| project_id | integer FK → gantt_projects | |
| name | varchar(255) | e.g. "Original Baseline" |
| description | text | |
| created_at | timestamp | |

#### gantt_baseline_activities

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| baseline_id | integer FK → gantt_baselines | |
| activity_id | integer FK → gantt_activities | Original activity reference |
| activity_name | varchar(500) | Snapshot |
| planned_start | varchar(20) | |
| planned_finish | varchar(20) | |
| original_duration | integer | |
| notes | text | |

#### gantt_resources

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| project_id | integer FK → gantt_projects | |
| name | varchar(255) | |
| resource_type | varchar(50) | Labor, Material, Equipment |
| max_units | numeric(5,2) | 1.0 = 100% |
| calendar_id | integer FK → gantt_calendars | |

#### gantt_activity_resources

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| activity_id | integer FK → gantt_activities | |
| resource_id | integer FK → gantt_resources | |
| planned_units | numeric(10,2) | |
| actual_units | numeric(10,2) | |

### 8.3 Existing PR #328 Tables (retained)

- `gantt_project_events` — append-only audit log.
- `gantt_calendars` / `gantt_calendar_exceptions` — already defined; extended above.

### 8.4 Indexes Summary

- All lookup columns on `project_id`.
- Unique indexes on external ids (`public_id`, `slug`, `frontend_activity_uid`).
- Composite indexes for WBS parent lookups, activity date ranges, and dependency graph traversal.

---

## 9. API Design

### 9.1 Public/Shared Procedures (token-based)

These procedures require `slug + access token`.

| Procedure | Method | Input | Output |
|-----------|--------|-------|--------|
| `load` | query | `{ slug, access, sinceRevision? }` | `{ project, wbsNodes[], activities[], dependencies[], calendars[], events[], revision }` |
| `createActivity` | mutation | `{ slug, access, expectedRevision, wbsNodeId, activityName, ... }` | `{ activity, revision }` |
| `updateActivity` | mutation | `{ slug, access, expectedRevision, activityId, changes }` | `{ activity, revision }` |
| `deleteActivity` | mutation | `{ slug, access, expectedRevision, activityId }` | `{ deletedId, revision }` |
| `createDependency` | mutation | `{ slug, access, expectedRevision, pred, succ, type, lag }` | `{ dependency, revision }` |
| `deleteDependency` | mutation | `{ slug, access, expectedRevision, dependencyId }` | `{ deletedId, revision }` |
| `createWbsNode` | mutation | `{ slug, access, expectedRevision, parentNodeId, name, code }` | `{ node, revision }` |
| `moveWbsNode` | mutation | `{ slug, access, expectedRevision, nodeId, newParentId, newSortOrder }` | `{ node, revision }` |
| `pollEvents` | query | `{ slug, access, afterRevision }` | `{ events[], latestRevision }` |

### 9.2 Authenticated Owner Procedures

| Procedure | Purpose |
|-----------|---------|
| `createProject` | Create a new Primavera Lite project |
| `listProjects` | List projects owned by the user |
| `deleteProject` | Delete project and all dependent rows |
| `updateProjectMeta` | Name, description, data date, default calendar |
| `share` | Generate/regenerate editor and viewer tokens |
| `revokeShare` | Revoke editor or viewer role |
| `captureBaseline` | Snapshot current schedule into a baseline |
| `restoreBaseline` | Restore selected baseline (creates new revision) |

### 9.3 Error Contract

| Code | When |
|------|------|
| `CONFLICT` | Optimistic-lock failure (stale revision) |
| `NOT_FOUND` | Unknown project, activity, dependency, or WBS node |
| `FORBIDDEN` | Token lacks permission for action |
| `BAD_REQUEST` | Validation failure (cycle, invalid dates, duplicate) |
| `TOO_MANY_REQUESTS` | Rate limit exceeded |
| `PAYLOAD_TOO_LARGE` | Body exceeds limit |

### 9.4 Date Format

- All dates exchanged as `YYYY-MM-DD` or `YYYY-MM-DD HH:MM` strings.
- Server validates real calendar dates and logical ordering.

---

## 10. Component Hierarchy

### 10.1 Workspace Shell

```
GanttWorkspaceShell
├── GanttToolbar
│   ├── ZoomControl
│   ├── ViewToggle (WBS / Timeline / Resources)
│   ├── ScheduleButton
│   ├── ShareButton
│   ├── BaselineButton
│   └── Undo/Redo (future)
├── GanttSplitPane
│   ├── WBSOutliner (left)
│   │   ├── WBSNodeRow (virtualized)
│   │   ├── ActivityRow
│   │   └── NewNodeButton
│   └── TimelineCanvas (right)
│       ├── TimelineHeader
│       ├── TimelineGrid
│       ├── ActivityBar
│       ├── DependencyLine
│       ├── MilestoneMarker
│       └── TodayLine
├── ActivityDetailPanel
│   ├── ActivityForm
│   ├── RelationshipsTab
│   ├── ResourcesTab
│   └── ConstraintsTab
└── Audit/EventSidebar
```

### 10.2 Dialogs

- `NewProjectDialog`
- `ShareDialog`
- `CalendarDialog`
- `BaselineDialog`
- `ImportDialog`
- `ExportDialog`

### 10.3 Reusable Primitives

- `DatePicker` — strict calendar validation.
- `DurationInput` — working days.
- `PercentInput` — 0–100.
- `WBSCodeInput` — hierarchical code validation.
- `DependencyTypeSelect` — FS/SS/FF/SF.

---

## 11. State Management

### 11.1 Server State

- `useProject(slug, token?)` — loads full project; polls for events.
- `useSchedule(slug)` — loads CPM output (early/late dates, float).
- `useEvents(slug, afterRevision)` — polls events.
- Mutations use `expectedRevision` and roll back optimistic updates on `CONFLICT`.

### 11.2 Client State

**Zustand `uiStore`:**

- `selectedActivityIds: number[]`
- `expandedWbsNodeIds: Set<number>`
- `activeDetailPanel: 'general'|'relationships'|'resources'|'constraints'`
- `zoom: ZoomLevel`
- `viewStartDate: Date`
- `viewEndDate: Date`
- `dragState: DragState | null`

**Zustand `scheduleStore`:**

- Holds the working copy of activities and dependencies while editing.
- Synchronizes with server state on load and after successful mutations.
- Supports undo/redo via immutable patches (immer).

### 11.3 Optimistic Updates

- On mutation success: apply server result and bump local revision.
- On `CONFLICT`: show conflict toast; offer refresh or retry.
- On network error: keep local working copy; retry queue.

---

## 12. Scheduling Engine Architecture

### 12.1 Responsibilities

- Calendar-aware date math.
- Forward pass (early start/finish).
- Backward pass (late start/finish).
- Total float and free float calculation.
- Critical path extraction.
- Constraint enforcement.
- Progress updating (actual dates drive remaining duration).

### 12.2 Engine Layers

```
SchedulingEngine
├── CalendarService
│   ├── workingDaysBetween(start, finish, calendar)
│   ├── addWorkingDays(date, days, calendar)
│   └── isWorkingDay(date, calendar)
├── GraphService
│   ├── buildDependencyGraph(activities, dependencies)
│   ├── topologicalSort(graph)
│   └── detectCycle(graph)
├── ForwardPassService
│   └── computeEarlyDates(graph, calendars)
├── BackwardPassService
│   └── computeLateDates(graph, projectFinish, calendars)
├── FloatService
│   └── computeTotalFloatAndFreeFloat(graph)
├── CriticalPathService
│   └── extractZeroFloatPath(graph)
└── ConstraintService
    └── applyDateConstraints(graph)
```

### 12.3 CPM Algorithm

1. Build adjacency list from `gantt_dependencies`.
2. Topologically sort activities; detect cycles before scheduling.
3. Forward pass:
   - Early Start = max(Early Finish of predecessors + lag, constraint date).
   - Early Finish = Early Start + Original Duration − 1 working day.
4. Backward pass:
   - Late Finish = min(Late Start of successors − lag, project finish).
   - Late Start = Late Finish − Original Duration + 1 working day.
5. Float:
   - Total Float = Late Start − Early Start (or Late Finish − Early Finish).
   - Free Float = min(Early Start of successors − lag) − Early Finish − 1.
6. Critical path = activities with Total Float ≤ 0.

### 12.4 Server vs Client Scheduling

- **Server:** Runs CPM on `runSchedule` mutation and stores results in `gantt_activities.early_start`, `late_start`, `total_float`, etc.
- **Client:** Receives computed dates from server; renders timeline bars and critical path. Client can run a lightweight preview for drag-drop what-if scenarios without saving.

### 12.5 Baselines

- `captureBaseline` copies current activity rows into `gantt_baseline_activities`.
- Variance reports compare current `planned_start/finish/duration` to baseline snapshot.

---

## 13. Drag & Drop Architecture

### 13.1 Libraries

- `@dnd-kit/core` for sensors and context.
- `@dnd-kit/sortable` for WBS reordering.
- Custom canvas hit-detection for timeline bar dragging and dependency drawing.

### 13.2 DnD Scenarios

| Scenario | Action | Backend Procedure |
|----------|--------|-------------------|
| Reorder WBS node | Drag row up/down | `moveWbsNode` |
| Indent/outdent WBS node | Drag right/left or keyboard shortcut | `moveWbsNode` with parent change |
| Move activity to another WBS node | Drag activity onto WBS node | `updateActivity` with new `wbsNodeId` |
| Drag timeline bar to new date | Drag horizontally | `updateActivity` with new `planned_start/finish` |
| Draw dependency | Drag from successor finish to predecessor start | `createDependency` |

### 13.3 Conflict Prevention

- DnD mutations include `expectedRevision`.
- If dropped while server state is stale, show conflict and abort the local move.
- No optimistic reorder until server confirms.

---

## 14. Collaboration Architecture

### 14.1 Revision Model

- `gantt_projects.revision` is a monotonic integer.
- Every mutation increments it inside the transaction.
- `gantt_project_events.projectRevision` records the exact revision at which the event occurred.

### 14.2 Polling Strategy

- Client polls `pollEvents` with `afterRevision`.
- Interval: 5 seconds focused, 30 seconds blurred.
- On receiving events, client merges them into local state and updates revision.

### 14.3 Conflict Resolution UI

- Toast: "Project was updated by another user. Refresh or retry?"
- Refresh discards local working copy and reloads from server.
- Retry rebases local changes onto the new server revision (for single-activity edits).

### 14.4 Roles & Permissions

| Action | Owner | Editor | Viewer |
|--------|-------|--------|--------|
| View project | ✓ | ✓ | ✓ |
| Edit activities | ✓ | ✓ | ✗ |
| Edit dependencies | ✓ | ✓ | ✗ |
| Edit WBS | ✓ | ✓ | ✗ |
| Run schedule | ✓ | ✓ | ✗ |
| Manage calendars | ✓ | ✗ | ✗ |
| Capture baseline | ✓ | ✗ | ✗ |
| Share / revoke tokens | ✓ | ✗ | ✗ |
| Delete project | ✓ | ✗ | ✗ |

---

## 15. Performance Strategy

### 15.1 Database

- Project-scoped indexes on all foreign keys.
- Cursor-based pagination for activity lists when projects exceed 1,000 activities.
- Avoid N+1 by joining activities + WBS + dependencies in load queries.

### 15.2 Server

- CPM runs asynchronously for large projects (future); MVP runs synchronously with a 30-second timeout.
- Caching of calendar working-day maps in memory per request.

### 15.3 Frontend

- Virtualized WBS outliner and timeline canvas.
- Debounced timeline drag updates.
- Incremental CPM preview on client for small local edits.

---

## 16. Virtual Scrolling Strategy

### 16.1 WBS Outliner

- Use `@tanstack/react-virtual` with variable row heights.
- Expand/collapse updates virtual row count.
- Keep selected rows visible via scroll-to-index.

### 16.2 Timeline Canvas

- Horizontal virtualization by date range (render visible time window + 1 buffer day on each side).
- Vertical virtualization synced with WBS outliner.
- Dependency lines render only for visible rows; use SVG overlay.

### 16.3 Rendering Modes

- **DOM mode:** MVP, simpler, acceptable up to ~2,000 rows.
- **Canvas mode:** Future optimization for 10,000+ rows; custom drawing of bars, text, and lines.

---

## 17. Migration Strategy from Old Module

### 17.1 Data Retirement Plan

1. **Phase 1:** Leave legacy tables untouched. New module uses new tables/columns.
2. **Phase 2:** Provide a one-way import from legacy `gantt_projects.tasks_data`/`links_data` into normalized schema (PR 12).
3. **Phase 3:** After user acceptance, retire `/gantt-planner` route and delete legacy code files (not data).
4. **Phase 4:** Optionally drop `tasks_data`/`links_data` columns after a confirmed backup window.

### 17.2 Legacy-to-New Mapping

| Legacy | New |
|--------|-----|
| `gantt_projects.tasks_data` JSON | `gantt_wbs_nodes` + `gantt_activities` |
| `gantt_projects.links_data` JSON | `gantt_dependencies` |
| `gantt_tasks` (denormalized) | `gantt_activities` + `gantt_wbs_nodes` |
| `gantt_tasks.parent_task_id` | `gantt_wbs_nodes.parent_node_id` |
| `gantt_tasks.predecessor_task_id` | `gantt_dependencies` |
| Anonymous session ownership | `owner_id` + token-based sharing |

### 17.3 Rollback / Recovery

- Each migration PR includes:
  - Preflight SQL.
  - Forward migration SQL.
  - Verification SQL.
  - Rollback SQL.
- Full database backup taken before any schema change.
- Legacy data is never modified or deleted by migration scripts.

---

## 18. Production Rollout Plan

### 18.1 Phase 1 — New Module Behind `/gantt` (PRs 1–6)

- Deploy project shell, WBS, activities, dependencies, calendars, scheduling engine.
- `/gantt-planner` remains available.
- No data migration; new projects created only in new schema.

### 18.2 Phase 2 — Feature Parity (PRs 7–11)

- Baselines, resources, progress updating, critical path, reporting.
- Import legacy JSON into new schema on user request.

### 18.3 Phase 3 — Retire Legacy (PR 12)

- Redirect `/gantt-planner` → `/gantt`.
- Remove legacy React pages and tRPC routers.
- Keep legacy database rows until a separate cleanup decision.

### 18.4 Monitoring

- Track CPM run duration and memory.
- Track conflict rate and polling load.
- Track project/event growth.

### 18.5 Rollback Triggers

- CPM produces incorrect dates for known test cases.
- Conflict rate > 5% of mutations.
- Polling causes measurable database load.

---

## 19. Folder Structure

```
odm-dashboard
├── src
│   ├── modules
│   │   └── gantt
│   │       ├── app
│   │       │   ├── pages
│   │       │   │   ├── GanttLandingPage.tsx
│   │       │   │   ├── GanttProjectPage.tsx
│   │       │   │   └── SharedGanttProjectPage.tsx
│   │       │   ├── components
│   │       │   │   ├── GanttWorkspaceShell.tsx
│   │       │   │   ├── GanttToolbar.tsx
│   │       │   │   ├── WBSOutliner.tsx
│   │       │   │   ├── TimelineCanvas.tsx
│   │       │   │   ├── ActivityDetailPanel.tsx
│   │       │   │   ├── DependencyCanvas.tsx
│   │       │   │   └── dialogs/
│   │       │   ├── hooks
│   │       │   │   ├── useProject.ts
│   │       │   │   ├── useActivityMutations.ts
│   │       │   │   ├── useSchedule.ts
│   │       │   │   └── useEvents.ts
│   │       │   └── stores
│   │       │       ├── uiStore.ts
│   │       │       └── scheduleStore.ts
│   │       ├── engine
│   │       │   ├── calendarEngine.ts
│   │       │   ├── dependencyGraph.ts
│   │       │   ├── forwardPass.ts
│   │       │   ├── backwardPass.ts
│   │       │   ├── floatCalculator.ts
│   │       │   ├── criticalPath.ts
│   │       │   ├── constraintEngine.ts
│   │       │   └── schedulingEngine.ts
│   │       ├── shared
│   │       │   ├── types.ts
│   │       │   ├── constants.ts
│   │       │   └── schemas.ts
│   │       └── tests
│   │           ├── engine.test.ts
│   │           └── integration.test.ts
├── api
│   ├── primavera-lite-router.ts
│   ├── primavera-lite-router.test.ts
│   ├── shared-gantt-router.ts     # retained from PR #328; extended
│   └── shared-gantt-router.test.ts
├── db
│   ├── schema.ts                  # extended with new tables
│   ├── migrations/
│   │   ├── 0020_primavera_lite_wbs_activities.sql
│   │   ├── 0021_primavera_lite_dependencies.sql
│   │   ├── 0022_primavera_lite_baselines_resources.sql
│   │   └── helpers/
│   └── relations.ts
└── docs
    └── architecture
        └── ODM-Primavera-Lite-Online-Architecture.md
```

---

## 20. PR Breakdown

### PR 1 — Project Shell + Database + CRUD

**Scope:**
- Create `gantt_wbs_nodes` and `gantt_activities` tables.
- Extend `api/primavera-lite-router.ts` with:
  - `createProject`
  - `load`
  - `updateProjectMeta`
  - `deleteProject`
  - `createActivity`
  - `updateActivity`
  - `deleteActivity`
- Create `GanttLandingPage` and `GanttProjectPage` shells.
- Add authentication guards.

**Acceptance:**
- Type check passes.
- Router integration tests pass.
- Can create a project and add/remove activities via API.

### PR 2 — WBS Tree

**Scope:**
- Add `gantt_wbs_nodes` CRUD and move operations.
- Add WBS outliner UI with expand/collapse.
- Add indent/outdent and drag-drop reordering.
- Prevent WBS cycles.

**Acceptance:**
- Unlimited nesting levels.
- Concurrent move tests pass.
- Activities can attach only to leaf WBS nodes.

### PR 3 — Timeline

**Scope:**
- Build `TimelineCanvas` component.
- Render activity bars, milestones, dependencies.
- Zoom levels: day, week, month, quarter, year.
- Virtual scrolling for rows and dates.

**Acceptance:**
- Renders 1,000 activities smoothly.
- Zoom transitions are smooth.

### PR 4 — Drag & Drop

**Scope:**
- WBS row reordering and indent/outdent via drag.
- Timeline bar dragging to change dates.
- Dependency drawing between bars.
- Optimistic-lock conflict handling on drop.

**Acceptance:**
- All drag operations issue correct mutations.
- Stale drops show conflict toast.

### PR 5 — Scheduling Engine

**Scope:**
- Calendar-aware date math.
- Forward/backward pass.
- Total float, free float, critical path.
- `runSchedule` mutation.
- Server-side CPM with tests.

**Acceptance:**
- Known CPM test cases pass.
- Cycle detection rejects invalid dependencies.

### PR 6 — Calendars

**Scope:**
- Extend `gantt_calendars` and `gantt_calendar_exceptions`.
- Calendar UI for working days and exceptions.
- Activities reference calendars.
- CPM respects calendars.

**Acceptance:**
- Non-working days excluded from duration.
- Exceptions override default working days.

### PR 7 — Constraints

**Scope:**
- Add `gantt_activity_constraints`.
- Support Start On, Finish On, Start No Earlier Than, etc.
- Constraint enforcement in CPM.

**Acceptance:**
- Constraints drive early/late dates correctly.
- Conflicting constraints reported.

### PR 8 — Baselines

**Scope:**
- Add `gantt_baselines` and `gantt_baseline_activities`.
- Capture and restore baselines.
- Variance display in UI.

**Acceptance:**
- Baseline snapshot preserves current plan.
- Restore creates a new revision and audit event.

### PR 9 — Resources

**Scope:**
- Add `gantt_resources` and `gantt_activity_resources`.
- Resource dictionary UI.
- Resource assignment on activities.
- Planned units roll up to WBS summary nodes.

**Acceptance:**
- Resource assignments persisted and loaded.
- Summary rollups computed.

### PR 10 — Progress Updates

**Scope:**
- Percent complete input.
- Actual start / actual finish.
- Remaining duration calculation.
- Progress line overlay in timeline.

**Acceptance:**
- Progress updates trigger CPM recalculation.
- Actual dates validated against logical ordering.

### PR 11 — Reporting & Import/Export

**Scope:**
- S-curve chart (planned vs actual progress).
- Excel export of activities and dependencies.
- CSV import (legacy JSON import future).

**Acceptance:**
- Export produces valid Excel.
- Import creates normalized rows.

### PR 12 — Retire Legacy Module

**Scope:**
- Redirect `/gantt-planner` → `/gantt`.
- Remove `src/pages/GanttPlanner.tsx`, `src/pages/GanttProjectsDebug.tsx`.
- Remove `api/gantt-router.ts`, `api/gantt-projects-router.ts`, `api/gantt-projects-diagnostics.ts`.
- Remove legacy engine files if unused.
- Update `src/pages/Home.tsx` and `src/pages/Home.tsx` to point to `/gantt`.

**Acceptance:**
- Legacy routes redirect.
- No references to `tasksData`/`linksData` in active code.
- Type check and full test suite pass (except known unrelated failures).

---

## 21. Risks & Open Questions

### 21.1 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| CPM performance degrades with >5,000 activities | Medium | High | Virtualization + async scheduling + future Web Worker |
| Legacy data migration is lossy | Medium | High | Strict mapping tests; one-way import only after review |
| Concurrent WBS moves cause hierarchy corruption | Medium | High | Project-level `FOR UPDATE` lock + cycle detection |
| Resource leveling complexity exceeds MVP scope | High | Medium | Defer leveling to post-Phase-1 |
| Users expect instant real-time collaboration | Medium | Medium | Polling acceptable for Phase 1; document WebSocket roadmap |

### 21.2 Open Questions

1. Should projects support multiple calendars per project in Phase 1 or a single default calendar?
2. Do we need activity codes separate from WBS codes?
3. Should resource assignments include cost rates in Phase 1?
4. What is the target maximum project size (activity count) for Phase 1?
5. Which export formats are mandatory for Phase 1 (Excel, CSV, XER, MPP)?

---

## 22. Appendices

### 22.1 Glossary

| Term | Definition |
|------|------------|
| WBS | Work Breakdown Structure — hierarchical decomposition of project deliverables |
| Activity | A unit of work with duration, dates, and relationships |
| Dependency | A logical relationship between activities (FS, SS, FF, SF) |
| CPM | Critical Path Method — schedule network analysis algorithm |
| Float | Slack time an activity has without delaying the project |
| Baseline | Approved snapshot of the schedule used for variance comparison |
| Data Date | Date up to which progress has been reported |
| Constraint | Forced date boundary on an activity |

### 22.2 References

- PR #328 — Link sharing, revision control, audit events, calendars.
- [Technology Standards](./Technology-Standards.md)
- [Enterprise Architecture v1.0](./Enterprise-Architecture-v1.0.md)
- [System Context](./System-Context.md)
- [Domain Model](./Domain-Model.md)

---

## 23. Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Author | Codex | 2026-08-04 | — |
| Reviewer | | | |
| Approver | | | |
