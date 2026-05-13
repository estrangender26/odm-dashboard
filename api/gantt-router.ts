import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { db } from "./queries/connection";
import { ganttTasks, ganttLinks } from "@db/schema";
import { eq, sql } from "drizzle-orm";

export const ganttRouter = createRouter({
  // Get all tasks
  tasks: publicQuery.query(async () => {
    const tasks = await db.select().from(ganttTasks).orderBy(ganttTasks.id);
    return tasks;
  }),

  // Get all links
  links: publicQuery.query(async () => {
    const links = await db.select().from(ganttLinks);
    return links;
  }),

  // Create/update task
  saveTask: publicQuery
    .input(
      z.object({
        id: z.number().optional(),
        text: z.string(),
        start_date: z.string().nullable().optional(),
        end_date: z.string().nullable().optional(),
        planned_start: z.string().nullable().optional(),
        planned_end: z.string().nullable().optional(),
        duration: z.number().nullable().optional(),
        progress: z.number().default(0),
        parent: z.number().default(0),
        type: z.string().default("task"),
        sortorder: z.number().default(0),
        owner: z.string().nullable().optional(),
        open: z.number().default(1),
        category: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const now = new Date();
      const setData: any = {
        text: input.text,
        startDate: input.start_date || null,
        endDate: input.end_date || null,
        plannedStart: input.planned_start || null,
        plannedEnd: input.planned_end || null,
        duration: input.duration,
        progress: input.progress,
        parent: input.parent,
        type: input.type,
        sortorder: input.sortorder,
        owner: input.owner,
        open: input.open,
        category: input.category || null,
        notes: input.notes || null,
        updatedAt: now,
      };
      if (input.id) {
        await db.update(ganttTasks).set(setData).where(eq(ganttTasks.id, input.id));
        return { id: input.id, action: "updated" };
      } else {
        const result = await db.insert(ganttTasks).values(setData);
        return { id: Number(result[0].insertId), action: "created" };
      }
    }),

  // Delete task
  deleteTask: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(ganttTasks).where(eq(ganttTasks.id, input.id));
      // Also delete associated links
      await db
        .delete(ganttLinks)
        .where(eq(ganttLinks.source, input.id));
      return { success: true };
    }),

  // Save link
  saveLink: publicQuery
    .input(
      z.object({
        id: z.number().optional(),
        source: z.number(),
        target: z.number(),
        type: z.string().default("0"),
      })
    )
    .mutation(async ({ input }) => {
      if (input.id) {
        await db
          .update(ganttLinks)
          .set({ source: input.source, target: input.target, type: input.type })
          .where(eq(ganttLinks.id, input.id));
        return { id: input.id, action: "updated" };
      } else {
        const result = await db.insert(ganttLinks).values({
          source: input.source,
          target: input.target,
          type: input.type,
        });
        return { id: Number(result[0].insertId), action: "created" };
      }
    }),

  // Delete link
  deleteLink: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(ganttLinks).where(eq(ganttLinks.id, input.id));
      return { success: true };
    }),

  // Reset all (delete everything)
  resetAll: publicQuery.mutation(async () => {
    await db.delete(ganttLinks);
    await db.delete(ganttTasks);
    return { success: true };
  }),
});
