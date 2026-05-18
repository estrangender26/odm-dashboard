import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { db } from "./queries/connection";
import { ganttTasks, ganttDependencies } from "@db/schema";
import { eq, sql, and } from "drizzle-orm";

export const ganttRouter = createRouter({
  // ── Get all tasks (ordered by sortorder for display sequence) ──
  tasks: publicQuery.query(async () => {
    const tasks = await db.select().from(ganttTasks).orderBy(ganttTasks.sortorder, ganttTasks.id);
    return tasks;
  }),

  // ── Resolve frontend UIDs → DB IDs ──
  resolveUids: publicQuery
    .input(z.object({ uids: z.array(z.string()) }))
    .query(async ({ input }) => {
      const uidMap: Record<string, number> = {};
      for (const uid of input.uids) {
        const rows = await db.select({ id: ganttTasks.id }).from(ganttTasks).where(eq(ganttTasks.frontendTaskUid, uid));
        if (rows.length > 0) uidMap[uid] = rows[0].id;
      }
      return uidMap;
    }),

  // ── Get all dependencies ──
  links: publicQuery
    .input(z.object({ projectId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const typeReverse: Record<string, string> = { "FS": "0", "SS": "1", "FF": "2", "SF": "3" };
      let rows;
      if (input?.projectId) {
        rows = await db.select().from(ganttDependencies).where(eq(ganttDependencies.projectId, input.projectId));
      } else {
        rows = await db.select().from(ganttDependencies);
      }
      return rows.map((r: any) => ({
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

  // ── Create/update task (with frontend_task_uid support) ──
  saveTask: publicQuery
    .input(
      z.object({
        id: z.number().optional(),
        frontend_task_uid: z.string().optional(),
        text: z.string(),
        start_date: z.string().nullable().optional(),
        end_date: z.string().nullable().optional(),
        planned_start: z.string().nullable().optional(),
        planned_end: z.string().nullable().optional(),
        duration: z.number().nullable().optional(),
        progress: z.number().default(0),
        parent: z.number().default(0),
        parent_frontend_uid: z.string().nullable().optional(),
        type: z.string().default("task"),
        wbs_level: z.number().default(0),
        sortorder: z.number().default(0),
        owner: z.string().nullable().optional(),
        open: z.number().default(1),
        category: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
        remarks: z.string().nullable().optional(),
        predecessor_task_id: z.number().optional(),
        predecessor_frontend_uid: z.string().nullable().optional(),
        dependency_type: z.string().optional(),
        lag_days: z.number().default(0),
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
        parent: input.parent ?? 0,
        parentFrontendUid: input.parent_frontend_uid || null,
        type: input.type,
        wbsLevel: input.wbs_level ?? 0,
        sortorder: input.sortorder,
        owner: input.owner,
        open: input.open,
        category: input.category || null,
        notes: input.notes || null,
        status: input.status || null,
        remarks: input.remarks || null,
        predecessorTaskId: input.predecessor_task_id ?? null,
        predecessorFrontendUid: input.predecessor_frontend_uid || null,
        dependencyType: input.dependency_type || null,
        lagDays: input.lag_days ?? 0,
        updatedAt: now,
      };
      /* Preserve frontend_task_uid if provided, or look up existing */
      if (input.frontend_task_uid) {
        setData.frontendTaskUid = input.frontend_task_uid;
      }

      try {
        if (input.id) {
          const updated = await db.update(ganttTasks).set(setData).where(eq(ganttTasks.id, input.id)).returning({
            id: ganttTasks.id, frontendTaskUid: ganttTasks.frontendTaskUid
          });
          if (updated.length === 0) {
            throw new Error(`Task id=${input.id} not found — it may have been deleted.`);
          }
          return { id: input.id, frontend_task_uid: updated[0].frontendTaskUid, action: "updated" };
        } else {
          const result = await db.insert(ganttTasks).values(setData).returning({
            id: ganttTasks.id, frontendTaskUid: ganttTasks.frontendTaskUid
          });
          return { id: result[0].id, frontend_task_uid: result[0].frontendTaskUid, action: "created" };
        }
      } catch (e: any) {
        const msg = e.message || "";
        let migrated = false;

        /* Auto-migrate: add missing columns */
        const tryAddCol = async (col: string, def: string) => {
          try { await db.execute(sql.raw(`ALTER TABLE gantt_tasks ADD COLUMN IF NOT EXISTS ${col} ${def}`)); return true; } catch { return false; }
        };
        if (msg.includes("frontend_task_uid")) { try { await tryAddCol("frontend_task_uid", "VARCHAR(64) UNIQUE"); migrated = true; } catch {} }
        if (msg.includes("parent_frontend_uid")) { try { await tryAddCol("parent_frontend_uid", "VARCHAR(64)"); migrated = true; } catch {} }
        if (msg.includes("predecessor_frontend_uid")) { try { await tryAddCol("predecessor_frontend_uid", "VARCHAR(64)"); migrated = true; } catch {} }
        if (msg.includes("parent")) { try { await tryAddCol("parent", "INTEGER DEFAULT 0"); migrated = true; } catch {} }
        if (msg.includes("wbs_level") || msg.includes("wbsLevel")) { try { await tryAddCol("wbs_level", "INTEGER DEFAULT 0"); migrated = true; } catch {} }
        if (msg.includes("status")) { try { await tryAddCol("status", "VARCHAR(50)"); migrated = true; } catch {} }
        if (msg.includes("remarks")) { try { await tryAddCol("remarks", "TEXT"); migrated = true; } catch {} }
        if (msg.includes("predecessor_task_id") || msg.includes("predecessorTaskId")) { try { await tryAddCol("predecessor_task_id", "INTEGER"); migrated = true; } catch {} }
        if (msg.includes("dependency_type") || msg.includes("dependencyType")) { try { await tryAddCol("dependency_type", "VARCHAR(10)"); migrated = true; } catch {} }
        if (msg.includes("lag_days") || msg.includes("lagDays")) { try { await tryAddCol("lag_days", "INTEGER DEFAULT 0"); migrated = true; } catch {} }
        if (msg.includes("category")) { try { await tryAddCol("category", "VARCHAR(100)"); migrated = true; } catch {} }
        if (msg.includes("notes")) { try { await tryAddCol("notes", "TEXT"); migrated = true; } catch {} }
        if (msg.includes("planned_start") || msg.includes("plannedStart")) { try { await tryAddCol("planned_start", "VARCHAR(20)"); migrated = true; } catch {} }
        if (msg.includes("planned_end") || msg.includes("plannedEnd")) { try { await tryAddCol("planned_end", "VARCHAR(20)"); migrated = true; } catch {} }

        if (migrated) {
          if (input.id) {
            await db.update(ganttTasks).set(setData).where(eq(ganttTasks.id, input.id));
            return { id: input.id, frontend_task_uid: input.frontend_task_uid, action: "updated" };
          } else {
            const result = await db.insert(ganttTasks).values(setData).returning({
              id: ganttTasks.id, frontendTaskUid: ganttTasks.frontendTaskUid
            });
            return { id: result[0].id, frontend_task_uid: result[0].frontendTaskUid, action: "created" };
          }
        }

        /* Fallback: strip unknown columns and retry */
        const stripIfMissing = (key: string, col: string) => { if (msg.includes(col)) { delete setData[key]; } };
        stripIfMissing("frontendTaskUid", "frontend_task_uid");
        stripIfMissing("parentFrontendUid", "parent_frontend_uid");
        stripIfMissing("predecessorFrontendUid", "predecessor_frontend_uid");
        stripIfMissing("parent", "parent");
        stripIfMissing("wbsLevel", "wbs_level");
        stripIfMissing("status", "status");
        stripIfMissing("remarks", "remarks");
        stripIfMissing("category", "category");
        stripIfMissing("notes", "notes");
        stripIfMissing("plannedStart", "planned_start");
        stripIfMissing("plannedEnd", "planned_end");
        stripIfMissing("predecessorTaskId", "predecessor_task_id");
        stripIfMissing("dependencyType", "dependency_type");
        stripIfMissing("lagDays", "lag_days");

        if (Object.keys(setData).length > 5) {
          if (input.id) {
            await db.update(ganttTasks).set(setData).where(eq(ganttTasks.id, input.id));
            return { id: input.id, frontend_task_uid: input.frontend_task_uid, action: "updated" };
          } else {
            const result = await db.insert(ganttTasks).values(setData).returning({
              id: ganttTasks.id, frontendTaskUid: ganttTasks.frontendTaskUid
            });
            return { id: result[0].id, frontend_task_uid: result[0].frontendTaskUid, action: "created" };
          }
        }
        throw e;
      }
    }),

  // ── Delete task ──
  deleteTask: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(ganttDependencies).where(
        sql`${ganttDependencies.predecessorTaskId} = ${input.id} OR ${ganttDependencies.successorTaskId} = ${input.id}`
      );
      await db.delete(ganttTasks).where(eq(ganttTasks.id, input.id));
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
      console.log("[saveLink] source=", input.source, "target=", input.target);

      /* SOFT-VALIDATE: check both tasks exist — if not, log and skip gracefully */
      const predRows = await db.select({ id: ganttTasks.id }).from(ganttTasks).where(eq(ganttTasks.id, input.source));
      const succRows = await db.select({ id: ganttTasks.id }).from(ganttTasks).where(eq(ganttTasks.id, input.target));
      if (predRows.length === 0 || succRows.length === 0) {
        console.warn("[saveLink] SKIPPED — task not found:", { source: input.source, predExists: predRows.length > 0, target: input.target, succExists: succRows.length > 0 });
        return { id: 0, action: "skipped", reason: "Task not found" };
      }

      /* Delete old dependency for this successor */
      try {
        await db.delete(ganttDependencies).where(eq(ganttDependencies.successorTaskId, input.target));
      } catch (delErr: any) {
        console.warn("[saveLink] delete note:", delErr.message);
      }

      /* Insert new dependency */
      const typeMap: Record<string, string> = { "0": "FS", "1": "SS", "2": "FF", "3": "SF" };
      const normalizedType = typeMap[input.type] || input.type || "FS";

      try {
        const inserted = await db.insert(ganttDependencies).values({
          projectId: input.projectId ?? null,
          predecessorTaskId: input.source,
          successorTaskId: input.target,
          dependencyType: normalizedType,
          lagDays: input.lag,
        }).returning({ id: ganttDependencies.id });
        console.log("[saveLink] OK pred=", input.source, "succ=", input.target);

        /* Update task row with predecessor info */
        try {
          await db.update(ganttTasks)
            .set({ predecessorTaskId: input.source, dependencyType: normalizedType, lagDays: input.lag })
            .where(eq(ganttTasks.id, input.target));
        } catch { /* non-critical */ }

        return { id: inserted[0]?.id ?? 0, action: "created" };
      } catch (insertErr: any) {
        console.error("[saveLink] INSERT FAILED:", insertErr.message);
        return { id: 0, action: "error", reason: insertErr.message };
      }
    }),

  // ── Save dependency by frontend UID (resolves UIDs → DB IDs internally) ──
  saveLinkByUid: publicQuery
    .input(
      z.object({
        sourceUid: z.string(),
        targetUid: z.string(),
        type: z.string().default("FS"),
        lag: z.number().default(0),
        projectId: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      console.log("[saveLinkByUid] sourceUid=", input.sourceUid, "targetUid=", input.targetUid);

      /* Resolve UIDs → DB IDs */
      const predRows = await db.select({ id: ganttTasks.id }).from(ganttTasks).where(eq(ganttTasks.frontendTaskUid, input.sourceUid));
      const succRows = await db.select({ id: ganttTasks.id }).from(ganttTasks).where(eq(ganttTasks.frontendTaskUid, input.targetUid));

      if (predRows.length === 0 || succRows.length === 0) {
        console.warn("[saveLinkByUid] SKIPPED — UID not found:", { sourceUid: input.sourceUid, predFound: predRows.length, targetUid: input.targetUid, succFound: succRows.length });
        return { id: 0, action: "skipped", reason: "UID not found" };
      }

      const sourceDbId = predRows[0].id;
      const targetDbId = succRows[0].id;

      /* Delete old dependency for this successor */
      try {
        await db.delete(ganttDependencies).where(eq(ganttDependencies.successorTaskId, targetDbId));
      } catch { /* non-critical */ }

      /* Insert new dependency */
      const typeMap: Record<string, string> = { "0": "FS", "1": "SS", "2": "FF", "3": "SF" };
      const normalizedType = typeMap[input.type] || input.type || "FS";

      try {
        const inserted = await db.insert(ganttDependencies).values({
          projectId: input.projectId ?? null,
          predecessorTaskId: sourceDbId,
          successorTaskId: targetDbId,
          dependencyType: normalizedType,
          lagDays: input.lag,
        }).returning({ id: ganttDependencies.id });

        /* Update task row */
        try {
          await db.update(ganttTasks)
            .set({ predecessorTaskId: sourceDbId, dependencyType: normalizedType, lagDays: input.lag })
            .where(eq(ganttTasks.id, targetDbId));
        } catch { /* non-critical */ }

        return { id: inserted[0]?.id ?? 0, action: "created" };
      } catch (insertErr: any) {
        console.error("[saveLinkByUid] FAILED:", insertErr.message);
        return { id: 0, action: "error", reason: insertErr.message };
      }
    }),

  // ── Delete dependency ──
  deleteLink: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(ganttDependencies).where(eq(ganttDependencies.id, input.id));
      return { success: true };
    }),

  // ── Batch save dependencies (DB IDs only) ──
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
      let count = 0;
      for (const dep of input) {
        /* Validate both IDs exist */
        const predExists = (await db.select({ id: ganttTasks.id }).from(ganttTasks).where(eq(ganttTasks.id, dep.source))).length > 0;
        const succExists = (await db.select({ id: ganttTasks.id }).from(ganttTasks).where(eq(ganttTasks.id, dep.target))).length > 0;
        if (!predExists || !succExists) {
          console.warn("[saveLinksBatch] skipping invalid dep:", dep);
          continue;
        }
        const normalizedType = typeMap[dep.type] || dep.type || "FS";
        await db.insert(ganttDependencies).values({
          projectId: dep.projectId ?? null,
          predecessorTaskId: dep.source,
          successorTaskId: dep.target,
          dependencyType: normalizedType,
          lagDays: dep.lag,
        });
        count++;
      }
      return { count };
    }),

  // ── Reset all ──
  resetAll: publicQuery.mutation(async () => {
    await db.delete(ganttDependencies);
    await db.delete(ganttTasks);
    return { success: true };
  }),

  // ── Migrate ──
  migrate: publicQuery.mutation(async () => {
    await db.execute(sql.raw(`
      ALTER TABLE gantt_tasks
      ADD COLUMN IF NOT EXISTS frontend_task_uid VARCHAR(64) UNIQUE,
      ADD COLUMN IF NOT EXISTS parent_frontend_uid VARCHAR(64),
      ADD COLUMN IF NOT EXISTS predecessor_frontend_uid VARCHAR(64),
      ADD COLUMN IF NOT EXISTS status VARCHAR(50),
      ADD COLUMN IF NOT EXISTS remarks TEXT,
      ADD COLUMN IF NOT EXISTS wbs_level INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS parent INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS planned_start VARCHAR(20),
      ADD COLUMN IF NOT EXISTS planned_end VARCHAR(20),
      ADD COLUMN IF NOT EXISTS category VARCHAR(100),
      ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS predecessor_task_id INTEGER,
      ADD COLUMN IF NOT EXISTS dependency_type VARCHAR(10),
      ADD COLUMN IF NOT EXISTS lag_days INTEGER DEFAULT 0
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

    return { success: true };
  }),

  // ── Seed demo data ──
  seed: publicQuery.mutation(async () => {
    await db.execute(sql.raw(`
      ALTER TABLE gantt_tasks
      ADD COLUMN IF NOT EXISTS frontend_task_uid VARCHAR(64) UNIQUE,
      ADD COLUMN IF NOT EXISTS parent_frontend_uid VARCHAR(64),
      ADD COLUMN IF NOT EXISTS predecessor_frontend_uid VARCHAR(64),
      ADD COLUMN IF NOT EXISTS planned_start VARCHAR(20),
      ADD COLUMN IF NOT EXISTS planned_end VARCHAR(20),
      ADD COLUMN IF NOT EXISTS category VARCHAR(100),
      ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS status VARCHAR(50),
      ADD COLUMN IF NOT EXISTS remarks TEXT,
      ADD COLUMN IF NOT EXISTS wbs_level INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS parent INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS predecessor_task_id INTEGER,
      ADD COLUMN IF NOT EXISTS dependency_type VARCHAR(10),
      ADD COLUMN IF NOT EXISTS lag_days INTEGER DEFAULT 0
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
    if (existing.length > 0) return { seeded: false, reason: "Tasks already exist" };

    const fmt = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
    const addDays = (dt: Date, days: number) => { const r = new Date(dt); r.setDate(r.getDate() + days); return r; };
    const now = new Date();
    const uid = () => crypto.randomUUID();

    const rootUid = uid();
    const rootResult = await db.insert(ganttTasks).values({
      frontendTaskUid: rootUid,
      text: "S/4HANA MM Integration", startDate: fmt(now) + " 08:00", endDate: fmt(addDays(now,170)) + " 08:00",
      plannedStart: fmt(now), plannedEnd: fmt(addDays(now,180)),
      duration: 180, progress: 15, parent: 0, type: "project",
      wbsLevel: 1, owner: "PMO", status: "In Progress", sortorder: 0, open: 1,
    }).returning({ id: ganttTasks.id, frontendTaskUid: ganttTasks.frontendTaskUid });
    const rootId = rootResult[0].id;

    const childDefs = [
      { text: "Gap Analysis & Blueprint", owner: "Business Analyst", progress: 80, duration: 30, plannedStart: fmt(now), plannedEnd: fmt(addDays(now,30)), actualStart: fmt(now), actualEnd: fmt(addDays(now,33)), status: "Completed" },
      { text: "System Configuration", owner: "Basis Team", progress: 40, duration: 45, plannedStart: fmt(addDays(now,35)), plannedEnd: fmt(addDays(now,80)), actualStart: fmt(addDays(now,35)), actualEnd: fmt(addDays(now,82)), status: "In Progress (Delayed)" },
      { text: "Data Migration", owner: "Data Team", progress: 10, duration: 60, plannedStart: fmt(addDays(now,75)), plannedEnd: fmt(addDays(now,135)), actualStart: fmt(addDays(now,83)), status: "In Progress" },
      { text: "Unit Testing", owner: "QA Team", progress: 0, duration: 30, plannedStart: fmt(addDays(now,120)), plannedEnd: fmt(addDays(now,150)), status: "Not Started" },
      { text: "UAT & Sign-off", owner: "Business Lead", type: "milestone", progress: 0, duration: 20, plannedStart: fmt(addDays(now,150)), plannedEnd: fmt(addDays(now,170)), status: "Not Started" },
      { text: "Go-Live Preparation", owner: "Cutover Team", progress: 0, duration: 15, plannedStart: fmt(addDays(now,170)), plannedEnd: fmt(addDays(now,185)), status: "Not Started" },
    ];

    const childIds: number[] = [];
    for (const t of childDefs) {
      const cUid = uid();
      const end = (t as any).actualEnd || ((t as any).actualStart ? fmt(addDays(new Date((t as any).actualStart + "T12:00:00"), t.duration)) : null);
      const start = (t as any).actualStart ? (t as any).actualStart + " 08:00" : null;
      const r = await db.insert(ganttTasks).values({
        frontendTaskUid: cUid, parentFrontendUid: rootUid,
        text: t.text, startDate: start, endDate: end ? end + " 08:00" : null,
        plannedStart: t.plannedStart, plannedEnd: t.plannedEnd,
        duration: t.duration, progress: t.progress, parent: rootId, type: (t as any).type || "task",
        wbsLevel: 2, owner: t.owner, status: (t as any).status, sortorder: 0, open: 1,
      }).returning({ id: ganttTasks.id });
      childIds.push(r[0].id);
    }

    if (childIds.length >= 2) {
      await db.insert(ganttDependencies).values({
        predecessorTaskId: childIds[0], successorTaskId: childIds[1], dependencyType: "FS", lagDays: 0
      });
    }
    if (childIds.length >= 3) {
      await db.insert(ganttDependencies).values({
        predecessorTaskId: childIds[1], successorTaskId: childIds[2], dependencyType: "FS", lagDays: 0
      });
    }
    return { seeded: true, count: 1 + childDefs.length };
  }),

  // ── Reorder tasks: batch update sortorder ──
  reorderTasks: publicQuery
    .input(z.array(z.object({ id: z.number(), sortorder: z.number() })))
    .mutation(async ({ input }) => {
      for (const item of input) {
        await db.update(ganttTasks).set({ sortorder: item.sortorder }).where(eq(ganttTasks.id, item.id));
      }
      return { updated: input.length };
    }),
});
