import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { db } from "./queries/connection";
import { ganttTasks, ganttDependencies, ganttProjects } from "@db/schema";
import { eq, sql, and, asc } from "drizzle-orm";

/* ═══════════════════════════════════════════
   GANTT CLEAN RESET + CRUD ROUTER
   ═══════════════════════════════════════════ */

export const ganttRouter = createRouter({

  /* ── 1. CLEAN RESET ── */
  resetGantt: publicQuery.mutation(async () => {
    /* Drop existing Gantt tables (ONLY Gantt tables — preserve all other app data) */
    try { await db.execute(sql.raw(`DROP TABLE IF EXISTS gantt_dependencies CASCADE`)); } catch {}
    try { await db.execute(sql.raw(`DROP TABLE IF EXISTS gantt_tasks CASCADE`)); } catch {}
    try { await db.execute(sql.raw(`DROP TABLE IF EXISTS gantt_projects CASCADE`)); } catch {}

    /* Create gantt_projects (full schema — includes name, tasks_data, links_data) */
    await db.execute(sql.raw(`
      CREATE TABLE gantt_projects (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        project_name VARCHAR(255),
        start_date VARCHAR(20),
        finish_date VARCHAR(20),
        status VARCHAR(50),
        tasks_data TEXT NOT NULL DEFAULT '{}',
        links_data TEXT DEFAULT '{}',
        description TEXT,
        created_by VARCHAR(255),
        updated_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS gantt_projects_name_idx ON gantt_projects(name)`));

    /* Create gantt_tasks (clean — matches UI fields exactly) */
    await db.execute(sql.raw(`
      CREATE TABLE gantt_tasks (
        id SERIAL PRIMARY KEY,
        project_id INTEGER,
        frontend_task_uid VARCHAR(64) UNIQUE,
        task_name VARCHAR(500) NOT NULL,
        parent_task_id INTEGER DEFAULT 0,
        predecessor_task_id INTEGER,
        dependency_type VARCHAR(10),
        lag_days INTEGER DEFAULT 0,
        wbs_level INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        planned_start VARCHAR(20),
        planned_finish VARCHAR(20),
        planned_duration INTEGER,
        actual_start VARCHAR(20),
        actual_finish VARCHAR(20),
        actual_duration INTEGER,
        progress_percent INTEGER DEFAULT 0,
        status VARCHAR(50),
        owner VARCHAR(255),
        category VARCHAR(100),
        notes TEXT,
        remarks TEXT,
        task_type VARCHAR(20) DEFAULT 'task',
        is_milestone INTEGER DEFAULT 0,
        is_parent INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX gantt_tasks_project_idx ON gantt_tasks(project_id)`));
    await db.execute(sql.raw(`CREATE INDEX gantt_tasks_parent_idx ON gantt_tasks(parent_task_id)`));
    await db.execute(sql.raw(`CREATE INDEX gantt_tasks_uid_idx ON gantt_tasks(frontend_task_uid)`));
    await db.execute(sql.raw(`CREATE INDEX gantt_tasks_sort_idx ON gantt_tasks(sort_order)`));

    /* Create gantt_dependencies */
    await db.execute(sql.raw(`
      CREATE TABLE gantt_dependencies (
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
    await db.execute(sql.raw(`CREATE INDEX gantt_deps_project_idx ON gantt_dependencies(project_id)`));
    await db.execute(sql.raw(`CREATE INDEX gantt_deps_pred_idx ON gantt_dependencies(predecessor_task_id)`));
    await db.execute(sql.raw(`CREATE INDEX gantt_deps_succ_idx ON gantt_dependencies(successor_task_id)`));

    return { success: true, message: "Gantt tables reset successfully" };
  }),

  /* ── 2. LIST TASKS (ordered by sort_order) ── */
  tasks: publicQuery.query(async () => {
    const rows = await db.select().from(ganttTasks).orderBy(asc(ganttTasks.sortOrder), asc(ganttTasks.id));
    /* Return in a shape compatible with the frontend's current expectations */
    return rows.map(r => ({
      ...r,
      /* Keep backward-compatible aliases */
      text: r.taskName,
      startDate: r.actualStart,
      endDate: r.actualFinish,
      plannedStart: r.plannedStart,
      plannedEnd: r.plannedFinish,
      duration: r.plannedDuration,
      progress: r.progressPercent,
      parent: r.parentTaskId,
      sortorder: r.sortOrder,
      type: r.taskType,
    }));
  }),

  /* ── 3. LIST DEPENDENCIES ── */
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

  /* ── 4. SAVE TASK — raw SQL, zero ambiguity ── */
  saveTask: publicQuery
    .input(z.any())
    .mutation(async ({ input }) => {
      const v = input as Record<string, any>;

      /* 1. Extract taskName */
      let taskName: string = v.taskName ?? v.task_name ?? v.text ?? v.name ?? v.title ?? "";
      if (!taskName.trim()) throw new Error("task_name is required");
      taskName = taskName.trim().replace(/'/g, "''");

      /* 2. Extract planned dates (BUG #1: explicit per-key checks) */
      let plannedStart: string | null = null;
      if (typeof v.plannedStart === "string" && v.plannedStart) plannedStart = v.plannedStart;
      else if (typeof v.planned_start === "string" && v.planned_start) plannedStart = v.planned_start;

      let plannedFinish: string | null = null;
      if (typeof v.plannedEnd === "string" && v.plannedEnd) plannedFinish = v.plannedEnd;
      else if (typeof v.planned_finish === "string" && v.planned_finish) plannedFinish = v.planned_finish;
      else if (typeof v.planned_end === "string" && v.planned_end) plannedFinish = v.planned_end;

      /* 3. Extract owner (allow empty string) */
      let owner: string | null = null;
      if (typeof v.owner === "string") owner = v.owner || null;

      /* 4. Extract everything else */
      const parentTaskId = typeof v.parent_task_id === "number" ? v.parent_task_id : (typeof v.parent === "number" ? v.parent : 0);
      const predecessorTaskId = typeof v.predecessor_task_id === "number" ? v.predecessor_task_id : (typeof v.predecessorId === "number" ? v.predecessorId : null);
      const depType = v.dependency_type ?? v.dependencyType ?? null;
      const lagDays = typeof v.lag_days === "number" ? v.lag_days : 0;
      const wbsLevel = typeof v.wbs_level === "number" ? v.wbs_level : 0;
      const sortOrder = typeof v.sort_order === "number" ? v.sort_order : (typeof v.sortOrder === "number" ? v.sortOrder : 0);
      const plannedDuration = typeof v.planned_duration === "number" ? v.planned_duration : (typeof v.duration === "number" ? v.duration : null);
      const actualStart = v.actual_start ?? v.start_date ?? null;
      const actualFinish = v.actual_finish ?? v.end_date ?? null;
      const actualDuration = typeof v.actual_duration === "number" ? v.actual_duration : null;
      const progressPercent = typeof v.progress_percent === "number" ? v.progress_percent : (typeof v.progress === "number" ? v.progress : 0);
      const status = v.status ?? null;
      const category = v.category ?? null;
      const notes = v.notes ?? v.remarks ?? null;
      const taskType = v.task_type ?? v.taskType ?? "task";
      const isMilestone = (v.is_milestone ?? v.isMilestone ?? 0) ? 1 : 0;
      const isParent = (v.is_parent ?? v.isParent ?? 0) ? 1 : 0;
      const frontendTaskUid = v.frontend_task_uid ?? v.frontendTaskUid ?? null;
      const projectId = v.project_id ?? v.projectId ?? null;
      const now = new Date();

      /* 5. RAW SQL */
      const sqlStr = input.id
        ? `UPDATE gantt_tasks SET
             frontend_task_uid = ${frontendTaskUid ? `'${frontendTaskUid}'` : 'NULL'},
             project_id = ${projectId ?? 'NULL'},
             task_name = '${taskName}',
             parent_task_id = ${parentTaskId},
             predecessor_task_id = ${predecessorTaskId ?? 'NULL'},
             dependency_type = ${depType ? `'${depType}'` : 'NULL'},
             lag_days = ${lagDays},
             wbs_level = ${wbsLevel},
             sort_order = ${sortOrder},
             planned_start = ${plannedStart ? `'${plannedStart}'` : 'NULL'},
             planned_finish = ${plannedFinish ? `'${plannedFinish}'` : 'NULL'},
             planned_duration = ${plannedDuration ?? 'NULL'},
             actual_start = ${actualStart ? `'${actualStart}'` : 'NULL'},
             actual_finish = ${actualFinish ? `'${actualFinish}'` : 'NULL'},
             actual_duration = ${actualDuration ?? 'NULL'},
             progress_percent = ${progressPercent},
             status = ${status ? `'${status}'` : 'NULL'},
             owner = ${owner ? `'${owner.replace(/'/g, "''")}'` : 'NULL'},
             category = ${category ? `'${category}'` : 'NULL'},
             notes = ${notes ? `'${notes.replace(/'/g, "''")}'` : 'NULL'},
             remarks = ${notes ? `'${notes.replace(/'/g, "''")}'` : 'NULL'},
             task_type = '${taskType}',
             is_milestone = ${isMilestone},
             is_parent = ${isParent},
             updated_at = NOW()
           WHERE id = ${input.id}
           RETURNING id, frontend_task_uid`
        : `INSERT INTO gantt_tasks (
             frontend_task_uid, project_id, task_name, parent_task_id, predecessor_task_id,
             dependency_type, lag_days, wbs_level, sort_order,
             planned_start, planned_finish, planned_duration,
             actual_start, actual_finish, actual_duration,
             progress_percent, status, owner, category, notes, remarks,
             task_type, is_milestone, is_parent, created_at, updated_at
           ) VALUES (
             ${frontendTaskUid ? `'${frontendTaskUid}'` : 'NULL'}, ${projectId ?? 'NULL'}, '${taskName}',
             ${parentTaskId}, ${predecessorTaskId ?? 'NULL'}, ${depType ? `'${depType}'` : 'NULL'},
             ${lagDays}, ${wbsLevel}, ${sortOrder},
             ${plannedStart ? `'${plannedStart}'` : 'NULL'}, ${plannedFinish ? `'${plannedFinish}'` : 'NULL'}, ${plannedDuration ?? 'NULL'},
             ${actualStart ? `'${actualStart}'` : 'NULL'}, ${actualFinish ? `'${actualFinish}'` : 'NULL'}, ${actualDuration ?? 'NULL'},
             ${progressPercent}, ${status ? `'${status}'` : 'NULL'}, ${owner ? `'${owner.replace(/'/g, "''")}'` : 'NULL'},
             ${category ? `'${category}'` : 'NULL'}, ${notes ? `'${notes.replace(/'/g, "''")}'` : 'NULL'}, ${notes ? `'${notes.replace(/'/g, "''")}'` : 'NULL'},
             '${taskType}', ${isMilestone}, ${isParent}, NOW(), NOW()
           )
           RETURNING id, frontend_task_uid`;

      try {
        const result: any = await db.execute(sql.raw(sqlStr));
        const row = result.rows?.[0] ?? result[0];
        return {
          id: row?.id ?? input.id,
          frontend_task_uid: row?.frontend_task_uid ?? frontendTaskUid,
          taskName, plannedStart, plannedFinish, owner,
          action: input.id ? "updated" : "created",
        };
      } catch (e: any) {
        throw new Error(`Save failed: ${e.message}`);
      }
    }),


  /* ── 5. DELETE TASK (+ cleanup dependencies) ── */
  deleteTask: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(ganttDependencies).where(
        sql`${ganttDependencies.predecessorTaskId} = ${input.id} OR ${ganttDependencies.successorTaskId} = ${input.id}`
      );
      await db.delete(ganttTasks).where(eq(ganttTasks.id, input.id));
      return { success: true };
    }),

  /* ── 6. SAVE DEPENDENCY (by DB IDs — validates first) ── */
  saveLink: publicQuery
    .input(z.object({
      source: z.number(),
      target: z.number(),
      type: z.string().default("FS"),
      lag: z.number().default(0),
      projectId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const predRows = await db.select({ id: ganttTasks.id }).from(ganttTasks).where(eq(ganttTasks.id, input.source));
      const succRows = await db.select({ id: ganttTasks.id }).from(ganttTasks).where(eq(ganttTasks.id, input.target));
      if (predRows.length === 0 || succRows.length === 0) {
        return { id: 0, action: "skipped", reason: "Task not found" };
      }
      await db.delete(ganttDependencies).where(eq(ganttDependencies.successorTaskId, input.target));
      const typeMap: Record<string, string> = { "0": "FS", "1": "SS", "2": "FF", "3": "SF" };
      const norm = typeMap[input.type] || input.type || "FS";
      const inserted = await db.insert(ganttDependencies).values({
        projectId: input.projectId ?? null,
        predecessorTaskId: input.source,
        successorTaskId: input.target,
        dependencyType: norm,
        lagDays: input.lag,
      }).returning({ id: ganttDependencies.id });
      /* Also store on task row for dropdown persistence */
      await db.update(ganttTasks)
        .set({ predecessorTaskId: input.source, dependencyType: norm, lagDays: input.lag })
        .where(eq(ganttTasks.id, input.target));
      return { id: inserted[0]?.id ?? 0, action: "created" };
    }),

  /* ── 7. SAVE DEPENDENCY by UID ── */
  saveLinkByUid: publicQuery
    .input(z.object({
      sourceUid: z.string(),
      targetUid: z.string(),
      type: z.string().default("FS"),
      lag: z.number().default(0),
      projectId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const predRows = await db.select({ id: ganttTasks.id }).from(ganttTasks).where(eq(ganttTasks.frontendTaskUid, input.sourceUid));
      const succRows = await db.select({ id: ganttTasks.id }).from(ganttTasks).where(eq(ganttTasks.frontendTaskUid, input.targetUid));
      if (predRows.length === 0 || succRows.length === 0) {
        return { id: 0, action: "skipped", reason: "UID not found" };
      }
      await db.delete(ganttDependencies).where(eq(ganttDependencies.successorTaskId, succRows[0].id));
      const typeMap: Record<string, string> = { "0": "FS", "1": "SS", "2": "FF", "3": "SF" };
      const norm = typeMap[input.type] || input.type || "FS";
      const inserted = await db.insert(ganttDependencies).values({
        projectId: input.projectId ?? null,
        predecessorTaskId: predRows[0].id,
        successorTaskId: succRows[0].id,
        dependencyType: norm,
        lagDays: input.lag,
      }).returning({ id: ganttDependencies.id });
      await db.update(ganttTasks)
        .set({ predecessorTaskId: predRows[0].id, dependencyType: norm, lagDays: input.lag })
        .where(eq(ganttTasks.id, succRows[0].id));
      return { id: inserted[0]?.id ?? 0, action: "created" };
    }),

  /* ── 8. DELETE DEPENDENCY ── */
  deleteLink: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(ganttDependencies).where(eq(ganttDependencies.id, input.id));
      return { success: true };
    }),

  /* ── 9. BATCH SAVE DEPENDENCIES ── */
  saveLinksBatch: publicQuery
    .input(z.array(z.object({
      source: z.number(), target: z.number(),
      type: z.string(), lag: z.number().default(0),
      projectId: z.number().optional(),
    })))
    .mutation(async ({ input }) => {
      const typeMap: Record<string, string> = { "0": "FS", "1": "SS", "2": "FF", "3": "SF" };
      let count = 0;
      for (const dep of input) {
        const predExists = (await db.select({ id: ganttTasks.id }).from(ganttTasks).where(eq(ganttTasks.id, dep.source))).length > 0;
        const succExists = (await db.select({ id: ganttTasks.id }).from(ganttTasks).where(eq(ganttTasks.id, dep.target))).length > 0;
        if (!predExists || !succExists) continue;
        const norm = typeMap[dep.type] || dep.type || "FS";
        await db.insert(ganttDependencies).values({
          projectId: dep.projectId ?? null,
          predecessorTaskId: dep.source,
          successorTaskId: dep.target,
          dependencyType: norm,
          lagDays: dep.lag,
        });
        count++;
      }
      return { count };
    }),

  /* ── 10. REORDER TASKS ── */
  reorderTasks: publicQuery
    .input(z.array(z.object({ id: z.number(), sort_order: z.number() })))
    .mutation(async ({ input }) => {
      for (const item of input) {
        await db.update(ganttTasks).set({ sortOrder: item.sort_order }).where(eq(ganttTasks.id, item.id));
      }
      return { updated: input.length };
    }),

  /* ── 11. SEED DEMO DATA ── */
  seed: publicQuery.mutation(async () => {
    /* Auto-create tables if they don't exist yet */
    try {
      await db.execute(sql.raw(`SELECT 1 FROM gantt_tasks LIMIT 1`));
    } catch {
      /* Tables missing — create them to match the Drizzle schema */
      try { await db.execute(sql.raw(`DROP TABLE IF EXISTS gantt_dependencies CASCADE`)); } catch {}
      try { await db.execute(sql.raw(`DROP TABLE IF EXISTS gantt_tasks CASCADE`)); } catch {}
      try { await db.execute(sql.raw(`DROP TABLE IF EXISTS gantt_projects CASCADE`)); } catch {}
      /* gantt_projects — must match db/schema.ts (name + tasks_data are required) */
      await db.execute(sql.raw(`
        CREATE TABLE gantt_projects (
          id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, project_name VARCHAR(255),
          start_date VARCHAR(20), finish_date VARCHAR(20), status VARCHAR(50),
          tasks_data TEXT NOT NULL DEFAULT '{}', links_data TEXT,
          description TEXT, created_by VARCHAR(255), updated_by VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`));
      await db.execute(sql.raw(`CREATE INDEX gantt_projects_name_idx ON gantt_projects(name)`));
      /* gantt_tasks — must match db/schema.ts exactly */
      await db.execute(sql.raw(`
        CREATE TABLE gantt_tasks (
          id SERIAL PRIMARY KEY, project_id INTEGER, frontend_task_uid VARCHAR(64) UNIQUE,
          task_name VARCHAR(500) NOT NULL, parent_task_id INTEGER DEFAULT 0,
          predecessor_task_id INTEGER, dependency_type VARCHAR(10), lag_days INTEGER DEFAULT 0,
          wbs_level INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0,
          planned_start VARCHAR(20), planned_finish VARCHAR(20), planned_duration INTEGER,
          actual_start VARCHAR(20), actual_finish VARCHAR(20), actual_duration INTEGER,
          progress_percent INTEGER DEFAULT 0, status VARCHAR(50), owner VARCHAR(255),
          category VARCHAR(100), notes TEXT, remarks TEXT, task_type VARCHAR(20) DEFAULT 'task',
          is_milestone INTEGER DEFAULT 0, is_parent INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`));
      await db.execute(sql.raw(`CREATE INDEX gantt_tasks_project_idx ON gantt_tasks(project_id)`));
      await db.execute(sql.raw(`CREATE INDEX gantt_tasks_parent_idx ON gantt_tasks(parent_task_id)`));
      await db.execute(sql.raw(`CREATE INDEX gantt_tasks_uid_idx ON gantt_tasks(frontend_task_uid)`));
      await db.execute(sql.raw(`CREATE INDEX gantt_tasks_sort_idx ON gantt_tasks(sort_order)`));
      /* gantt_dependencies */
      await db.execute(sql.raw(`
        CREATE TABLE gantt_dependencies (
          id SERIAL PRIMARY KEY, project_id INTEGER,
          predecessor_task_id INTEGER NOT NULL, successor_task_id INTEGER NOT NULL,
          dependency_type VARCHAR(10) NOT NULL DEFAULT 'FS', lag_days INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`));
    }

    /* ── Schema migration: if gantt_projects exists but lacks new columns, recreate ── */
    try {
      const cols = await db.execute(sql.raw(`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'gantt_projects'
      `));
      const colNames = (cols.rows || []).map((r: any) => r.column_name);
      if (!colNames.includes("name")) {
        /* Old schema — drop and recreate all Gantt tables */
        try { await db.execute(sql.raw(`DROP TABLE IF EXISTS gantt_dependencies CASCADE`)); } catch {}
        try { await db.execute(sql.raw(`DROP TABLE IF EXISTS gantt_tasks CASCADE`)); } catch {}
        try { await db.execute(sql.raw(`DROP TABLE IF EXISTS gantt_projects CASCADE`)); } catch {}
        await db.execute(sql.raw(`
          CREATE TABLE gantt_projects (
            id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, project_name VARCHAR(255),
            start_date VARCHAR(20), finish_date VARCHAR(20), status VARCHAR(50),
            tasks_data TEXT NOT NULL DEFAULT '{}', links_data TEXT,
            description TEXT, created_by VARCHAR(255), updated_by VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )`));
        await db.execute(sql.raw(`
          CREATE TABLE gantt_tasks (
            id SERIAL PRIMARY KEY, project_id INTEGER, frontend_task_uid VARCHAR(64) UNIQUE,
            task_name VARCHAR(500) NOT NULL, parent_task_id INTEGER DEFAULT 0,
            predecessor_task_id INTEGER, dependency_type VARCHAR(10), lag_days INTEGER DEFAULT 0,
            wbs_level INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0,
            planned_start VARCHAR(20), planned_finish VARCHAR(20), planned_duration INTEGER,
            actual_start VARCHAR(20), actual_finish VARCHAR(20), actual_duration INTEGER,
            progress_percent INTEGER DEFAULT 0, status VARCHAR(50), owner VARCHAR(255),
            category VARCHAR(100), notes TEXT, remarks TEXT, task_type VARCHAR(20) DEFAULT 'task',
            is_milestone INTEGER DEFAULT 0, is_parent INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )`));
        await db.execute(sql.raw(`CREATE INDEX gantt_tasks_project_idx ON gantt_tasks(project_id)`));
        await db.execute(sql.raw(`CREATE INDEX gantt_tasks_parent_idx ON gantt_tasks(parent_task_id)`));
        await db.execute(sql.raw(`CREATE INDEX gantt_tasks_uid_idx ON gantt_tasks(frontend_task_uid)`));
        await db.execute(sql.raw(`CREATE INDEX gantt_tasks_sort_idx ON gantt_tasks(sort_order)`));
        await db.execute(sql.raw(`
          CREATE TABLE gantt_dependencies (
            id SERIAL PRIMARY KEY, project_id INTEGER,
            predecessor_task_id INTEGER NOT NULL, successor_task_id INTEGER NOT NULL,
            dependency_type VARCHAR(10) NOT NULL DEFAULT 'FS', lag_days INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )`));
      }
    } catch { /* table doesn't exist — will be handled below */ }

    /* Check if data already exists */
    let existing: any[] = [];
    try { existing = await db.select().from(ganttTasks); } catch {}
    if (existing.length > 0) return { seeded: false, reason: "Tasks already exist" };

    const fmt = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
    const addDays = (dt: Date, days: number) => { const r = new Date(dt); r.setDate(r.getDate() + days); return r; };
    const now = new Date();
    const uid = () => crypto.randomUUID();

    /* Create a default project using Drizzle */
    const projResult = await db.insert(ganttProjects).values({
      name: "S/4HANA MM Integration",
      projectName: "S/4HANA MM Integration",
      startDate: fmt(now),
      status: "In Progress",
      tasksData: "{}",
    }).returning({ id: ganttProjects.id });
    const projectId = projResult[0].id;

    const rootUid = uid();
    const rootResult = await db.insert(ganttTasks).values({
      frontendTaskUid: rootUid, projectId,
      taskName: "S/4HANA MM Integration",
      actualStart: fmt(now) + " 08:00", actualFinish: fmt(addDays(now,170)) + " 08:00",
      plannedStart: fmt(now), plannedFinish: fmt(addDays(now,180)),
      plannedDuration: 180, progressPercent: 15, parentTaskId: 0,
      taskType: "project", wbsLevel: 1, owner: "PMO", status: "In Progress", sortOrder: 10, isParent: 1,
    }).returning({ id: ganttTasks.id, frontendTaskUid: ganttTasks.frontendTaskUid });
    const rootId = rootResult[0].id;

    const childDefs = [
      { taskName: "Gap Analysis & Blueprint", owner: "Business Analyst", progress: 80, duration: 30, plannedStart: fmt(now), plannedFinish: fmt(addDays(now,30)), actualStart: fmt(now), actualFinish: fmt(addDays(now,33)), status: "Completed", sortOrder: 20 },
      { taskName: "System Configuration", owner: "Basis Team", progress: 40, duration: 45, plannedStart: fmt(addDays(now,35)), plannedFinish: fmt(addDays(now,80)), actualStart: fmt(addDays(now,35)), actualFinish: fmt(addDays(now,82)), status: "In Progress (Delayed)", sortOrder: 30 },
      { taskName: "Data Migration", owner: "Data Team", progress: 10, duration: 60, plannedStart: fmt(addDays(now,75)), plannedFinish: fmt(addDays(now,135)), actualStart: fmt(addDays(now,83)), status: "In Progress", sortOrder: 40 },
      { taskName: "Unit Testing", owner: "QA Team", progress: 0, duration: 30, plannedStart: fmt(addDays(now,120)), plannedFinish: fmt(addDays(now,150)), status: "Not Started", sortOrder: 50 },
      { taskName: "UAT & Sign-off", owner: "Business Lead", type: "milestone", progress: 0, duration: 20, plannedStart: fmt(addDays(now,150)), plannedFinish: fmt(addDays(now,170)), status: "Not Started", sortOrder: 60, isMilestone: 1 },
      { taskName: "Go-Live Preparation", owner: "Cutover Team", progress: 0, duration: 15, plannedStart: fmt(addDays(now,170)), plannedFinish: fmt(addDays(now,185)), status: "Not Started", sortOrder: 70 },
    ];

    const childIds: number[] = [];
    for (const t of childDefs) {
      const cUid = uid();
      const r = await db.insert(ganttTasks).values({
        frontendTaskUid: cUid, projectId,
        taskName: t.taskName,
        actualStart: (t as any).actualStart ? (t as any).actualStart + " 08:00" : null,
        actualFinish: (t as any).actualFinish ? (t as any).actualFinish + " 08:00" : null,
        plannedStart: t.plannedStart, plannedFinish: t.plannedFinish,
        plannedDuration: t.duration, progressPercent: t.progress, parentTaskId: rootId,
        taskType: (t as any).type || "task", wbsLevel: 2, owner: t.owner,
        status: (t as any).status, sortOrder: (t as any).sortOrder,
        isMilestone: (t as any).isMilestone ?? 0,
      }).returning({ id: ganttTasks.id });
      childIds.push(r[0].id);
    }

    if (childIds.length >= 2) {
      await db.insert(ganttDependencies).values({ projectId, predecessorTaskId: childIds[0], successorTaskId: childIds[1], dependencyType: "FS", lagDays: 0 });
    }
    if (childIds.length >= 3) {
      await db.insert(ganttDependencies).values({ projectId, predecessorTaskId: childIds[1], successorTaskId: childIds[2], dependencyType: "FS", lagDays: 0 });
    }
    return { seeded: true, count: 1 + childDefs.length };
  }),
});
