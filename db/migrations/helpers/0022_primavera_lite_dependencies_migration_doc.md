# Migration 0022 — Primavera Lite Dependencies

Adds only `gantt_activity_dependencies`, the normalized Primavera Lite relationship table. It references normalized projects and activities with restrictive foreign keys and does not read, alter, or write legacy `gantt_dependencies`. The migration is idempotent: an existing canonical table is fully validated, while conflicting columns, primary key, foreign keys/delete rules, indexes, relationship-type constraint, or no-self-link constraint fail before ledger insertion.

Preflight: run `0022_primavera_lite_dependencies_preflight.sql` read-only. Apply through the normal Drizzle startup migrator only. Verify with `0022_primavera_lite_dependencies_verification.sql`.

Rollback is intentionally manual and destructive because dropping the new table deletes dependency records. Never run rollback automatically or after production failure without explicit approval.
