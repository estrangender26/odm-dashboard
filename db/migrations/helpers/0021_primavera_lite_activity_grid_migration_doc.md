# Migration 0021 — Primavera Lite Activity Grid

Adds durable ordering for normalized Primavera Lite activities.

## Change

- Adds `gantt_activities.sort_order integer NOT NULL DEFAULT 0`.
- Backfills a contiguous zero-based order by existing activity `id`, partitioned by `project_id` and `wbs_node_id`.
- Adds `gantt_activities_order_idx (project_id, wbs_node_id, sort_order)`.

No calendar rows are created or changed. No legacy Gantt tables or JSON columns are modified.

## Governance

Run the preflight before applying to an isolated PostgreSQL 15 database. Apply through Drizzle, run verification, then exercise create/reorder/cross-WBS move. A second application is safe: an already-valid column and index are retained. Conflicting column types, mixed partial backfill state, or a conflicting named index abort the migration.

The production migration requires separate approval. This PR must not apply it to Render or Supabase.

## Rollback

The rollback removes only the new index and `sort_order` column. Activity rows and every pre-0021 column remain intact.
