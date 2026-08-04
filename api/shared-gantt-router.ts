import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { db } from "./queries/connection";
import {
  ganttProjects,
  ganttTasks,
  ganttDependencies,
  ganttProjectEvents,
} from "@db/schema";
import { eq, and, sql, asc, inArray, or } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { TRPCError } from "@trpc/server";
import {
  generateShareTokens,
  generateTokenWithHash,
  hashToken,
} from "@/modules/gantt/collaboration/accessToken";
import { checkRateLimit } from "@/modules/gantt/collaboration/rateLimit";
import { isValidGanttDate } from "@/modules/gantt/collaboration/dateValidation";

const VALID_DEPENDENCY_TYPES = ["FS", "SS", "FF", "SF"] as const;
function getMaxProjectTasks(): number {
  const env = process.env.GANTT_MAX_TASKS;
  const n = env ? Number(env) : NaN;
  return Number.isInteger(n) && n > 0 ? n : 1000;
}

function getMaxProjectDependencies(): number {
  const env = process.env.GANTT_MAX_DEPENDENCIES;
  const n = env ? Number(env) : NaN;
  return Number.isInteger(n) && n > 0 ? n : 2000;
}
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_NOTES_LENGTH = 5000;
const MAX_NAME_LENGTH = 255;
const MAX_ACTOR_NAME_LENGTH = 100;
const MAX_REQUEST_BODY_BYTES = 256 * 1024; // 256 KB

const dateStringSchema = z
  .string()
  .max(20)
  .refine(
    (v) => !v || isValidGanttDate(v),
    { message: "Date must be a valid YYYY-MM-DD or YYYY-MM-DD HH:MM" }
  );

const taskInputSchema = z.object({
  frontendTaskUid: z.string().max(64).optional().nullable(),
  taskName: z.string().min(1).max(500),
  parentTaskId: z.number().int().nonnegative().default(0),
  predecessorTaskId: z.number().int().positive().optional().nullable(),
  dependencyType: z.string().max(10).optional().nullable(),
  lagDays: z.number().int().default(0),
  wbsLevel: z.number().int().nonnegative().default(0),
  sortOrder: z.number().int().default(0),
  plannedStart: dateStringSchema.optional().nullable(),
  plannedFinish: dateStringSchema.optional().nullable(),
  plannedDuration: z.number().int().nonnegative().optional().nullable(),
  actualStart: dateStringSchema.optional().nullable(),
  actualFinish: dateStringSchema.optional().nullable(),
  actualDuration: z.number().int().nonnegative().optional().nullable(),
  progressPercent: z.number().int().min(0).max(100).default(0),
  status: z.string().max(50).optional().nullable(),
  owner: z.string().max(255).optional().nullable(),
  category: z.string().max(100).optional().nullable(),
  notes: z.string().max(MAX_NOTES_LENGTH).optional().nullable(),
  remarks: z.string().max(MAX_NOTES_LENGTH).optional().nullable(),
  taskType: z.string().max(20).default("task"),
  isMilestone: z.number().int().min(0).max(1).default(0),
  isParent: z.number().int().min(0).max(1).default(0),
});

const projectChangesSchema = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
  projectName: z.string().max(MAX_NAME_LENGTH).optional(),
  startDate: dateStringSchema.optional().nullable(),
  finishDate: dateStringSchema.optional().nullable(),
  status: z.string().max(50).optional().nullable(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional().nullable(),
  dataDate: dateStringSchema.optional().nullable(),
  defaultCalendarId: z.number().int().positive().optional().nullable(),
});

const projectShareInputSchema = z.object({
  regenerateEditor: z.boolean().default(false),
  regenerateViewer: z.boolean().default(false),
  revokeEditor: z.boolean().default(false),
  revokeViewer: z.boolean().default(false),
  confirmed: z.boolean().default(false),
});

const taskUpdateChangesSchema = taskInputSchema.partial();

type AccessContext = {
  projectId: number;
  projectRevision: number;
  role: "editor" | "viewer";
  actorName?: string;
};

/** Resolve a project by slug and access token. Returns role or throws. */
async function resolveProjectAccess(
  slug: string,
  accessToken: string
): Promise<AccessContext> {
  const tokenHash = await hashToken(accessToken);
  const rows = await db
    .select({
      id: ganttProjects.id,
      revision: ganttProjects.revision,
      sharingEnabled: ganttProjects.sharingEnabled,
      editTokenHash: ganttProjects.editTokenHash,
      viewTokenHash: ganttProjects.viewTokenHash,
    })
    .from(ganttProjects)
    .where(eq(ganttProjects.slug, slug));

  if (rows.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }

  const project = rows[0];

  if (!project.sharingEnabled) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Project sharing is not enabled",
    });
  }

  let role: "editor" | "viewer" | null = null;
  if (project.editTokenHash && project.editTokenHash === tokenHash) role = "editor";
  else if (project.viewTokenHash && project.viewTokenHash === tokenHash) role = "viewer";

  if (!role) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid access token",
    });
  }

  return {
    projectId: project.id,
    projectRevision: project.revision,
    role,
  };
}

function requireEditor(ctx: AccessContext) {
  if (ctx.role !== "editor") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "View-only link cannot modify this project",
    });
  }
}

function requireConfirmation(confirmed: boolean) {
  if (!confirmed) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This action requires explicit confirmation. Set confirmed: true to proceed.",
    });
  }
}

async function insertEvent(
  tx: PgTransaction<any, any, any>,
  ctx: AccessContext,
  entityType: string,
  action: string,
  entityId?: number,
  before?: unknown,
  after?: unknown
) {
  await tx.insert(ganttProjectEvents).values({
    projectId: ctx.projectId,
    entityType,
    entityId: entityId ?? null,
    action,
    actorName: ctx.actorName ?? "Anonymous",
    beforeData: before ? JSON.stringify(before) : null,
    afterData: after ? JSON.stringify(after) : null,
    projectRevision: ctx.projectRevision,
  });
}

async function bumpProjectRevision(
  tx: PgTransaction<any, any, any>,
  projectId: number
): Promise<number> {
  const updated = await tx
    .update(ganttProjects)
    .set({ revision: sql`${ganttProjects.revision} + 1`, updatedAt: new Date() })
    .where(eq(ganttProjects.id, projectId))
    .returning({ revision: ganttProjects.revision });
  if (!updated[0]) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to increment project revision" });
  }
  return updated[0].revision;
}

export async function dependencyWouldCreateCycle(
  tx: PgTransaction<any, any, any>,
  projectId: number,
  source: number,
  target: number,
  excludeId?: number
): Promise<boolean> {
  if (!source || !target) return false;
  if (source === target) return true;
  const deps = await tx
    .select({ id: ganttDependencies.id, source: ganttDependencies.predecessorTaskId, target: ganttDependencies.successorTaskId })
    .from(ganttDependencies)
    .where(eq(ganttDependencies.projectId, projectId));
  const successors = new Map<number, number[]>();
  for (const dep of deps) {
    if (excludeId !== undefined && dep.id === excludeId) continue;
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

export async function validateTaskParent(
  tx: PgTransaction<any, any, any>,
  projectId: number,
  taskId: number | undefined,
  parentTaskId: number
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (parentTaskId === 0) return { ok: true };
  if (taskId !== undefined && parentTaskId === taskId) {
    return { ok: false, reason: "A task cannot be its own parent" };
  }
  const parents = await tx
    .select({ id: ganttTasks.id, projectId: ganttTasks.projectId })
    .from(ganttTasks)
    .where(eq(ganttTasks.id, parentTaskId));
  if (parents.length === 0) {
    return { ok: false, reason: "Parent task not found" };
  }
  if (parents[0].projectId !== projectId) {
    return { ok: false, reason: "Parent task belongs to a different project" };
  }
  return { ok: true };
}

export async function validateTaskParentWithCycleCheck(
  tx: PgTransaction<any, any, any>,
  projectId: number,
  taskId: number | undefined,
  parentTaskId: number,
  skipProjectLock: boolean = false
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Serialize hierarchy validation for the whole project so concurrent
  // parent updates cannot both read an inconsistent snapshot.
  if (!skipProjectLock) {
    await lockProject(tx, projectId);
  }

  const base = await validateTaskParent(tx, projectId, taskId, parentTaskId);
  if (!base.ok) return base;

  const allTasks = await tx
    .select({ id: ganttTasks.id, parentTaskId: ganttTasks.parentTaskId })
    .from(ganttTasks)
    .where(eq(ganttTasks.projectId, projectId));
  if (wbsWouldCreateCycle(allTasks, taskId, parentTaskId)) {
    return { ok: false, reason: "Parent assignment would create a WBS hierarchy cycle" };
  }
  return { ok: true };
}

export function validateActualDateOrdering(values: {
  actualStart?: string | null;
  actualFinish?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  const { actualStart, actualFinish } = values;
  if (!actualStart || !actualFinish) return { ok: true };
  const start = new Date(actualStart.replace(" ", "T"));
  const finish = new Date(actualFinish.replace(" ", "T"));
  if (Number.isNaN(start.getTime()) || Number.isNaN(finish.getTime())) return { ok: true };
  if (finish < start) {
    return { ok: false, reason: "Actual finish cannot be earlier than actual start" };
  }
  return { ok: true };
}

export function collectTaskAndDescendantIds(
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

function enforceRateLimit(req: Request, key: string, max: number, windowMs: number) {
  const result = checkRateLimit(req, key, max, windowMs);
  if (!result.allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Rate limit exceeded. Retry after ${Math.ceil(result.retryAfterMs / 1000)}s.`,
    });
  }
}

async function lockProject(tx: PgTransaction<any, any, any>, projectId: number): Promise<void> {
  await tx.execute(sql`SELECT 1 FROM gantt_projects WHERE id = ${projectId} FOR UPDATE`);
}


function wbsWouldCreateCycle(
  allTasks: Array<{ id: number; parentTaskId: number | null }>,
  taskId: number | undefined,
  parentTaskId: number
): boolean {
  if (parentTaskId === 0) return false;
  if (taskId !== undefined && parentTaskId === taskId) return true;
  const parentById = new Map(allTasks.map((t) => [t.id, t.parentTaskId ?? 0]));
  let current = parentTaskId;
  const seen = new Set<number>();
  while (current !== 0) {
    if (seen.has(current)) break; // existing cycle elsewhere; don't pile on
    seen.add(current);
    if (current === taskId) return true;
    current = parentById.get(current) ?? 0;
  }
  return false;
}

function mapTaskRow(r: typeof ganttTasks.$inferSelect) {
  return {
    id: r.id,
    frontendUid: r.frontendTaskUid,
    taskName: r.taskName,
    parentTaskId: r.parentTaskId,
    predecessorTaskId: r.predecessorTaskId,
    dependencyType: r.dependencyType,
    lagDays: r.lagDays,
    wbsLevel: r.wbsLevel,
    sortOrder: r.sortOrder,
    plannedStart: r.plannedStart,
    plannedFinish: r.plannedFinish,
    plannedDuration: r.plannedDuration,
    actualStart: r.actualStart,
    actualFinish: r.actualFinish,
    actualDuration: r.actualDuration,
    progressPercent: r.progressPercent,
    status: r.status,
    owner: r.owner,
    category: r.category,
    notes: r.notes,
    remarks: r.remarks,
    taskType: r.taskType,
    isMilestone: r.isMilestone,
    isParent: r.isParent,
    revision: r.revision,
    updatedByName: r.updatedByName,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function mapDependencyRow(r: typeof ganttDependencies.$inferSelect) {
  const typeReverse: Record<string, string> = { FS: "0", SS: "1", FF: "2", SF: "3" };
  return {
    id: r.id,
    projectId: r.projectId,
    predecessorTaskId: r.predecessorTaskId,
    successorTaskId: r.successorTaskId,
    dependencyType: r.dependencyType,
    type: typeReverse[r.dependencyType] || r.dependencyType || "0",
    lagDays: r.lagDays,
    revision: r.revision,
    updatedByName: r.updatedByName,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

async function countProjectTasks(tx: PgTransaction<any, any, any>, projectId: number): Promise<number> {
  const rows = await tx.select({ count: sql<number>`count(*)::int` }).from(ganttTasks).where(eq(ganttTasks.projectId, projectId));
  return rows[0]?.count ?? 0;
}

async function countProjectDependencies(tx: PgTransaction<any, any, any>, projectId: number): Promise<number> {
  const rows = await tx.select({ count: sql<number>`count(*)::int` }).from(ganttDependencies).where(eq(ganttDependencies.projectId, projectId));
  return rows[0]?.count ?? 0;
}

export const sharedGanttRouter = createRouter({
  /* ── Load a shared project by slug + access token ── */
  load: publicQuery
    .input(
      z.object({
        slug: z.string().min(1),
        access: z.string().min(1),
        sinceRevision: z.number().int().optional(),
      })
    )
    .query(async ({ input, ctx: tctx }) => {
      enforceRateLimit(tctx.req, "sharedGantt:load", 120, 60_000);
      const ctx = await resolveProjectAccess(input.slug, input.access);

      const [projectRows, tasks, deps, events] = await Promise.all([
        db.select().from(ganttProjects).where(eq(ganttProjects.id, ctx.projectId)),
        db
          .select()
          .from(ganttTasks)
          .where(eq(ganttTasks.projectId, ctx.projectId))
          .orderBy(asc(ganttTasks.sortOrder), asc(ganttTasks.id)),
        db
          .select()
          .from(ganttDependencies)
          .where(eq(ganttDependencies.projectId, ctx.projectId)),
        input.sinceRevision !== undefined
          ? db
              .select()
              .from(ganttProjectEvents)
              .where(
                and(
                  eq(ganttProjectEvents.projectId, ctx.projectId),
                  sql`${ganttProjectEvents.projectRevision} > ${input.sinceRevision}`
                )
              )
              .orderBy(asc(ganttProjectEvents.createdAt))
          : Promise.resolve([]),
      ]);

      const project = projectRows[0];
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      return {
        role: ctx.role,
        project: {
          id: project.id,
          publicId: project.publicId,
          slug: project.slug!,
          name: project.name,
          projectName: project.projectName,
          startDate: project.startDate,
          finishDate: project.finishDate,
          status: project.status,
          description: project.description,
          revision: project.revision,
          dataDate: project.dataDate,
          defaultCalendarId: project.defaultCalendarId,
          sharingEnabled: project.sharingEnabled,
          lastScheduledAt: project.lastScheduledAt,
          tasksData: project.tasksData,
          linksData: project.linksData,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        },
        tasks: tasks.map(mapTaskRow),
        dependencies: deps.map(mapDependencyRow),
        events: events.map((e) => ({
          id: e.id,
          entityType: e.entityType,
          entityId: e.entityId,
          action: e.action,
          actorName: e.actorName,
          beforeData: e.beforeData,
          afterData: e.afterData,
          projectRevision: e.projectRevision,
          createdAt: e.createdAt,
        })),
      };
    }),

  /* ── Conditional task update with optimistic locking ── */
  updateTask: publicQuery
    .input(
      z.object({
        slug: z.string().min(1),
        access: z.string().min(1),
        actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
        taskId: z.number().int().positive(),
        expectedRevision: z.number().int().nonnegative(),
        changes: taskUpdateChangesSchema,
      })
    )
    .mutation(async ({ input, ctx: tctx }) => {
      enforceRateLimit(tctx.req, "sharedGantt:updateTask", 60, 60_000);
      const ctx = await resolveProjectAccess(input.slug, input.access);
      requireEditor(ctx);
      ctx.actorName = input.actorName;

      // Secondary parsed-payload guard (HTTP body size is enforced by middleware).
      if (JSON.stringify(input).length > MAX_REQUEST_BODY_BYTES) {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Task update payload too large" });
      }

      const result = await db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(ganttTasks)
          .where(and(eq(ganttTasks.id, input.taskId), eq(ganttTasks.projectId, ctx.projectId)));

        if (existing.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
        }

        const before = mapTaskRow(existing[0]);
        const merged = { ...before, ...input.changes };

        const parentCheck = await validateTaskParentWithCycleCheck(tx, ctx.projectId, input.taskId, merged.parentTaskId ?? before.parentTaskId ?? 0);
        if (!parentCheck.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: parentCheck.reason });
        }

        const dateCheck = validateActualDateOrdering({
          actualStart: merged.actualStart,
          actualFinish: merged.actualFinish,
        });
        if (!dateCheck.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: dateCheck.reason });
        }

        const values: Partial<typeof ganttTasks.$inferInsert> = {
          updatedAt: new Date(),
          updatedByName: input.actorName ?? "Anonymous",
          revision: sql`${ganttTasks.revision} + 1` as any,
        };
        const c = input.changes;
        if (c.taskName !== undefined) values.taskName = c.taskName;
        if (c.parentTaskId !== undefined) values.parentTaskId = c.parentTaskId;
        if (c.predecessorTaskId !== undefined) values.predecessorTaskId = c.predecessorTaskId;
        if (c.dependencyType !== undefined) values.dependencyType = c.dependencyType;
        if (c.lagDays !== undefined) values.lagDays = c.lagDays;
        if (c.wbsLevel !== undefined) values.wbsLevel = c.wbsLevel;
        if (c.sortOrder !== undefined) values.sortOrder = c.sortOrder;
        if (c.plannedStart !== undefined) values.plannedStart = c.plannedStart;
        if (c.plannedFinish !== undefined) values.plannedFinish = c.plannedFinish;
        if (c.plannedDuration !== undefined) values.plannedDuration = c.plannedDuration;
        if (c.actualStart !== undefined) values.actualStart = c.actualStart;
        if (c.actualFinish !== undefined) values.actualFinish = c.actualFinish;
        if (c.actualDuration !== undefined) values.actualDuration = c.actualDuration;
        if (c.progressPercent !== undefined) values.progressPercent = c.progressPercent;
        if (c.status !== undefined) values.status = c.status;
        if (c.owner !== undefined) values.owner = c.owner;
        if (c.category !== undefined) values.category = c.category;
        if (c.notes !== undefined) values.notes = c.notes;
        if (c.remarks !== undefined) values.remarks = c.remarks;
        if (c.taskType !== undefined) values.taskType = c.taskType;
        if (c.isMilestone !== undefined) values.isMilestone = c.isMilestone;
        if (c.isParent !== undefined) values.isParent = c.isParent;

        const updated = await tx
          .update(ganttTasks)
          .set(values)
          .where(
            and(
              eq(ganttTasks.id, input.taskId),
              eq(ganttTasks.projectId, ctx.projectId),
              eq(ganttTasks.revision, input.expectedRevision)
            )
          )
          .returning();

        if (updated.length === 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This activity was updated by another participant. Review the latest version before applying your changes.",
          });
        }

        const newRevision = await bumpProjectRevision(tx, ctx.projectId);
        ctx.projectRevision = newRevision;
        const after = mapTaskRow(updated[0]);
        await insertEvent(tx, ctx, "task", "update", input.taskId, before, after);
        return { task: after, revision: newRevision };
      });

      return { success: true, task: result.task, projectRevision: result.revision };
    }),

  /* ── Create a new task ── */
  createTask: publicQuery
    .input(
      z.object({
        slug: z.string().min(1),
        access: z.string().min(1),
        actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
        task: taskInputSchema,
      })
    )
    .mutation(async ({ input, ctx: tctx }) => {
      enforceRateLimit(tctx.req, "sharedGantt:createTask", 60, 60_000);
      const ctx = await resolveProjectAccess(input.slug, input.access);
      requireEditor(ctx);
      ctx.actorName = input.actorName;

      // Secondary parsed-payload guard (HTTP body size is enforced by middleware).
      if (JSON.stringify(input).length > MAX_REQUEST_BODY_BYTES) {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Task creation payload too large" });
      }

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, ctx.projectId);
        const currentCount = await countProjectTasks(tx, ctx.projectId);
        if (currentCount >= getMaxProjectTasks()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Project cannot exceed ${getMaxProjectTasks()} tasks`,
          });
        }

        const parentCheck = await validateTaskParentWithCycleCheck(tx, ctx.projectId, undefined, input.task.parentTaskId ?? 0, true);
        if (!parentCheck.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: parentCheck.reason });
        }

        const dateCheck = validateActualDateOrdering({
          actualStart: input.task.actualStart,
          actualFinish: input.task.actualFinish,
        });
        if (!dateCheck.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: dateCheck.reason });
        }

        const t = input.task;
        const inserted = await tx
          .insert(ganttTasks)
          .values({
            projectId: ctx.projectId,
            frontendTaskUid: t.frontendTaskUid ?? null,
            taskName: t.taskName,
            parentTaskId: t.parentTaskId ?? 0,
            predecessorTaskId: t.predecessorTaskId ?? null,
            dependencyType: t.dependencyType ?? null,
            lagDays: t.lagDays ?? 0,
            wbsLevel: t.wbsLevel ?? 0,
            sortOrder: t.sortOrder ?? 0,
            plannedStart: t.plannedStart ?? null,
            plannedFinish: t.plannedFinish ?? null,
            plannedDuration: t.plannedDuration ?? null,
            actualStart: t.actualStart ?? null,
            actualFinish: t.actualFinish ?? null,
            actualDuration: t.actualDuration ?? null,
            progressPercent: t.progressPercent ?? 0,
            status: t.status ?? "Not Started",
            owner: t.owner ?? null,
            category: t.category ?? null,
            notes: t.notes ?? null,
            remarks: t.remarks ?? null,
            taskType: t.taskType ?? "task",
            isMilestone: t.isMilestone ?? 0,
            isParent: t.isParent ?? 0,
            updatedByName: input.actorName ?? "Anonymous",
            revision: 1,
          })
          .returning();

        const newRevision = await bumpProjectRevision(tx, ctx.projectId);
        ctx.projectRevision = newRevision;
        const row = mapTaskRow(inserted[0]);
        await insertEvent(tx, ctx, "task", "create", row.id, undefined, row);
        return { task: row, revision: newRevision };
      });

      return { success: true, task: result.task, projectRevision: result.revision };
    }),

  /* ── Dry-run or compute impact before deleting a task ── */
  deleteTaskImpact: publicQuery
    .input(
      z.object({
        slug: z.string().min(1),
        access: z.string().min(1),
        taskId: z.number().int().positive(),
      })
    )
    .query(async ({ input, ctx: tctx }) => {
      enforceRateLimit(tctx.req, "sharedGantt:deleteTaskImpact", 60, 60_000);
      const ctx = await resolveProjectAccess(input.slug, input.access);
      requireEditor(ctx);

      const impact = await db.transaction(async (tx) => {
        const taskRows = await tx
          .select()
          .from(ganttTasks)
          .where(eq(ganttTasks.projectId, ctx.projectId));
        const target = taskRows.find((t) => t.id === input.taskId);
        if (!target) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
        }

        const descendants = collectTaskAndDescendantIds(input.taskId, taskRows);
        const predecessorLinks = await tx
          .select()
          .from(ganttDependencies)
          .where(
            and(
              eq(ganttDependencies.projectId, ctx.projectId),
              inArray(ganttDependencies.successorTaskId, descendants)
            )
          );
        const successorLinks = await tx
          .select()
          .from(ganttDependencies)
          .where(
            and(
              eq(ganttDependencies.projectId, ctx.projectId),
              inArray(ganttDependencies.predecessorTaskId, descendants)
            )
          );
        const childTasks = taskRows.filter((t) => descendants.includes(t.id) && t.id !== input.taskId);
        const parentRefs = taskRows.filter((t) => t.parentTaskId === input.taskId);

        return {
          task: mapTaskRow(target),
          descendantTaskIds: descendants,
          predecessorDependencies: predecessorLinks.map(mapDependencyRow),
          successorDependencies: successorLinks.map(mapDependencyRow),
          childTasks: childTasks.map(mapTaskRow),
          parentReferences: parentRefs.map(mapTaskRow),
          deletionRule: "Children and transitive descendants are deleted. Dependencies touching any deleted task are removed. Remaining tasks that referenced the deleted task as parent are reparented to root (parentTaskId = 0).",
        };
      });

      return { impact };
    }),

  /* ── Delete a task with optimistic locking and orphan cleanup ── */
  deleteTask: publicQuery
    .input(
      z.object({
        slug: z.string().min(1),
        access: z.string().min(1),
        actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
        taskId: z.number().int().positive(),
        expectedRevision: z.number().int().nonnegative(),
        confirmed: z.boolean().default(false),
      })
    )
    .mutation(async ({ input, ctx: tctx }) => {
      enforceRateLimit(tctx.req, "sharedGantt:deleteTask", 60, 60_000);
      const ctx = await resolveProjectAccess(input.slug, input.access);
      requireEditor(ctx);
      requireConfirmation(input.confirmed);
      ctx.actorName = input.actorName;

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, ctx.projectId);

        // Atomically delete the target row only if its revision matches.
        const deletedTargetRows = await tx
          .delete(ganttTasks)
          .where(
            and(
              eq(ganttTasks.id, input.taskId),
              eq(ganttTasks.projectId, ctx.projectId),
              eq(ganttTasks.revision, input.expectedRevision)
            )
          )
          .returning();

        if (deletedTargetRows.length === 0) {
          // Distinguish NOT_FOUND from CONFLICT by checking whether the row exists at all.
          const existing = await tx
            .select({ id: ganttTasks.id, revision: ganttTasks.revision })
            .from(ganttTasks)
            .where(and(eq(ganttTasks.id, input.taskId), eq(ganttTasks.projectId, ctx.projectId)));
          if (existing.length === 0) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
          }
          throw new TRPCError({
            code: "CONFLICT",
            message: "This activity was updated by another participant. Review the latest version before deleting.",
          });
        }

        const target = deletedTargetRows[0];
        const allTasks = await tx
          .select()
          .from(ganttTasks)
          .where(eq(ganttTasks.projectId, ctx.projectId));

        const before = mapTaskRow(target);
        const idsToDelete = collectTaskAndDescendantIds(input.taskId, allTasks);

        await tx
          .delete(ganttDependencies)
          .where(
            and(
              eq(ganttDependencies.projectId, ctx.projectId),
              or(
                inArray(ganttDependencies.predecessorTaskId, idsToDelete),
                inArray(ganttDependencies.successorTaskId, idsToDelete)
              )
            )
          );

        await tx
          .delete(ganttTasks)
          .where(
            and(
              eq(ganttTasks.projectId, ctx.projectId),
              inArray(ganttTasks.id, idsToDelete),
              sql`${ganttTasks.id} <> ${input.taskId}`
            )
          );

        // Reparent remaining tasks that pointed to a deleted task
        await tx
          .update(ganttTasks)
          .set({ parentTaskId: 0, updatedAt: new Date() })
          .where(
            and(
              eq(ganttTasks.projectId, ctx.projectId),
              inArray(ganttTasks.parentTaskId, idsToDelete)
            )
          );

        const newRevision = await bumpProjectRevision(tx, ctx.projectId);
        ctx.projectRevision = newRevision;
        await insertEvent(tx, ctx, "task", "delete", input.taskId, before, {
          deletedTaskIds: idsToDelete,
        });
        return { deletedTaskIds: idsToDelete, revision: newRevision };
      });

      return { success: true, deletedTaskIds: result.deletedTaskIds, projectRevision: result.revision };
    }),

  /* ── Create a dependency with validation ── */
  createDependency: publicQuery
    .input(
      z.object({
        slug: z.string().min(1),
        access: z.string().min(1),
        actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
        predecessorTaskId: z.number().int().positive(),
        successorTaskId: z.number().int().positive(),
        dependencyType: z.enum(VALID_DEPENDENCY_TYPES).default("FS"),
        lagDays: z.number().int().default(0),
      })
    )
    .mutation(async ({ input, ctx: tctx }) => {
      enforceRateLimit(tctx.req, "sharedGantt:createDependency", 60, 60_000);
      const ctx = await resolveProjectAccess(input.slug, input.access);
      requireEditor(ctx);
      ctx.actorName = input.actorName;

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, ctx.projectId);
        const depCount = await countProjectDependencies(tx, ctx.projectId);
        if (depCount >= getMaxProjectDependencies()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Project cannot exceed ${getMaxProjectDependencies()} dependencies`,
          });
        }

        if (input.predecessorTaskId === input.successorTaskId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A task cannot depend on itself" });
        }

        const taskRows = await tx
          .select({ id: ganttTasks.id, projectId: ganttTasks.projectId })
          .from(ganttTasks)
          .where(
            inArray(ganttTasks.id, [input.predecessorTaskId, input.successorTaskId])
          );
        const taskProjectIds = new Map(taskRows.map((r) => [r.id, r.projectId]));
        if (taskProjectIds.size < 2) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Predecessor or successor task not found" });
        }
        if (
          taskProjectIds.get(input.predecessorTaskId) !== ctx.projectId ||
          taskProjectIds.get(input.successorTaskId) !== ctx.projectId
        ) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Tasks must belong to the shared project" });
        }

        const existing = await tx
          .select()
          .from(ganttDependencies)
          .where(
            and(
              eq(ganttDependencies.projectId, ctx.projectId),
              eq(ganttDependencies.predecessorTaskId, input.predecessorTaskId),
              eq(ganttDependencies.successorTaskId, input.successorTaskId)
            )
          );
        if (existing.length > 0) {
          throw new TRPCError({ code: "CONFLICT", message: "Dependency already exists" });
        }

        if (await dependencyWouldCreateCycle(tx, ctx.projectId, input.predecessorTaskId, input.successorTaskId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Dependency cycle detected" });
        }

        const inserted = await tx
          .insert(ganttDependencies)
          .values({
            projectId: ctx.projectId,
            predecessorTaskId: input.predecessorTaskId,
            successorTaskId: input.successorTaskId,
            dependencyType: input.dependencyType,
            lagDays: input.lagDays,
            updatedByName: input.actorName ?? "Anonymous",
            revision: 1,
          })
          .returning();

        const newRevision = await bumpProjectRevision(tx, ctx.projectId);
        ctx.projectRevision = newRevision;
        const row = mapDependencyRow(inserted[0]);
        await insertEvent(tx, ctx, "dependency", "create", row.id, undefined, row);
        return { dependency: row, revision: newRevision };
      });

      return { success: true, dependency: result.dependency, projectRevision: result.revision };
    }),

  /* ── Delete a dependency with optimistic locking ── */
  deleteDependency: publicQuery
    .input(
      z.object({
        slug: z.string().min(1),
        access: z.string().min(1),
        actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
        dependencyId: z.number().int().positive(),
        expectedRevision: z.number().int().nonnegative(),
      })
    )
    .mutation(async ({ input, ctx: tctx }) => {
      enforceRateLimit(tctx.req, "sharedGantt:deleteDependency", 60, 60_000);
      const ctx = await resolveProjectAccess(input.slug, input.access);
      requireEditor(ctx);
      ctx.actorName = input.actorName;

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, ctx.projectId);

        // Atomically delete the dependency only if its revision matches.
        const deleted = await tx
          .delete(ganttDependencies)
          .where(
            and(
              eq(ganttDependencies.id, input.dependencyId),
              eq(ganttDependencies.projectId, ctx.projectId),
              eq(ganttDependencies.revision, input.expectedRevision)
            )
          )
          .returning();

        if (deleted.length === 0) {
          // Distinguish NOT_FOUND from CONFLICT by checking whether the row exists.
          const existing = await tx
            .select({ id: ganttDependencies.id, revision: ganttDependencies.revision })
            .from(ganttDependencies)
            .where(
              and(
                eq(ganttDependencies.id, input.dependencyId),
                eq(ganttDependencies.projectId, ctx.projectId)
              )
            );
          if (existing.length === 0) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Dependency not found" });
          }
          throw new TRPCError({
            code: "CONFLICT",
            message: "This dependency was updated by another participant. Review the latest version before deleting.",
          });
        }

        const before = mapDependencyRow(deleted[0]);
        const newRevision = await bumpProjectRevision(tx, ctx.projectId);
        ctx.projectRevision = newRevision;
        await insertEvent(tx, ctx, "dependency", "delete", input.dependencyId, before, undefined);
        return { revision: newRevision };
      });

      return { success: true, projectRevision: result.revision };
    }),

  /* ── Share / revoke / regenerate project tokens ── */
  share: publicQuery
    .input(
      z.object({
        slug: z.string().min(1),
        access: z.string().min(1),
        actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
        operations: projectShareInputSchema,
      })
    )
    .mutation(async ({ input, ctx: tctx }) => {
      enforceRateLimit(tctx.req, "sharedGantt:share", 30, 60_000);
      const ctx = await resolveProjectAccess(input.slug, input.access);
      requireEditor(ctx);
      requireConfirmation(input.operations.confirmed);
      ctx.actorName = input.actorName;

      const { regenerateEditor, regenerateViewer, revokeEditor, revokeViewer } = input.operations;

      const result = await db.transaction(async (tx) => {
        const projectRows = await tx
          .select({
            id: ganttProjects.id,
            slug: ganttProjects.slug,
            editTokenHash: ganttProjects.editTokenHash,
            viewTokenHash: ganttProjects.viewTokenHash,
          })
          .from(ganttProjects)
          .where(eq(ganttProjects.id, ctx.projectId));
        const before = projectRows[0];
        if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

        const updates: Partial<typeof ganttProjects.$inferInsert> = { sharingEnabled: 1 };
        let editorToken: string | null = null;
        let viewToken: string | null = null;

        if (revokeEditor) {
          updates.editTokenHash = null;
        } else if (regenerateEditor) {
          const editor = await generateTokenWithHash();
          updates.editTokenHash = editor.hash;
          editorToken = editor.plaintext;
        }

        if (revokeViewer) {
          updates.viewTokenHash = null;
        } else if (regenerateViewer) {
          const viewer = await generateTokenWithHash();
          updates.viewTokenHash = viewer.hash;
          viewToken = viewer.plaintext;
        }

        // If no tokens remain, sharing is disabled
        if (updates.editTokenHash === null && updates.viewTokenHash === null) {
          updates.sharingEnabled = 0;
        }

        const updated = await tx
          .update(ganttProjects)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(ganttProjects.id, ctx.projectId))
          .returning();

        const newRevision = await bumpProjectRevision(tx, ctx.projectId);
        ctx.projectRevision = newRevision;
        await insertEvent(tx, ctx, "project", "share", undefined, before, {
          regenerateEditor,
          regenerateViewer,
          revokeEditor,
          revokeViewer,
          sharingEnabled: updates.sharingEnabled,
        });

        return {
          project: updated[0],
          editorToken,
          viewToken,
          revision: newRevision,
        };
      });

      return {
        success: true,
        editorUrl: result.editorToken ? `/gantt/p/${input.slug}?access=${result.editorToken}` : null,
        viewUrl: result.viewToken ? `/gantt/p/${input.slug}?access=${result.viewToken}` : null,
        editorToken: result.editorToken,
        viewToken: result.viewToken,
        projectRevision: result.revision,
      };
    }),

  /* ── Poll for recent events ── */
  pollEvents: publicQuery
    .input(
      z.object({
        slug: z.string().min(1),
        access: z.string().min(1),
        afterRevision: z.number().int().nonnegative(),
      })
    )
    .query(async ({ input, ctx: tctx }) => {
      enforceRateLimit(tctx.req, "sharedGantt:pollEvents", 120, 60_000);
      const ctx = await resolveProjectAccess(input.slug, input.access);

      const [projectRows, events] = await Promise.all([
        db
          .select({ revision: ganttProjects.revision })
          .from(ganttProjects)
          .where(eq(ganttProjects.id, ctx.projectId)),
        db
          .select()
          .from(ganttProjectEvents)
          .where(
            and(
              eq(ganttProjectEvents.projectId, ctx.projectId),
              sql`${ganttProjectEvents.projectRevision} > ${input.afterRevision}`
            )
          )
          .orderBy(asc(ganttProjectEvents.createdAt)),
      ]);

      return {
        projectRevision: projectRows[0]?.revision ?? ctx.projectRevision,
        events: events.map((e) => ({
          id: e.id,
          entityType: e.entityType,
          entityId: e.entityId,
          action: e.action,
          actorName: e.actorName,
          beforeData: e.beforeData,
          afterData: e.afterData,
          projectRevision: e.projectRevision,
          createdAt: e.createdAt,
        })),
      };
    }),

  /* ── Create a new shared project with abuse controls ── */
  createShared: publicQuery
    .input(
      z.object({
        name: z.string().min(1).max(MAX_NAME_LENGTH),
        projectName: z.string().max(MAX_NAME_LENGTH).optional(),
        description: z.string().max(MAX_DESCRIPTION_LENGTH).optional().nullable(),
        startDate: dateStringSchema.optional().nullable(),
        actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
      })
    )
    .mutation(async ({ input, ctx: tctx }) => {
      enforceRateLimit(tctx.req, "sharedGantt:createShared", 10, 60_000);
      // Secondary parsed-payload guard (HTTP body size is enforced by middleware).
      if (JSON.stringify(input).length > MAX_REQUEST_BODY_BYTES) {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds size limit" });
      }

      const tokens = await generateShareTokens();
      const slugBase = input.projectName || input.name || "project";
      const slug =
        slugBase
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "project";
      const uniqueSlug = `${slug}-${crypto.randomUUID().slice(0, 8)}`;

      const inserted = await db.transaction(async (tx) => {
        const projects = await tx
          .insert(ganttProjects)
          .values({
            name: input.name,
            projectName: input.projectName || input.name,
            description: input.description ?? null,
            startDate: input.startDate ?? null,
            tasksData: "[]",
            linksData: null,
            publicId: crypto.randomUUID(),
            slug: uniqueSlug,
            editTokenHash: tokens.editorHash,
            viewTokenHash: tokens.viewHash,
            revision: 1,
            sharingEnabled: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();
        const project = projects[0];

        await tx.insert(ganttProjectEvents).values({
          projectId: project.id,
          entityType: "project",
          action: "create",
          actorName: input.actorName ?? "Anonymous",
          beforeData: null,
          afterData: JSON.stringify({ name: project.name }),
          projectRevision: 1,
        });
        return project;
      });

      return {
        success: true,
        projectId: inserted.id,
        slug: inserted.slug,
        editorUrl: `/gantt/p/${inserted.slug}?access=${tokens.editorToken}`,
        viewUrl: `/gantt/p/${inserted.slug}?access=${tokens.viewToken}`,
        editorToken: tokens.editorToken,
        viewToken: tokens.viewToken,
      };
    }),

  /* ── Update project metadata ── */
  updateProject: publicQuery
    .input(
      z.object({
        slug: z.string().min(1),
        access: z.string().min(1),
        actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
        expectedRevision: z.number().int().nonnegative(),
        changes: projectChangesSchema,
      })
    )
    .mutation(async ({ input, ctx: tctx }) => {
      enforceRateLimit(tctx.req, "sharedGantt:updateProject", 30, 60_000);
      const ctx = await resolveProjectAccess(input.slug, input.access);
      requireEditor(ctx);
      ctx.actorName = input.actorName;

      const result = await db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(ganttProjects)
          .where(eq(ganttProjects.id, ctx.projectId));
        if (existing.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        }
        const before = existing[0];

        const values: Partial<typeof ganttProjects.$inferInsert> = {
          updatedAt: new Date(),
        };
        if (input.changes.name !== undefined) values.name = input.changes.name;
        if (input.changes.projectName !== undefined) values.projectName = input.changes.projectName;
        if (input.changes.startDate !== undefined) values.startDate = input.changes.startDate;
        if (input.changes.finishDate !== undefined) values.finishDate = input.changes.finishDate;
        if (input.changes.status !== undefined) values.status = input.changes.status;
        if (input.changes.description !== undefined) values.description = input.changes.description;
        if (input.changes.dataDate !== undefined) values.dataDate = input.changes.dataDate;
        if (input.changes.defaultCalendarId !== undefined) values.defaultCalendarId = input.changes.defaultCalendarId;

        const updated = await tx
          .update(ganttProjects)
          .set(values)
          .where(
            and(
              eq(ganttProjects.id, ctx.projectId),
              eq(ganttProjects.revision, input.expectedRevision)
            )
          )
          .returning();

        if (updated.length === 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Project was updated by another participant. Review the latest version before applying your changes.",
          });
        }

        const newRevision = await bumpProjectRevision(tx, ctx.projectId);
        ctx.projectRevision = newRevision;
        await insertEvent(tx, ctx, "project", "update", undefined, before, updated[0]);
        return { project: updated[0], revision: newRevision };
      });

      return { success: true, projectRevision: result.revision };
    }),
});
