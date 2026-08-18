# Recovery Plan — Migration 0026 Legacy Gantt Table Drop

## Pre-Existing Backup

Production already has a server-side backup schema:

```text
phase2_legacy_gantt_backup.gantt_tasks
phase2_legacy_gantt_backup.gantt_dependencies
```

**Do NOT delete this backup schema.** It is data-only (CTAS) and does not inherit the original `SERIAL` sequence defaults, which avoids the Phase 1B sequence-dependency problem.

## Restoration Options

### Option A — Full-fidelity restore from `pg_dump`

If a `pg_dump --format=custom` backup was taken before deployment, restore with:

```bash
pg_restore "$DATABASE_URL" \
  --dbname="$DATABASE_URL" \
  --schema=public \
  legacy_gantt_tables_YYYYMMDD_HHMMSS.dump
```

This restores data, indexes, constraints, triggers, and sequences exactly as they were.

### Option B — Restore from server-side backup schema

The backup tables contain only data. Restoration requires recreating the schema, indexes, constraints, and sequences manually:

```sql
BEGIN;

-- Recreate tables from backup data
CREATE TABLE public.gantt_tasks AS
  SELECT * FROM phase2_legacy_gantt_backup.gantt_tasks;

CREATE TABLE public.gantt_dependencies AS
  SELECT * FROM phase2_legacy_gantt_backup.gantt_dependencies;

-- Re-add primary keys
ALTER TABLE public.gantt_tasks ADD PRIMARY KEY (id);
ALTER TABLE public.gantt_dependencies ADD PRIMARY KEY (id);

-- Recreate SERIAL sequences if the application ever needs them again
CREATE SEQUENCE public.gantt_tasks_id_seq;
SELECT setval('public.gantt_tasks_id_seq', COALESCE((SELECT max(id) FROM public.gantt_tasks), 1));
ALTER TABLE public.gantt_tasks ALTER COLUMN id SET DEFAULT nextval('public.gantt_tasks_id_seq');

CREATE SEQUENCE public.gantt_dependencies_id_seq;
SELECT setval('public.gantt_dependencies_id_seq', COALESCE((SELECT max(id) FROM public.gantt_dependencies), 1));
ALTER TABLE public.gantt_dependencies ALTER COLUMN id SET DEFAULT nextval('public.gantt_dependencies_id_seq');

COMMIT;
```

Additional indexes, constraints, and triggers would need to be recreated from Drizzle snapshot metadata if required.

## Limitations

- The server-side backup is data-only.
- Restoring from it requires manual schema/index/sequence recreation.
- The `pg_dump` custom backup is the authoritative full-fidelity restore source.
- Do not commit production data to Git.
