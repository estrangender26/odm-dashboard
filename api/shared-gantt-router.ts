import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { db } from "./queries/connection";
import {
  ganttProjects,
  ganttTasks,
  ganttDependencies,
  ganttProjectEvents,
} from "@db/schema";
import { eq, and, sql, asc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  generateShareTokens,
  hashToken,
} from "@/modules/gantt/collaboration/accessToken";

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
  if (project.editTokenHash === tokenHash) role = "editor";
  else if (project.viewTokenHash === tokenHash) role = "viewer";

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

async function insertEvent(
  ctx: AccessContext,
  entityType: string,
  action: string,
  entityId?: number,
  before?: unknown,
  after?: unknown
) {
  await db.insert(ganttProjectEvents).values({
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

async function bumpProjectRevision(ctx: AccessContext) {
  const updated = await db
    .update(ganttProjects)
    .set({ revision: sql`${ganttProjects.revision} + 1`, updatedAt: new Date() })
    .where(eq(ganttProjects.id, ctx.projectId))
    .returning({ revision: ganttProjects.revision });
  if (updated[0]) {
    ctx.projectRevision = updated[0].revision;
  }
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
    .query(async ({ input }) => {
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
          slug: project.slug,
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
        actorName: z.string().max(100).optional(),
        taskId: z.number().int().positive(),
        expectedRevision: z.number().int().nonnegative(),
        changes: z.record(z.string(), z.any()),
      })
    )
    .mutation(async ({ input }) => {
      const ctx = await resolveProjectAccess(input.slug, input.access);
      requireEditor(ctx);
      ctx.actorName = input.actorName;

      const existing = await db
        .select()
        .from(ganttTasks)
        .where(and(eq(ganttTasks.id, input.taskId), eq(ganttTasks.projectId, ctx.projectId)));

      if (existing.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      const before = mapTaskRow(existing[0]);

      const values: Record<string, unknown> = {
        updatedAt: new Date(),
        updatedByName: input.actorName ?? "Anonymous",
        revision: sql`${ganttTasks.revision} + 1`,
      };

      const fieldMap: Record<string, string> = {
        taskName: "task_name",
        parentTaskId: "parent_task_id",
        predecessorTaskId: "predecessor_task_id",
        dependencyType: "dependency_type",
        lagDays: "lag_days",
        wbsLevel: "wbs_level",
        sortOrder: "sort_order",
        plannedStart: "planned_start",
        plannedFinish: "planned_finish",
        plannedDuration: "planned_duration",
        actualStart: "actual_start",
        actualFinish: "actual_finish",
        actualDuration: "actual_duration",
        progressPercent: "progress_percent",
        status: "status",
        owner: "owner",
        category: "category",
        notes: "notes",
        remarks: "remarks",
        taskType: "task_type",
        isMilestone: "is_milestone",
        isParent: "is_parent",
      };

      for (const [camel, snake] of Object.entries(fieldMap)) {
        if (camel in input.changes) values[snake] = input.changes[camel];
      }

      const result = await db
        .update(ganttTasks)
        .set(values)
        .where(
          and(
            eq(ganttTasks.id, input.taskId),
            eq(ganttTasks.projectId, ctx.projectId),
            sql`${ganttTasks.revision} = ${input.expectedRevision}`
          )
        )
        .returning();

      if (result.length === 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This activity was updated by another participant. Review the latest version before applying your changes.",
        });
      }

      await bumpProjectRevision(ctx);
      const after = mapTaskRow(result[0]);
      await insertEvent(ctx, "task", "update", input.taskId, before, after);

      return { success: true, task: after, projectRevision: ctx.projectRevision };
    }),

  /* ── Create a new task ── */
  createTask: publicQuery
    .input(
      z.object({
        slug: z.string().min(1),
        access: z.string().min(1),
        actorName: z.string().max(100).optional(),
        task: z.record(z.string(), z.any()),
      })
    )
    .mutation(async ({ input }) => {
      const ctx = await resolveProjectAccess(input.slug, input.access);
      requireEditor(ctx);
      ctx.actorName = input.actorName;

      const t = input.task;
      const inserted = await db
        .insert(ganttTasks)
        .values({
          projectId: ctx.projectId,
          frontendTaskUid: t.frontendTaskUid ?? t.frontend_task_uid ?? null,
          taskName: t.taskName ?? t.task_name ?? "New Activity",
          parentTaskId: t.parentTaskId ?? t.parent_task_id ?? 0,
          predecessorTaskId: t.predecessorTaskId ?? t.predecessor_task_id ?? null,
          dependencyType: t.dependencyType ?? t.dependency_type ?? null,
          lagDays: t.lagDays ?? t.lag_days ?? 0,
          wbsLevel: t.wbsLevel ?? t.wbs_level ?? 0,
          sortOrder: t.sortOrder ?? t.sort_order ?? 0,
          plannedStart: t.plannedStart ?? t.planned_start ?? null,
          plannedFinish: t.plannedFinish ?? t.planned_finish ?? null,
          plannedDuration: t.plannedDuration ?? t.planned_duration ?? null,
          actualStart: t.actualStart ?? t.actual_start ?? null,
          actualFinish: t.actualFinish ?? t.actual_finish ?? null,
          actualDuration: t.actualDuration ?? t.actual_duration ?? null,
          progressPercent: t.progressPercent ?? t.progress_percent ?? 0,
          status: t.status ?? "Not Started",
          owner: t.owner ?? null,
          category: t.category ?? null,
          notes: t.notes ?? null,
          remarks: t.remarks ?? null,
          taskType: t.taskType ?? t.task_type ?? "task",
          isMilestone: t.isMilestone ?? t.is_milestone ?? 0,
          isParent: t.isParent ?? t.is_parent ?? 0,
          updatedByName: input.actorName ?? "Anonymous",
          revision: 1,
        })
        .returning();

      await bumpProjectRevision(ctx);
      const row = mapTaskRow(inserted[0]);
      await insertEvent(ctx, "task", "create", row.id, undefined, row);

      return { success: true, task: row, projectRevision: ctx.projectRevision };
    }),

  /* ── Delete a task ── */
  deleteTask: publicQuery
    .input(
      z.object({
        slug: z.string().min(1),
        access: z.string().min(1),
        actorName: z.string().max(100).optional(),
        taskId: z.number().int().positive(),
      })
    )
    .mutation(async ({ input }) => {
      const ctx = await resolveProjectAccess(input.slug, input.access);
      requireEditor(ctx);
      ctx.actorName = input.actorName;

      const existing = await db
        .select()
        .from(ganttTasks)
        .where(and(eq(ganttTasks.id, input.taskId), eq(ganttTasks.projectId, ctx.projectId)));

      if (existing.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      const before = mapTaskRow(existing[0]);
      await db
        .delete(ganttTasks)
        .where(and(eq(ganttTasks.id, input.taskId), eq(ganttTasks.projectId, ctx.projectId)));

      await bumpProjectRevision(ctx);
      await insertEvent(ctx, "task", "delete", input.taskId, before, undefined);

      return { success: true, projectRevision: ctx.projectRevision };
    }),

  /* ── Create a dependency ── */
  createDependency: publicQuery
    .input(
      z.object({
        slug: z.string().min(1),
        access: z.string().min(1),
        actorName: z.string().max(100).optional(),
        predecessorTaskId: z.number().int().positive(),
        successorTaskId: z.number().int().positive(),
        dependencyType: z.string().max(10).default("FS"),
        lagDays: z.number().int().default(0),
      })
    )
    .mutation(async ({ input }) => {
      const ctx = await resolveProjectAccess(input.slug, input.access);
      requireEditor(ctx);
      ctx.actorName = input.actorName;

      const inserted = await db
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

      await bumpProjectRevision(ctx);
      const row = mapDependencyRow(inserted[0]);
      await insertEvent(ctx, "dependency", "create", row.id, undefined, row);

      return { success: true, dependency: row, projectRevision: ctx.projectRevision };
    }),

  /* ── Delete a dependency ── */
  deleteDependency: publicQuery
    .input(
      z.object({
        slug: z.string().min(1),
        access: z.string().min(1),
        actorName: z.string().max(100).optional(),
        dependencyId: z.number().int().positive(),
      })
    )
    .mutation(async ({ input }) => {
      const ctx = await resolveProjectAccess(input.slug, input.access);
      requireEditor(ctx);
      ctx.actorName = input.actorName;

      const existing = await db
        .select()
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

      const before = mapDependencyRow(existing[0]);
      await db
        .delete(ganttDependencies)
        .where(
          and(
            eq(ganttDependencies.id, input.dependencyId),
            eq(ganttDependencies.projectId, ctx.projectId)
          )
        );

      await bumpProjectRevision(ctx);
      await insertEvent(ctx, "dependency", "delete", input.dependencyId, before, undefined);

      return { success: true, projectRevision: ctx.projectRevision };
    }),

  /* ── Enable sharing and regenerate tokens ── */
  share: publicQuery
    .input(
      z.object({
        slug: z.string().min(1),
        access: z.string().min(1),
        actorName: z.string().max(100).optional(),
        regenerate: z.boolean().default(false),
      })
    )
    .mutation(async ({ input }) => {
      const ctx = await resolveProjectAccess(input.slug, input.access);
      requireEditor(ctx);
      ctx.actorName = input.actorName;

      const tokens = await generateShareTokens();
      await db
        .update(ganttProjects)
        .set({
          sharingEnabled: 1,
          editTokenHash: tokens.editorHash,
          viewTokenHash: tokens.viewHash,
          updatedAt: new Date(),
        })
        .where(eq(ganttProjects.id, ctx.projectId));

      await bumpProjectRevision(ctx);
      await insertEvent(ctx, "project", "share", undefined, undefined, {
        regenerated: input.regenerate,
      });

      return {
        success: true,
        editorUrl: `/gantt/p/${input.slug}?access=${tokens.editorToken}`,
        viewUrl: `/gantt/p/${input.slug}?access=${tokens.viewToken}`,
        editorToken: tokens.editorToken,
        viewToken: tokens.viewToken,
        projectRevision: ctx.projectRevision,
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
    .query(async ({ input }) => {
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

  /* ── Create a new shared project and return editor + view links ── */
  createShared: publicQuery
    .input(
      z.object({
        name: z.string().min(1).max(255),
        projectName: z.string().max(255).optional(),
        description: z.string().optional(),
        startDate: z.string().max(20).optional(),
        actorName: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const tokens = await generateShareTokens();
      const slugBase = input.projectName || input.name || "project";
      const slug =
        slugBase
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "project";
      const uniqueSlug = `${slug}-${Math.random().toString(36).slice(2, 10)}`;

      const inserted = await db
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

      const project = inserted[0];

      await db.insert(ganttProjectEvents).values({
        projectId: project.id,
        entityType: "project",
        action: "create",
        actorName: input.actorName ?? "Anonymous",
        beforeData: null,
        afterData: JSON.stringify({ name: project.name }),
        projectRevision: 1,
      });

      return {
        success: true,
        projectId: project.id,
        slug: project.slug,
        editorUrl: `/gantt/p/${project.slug}?access=${tokens.editorToken}`,
        viewUrl: `/gantt/p/${project.slug}?access=${tokens.viewToken}`,
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
        actorName: z.string().max(100).optional(),
        expectedRevision: z.number().int().nonnegative(),
        changes: z.object({
          name: z.string().min(1).max(255).optional(),
          projectName: z.string().max(255).optional(),
          startDate: z.string().max(20).optional(),
          finishDate: z.string().max(20).optional(),
          status: z.string().max(50).optional(),
          description: z.string().optional(),
          dataDate: z.string().max(20).optional(),
          defaultCalendarId: z.number().int().positive().optional(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      const ctx = await resolveProjectAccess(input.slug, input.access);
      requireEditor(ctx);
      ctx.actorName = input.actorName;

      const existing = await db
        .select()
        .from(ganttProjects)
        .where(eq(ganttProjects.id, ctx.projectId));

      const before = existing[0];

      const values: Record<string, unknown> = {
        updatedAt: new Date(),
        revision: sql`${ganttProjects.revision} + 1`,
      };
      if (input.changes.name !== undefined) values.name = input.changes.name;
      if (input.changes.projectName !== undefined) values.projectName = input.changes.projectName;
      if (input.changes.startDate !== undefined) values.startDate = input.changes.startDate;
      if (input.changes.finishDate !== undefined) values.finishDate = input.changes.finishDate;
      if (input.changes.status !== undefined) values.status = input.changes.status;
      if (input.changes.description !== undefined) values.description = input.changes.description;
      if (input.changes.dataDate !== undefined) values.dataDate = input.changes.dataDate;
      if (input.changes.defaultCalendarId !== undefined) values.defaultCalendarId = input.changes.defaultCalendarId;

      const result = await db
        .update(ganttProjects)
        .set(values)
        .where(
          and(
            eq(ganttProjects.id, ctx.projectId),
            sql`${ganttProjects.revision} = ${input.expectedRevision}`
          )
        )
        .returning();

      if (result.length === 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Project was updated by another participant. Review the latest version before applying your changes.",
        });
      }

      ctx.projectRevision = result[0].revision;
      await insertEvent(ctx, "project", "update", undefined, before, result[0]);

      return { success: true, projectRevision: ctx.projectRevision };
    }),
});
