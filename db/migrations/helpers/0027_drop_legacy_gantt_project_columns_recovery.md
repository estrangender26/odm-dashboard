# Recovery Plan — Migration 0027 Legacy `gantt_projects` Column Drop

## Pre-Existing Backup

Production already has a server-side backup table:

```text
phase2_legacy_gantt_backup.gantt_projects_legacy_columns
```

It contains:

- `id` (project key)
- `session_id`
- `user_id`
- `tasks_data`
- `links_data`
- `created_by`
- `updated_by`

**Do NOT delete this backup schema or table.**

## Restoration

If the legacy columns ever need to be restored, use the backup keyed by project `id`:

```sql
BEGIN;

ALTER TABLE public.gantt_projects
  ADD COLUMN session_id varchar(255),
  ADD COLUMN user_id integer,
  ADD COLUMN tasks_data text NOT NULL DEFAULT '[]',
  ADD COLUMN links_data text,
  ADD COLUMN created_by varchar(255),
  ADD COLUMN updated_by varchar(255);

UPDATE public.gantt_projects gp
SET
  session_id = b.session_id,
  user_id = b.user_id,
  tasks_data = b.tasks_data,
  links_data = b.links_data,
  created_by = b.created_by,
  updated_by = b.updated_by
FROM phase2_legacy_gantt_backup.gantt_projects_legacy_columns b
WHERE gp.id = b.id;

-- Recreate legacy indexes if needed
CREATE INDEX IF NOT EXISTS gantt_projects_session_idx ON public.gantt_projects(session_id);
CREATE INDEX IF NOT EXISTS gantt_projects_user_idx ON public.gantt_projects(user_id);

COMMIT;
```

## Limitations

- The backup is data-only. Column order, defaults, and indexes must be recreated manually if restoration is required.
- `tasks_data` had a `NOT NULL DEFAULT '[]'` constraint in the original schema; restoration should match that if the application ever needs it again (it does not).
- Do not commit production data to Git.
