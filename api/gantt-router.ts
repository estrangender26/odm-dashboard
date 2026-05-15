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
        status: z.string().nullable().optional(),
        remarks: z.string().nullable().optional(),
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
        notes: input.notes || input.remarks || null,
        status: input.status || null,
        updatedAt: now,
      };
      if (input.id) {
        await db.update(ganttTasks).set(setData).where(eq(ganttTasks.id, input.id));
        return { id: input.id, action: "updated" };
      } else {
        const result = await db.insert(ganttTasks).values(setData).returning({ id: ganttTasks.id });
        return { id: result[0].id, action: "created" };
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
        }).returning({ id: ganttLinks.id });
        return { id: result[0].id, action: "created" };
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

  // Migrate: add missing columns
  migrate: publicQuery.query(async () => {
    await db.execute(sql.raw(`
      ALTER TABLE gantt_tasks 
      ADD COLUMN IF NOT EXISTS planned_start VARCHAR(20),
      ADD COLUMN IF NOT EXISTS planned_end VARCHAR(20),
      ADD COLUMN IF NOT EXISTS category VARCHAR(100),
      ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS status VARCHAR(50)
    `));
    return { success: true };
  }),

  // Seed demo data if empty (or if existing data has invalid dates)
  seed: publicQuery.mutation(async () => {
    // Ensure all columns exist
    await db.execute(sql.raw(`
      ALTER TABLE gantt_tasks 
      ADD COLUMN IF NOT EXISTS planned_start VARCHAR(20),
      ADD COLUMN IF NOT EXISTS planned_end VARCHAR(20),
      ADD COLUMN IF NOT EXISTS category VARCHAR(100),
      ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS status VARCHAR(50)
    `));

    const existing = await db.select().from(ganttTasks);
    // Check if any existing data has invalid dates — if so, clear and re-seed
    const hasInvalid = existing.some((t: any) => {
      const sd = t.startDate || "";
      const ed = t.endDate || "";
      // Check for obviously invalid dates like "2026-10-33"
      if (sd && !/^\d{4}-\d{2}-\d{2}/.test(sd)) return true;
      if (ed && !/^\d{4}-\d{2}-\d{2}/.test(ed)) return true;
      // Check day/month validity
      const checkDate = (d: string) => {
        if (!d) return true;
        const dt = new Date(d.replace(" ", "T"));
        if (isNaN(dt.getTime())) return false;
        const parts = d.slice(0, 10).split("-");
        return dt.getFullYear() === parseInt(parts[0]) && dt.getMonth() === parseInt(parts[1]) - 1 && dt.getDate() === parseInt(parts[2]);
      };
      return !checkDate(sd) || !checkDate(ed);
    });
    if (existing.length > 0 && !hasInvalid) return { seeded: false, reason: "Tasks already exist" };
    if (hasInvalid) {
      await db.delete(ganttLinks);
      await db.delete(ganttTasks);
    }

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

    // Complete demo tasks with BOTH planned AND actual dates
    const demoTasks = [
      {
        text: "S/4HANA MM Integration",
        owner: "PMO",
        type: "project", parent: 0, progress: 15, duration: 180,
        plannedStart: fmt(now),
        plannedEnd: fmt(addDays(now, 180)),
        actualStart: fmt(now),
        actualEnd: fmt(addDays(now, 170)),
        status: "In Progress",
      },
      {
        text: "Gap Analysis & Blueprint",
        owner: "Business Analyst",
        type: "task", parent: 1, progress: 80, duration: 30,
        plannedStart: fmt(now),
        plannedEnd: fmt(addDays(now, 30)),
        actualStart: fmt(now),
        actualEnd: fmt(addDays(now, 33)),
        status: "Completed",
      },
      {
        text: "System Configuration",
        owner: "Basis Team",
        type: "task", parent: 1, progress: 40, duration: 45,
        plannedStart: fmt(addDays(now, 35)),
        plannedEnd: fmt(addDays(now, 80)),
        actualStart: fmt(addDays(now, 35)),
        actualEnd: fmt(addDays(now, 82)),
        status: "In Progress (Delayed)",
      },
      {
        text: "Data Migration",
        owner: "Data Team",
        type: "task", parent: 1, progress: 10, duration: 60,
        plannedStart: fmt(addDays(now, 75)),
        plannedEnd: fmt(addDays(now, 135)),
        actualStart: fmt(addDays(now, 83)),
        actualEnd: null,
        status: "In Progress",
      },
      {
        text: "Unit Testing",
        owner: "QA Team",
        type: "task", parent: 1, progress: 0, duration: 30,
        plannedStart: fmt(addDays(now, 120)),
        plannedEnd: fmt(addDays(now, 150)),
        actualStart: null,
        actualEnd: null,
        status: "Not Started",
      },
      {
        text: "UAT & Sign-off",
        owner: "Business Lead",
        type: "milestone", parent: 1, progress: 0, duration: 20,
        plannedStart: fmt(addDays(now, 150)),
        plannedEnd: fmt(addDays(now, 170)),
        actualStart: null,
        actualEnd: null,
        status: "Not Started",
      },
      {
        text: "Go-Live Preparation",
        owner: "Cutover Team",
        type: "task", parent: 1, progress: 0, duration: 15,
        plannedStart: fmt(addDays(now, 170)),
        plannedEnd: fmt(addDays(now, 185)),
        actualStart: null,
        actualEnd: null,
        status: "Not Started",
      },
    ];

    for (const t of demoTasks) {
      const end = t.actualEnd ? t.actualEnd : (t.actualStart ? fmt(addDays(new Date(t.actualStart.replace("T", "T") + "T12:00:00"), t.duration)) : null);
      const start = t.actualStart ? t.actualStart + " 08:00" : null;
      await db.insert(ganttTasks).values({
        text: t.text,
        startDate: start,
        endDate: end ? end + " 08:00" : null,
        plannedStart: t.plannedStart,
        plannedEnd: t.plannedEnd,
        duration: t.duration,
        progress: t.progress,
        parent: t.parent,
        type: t.type,
        owner: t.owner,
        status: t.status,
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
