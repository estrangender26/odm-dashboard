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

  // Migrate: add planned columns
  migrate: publicQuery.query(async () => {
    await db.execute(sql.raw(`
      ALTER TABLE gantt_tasks 
      ADD COLUMN IF NOT EXISTS planned_start VARCHAR(20),
      ADD COLUMN IF NOT EXISTS planned_end VARCHAR(20),
      ADD COLUMN IF NOT EXISTS category VARCHAR(100),
      ADD COLUMN IF NOT EXISTS notes TEXT
    `));
    return { success: true };
  }),

  // Seed demo data if empty
  seed: publicQuery.mutation(async () => {
    const existing = await db.select({ count: sql<number>`count(*)` }).from(ganttTasks);
    if (existing[0].count > 0) return { seeded: false, reason: "Tasks already exist" };

    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const baseDate = `${y}-${m}-${d}`;

    const demoTasks = [
      { text: "S/4HANA MM Integration", start_date: `${y}-${m}-${d} 08:00`, duration: 180, progress: 15, parent: 0, type: "project", owner: "PMO", sortorder: 0, planned_start: `${y}-${m}-${d}`, planned_end: `${y}-${String(parseInt(m)+6).padStart(2,"0")}-${d}` },
      { text: "Gap Analysis & Blueprint", start_date: `${y}-${m}-${d} 08:00`, duration: 30, progress: 80, parent: 1, type: "task", owner: "Business Analyst", sortorder: 1, planned_start: `${y}-${m}-${d}`, planned_end: `${y}-${m}-${String(parseInt(d)+30).padStart(2,"0")}` },
      { text: "System Configuration", start_date: `${y}-${String(parseInt(m)+1).padStart(2,"0")}-${d} 08:00`, duration: 45, progress: 40, parent: 1, type: "task", owner: "Basis Team", sortorder: 2, planned_start: `${y}-${String(parseInt(m)+1).padStart(2,"0")}-${d}`, planned_end: `${y}-${String(parseInt(m)+2).padStart(2,"0")}-${String(parseInt(d)+15).padStart(2,"0")}` },
      { text: "Data Migration", start_date: `${y}-${String(parseInt(m)+2).padStart(2,"0")}-${String(parseInt(d)+15).padStart(2,"0")} 08:00`, duration: 60, progress: 10, parent: 1, type: "task", owner: "Data Team", sortorder: 3, planned_start: `${y}-${String(parseInt(m)+2).padStart(2,"0")}-${String(parseInt(d)+15).padStart(2,"0")}`, planned_end: `${y}-${String(parseInt(m)+4).padStart(2,"0")}-${d}` },
      { text: "Unit Testing", start_date: `${y}-${String(parseInt(m)+4).padStart(2,"0")}-${d} 08:00`, duration: 30, progress: 0, parent: 1, type: "task", owner: "QA Team", sortorder: 4, planned_start: `${y}-${String(parseInt(m)+4).padStart(2,"0")}-${d}`, planned_end: `${y}-${String(parseInt(m)+5).padStart(2,"0")}-${d}` },
      { text: "UAT & Sign-off", start_date: `${y}-${String(parseInt(m)+5).padStart(2,"0")}-${d} 08:00`, duration: 20, progress: 0, parent: 1, type: "milestone", owner: "Business Lead", sortorder: 5, planned_start: `${y}-${String(parseInt(m)+5).padStart(2,"0")}-${d}`, planned_end: `${y}-${String(parseInt(m)+5).padStart(2,"0")}-${String(parseInt(d)+20).padStart(2,"0")}` },
      { text: "Go-Live Preparation", start_date: `${y}-${String(parseInt(m)+5).padStart(2,"0")}-${String(parseInt(d)+20).padStart(2,"0")} 08:00`, duration: 15, progress: 0, parent: 1, type: "task", owner: "Cutover Team", sortorder: 6, planned_start: `${y}-${String(parseInt(m)+5).padStart(2,"0")}-${String(parseInt(d)+20).padStart(2,"0")}`, planned_end: `${y}-${String(parseInt(m)+6).padStart(2,"0")}-${d}` },
    ];

    for (const t of demoTasks) {
      const end = new Date(new Date(t.start_date).getTime() + (t.duration * 864e5));
      const endStr = `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,"0")}-${String(end.getDate()).padStart(2,"0")} 08:00`;
      await db.insert(ganttTasks).values({
        text: t.text,
        startDate: t.start_date,
        endDate: endStr,
        plannedStart: t.planned_start,
        plannedEnd: t.planned_end,
        duration: t.duration,
        progress: t.progress,
        parent: t.parent,
        type: t.type,
        owner: t.owner,
        sortorder: t.sortorder,
        open: 1,
      });
    }

    // Add a link
    const allTasks = await db.select().from(ganttTasks).orderBy(ganttTasks.id);
    if (allTasks.length >= 3) {
      await db.insert(ganttLinks).values({
        source: allTasks[1].id,
        target: allTasks[2].id,
        type: "0",
      });
      await db.insert(ganttLinks).values({
        source: allTasks[2].id,
        target: allTasks[3].id,
        type: "0",
      });
    }

    return { seeded: true, count: demoTasks.length };
  }),
});
