# Gantt Phase 0 Rollback Plan

No rollback action has been executed. Any production rollback or database change requires separate explicit approval.

## Preferred rollback: application first

1. Stop Gantt mutations or put the module into read-only mode.
2. Capture current normalized-table counts and export all projects, tasks, dependencies, assignments, and calendars.
3. Redeploy the last known-good application release.
4. Leave the additive Phase 0 tables, columns, indexes, and constraints in place. The previous application ignores them, which avoids destructive data loss.
5. Verify non-Gantt dashboard health and retain the Phase 0 exports for reconciliation.

## Data rollback

If Phase 0 writes must be reversed, restore the pre-migration database snapshot into a separate recovery database first. Compare project-level counts and checksums before a controlled cutover. Never overwrite the active database without an approved incident plan and verified backup.

## Schema rollback

Schema removal is the last resort because assignments, calendars, and normalized relationships may contain new data. Do not drop tables or columns. If a schema rollback is explicitly approved, first archive the additive tables, remove only Phase 0 foreign-key/check constraints that block the old application, and retain all data for replay. A destructive reverse migration is intentionally not supplied.

## Abort triggers

Immediately stop the rollout if any of the following occurs:

- ownership scope mismatch or unauthorized project visibility;
- cross-project parent/dependency reference;
- unexpected row-count reduction;
- failed transaction that leaves partial writes;
- project open changes persistent data;
- round-trip property loss.
