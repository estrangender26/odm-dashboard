# Migration Governance — ODM Dashboard

## Rule 1: Journal timestamps must be strictly increasing

Every new migration entry in `db/migrations/meta/_journal.json` MUST have a
`when` timestamp strictly greater than:

1. The previous journal entry's `when` timestamp.
2. The largest `created_at` in `drizzle.__drizzle_migrations` (when a database
   connection is available).

The Drizzle PostgreSQL migrator decides pending migrations by comparing the
journal entry `when` value against the largest `created_at` in the ledger.

## Rule 2: Do not reuse historical timestamps

Historical entries 0000 through 0019 are immutable. If a migration is
regenerated, reordered, or recreated, assign it a fresh timestamp greater than
the current latest. Never back-date a migration.

## Rule 3: Tag and file mapping must match

The `tag` field in `_journal.json` MUST map to a SQL file named `${tag}.sql` in
`db/migrations/`. The migrator reads SQL files from disk using `tag`, not from
the journal body.

## Rule 4: Hash is recordkeeping only

The `hash` stored in `drizzle.__drizzle_migrations` is a SHA-256 of the SQL
file contents. The current migrator does not use it to skip pending migrations;
it uses `when`. Do not rely on hash equality to prevent re-runs.

## Rule 5: Validate before generating or applying migrations

Run the migration governance checks before creating any new migration:

```bash
DATABASE_SSL_MODE=disable node --import tsx scripts/migration_governance_check.ts \
  postgresql://postgres:postgres@localhost:5433/primavera_test?sslmode=disable
```

## Rule 6: Idempotent and drift-detecting migrations

Migrations that may be applied to a database where their objects already exist
must validate existing objects before accepting them. Use the 0020 migration as
the reference pattern: check column types, nullability, FK delete rules, indexes,
and unique constraints; create only missing objects; fail clearly on conflict.

## 0020 ordering defect and fix

Migration `0020_primavera_lite_shell` originally had a journal timestamp
(`1785874059532`) earlier than `0019_gantt_link_sharing`
(`1791312000001`). The repository fix updates the 0020 journal timestamp to
`1791312000002`, strictly after 0019.

The 0020 SQL migration is now idempotent and drift-detecting so it can safely
reconcile production, where the schema objects were manually applied before the
ledger recorded them. On a database whose latest ledger row is 0019, the
migrator will apply 0020 once and insert a truthful ledger row. On a database
where 0020 objects already exist, the migration validates them and still
records the ledger row.

## Future migrations

Each new migration must:

- Use `drizzle-kit generate`.
- Receive a `when` timestamp greater than every previous journal entry.
- Be validated by `scripts/migration_governance_check.ts`.
- Include preflight, backup, verification, and rollback artifacts if it modifies
  production data or types.
