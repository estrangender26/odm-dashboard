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

    // Helper: format Date → "YYYY-MM-DD"
    const fmt = (dt: Date) => {
      return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
    };
    // Helper: format Date → "YYYY-MM-DD HH:mm"
    const fmtFull = (dt: Date) => fmt(dt) + " 08:00";
    // Helper: add days to a date
    const addDays = (dt: Date, days: number) => {
      const r = new Date(dt);
      r.setDate(r.getDate() + days);
      return r;
    };

    const now = new Date();
    const s0 = now;                           // project start
    const s1 = now;                           // Gap Analysis
    const s2 = addDays(now, 35);              // System Config
    const s3 = addDays(now, 75);              // Data Migration
    const s4 = addDays(now, 120);             // Unit Testing
    const s5 = addDays(now, 150);             // UAT
    const s6 = addDays(now, 170);             // Go-Live

    const demoTasks = [
      { text: "S/4HANA MM Integration",  start: s0, duration: 180, progress: 15, parent: 0, type: "project",   owner: "PMO",              ps: s0, pe: addDays(s0, 180) },
      { text: "Gap Analysis & Blueprint", start: s1, duration: 30,  progress: 80, parent: 1, type: "task",      owner: "Business Analyst", ps: s1, pe: addDays(s1, 30) },
      { text: "System Configuration",     start: s2, duration: 45,  progress: 40, parent: 1, type: "task",      owner: "Basis Team",       ps: s2, pe: addDays(s2, 45) },
      { text: "Data Migration",           start: s3, duration: 60,  progress: 10, parent: 1, type: "task",      owner: "Data Team",        ps: s3, pe: addDays(s3, 60) },
      { text: "Unit Testing",             start: s4, duration: 30,  progress: 0,  parent: 1, type: "task",      owner: "QA Team",          ps: s4, pe: addDays(s4, 30) },
      { text: "UAT & Sign-off",           start: s5, duration: 20,  progress: 0,  parent: 1, type: "milestone", owner: "Business Lead",    ps: s5, pe: addDays(s5, 20) },
      { text: "Go-Live Preparation",      start: s6, duration: 15,  progress: 0,  parent: 1, type: "task",      owner: "Cutover Team",     ps: s6, pe: addDays(s6, 15) },
    ];

    for (const t of demoTasks) {
      const end = addDays(t.start, t.duration);
      await db.insert(ganttTasks).values({
        text: t.text,
        startDate: fmtFull(t.start),
        endDate: fmtFull(end),
        plannedStart: fmt(t.ps),
        plannedEnd: fmt(t.pe),
        duration: t.duration,
        progress: t.progress,
        parent: t.parent,
        type: t.type,
        owner: t.owner,
        sortorder: 0,
        open: 1,
      });
    }

    // Add dependency links
    const allTasks = await db.select().from(ganttTasks).orderBy(ganttTasks.id);
    if (allTasks.length >= 4) {
      await db.insert(ganttLinks).values({ source: allTasks[1].id, target: allTasks[2].id, type: "0" });
      await db.insert(ganttLinks).values({ source: allTasks[2].id, target: allTasks[3].id, type: "0" });
    }

    return { seeded: true, count: demoTasks.length };
  }),
});
