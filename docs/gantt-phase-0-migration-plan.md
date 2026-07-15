# Gantt Phase 0 Migration Plan

Status: review only. No migration has been executed. Execution requires separate explicit approval naming the environment and approved data mappings.

## Source of truth

`gantt_projects`, `gantt_tasks`, `gantt_dependencies`, `gantt_assignments`, and `gantt_calendars` are the canonical normalized PostgreSQL model. `tasks_data` and `links_data` remain legacy snapshot/import/export columns and are not read by the live project-open path.

## Mandatory preflight

Run read-only inventory queries in the approved maintenance window and export the results for review:

- Count projects by `user_id`/`session_id` ownership state.
- List unowned projects and projects with both ownership fields populated.
- Count tasks and dependencies with a null or missing project.
- Detect task parents outside the task project.
- Detect dependency endpoints outside the dependency project.
- Detect duplicate dependency pairs.
- Record task/dependency/assignment counts per project and checksums of legacy JSON snapshots.

No project or owner is inferred. The owner and project mapping for every ambiguous legacy row must be separately approved and recorded before the migration is allowed to proceed.

## Proposed execution

1. Put Gantt mutations into maintenance/read-only mode.
2. Take a database snapshot and record its restore identifier.
3. Apply the approved owner/project mapping in a separate reviewed data-fix script.
4. Run the review-only SQL at [gantt-phase-0-safety.sql](./migrations/gantt-phase-0-safety.sql) in a transaction.
5. Run post-migration counts, ownership checks, same-project FK checks, duplicate checks, and sample project round trips.
6. Deploy the Phase 0 branch only after the schema checks pass.
7. Keep legacy JSON columns unchanged for audit/export during the stabilization window.

The SQL deliberately aborts on ambiguous ownership, null project IDs, cross-project links, or duplicate dependency pairs. It contains no table drop, truncate, or reset-and-rehydrate operation.

## Compatibility and cutover

The application code requires the additive Phase 0 columns and tables, so schema migration and code deployment must be coordinated. Do not deploy this branch to an environment whose schema has not passed the preflight and migration. Do not run the migration merely to test the branch; use an isolated disposable database created from an approved sanitized snapshot.

## Post-migration verification

- User A cannot list, read, rename, clone, mutate, clear, or delete User B's project.
- Anonymous scope A cannot access anonymous scope B.
- Every task, dependency, and assignment has one valid project.
- Parent, predecessor, and successor references remain inside that project.
- Project open performs reads only and does not change row counts or timestamps.
- A failed task/dependency/import operation leaves counts and checksums unchanged.
- Create/save/close/open/export/import/save/open preserves hierarchy, types, dates, category, ordering, dependencies, and assignments.
