# Gantt Phase 0 Safety Architecture

Phase 0 makes normalized PostgreSQL rows the only live source of truth and introduces a server-enforced ownership boundary.

```text
Gantt React UI
  -> canonical camelCase tRPC contracts (projectId required)
    -> signed anonymous scope or authenticated user scope
      -> Gantt repository transaction
        -> hierarchy/dependency validation before writes
          -> normalized PostgreSQL tables
```

## Boundaries

- `contracts/gantt.ts` defines the canonical project, task, dependency, assignment, and calendar schemas.
- `api/gantt-scope.ts` derives scope on the server. Authenticated requests use the authenticated user ID. Anonymous requests use a signed, HTTP-only cookie; a caller-provided owner/session ID is never accepted.
- `api/gantt-domain.ts` validates hierarchy and dependency graph invariants before data is deleted or replaced.
- `api/gantt-repository.ts` owns all scoped reads and transactional mutations.
- Gantt routers contain no DDL, global reset, seed, arbitrary adoption, or unscoped project/task/dependency operation.
- The React compatibility mapping is UI-only. Server contracts and normalized storage use canonical camelCase fields.

## Transaction boundaries

- Task create/update and incoming dependency replacement share one transaction.
- Subtree deletion removes assignments, dependencies, and tasks in one transaction.
- Hierarchy and reorder operations are project-scoped transactions.
- Import validates the complete hierarchy and DAG before replacing any rows, then writes tasks, dependencies, and assignments in one transaction.
- Save As clones project metadata and all normalized rows in one transaction.
- Project delete removes all normalized child rows and the scoped project in one transaction.

## Debug and legacy data

Diagnostics require an authenticated admin and `ENABLE_GANTT_DEBUG=true`; the page is read-only. `tasks_data` and `links_data` are initialized only as legacy snapshot placeholders and are not used to open or mutate a project.

## Phase boundary

This work establishes safety and canonical persistence. The Phase 1 graph scheduler remains separate; the current client scheduling engine is not represented as the future scheduling source of truth.
