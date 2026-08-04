import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { db } from "./queries/connection";
import { ganttTasks, ganttDependencies, ganttProjects } from "@db/schema";
import { eq, sql, asc, inArray, or, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";


const DEP_TYPE_MAP: Record<string, string> = { "0": "FS", "1": "SS", "2": "FF", "3": "SF" };
const normalizeDependencyType = (type?: string | null) => {
  const raw = String(type || "NONE").toUpperCase();
  return DEP_TYPE_MAP[raw] || (["FS", "SS", "FF", "SF", "NONE"].includes(raw) ? raw : "NONE");
};


async function getSharedProjectIds(): Promise<Set<number>> {
  const rows = await db
    .select({ id: ganttProjects.id })
    .from(ganttProjects)
    .where(eq(ganttProjects.sharingEnabled, 1));
  return new Set(rows.map((r) => r.id));
}

function filterOutSharedTasks(
  tasks: Array<typeof ganttTasks.$inferSelect>,
  sharedProjectIds: Set<number>
) {
  return tasks.filter((t) => !t.projectId || !sharedProjectIds.has(t.projectId));
}

async function assertTaskNotShared(taskId: number) {
  const rows = await db
    .select({ projectId: ganttTasks.projectId })
    .from(ganttTasks)
    .where(eq(ganttTasks.id, taskId));
  if (rows.length === 0) return;
  const projectId = rows[0].projectId;
  if (!projectId) return;
  const shared = await db
    .select({ id: ganttProjects.id })
    .from(ganttProjects)
    .where(and(eq(ganttProjects.id, projectId), eq(ganttProjects.sharingEnabled, 1)));
  if (shared.length > 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Shared project tasks must be accessed through the link-based workspace",
    });
  }
}

async function assertDependencyNotShared(dependencyId: number) {
  const rows = await db
    .select({ projectId: ganttDependencies.projectId })
    .from(ganttDependencies)
    .where(eq(ganttDependencies.id, dependencyId));
  if (rows.length === 0) return;
  const projectId = rows[0].projectId;
  if (!projectId) return;
  const shared = await db
    .select({ id: ganttProjects.id })
    .from(ganttProjects)
    .where(and(eq(ganttProjects.id, projectId), eq(ganttProjects.sharingEnabled, 1)));
  if (shared.length > 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Shared project dependencies must be accessed through the link-based workspace",
    });
  }
}

async function assertProjectNotShared(projectId: number) {
  const shared = await db
    .select({ id: ganttProjects.id })
    .from(ganttProjects)
    .where(and(eq(ganttProjects.id, projectId), eq(ganttProjects.sharingEnabled, 1)));
  if (shared.length > 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Shared projects must be accessed through the link-based workspace",
    });
  }
}

function mapGanttTaskRow(r: any, nameMap: Map<number, string>) {
  return {
    ...r,
    /* Keep backward-compatible aliases */
    text: r.taskName,
    startDate: r.actualStart,
    endDate: r.actualFinish,
    actualEnd: r.actualFinish,
    plannedStart: r.plannedStart,
    plannedEnd: r.plannedFinish,
    duration: r.plannedDuration,
    progress: r.progressPercent,
    parent: r.parentTaskId,
    sortorder: r.sortOrder,
    type: r.taskType,
    predecessorName: r.predecessorTaskId ? (nameMap.get(r.predecessorTaskId) || `Task ${r.predecessorTaskId}`) : null,
  };
}

async function selectGanttTasksForClient() {
  const sharedProjectIds = await getSharedProjectIds();
  const rows = await db.select().from(ganttTasks).orderBy(asc(ganttTasks.sortOrder), asc(ganttTasks.id));
  const visibleRows = filterOutSharedTasks(rows, sharedProjectIds);
  const nameMap = new Map<number, string>();
  for (const r of visibleRows) nameMap.set(r.id, r.taskName || `Task ${r.id}`);
  return visibleRows.map(r => mapGanttTaskRow(r, nameMap));
}

async function wouldCreateDependencyCycle(source: number, target: number) {
  if (!source || !target) return false;
  if (source === target) return true;
  const deps = await db.select({ source: ganttDependencies.predecessorTaskId, target: ganttDependencies.successorTaskId }).from(ganttDependencies);
  const successors = new Map<number, number[]>();
  for (const dep of deps) {
    if (dep.source === source && dep.target === target) continue;
    if (!successors.has(dep.source)) successors.set(dep.source, []);
    successors.get(dep.source)!.push(dep.target);
  }
  const stack = [target];
  const seen = new Set<number>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === source) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(successors.get(current) || []));
  }
  return false;
}

function collectTaskAndDescendantIds(
  rootId: number,
  tasks: Array<{ id: number; parentTaskId: number | null }>
) {
  const childIdsByParent = new Map<number, number[]>();
  for (const task of tasks) {
    const parentId = task.parentTaskId || 0;
    if (!childIdsByParent.has(parentId)) childIdsByParent.set(parentId, []);
    childIdsByParent.get(parentId)!.push(task.id);
  }

  const ids = new Set<number>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    stack.push(...(childIdsByParent.get(id) || []));
  }
  return Array.from(ids);
}

/* ═══════════════════════════════════════════
   GANTT CLEAN RESET + CRUD ROUTER
   ═══════════════════════════════════════════ */

export const ganttRouter = createRouter({

  /* ── 1. LEGACY-ONLY CLEAN RESET ── */
  resetGantt: publicQuery
    .input(z.object({ confirmed: z.boolean().default(false), dryRun: z.boolean().default(false) }).optional())
    .mutation(async ({ input }) => {
      const confirmed = input?.confirmed ?? false;
      const dryRun = input?.dryRun ?? false;
      const sharedProjectIds = await getSharedProjectIds();

      const legacyTasks = await db.select({ id: ganttTasks.id }).from(ganttTasks).where(
        sharedProjectIds.size > 0
          ? and(sql`${ganttTasks.projectId} IS NOT NULL`, sql`${ganttTasks.projectId}::int NOT IN (${sql.join(Array.from(sharedProjectIds))})`)
          : sql`1=1`
      );
      const legacyDeps = await db.select({ id: ganttDependencies.id }).from(ganttDependencies).where(
        sharedProjectIds.size > 0
          ? and(sql`${ganttDependencies.projectId} IS NOT NULL`, sql`${ganttDependencies.projectId}::int NOT IN (${sql.join(Array.from(sharedProjectIds))})`)
          : sql`1=1`
      );

      if (dryRun) {
        return {
          success: false,
          dryRun: true,
          wouldDelete: {
            tasks: legacyTasks.length,
            dependencies: legacyDeps.length,
          },
          message: `Dry run: would delete ${legacyTasks.length} legacy tasks and ${legacyDeps.length} legacy dependencies. Shared-project rows are preserved.`,
        };
      }

      if (!confirmed) {
        return {
          success: false,
          dryRun: false,
          wouldDelete: {
            tasks: legacyTasks.length,
            dependencies: legacyDeps.length,
          },
          message: `This will delete ${legacyTasks.length} legacy tasks and ${legacyDeps.length} legacy dependencies. Shared-project rows will be preserved. Set confirmed: true to proceed.`,
        };
      }

      // Scoped delete: only legacy rows, never shared-project rows or tables.
      const taskIds = legacyTasks.map((r) => r.id);
      const depIds = legacyDeps.map((r) => r.id);
      if (taskIds.length > 0) {
        await db.delete(ganttDependencies).where(
          or(
            inArray(ganttDependencies.predecessorTaskId, taskIds),
            inArray(ganttDependencies.successorTaskId, taskIds)
          )
        );
        await db.delete(ganttTasks).where(inArray(ganttTasks.id, taskIds));
      }
      if (depIds.length > 0) {
        await db.delete(ganttDependencies).where(inArray(ganttDependencies.id, depIds));
      }

      return {
        success: true,
        deleted: {
          tasks: taskIds.length,
          dependencies: depIds.length,
        },
        message: `Deleted ${taskIds.length} legacy tasks and ${depIds.length} legacy dependencies. Shared-project rows preserved.`,
      };
    }),

  /* ── 2. LIST TASKS (ordered by sort_order) ── */
  tasks: publicQuery.query(async () => selectGanttTasksForClient()),

  /* ── 3. LIST DEPENDENCIES ── */
  links: publicQuery
    .input(z.object({ projectId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const typeReverse: Record<string, string> = { "FS": "0", "SS": "1", "FF": "2", "SF": "3" };
      const sharedProjectIds = await getSharedProjectIds();
      let rows;
      if (input?.projectId) {
        await assertProjectNotShared(input.projectId);
        rows = await db.select().from(ganttDependencies).where(eq(ganttDependencies.projectId, input.projectId));
      } else {
        rows = await db.select().from(ganttDependencies);
      }
      return rows
        .filter((r) => !r.projectId || !sharedProjectIds.has(r.projectId))
        .map((r) => ({
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

  /* ── 4. SAVE TASK — partial merge for UPDATE, full for INSERT ── */
  saveTask: publicQuery
    .input(z.any())
    .mutation(async ({ input }) => {
      const v = input as Record<string, any>;
      const isUpdate = !!input.id;
      if (isUpdate) {
        await assertTaskNotShared(input.id);
      }
      const rawProjectId = v.project_id ?? v.projectId;
      if (typeof rawProjectId === "number") {
        await assertProjectNotShared(rawProjectId);
      }
      const now = new Date();

      /* HELPER: check if a key is explicitly present in the payload */
      const has = (key: string) => key in v;
      const hasAny = (keys: string[]) => keys.some(k => k in v);

      /* 1. taskName — ALWAYS required for INSERT; for UPDATE only if provided */
      let taskName: string | undefined;
      if (hasAny(["taskName", "task_name", "text", "name", "title"])) {
        taskName = (v.taskName ?? v.task_name ?? v.text ?? v.name ?? v.title ?? "").trim().replace(/'/g, "''");
      }
      if (!isUpdate && (!taskName || !taskName.trim())) throw new Error("task_name is required");

      /* 2. Build setData — ONLY include fields explicitly present in payload for UPDATE */
      const setData: Record<string, any> = {};

      if (taskName !== undefined) setData.taskName = taskName;
      if (has("frontend_task_uid") || has("frontendTaskUid")) setData.frontendTaskUid = v.frontend_task_uid ?? v.frontendTaskUid ?? null;
      if (has("project_id") || has("projectId")) setData.projectId = v.project_id ?? v.projectId ?? null;

      /* Parent / Predecessor */
      if (has("parent_task_id") || has("parent")) {
        setData.parentTaskId = typeof v.parent_task_id === "number" ? v.parent_task_id : (typeof v.parent === "number" ? v.parent : 0);
      }
      if (has("predecessor_task_id") || has("predecessorId")) {
        setData.predecessorTaskId = typeof v.predecessor_task_id === "number" ? v.predecessor_task_id : (typeof v.predecessorId === "number" ? v.predecessorId : null);
      }
      if (has("dependency_type") || has("dependencyType")) setData.dependencyType = v.dependency_type ?? v.dependencyType ?? null;
      if (has("lag_days")) setData.lagDays = typeof v.lag_days === "number" ? v.lag_days : 0;
      if (has("wbs_level")) setData.wbsLevel = typeof v.wbs_level === "number" ? v.wbs_level : 0;
      if (has("sort_order") || has("sortOrder")) {
        setData.sortOrder = typeof v.sort_order === "number" ? v.sort_order : (typeof v.sortOrder === "number" ? v.sortOrder : 0);
      }

      /* Planned dates */
      if (has("planned_start") || has("plannedStart")) {
        const ps = v.planned_start ?? v.plannedStart;
        setData.plannedStart = (typeof ps === "string" && ps) ? ps : null;
      }
      if (has("planned_finish") || has("plannedEnd") || has("planned_end")) {
        const pf = v.planned_finish ?? v.plannedEnd ?? v.planned_end;
        setData.plannedFinish = (typeof pf === "string" && pf) ? pf : null;
      }
      if (has("planned_duration") || has("duration")) {
        setData.plannedDuration = typeof v.planned_duration === "number" ? v.planned_duration : (typeof v.duration === "number" ? v.duration : null);
      }

      /* Actual dates */
      if (has("actual_start") || has("actualStart") || has("start_date")) {
        const ast = v.actual_start ?? v.actualStart ?? v.start_date;
        setData.actualStart = (typeof ast === "string" && ast) ? ast : null;
      }
      if (has("actual_finish") || has("actualEnd") || has("actual_end") || has("end_date")) {
        const af = v.actual_finish ?? v.actualEnd ?? v.actual_end ?? v.end_date;
        setData.actualFinish = (typeof af === "string" && af) ? af : null;
      }
      if (has("actual_duration")) setData.actualDuration = typeof v.actual_duration === "number" ? v.actual_duration : null;

      /* Progress / Status / Owner */
      if (has("progress_percent") || has("progress")) {
        setData.progressPercent = typeof v.progress_percent === "number" ? v.progress_percent : (typeof v.progress === "number" ? v.progress : 0);
      }
      if (has("status")) setData.status = v.status || null;
      if (has("owner")) setData.owner = (typeof v.owner === "string") ? (v.owner || null) : null;
      if (has("category")) setData.category = v.category || null;

      /* Notes */
      if (has("notes") || has("remarks")) setData.notes = v.notes ?? v.remarks ?? null;
      if (has("notes") || has("remarks")) setData.remarks = v.notes ?? v.remarks ?? null;

      /* Type / Milestone / Parent flags */
      if (has("task_type") || has("taskType")) {
        setData.taskType = v.task_type ?? v.taskType ?? "task";
      }
      if (has("is_milestone") || has("isMilestone")) {
        setData.isMilestone = (v.is_milestone ?? v.isMilestone ?? 0) ? 1 : 0;
      }
      if (has("is_parent") || has("isParent")) {
        setData.isParent = (v.is_parent ?? v.isParent ?? 0) ? 1 : 0;
      }

      const shouldSyncDependency = has("predecessor_task_id") || has("predecessorId") || has("dependency_type") || has("dependencyType");

      setData.updatedAt = now;

      try {
        let result: any;
        if (isUpdate) {
          /* UPDATE: only fields present in payload */
          if (Object.keys(setData).length === 1 && "updatedAt" in setData) {
            /* Nothing to update except timestamp */
            return { id: input.id, action: "no-op" };
          }
          result = await db.update(ganttTasks).set(setData).where(eq(ganttTasks.id, input.id)).returning({ id: ganttTasks.id });
        } else {
          /* INSERT: must provide all required fields */
          const insertData: Record<string, any> = { ...setData };
          if (!insertData.taskName) throw new Error("task_name is required");
          if (insertData.plannedStart === undefined) insertData.plannedStart = null;
          if (insertData.plannedFinish === undefined) insertData.plannedFinish = null;
          if (insertData.actualStart === undefined) insertData.actualStart = null;
          if (insertData.actualFinish === undefined) insertData.actualFinish = null;
          if (insertData.plannedDuration === undefined) insertData.plannedDuration = 1;
          if (insertData.progressPercent === undefined) insertData.progressPercent = 0;
          if (insertData.parentTaskId === undefined) insertData.parentTaskId = 0;
          if (insertData.sortOrder === undefined) insertData.sortOrder = 0;
          if (insertData.wbsLevel === undefined) insertData.wbsLevel = 0;
          if (insertData.taskType === undefined) insertData.taskType = "task";
          if (insertData.isMilestone === undefined) insertData.isMilestone = 0;
          if (insertData.isParent === undefined) insertData.isParent = 0;
          insertData.createdAt = now;
          result = await db.insert(ganttTasks).values(insertData as typeof ganttTasks.$inferInsert).returning({ id: ganttTasks.id });
        }
        const savedTaskId = result[0]?.id ?? input.id;

        /* Keep task-row predecessor fields and dependency rows in sync after the
           task ID is known. This is especially important for newly added tasks:
           syncing before INSERT used to try to create a dependency with an
           undefined successor ID. */
        if (shouldSyncDependency && savedTaskId) {
          await db.delete(ganttDependencies).where(eq(ganttDependencies.successorTaskId, savedTaskId));
          const depType = normalizeDependencyType(setData.dependencyType ?? (setData.predecessorTaskId ? "FS" : "NONE"));
          if (setData.predecessorTaskId && depType !== "NONE") {
            if (await wouldCreateDependencyCycle(setData.predecessorTaskId, savedTaskId)) throw new Error("Dependency cycle detected");
            await db.insert(ganttDependencies).values({
              predecessorTaskId: setData.predecessorTaskId,
              successorTaskId: savedTaskId,
              dependencyType: depType,
              lagDays: setData.lagDays || 0,
              projectId: setData.projectId ?? null,
            });
          }
        }

        return {
          id: savedTaskId,
          action: isUpdate ? "updated" : "created",
        };
      } catch (e: any) {
        throw new Error(`Save failed: ${e.message} | keys=${Object.keys(setData).join(",")}`);
      }
    }),


  /* ── 5. DELETE TASK (+ descendants and dependency cleanup) ── */
  deleteTask: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await assertTaskNotShared(input.id);
      const taskRows = await db
        .select({ id: ganttTasks.id, parentTaskId: ganttTasks.parentTaskId })
        .from(ganttTasks);
      const idsToDelete = collectTaskAndDescendantIds(input.id, taskRows);
      if (idsToDelete.length === 0) return { success: true, deleted: 0 };

      await db.delete(ganttDependencies).where(
        or(
          inArray(ganttDependencies.predecessorTaskId, idsToDelete),
          inArray(ganttDependencies.successorTaskId, idsToDelete)
        )
      );
      await db.delete(ganttTasks).where(inArray(ganttTasks.id, idsToDelete));
      return { success: true, deleted: idsToDelete.length };
    }),

  /* ── 6. SAVE DEPENDENCY (by DB IDs — validates first) ── */
  saveLink: publicQuery
    .input(z.object({
      expectedRevision: z.number().optional(),
      source: z.number(),
      target: z.number(),
      type: z.string().default("FS"),
      lag: z.number().default(0),
      projectId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      await assertTaskNotShared(input.source);
      await assertTaskNotShared(input.target);
      if (input.projectId !== undefined) await assertProjectNotShared(input.projectId);
      const predRows = await db.select({ id: ganttTasks.id }).from(ganttTasks).where(eq(ganttTasks.id, input.source));
      const succRows = await db.select({ id: ganttTasks.id }).from(ganttTasks).where(eq(ganttTasks.id, input.target));
      if (predRows.length === 0 || succRows.length === 0) {
        return { id: 0, action: "skipped", reason: "Task not found" };
      }
      await db.delete(ganttDependencies).where(eq(ganttDependencies.successorTaskId, input.target));
      const norm = normalizeDependencyType(input.type);
      if (norm === "NONE") {
        await db.update(ganttTasks).set({ predecessorTaskId: null, dependencyType: null, lagDays: 0 }).where(eq(ganttTasks.id, input.target));
        return { id: 0, action: "deleted" };
      }
      if (await wouldCreateDependencyCycle(input.source, input.target)) throw new Error("Dependency cycle detected");
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
      expectedRevision: z.number().optional(),
      sourceUid: z.string(),
      targetUid: z.string(),
      type: z.string().default("FS"),
      lag: z.number().default(0),
      projectId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const predRows = await db.select({ id: ganttTasks.id, projectId: ganttTasks.projectId }).from(ganttTasks).where(eq(ganttTasks.frontendTaskUid, input.sourceUid));
      const succRows = await db.select({ id: ganttTasks.id, projectId: ganttTasks.projectId }).from(ganttTasks).where(eq(ganttTasks.frontendTaskUid, input.targetUid));
      for (const row of [...predRows, ...succRows]) {
        if (row.projectId) await assertProjectNotShared(row.projectId);
      }
      if (input.projectId !== undefined) await assertProjectNotShared(input.projectId);
      if (predRows.length === 0 || succRows.length === 0) {
        return { id: 0, action: "skipped", reason: "UID not found" };
      }
      await db.delete(ganttDependencies).where(eq(ganttDependencies.successorTaskId, succRows[0].id));
      const norm = normalizeDependencyType(input.type);
      if (norm === "NONE") {
        await db.update(ganttTasks).set({ predecessorTaskId: null, dependencyType: null, lagDays: 0 }).where(eq(ganttTasks.id, succRows[0].id));
        return { id: 0, action: "deleted" };
      }
      if (await wouldCreateDependencyCycle(predRows[0].id, succRows[0].id)) throw new Error("Dependency cycle detected");
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
      await assertDependencyNotShared(input.id);
      const rows = await db.select({ target: ganttDependencies.successorTaskId }).from(ganttDependencies).where(eq(ganttDependencies.id, input.id));
      await db.delete(ganttDependencies).where(eq(ganttDependencies.id, input.id));
      if (rows[0]?.target) {
        await db.update(ganttTasks).set({ predecessorTaskId: null, dependencyType: null, lagDays: 0 }).where(eq(ganttTasks.id, rows[0].target));
      }
      return { success: true };
    }),

  /* ── 9. BATCH SAVE DEPENDENCIES ── */
  saveLinksBatch: publicQuery
    .input(z.array(z.object({
      expectedRevision: z.number().optional(),
      source: z.number(), target: z.number(),
      type: z.string(), lag: z.number().default(0),
      projectId: z.number().optional(),
    })))
    .mutation(async ({ input }) => {
      let count = 0;
      for (const dep of input) {
        try {
          await assertTaskNotShared(dep.source);
          await assertTaskNotShared(dep.target);
        } catch {
          continue;
        }
        if (dep.projectId !== undefined) {
          try { await assertProjectNotShared(dep.projectId); } catch { continue; }
        }
        const predExists = (await db.select({ id: ganttTasks.id }).from(ganttTasks).where(eq(ganttTasks.id, dep.source))).length > 0;
        const succExists = (await db.select({ id: ganttTasks.id }).from(ganttTasks).where(eq(ganttTasks.id, dep.target))).length > 0;
        if (!predExists || !succExists) continue;
        const norm = normalizeDependencyType(dep.type);
        if (norm === "NONE") continue;
        if (await wouldCreateDependencyCycle(dep.source, dep.target)) continue;
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
        await assertTaskNotShared(item.id);
        await db.update(ganttTasks).set({ sortOrder: item.sort_order }).where(eq(ganttTasks.id, item.id));
      }
      const persistedOrder = await selectGanttTasksForClient();
      return { updated: input.length, persistedOrder };
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
      const colNames = ((cols as unknown as { rows: any[] }).rows || []).map((r: any) => r.column_name);
      if (!colNames.includes("name")) {
        /* Old schema — drop and recreate all Gantt tables */
        try { await db.execute(sql.raw(`DROP TABLE IF EXISTS gantt_dependencies CASCADE`)); } catch {}
        try { await db.execute(sql.raw(`DROP TABLE IF EXISTS gantt_tasks CASCADE`)); } catch {}
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
