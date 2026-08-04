# ODM Primavera Lite Online

## Software Architecture Document

**Version:** 1.2  
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
| Version | 1.2 |
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
- Provide multi-user collaboration, configurable WBS depth, critical path, baselines, resources, and progress updating.

### 1.3 Constraints

- Database: Supabase PostgreSQL only.
- Supabase Storage: used only for attachments, drawings, exports, imports, PDFs, and supporting documents.
- Initial release uses token-based access only; no mandatory authenticated owner.
- Day-level temporal precision in MVP: `date` fields and working-day durations/lags.
- No production data deletion during architecture phase.
- No deployment or PR creation during architecture phase.
- Must align with [Lihok Technology Standards](./Technology-Standards.md) and [Enterprise-Architecture-v1.0](./Enterprise-Architecture-v1.0.md).

### 1.4 Key Corrections in v1.1

- Replaced mandatory authenticated-owner model with token-based admin/creator, editor, and viewer tokens.
- Replaced hard-delete MVP with archive/soft-delete and dry-run impact preview.
- Changed schedule date fields from varchar to PostgreSQL `date` and audit timestamps to `timestamptz`.
- Resolved constraint model: MVP supports a single primary constraint per activity, stored inline on the activity row.
- Rewrote CPM specification with explicit FS/SS/FF/SF rules, positive/negative lag, milestones, open ends, multiple calendars, constraints, and negative float.
- Added Data Date and progress scheduling rules including out-of-sequence progress.
- Made baselines immutable snapshots independent of live activity deletion.
- Reconciled audit schema with PR #328: `before_data`/`after_data` remain `jsonb` as already deployed.
- Replaced "unlimited" claims with measurable capacity targets and configurable limits.
- Reconciled full-project loading with pagination, virtualization, and incremental events.
- Strengthened WBS invariants and dependency drag semantics.
- Defined login-free project discovery via browser-local remembered admin links (no multi-project list in MVP).
- Selected day-level temporal precision MVP: PostgreSQL `date` fields and working-day durations/lags.
- Added explicit backward-pass relationship rules for FS/SS/FF/SF with positive/negative lag, milestones, multiple successors, and multiple calendars.
- Added production-schema reconciliation matrix against PR #328 / migration 0019.

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
- Deep WBS hierarchies without full re-serialization.
- Resource assignments or baselines.
- A clean migration path to a multi-tenant schedule model.

Therefore, the legacy planner will be retired after the new module reaches feature parity.

---

## 4. Goals & Non-Goals

### 4.1 Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Token-based access for admin/creator, editor, and viewer | P0 |
| 2 | Multiple concurrent users per project | P0 |
| 3 | Revision control + optimistic locking | P0 |
| 4 | Append-only audit history | P0 |
| 5 | Configurable number of projects (initial target 1,000 active) | P0 |
| 6 | Configurable WBS depth (initial target 20 levels, 10,000 nodes) | P0 |
| 7 | Activities with metadata, constraints, calendars | P0 |
| 8 | Relationships (FS, SS, FF, SF) with lag | P0 |
| 9 | Calendars and calendar exceptions | P0 |
| 10 | Critical path and total float | P1 |
| 11 | Baselines and variance reporting | P1 |
| 12 | Progress updating (% complete, actual dates) | P1 |
| 13 | Resource assignments (hours/units) | P2 |
| 14 | Polling-based real-time collaboration (WebSockets future) | P1 |
| 15 | Import/export (CSV/Excel MVP; XER/MPP future) | P2 |

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
7. **Token-based access.** Admin/creator, editor, and viewer tokens are opaque; only SHA-256 hashes are stored.
8. **Calendar-aware scheduling.** All date math respects `gantt_calendars` working days and `gantt_calendar_exceptions`.
9. **Soft-delete MVP.** Projects and activities are archived via `deleted_at`/`archived_at`; explicit purge is a later PR.
10. **Incremental migration.** Legacy data remains untouched until an explicit retirement PR.
11. **Small reviewable PRs.** Each PR delivers one vertical slice with tests, type checks, and documentation.

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
| `/gantt` | Project landing / list | admin/creator token |
| `/gantt/new` | Create new project | admin/creator token |
| `/gantt/p/:slug` | Shared workspace via token | editor or viewer token |
| `/gantt/project/:slug` | Creator/admin workspace | admin/creator token |
| `/gantt/project/:slug/settings` | Sharing, calendars, baselines | admin/creator token |
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

### 6.5 Login-Free Project Discovery

#### MVP Approach

The initial release has **no multi-project list API**. Each project is an independent security boundary. Instead, the creator stores the project's admin link locally in the browser.

#### How `/gantt` Works

- `/gantt` is a landing page that:
  1. Checks `localStorage` for remembered admin links.
  2. Renders a "My Projects" list built only from those stored links.
  3. Provides a "Create New Project" button.
  4. Shows a prominent warning: "Keep your admin link safe. If browser storage is cleared, you may lose access unless you saved the link elsewhere."

#### How Projects Are Created

- `createProject` generates:
  - `slug` — public project identifier in URLs.
  - `admin_token` — full-control creator token.
  - `editor_token` — shareable editor token.
  - `viewer_token` — shareable viewer token.
- The response returns the raw tokens exactly once.
- The browser stores the full admin URL in `localStorage`:
  - `https://odm-dashboard.onrender.com/gantt/p/{slug}?access={admin_token}`
- Editor and viewer links are shown in a share dialog and copied to the clipboard.

#### How an Administrator Returns to Projects

- The admin opens `/gantt` and clicks a remembered project card.
- Alternatively, the admin pastes the admin URL directly into the address bar.
- The client extracts `slug` and `access` from the URL and calls `load`.

#### When Browser Storage Is Cleared

- Remembered projects disappear from `/gantt`.
- Access is not lost if the admin saved the admin URL elsewhere (bookmark, password manager, document).
- There is no server-side recovery of raw tokens because only hashes are stored.
- A future authenticated-owner migration will allow account-bound recovery.

#### How Admin Links Are Copied and Recovered

- On project creation, the UI shows:
  - Admin link with a "Copy" button.
  - Editor link.
  - Viewer link.
- The admin is prompted to copy the admin link to a safe location before dismissing the dialog.
- A "Recovery" section in the share dialog re-displays the admin link if the current session knows it (i.e., it is in the address bar or localStorage).

#### Why a Project Admin Token Cannot Enumerate Unrelated Projects

- The admin token is hashed and stored only on its own `gantt_projects` row.
- There is no global index of token hashes or project-to-token mapping.
- A token only authorizes actions within its own project; the server verifies the token against the row identified by `slug`.
- Enumerating all projects would require scanning every row and hashing guesses, which is rate-limited and computationally infeasible.

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
│   ├── archive (dry-run + confirmed)
│   ├── restore
│   └── purge (future)
├── token
│   ├── rotateAdminToken
│   ├── rotateEditorToken
│   ├── rotateViewerToken
│   └── revoke (per role)
├── wbs
│   ├── createNode
│   ├── updateNode
│   ├── moveNode
│   └── archiveNode (dry-run + confirmed)
├── activity
│   ├── createActivity
│   ├── updateActivity
│   ├── archiveActivity (dry-run + confirmed)
│   └── batchUpdate
├── dependency
│   ├── createDependency
│   ├── updateDependency
│   └── archiveDependency
├── calendar
│   ├── createCalendar
│   ├── updateCalendar
│   └── createException
├── baseline
│   ├── captureBaseline
│   ├── listBaselines
│   └── compareBaseline
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

| Role | Token | Access |
|------|-------|--------|
| Admin/Creator | `admin` | Full CRUD, archive/restore, sharing settings, baselines, calendars, token rotation |
| Editor | `editor` | Create/update/archive activities/dependencies/WBS, run schedule, no settings |
| Viewer | `viewer` | Read-only + poll events |
| Anonymous legacy | none | No access to new module (legacy only) |

- Token verification: hash incoming token, compare to stored hash, derive role.
- Raw tokens are generated once and shown to the user; only hashes are persisted.
- Rate limits: per-project-limited editor/viewer actions; per-client IP limits on public endpoints.
- Input guards: strict Zod schemas; request-body byte limits; maximum activities/dependencies per project.

### 7.5 Audit Pipeline

Every mutation writes:

```
gantt_project_events (
  project_id,
  entity_type: 'project'|'wbs'|'activity'|'dependency'|'calendar'|'baseline'|'resource',
  entity_id,
  action: 'create'|'update'|'archive'|'restore'|'delete'|'schedule',
  actor_name,
  before_data: jsonb,
  after_data: jsonb,
  project_revision: integer, -- exact revision produced by this transaction
  created_at timestamptz
)
```

PR #328 already deploys `before_data` and `after_data` as `jsonb`. No migration is required for the audit schema.

---

## 8. Database Schema

### 8.1 Schema Design Notes

- All tables use snake_case columns; Drizzle schema maps to camelCase TypeScript fields.
- Schedule dates use PostgreSQL `date`.
- Timestamps use `timestamptz`.
- Durations and lags are stored in working days. Hours per day is metadata only; the day-level MVP does not schedule partial days or shifts.
- All foreign keys to `gantt_projects` use `ON DELETE RESTRICT` so project deletion is never cascaded.
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
| start_date | date | Planned project start |
| finish_date | date | Scheduled project finish |
| data_date | date | Progress/data date |
| status | varchar(50) | Active, Archived, Completed |
| description | text | |
| default_calendar_id | integer FK | Default project calendar |
| sharing_enabled | integer | 0/1 |
| admin_token_hash | varchar(64) | SHA-256 of creator/admin token |
| edit_token_hash | varchar(64) | SHA-256 of editor token |
| view_token_hash | varchar(64) | SHA-256 of viewer token |
| revision | integer | Project revision counter |
| last_scheduled_at | timestamptz | Last CPM run |
| archived_at | timestamptz | Soft-delete timestamp |
| created_by | varchar | Creator name |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Retained from PR #328 and extended; **no `tasks_data`/`links_data` columns**.

#### gantt_calendars

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| project_id | integer FK → gantt_projects | ON DELETE RESTRICT |
| name | varchar(255) | |
| working_days | integer[] | ISO day numbers [1,2,3,4,5] |
| hours_per_day | numeric(4,2) | |
| minutes_per_day | integer | Derived from hours_per_day; not authoritative in day-level MVP |
| timezone | varchar(100) | |
| is_default | boolean | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### gantt_calendar_exceptions

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| calendar_id | integer FK → gantt_calendars | |
| exception_date | date | |
| is_working | boolean | |
| working_hours | integer | |
| description | varchar(500) | |

#### gantt_wbs_nodes

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| project_id | integer FK → gantt_projects | ON DELETE RESTRICT |
| parent_node_id | integer FK → gantt_wbs_nodes | NULL = root level |
| code | varchar(100) | Unique within project |
| name | varchar(500) | |
| description | text | |
| sort_order | integer | Stable ordering within parent |
| is_leaf | boolean | Transactionally maintained |
| archived_at | timestamptz | Soft-delete |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Indexes: `(project_id, parent_node_id)`, unique `(project_id, code)`, `(project_id, sort_order)`, partial `(project_id, code) WHERE archived_at IS NULL`.

#### gantt_activities

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| project_id | integer FK → gantt_projects | ON DELETE RESTRICT |
| wbs_node_id | integer FK → gantt_wbs_nodes | Required leaf node |
| frontend_activity_uid | varchar(64) unique | Stable client id |
| activity_id | varchar(100) | Optional user-defined ID |
| activity_name | varchar(500) | |
| activity_type | varchar(20) | task, milestone, level_of_effort |
| calendar_id | integer FK → gantt_calendars | |
| original_duration_days | integer | Working minutes |
| remaining_duration_days | integer | Working minutes |
| planned_start | date | |
| planned_finish | date | |
| early_start | date | CPM output |
| early_finish | date | CPM output |
| late_start | date | CPM output |
| late_finish | date | CPM output |
| total_float_days | integer | Working minutes |
| free_float_days | integer | Working minutes |
| actual_start | date | |
| actual_finish | date | |
| percent_complete | integer | 0–100 |
| status | varchar(50) | NotStarted, InProgress, Completed |
| constraint_type | varchar(20) | None, StartOn, FinishOn, StartNoEarlierThan, FinishNoLaterThan, AsLateAsPossible |
| constraint_date | date | |
| notes | text | |
| revision | integer | Optimistic lock |
| updated_by_name | varchar(255) | |
| archived_at | timestamptz | Soft-delete |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Indexes: `(project_id, wbs_node_id)`, `(project_id, activity_id)`, `(frontend_activity_uid)`, partial `(project_id, wbs_node_id) WHERE archived_at IS NULL`.

**Constraint model:** MVP supports exactly one primary constraint per activity, stored inline. Future PRs may add `gantt_activity_constraints` for multiple constraints. The inline `constraint_type`/`constraint_date` are authoritative in Phase 1.

#### gantt_dependencies

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| project_id | integer FK → gantt_projects | ON DELETE RESTRICT |
| predecessor_activity_id | integer FK → gantt_activities | |
| successor_activity_id | integer FK → gantt_activities | |
| dependency_type | varchar(10) | FS, SS, FF, SF |
| lag_days | integer | Positive = lag, negative = lead |
| revision | integer | Optimistic lock |
| updated_by_name | varchar(255) | |
| archived_at | timestamptz | Soft-delete |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Indexes: `(project_id, predecessor_activity_id)`, `(project_id, successor_activity_id)`, unique `(project_id, predecessor_activity_id, successor_activity_id, dependency_type, lag_days) WHERE archived_at IS NULL`.

#### gantt_baselines

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| project_id | integer FK → gantt_projects | ON DELETE RESTRICT |
| name | varchar(255) | e.g. "Original Baseline" |
| description | text | |
| created_at | timestamptz | Immutable after creation |

#### gantt_baseline_activities

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| baseline_id | integer FK → gantt_baselines | |
| original_activity_id | integer | Reference only; no FK constraint to live row |
| wbs_code | varchar(100) | Snapshot at capture time |
| activity_id | varchar(100) | Snapshot |
| activity_name | varchar(500) | Snapshot |
| planned_start | date | |
| planned_finish | date | |
| original_duration_days | integer | |
| calendar_id | integer | Snapshot reference |

Baseline rows are immutable snapshots. They are not linked with foreign keys to live activities, so deleting or archiving a live activity does not affect baselines.

#### gantt_resources

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| project_id | integer FK → gantt_projects | ON DELETE RESTRICT |
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

- `gantt_project_events` — append-only audit log. `before_data`/`after_data` are already `jsonb` as deployed by PR #328; no schema change needed.
- `gantt_calendars` / `gantt_calendar_exceptions` — already exist; extended above.

### 8.4 Indexes Summary

- All lookup columns on `project_id`.
- Unique indexes on external ids (`public_id`, `slug`, `frontend_activity_uid`).
- Unique project-scoped WBS code index.
- Composite indexes for WBS parent lookups, activity date ranges, and dependency graph traversal.
- Partial indexes excluding archived rows.

---

## 9. API Design

### 9.1 Public/Shared Procedures (token-based)

These procedures require `slug + access token`.

| Procedure | Required Token | Input | Output |
|-----------|----------------|-------|--------|
| `load` | admin/editor/viewer | `{ slug, access, sinceRevision? }` | `{ project, wbsNodes[], activities[], dependencies[], calendars[], events[], revision }` |
| `createActivity` | admin/editor | `{ slug, access, expectedRevision, wbsNodeId, activityName, ... }` | `{ activity, revision }` |
| `updateActivity` | admin/editor | `{ slug, access, expectedRevision, activityId, changes }` | `{ activity, revision }` |
| `archiveActivity` | admin/editor | `{ slug, access, expectedRevision, activityId, dryRun? }` | `{ impact, archivedId, revision }` |
| `createDependency` | admin/editor | `{ slug, access, expectedRevision, pred, succ, type, lagMinutes }` | `{ dependency, revision }` |
| `archiveDependency` | admin/editor | `{ slug, access, expectedRevision, dependencyId }` | `{ archivedId, revision }` |
| `createWbsNode` | admin/editor | `{ slug, access, expectedRevision, parentNodeId, name, code }` | `{ node, revision }` |
| `moveWbsNode` | admin/editor | `{ slug, access, expectedRevision, nodeId, newParentId, newSortOrder }` | `{ node, revision }` |
| `archiveWbsNode` | admin/editor | `{ slug, access, expectedRevision, nodeId, dryRun? }` | `{ impact, archivedId, revision }` |
| `runSchedule` | admin/editor | `{ slug, access, expectedRevision }` | `{ scheduledAt, revision }` |
| `pollEvents` | admin/editor/viewer | `{ slug, access, afterRevision }` | `{ events[], latestRevision }` |

### 9.2 Admin/Creator Procedures

| Procedure | Purpose |
|-----------|---------|
| `createProject` | Create a new Primavera Lite project; returns admin, editor, and viewer tokens |
| `listProjects` | List projects accessible with the supplied admin token |
| `archiveProject` | Soft-delete project with dry-run impact preview and confirmation |
| `restoreProject` | Restore archived project |
| `updateProjectMeta` | Name, description, data date, default calendar |
| `rotateAdminToken` | Regenerate admin token (invalidates old) |
| `rotateEditorToken` | Regenerate editor token |
| `rotateViewerToken` | Regenerate viewer token |
| `revokeEditorToken` | Disable editor access without regenerating |
| `revokeViewerToken` | Disable viewer access without regenerating |
| `captureBaseline` | Snapshot current schedule into an immutable baseline |
| `compareBaseline` | Return variance between baseline and current schedule |

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

- All dates exchanged as `YYYY-MM-DD` strings.
- Server validates real calendar dates and logical ordering.
- Durations exchanged in working minutes; UI may display days based on the relevant calendar.

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
- `ShareDialog` (shows admin/editor/viewer tokens)
- `CalendarDialog`
- `BaselineDialog`
- `ImportDialog`
- `ExportDialog`
- `ArchiveConfirmDialog` (impact preview)

### 10.3 Reusable Primitives

- `DatePicker` — strict calendar validation.
- `DurationInput` — working minutes with calendar-aware day display.
- `PercentInput` — 0–100.
- `WBSCodeInput` — hierarchical code validation.
- `DependencyTypeSelect` — FS/SS/FF/SF.

---

## 11. State Management

### 11.1 Server State

- `useProject(slug, token?)` — loads full project snapshot; polls for events.
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

- Calendar-aware date math using working minutes.
- Forward pass (early start/finish).
- Backward pass (late start/finish).
- Total float and free float calculation.
- Critical path extraction.
- Constraint enforcement.
- Progress updating (Data Date drives remaining work placement).

### 12.2 Engine Layers

```
SchedulingEngine
├── CalendarService
│   ├── workingDaysBetween(start, finish, calendar)
│   ├── addWorkingDays(date, minutes, calendar)
│   ├── isWorkingDay(date, calendar)
│   └── workingHoursForDay(date, calendar)
├── GraphService
│   ├── buildDependencyGraph(activities, dependencies)
│   ├── topologicalSort(graph)
│   └── detectCycle(graph)
├── ForwardPassService
│   └── computeEarlyDates(graph, calendars, dataDate)
├── BackwardPassService
│   └── computeLateDates(graph, projectFinish, calendars)
├── FloatService
│   └── computeTotalFloatAndFreeFloat(graph)
├── CriticalPathService
│   └── extractZeroFloatPath(graph)
└── ConstraintService
    └── applyDateConstraints(graph)
```

### 12.3 Dependency Relationship Rules

All relationships are computed in working minutes using the successor's calendar unless otherwise noted. Positive lag adds working days; negative lag (lead) subtracts working days.

#### Finish-to-Start (FS)

- Successor Early Start = Predecessor Early Finish + lag minutes.
- Predecessor Early Finish and Successor Early Start may be on different calendars; the lag is added as whole working days in the successor's calendar.
- If lag is negative (lead), Successor Early Start = Predecessor Early Finish shifted backward by |lag_days| whole working days, never earlier than the project start.

#### Start-to-Start (SS)

- Successor Early Start = Predecessor Early Start shifted forward by lag_days whole working days.
- If positive lag, successor starts lag_days working days after predecessor starts.
- If negative lag (lead), successor starts |lag_days| working days before predecessor starts, bounded by project start.

#### Finish-to-Finish (FF)

- Successor Early Finish = Predecessor Early Finish shifted forward by lag_days whole working days.
- If positive lag, successor finishes lag_days working days after predecessor finishes.
- If negative lag, successor finishes |lag_days| working days before predecessor finishes, bounded so that finish does not precede start.

#### Start-to-Finish (SF)

- Successor Early Finish = Predecessor Early Start shifted forward by lag_days whole working days.
- Rare but supported for completeness.
- Negative lag is bounded by project start and activity duration.

### 12.4 Milestones

- Milestones have `original_duration_days = 0`.
- Start milestones: `early_start = early_finish`.
- Finish milestones: `early_start = early_finish`.
- Milestones participate in relationships exactly like activities, using the same FS/SS/FF/SF rules with zero duration.

### 12.5 Open Ends

- Activities with no predecessors start at the project start date, unless constrained otherwise.
- Activities with no successors drive the project finish date.
- If multiple open-end activities exist, the latest early finish becomes the project finish.

### 12.6 Multiple Calendars

- Each activity references a `calendar_id`.
- All date math for an activity uses that activity's calendar.
- Lags between two activities are applied in the successor's calendar.
- If an activity has no calendar, the project's default calendar is used.

### 12.7 Constraints

MVP supports one inline constraint per activity:

| Constraint | Behavior |
|------------|----------|
| None | No constraint applied |
| StartOn | Early Start forced to constraint date |
| FinishOn | Early Finish forced to constraint date |
| StartNoEarlierThan | Early Start ≥ constraint date |
| FinishNoLaterThan | Early Finish ≤ constraint date |
| AsLateAsPossible | Activity scheduled as late as possible without delaying project |

During forward pass, `Early Start`/`Early Finish` are forced to satisfy the constraint. If the constraint conflicts with predecessor logic, the constraint wins and negative float may result. The conflict is reported in the schedule output but does not block the run.

### 12.8 Negative Float

- Negative float occurs when a constraint or actual date forces an activity to occur later than its late dates allow.
- `total_float_days` may be negative.
- Negative float is displayed in the UI and exported; it signals a schedule conflict.

### 12.9 Data Date and Progress Scheduling

- The `data_date` on the project is the cutoff for progress.
- **Not started:** planned dates are computed normally.
- **In progress:** actual start is recorded. Remaining duration is scheduled from the Data Date (or later whole working day). `Early Start` = max(calculated early start, next working day on or after Data Date) if actual start exists.
- **Completed:** actual start and actual finish are recorded; early/late dates equal actual dates; total float = 0.
- **Out-of-sequence progress:** if actual dates violate dependency logic, the schedule still honors actual dates and computes negative float or a warning for successor logic.
- Remaining work cannot be scheduled before the Data Date unless a global override is enabled and recorded in the audit log.

### 12.10 Server vs Client Scheduling

- **Server:** Runs CPM on `runSchedule` mutation and stores results in `gantt_activities.early_start`, `late_start`, `total_float_days`, etc.
- **Client:** Receives computed dates from server; renders timeline bars and critical path. Client can run a lightweight preview for drag-drop what-if scenarios without saving.

### 12.11 Baselines

- `captureBaseline` copies current activity rows into `gantt_baseline_activities`.
- Variance reports compare current `planned_start/finish/duration` to baseline snapshot.
- Baselines are immutable and detached from live rows.

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
| Drag timeline bar to new date | Drag horizontally | `updateActivity` with new `planned_start/finish` and recalculated duration |
| Draw dependency | Drag from anchor on one bar to anchor on another | `createDependency` |

### 13.3 Dependency Connector Anchors

| Relationship | Predecessor Anchor | Successor Anchor |
|--------------|-------------------|------------------|
| FS | Right edge (finish) | Left edge (start) |
| SS | Left edge (start) | Left edge (start) |
| FF | Right edge (finish) | Right edge (finish) |
| SF | Left edge (start) | Right edge (finish) |

Drawing a connector creates the dependency with the implied type based on the chosen anchors. The user may override the type in the relationship dialog.

### 13.4 Conflict Prevention

- DnD mutations include `expectedRevision`.
- If dropped while server state is stale, show conflict and abort the local move.
- No optimistic reorder until server confirms.

---

## 14. Collaboration Architecture

### 14.1 Revision Model

- `gantt_projects.revision` is a monotonic integer.
- Every mutation increments it inside the transaction.
- `gantt_project_events.project_revision` records the exact revision at which the event occurred.

### 14.2 Polling Strategy

- Client polls `pollEvents` with `afterRevision`.
- Interval: 5 seconds focused, 30 seconds blurred.
- On receiving events, client merges them into local state and updates revision.

### 14.3 Conflict Resolution UI

- Toast: "Project was updated by another user. Refresh or retry?"
- Refresh discards local working copy and reloads from server.
- Retry rebases local changes onto the new server revision (for single-activity edits).

### 14.4 Roles & Permissions

| Action | Admin/Creator | Editor | Viewer |
|--------|---------------|--------|--------|
| View project | ✓ | ✓ | ✓ |
| Edit activities | ✓ | ✓ | ✗ |
| Edit dependencies | ✓ | ✓ | ✗ |
| Edit WBS | ✓ | ✓ | ✗ |
| Run schedule | ✓ | ✓ | ✗ |
| Manage calendars | ✓ | ✗ | ✗ |
| Capture baseline | ✓ | ✗ | ✗ |
| Share / revoke / rotate tokens | ✓ | ✗ | ✗ |
| Archive/restore project | ✓ | ✗ | ✗ |

---

## 15. Performance Strategy

### 15.1 Configurable Capacity Targets

| Resource | MVP Target | Configurable Limit |
|----------|------------|-------------------|
| Active projects | 1,000 | `MAX_ACTIVE_PROJECTS` |
| Activities per project | 2,000 | `MAX_ACTIVITIES_PER_PROJECT` |
| Dependencies per project | 5,000 | `MAX_DEPENDENCIES_PER_PROJECT` |
| WBS nodes per project | 5,000 | `MAX_WBS_NODES_PER_PROJECT` |
| WBS depth | 20 levels | `MAX_WBS_DEPTH` |
| Concurrent editors per project | 20 | `MAX_CONCURRENT_EDITORS_PER_PROJECT` |
| Poll interval | 5 sec focused / 30 sec blurred | `POLL_INTERVAL_*` |
| Request body | 1 MB | `MAX_REQUEST_BODY_BYTES` |

These targets are verified by load tests on representative data sets before each PR merges.

### 15.2 Database

- Project-scoped indexes on all foreign keys.
- Cursor-based pagination for activity lists when projects exceed the configured visible-window size.
- Avoid N+1 by joining activities + WBS + dependencies in load queries.

### 15.3 Server

- CPM runs asynchronously for large projects (future); MVP runs synchronously with a 30-second timeout.
- Caching of calendar working-day maps in memory per request.

### 15.4 Frontend

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

- **DOM mode:** MVP, simpler, acceptable up to the configured activity target.
- **Canvas mode:** Future optimization for larger projects; custom drawing of bars, text, and lines.

---

## 17. Loading, Pagination, and Event Handling

### 17.1 Initial Snapshot

`load` returns a full project snapshot including:

- Project metadata.
- All calendars and exceptions.
- All WBS nodes.
- All activities (up to the configured per-project limit).
- All dependencies.
- All baseline headers (not baseline row snapshots by default).
- Audit events since `sinceRevision`.

### 17.2 Pagination for Large Projects

When an activity count exceeds the visible-window size (default 200):

- Server still returns the full list for projects under the MVP target.
- Future PRs introduce cursor pagination keyed by `sort_order` or `id`.
- Visible-window loading: the client requests only the date range and row range currently in view.

### 17.3 Incremental Events

- `pollEvents` returns events with `project_revision > afterRevision`.
- Client applies events to local state without a full reload.
- If the client detects a gap in revisions (e.g., offline), it performs a full `load` with `sinceRevision`.

### 17.4 Event Handling for Unloaded Entities

- If an event references an activity not currently loaded, the client may:
  1. Ignore the event and schedule a full reload, or
  2. Fetch the missing entity by id if the visible window requires it.
- The default strategy is to reload the project snapshot when more than 50 unseen events accumulate.

---

## 18. Soft-Delete / Archive Policy

### 18.1 Archive Operation

All delete-like operations are implemented as archive/soft-delete:

- Set `archived_at = now()` on the target row.
- Include `archived_at IS NULL` in all operational queries.
- Archived rows are excluded from scheduling, timeline rendering, and sharing links.

### 18.2 Dry-Run Impact Preview

Before archiving a project, WBS node, or activity, the API returns:

```
{
  dryRun: true,
  wouldArchive: { activities: number, dependencies: number, wbsNodes: number, baselines: number },
  impactedDependencies: number,
  orphanedChildren: number,
  message: string
}
```

### 18.3 Confirmation

The client must pass `confirmed: true` to perform the archive. The server verifies `confirmed` inside the atomic transaction.

### 18.4 Project Archival

Archiving a project:

- Sets `gantt_projects.archived_at`.
- Does NOT cascade to child tables.
- All operational queries exclude archived projects.
- Sharing tokens for an archived project remain stored but the `load` endpoint returns `FORBIDDEN`/`NOT_FOUND`.

### 18.5 Restore

- Set `archived_at = null`.
- Bump project revision and audit the action.
- Validate that restored WBS/activity/dependency references still point to non-archived parents (or restore those too).

### 18.6 Retention and Purge (Future PR)

- Archived projects are retained indefinitely by default.
- A future PR introduces `purgeProject`, which physically deletes archived rows older than a retention period.
- Purge requires admin token and explicit confirmation.

---

## 19. WBS Invariants

### 19.1 Project-Scoped Parent Validation

- `parent_node_id` must reference a `gantt_wbs_nodes` row in the same `project_id`.
- Cross-project parenting is rejected.

### 19.2 Cycle Prevention

- Before updating `parent_node_id`, verify that the new parent is not a descendant of the node being moved.
- Direct self-parenting and indirect cycles (A → B → C → A) are rejected.

### 19.3 Stable Ordering

- Each WBS node has `sort_order` unique within its parent.
- Moving a node updates `sort_order` of affected siblings in a transaction.

### 19.4 Unique Project-Scoped Codes

- WBS `code` is unique within a project among non-archived rows.
- Code format is validated (e.g., "1.2.3" or custom prefix).

### 19.5 Leaf Status

- `is_leaf` is derived: a node with no children is a leaf.
- Activities may only attach to leaf WBS nodes.
- If a leaf node gets a child, existing activities must be moved or archived.

### 19.6 Deletion/Move Impact Rules

| Action | Impact |
|--------|--------|
| Archive WBS node | Must archive all descendant WBS nodes, activities, and dependent dependencies in the same transaction |
| Move WBS node | Must validate no cycle; may change parent and sort order |
| Archive activity | Must archive all outgoing and incoming dependencies |
| Restore WBS node | Must restore parent chain if archived |

---

## 20. Migration Strategy from Old Module

### 20.1 Data Retirement Plan

1. **Phase 1:** Leave legacy tables untouched. New module uses new tables/columns.
2. **Phase 2:** Provide a one-way import from legacy `gantt_projects.tasks_data`/`links_data` into normalized schema (PR 12).
3. **Phase 3:** After user acceptance, retire `/gantt-planner` route and delete legacy code files (not data).
4. **Phase 4:** Optionally drop `tasks_data`/`links_data` columns after a confirmed backup window.

### 20.2 Legacy-to-New Mapping

| Legacy | New |
|--------|-----|
| `gantt_projects.tasks_data` JSON | `gantt_wbs_nodes` + `gantt_activities` |
| `gantt_projects.links_data` JSON | `gantt_dependencies` |
| `gantt_tasks` (denormalized) | `gantt_activities` + `gantt_wbs_nodes` |
| `gantt_tasks.parent_task_id` | `gantt_wbs_nodes.parent_node_id` |
| `gantt_tasks.predecessor_task_id` | `gantt_dependencies` |
| Anonymous session ownership | admin/creator token |

### 20.3 Rollback / Recovery

- Each migration PR includes:
  - Preflight SQL.
  - Forward migration SQL.
  - Verification SQL.
  - Rollback SQL.
- Full database backup taken before any schema change.
- Legacy data is never modified or deleted by migration scripts.

---

## 21. Production Rollout Plan

### 21.1 Phase 1 — New Module Behind `/gantt` (PRs 1–6)

- Deploy project shell, WBS, activities, dependencies, calendars, scheduling engine.
- `/gantt-planner` remains available.
- No data migration; new projects created only in new schema.

### 21.2 Phase 2 — Feature Parity (PRs 7–11)

- Baselines, resources, progress updating, critical path, reporting.
- Import legacy JSON into new schema on user request.

### 21.3 Phase 3 — Retire Legacy (PR 12)

- Redirect `/gantt-planner` → `/gantt`.
- Remove legacy React pages and tRPC routers.
- Keep legacy database rows until a separate cleanup decision.

### 21.4 Monitoring

- Track CPM run duration and memory.
- Track conflict rate and polling load.
- Track project/event growth.

### 21.5 Rollback Triggers

- CPM produces incorrect dates for known test cases.
- Conflict rate > 5% of mutations.
- Polling causes measurable database load.

---

## 22. Folder Structure

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
│   │   ├── 0020_primavera_lite_shell.sql
│   │   ├── 0020a_primavera_lite_date_type_alter.sql
│   │   ├── 0021_primavera_lite_wbs_activities.sql
│   │   ├── 0022_primavera_lite_dependencies.sql
│   │   ├── 0023_primavera_lite_scheduling.sql
│   │   ├── 0024_primavera_lite_calendars.sql
│   │   ├── 0025_primavera_lite_baselines.sql
│   │   ├── 0026_primavera_lite_resources.sql
│   │   ├── 0027_primavera_lite_progress.sql
│   │   ├── 0028_primavera_lite_import_export.sql
│   │   └── 0029_primavera_lite_retire_legacy.sql
│   │   └── helpers/
│   └── relations.ts
└── docs
    └── architecture
        └── ODM-Primavera-Lite-Online-Architecture.md
```

---

## 23. PR Breakdown

### PR 1 — Minimal Project Shell + Normalized Schema

**Scope (only these):**
- Create `gantt_wbs_nodes` and `gantt_activities` tables.
- Create `primavera-lite-router.ts` with token-based access only:
  - `createProject` (returns admin/editor/viewer tokens)
  - `load`
  - `updateProjectMeta`
  - `archiveProject` (dry-run + confirmed soft-delete)
  - `restoreProject`
  - `createActivity`
  - `updateActivity`
  - `archiveActivity` (dry-run + confirmed)
- Create `GanttLandingPage` and minimal `GanttProjectPage` shells.
- No scheduling engine, no baselines, no resources, no drag-drop timeline, no legacy retirement.

**Acceptance:**
- Type check passes.
- Router integration tests pass.
- Can create a project with tokens and add/remove activities via API.
- Archive returns impact preview and requires confirmation.

### PR 2 — WBS Tree

**Scope:**
- Add `gantt_wbs_nodes` CRUD and move operations.
- Add WBS outliner UI with expand/collapse.
- Add indent/outdent and drag-drop reordering.
- Prevent WBS cycles and enforce unique project-scoped codes.

**Acceptance:**
- Up to 20 nesting levels.
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
- Dependency drawing between bars with correct anchors.
- Optimistic-lock conflict handling on drop.

**Acceptance:**
- All drag operations issue correct mutations.
- Stale drops show conflict toast.

### PR 5 — Scheduling Engine

**Scope:**
- Calendar-aware date math using working minutes.
- Forward/backward pass with explicit FS/SS/FF/SF rules.
- Total float, free float, critical path.
- Milestones, open ends, multiple calendars, constraints, negative float.
- Data Date and progress scheduling behavior.
- `runSchedule` mutation.
- Server-side CPM with tests.

**Acceptance:**
- Known CPM test cases pass.
- Cycle detection rejects invalid dependencies.
- Negative float and progress scenarios produce correct dates.

### PR 6 — Calendars & Exceptions

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
- Enforce the inline single-constraint model.
- Support Start On, Finish On, Start No Earlier Than, Finish No Later Than, As Late As Possible.
- Constraint enforcement in CPM and conflict reporting.

**Acceptance:**
- Constraints drive early/late dates correctly.
- Conflicting constraints reported without crashing the schedule.

### PR 8 — Baselines

**Scope:**
- Add `gantt_baselines` and `gantt_baseline_activities`.
- Capture immutable baseline snapshots.
- Compare baseline vs current schedule.
- Baselines survive live activity archival/deletion.

**Acceptance:**
- Baseline snapshot preserves current plan.
- Archiving a live activity does not delete baseline rows.

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
- Data Date behavior and out-of-sequence progress warnings.
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
- Update `src/pages/Home.tsx` and `src/pages/Help.tsx` to point to `/gantt`.

**Acceptance:**
- Legacy routes redirect.
- No references to `tasksData`/`linksData` in active code.
- Type check and full test suite pass (except known unrelated failures).

---

## 24. Authentication Migration Path (Future)

### 24.1 Current Release (Phase 1)

- Access is controlled entirely by tokens.
- No login requirement.
- Admin/creator token is generated at project creation and must be stored securely by the creator.

### 24.2 Future Migration to Authenticated Owners

1. Add optional `owner_user_id` to `gantt_projects`.
2. Allow token holders to bind a project to an authenticated account.
3. Authenticated owners gain the same powers as admin/creator tokens.
4. Admin tokens remain valid until explicitly revoked.
5. Documented migration script links existing projects to user accounts.

---

## 25. Risks & Open Questions

### 25.1 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| CPM performance degrades near 5,000 activities | Medium | High | Virtualization + async scheduling + future Web Worker |
| Legacy data migration is lossy | Medium | High | Strict mapping tests; one-way import only after review |
| Concurrent WBS moves cause hierarchy corruption | Medium | High | Project-level `FOR UPDATE` lock + cycle detection |
| Resource leveling complexity exceeds MVP scope | High | Medium | Defer leveling to post-Phase-1 |
| Users expect instant real-time collaboration | Medium | Medium | Polling acceptable for Phase 1; document WebSocket roadmap |
| Admin token loss locks project | Medium | High | Encourage token copy at creation; future account binding |

### 25.2 Open Questions

1. Should projects support multiple calendars per project in Phase 1 or a single default calendar?
2. Do we need activity codes separate from WBS codes?
3. Should resource assignments include cost rates in Phase 1?
4. What is the target maximum project size (activity count) for Phase 1?
5. Which export formats are mandatory for Phase 1 (Excel, CSV, XER, MPP)?
6. Should archived rows be included in baseline capture if captured after archival?
7. What is the retention period before purging archived projects?

---

## 26. Appendices

### 26.1 Glossary

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
| Lag | Delay between two activities in a relationship |
| Lead | Negative lag — acceleration between two activities |

### 26.2 References

- PR #328 — Link sharing, revision control, audit events, calendars.
- [Technology Standards](./Technology-Standards.md)
- [Enterprise Architecture v1.0](./Enterprise-Architecture-v1.0.md)
- [System Context](./System-Context.md)
- [Domain Model](./Domain-Model.md)

---

## 27. Production Schema Reconciliation Matrix

This matrix compares the target ODM Primavera Lite Online schema against the deployed PR #328 / migration 0019 schema. No conversion is performed by the architecture PR.

### 27.1 gantt_projects

| Object | PR #328 State | Target State | Classification | Migration Action |
|--------|---------------|--------------|----------------|------------------|
| `id` serial PK | Existing | Unchanged | Existing unchanged | None |
| `public_id` uuid unique | Existing | Unchanged | Existing unchanged | None |
| `slug` varchar unique | Existing | Unchanged | Existing unchanged | None |
| `name` varchar(255) | Existing | Unchanged | Existing unchanged | None |
| `project_name` varchar(255) | Existing | Unchanged | Existing unchanged | None |
| `start_date` varchar(20) | Existing | `date` | Existing requiring safe ALTER | PR 1 migration: `ALTER TABLE gantt_projects ALTER COLUMN start_date TYPE date USING start_date::date;` with validation |
| `finish_date` varchar(20) | Existing | `date` | Existing requiring safe ALTER | Same as start_date |
| `data_date` varchar(20) | Existing | `date` | Existing requiring safe ALTER | Same as start_date |
| `status` varchar(50) | Existing | Unchanged | Existing unchanged | None |
| `description` text | Existing | Unchanged | Existing unchanged | None |
| `tasks_data` text | Existing | Removed | Future removal | Drop column in PR 12 after legacy retirement |
| `links_data` text | Existing | Removed | Future removal | Drop column in PR 12 |
| `created_by` varchar | Existing | Unchanged | Existing unchanged | None |
| `updated_by` varchar | Existing | Unchanged | Existing unchanged | None |
| `user_id` integer | Existing | Unused | Legacy retained temporarily | Left in place; not used by new module |
| `owner_id` integer | Existing | Unused | Legacy retained temporarily | Left in place; not used by new module |
| `tenant_id` varchar | Existing | Unchanged | Existing unchanged | None |
| `org_id` varchar | Existing | Unchanged | Existing unchanged | None |
| `session_id` varchar | Existing | Unused | Legacy retained temporarily | Left in place; not used by new module |
| `public_id` index | Existing | Unchanged | Existing unchanged | None |
| `slug` index | Existing | Unchanged | Existing unchanged | None |
| `edit_token_hash` varchar(64) | Existing | Rename to `editor_token_hash` or keep alias | Existing requiring safe ALTER | PR 1 migration renames or documents alias; new code uses `editor_token_hash` |
| `view_token_hash` varchar(64) | Existing | Rename to `viewer_token_hash` or keep alias | Existing requiring safe ALTER | Same as editor token |
| `admin_token_hash` | Missing | `varchar(64)` | New object | Add column in PR 1 |
| `revision` integer | Existing | Unchanged | Existing unchanged | None |
| `default_calendar_id` integer | Existing | Unchanged | Existing unchanged | None |
| `sharing_enabled` integer | Existing | Unchanged | Existing unchanged | None |
| `last_scheduled_at` timestamp | Existing | `timestamptz` | Existing requiring safe ALTER | PR 1 migration: `ALTER TABLE gantt_projects ALTER COLUMN last_scheduled_at TYPE timestamptz;` |
| `created_at` timestamp | Existing | `timestamptz` | Existing requiring safe ALTER | PR 1 migration |
| `updated_at` timestamp | Existing | `timestamptz` | Existing requiring safe ALTER | PR 1 migration |
| `archived_at` | Missing | `timestamptz` | New object | Add column in PR 1 |

### 27.2 gantt_project_events

| Object | PR #328 State | Target State | Classification | Migration Action |
|--------|---------------|--------------|----------------|------------------|
| `id` serial PK | Existing | Unchanged | Existing unchanged | None |
| `project_id` integer FK | Existing | Unchanged | Existing unchanged | None |
| `entity_type` varchar(50) | Existing | Unchanged | Existing unchanged | None |
| `entity_id` integer | Existing | Unchanged | Existing unchanged | None |
| `action` varchar(50) | Existing | Unchanged | Existing unchanged | None |
| `actor_name` varchar(255) | Existing | Unchanged | Existing unchanged | None |
| `before_data` jsonb | Existing | Unchanged | Existing unchanged | None (already jsonb) |
| `after_data` jsonb | Existing | Unchanged | Existing unchanged | None (already jsonb) |
| `project_revision` integer | Existing | Unchanged | Existing unchanged | None |
| `created_at` timestamp | Existing | `timestamptz` | Existing requiring safe ALTER | PR 1 migration |

### 27.3 gantt_calendars

| Object | PR #328 State | Target State | Classification | Migration Action |
|--------|---------------|--------------|----------------|------------------|
| `id` serial PK | Existing | Unchanged | Existing unchanged | None |
| `project_id` integer FK | Existing | Unchanged | Existing unchanged | None |
| `name` varchar(255) | Existing | Unchanged | Existing unchanged | None |
| `working_days` integer[] | Existing | Unchanged | Existing unchanged | None |
| `hours_per_day` numeric(4,2) | Existing | Unchanged | Existing unchanged | None |
| `minutes_per_day` | Missing | integer derived | New object | Add computed column or application derivation in PR 6; day-level MVP does not use it for scheduling |
| `timezone` varchar(100) | Existing | Unchanged | Existing unchanged | None |
| `is_default` | Missing | boolean | New object | Add column in PR 6 |
| `created_at` timestamp | Existing | `timestamptz` | Existing requiring safe ALTER | PR 6 migration |
| `updated_at` timestamp | Existing | `timestamptz` | Existing requiring safe ALTER | PR 6 migration |

### 27.4 gantt_calendar_exceptions

| Object | PR #328 State | Target State | Classification | Migration Action |
|--------|---------------|--------------|----------------|------------------|
| `id` serial PK | Existing | Unchanged | Existing unchanged | None |
| `calendar_id` integer FK | Existing | Unchanged | Existing unchanged | None |
| `exception_date` date | Existing | Unchanged | Existing unchanged | None |
| `is_working` boolean | Existing | Unchanged | Existing unchanged | None |
| `working_hours` numeric(4,2) | Existing | Unchanged | Existing unchanged | None |
| `description` varchar(500) | Existing | Unchanged | Existing unchanged | None |
| `created_at` timestamp | Existing | `timestamptz` | Existing requiring safe ALTER | PR 6 migration |
| `updated_at` timestamp | Existing | `timestamptz` | Existing requiring safe ALTER | PR 6 migration |

### 27.5 Existing gantt_tasks / gantt_dependencies

| Object | PR #328 State | Target State | Classification | Migration Action |
|--------|---------------|--------------|----------------|------------------|
| `gantt_tasks` table | Existing | Legacy retained | Legacy retained temporarily | Left untouched by new module; eventually retired in PR 12 or migrated |
| `gantt_dependencies` table | Existing | Legacy retained | Legacy retained temporarily | Left untouched by new module |
| `revision` on `gantt_tasks` | Existing | Legacy | Legacy retained temporarily | Not used by new normalized schema |
| `updated_by_name` on `gantt_tasks` | Existing | Legacy | Legacy retained temporarily | Not used by new normalized schema |

### 27.6 New Normalized Tables

| Object | PR #328 State | Target State | Classification | Migration Action |
|--------|---------------|--------------|----------------|------------------|
| `gantt_wbs_nodes` | Missing | New table | New object | Create in PR 2 |
| `gantt_activities` | Missing | New table | New object | Create in PR 1 |
| `gantt_dependencies` normalized | Existing legacy table reused? | New table or rename legacy | New object / legacy renamed | Decision required: create `gantt_activity_dependencies` or reuse `gantt_dependencies` after legacy retirement. This document recommends creating `gantt_activity_dependencies` in PR 3 to avoid collision with legacy rows. |
| `gantt_baselines` | Missing | New table | New object | Create in PR 8 |
| `gantt_baseline_activities` | Missing | New table | New object | Create in PR 8 |
| `gantt_resources` | Missing | New table | New object | Create in PR 9 |
| `gantt_activity_resources` | Missing | New table | New object | Create in PR 9 |

### 27.7 Foreign Key Behavior

| Current | Target | Migration Action |
|---------|--------|------------------|
| `ON DELETE CASCADE` on PR #328 child tables | `ON DELETE RESTRICT` for all new normalized tables | Apply in each migration that creates a new table |
| Project deletion cascades to events/calendars | Project archival does not cascade; purge is explicit | Document in archive policy; purge migration future PR |

### 27.8 Migration Safety Rules

Every future migration PR that modifies the production schema must include:

1. **Preflight SQL** — verify preconditions (e.g., no invalid date strings, no duplicate slugs).
2. **Database backup** — full Supabase backup or confirmed recovery point before applying.
3. **Forward migration SQL** — additive and reversible where possible.
4. **Verification SQL** — confirm new columns/types/tables exist and counts are unchanged.
5. **Rollback SQL** — restore previous types or drop added columns if needed.
6. **No destructive conversion in PR 1** — PR 1 creates only new tables and additive columns; no legacy data is converted or deleted.

---

## 28. Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Author | Codex | 2026-08-04 | — |
| Reviewer | | | |
| Approver | | | |
