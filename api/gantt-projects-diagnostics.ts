import { sql } from "drizzle-orm";
import {
  getConnectionFingerprint,
  getNormalizedDatabaseUrl,
} from "./queries/connection";

function queryRows<T extends Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

function getDbFingerprint() {
  try {
    return getConnectionFingerprint(getNormalizedDatabaseUrl());
  } catch {
    return "invalid DATABASE_URL";
  }
}

export const GANTT_PROJECTS_DIAGNOSTIC_SQL = `
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
`.trim();

export async function fetchGanttProjectsDiagnostics(db: {
  execute: (query: any) => Promise<unknown>;
}) {
  const [
    dbContext,
    countResult,
    latestRows,
    userIdValues,
    sessionIdValues,
    ownershipSummary,
  ] = await Promise.all([
    db.execute(
      sql.raw(
        `SELECT current_database() AS database, current_schema() AS schema, current_user AS "currentUser"`
      )
    ),
    db.execute(
      sql.raw(`SELECT COUNT(*)::int AS count FROM public.gantt_projects`)
    ),
    db.execute(sql.raw(GANTT_PROJECTS_DIAGNOSTIC_SQL)),
    db.execute(
      sql.raw(`
          SELECT user_id AS "userId", COUNT(*)::int AS rows
          FROM public.gantt_projects
          GROUP BY user_id
          ORDER BY user_id NULLS FIRST
        `)
    ),
    db.execute(
      sql.raw(`
          SELECT
            session_id AS "sessionId",
            COUNT(*)::int AS rows,
            MIN(created_at) AS "firstCreatedAt",
            MAX(updated_at) AS "lastUpdatedAt"
          FROM public.gantt_projects
          GROUP BY session_id
          ORDER BY "lastUpdatedAt" DESC NULLS LAST, rows DESC
        `)
    ),
    db.execute(
      sql.raw(`
          SELECT
            COUNT(*)::int AS "totalRows",
            COUNT(*) FILTER (WHERE user_id IS NOT NULL)::int AS "rowsWithUserId",
            COUNT(*) FILTER (WHERE session_id IS NOT NULL)::int AS "rowsWithSessionId",
            COUNT(*) FILTER (WHERE user_id IS NULL AND session_id IS NULL)::int AS "rowsWithNeitherUserNorSession"
          FROM public.gantt_projects
        `)
    ),
  ]);

  return {
    databaseFingerprint: getDbFingerprint(),
    databaseContext: queryRows(dbContext)[0] ?? {},
    rowCount: queryRows(countResult)[0]?.count ?? 0,
    latest: queryRows(latestRows),
    userIdValues: queryRows(userIdValues),
    sessionIdValues: queryRows(sessionIdValues),
    ownershipSummary: queryRows(ownershipSummary)[0] ?? {},
    sql: GANTT_PROJECTS_DIAGNOSTIC_SQL,
  };
}
