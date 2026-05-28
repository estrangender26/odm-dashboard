import { z } from "zod";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "./queries/connection";
import { ganttProjects } from "@db/schema";
import { publicQuery } from "./middleware";
import { TRPCError } from "@trpc/server";

export const ganttProjectsRouter = {
  // ── List all projects (name + id + dates only, no tasks_data) ──
  list: publicQuery.query(async () => {
    try {
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
        .orderBy(desc(ganttProjects.updatedAt));
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
    .mutation(async ({ input }) => {
      try {
        const rows = await db
          .select()
          .from(ganttProjects)
          .where(eq(ganttProjects.id, input.id));
        if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        return rows[0];
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
    .mutation(async ({ input }) => {
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
        id: input.id ?? null,
        name: input.name,
        tasksBytes: Buffer.byteLength(input.tasksData || "[]", "utf8"),
        linksBytes: Buffer.byteLength(input.linksData || "", "utf8"),
        payloadBytes: payloadSize,
      });
      try {
        /* Ensure gantt_projects table exists (auto-create if missing) */
        try {
          await db.execute(sql.raw(`SELECT 1 FROM gantt_projects LIMIT 1`));
        } catch {
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
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          `));
          await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS gantt_projects_name_idx ON gantt_projects(name)`));
        }

        const persisted = await db.transaction(async (tx) => {
          if (input.id) {
            const updated = await tx
              .update(ganttProjects)
              .set({
                name: input.name,
                tasksData: input.tasksData || "[]",
                linksData: input.linksData ?? null,
                description: input.description ?? null,
                updatedBy: input.createdBy ?? null,
                updatedAt: new Date(),
              })
              .where(eq(ganttProjects.id, input.id))
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
            })
            .returning();
          console.log("[ganttProjects.save] insert result", { rowCount: created.length, id: created[0]?.id ?? null });
          return { row: created[0], action: "created" as const };
        });

        const verifyRows = await db
          .select({ id: ganttProjects.id, name: ganttProjects.name })
          .from(ganttProjects)
          .where(eq(ganttProjects.id, persisted.row.id));
        const persistedCount = verifyRows.length;
        const totalRows = await db.execute(sql.raw(`SELECT COUNT(*)::int AS count FROM gantt_projects`));
        console.log("[ganttProjects.save] verify", {
          action: persisted.action,
          returnedId: persisted.row.id,
          verifyCount: persistedCount,
          totalRows: totalRows.rows?.[0]?.count ?? null,
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
