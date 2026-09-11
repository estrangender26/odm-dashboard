# Recovery Plan — Migration 0039 Maintenance Planning (Post-PPP) Decommission

## Overview

Migration `0039_decommission_maintenance_planning.sql` performs:

```sql
DROP TABLE public.tasks;
DROP TABLE public.equipment;
```

`DROP TABLE` removes both schema and data, so a rollback SQL alone cannot
recreate the production rows. Recovery depends on the pre-execution backup.

## Pre-Execution Backup (Required)

A row-level backup of both tables was taken from production before this
migration was deployed, via a Render one-off job running against the service's
own `DATABASE_URL` (the credential never left Render):

| Field | Value |
| --- | --- |
| Tables | `public.tasks` (1376 rows), `public.equipment` (127 rows) |
| Format | gzipped JSON (`{ exportedAt, database, tables: { tasks: { rowCount, rows }, equipment: { rowCount, rows } } }`) |
| Location | Local operator workspace, `backups/maintenance-planning-backup-<UTC>.json.gz` — **not** in this repository |
| Integrity | `sha256` recorded in the adjacent `.manifest.json`, verified after download |

The equivalent `pg_dump` command, for an operator with database credentials:

```bash
pg_dump "$DATABASE_URL" \
  --table=public.tasks \
  --table=public.equipment \
  --format=custom \
  --file=maintenance_planning_backup_$(date +%Y%m%d_%H%M%S).dump
```

Store the backup securely. **Do not commit production data to Git.**

## Restoration Procedure

### Option A — restore from the JSON backup

```sql
CREATE TABLE public.equipment (
  id serial PRIMARY KEY,
  name varchar(255) NOT NULL,
  initials varchar(10) NOT NULL
);
CREATE INDEX equipment_name_idx ON public.equipment (name);

CREATE TABLE public.tasks (
  id serial PRIMARY KEY,
  equipment_id bigint NOT NULL,
  task_list text NOT NULL,
  frequency varchar(100) NOT NULL,
  responsible_personnel varchar(100),
  operations varchar(100),
  amd varchar(100),
  ard varchar(100),
  procedure_familiarity text,
  dataset varchar(20) NOT NULL
);
CREATE INDEX tasks_equipment_idx ON public.tasks (equipment_id);
CREATE INDEX tasks_dataset_idx ON public.tasks (dataset);
CREATE INDEX tasks_familiarity_idx ON public.tasks (procedure_familiarity);
```

Then insert the backed-up rows (equipment first, then tasks) and reset the
sequences:

```sql
SELECT setval('public.equipment_id_seq', (SELECT max(id) FROM public.equipment));
SELECT setval('public.tasks_id_seq', (SELECT max(id) FROM public.tasks));
```

### Option B — restore from pg_dump

```bash
pg_restore "$DATABASE_URL" --dbname="$DATABASE_URL" --schema=public maintenance_planning_backup_YYYYMMDD_HHMMSS.dump
```

### Option C — re-seed from the original source workbooks

The tables were originally populated from the HTT STP and Aglipay STP
maintenance workbooks. Restoring the application module plus a re-import would
reproduce the rows, but the historical `procedure_familiarity` edits made
through the dashboard would be lost.

## Post-Restoration RLS State

Migration `0028_enable_rls_remaining_tables.sql` had enabled RLS (with no
policies) and revoked `anon`/`authenticated` privileges on both tables. If the
tables are ever restored, re-apply that state for those two tables:

```sql
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.equipment FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.tasks FROM anon, authenticated;
```

## Limitations

- **Row data** is recoverable only from the pre-execution backup.
- **Sequences** are dropped with the tables; the `serial` defaults above
  recreate them, and `setval` restores the high-water mark.
- **Indexes and constraints** are recreated by Option A or restored by
  Option B. There were no foreign keys, triggers, or policies on either table.
- Restoring the tables without restoring the application modules leaves orphan
  storage; the modules were removed from the codebase in the same change set.
