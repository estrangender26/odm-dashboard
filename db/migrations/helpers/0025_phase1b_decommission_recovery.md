# Recovery Plan — Migration 0025 Phase 1B Decommission

## Overview

`DROP TABLE` is destructive. Unlike `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
(Phase 1), a table drop removes both schema and data. A simple rollback SQL
cannot recreate unknown production data.

This document describes the backup and recovery strategy.

## Pre-Execution Backup (Required)

Before running the forward migration in production, export the 4 tables:

```bash
pg_dump "$DATABASE_URL" \
  --table=public.odm_talk_notifications \
  --table=public.odm_talk_messages \
  --table=public.odm_talk_threads \
  --table=public.gantt_links \
  --format=custom \
  --file=phase1b_backup_$(date +%Y%m%d_%H%M%S).dump
```

Or using Supabase SQL Editor (text format):

```sql
-- Run this BEFORE the migration to create a server-side backup schema.
-- Drop the backup schema after confirming the migration is stable.

CREATE SCHEMA IF NOT EXISTS phase1b_backup;

CREATE TABLE phase1b_backup.odm_talk_threads AS
  SELECT * FROM public.odm_talk_threads;

CREATE TABLE phase1b_backup.odm_talk_messages AS
  SELECT * FROM public.odm_talk_messages;

CREATE TABLE phase1b_backup.odm_talk_notifications AS
  SELECT * FROM public.odm_talk_notifications;

CREATE TABLE phase1b_backup.gantt_links AS
  SELECT * FROM public.gantt_links;
```

Store the backup securely. **Do not commit production data to Git.**

## Restoration Procedure

If the migration causes unexpected issues:

### Option A: Restore from pg_dump

```bash
pg_restore "$DATABASE_URL" \
  --dbname="$DATABASE_URL" \
  --schema=public \
  phase1b_backup_YYYYMMDD_HHMMSS.dump
```

### Option B: Restore from backup schema

```sql
-- Recreate the tables from the backup schema.
-- This recreates the tables with data but WITHOUT original constraints,
-- indexes, or triggers. Those would need to be re-added manually from
-- the Drizzle snapshot metadata if required.

BEGIN;

CREATE TABLE public.odm_talk_threads AS
  SELECT * FROM phase1b_backup.odm_talk_threads;

CREATE TABLE public.odm_talk_messages AS
  SELECT * FROM phase1b_backup.odm_talk_messages;

CREATE TABLE public.odm_talk_notifications AS
  SELECT * FROM phase1b_backup.odm_talk_notifications;

CREATE TABLE public.gantt_links AS
  SELECT * FROM phase1b_backup.gantt_links;

-- Re-add primary keys
ALTER TABLE public.odm_talk_threads ADD PRIMARY KEY (id);
ALTER TABLE public.odm_talk_messages ADD PRIMARY KEY (id);
ALTER TABLE public.odm_talk_notifications ADD PRIMARY KEY (id);
ALTER TABLE public.gantt_links ADD PRIMARY KEY (id);

-- Re-add internal ODM-Talk FKs
ALTER TABLE public.odm_talk_messages
  ADD CONSTRAINT odm_talk_messages_thread_id_odm_talk_threads_id_fk
  FOREIGN KEY (thread_id) REFERENCES public.odm_talk_threads(id);

ALTER TABLE public.odm_talk_notifications
  ADD CONSTRAINT odm_talk_notifications_thread_id_odm_talk_threads_id_fk
  FOREIGN KEY (thread_id) REFERENCES public.odm_talk_threads(id);

ALTER TABLE public.odm_talk_notifications
  ADD CONSTRAINT odm_talk_notifications_message_id_odm_talk_messages_id_fk
  FOREIGN KEY (message_id) REFERENCES public.odm_talk_messages(id);

COMMIT;
```

## Cleanup After Stable Migration

Once the decommission is confirmed stable (e.g., after 1 week):

```sql
DROP SCHEMA IF EXISTS phase1b_backup CASCADE;
```

## Limitations

- **Row data**: Only recoverable from the pre-execution backup. The repository
  does not contain and must not contain production data.
- **Indexes and constraints**: The backup-schema method preserves data but not
  indexes or constraints. The `pg_dump --format=custom` method preserves
  everything.
- **Sequences**: If the dropped tables used sequences for `SERIAL` columns,
  those sequences are also dropped by `DROP TABLE`. Restoration must recreate
  them or use `GENERATED ALWAYS AS IDENTITY`.
- **Grants**: Post-restoration, the original anon/authenticated grants would
  need to be re-applied if the application ever needed these tables again
  (it does not).
