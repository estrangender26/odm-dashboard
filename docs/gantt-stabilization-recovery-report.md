# Gantt Charts Stabilization and Legacy Project Recovery Report

Date: 2026-06-09

## 1. Root cause summary

Production diagnostics showed that `public.gantt_projects` contains saved projects, but every row is anonymous-session-owned rather than user-owned:

- Total rows: 13.
- `rowsWithUserId`: 0.
- `rowsWithSessionId`: 13.
- `rowsWithNeitherUserNorSession`: 0.
- Projects are split across 5 anonymous `session_id` values.

The normal Gantt project list intentionally filters anonymous projects to the current browser's `gantt_anon_session` cookie. That keeps unrelated anonymous sessions isolated, but it also means projects saved from older anonymous browser sessions are hidden from the current Open Saved Project modal. The historical projects are therefore not lost; they are present in `public.gantt_projects` and need safe, explicit adoption to the current anonymous session.

## 2. Files inspected

- `api/gantt-projects-router.ts` — project list/load/save/rename/delete/debug router and anonymous session cookie handling.
- `api/gantt-projects-diagnostics.ts` — production diagnostics query and safe task-count parsing.
- `api/gantt-projects-diagnostics.test.ts` — diagnostics regression coverage.
- `api/gantt-planner-audit-stabilization.test.ts` — hierarchy, dependency, reorder, and save-refresh-reopen regression coverage.
- `api/gantt-router.ts` — task/dependency API surface used by the planner.
- `db/schema.ts` — `gantt_projects`, `gantt_tasks`, and `gantt_dependencies` table mappings.
- `src/pages/GanttPlanner.tsx` — Gantt UI, modals, toolbar, task editing, reorder, hierarchy, import/export, save/open project flows.
- `src/pages/GanttProjectsDebug.tsx` — admin/debug production diagnostics page.
- `src/modules/gantt/engine/dependencyEngine.ts` — dependency scheduling behavior.
- `src/modules/gantt/engine/hierarchyEngine.ts` — indent/outdent hierarchy payload helpers.
- `src/modules/gantt/engine/taskReorderEngine.ts` — move up/down ordering helpers.
- `src/modules/gantt/engine/persistenceEngine.ts` — import/export helpers.

## 3. Workflows tested / reviewed

Testing scope was source-level inspection plus targeted automated regression tests. No production data was modified during this implementation pass.

| Workflow                      | Status                         | File/component involved                            | API/mutation involved                                                                                   | Issue found                                                                                 | Recommended fix                                                                           |
| ----------------------------- | ------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Open Saved Project            | Works after adoption           | `GanttPlanner`, Open Saved Project modal           | `ganttProjects.list`, `ganttProjects.get`, `gantt.resetGantt`, `gantt.saveTask`, `gantt.saveLinksBatch` | Legacy anonymous projects from old sessions are hidden before adoption.                     | Use the new debug-only adoption tool to move selected legacy rows to the current session. |
| Save Project                  | Works                          | `GanttPlanner` save modal                          | `ganttProjects.save`                                                                                    | No new issue found.                                                                         | Keep current create/update behavior; continue avoiding schema migration.                  |
| Add task                      | Works                          | `GanttPlanner`, `TaskListTab`, add/edit form       | `gantt.saveTask`                                                                                        | No new issue found.                                                                         | Keep existing validation that task name is required.                                      |
| Delete task                   | Works with existing UI path    | `GanttPlanner`, `TaskListTab`                      | `gantt.deleteTask`                                                                                      | Destructive task deletion depends on current UI confirmation path.                          | Keep confirmation behavior; do not add bulk-destructive actions without confirmation.     |
| Edit task name                | Works                          | `GanttPlanner` edit form                           | `gantt.saveTask`                                                                                        | No new issue found.                                                                         | No change.                                                                                |
| Edit date                     | Works                          | `GanttPlanner` edit form, scheduling helpers       | `gantt.saveTask`, dependency auto-schedule paths                                                        | No new issue found in targeted regression coverage.                                         | No change.                                                                                |
| Edit duration                 | Works                          | `GanttPlanner` edit form                           | `gantt.saveTask`                                                                                        | No new issue found.                                                                         | No change.                                                                                |
| Edit progress                 | Works                          | `GanttPlanner` edit form                           | `gantt.saveTask`                                                                                        | No new issue found.                                                                         | No change.                                                                                |
| Move task above               | Works                          | `GanttPlanner`, `taskReorderEngine`                | `gantt.reorderTasks`                                                                                    | No new issue found in targeted regression coverage.                                         | Keep sibling-only parent guard.                                                           |
| Move task below               | Works                          | `GanttPlanner`, `taskReorderEngine`                | `gantt.reorderTasks`                                                                                    | No new issue found in targeted regression coverage.                                         | Keep sibling-only parent guard.                                                           |
| Add child task                | Works                          | `GanttPlanner` insert-child handler                | `gantt.saveTask`, `gantt.reorderTasks` normalization                                                    | No new issue found.                                                                         | No change.                                                                                |
| Indent                        | Works                          | `GanttPlanner`, `hierarchyEngine`                  | `gantt.saveTask`                                                                                        | No new issue found in targeted regression coverage.                                         | Keep hierarchy-only update behavior.                                                      |
| Outdent                       | Works                          | `GanttPlanner`, `hierarchyEngine`                  | `gantt.saveTask`                                                                                        | No new issue found.                                                                         | Keep hierarchy-only update behavior.                                                      |
| Expand/collapse WBS           | Works                          | `GanttPlanner` expanded row state/native chart     | Client state only                                                                                       | No new issue found.                                                                         | No change.                                                                                |
| Expand all / collapse all     | Works where available          | `GanttPlanner` toolbar/task tree state             | Client state only                                                                                       | No new issue found.                                                                         | No change.                                                                                |
| Add dependency                | Works                          | `GanttPlanner`, dependency engine                  | `gantt.saveLink`, `gantt.saveLinkByUid`, `gantt.saveLinksBatch`                                         | No new issue found in targeted dependency regression coverage.                              | No change.                                                                                |
| Delete dependency             | Works                          | `GanttPlanner` dependency controls                 | `gantt.deleteLink`                                                                                      | No new issue found.                                                                         | No change.                                                                                |
| Import                        | Works where available          | `GanttPlanner`, `persistenceEngine` import helpers | `gantt.saveTask`                                                                                        | No new issue found.                                                                         | No change.                                                                                |
| Export                        | Works where available          | `GanttPlanner`, `persistenceEngine` export helpers | Client-side export                                                                                      | No new issue found.                                                                         | No change.                                                                                |
| Multi-select                  | Works with guarded limitations | `GanttPlanner` selection state                     | Mixed; move is intentionally disabled for multi-select                                                  | Move up/down is intentionally blocked for multi-select to avoid hierarchy/order corruption. | Keep guard and user message.                                                              |
| Mobile buttons                | Works                          | `GanttToolbar` mobile menu                         | Same handlers as desktop toolbar                                                                        | No new issue found.                                                                         | No change.                                                                                |
| Modal cancel/confirm behavior | Works                          | Save/Open modals, debug adoption confirmation      | `ganttProjects.save`, `ganttProjects.get`, `ganttProjects.adoptToCurrentSession`                        | Adoption needed an explicit confirmation showing count, names, and session id.              | Implemented confirmation before adoption.                                                 |

## 4. Bugs found

1. The admin diagnostics page was read-only and could prove the legacy projects existed, but it had no safe recovery action for adopting selected legacy anonymous projects into the current browser session.
2. The diagnostics query label and UI implied a latest-50 sample. For the confirmed production size of 13 rows this was not losing rows, but the recovery tool requirement is to show all projects. The diagnostic SQL now returns all rows ordered newest first.
3. `npm run check` still fails due to pre-existing TypeScript issues across unrelated modules. The targeted Gantt regression tests and frontend Vite build passed.

## 5. Fixes implemented

- Added `ganttProjects.adoptToCurrentSession`, guarded by `ENABLE_GANTT_DEBUG=true`.
- The adoption mutation updates only selected `gantt_projects` rows with:
  - `session_id = current anonymous session_id`.
  - `updated_at = now`.
- The adoption mutation intentionally leaves these untouched:
  - `user_id`.
  - `tasks_data`.
  - `links_data`.
  - project name.
  - all schema definitions.
- Updated `/admin/gantt-projects-debug` to:
  - show the current session id;
  - show all project rows;
  - render a checkbox beside each project;
  - provide an “Adopt selected projects to current session” action;
  - confirm selected count, project names, and current session id before mutation;
  - refresh diagnostics and invalidate the normal Open Saved Project list after adoption.
- Extended diagnostics regression coverage so the safe diagnostics query does not reintroduce a latest-50 cap.

## 6. Files modified

- `api/gantt-projects-router.ts`
- `api/gantt-projects-diagnostics.ts`
- `api/gantt-projects-diagnostics.test.ts`
- `src/pages/GanttProjectsDebug.tsx`
- `docs/gantt-stabilization-recovery-report.md`

## 7. Diff summary

- Backend: added debug-only selected-project adoption mutation and included current session id in diagnostics response.
- Diagnostics: changed project diagnostics from latest-50 sample to all rows while keeping safe JSON parsing outside SQL casts.
- Frontend: replaced read-only debug project table with selectable recovery table and guarded confirmation flow.
- Tests/docs: added regression assertion and documented Gantt workflow QA findings.

## 8. Verification steps

1. Set `ENABLE_GANTT_DEBUG=true` in the target environment.
2. Open `/admin/gantt-projects-debug`.
3. Confirm the summary shows 13 total rows and the current `session_id`.
4. Select only the legacy anonymous projects to recover.
5. Click “Adopt selected projects to current session”.
6. Confirm the browser dialog showing selected count, project names, and current `session_id`.
7. Wait for the success result and refreshed diagnostics.
8. Open `/gantt-planner`.
9. Click “Open Saved Project”.
10. Confirm the adopted projects now appear in the normal modal.
11. Keep `ENABLE_GANTT_DEBUG=false` when the debug page is no longer needed.

## 9. Commit hash

Recorded in the implementation handoff/final response after the repository commit is created.
