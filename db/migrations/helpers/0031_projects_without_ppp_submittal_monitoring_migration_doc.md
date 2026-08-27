# Migration 0031 — Projects without PPP: Master Data Submittal Monitoring

## Background

PR #389 created (and production-applied) `projects_without_ppp` and
`project_without_ppp_files`. PR #390 reverted the feature at the source level,
removing the schema, the `0031_projects_without_ppp.sql` migration and its
journal entry, while intentionally leaving the inert production tables in
place. The production Drizzle ledger therefore still records a
`0031_projects_without_ppp` row with `created_at = 1791312000013`.

## Strategy

- Reuse the inert tables — never drop them.
- New journal entry: tag `0031_projects_without_ppp_submittal_monitoring`,
  `when = 1791312000014` — strictly newer than the production ledger max
  (`1791312000013`) so the migrator does not skip it on the already-migrated
  production database, while a fresh database applies it as the final journal
  entry.
- The SQL is fully idempotent: `CREATE TABLE IF NOT EXISTS`,
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.
- No `DROP` statements. Destructive operations (e.g. dropping inert tables)
  require a separate dry-run and explicit approval.

## End states

### Fresh database
All journal entries 0000..0031 apply; 0031 creates both tables with the
evolved columns (`project_name`, `submitted_at`, `superseded_at`) and indexes.

### Production database containing inert PR #389 tables
Ledger max `created_at` = 1791312000013; the new entry (1791312000014) is
newer, so 0031 runs: `CREATE TABLE IF NOT EXISTS` is a no-op, then the three
`ADD COLUMN IF NOT EXISTS` statements and the two new indexes apply. Existing
submission/file history is untouched.

## Execution

1. `psql $DATABASE_URL -f db/migrations/helpers/0031_projects_without_ppp_submittal_monitoring_preflight.sql`
2. `npm run db:migrate`
3. `psql $DATABASE_URL -f db/migrations/helpers/0031_projects_without_ppp_submittal_monitoring_verification.sql`

## Rollback guidance

There is intentionally no automatic rollback SQL. Rolling back would require
dropping columns/tables that may hold production submission evidence; that is a
destructive operation requiring a separate dry-run and explicit approval.

## Tests

- `src/lib/projects_without_ppp_migration.test.ts` — content/journal-level
  validation for both starting conditions (fresh + already-#389-migrated).
- `scripts/projects_without_ppp_migration_lifecycle_test.ts` — live PostgreSQL
  lifecycle test (localhost:5433) exercising both starting conditions.
