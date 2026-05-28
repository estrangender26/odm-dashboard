import { z } from "zod";
import { and, eq, desc, sql, isNull } from "drizzle-orm";
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
  if (userId) return and(eq(ganttProjects.userId, userId), eq(ganttProjects.sessionId, sessionId));
  return and(eq(ganttProjects.sessionId, sessionId), isNull(ganttProjects.userId));
}

function getDbFingerprint() {
  try {
    return getConnectionFingerprint(getNormalizedDatabaseUrl());
  } catch {
    return "invalid DATABASE_URL";
  }
}


async function ensureGanttProjectsSchema() {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS gantt_projects (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      project_name VARCHAR(255),
      start_date VARCHAR(20),
      finish_date VARCHAR(20),
      status VARCHAR(50),
      tasks_data TEXT NOT NULL DEFAULT '[]',
      links_data TEXT,
      description TEXT,
      created_by VARCHAR(255),
      updated_by VARCHAR(255),
      user_id INTEGER,
      owner_id INTEGER,
      tenant_id VARCHAR(255),
      org_id VARCHAR(255),
      session_id VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `));

  const alterStatements = [
    `ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS project_name VARCHAR(255)`,
    `ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS start_date VARCHAR(20)`,
    `ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS finish_date VARCHAR(20)`,
    `ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS status VARCHAR(50)`,
    `ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS tasks_data TEXT`,
    `ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS links_data TEXT`,
    `ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS description TEXT`,
    `ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS created_by VARCHAR(255)`,
    `ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255)`,
    `ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS user_id INTEGER`,
    `ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS owner_id INTEGER`,
    `ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(255)`,
    `ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS org_id VARCHAR(255)`,
    `ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS session_id VARCHAR(255)`,
    `ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
    `ALTER TABLE gantt_projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
  ];

  for (const statement of alterStatements) {
    await db.execute(sql.raw(statement));
  }

  await db.execute(sql.raw(`ALTER TABLE gantt_projects ALTER COLUMN tasks_data SET DEFAULT '[]'`));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS gantt_projects_name_idx ON gantt_projects(name)`));
  console.log('[ganttProjects.schema] ensured columns for gantt_projects');
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

    await ensureGanttProjectsSchema();

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
      await ensureGanttProjectsSchema();
      const userId = ctx.user?.id;
      const sessionId = getOrCreateAnonSession(ctx.req, ctx.resHeaders);
      const visibilityFilter = buildVisibilityFilter(userId, sessionId);
      const dbInfo = await db.execute(sql.raw(`SELECT current_schema() AS schema, current_database() AS database`));
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
      console.log("[ganttProjects.list] filters", {
        databaseUrlFingerprint: getDbFingerprint(),
        currentSchema: dbInfo.rows?.[0]?.schema ?? null,
        currentDatabase: dbInfo.rows?.[0]?.database ?? null,
        userId: userId ?? null,
        sessionId,
        rowsFound: rows.length,
        projectIds: rows.map((r) => r.id),
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
        await ensureGanttProjectsSchema();
        const userId = ctx.user?.id;
        const sessionId = getOrCreateAnonSession(ctx.req, ctx.resHeaders);
        const visibilityFilter = buildVisibilityFilter(userId, sessionId);
        console.log("[ganttProjects.get] identity", { userId: userId ?? null, sessionId, id: input.id });
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

        const row = rows[0];
        const safeTasksData = row.tasksData && row.tasksData.trim().length > 0 ? row.tasksData : "[]";
        const safeLinksData = row.linksData && row.linksData.trim().length > 0 ? row.linksData : "[]";

        console.log("[ganttProjects.get] success", {
          projectId: row.id,
          projectName: row.name,
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
      await ensureGanttProjectsSchema();
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
        const dbInfo = await db.execute(sql.raw(`SELECT current_schema() AS schema, current_database() AS database`));
        console.log("[ganttProjects.save] db_context", {
          databaseUrlFingerprint: getDbFingerprint(),
          currentSchema: dbInfo.rows?.[0]?.schema ?? null,
          currentDatabase: dbInfo.rows?.[0]?.database ?? null,
        });
        // Schema is ensured at the start of this mutation.

        const persisted = await db.transaction(async (tx) => {
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
          console.log("[ganttProjects.save] insert result", { rowCount: created.length, id: created[0]?.id ?? null });
          return { row: created[0], action: "created" as const };
        });

        const verifyRows = await db.execute(sql`
          SELECT id, name, session_id, user_id, created_at
          FROM gantt_projects
          WHERE id = ${persisted.row.id}
        `);
        const persistedCount = verifyRows.rows?.length ?? 0;
        const totalRows = await db.execute(sql.raw(`SELECT COUNT(*)::int AS count FROM gantt_projects`));
        console.log("[ganttProjects.save] verify", {
          action: persisted.action,
          returnedId: persisted.row.id,
          userId: persisted.row.userId ?? null,
          ownerId: persisted.row.ownerId ?? null,
          tenantId: persisted.row.tenantId ?? null,
          orgId: persisted.row.orgId ?? null,
          sessionId: persisted.row.sessionId ?? null,
          insertedRow: verifyRows.rows?.[0] ?? null,
          verifyCount: persistedCount,
          totalRows: totalRows.rows?.[0]?.count ?? null,
        });
        await new Promise((resolve) => setTimeout(resolve, 200));
        const delayedVerify = await db.execute(sql`
          SELECT id, name, session_id, user_id, created_at
          FROM gantt_projects
          WHERE id = ${persisted.row.id}
        `);
        console.log("[ganttProjects.save] verify_delayed", {
          returnedId: persisted.row.id,
          delayedVerifyCount: delayedVerify.rows?.length ?? 0,
          delayedRow: delayedVerify.rows?.[0] ?? null,
        });
        if (persistedCount !== 1) {
          throw new Error(`Persistence verification failed for project id ${persisted.row.id}`);
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
        await ensureGanttProjectsSchema();
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
        await ensureGanttProjectsSchema();
        await db.delete(ganttProjects).where(eq(ganttProjects.id, input.id));
        return { success: true };
      } catch (err: any) {
        console.error("[ganttProjects.delete] error:", err.message);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to delete project" });
      }
    }),
};
