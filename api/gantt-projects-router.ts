import { z } from "zod";
import { eq, desc } from "drizzle-orm";
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
        tasksData: z.string(), // JSON string
        linksData: z.string().optional().nullable(),
        description: z.string().optional(),
        createdBy: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        if (input.id) {
          // Update
          const result = await db
            .update(ganttProjects)
            .set({
              name: input.name,
              tasksData: input.tasksData,
              linksData: input.linksData ?? null,
              description: input.description ?? null,
              updatedBy: input.createdBy ?? null,
              updatedAt: new Date(),
            })
            .where(eq(ganttProjects.id, input.id))
            .returning();
          return { id: result[0].id, name: result[0].name, action: "updated" };
        } else {
          // Create
          const result = await db
            .insert(ganttProjects)
            .values({
              name: input.name,
              tasksData: input.tasksData,
              linksData: input.linksData ?? null,
              description: input.description ?? null,
              createdBy: input.createdBy ?? null,
            })
            .returning();
          return { id: result[0].id, name: result[0].name, action: "created" };
        }
      } catch (err: any) {
        console.error("[ganttProjects.save] error:", err.message);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to save project" });
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
