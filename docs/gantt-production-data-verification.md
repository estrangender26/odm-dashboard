# Gantt production data verification

Use this procedure before adding or changing any Gantt project visibility/adoption logic. The checks below are read-only and inspect the active production database used by the running app.

## Prerequisite

Set this environment variable in the running production app, then restart/redeploy the app:

```bash
ENABLE_GANTT_DEBUG=true
```

Disable it again after verification if you do not want debug inspection exposed:

```bash
ENABLE_GANTT_DEBUG=false
```

## API endpoint

Call the read-only tRPC API endpoint in production:

```bash
curl -sS -X POST https://<production-host>/api/trpc/ganttProjects.debug \
  -H 'content-type: application/json' \
  --data '{}' | jq
```

The response includes:

- `rowCount`: total rows in `public.gantt_projects`.
- `latest`: latest 50 projects with `id`, `name`, `createdAt`, `updatedAt`, `userId`, `sessionId`, and `tasksCount`.
- `userIdValues`: grouped `user_id` values and counts.
- `sessionIdValues`: grouped `session_id` values and counts.
- `ownershipSummary`: total ownership/session summary, including rows with neither `user_id` nor `session_id`.
- `databaseFingerprint` and `databaseContext`: confirms which database the running app is connected to.
- `sql`: the exact latest-50 SQL query used by the endpoint.

## Debug route

The backend debug route is the existing `ganttProjects.debug` tRPC procedure. It is guarded by `ENABLE_GANTT_DEBUG=true` and returns the diagnostics from `fetchGanttProjectsDiagnostics`.

## Admin page

Open this page in a browser:

```text
https://<production-host>/admin/gantt-projects-debug
```

The page calls the `ganttProjects.debug` tRPC procedure and renders:

1. Total row count.
2. Latest 50 projects.
3. Project names.
4. `createdAt`.
5. `updatedAt`.
6. `userId`.
7. `sessionId`.
8. Task counts computed from `tasks_data`.

## SQL query

Run this directly against the production database if you have SQL console access:

```sql
SELECT
  id,
  name,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  user_id AS "userId",
  session_id AS "sessionId",
  CASE
    WHEN tasks_data IS NULL OR tasks_data = '' THEN 0
    WHEN left(trim(tasks_data), 1) = '[' THEN json_array_length(tasks_data::json)
    WHEN left(trim(tasks_data), 1) = '{' THEN json_object_length(tasks_data::json)
    ELSE NULL
  END AS "tasksCount"
FROM public.gantt_projects
ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
LIMIT 50;
```

For the total count:

```sql
SELECT COUNT(*)::int AS count
FROM public.gantt_projects;
```

For `user_id` values:

```sql
SELECT user_id AS "userId", COUNT(*)::int AS rows
FROM public.gantt_projects
GROUP BY user_id
ORDER BY user_id NULLS FIRST;
```

For `session_id` values:

```sql
SELECT
  session_id AS "sessionId",
  COUNT(*)::int AS rows,
  MIN(created_at) AS "firstCreatedAt",
  MAX(updated_at) AS "lastUpdatedAt"
FROM public.gantt_projects
GROUP BY session_id
ORDER BY "lastUpdatedAt" DESC NULLS LAST, rows DESC;
```

For rows with neither `user_id` nor `session_id`:

```sql
SELECT
  COUNT(*)::int AS "totalRows",
  COUNT(*) FILTER (WHERE user_id IS NOT NULL)::int AS "rowsWithUserId",
  COUNT(*) FILTER (WHERE session_id IS NOT NULL)::int AS "rowsWithSessionId",
  COUNT(*) FILTER (WHERE user_id IS NULL AND session_id IS NULL)::int AS "rowsWithNeitherUserNorSession"
FROM public.gantt_projects;
```

## How to interpret the result

- If old project names appear in the latest-50 endpoint/page/SQL output, the records exist in the active production database and the next step is to compare their `userId`/`sessionId` values with the identity/session used by the app.
- If old project names do not appear but `rowCount` is greater than 50, query by expected name/date directly in the SQL console.
- If old project names do not exist anywhere in `public.gantt_projects`, then the problem is not a UI visibility issue in this active database. The likely causes are wrong database/environment, a previous save failure, or records saved in a different database.
- If `databaseFingerprint`/`databaseContext` do not match the database where old projects were originally saved, the app is connected to the wrong database/environment.
