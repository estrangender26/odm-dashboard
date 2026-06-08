import { z } from "zod";
import { and, eq, desc, sql, isNull, or } from "drizzle-orm";
import * as cookie from "cookie";
import { db, getConnectionFingerprint, getNormalizedDatabaseUrl } from "./queries/connection";
import { ganttProjects } from "@db/schema";
import { publicQuery } from "./middleware";
import { TRPCError } from "@trpc/server";

const ANON_COOKIE = "gantt_anon_session";

function getOrCreateAnonSession(req: Request, resHeaders: Headers) {
  const cookies = cookie.parse(req.headers.get("cookie") || "");
  let anonId = cookies[ANON_COOKIE];
  if (!anonId) {
    anonId = crypto.randomUUID();
    resHeaders.append("set-cookie", cookie.serialize(ANON_COOKIE, anonId, {
      path: "/", httpOnly: true, sameSite: "lax", maxAge: 60*60*24*365, secure: process.env.NODE_ENV === "production",
    }));
  }
  return anonId;
}

function buildVisibilityFilter(userId: number | undefined, sessionId: string) {
  const anonymousSessionFilter = and(eq(ganttProjects.sessionId, sessionId), isNull(ganttProjects.userId));

  // Authenticated users may have projects saved before login under the same anonymous
  // browser session. Keep user-owned projects visible while also allowing those
  // session-owned anonymous projects to be opened/adopted safely.
  if (userId) return or(eq(ganttProjects.userId, userId), anonymousSessionFilter);
  return anonymousSessionFilter;
}

type GanttProjectRow = typeof ganttProjects.$inferSelect;

function getDbFingerprint() {
  try {
    return getConnectionFingerprint(getNormalizedDatabaseUrl());
  } catch {
    return "invalid DATABASE_URL";
  }
}

function shouldAdoptAnonymousProject(row: GanttProjectRow, userId: number | undefined, sessionId: string) {
  return Boolean(userId && row.userId == null && row.sessionId === sessionId);
}



export const ganttProjectsRouter = {
  debug: publicQuery.query(async () => {
    if (process.env.ENABLE_GANTT_DEBUG !== "true") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Debug endpoint disabled" });
    }

    let masked = "unavailable";
    try {
      const parsed = new URL(getNormalizedDatabaseUrl());
      const host = parsed.hostname;
      const dbName = parsed.pathname.replace(/^\//, "") || "unknown";
      masked = `${host}/${dbName}`;
    } catch {
      masked = "invalid DATABASE_URL";
    }


    const [countResult, latestRows, columns] = await Promise.all([
      db.execute(sql.raw(`SELECT COUNT(*)::int AS count FROM gantt_projects`)),
      db.execute(sql.raw(`
        SELECT
          id,
          name,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          CASE
            WHEN tasks_data IS NULL OR tasks_data = '' THEN 0
            WHEN left(trim(tasks_data), 1) = '[' THEN json_array_length(tasks_data::json)
            WHEN left(trim(tasks_data), 1) = '{' THEN json_object_length(tasks_data::json)
            ELSE NULL
          END AS "tasksCount"
        FROM gantt_projects
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 5
      `)),
      db.execute(sql.raw(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'gantt_projects'
        ORDER BY ordinal_position
      `)),
    ]);

    return {
      database: masked,
      rowCount: countResult.rows?.[0]?.count ?? 0,
      latest: latestRows.rows ?? [],
      columns: columns.rows ?? [],
    };
  }),

  // ── List all projects (name + id + dates only, no tasks_data) ──
  list: publicQuery.query(async ({ ctx }) => {
    try {
      const userId = ctx.user?.id;
      const sessionId = getOrCreateAnonSession(ctx.req, ctx.resHeaders);
      const visibilityFilter = buildVisibilityFilter(userId, sessionId);
      const [dbInfo, diagnostics] = await Promise.all([
        db.execute(sql.raw(`SELECT current_schema() AS schema, current_database() AS database`)),
        db.execute(sql`
          SELECT
            COUNT(*)::int AS "totalRows",
            COUNT(*) FILTER (WHERE user_id IS NOT NULL)::int AS "rowsWithUserId",
            COUNT(*) FILTER (WHERE session_id IS NOT NULL)::int AS "rowsWithSessionId",
            COUNT(*) FILTER (WHERE user_id IS NULL AND session_id IS NULL)::int AS "rowsWithNeitherOwner",
            COUNT(*) FILTER (WHERE ${userId ?? null}::int IS NOT NULL AND user_id = ${userId ?? null})::int AS "rowsMatchingUserId",
            COUNT(*) FILTER (WHERE session_id = ${sessionId})::int AS "rowsMatchingSessionId",
            COUNT(*) FILTER (WHERE user_id IS NULL AND session_id = ${sessionId})::int AS "anonymousRowsMatchingSessionId"
          FROM gantt_projects
        `),
      ]);
      const dbInfoResult = dbInfo as { rows?: Record<string, unknown>[] } & Record<string, unknown>[];
      const diagnosticsResult = diagnostics as { rows?: Record<string, unknown>[] } & Record<string, unknown>[];
      const dbContextRow = (dbInfoResult.rows ?? dbInfoResult)[0] ?? {};
      const diagnosticRow = (diagnosticsResult.rows ?? diagnosticsResult)[0] ?? {};
      console.log("[ganttProjects.list] identity", { userId: userId ?? null, sessionId });
      const rows = await db
        .select({
          id: ganttProjects.id,
          name: ganttProjects.name,
          description: ganttProjects.description,
          createdBy: ganttProjects.createdBy,
          updatedAt: ganttProjects.updatedAt,
          createdAt: ganttProjects.createdAt,
        })
        .from(ganttProjects)
        .where(visibilityFilter)
        .orderBy(desc(ganttProjects.updatedAt));
      console.log("[ganttProjects.list] diagnostics", {
        databaseUrlFingerprint: getDbFingerprint(),
        currentSchema: dbContextRow.schema ?? null,
        currentDatabase: dbContextRow.database ?? null,
        userId: userId ?? null,
        sessionId,
        totalRows: diagnosticRow.totalRows ?? 0,
        rowsWithUserId: diagnosticRow.rowsWithUserId ?? 0,
        rowsWithSessionId: diagnosticRow.rowsWithSessionId ?? 0,
        rowsWithNeitherOwner: diagnosticRow.rowsWithNeitherOwner ?? 0,
        rowsMatchingUserId: diagnosticRow.rowsMatchingUserId ?? 0,
        rowsMatchingSessionId: diagnosticRow.rowsMatchingSessionId ?? 0,
        anonymousRowsMatchingSessionId: diagnosticRow.anonymousRowsMatchingSessionId ?? 0,
        rowsReturnedToModal: rows.length,
        projectIdsReturnedToModal: rows.map((r) => r.id),
      });
      return { projects: rows, count: rows.length };
    } catch (err: any) {
      console.error("[ganttProjects.list] error:", err.message);
      return { projects: [] as any[], count: 0 };
    }
  }),

  // ── Get full project (with tasks_data) ──
  // Defined as mutation so it can be called on-demand from the UI
  get: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const userId = ctx.user?.id;
        const sessionId = getOrCreateAnonSession(ctx.req, ctx.resHeaders);
        const visibilityFilter = buildVisibilityFilter(userId, sessionId);
        const dbInfo = await db.execute(sql.raw(`SELECT current_schema() AS schema, current_database() AS database`));
        console.log("[ganttProjects.get] identity", { userId: userId ?? null, sessionId, id: input.id });
        console.log("[ganttProjects.get] db_context", {
          currentSchema: dbInfo.rows?.[0]?.schema ?? null,
          currentDatabase: dbInfo.rows?.[0]?.database ?? null,
        });
        const rows = await db
          .select()
          .from(ganttProjects)
          .where(and(eq(ganttProjects.id, input.id), visibilityFilter));

        console.log("[ganttProjects.get] lookup", {
          userId: userId ?? null,
          sessionId,
          requestedId: input.id,
          rowsFound: rows.length,
        });

        if (!rows.length) {
          console.warn("[ganttProjects.get] not_found", {
            userId: userId ?? null,
            sessionId,
            requestedId: input.id,
            reason: "no row matched id + visibility filter",
          });
          throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        }

        let row = rows[0];
        let adoptedAnonymousProject = false;
        if (userId && shouldAdoptAnonymousProject(row, userId, sessionId)) {
          const adopted = await db
            .update(ganttProjects)
            .set({ userId, ownerId: userId, updatedAt: new Date() })
            .where(and(eq(ganttProjects.id, row.id), eq(ganttProjects.sessionId, sessionId), isNull(ganttProjects.userId)))
            .returning();

          if (adopted.length > 0) {
            row = adopted[0];
            adoptedAnonymousProject = true;
          }
        }
        const safeTasksData = row.tasksData && row.tasksData.trim().length > 0 ? row.tasksData : "[]";
        const safeLinksData = row.linksData && row.linksData.trim().length > 0 ? row.linksData : "[]";

        console.log("[ganttProjects.get] success", {
          projectId: row.id,
          projectName: row.name,
          adoptedAnonymousProject,
          userId: userId ?? null,
          sessionId,
          tasksDataWasNullish: !row.tasksData,
          linksDataWasNullish: !row.linksData,
        });

        return {
          ...row,
          tasksData: safeTasksData,
          linksData: safeLinksData,
        };
      } catch (err: any) {
        if (err instanceof TRPCError) throw err;
        console.error("[ganttProjects.get] error:", err.message);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to load project" });
      }
    }),

  // ── Save (create or update) ──
  save: publicQuery
    .input(
      z.object({
        id: z.number().optional(),
        name: z.string().min(1).max(255),
        tasksData: z.string().optional().default("[]"), // JSON string
        linksData: z.string().optional().nullable(),
        description: z.string().optional(),
        createdBy: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user?.id;
      const sessionId = getOrCreateAnonSession(ctx.req, ctx.resHeaders);
      const payloadSize = Buffer.byteLength(
        JSON.stringify({
          name: input.name,
          tasksData: input.tasksData || "[]",
          linksData: input.linksData ?? null,
          description: input.description ?? null,
          id: input.id ?? null,
        }),
        "utf8"
      );
      console.log("[ganttProjects.save] start", {
        databaseUrlFingerprint: getDbFingerprint(),
        userId: userId ?? null,
        sessionId,
        id: input.id ?? null,
        name: input.name,
        tasksBytes: Buffer.byteLength(input.tasksData || "[]", "utf8"),
        linksBytes: Buffer.byteLength(input.linksData || "", "utf8"),
        payloadBytes: payloadSize,
      });
      try {
        // Keep INSERT/UPDATE ... RETURNING on the same tx client for pooler compatibility.
        const persisted = await db.transaction(async (tx) => {
          const txIdentity = await tx.execute(sql`SELECT txid_current() AS txid`);
          console.log("[ganttProjects.save] tx_identity", {
            txid: txIdentity.rows?.[0]?.txid ?? null,
            userId: userId ?? null,
            sessionId,
          });
          const visibilityFilter = buildVisibilityFilter(userId, sessionId);
          if (input.id) {
            const updated = await tx
              .update(ganttProjects)
              .set({
                name: input.name,
                tasksData: input.tasksData || "[]",
                linksData: input.linksData ?? null,
                description: input.description ?? null,
                updatedBy: input.createdBy ?? null,
                userId: userId ?? null,
                ownerId: userId ?? null,
                sessionId,
                updatedAt: new Date(),
              })
              .where(and(eq(ganttProjects.id, input.id), visibilityFilter))
              .returning();

            if (updated.length > 0) {
              console.log("[ganttProjects.save] update result", { rowCount: updated.length, id: updated[0].id });
              return { row: updated[0], action: "updated" as const };
            }
          }

          const created = await tx
            .insert(ganttProjects)
            .values({
              name: input.name,
              tasksData: input.tasksData || "[]",
              linksData: input.linksData ?? null,
              description: input.description ?? null,
              createdBy: input.createdBy ?? null,
              userId: userId ?? null,
              ownerId: userId ?? null,
              sessionId,
            })
            .returning();

          if (created.length !== 1) {
            throw new Error(`Insert failed: expected 1 row, got ${created.length}`);
          }

          console.log("[ganttProjects.save] insert result", { rowCount: created.length, id: created[0].id });
          return { row: created[0], action: "created" as const };
        });

        if (!persisted.row) {
          throw new Error("Save failed: insert/update did not return a project row");
        }
        return { id: persisted.row.id, name: persisted.row.name, action: persisted.action };
      } catch (err: any) {
        console.error("[ganttProjects.save] error:", {
          message: err?.message,
          stack: err?.stack,
          code: err?.code,
          detail: err?.detail,
          hint: err?.hint,
          where: err?.where,
        });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to save project: " + err.message });
      }
    }),

  // ── Rename ──
  rename: publicQuery
    .input(z.object({ id: z.number(), name: z.string().min(1).max(255) }))
    .mutation(async ({ input }) => {
      try {
            await db
          .update(ganttProjects)
          .set({ name: input.name, updatedAt: new Date() })
          .where(eq(ganttProjects.id, input.id));
        return { success: true };
      } catch (err: any) {
        console.error("[ganttProjects.rename] error:", err.message);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to rename project" });
      }
    }),

  // ── Delete ──
  delete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
            await db.delete(ganttProjects).where(eq(ganttProjects.id, input.id));
        return { success: true };
      } catch (err: any) {
        console.error("[ganttProjects.delete] error:", err.message);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to delete project" });
      }
    }),
};
