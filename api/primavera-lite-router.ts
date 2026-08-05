import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { db } from "./queries/connection";
import {
  ganttProjects,
  ganttWbsNodes,
  ganttActivities,
  ganttProjectEvents,
} from "@db/schema";
import { eq, and, sql, asc, isNull } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { TRPCError } from "@trpc/server";
import { generateProjectTokens, hashToken } from "@/modules/gantt/collaboration/accessToken";
import { isValidGanttDate } from "@/modules/gantt/collaboration/dateValidation";
import { checkRateLimit } from "@/modules/gantt/collaboration/rateLimit";
import {
  createPreviewToken,
  verifyPreviewToken,
  PreviewTokenException,
} from "@/modules/gantt/primavera-lite/previewToken";

const MAX_NAME_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_NOTES_LENGTH = 5000;
const MAX_ACTOR_NAME_LENGTH = 100;
const MAX_ACTIVITIES_PER_PROJECT = Number(process.env.MAX_ACTIVITIES_PER_PROJECT) || 2000;

const dateStringSchema = z
  .string()
  .max(20)
  .refine((v) => !v || isValidGanttDate(v), {
    message: "Date must be a valid YYYY-MM-DD",
  });

const slugSchema = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/);

const createProjectInputSchema = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
});

const tokenAccessInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  sinceRevision: z.number().int().nonnegative().optional(),
});

const updateProjectMetaInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  changes: z.object({
    name: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
    projectName: z.string().max(MAX_NAME_LENGTH).optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional().nullable(),
    status: z.string().max(50).optional().nullable(),
  }),
  actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
});

const archiveProjectDryRunInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
});

const archiveProjectInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  previewToken: z.string().min(1),
  confirmed: z.boolean().refine((v) => v === true, {
    message: "confirmed must be true",
  }),
  actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
});

const restoreProjectInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  confirmed: z.boolean().refine((v) => v === true, {
    message: "confirmed must be true",
  }),
  actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
});

const activityInputSchema = z.object({
  activityName: z.string().min(1).max(500),
  activityId: z.string().max(100).optional().nullable(),
  activityType: z.string().max(20).optional().nullable(),
  originalDurationDays: z.number().int().min(0).optional().nullable(),
  remainingDurationDays: z.number().int().min(0).optional().nullable(),
  plannedStart: dateStringSchema.optional().nullable(),
  plannedFinish: dateStringSchema.optional().nullable(),
  actualStart: dateStringSchema.optional().nullable(),
  actualFinish: dateStringSchema.optional().nullable(),
  percentComplete: z.number().int().min(0).max(100).optional().nullable(),
  status: z.string().max(50).optional().nullable(),
  constraintType: z.string().max(20).optional().nullable(),
  constraintDate: dateStringSchema.optional().nullable(),
  notes: z.string().max(MAX_NOTES_LENGTH).optional().nullable(),
});

const createActivityInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  activity: activityInputSchema,
  wbsNodeId: z.number().int().positive().optional(),
  actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
});

const updateActivityInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  activityId: z.number().int().positive(),
  changes: activityInputSchema.partial(),
  actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
});

const archiveActivityDryRunInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  activityId: z.number().int().positive(),
  actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
});

const archiveActivityInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  activityId: z.number().int().positive(),
  previewToken: z.string().min(1),
  confirmed: z.boolean().refine((v) => v === true, {
    message: "confirmed must be true",
  }),
  actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
});

const wbsActorSchema = z.string().max(MAX_ACTOR_NAME_LENGTH).optional();

const wbsNodeSlugAccessSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
});

const createWbsNodeInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  parentNodeId: z.number().int().nullable(),
  name: z.string().min(1).max(500),
  actorName: wbsActorSchema,
});

const renameWbsNodeInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  nodeId: z.number().int().positive(),
  name: z.string().min(1).max(500),
  actorName: wbsActorSchema,
});

const moveWbsNodeInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  nodeId: z.number().int().positive(),
  newParentNodeId: z.number().int().nullable(),
  actorName: wbsActorSchema,
});

const reorderWbsNodeInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  nodeId: z.number().int().positive(),
  newSortOrder: z.number().int().min(0),
  actorName: wbsActorSchema,
});

const archiveWbsNodeDryRunInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  nodeId: z.number().int().positive(),
  actorName: wbsActorSchema,
});

const archiveWbsNodeInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  nodeId: z.number().int().positive(),
  previewToken: z.string().min(1),
  confirmed: z.boolean().refine((v) => v === true, {
    message: "confirmed must be true",
  }),
  actorName: wbsActorSchema,
});

const restoreWbsNodeInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  nodeId: z.number().int().positive(),
  confirmed: z.boolean().refine((v) => v === true, {
    message: "confirmed must be true",
  }),
  actorName: wbsActorSchema,
});

const MAX_WBS_DEPTH = 20;


type AccessRole = "admin" | "editor" | "viewer";

type AccessContext = {
  projectId: number;
  projectRevision: number;
  role: AccessRole;
  actorName?: string;
};

function enforceRateLimit(req: Request, key: string, max: number, windowMs: number) {
  const result = checkRateLimit(req, key, max, windowMs);
  if (!result.allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Rate limit exceeded. Retry after ${Math.ceil(result.retryAfterMs / 1000)}s.`,
    });
  }
}

function requireAdmin(ctx: AccessContext) {
  if (ctx.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin token required" });
  }
}

function requireEditorOrAdmin(ctx: AccessContext) {
  if (ctx.role !== "admin" && ctx.role !== "editor") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Editor or admin token required" });
  }
}

async function resolveProjectAccess(
  slug: string,
  accessToken: string
): Promise<AccessContext> {
  const tokenHash = await hashToken(accessToken);
  const rows = await db
    .select({
      id: ganttProjects.id,
      revision: ganttProjects.revision,
      adminTokenHash: ganttProjects.adminTokenHash,
      editTokenHash: ganttProjects.editTokenHash,
      viewTokenHash: ganttProjects.viewTokenHash,
    })
    .from(ganttProjects)
    .where(eq(ganttProjects.slug, slug));

  if (rows.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }

  const project = rows[0];

  let role: AccessRole | null = null;
  if (project.adminTokenHash && project.adminTokenHash === tokenHash) role = "admin";
  else if (project.editTokenHash && project.editTokenHash === tokenHash) role = "editor";
  else if (project.viewTokenHash && project.viewTokenHash === tokenHash) role = "viewer";

  if (!role) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid access token" });
  }

  return {
    projectId: project.id,
    projectRevision: project.revision,
    role,
  };
}

async function lockProject(tx: PgTransaction<any, any, any>, projectId: number): Promise<void> {
  await tx.execute(sql`SELECT 1 FROM gantt_projects WHERE id = ${projectId} FOR UPDATE`);
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
    beforeData: before ?? null,
    afterData: after ?? null,
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

function buildLink(slug: string, token: string): string {
  return `/gantt/p/${slug}?access=${token}`;
}

async function countActiveProjectActivities(tx: PgTransaction<any, any, any>, projectId: number): Promise<number> {
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(ganttActivities)
    .where(and(eq(ganttActivities.projectId, projectId), isNull(ganttActivities.archivedAt)));
  return rows[0]?.count ?? 0;
}


function handlePreviewTokenError(err: unknown): never {
  if (err instanceof PreviewTokenException) {
    switch (err.code) {
      case "missing_secret":
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Server configuration error" });
      case "malformed":
      case "invalid_signature":
      case "action_mismatch":
      case "slug_mismatch":
      case "entity_mismatch":
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid preview token" });
      case "expired":
        throw new TRPCError({ code: "BAD_REQUEST", message: "Preview token expired; refresh the dry-run preview" });
      case "revision_mismatch":
        throw new TRPCError({ code: "CONFLICT", message: "Preview token is stale; refresh the dry-run preview" });
    }
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid preview token" });
}

function mapProjectRow(project: typeof ganttProjects.$inferSelect) {
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    projectName: project.projectName,
    description: project.description,
    status: project.status,
    revision: project.revision,
    dataDate: project.dataDate,
    defaultCalendarId: project.defaultCalendarId,
    sharingEnabled: project.sharingEnabled,
    archivedAt: project.archivedAt,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  } as any;
}

function mapWbsNodeRow(node: typeof ganttWbsNodes.$inferSelect) {
  return {
    id: node.id,
    projectId: node.projectId,
    parentNodeId: node.parentNodeId,
    code: node.code,
    name: node.name,
    sortOrder: node.sortOrder,
    isLeaf: node.isLeaf,
    archivedAt: node.archivedAt,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

function mapActivityRow(activity: typeof ganttActivities.$inferSelect) {
  return {
    id: activity.id,
    projectId: activity.projectId,
    wbsNodeId: activity.wbsNodeId,
    frontendActivityUid: activity.frontendActivityUid,
    activityId: activity.activityId,
    activityName: activity.activityName,
    activityType: activity.activityType,
    calendarId: activity.calendarId,
    originalDurationDays: activity.originalDurationDays,
    remainingDurationDays: activity.remainingDurationDays,
    plannedStart: activity.plannedStart,
    plannedFinish: activity.plannedFinish,
    earlyStart: activity.earlyStart,
    earlyFinish: activity.earlyFinish,
    lateStart: activity.lateStart,
    lateFinish: activity.lateFinish,
    totalFloatDays: activity.totalFloatDays,
    freeFloatDays: activity.freeFloatDays,
    actualStart: activity.actualStart,
    actualFinish: activity.actualFinish,
    percentComplete: activity.percentComplete,
    status: activity.status,
    constraintType: activity.constraintType,
    constraintDate: activity.constraintDate,
    notes: activity.notes,
    revision: activity.revision,
    updatedByName: activity.updatedByName,
    archivedAt: activity.archivedAt,
    createdAt: activity.createdAt,
    updatedAt: activity.updatedAt,
  } as any;
}


function countCodeSegments(code: string): number {
  return code.split(".").length;
}

function siblingIndexFromCode(code: string): number {
  const last = code.split(".").pop() ?? "0";
  const n = parseInt(last, 10);
  return isNaN(n) ? 0 : n;
}

async function getActiveChildren(
  tx: PgTransaction<any, any, any>,
  projectId: number,
  parentNodeId: number | null
): Promise<typeof ganttWbsNodes.$inferSelect[]> {
  return tx
    .select()
    .from(ganttWbsNodes)
    .where(
      and(
        eq(ganttWbsNodes.projectId, projectId),
        isNull(ganttWbsNodes.archivedAt),
        parentNodeId === null
          ? isNull(ganttWbsNodes.parentNodeId)
          : eq(ganttWbsNodes.parentNodeId, parentNodeId)
      )
    )
    .orderBy(asc(ganttWbsNodes.sortOrder), asc(ganttWbsNodes.id));
}

async function getActiveNode(
  tx: PgTransaction<any, any, any>,
  nodeId: number,
  projectId: number
): Promise<typeof ganttWbsNodes.$inferSelect | undefined> {
  const rows = await tx
    .select()
    .from(ganttWbsNodes)
    .where(
      and(
        eq(ganttWbsNodes.id, nodeId),
        eq(ganttWbsNodes.projectId, projectId),
        isNull(ganttWbsNodes.archivedAt)
      )
    );
  return rows[0];
}

async function getChildrenIncludingArchived(
  tx: PgTransaction<any, any, any>,
  projectId: number,
  parentNodeId: number | null
): Promise<typeof ganttWbsNodes.$inferSelect[]> {
  return tx
    .select()
    .from(ganttWbsNodes)
    .where(
      and(
        eq(ganttWbsNodes.projectId, projectId),
        parentNodeId === null
          ? isNull(ganttWbsNodes.parentNodeId)
          : eq(ganttWbsNodes.parentNodeId, parentNodeId)
      )
    );
}

async function nextChildCode(
  tx: PgTransaction<any, any, any>,
  projectId: number,
  parentNodeId: number | null,
  parentCode: string
): Promise<string> {
  // Consider both active and archived siblings so that archived codes remain reserved.
  const children = await getChildrenIncludingArchived(tx, projectId, parentNodeId);
  let maxIndex = 0;
  for (const child of children) {
    const idx = siblingIndexFromCode(child.code);
    if (idx > maxIndex) maxIndex = idx;
  }
  return parentCode === "" ? `${maxIndex + 1}` : `${parentCode}.${maxIndex + 1}`;
}

async function collectDescendants(
  tx: PgTransaction<any, any, any>,
  projectId: number,
  nodeId: number
): Promise<typeof ganttWbsNodes.$inferSelect[]> {
  const result: typeof ganttWbsNodes.$inferSelect[] = [];
  const queue = [nodeId];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const children = await tx
      .select()
      .from(ganttWbsNodes)
      .where(
        and(
          eq(ganttWbsNodes.projectId, projectId),
          eq(ganttWbsNodes.parentNodeId, currentId),
          isNull(ganttWbsNodes.archivedAt)
        )
      );
    for (const child of children) {
      result.push(child);
      queue.push(child.id);
    }
  }
  return result;
}

async function countActiveNodeActivities(
  tx: PgTransaction<any, any, any>,
  nodeId: number
): Promise<number> {
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(ganttActivities)
    .where(and(eq(ganttActivities.wbsNodeId, nodeId), isNull(ganttActivities.archivedAt)));
  return rows[0]?.count ?? 0;
}

async function setNodesLeaf(
  tx: PgTransaction<any, any, any>,
  nodeIds: number[]
): Promise<void> {
  for (const id of nodeIds) {
    const children = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(ganttWbsNodes)
      .where(and(eq(ganttWbsNodes.parentNodeId, id), isNull(ganttWbsNodes.archivedAt)));
    const hasChildren = (children[0]?.count ?? 0) > 0;
    await tx
      .update(ganttWbsNodes)
      .set({ isLeaf: !hasChildren, updatedAt: new Date() })
      .where(eq(ganttWbsNodes.id, id));
  }
}

async function validateProjectNotArchived(
  tx: PgTransaction<any, any, any>,
  projectId: number
): Promise<{ revision: number; archivedAt: Date | null }> {
  const rows = await tx
    .select({ revision: ganttProjects.revision, archivedAt: ganttProjects.archivedAt })
    .from(ganttProjects)
    .where(eq(ganttProjects.id, projectId));
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  return rows[0];
}

export const primaveraLiteRouter = createRouter({
  createProject: publicQuery
    .input(createProjectInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, "primavera-create-project", 10, 60_000);

      const tokens = await generateProjectTokens();
      const slugBase = input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40);
      const slug = `${slugBase}-${Math.random().toString(36).slice(2, 10)}`;

      const result = await db.transaction(async (tx) => {
        const [project] = await tx
          .insert(ganttProjects)
          .values({
            name: input.name,
            projectName: input.name,
            slug,
            description: input.description ?? null,
            tasksData: "[]",
            adminTokenHash: tokens.adminHash,
            editTokenHash: tokens.editorHash,
            viewTokenHash: tokens.viewerHash,
            sharingEnabled: 1,
            revision: 1,
          })
          .returning();

        const [rootNode] = await tx
          .insert(ganttWbsNodes)
          .values({
            projectId: project.id,
            parentNodeId: null,
            code: "1",
            name: input.name,
            sortOrder: 0,
            isLeaf: true,
          })
          .returning();

        await tx.insert(ganttProjectEvents).values({
          projectId: project.id,
          entityType: "project",
          action: "create",
          actorName: input.actorName ?? "Anonymous",
          beforeData: null,
          afterData: { name: project.name, slug: project.slug },
          projectRevision: 1,
        });

        return { project, rootNode };
      });

      return {
        project: mapProjectRow(result.project),
        rootWbsNode: mapWbsNodeRow(result.rootNode),
        adminLink: buildLink(slug, tokens.adminToken),
        editorLink: buildLink(slug, tokens.editorToken),
        viewerLink: buildLink(slug, tokens.viewerToken),
      };
    }),

  load: publicQuery
    .input(tokenAccessInputSchema)
    .query(async ({ input }) => {
      const accessCtx = await resolveProjectAccess(input.slug, input.access);

      const [projectRow] = await db
        .select()
        .from(ganttProjects)
        .where(eq(ganttProjects.id, accessCtx.projectId));

      if (projectRow?.archivedAt) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project has been archived" });
      }

      const wbsNodes = await db
        .select()
        .from(ganttWbsNodes)
        .where(
          and(
            eq(ganttWbsNodes.projectId, accessCtx.projectId),
            isNull(ganttWbsNodes.archivedAt)
          )
        )
        .orderBy(asc(ganttWbsNodes.sortOrder), asc(ganttWbsNodes.id));

      const activities = await db
        .select()
        .from(ganttActivities)
        .where(
          and(
            eq(ganttActivities.projectId, accessCtx.projectId),
            isNull(ganttActivities.archivedAt)
          )
        )
        .orderBy(asc(ganttActivities.id));

      const events = input.sinceRevision !== undefined
        ? await db
            .select()
            .from(ganttProjectEvents)
            .where(
              and(
                eq(ganttProjectEvents.projectId, accessCtx.projectId),
                sql`${ganttProjectEvents.projectRevision} > ${input.sinceRevision}`
              )
            )
            .orderBy(asc(ganttProjectEvents.projectRevision), asc(ganttProjectEvents.id))
        : [];

      return {
        role: accessCtx.role,
        project: projectRow ? mapProjectRow(projectRow) : null,
        wbsNodes: wbsNodes.map(mapWbsNodeRow),
        activities: activities.map(mapActivityRow),
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
        revision: accessCtx.projectRevision,
      };
    }),

  updateProjectMeta: publicQuery
    .input(updateProjectMetaInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-update-project:${input.slug}`, 30, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireAdmin(accessCtx);

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);

        const [current] = await tx
          .select()
          .from(ganttProjects)
          .where(eq(ganttProjects.id, accessCtx.projectId));
        if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        if (current.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }
        if (current.archivedAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Project is archived" });
        }

        const before = mapProjectRow(current);
        const setData: Record<string, unknown> = { updatedAt: new Date() };
        if (input.changes.name !== undefined) {
          setData.name = input.changes.name;
          setData.projectName = input.changes.name;
        }
        if (input.changes.projectName !== undefined) setData.projectName = input.changes.projectName;
        if (input.changes.description !== undefined) setData.description = input.changes.description;
        if (input.changes.status !== undefined) setData.status = input.changes.status;

        const [updated] = await tx
          .update(ganttProjects)
          .set(setData)
          .where(eq(ganttProjects.id, accessCtx.projectId))
          .returning();

        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "project", "update", accessCtx.projectId, before, mapProjectRow(updated));

        return updated;
      });

      return { project: mapProjectRow(result), revision: accessCtx.projectRevision };
    }),

  archiveProjectDryRun: publicQuery
    .input(archiveProjectDryRunInputSchema)
    .mutation(async ({ input }) => {
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireAdmin(accessCtx);

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);
        const [current] = await tx
          .select({ revision: ganttProjects.revision, archivedAt: ganttProjects.archivedAt })
          .from(ganttProjects)
          .where(eq(ganttProjects.id, accessCtx.projectId));
        if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        if (current.archivedAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Project is already archived" });
        }
        if (current.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }
        return current.revision;
      });

      const previewToken = await createPreviewToken("archiveProject", input.slug, result);

      return {
        dryRun: true,
        wouldArchive: { project: 1 },
        previewToken,
        message: "Use the previewToken with confirmed: true to archive this project.",
      };
    }),

  archiveProject: publicQuery
    .input(archiveProjectInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-archive-project:${input.slug}`, 5, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireAdmin(accessCtx);

      try {
        await verifyPreviewToken(input.previewToken, "archiveProject", input.slug, input.expectedRevision);
      } catch (err) {
        handlePreviewTokenError(err);
      }

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);

        const [current] = await tx
          .select()
          .from(ganttProjects)
          .where(eq(ganttProjects.id, accessCtx.projectId));
        if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        if (current.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }
        if (current.archivedAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Project is already archived" });
        }

        const before = { archivedAt: current.archivedAt };
        const now = new Date();

        const [updated] = await tx
          .update(ganttProjects)
          .set({ archivedAt: now, updatedAt: now })
          .where(eq(ganttProjects.id, accessCtx.projectId))
          .returning();

        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "project", "archive", accessCtx.projectId, before, {
          archivedAt: updated.archivedAt,
        });

        return updated;
      });

      return { project: mapProjectRow(result), revision: accessCtx.projectRevision };
    }),

  restoreProject: publicQuery
    .input(restoreProjectInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-restore-project:${input.slug}`, 5, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireAdmin(accessCtx);

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);

        const [current] = await tx
          .select()
          .from(ganttProjects)
          .where(eq(ganttProjects.id, accessCtx.projectId));
        if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        if (!current.archivedAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Project is not archived" });
        }
        if (current.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }

        const before = { archivedAt: current.archivedAt };

        const [updated] = await tx
          .update(ganttProjects)
          .set({ archivedAt: null, updatedAt: new Date() })
          .where(eq(ganttProjects.id, accessCtx.projectId))
          .returning();

        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "project", "restore", accessCtx.projectId, before, {
          archivedAt: updated.archivedAt,
        });

        return updated;
      });

      return { project: mapProjectRow(result), revision: accessCtx.projectRevision };
    }),

  createActivity: publicQuery
    .input(createActivityInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-create-activity:${input.slug}`, 60, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);

        const [projectRow] = await tx
          .select({ revision: ganttProjects.revision, archivedAt: ganttProjects.archivedAt })
          .from(ganttProjects)
          .where(eq(ganttProjects.id, accessCtx.projectId));
        if (!projectRow) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        if (projectRow.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }
        if (projectRow.archivedAt) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Archived project cannot be modified" });
        }

        const activityCount = await countActiveProjectActivities(tx, accessCtx.projectId);
        if (activityCount >= MAX_ACTIVITIES_PER_PROJECT) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Project already has the maximum ${MAX_ACTIVITIES_PER_PROJECT} activities`,
          });
        }

        let wbsNodeId: number;
        if (input.wbsNodeId) {
          const targetNodes = await tx
            .select()
            .from(ganttWbsNodes)
            .where(
              and(
                eq(ganttWbsNodes.id, input.wbsNodeId),
                eq(ganttWbsNodes.projectId, accessCtx.projectId),
                isNull(ganttWbsNodes.archivedAt)
              )
            );
          if (targetNodes.length === 0) {
            throw new TRPCError({ code: "NOT_FOUND", message: "WBS node not found" });
          }
          if (!targetNodes[0].isLeaf) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Activities can only be created on leaf WBS nodes" });
          }
          wbsNodeId = targetNodes[0].id;
        } else {
          const rootNodes = await tx
            .select()
            .from(ganttWbsNodes)
            .where(
              and(
                eq(ganttWbsNodes.projectId, accessCtx.projectId),
                isNull(ganttWbsNodes.parentNodeId),
                isNull(ganttWbsNodes.archivedAt)
              )
            )
            .orderBy(asc(ganttWbsNodes.id))
            .limit(1);
          if (rootNodes.length === 0) {
            throw new TRPCError({ code: "NOT_FOUND", message: "No root WBS node found for project" });
          }
          if (!rootNodes[0].isLeaf) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Activities can only be created on leaf WBS nodes; specify a leaf WBS node" });
          }
          wbsNodeId = rootNodes[0].id;
        }

        const [activity] = await tx
          .insert(ganttActivities)
          .values({
            projectId: accessCtx.projectId,
            wbsNodeId,
            activityName: input.activity.activityName,
            activityId: (input.activity.activityId ?? null) as any,
            activityType: (input.activity.activityType ?? "task") as any,
            originalDurationDays: (input.activity.originalDurationDays ?? 0) as any,
            remainingDurationDays: (input.activity.remainingDurationDays ?? 0) as any,
            plannedStart: (input.activity.plannedStart ?? null) as any,
            plannedFinish: (input.activity.plannedFinish ?? null) as any,
            actualStart: (input.activity.actualStart ?? null) as any,
            actualFinish: (input.activity.actualFinish ?? null) as any,
            percentComplete: (input.activity.percentComplete ?? 0) as any,
            status: (input.activity.status ?? null) as any,
            constraintType: (input.activity.constraintType ?? null) as any,
            constraintDate: (input.activity.constraintDate ?? null) as any,
            notes: (input.activity.notes ?? null) as any,
            updatedByName: input.actorName ?? "Anonymous",
          } as any)
          .returning();

        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "activity", "create", activity.id, null, mapActivityRow(activity));

        return activity;
      });

      return { activity: mapActivityRow(result), revision: accessCtx.projectRevision };
    }),

  updateActivity: publicQuery
    .input(updateActivityInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-update-activity:${input.slug}`, 60, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);

        const [projectRow] = await tx
          .select({ revision: ganttProjects.revision, archivedAt: ganttProjects.archivedAt })
          .from(ganttProjects)
          .where(eq(ganttProjects.id, accessCtx.projectId));
        if (!projectRow) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        if (projectRow.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }
        if (projectRow.archivedAt) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Archived project cannot be modified" });
        }

        const [activity] = await tx
          .select()
          .from(ganttActivities)
          .where(
            and(
              eq(ganttActivities.id, input.activityId),
              eq(ganttActivities.projectId, accessCtx.projectId),
              isNull(ganttActivities.archivedAt)
            )
          );
        if (!activity) throw new TRPCError({ code: "NOT_FOUND", message: "Activity not found" });

        const before = mapActivityRow(activity);
        const changes = input.changes;
        const setData: Record<string, unknown> = { updatedAt: new Date(), updatedByName: input.actorName ?? "Anonymous" };
        if (changes.activityName !== undefined) setData.activityName = changes.activityName;
        if (changes.activityId !== undefined) setData.activityId = changes.activityId;
        if (changes.activityType !== undefined) setData.activityType = changes.activityType;
        if (changes.originalDurationDays !== undefined) setData.originalDurationDays = changes.originalDurationDays;
        if (changes.remainingDurationDays !== undefined) setData.remainingDurationDays = changes.remainingDurationDays;
        if (changes.plannedStart !== undefined) setData.plannedStart = changes.plannedStart;
        if (changes.plannedFinish !== undefined) setData.plannedFinish = changes.plannedFinish;
        if (changes.actualStart !== undefined) setData.actualStart = changes.actualStart;
        if (changes.actualFinish !== undefined) setData.actualFinish = changes.actualFinish;
        if (changes.percentComplete !== undefined) setData.percentComplete = changes.percentComplete;
        if (changes.status !== undefined) setData.status = changes.status;
        if (changes.constraintType !== undefined) setData.constraintType = changes.constraintType;
        if (changes.constraintDate !== undefined) setData.constraintDate = changes.constraintDate;
        if (changes.notes !== undefined) setData.notes = changes.notes;

        const [updated] = await tx
          .update(ganttActivities)
          .set(setData)
          .where(eq(ganttActivities.id, activity.id))
          .returning();

        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "activity", "update", updated.id, before, mapActivityRow(updated));

        return updated;
      });

      return { activity: mapActivityRow(result), revision: accessCtx.projectRevision };
    }),

  archiveActivityDryRun: publicQuery
    .input(archiveActivityDryRunInputSchema)
    .mutation(async ({ input }) => {
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);
        const [projectRow] = await tx
          .select({ revision: ganttProjects.revision, archivedAt: ganttProjects.archivedAt })
          .from(ganttProjects)
          .where(eq(ganttProjects.id, accessCtx.projectId));
        if (!projectRow) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        if (projectRow.archivedAt) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Archived project cannot be modified" });
        }
        if (projectRow.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }

        const [activity] = await tx
          .select({ id: ganttActivities.id })
          .from(ganttActivities)
          .where(
            and(
              eq(ganttActivities.id, input.activityId),
              eq(ganttActivities.projectId, accessCtx.projectId),
              isNull(ganttActivities.archivedAt)
            )
          );
        if (!activity) throw new TRPCError({ code: "NOT_FOUND", message: "Activity not found" });
        return { projectRevision: projectRow.revision, activityId: activity.id };
      });

      const previewToken = await createPreviewToken(
        "archiveActivity",
        input.slug,
        result.projectRevision,
        result.activityId
      );

      return {
        dryRun: true,
        wouldArchive: { activities: 1 },
        previewToken,
        message: "Use the previewToken with confirmed: true to archive this activity.",
      };
    }),

  archiveActivity: publicQuery
    .input(archiveActivityInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-archive-activity:${input.slug}`, 30, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);

      try {
        await verifyPreviewToken(input.previewToken, "archiveActivity", input.slug, input.expectedRevision, input.activityId);
      } catch (err) {
        handlePreviewTokenError(err);
      }

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);

        const [projectRow] = await tx
          .select({ revision: ganttProjects.revision, archivedAt: ganttProjects.archivedAt })
          .from(ganttProjects)
          .where(eq(ganttProjects.id, accessCtx.projectId));
        if (!projectRow) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        if (projectRow.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }
        if (projectRow.archivedAt) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Archived project cannot be modified" });
        }

        const [activity] = await tx
          .select()
          .from(ganttActivities)
          .where(
            and(
              eq(ganttActivities.id, input.activityId),
              eq(ganttActivities.projectId, accessCtx.projectId),
              isNull(ganttActivities.archivedAt)
            )
          );
        if (!activity) throw new TRPCError({ code: "NOT_FOUND", message: "Activity not found" });

        const before = mapActivityRow(activity);
        const now = new Date();

        const [updated] = await tx
          .update(ganttActivities)
          .set({ archivedAt: now, updatedAt: now })
          .where(eq(ganttActivities.id, activity.id))
          .returning();

        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "activity", "archive", updated.id, before, mapActivityRow(updated));

        return updated;
      });

      return { activity: mapActivityRow(result), revision: accessCtx.projectRevision };
    }),

  // ── WBS Tree (PR2) ──
  listWbsTree: publicQuery
    .input(wbsNodeSlugAccessSchema.extend({ includeArchived: z.boolean().optional() }))
    .query(async ({ input }) => {
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      if (input.includeArchived) {
        requireAdmin(accessCtx);
      }
      const nodes = await db
        .select()
        .from(ganttWbsNodes)
        .where(
          input.includeArchived
            ? eq(ganttWbsNodes.projectId, accessCtx.projectId)
            : and(
                eq(ganttWbsNodes.projectId, accessCtx.projectId),
                isNull(ganttWbsNodes.archivedAt)
              )
        )
        .orderBy(asc(ganttWbsNodes.sortOrder), asc(ganttWbsNodes.id));
      return {
        nodes: nodes.map(mapWbsNodeRow),
        revision: accessCtx.projectRevision,
      };
    }),

  createWbsNode: publicQuery
    .input(createWbsNodeInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-create-wbs:${input.slug}`, 60, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);

        const projectRow = await validateProjectNotArchived(tx, accessCtx.projectId);
        if (projectRow.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }

        if (input.parentNodeId === null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only the project root may have no parent" });
        }

        const parentNodeId = input.parentNodeId;
        const parent = await getActiveNode(tx, parentNodeId, accessCtx.projectId);
        if (!parent) throw new TRPCError({ code: "NOT_FOUND", message: "Parent WBS node not found" });

        const activeActivitiesOnParent = await countActiveNodeActivities(tx, parent.id);
        if (activeActivitiesOnParent > 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot add a WBS child to a node that has activities" });
        }

        const parentCode = parent.code;
        const parentDepth = countCodeSegments(parentCode);

        if (parentDepth + 1 > MAX_WBS_DEPTH) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `WBS depth exceeds maximum ${MAX_WBS_DEPTH}` });
        }

        const code = await nextChildCode(tx, accessCtx.projectId, parentNodeId, parentCode);
        const siblings = await getActiveChildren(tx, accessCtx.projectId, parentNodeId);
        const sortOrder = siblings.length;

        const [node] = await tx
          .insert(ganttWbsNodes)
          .values({
            projectId: accessCtx.projectId,
            parentNodeId,
            code,
            name: input.name,
            sortOrder,
            isLeaf: true,
          })
          .returning();

        // Parent is no longer a leaf
        if (parentNodeId !== null) {
          await tx
            .update(ganttWbsNodes)
            .set({ isLeaf: false, updatedAt: new Date() })
            .where(eq(ganttWbsNodes.id, parentNodeId));
        }

        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "wbs", "create", node.id, null, mapWbsNodeRow(node));

        return node;
      });

      return { node: mapWbsNodeRow(result), revision: accessCtx.projectRevision };
    }),

  renameWbsNode: publicQuery
    .input(renameWbsNodeInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-rename-wbs:${input.slug}`, 60, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);

        const projectRow = await validateProjectNotArchived(tx, accessCtx.projectId);
        if (projectRow.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }

        const node = await getActiveNode(tx, input.nodeId, accessCtx.projectId);
        if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "WBS node not found" });

        const before = mapWbsNodeRow(node);
        const [updated] = await tx
          .update(ganttWbsNodes)
          .set({ name: input.name, updatedAt: new Date() })
          .where(eq(ganttWbsNodes.id, node.id))
          .returning();

        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "wbs", "rename", updated.id, before, mapWbsNodeRow(updated));

        return updated;
      });

      return { node: mapWbsNodeRow(result), revision: accessCtx.projectRevision };
    }),

  moveWbsNode: publicQuery
    .input(moveWbsNodeInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-move-wbs:${input.slug}`, 30, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);

        const projectRow = await validateProjectNotArchived(tx, accessCtx.projectId);
        if (projectRow.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }

        const movingNode = await getActiveNode(tx, input.nodeId, accessCtx.projectId);
        if (!movingNode) throw new TRPCError({ code: "NOT_FOUND", message: "WBS node not found" });
        if (movingNode.parentNodeId === null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot move the root WBS node" });
        }

        const oldParentId = movingNode.parentNodeId;
        const newParentId: number | null = input.newParentNodeId;

        if (newParentId === null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot move a WBS node to the root" });
        }
        if (newParentId === oldParentId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Use reorderWbsNode to reorder siblings" });
        }

        const newParent = await getActiveNode(tx, newParentId, accessCtx.projectId);
        if (!newParent) throw new TRPCError({ code: "NOT_FOUND", message: "Target parent WBS node not found" });

        const activeActivitiesOnNewParent = await countActiveNodeActivities(tx, newParent.id);
        if (activeActivitiesOnNewParent > 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot move a WBS node beneath a node that has activities" });
        }

        const descendants = await collectDescendants(tx, accessCtx.projectId, movingNode.id);
        const descendantIds = descendants.map((d) => d.id);
        if (newParentId === movingNode.id || descendantIds.includes(newParentId)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot move a WBS node beneath itself or its descendants",
          });
        }

        const newParentDepth = countCodeSegments(newParent.code);
        const movingDepth = countCodeSegments(movingNode.code);
        const maxDescendantExtraDepth = descendants.reduce((max, d) => {
          return Math.max(max, countCodeSegments(d.code) - movingDepth);
        }, 0);
        if (newParentDepth + 1 + maxDescendantExtraDepth > MAX_WBS_DEPTH) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Move would exceed maximum WBS depth ${MAX_WBS_DEPTH}` });
        }

        // Re-parent and regenerate codes
        const newParentCode = newParent.code;
        const newBaseCode = await nextChildCode(tx, accessCtx.projectId, newParentId, newParentCode);
        const oldToNewCode = new Map<number, string>();
        oldToNewCode.set(movingNode.id, newBaseCode);

        const movedDescendants = await collectDescendants(tx, accessCtx.projectId, movingNode.id);
        for (const desc of movedDescendants) {
          const relative = desc.code.substring(movingNode.code.length);
          oldToNewCode.set(desc.id, newBaseCode + relative);
        }

        const now = new Date();
        for (const [nodeId, newCode] of oldToNewCode) {
          await tx
            .update(ganttWbsNodes)
            .set({ code: newCode, updatedAt: now })
            .where(eq(ganttWbsNodes.id, nodeId));
        }

        // Compute new sort order at end of new parent's children (moving node is not yet a child of new parent)
        const newSiblings = await getActiveChildren(tx, accessCtx.projectId, newParentId);
        const newSortOrder = newSiblings.length;

        await tx
          .update(ganttWbsNodes)
          .set({ parentNodeId: newParentId, sortOrder: newSortOrder, updatedAt: now })
          .where(eq(ganttWbsNodes.id, movingNode.id));

        // Reorder old siblings to close gap
        const oldSiblings = await getActiveChildren(tx, accessCtx.projectId, oldParentId);
        for (let i = 0; i < oldSiblings.length; i++) {
          await tx
            .update(ganttWbsNodes)
            .set({ sortOrder: i, updatedAt: now })
            .where(eq(ganttWbsNodes.id, oldSiblings[i].id));
        }

        // Reorder new siblings
        const finalNewSiblings = await getActiveChildren(tx, accessCtx.projectId, newParentId);
        for (let i = 0; i < finalNewSiblings.length; i++) {
          await tx
            .update(ganttWbsNodes)
            .set({ sortOrder: i, updatedAt: now })
            .where(eq(ganttWbsNodes.id, finalNewSiblings[i].id));
        }

        // Recompute leaf status
        const affectedIds = [movingNode.id, ...descendants.map((d) => d.id)];
        if (oldParentId !== null) affectedIds.push(oldParentId);
        if (newParentId !== null) affectedIds.push(newParentId);
        await setNodesLeaf(tx, Array.from(new Set(affectedIds)));

        const [updated] = await tx
          .select()
          .from(ganttWbsNodes)
          .where(eq(ganttWbsNodes.id, movingNode.id));

        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "wbs", "move", updated.id, { oldParentId, oldCode: movingNode.code }, mapWbsNodeRow(updated));

        return updated;
      });

      return { node: mapWbsNodeRow(result), revision: accessCtx.projectRevision };
    }),

  reorderWbsNode: publicQuery
    .input(reorderWbsNodeInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-reorder-wbs:${input.slug}`, 60, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);

        const projectRow = await validateProjectNotArchived(tx, accessCtx.projectId);
        if (projectRow.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }

        const node = await getActiveNode(tx, input.nodeId, accessCtx.projectId);
        if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "WBS node not found" });

        const siblings = await getActiveChildren(tx, accessCtx.projectId, node.parentNodeId);
        const ordered = siblings.filter((s) => s.id !== node.id);
        const clampedOrder = Math.max(0, Math.min(input.newSortOrder, ordered.length));
        ordered.splice(clampedOrder, 0, node);

        const now = new Date();
        for (let i = 0; i < ordered.length; i++) {
          await tx
            .update(ganttWbsNodes)
            .set({ sortOrder: i, updatedAt: now })
            .where(eq(ganttWbsNodes.id, ordered[i].id));
        }

        const [updated] = await tx
          .select()
          .from(ganttWbsNodes)
          .where(eq(ganttWbsNodes.id, node.id));

        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "wbs", "reorder", updated.id, { oldSortOrder: node.sortOrder }, mapWbsNodeRow(updated));

        return updated;
      });

      return { node: mapWbsNodeRow(result), revision: accessCtx.projectRevision };
    }),

  archiveWbsNodeDryRun: publicQuery
    .input(archiveWbsNodeDryRunInputSchema)
    .mutation(async ({ input }) => {
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);

        const projectRow = await validateProjectNotArchived(tx, accessCtx.projectId);
        if (projectRow.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }

        const node = await getActiveNode(tx, input.nodeId, accessCtx.projectId);
        if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "WBS node not found" });

        const descendants = await collectDescendants(tx, accessCtx.projectId, node.id);
        const activityCount = await countActiveNodeActivities(tx, node.id);
        const descendantActivityCount = await Promise.all(
          descendants.map((d) => countActiveNodeActivities(tx, d.id))
        ).then((arr) => arr.reduce((a, b) => a + b, 0));

        return {
          nodeCount: 1 + descendants.length,
          activityCount: activityCount + descendantActivityCount,
          projectRevision: projectRow.revision,
        };
      });

      const previewToken = await createPreviewToken(
        "archiveWbsNode",
        input.slug,
        result.projectRevision,
        input.nodeId
      );

      return {
        dryRun: true,
        wouldArchive: { wbsNodes: result.nodeCount, activities: result.activityCount },
        previewToken,
        message: "Use the previewToken with confirmed: true to archive this WBS node.",
      };
    }),

  archiveWbsNode: publicQuery
    .input(archiveWbsNodeInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-archive-wbs:${input.slug}`, 30, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);

      try {
        await verifyPreviewToken(input.previewToken, "archiveWbsNode", input.slug, input.expectedRevision, input.nodeId);
      } catch (err) {
        handlePreviewTokenError(err);
      }

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);

        const projectRow = await validateProjectNotArchived(tx, accessCtx.projectId);
        if (projectRow.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }

        const node = await getActiveNode(tx, input.nodeId, accessCtx.projectId);
        if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "WBS node not found" });
        if (node.parentNodeId === null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot archive the root WBS node" });
        }

        const before = mapWbsNodeRow(node);
        const now = new Date();
        const parentId = node.parentNodeId;

        await tx
          .update(ganttWbsNodes)
          .set({ archivedAt: now, updatedAt: now, isLeaf: true })
          .where(
            and(
              eq(ganttWbsNodes.projectId, accessCtx.projectId),
              sql`${ganttWbsNodes.code} LIKE ${node.code + ".%"}`,
              isNull(ganttWbsNodes.archivedAt)
            )
          );

        const [updated] = await tx
          .update(ganttWbsNodes)
          .set({ archivedAt: now, updatedAt: now })
          .where(eq(ganttWbsNodes.id, node.id))
          .returning();

        // Soft-archive active activities on the node and its descendants with the same timestamp.
        await tx
          .update(ganttActivities)
          .set({ archivedAt: now, updatedAt: now, updatedByName: input.actorName ?? "Anonymous" })
          .where(
            and(
              eq(ganttActivities.projectId, accessCtx.projectId),
              sql`${ganttActivities.wbsNodeId} IN (
                SELECT id FROM gantt_wbs_nodes
                WHERE project_id = ${accessCtx.projectId}
                  AND (id = ${node.id} OR code LIKE ${node.code + ".%"})
                  AND archived_at = ${now.toISOString()}
              )`,
              isNull(ganttActivities.archivedAt)
            )
          );

        if (parentId !== null) {
          await setNodesLeaf(tx, [parentId]);
        }

        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "wbs", "archive", updated.id, before, mapWbsNodeRow(updated));

        return updated;
      });

      return { node: mapWbsNodeRow(result), revision: accessCtx.projectRevision };
    }),

  restoreWbsNode: publicQuery
    .input(restoreWbsNodeInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-restore-wbs:${input.slug}`, 30, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireAdmin(accessCtx);

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);

        const projectRow = await validateProjectNotArchived(tx, accessCtx.projectId);
        if (projectRow.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }

        const [node] = await tx
          .select()
          .from(ganttWbsNodes)
          .where(
            and(
              eq(ganttWbsNodes.id, input.nodeId),
              eq(ganttWbsNodes.projectId, accessCtx.projectId)
            )
          );
        if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "WBS node not found" });
        if (!node.archivedAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "WBS node is not archived" });
        }

        // Detect code conflicts before restoring anything.
        const candidateCodes = [node.code, ...(await collectDescendants(tx, accessCtx.projectId, node.id)).map((d) => d.code)];
        const existingConflicts: { code: string }[] = [];
        for (const candidateCode of candidateCodes) {
          const conflictRows = await tx
            .select({ code: ganttWbsNodes.code })
            .from(ganttWbsNodes)
            .where(
              and(
                eq(ganttWbsNodes.projectId, accessCtx.projectId),
                eq(ganttWbsNodes.code, candidateCode),
                isNull(ganttWbsNodes.archivedAt)
              )
            );
          if (conflictRows.length > 0) {
            existingConflicts.push(conflictRows[0]);
            break;
          }
        }
        if (existingConflicts.length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `WBS code collision on restore: ${existingConflicts[0].code} already exists`,
          });
        }

        // If parent is archived, refuse (would create orphaned visible node)
        if (node.parentNodeId !== null) {
          const [parent] = await tx
            .select()
            .from(ganttWbsNodes)
            .where(eq(ganttWbsNodes.id, node.parentNodeId));
          if (parent?.archivedAt) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot restore WBS node while its parent is archived" });
          }
        }

        const before = mapWbsNodeRow(node);
        const now = new Date();
        const parentId = node.parentNodeId;

        // Restore node and all descendants that were archived at the same time
        await tx
          .update(ganttWbsNodes)
          .set({ archivedAt: null, updatedAt: now })
          .where(
            and(
              eq(ganttWbsNodes.projectId, accessCtx.projectId),
              sql`${ganttWbsNodes.code} LIKE ${node.code + ".%"}`,
              eq(ganttWbsNodes.archivedAt, node.archivedAt)
            )
          );

        const [updated] = await tx
          .update(ganttWbsNodes)
          .set({ archivedAt: null, updatedAt: now })
          .where(eq(ganttWbsNodes.id, node.id))
          .returning();

        // Restore only activities archived by this exact WBS cascade.
        await tx
          .update(ganttActivities)
          .set({ archivedAt: null, updatedAt: now, updatedByName: input.actorName ?? "Anonymous" })
          .where(
            and(
              eq(ganttActivities.projectId, accessCtx.projectId),
              sql`${ganttActivities.wbsNodeId} IN (
                SELECT id FROM gantt_wbs_nodes
                WHERE project_id = ${accessCtx.projectId}
                  AND (id = ${node.id} OR code LIKE ${node.code + ".%"})
                  AND archived_at IS NULL
              )`,
              eq(ganttActivities.archivedAt, node.archivedAt)
            )
          );

        // Recalculate leaf status for restored subtree and parent
        const descendants = await collectDescendants(tx, accessCtx.projectId, updated.id);
        const affectedIds = [updated.id, ...descendants.map((d) => d.id)];
        if (parentId !== null) affectedIds.push(parentId);
        await setNodesLeaf(tx, Array.from(new Set(affectedIds)));

        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "wbs", "restore", updated.id, before, mapWbsNodeRow(updated));

        return updated;
      });

      return { node: mapWbsNodeRow(result), revision: accessCtx.projectRevision };
    }),
});
