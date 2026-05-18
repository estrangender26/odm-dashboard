import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { db } from "./queries/connection";
import { ganttTasks, ganttDependencies } from "@db/schema";
import { eq, sql, and } from "drizzle-orm";

export const ganttRouter = createRouter({
  // ── Get all tasks ──
  tasks: publicQuery.query(async () => {
    const tasks = await db.select().from(ganttTasks).orderBy(ganttTasks.id);
    return tasks;
  }),

  // ── Get all dependencies (optionally filtered by project_id)
  // Returns frontend-compatible shape: {id, source, target, type, lag, projectId}
  links: publicQuery
    .input(z.object({ projectId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      let rows;
      if (input?.projectId) {
        rows = await db.select().from(ganttDependencies)
          .where(eq(ganttDependencies.projectId, input.projectId));
      } else {
        rows = await db.select().from(ganttDependencies);
      }
      // Map DB columns → frontend shape (source/target/type/lag)
      const typeReverse: Record<string, string> = { "FS": "0", "SS": "1", "FF": "2", "SF": "3" };
      return rows.map(r => ({
        id: r.id,
        source: r.predecessorTaskId,
        target: r.successorTaskId,
        type: typeReverse[r.dependencyType] || r.dependencyType || "0",
        lag: r.lagDays ?? 0,
        projectId: r.projectId,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    }),

  // ── Create/update task ──
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
        wbs_level: z.number().default(0),
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
      let setData: any = {
        text: input.text,
        startDate: input.start_date || null,
        endDate: input.end_date || null,
        plannedStart: input.planned_start || null,
        plannedEnd: input.planned_end || null,
        duration: input.duration,
        progress: input.progress,
        parent: input.parent,
        type: input.type,
        wbsLevel: input.wbs_level ?? 0,
        sortorder: input.sortorder,
        owner: input.owner,
        open: input.open,
        category: input.category || null,
        notes: input.notes || null,
        status: input.status || null,
        remarks: input.remarks || null,
        updatedAt: now,
      };
      try {
        if (input.id) {
          await db.update(ganttTasks).set(setData).where(eq(ganttTasks.id, input.id));
          return { id: input.id, action: "updated" };
        } else {
          const result = await db.insert(ganttTasks).values(setData).returning({ id: ganttTasks.id });
          return { id: result[0].id, action: "created" };
        }
      } catch (e: any) {
        /* Retry removing only the specific column that failed */
        const msg = e.message || "";
        if (msg.includes("wbs_level") || msg.includes("wbsLevel")) delete setData.wbsLevel;
        else if (msg.includes("status")) delete setData.status;
        else if (msg.includes("remarks")) delete setData.remarks;
        else if (msg.includes("parent")) delete setData.parent;
        else if (msg.includes("category")) delete setData.category;
        else if (msg.includes("notes")) delete setData.notes;
        else if (msg.includes("planned_start")) delete setData.plannedStart;
        else if (msg.includes("planned_end")) delete setData.plannedEnd;
        else if (msg.includes("wbs_level") || msg.includes("wbsLevel") || msg.includes("status") || msg.includes("remarks") || msg.includes("parent")) {
          /* Fallback: if any optional column mentioned, try removing all */
          delete setData.wbsLevel; delete setData.status; delete setData.remarks; delete setData.parent;
        }
        if (Object.keys(setData).length > 5) {
          if (input.id) {
            await db.update(ganttTasks).set(setData).where(eq(ganttTasks.id, input.id));
            return { id: input.id, action: "updated" };
          } else {
            const result = await db.insert(ganttTasks).values(setData).returning({ id: ganttTasks.id });
            return { id: result[0].id, action: "created" };
          }
        }
        throw e;
      }
    }),

  // ── Delete task (also delete its dependency records) ──
  deleteTask: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      // Delete task
      await db.delete(ganttTasks).where(eq(ganttTasks.id, input.id));
      // Delete any dependencies where this task is predecessor OR successor
      await db.delete(ganttDependencies)
        .where(eq(ganttDependencies.predecessorTaskId, input.id));
      await db.delete(ganttDependencies)
        .where(eq(ganttDependencies.successorTaskId, input.id));
      return { success: true };
    }),

  // ── Save dependency ──
  saveLink: publicQuery
    .input(
      z.object({
        id: z.number().optional(),
        source: z.number(),
        target: z.number(),
        type: z.string().default("FS"),
        lag: z.number().default(0),
        projectId: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const depType = input.type;
      // Normalize type: "0"→"FS", "1"→"SS", "2"→"FF", "3"→"SF"
      const typeMap: Record<string, string> = { "0": "FS", "1": "SS", "2": "FF", "3": "SF" };
      const normalizedType = typeMap[depType] || depType || "FS";

      const setData = {
        predecessorTaskId: input.source,
        successorTaskId: input.target,
        dependencyType: normalizedType,
        lagDays: input.lag,
        projectId: input.projectId ?? null,
        updatedAt: new Date(),
      };

      if (input.id) {
        await db.update(ganttDependencies).set(setData)
          .where(eq(ganttDependencies.id, input.id));
        return { id: input.id, action: "updated" };
      } else {
        const result = await db.insert(ganttDependencies).values(setData)
          .returning({ id: ganttDependencies.id });
        return { id: result[0].id, action: "created" };
      }
    }),

  // ── Delete dependency ──
  deleteLink: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(ganttDependencies).where(eq(ganttDependencies.id, input.id));
      return { success: true };
    }),

  // ── Batch save dependencies (used when opening a project) ──
  saveLinksBatch: publicQuery
    .input(z.array(z.object({
      source: z.number(),
      target: z.number(),
      type: z.string(),
      lag: z.number().default(0),
      projectId: z.number().optional(),
    })))
    .mutation(async ({ input }) => {
      const typeMap: Record<string, string> = { "0": "FS", "1": "SS", "2": "FF", "3": "SF" };
      for (const dep of input) {
        const normalizedType = typeMap[dep.type] || dep.type || "FS";
        await db.insert(ganttDependencies).values({
          predecessorTaskId: dep.source,
          successorTaskId: dep.target,
          dependencyType: normalizedType,
          lagDays: dep.lag,
          projectId: dep.projectId ?? null,
          updatedAt: new Date(),
        });
      }
      return { count: input.length };
    }),

  // ── Reset all (delete everything) ──
  resetAll: publicQuery.mutation(async () => {
    await db.delete(ganttDependencies);
    await db.delete(ganttTasks);
    return { success: true };
  }),

  // ── Migrate: create gantt_dependencies table, migrate from gantt_links ──
  migrate: publicQuery.query(async () => {
    // Create gantt_dependencies table if it doesn't exist
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS gantt_dependencies (
        id SERIAL PRIMARY KEY,
        project_id INTEGER,
        predecessor_task_id INTEGER NOT NULL,
        successor_task_id INTEGER NOT NULL,
        dependency_type VARCHAR(10) NOT NULL DEFAULT 'FS',
        lag_days INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `));

    // Migrate data from old gantt_links table
    await db.execute(sql.raw(`
      INSERT INTO gantt_dependencies (predecessor_task_id, successor_task_id, dependency_type, lag_days, created_at)
      SELECT source, target,
        CASE type WHEN '0' THEN 'FS' WHEN '1' THEN 'SS' WHEN '2' THEN 'FF' WHEN '3' THEN 'SF' ELSE 'FS' END,
        COALESCE(lag_days, 0), created_at
      FROM gantt_links
      WHERE NOT EXISTS (SELECT 1 FROM gantt_dependencies WHERE predecessor_task_id = gantt_links.source AND successor_task_id = gantt_links.target)
    `));

    // Ensure status/remarks columns exist on gantt_tasks
    await db.execute(sql.raw(`
      ALTER TABLE gantt_tasks
      ADD COLUMN IF NOT EXISTS status VARCHAR(50),
      ADD COLUMN IF NOT EXISTS remarks TEXT
    `));

    return { success: true };
  }),

  // ── Seed demo data ──
  seed: publicQuery.mutation(async () => {
    // Ensure all columns exist
    await db.execute(sql.raw(`
      ALTER TABLE gantt_tasks
      ADD COLUMN IF NOT EXISTS planned_start VARCHAR(20),
      ADD COLUMN IF NOT EXISTS planned_end VARCHAR(20),
      ADD COLUMN IF NOT EXISTS category VARCHAR(100),
      ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS status VARCHAR(50),
      ADD COLUMN IF NOT EXISTS remarks TEXT,
      ADD COLUMN IF NOT EXISTS wbs_level INTEGER DEFAULT 0
    `));

    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS gantt_dependencies (
        id SERIAL PRIMARY KEY,
        project_id INTEGER,
        predecessor_task_id INTEGER NOT NULL,
        successor_task_id INTEGER NOT NULL,
        dependency_type VARCHAR(10) NOT NULL DEFAULT 'FS',
        lag_days INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `));

    const existing = await db.select().from(ganttTasks);
    const hasInvalid = existing.some((t: any) => {
      const sd = t.startDate || "";
      const ed = t.endDate || "";
      if (sd && !/^\d{4}-\d{2}-\d{2}/.test(sd)) return true;
      if (ed && !/^\d{4}-\d{2}-\d{2}/.test(ed)) return true;
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
      await db.delete(ganttDependencies);
      await db.delete(ganttTasks);
    }

    const fmt = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
    const addDays = (dt: Date, days: number) => {
      const r = new Date(dt);
      r.setDate(r.getDate() + days);
      return r;
    };

    const now = new Date();

    /* Insert root project first, capture its real DB ID */
    const rootResult = await db.insert(ganttTasks).values({
      text: "S/4HANA MM Integration", startDate: fmt(now) + " 08:00", endDate: fmt(addDays(now,170)) + " 08:00",
      plannedStart: fmt(now), plannedEnd: fmt(addDays(now,180)),
      duration: 180, progress: 15, parent: 0, type: "project",
      wbsLevel: 1,
      owner: "PMO", status: "In Progress", sortorder: 0, open: 1,
    }).returning({ id: ganttTasks.id });
    const rootId = rootResult[0].id;

    const childTasks = [
      { text: "Gap Analysis & Blueprint", owner: "Business Analyst", type: "task", wbsLevel: 2, progress: 80, duration: 30, plannedStart: fmt(now), plannedEnd: fmt(addDays(now,30)), actualStart: fmt(now), actualEnd: fmt(addDays(now,33)), status: "Completed" },
      { text: "System Configuration", owner: "Basis Team", type: "task", wbsLevel: 2, progress: 40, duration: 45, plannedStart: fmt(addDays(now,35)), plannedEnd: fmt(addDays(now,80)), actualStart: fmt(addDays(now,35)), actualEnd: fmt(addDays(now,82)), status: "In Progress (Delayed)" },
      { text: "Data Migration", owner: "Data Team", type: "task", wbsLevel: 2, progress: 10, duration: 60, plannedStart: fmt(addDays(now,75)), plannedEnd: fmt(addDays(now,135)), actualStart: fmt(addDays(now,83)), actualEnd: null, status: "In Progress" },
      { text: "Unit Testing", owner: "QA Team", type: "task", wbsLevel: 2, progress: 0, duration: 30, plannedStart: fmt(addDays(now,120)), plannedEnd: fmt(addDays(now,150)), actualStart: null, actualEnd: null, status: "Not Started" },
      { text: "UAT & Sign-off", owner: "Business Lead", type: "milestone", wbsLevel: 2, progress: 0, duration: 20, plannedStart: fmt(addDays(now,150)), plannedEnd: fmt(addDays(now,170)), actualStart: null, actualEnd: null, status: "Not Started" },
      { text: "Go-Live Preparation", owner: "Cutover Team", type: "task", wbsLevel: 2, progress: 0, duration: 15, plannedStart: fmt(addDays(now,170)), plannedEnd: fmt(addDays(now,185)), actualStart: null, actualEnd: null, status: "Not Started" },
    ];

    for (const t of childTasks) {
      const end = t.actualEnd ? t.actualEnd : (t.actualStart ? fmt(addDays(new Date(t.actualStart + "T12:00:00"), t.duration)) : null);
      const start = t.actualStart ? t.actualStart + " 08:00" : null;
      await db.insert(ganttTasks).values({
        text: t.text, startDate: start, endDate: end ? end + " 08:00" : null,
        plannedStart: t.plannedStart, plannedEnd: t.plannedEnd,
        duration: t.duration, progress: t.progress, parent: rootId, type: t.type,
        wbsLevel: t.wbsLevel,
        owner: t.owner, status: t.status, sortorder: 0, open: 1,
      });
    }

    const allTasks = await db.select().from(ganttTasks).orderBy(ganttTasks.id);
    if (allTasks.length >= 4) {
      await db.insert(ganttDependencies).values({
        predecessorTaskId: allTasks[1].id, successorTaskId: allTasks[2].id, dependencyType: "FS", lagDays: 0
      });
      await db.insert(ganttDependencies).values({
        predecessorTaskId: allTasks[2].id, successorTaskId: allTasks[3].id, dependencyType: "FS", lagDays: 0
      });
    }
    return { seeded: true, count: 1 + childTasks.length };
  }),
});
