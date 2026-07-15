import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type {
  GanttAssignmentInput,
  GanttDependencyInput,
  GanttProjectInput,
  GanttTaskInput,
  GanttTaskPatch,
} from "@contracts/gantt";
import {
  ganttAssignments,
  ganttCalendars,
  ganttDependencies,
  ganttProjects,
  ganttTasks,
} from "@db/schema";
import { db } from "./queries/connection";
import type { GanttScope } from "./gantt-scope";
import {
  collectDescendantIds,
  GanttDomainError,
  validateDependencyGraph,
  validateHierarchyAssignment,
} from "./gantt-domain";

type DatabaseClient = Parameters<Parameters<typeof db.transaction>[0]>[0];
type TaskRow = typeof ganttTasks.$inferSelect;
type DependencyRow = typeof ganttDependencies.$inferSelect;

export type ImportedTask = GanttTaskInput & { sourceId: number; parentSourceId: number | null };
export type ImportedDependency = Omit<GanttDependencyInput, "predecessorTaskId" | "successorTaskId"> & {
  predecessorSourceId: number;
  successorSourceId: number;
};
export type ImportedAssignment = Omit<GanttAssignmentInput, "taskId"> & { taskSourceId: number };

function projectScopeFilter(scope: GanttScope) {
  return scope.kind === "user"
    ? eq(ganttProjects.userId, scope.userId)
    : and(isNull(ganttProjects.userId), eq(ganttProjects.sessionId, scope.sessionId));
}

function calendarScopeFilter(scope: GanttScope) {
  return scope.kind === "user"
    ? eq(ganttCalendars.ownerId, scope.userId)
    : and(isNull(ganttCalendars.ownerId), eq(ganttCalendars.sessionId, scope.sessionId));
}

async function requireProject(client: DatabaseClient | typeof db, scope: GanttScope, projectId: number) {
  const rows = await client
    .select()
    .from(ganttProjects)
    .where(and(eq(ganttProjects.id, projectId), projectScopeFilter(scope)))
    .limit(1);
  if (!rows[0]) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
  }
  return rows[0];
}

async function validateCalendar(
  client: DatabaseClient,
  scope: GanttScope,
  calendarId: number | null | undefined,
) {
  if (calendarId === null || calendarId === undefined) return;
  const rows = await client.select({ id: ganttCalendars.id }).from(ganttCalendars).where(and(
    eq(ganttCalendars.id, calendarId),
    calendarScopeFilter(scope),
  )).limit(1);
  if (!rows[0]) throw new TRPCError({ code: "BAD_REQUEST", message: "Calendar is unavailable in this workspace." });
}

function toTaskValues(projectId: number, task: GanttTaskInput | GanttTaskPatch) {
  const values: Partial<typeof ganttTasks.$inferInsert> = { projectId, updatedAt: new Date() };
  if ("name" in task && task.name !== undefined) values.taskName = task.name;
  if ("frontendTaskUid" in task && task.frontendTaskUid !== undefined) values.frontendTaskUid = task.frontendTaskUid;
  if ("parentId" in task && task.parentId !== undefined) values.parentTaskId = task.parentId ?? null;
  if ("taskType" in task && task.taskType !== undefined) {
    values.taskType = task.taskType;
    values.isMilestone = task.taskType === "milestone" ? 1 : 0;
  }
  if ("category" in task && task.category !== undefined) values.category = task.category;
  if ("sortOrder" in task && task.sortOrder !== undefined) values.sortOrder = task.sortOrder;
  if ("plannedStart" in task && task.plannedStart !== undefined) values.plannedStart = task.plannedStart;
  if ("plannedEnd" in task && task.plannedEnd !== undefined) values.plannedFinish = task.plannedEnd;
  if ("actualStart" in task && task.actualStart !== undefined) values.actualStart = task.actualStart;
  if ("actualEnd" in task && task.actualEnd !== undefined) values.actualFinish = task.actualEnd;
  if ("duration" in task && task.duration !== undefined) values.plannedDuration = task.duration;
  if ("actualDuration" in task && task.actualDuration !== undefined) values.actualDuration = task.actualDuration;
  if ("progress" in task && task.progress !== undefined) values.progressPercent = task.progress;
  if ("status" in task && task.status !== undefined) values.status = task.status;
  if ("owner" in task && task.owner !== undefined) values.owner = task.owner;
  if ("notes" in task && task.notes !== undefined) {
    values.notes = task.notes;
    values.remarks = task.notes;
  }
  return values;
}

function normalizeDomainError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof GanttDomainError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw error;
}

async function validateParent(
  client: DatabaseClient,
  projectId: number,
  taskId: number,
  parentId: number | null | undefined,
) {
  if (parentId === undefined) return;
  const tasks = await client
    .select({ id: ganttTasks.id, parentId: ganttTasks.parentTaskId })
    .from(ganttTasks)
    .where(eq(ganttTasks.projectId, projectId));
  validateHierarchyAssignment(tasks, taskId, parentId ?? null);
}

async function validateAndReplaceIncomingDependencies(
  client: DatabaseClient,
  projectId: number,
  successorTaskId: number,
  incoming: Array<Omit<GanttDependencyInput, "successorTaskId">>,
) {
  const [tasks, existing] = await Promise.all([
    client.select({ id: ganttTasks.id }).from(ganttTasks).where(eq(ganttTasks.projectId, projectId)),
    client.select().from(ganttDependencies).where(eq(ganttDependencies.projectId, projectId)),
  ]);
  const proposed = existing
    .filter(dependency => dependency.successorTaskId !== successorTaskId)
    .map(dependency => ({
      predecessorTaskId: dependency.predecessorTaskId,
      successorTaskId: dependency.successorTaskId,
    }));
  proposed.push(...incoming.map(dependency => ({
    predecessorTaskId: dependency.predecessorTaskId,
    successorTaskId,
  })));
  validateDependencyGraph(tasks.map(task => task.id), proposed);

  await client.delete(ganttDependencies).where(and(
    eq(ganttDependencies.projectId, projectId),
    eq(ganttDependencies.successorTaskId, successorTaskId),
  ));
  if (incoming.length > 0) {
    await client.insert(ganttDependencies).values(incoming.map(dependency => ({
      projectId,
      predecessorTaskId: dependency.predecessorTaskId,
      successorTaskId,
      dependencyType: dependency.relationshipType,
      lagDays: dependency.lag,
      lagUnit: dependency.lagUnit,
    })));
  }
}

export const ganttRepository = {
  async listProjects(scope: GanttScope) {
    return db
      .select({
        id: ganttProjects.id,
        name: ganttProjects.name,
        description: ganttProjects.description,
        status: ganttProjects.status,
        statusDate: ganttProjects.statusDate,
        calendarId: ganttProjects.calendarId,
        version: ganttProjects.version,
        createdAt: ganttProjects.createdAt,
        updatedAt: ganttProjects.updatedAt,
      })
      .from(ganttProjects)
      .where(projectScopeFilter(scope))
      .orderBy(desc(ganttProjects.updatedAt));
  },

  async loadProject(scope: GanttScope, projectId: number) {
    return db.transaction(async tx => {
      const project = await requireProject(tx, scope, projectId);
      const [tasks, dependencies, assignments] = await Promise.all([
        tx.select().from(ganttTasks).where(eq(ganttTasks.projectId, projectId)).orderBy(asc(ganttTasks.sortOrder), asc(ganttTasks.id)),
        tx.select().from(ganttDependencies).where(eq(ganttDependencies.projectId, projectId)).orderBy(asc(ganttDependencies.id)),
        tx.select().from(ganttAssignments).where(eq(ganttAssignments.projectId, projectId)).orderBy(asc(ganttAssignments.id)),
      ]);
      return { project, tasks, dependencies, assignments };
    }, { isolationLevel: "repeatable read" });
  },

  async createProject(scope: GanttScope, input: GanttProjectInput) {
    return db.transaction(async tx => {
      await validateCalendar(tx, scope, input.calendarId);
      const created = await tx.insert(ganttProjects).values({
        name: input.name,
        description: input.description ?? null,
        status: input.status ?? null,
        statusDate: input.statusDate ?? null,
        calendarId: input.calendarId ?? null,
        tasksData: "[]",
        linksData: "[]",
        userId: scope.kind === "user" ? scope.userId : null,
        ownerId: scope.kind === "user" ? scope.userId : null,
        sessionId: scope.kind === "anonymous" ? scope.sessionId : null,
        version: 0,
      }).returning();
      return created[0]!;
    });
  },

  async cloneProject(scope: GanttScope, sourceProjectId: number, name: string) {
    return db.transaction(async tx => {
      const source = await requireProject(tx, scope, sourceProjectId);
      await validateCalendar(tx, scope, source.calendarId);
      const created = await tx.insert(ganttProjects).values({
        name,
        description: source.description,
        status: source.status,
        statusDate: source.statusDate,
        calendarId: source.calendarId,
        tasksData: "[]",
        linksData: "[]",
        userId: scope.kind === "user" ? scope.userId : null,
        ownerId: scope.kind === "user" ? scope.userId : null,
        sessionId: scope.kind === "anonymous" ? scope.sessionId : null,
        version: 0,
      }).returning();
      const target = created[0]!;
      const [tasks, dependencies, assignments] = await Promise.all([
        tx.select().from(ganttTasks).where(eq(ganttTasks.projectId, sourceProjectId)).orderBy(asc(ganttTasks.sortOrder), asc(ganttTasks.id)),
        tx.select().from(ganttDependencies).where(eq(ganttDependencies.projectId, sourceProjectId)),
        tx.select().from(ganttAssignments).where(eq(ganttAssignments.projectId, sourceProjectId)),
      ]);
      const idMap = new Map<number, number>();
      for (const task of tasks) {
        const inserted = await tx.insert(ganttTasks).values({
          projectId: target.id,
          frontendTaskUid: crypto.randomUUID(),
          taskName: task.taskName,
          parentTaskId: null,
          predecessorTaskId: null,
          dependencyType: null,
          lagDays: 0,
          wbsLevel: task.wbsLevel,
          sortOrder: task.sortOrder,
          plannedStart: task.plannedStart,
          plannedFinish: task.plannedFinish,
          plannedDuration: task.plannedDuration,
          actualStart: task.actualStart,
          actualFinish: task.actualFinish,
          actualDuration: task.actualDuration,
          progressPercent: task.progressPercent,
          status: task.status,
          owner: task.owner,
          category: task.category,
          notes: task.notes,
          remarks: task.remarks,
          taskType: task.taskType,
          isMilestone: task.isMilestone,
          isParent: task.isParent,
        }).returning({ id: ganttTasks.id });
        idMap.set(task.id, inserted[0]!.id);
      }
      for (const task of tasks) {
        const parentId = task.parentTaskId ? idMap.get(task.parentTaskId) : null;
        if (parentId) await tx.update(ganttTasks).set({ parentTaskId: parentId }).where(and(
          eq(ganttTasks.projectId, target.id),
          eq(ganttTasks.id, idMap.get(task.id)!),
        ));
      }
      if (dependencies.length > 0) await tx.insert(ganttDependencies).values(dependencies.map(dependency => ({
        projectId: target.id,
        predecessorTaskId: idMap.get(dependency.predecessorTaskId)!,
        successorTaskId: idMap.get(dependency.successorTaskId)!,
        dependencyType: dependency.dependencyType,
        lagDays: dependency.lagDays,
        lagUnit: dependency.lagUnit,
      })));
      if (assignments.length > 0) await tx.insert(ganttAssignments).values(assignments.map(assignment => ({
        projectId: target.id,
        taskId: idMap.get(assignment.taskId)!,
        resourceId: assignment.resourceId,
        units: assignment.units,
        role: assignment.role,
      })));
      return target;
    });
  },

  async updateProject(scope: GanttScope, projectId: number, input: GanttProjectInput) {
    return db.transaction(async tx => {
      const current = await requireProject(tx, scope, projectId);
      await validateCalendar(tx, scope, input.calendarId);
      if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
        throw new TRPCError({ code: "CONFLICT", message: "Project changed since it was opened." });
      }
      const updated = await tx.update(ganttProjects).set({
        name: input.name,
        description: input.description !== undefined ? input.description : current.description,
        status: input.status !== undefined ? input.status : current.status,
        statusDate: input.statusDate !== undefined ? input.statusDate : current.statusDate,
        calendarId: input.calendarId !== undefined ? input.calendarId : current.calendarId,
        version: sql`${ganttProjects.version} + 1`,
        updatedAt: new Date(),
      }).where(and(eq(ganttProjects.id, projectId), projectScopeFilter(scope))).returning();
      return updated[0]!;
    });
  },

  async saveTask(
    scope: GanttScope,
    projectId: number,
    task: GanttTaskInput | GanttTaskPatch,
    incomingDependencies?: Array<Omit<GanttDependencyInput, "successorTaskId">>,
  ) {
    try {
      return await db.transaction(async tx => {
        await requireProject(tx, scope, projectId);
        const values = toTaskValues(projectId, task);
        let saved: TaskRow;
        if (task.id) {
          const existing = await tx.select().from(ganttTasks).where(and(
            eq(ganttTasks.id, task.id),
            eq(ganttTasks.projectId, projectId),
          )).limit(1);
          if (!existing[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." });
          await validateParent(tx, projectId, task.id, task.parentId);
          const rows = await tx.update(ganttTasks).set(values).where(and(
            eq(ganttTasks.id, task.id),
            eq(ganttTasks.projectId, projectId),
          )).returning();
          saved = rows[0]!;
        } else {
          if (!("name" in task) || typeof task.name !== "string" || !("sortOrder" in task)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "New tasks require complete task data." });
          }
          const taskName = task.name;
          const rows = await tx.insert(ganttTasks).values({
            ...values,
            projectId,
            taskName,
            parentTaskId: null,
            sortOrder: task.sortOrder,
            taskType: task.taskType ?? "task",
            plannedDuration: task.duration,
            progressPercent: task.progress,
            createdAt: new Date(),
          }).returning();
          saved = rows[0]!;
          if (task.parentId) {
            await validateParent(tx, projectId, saved.id, task.parentId);
            const parentRows = await tx.update(ganttTasks).set({ parentTaskId: task.parentId }).where(and(
              eq(ganttTasks.id, saved.id),
              eq(ganttTasks.projectId, projectId),
            )).returning();
            saved = parentRows[0]!;
          }
        }
        if (incomingDependencies !== undefined) {
          await validateAndReplaceIncomingDependencies(tx, projectId, saved.id, incomingDependencies);
        }
        await tx.update(ganttProjects).set({ version: sql`${ganttProjects.version} + 1`, updatedAt: new Date() }).where(and(
          eq(ganttProjects.id, projectId),
          projectScopeFilter(scope),
        ));
        return saved;
      });
    } catch (error) {
      return normalizeDomainError(error);
    }
  },

  async deleteTask(scope: GanttScope, projectId: number, taskId: number) {
    return db.transaction(async tx => {
      await requireProject(tx, scope, projectId);
      const tasks = await tx.select({ id: ganttTasks.id, parentId: ganttTasks.parentTaskId }).from(ganttTasks).where(eq(ganttTasks.projectId, projectId));
      if (!tasks.some(task => task.id === taskId)) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." });
      const ids = collectDescendantIds(tasks, taskId);
      await tx.delete(ganttAssignments).where(and(eq(ganttAssignments.projectId, projectId), inArray(ganttAssignments.taskId, ids)));
      const dependencies = await tx.select().from(ganttDependencies).where(eq(ganttDependencies.projectId, projectId));
      const dependencyIds = dependencies.filter(dependency => ids.includes(dependency.predecessorTaskId) || ids.includes(dependency.successorTaskId)).map(dependency => dependency.id);
      if (dependencyIds.length > 0) await tx.delete(ganttDependencies).where(and(
        eq(ganttDependencies.projectId, projectId),
        inArray(ganttDependencies.id, dependencyIds),
      ));
      await tx.delete(ganttTasks).where(and(eq(ganttTasks.projectId, projectId), inArray(ganttTasks.id, ids)));
      await tx.update(ganttProjects).set({ version: sql`${ganttProjects.version} + 1`, updatedAt: new Date() }).where(and(
        eq(ganttProjects.id, projectId),
        projectScopeFilter(scope),
      ));
      return { deleted: ids.length };
    });
  },

  async replaceIncomingDependencies(
    scope: GanttScope,
    projectId: number,
    successorTaskId: number,
    dependencies: Array<Omit<GanttDependencyInput, "successorTaskId">>,
  ) {
    try {
      return await db.transaction(async tx => {
        await requireProject(tx, scope, projectId);
        await validateAndReplaceIncomingDependencies(tx, projectId, successorTaskId, dependencies);
        await tx.update(ganttProjects).set({ version: sql`${ganttProjects.version} + 1`, updatedAt: new Date() }).where(and(
          eq(ganttProjects.id, projectId),
          projectScopeFilter(scope),
        ));
        return { count: dependencies.length };
      });
    } catch (error) {
      return normalizeDomainError(error);
    }
  },

  async addDependency(scope: GanttScope, projectId: number, dependency: GanttDependencyInput) {
    try {
      return await db.transaction(async tx => {
        await requireProject(tx, scope, projectId);
        const [tasks, existing] = await Promise.all([
          tx.select({ id: ganttTasks.id }).from(ganttTasks).where(eq(ganttTasks.projectId, projectId)),
          tx.select().from(ganttDependencies).where(eq(ganttDependencies.projectId, projectId)),
        ]);
        const proposed = existing.map(item => ({ predecessorTaskId: item.predecessorTaskId, successorTaskId: item.successorTaskId }));
        proposed.push(dependency);
        validateDependencyGraph(tasks.map(task => task.id), proposed);
        const inserted = await tx.insert(ganttDependencies).values({
          projectId,
          predecessorTaskId: dependency.predecessorTaskId,
          successorTaskId: dependency.successorTaskId,
          dependencyType: dependency.relationshipType,
          lagDays: dependency.lag,
          lagUnit: dependency.lagUnit,
        }).returning();
        await tx.update(ganttProjects).set({ version: sql`${ganttProjects.version} + 1`, updatedAt: new Date() }).where(and(
          eq(ganttProjects.id, projectId),
          projectScopeFilter(scope),
        ));
        return inserted[0]!;
      });
    } catch (error) {
      return normalizeDomainError(error);
    }
  },

  async deleteDependency(scope: GanttScope, projectId: number, dependencyId: number) {
    return db.transaction(async tx => {
      await requireProject(tx, scope, projectId);
      const deleted = await tx.delete(ganttDependencies).where(and(
        eq(ganttDependencies.id, dependencyId),
        eq(ganttDependencies.projectId, projectId),
      )).returning({ id: ganttDependencies.id });
      if (!deleted[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Dependency not found." });
      await tx.update(ganttProjects).set({ version: sql`${ganttProjects.version} + 1`, updatedAt: new Date() }).where(and(
        eq(ganttProjects.id, projectId),
        projectScopeFilter(scope),
      ));
      return { success: true };
    });
  },

  async reorderTasks(scope: GanttScope, projectId: number, updates: Array<{ id: number; sortOrder: number }>) {
    return db.transaction(async tx => {
      await requireProject(tx, scope, projectId);
      const ids = updates.map(update => update.id);
      const tasks = ids.length > 0
        ? await tx.select({ id: ganttTasks.id }).from(ganttTasks).where(and(eq(ganttTasks.projectId, projectId), inArray(ganttTasks.id, ids)))
        : [];
      if (tasks.length !== new Set(ids).size) throw new TRPCError({ code: "BAD_REQUEST", message: "Reorder includes an unavailable task." });
      for (const update of updates) {
        await tx.update(ganttTasks).set({ sortOrder: update.sortOrder, updatedAt: new Date() }).where(and(
          eq(ganttTasks.id, update.id),
          eq(ganttTasks.projectId, projectId),
        ));
      }
      await tx.update(ganttProjects).set({ version: sql`${ganttProjects.version} + 1`, updatedAt: new Date() }).where(and(
        eq(ganttProjects.id, projectId),
        projectScopeFilter(scope),
      ));
      return { updated: updates.length };
    });
  },

  async updateHierarchy(
    scope: GanttScope,
    projectId: number,
    updates: Array<{ id: number; parentId: number | null; sortOrder: number }>,
  ) {
    try {
      return await db.transaction(async tx => {
        await requireProject(tx, scope, projectId);
        const tasks = await tx
          .select({ id: ganttTasks.id, parentId: ganttTasks.parentTaskId })
          .from(ganttTasks)
          .where(eq(ganttTasks.projectId, projectId));
        const ids = new Set(tasks.map(task => task.id));
        if (updates.some(update => !ids.has(update.id))) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Hierarchy update includes an unavailable task." });
        }
        const parentById = new Map(tasks.map(task => [task.id, task.parentId]));
        for (const update of updates) parentById.set(update.id, update.parentId ?? null);
        const proposed = tasks.map(task => ({ id: task.id, parentId: parentById.get(task.id) ?? null }));
        for (const update of updates) {
          validateHierarchyAssignment(proposed, update.id, update.parentId);
        }
        for (const update of updates) {
          await tx.update(ganttTasks).set({
            parentTaskId: update.parentId ?? null,
            sortOrder: update.sortOrder,
            updatedAt: new Date(),
          }).where(and(eq(ganttTasks.id, update.id), eq(ganttTasks.projectId, projectId)));
        }
        await tx.update(ganttProjects).set({
          version: sql`${ganttProjects.version} + 1`,
          updatedAt: new Date(),
        }).where(and(eq(ganttProjects.id, projectId), projectScopeFilter(scope)));
        return { updated: updates.length };
      });
    } catch (error) {
      return normalizeDomainError(error);
    }
  },

  async clearProject(scope: GanttScope, projectId: number) {
    return db.transaction(async tx => {
      await requireProject(tx, scope, projectId);
      await tx.delete(ganttAssignments).where(eq(ganttAssignments.projectId, projectId));
      await tx.delete(ganttDependencies).where(eq(ganttDependencies.projectId, projectId));
      await tx.delete(ganttTasks).where(eq(ganttTasks.projectId, projectId));
      await tx.update(ganttProjects).set({ version: sql`${ganttProjects.version} + 1`, updatedAt: new Date() }).where(and(
        eq(ganttProjects.id, projectId),
        projectScopeFilter(scope),
      ));
      return { success: true };
    });
  },

  async replaceProjectPlan(
    scope: GanttScope,
    projectId: number,
    tasks: ImportedTask[],
    dependencies: ImportedDependency[],
    assignments: ImportedAssignment[],
  ) {
    try {
      return await db.transaction(async tx => {
        await requireProject(tx, scope, projectId);
        const sourceIds = tasks.map(task => task.sourceId);
        if (new Set(sourceIds).size !== sourceIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Imported task IDs must be unique." });
        const sourceIdSet = new Set(sourceIds);
        if (assignments.some(assignment => !sourceIdSet.has(assignment.taskSourceId))) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Assignment task is unavailable in the imported project." });
        }
        validateDependencyGraph(sourceIds, dependencies.map(dependency => ({
          predecessorTaskId: dependency.predecessorSourceId,
          successorTaskId: dependency.successorSourceId,
        })));
        for (const task of tasks) validateHierarchyAssignment(
          tasks.map(item => ({ id: item.sourceId, parentId: item.parentSourceId })),
          task.sourceId,
          task.parentSourceId,
        );

        await tx.delete(ganttAssignments).where(eq(ganttAssignments.projectId, projectId));
        await tx.delete(ganttDependencies).where(eq(ganttDependencies.projectId, projectId));
        await tx.delete(ganttTasks).where(eq(ganttTasks.projectId, projectId));

        const idMap = new Map<number, number>();
        for (const task of tasks) {
          const inserted = await tx.insert(ganttTasks).values({
            ...toTaskValues(projectId, task),
            projectId,
            taskName: task.name,
            parentTaskId: null,
            sortOrder: task.sortOrder,
            plannedDuration: task.duration,
            progressPercent: task.progress,
            taskType: task.taskType,
            createdAt: new Date(),
          }).returning({ id: ganttTasks.id });
          idMap.set(task.sourceId, inserted[0]!.id);
        }
        for (const task of tasks) {
          const parentId = task.parentSourceId ? idMap.get(task.parentSourceId) : null;
          if (parentId) await tx.update(ganttTasks).set({ parentTaskId: parentId }).where(and(
            eq(ganttTasks.id, idMap.get(task.sourceId)!),
            eq(ganttTasks.projectId, projectId),
          ));
        }
        if (dependencies.length > 0) await tx.insert(ganttDependencies).values(dependencies.map(dependency => ({
          projectId,
          predecessorTaskId: idMap.get(dependency.predecessorSourceId)!,
          successorTaskId: idMap.get(dependency.successorSourceId)!,
          dependencyType: dependency.relationshipType,
          lagDays: dependency.lag,
          lagUnit: dependency.lagUnit,
        })));
        if (assignments.length > 0) await tx.insert(ganttAssignments).values(assignments.map(assignment => ({
          projectId,
          taskId: idMap.get(assignment.taskSourceId)!,
          resourceId: assignment.resourceId,
          units: assignment.units,
          role: assignment.role ?? null,
        })));
        await tx.update(ganttProjects).set({ version: sql`${ganttProjects.version} + 1`, updatedAt: new Date() }).where(and(
          eq(ganttProjects.id, projectId),
          projectScopeFilter(scope),
        ));
        return { tasks: tasks.length, dependencies: dependencies.length, assignments: assignments.length };
      });
    } catch (error) {
      return normalizeDomainError(error);
    }
  },

  async deleteProject(scope: GanttScope, projectId: number) {
    return db.transaction(async tx => {
      const project = await requireProject(tx, scope, projectId);
      await tx.delete(ganttAssignments).where(eq(ganttAssignments.projectId, projectId));
      await tx.delete(ganttDependencies).where(eq(ganttDependencies.projectId, projectId));
      await tx.delete(ganttTasks).where(eq(ganttTasks.projectId, projectId));
      await tx.delete(ganttProjects).where(and(eq(ganttProjects.id, projectId), projectScopeFilter(scope)));
      return { id: project.id, name: project.name };
    });
  },
};

export function mapTaskForClient(row: TaskRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    frontendTaskUid: row.frontendTaskUid,
    name: row.taskName,
    parentId: row.parentTaskId,
    taskType: row.taskType ?? "task",
    category: row.category,
    sortOrder: row.sortOrder ?? 0,
    plannedStart: row.plannedStart,
    plannedEnd: row.plannedFinish,
    actualStart: row.actualStart,
    actualEnd: row.actualFinish,
    duration: row.plannedDuration ?? 0,
    actualDuration: row.actualDuration,
    progress: row.progressPercent ?? 0,
    status: row.status,
    owner: row.owner,
    notes: row.notes ?? row.remarks,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapDependencyForClient(row: DependencyRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    predecessorTaskId: row.predecessorTaskId,
    successorTaskId: row.successorTaskId,
    relationshipType: row.dependencyType as "FS" | "SS" | "FF" | "SF",
    lag: row.lagDays ?? 0,
    lagUnit: row.lagUnit as "day",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
