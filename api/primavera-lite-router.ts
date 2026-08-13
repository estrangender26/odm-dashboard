import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { db } from "./queries/connection";
import {
  ganttProjects,
  ganttWbsNodes,
  ganttActivities,
  ganttActivityDependencies,
  ganttCalendars,
  ganttCalendarExceptions,
  ganttProjectEvents,
} from "@db/schema";
import { eq, and, or, sql, asc, isNull, inArray, ne } from "drizzle-orm";
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
import { runScheduleEngine } from "@/modules/gantt/primavera-lite/schedulingEngine";
import { isScheduleOutOfDate } from "@/modules/gantt/primavera-lite/scheduleStaleness";

const MAX_NAME_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_NOTES_LENGTH = 5000;
const MAX_ACTOR_NAME_LENGTH = 100;
const MAX_ACTIVITIES_PER_PROJECT = Number(process.env.MAX_ACTIVITIES_PER_PROJECT) || 2000;
const dependencyTypeSchema = z.enum(["FS", "SS", "FF", "SF"]);

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
    dataDate: dateStringSchema.optional().nullable(),
  }),
  actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
});

const runScheduleInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
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
  activityName: z.string().trim().min(1).max(500),
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
  calendarId: z.number().int().positive().optional().nullable(),
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
  changes: activityInputSchema.partial().extend({
    wbsNodeId: z.number().int().positive().optional(),
  }).refine((changes) => Object.keys(changes).length > 0, {
    message: "At least one activity change is required",
  }),
  actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
});

const dependencyFieldsSchema = z.object({
  predecessorActivityId: z.number().int().positive(),
  successorActivityId: z.number().int().positive(),
  dependencyType: dependencyTypeSchema,
  lagDays: z.number().int(),
});

const createDependencyInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  dependency: dependencyFieldsSchema,
  actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
});

const updateDependencyInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  dependencyId: z.number().int().positive(),
  changes: dependencyFieldsSchema.partial().refine((changes) => Object.keys(changes).length > 0, "At least one dependency change is required"),
  actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
});

const dependencyIdInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  dependencyId: z.number().int().positive(),
  actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
});

const archiveDependencyInputSchema = dependencyIdInputSchema.extend({
  previewToken: z.string().min(1),
  confirmed: z.literal(true),
});

const restoreDependencyInputSchema = dependencyIdInputSchema.extend({ confirmed: z.literal(true) });

const reorderActivityInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  activityId: z.number().int().positive(),
  targetWbsNodeId: z.number().int().positive(),
  newSortOrder: z.number().int().min(0),
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
    lastScheduledAt: project.lastScheduledAt,
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
    sortOrder: activity.sortOrder,
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

type ActivityLike = {
  plannedStart?: unknown;
  plannedFinish?: unknown;
  actualStart?: unknown;
  actualFinish?: unknown;
  [key: string]: unknown;
};

/**
 * Normalize a stored/edited date value to a canonical YYYY-MM-DD string (or null).
 * Drizzle date columns are read back as "YYYY-MM-DD" strings, but we also accept
 * Date instances defensively.
 */
function toIsoDateString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}

function normalizeComparableDate(value: unknown): unknown {
  return value instanceof Date ? toIsoDateString(value) : value;
}

/**
 * Returns true when every provided change maps to the activity's current value.
 * Used to short-circuit no-op edits so they do not bump the project revision or
 * create audit events.
 */
function isActivityChangeNoop(activity: ActivityLike, changes: Record<string, unknown>): boolean {
  return Object.keys(changes).every((key) => {
    const current = normalizeComparableDate(activity[key]);
    const next = normalizeComparableDate(changes[key]);
    return current === next;
  });
}

/**
 * Validates planned/actual date pairs after merging the proposed changes with the
 * activity's existing dates. Returns an error message or null when valid.
 * Blank (null) dates are allowed; both endpoints are required to enforce start <= finish.
 */
function validateActivityDateRanges(
  activity: ActivityLike,
  changes: Record<string, unknown>
): string | null {
  const plannedStart = changes.plannedStart !== undefined ? toIsoDateString(changes.plannedStart) : toIsoDateString(activity.plannedStart);
  const plannedFinish = changes.plannedFinish !== undefined ? toIsoDateString(changes.plannedFinish) : toIsoDateString(activity.plannedFinish);
  if (plannedStart && plannedFinish && plannedStart > plannedFinish) {
    return "Planned start must be on or before planned finish";
  }
  const actualStart = changes.actualStart !== undefined ? toIsoDateString(changes.actualStart) : toIsoDateString(activity.actualStart);
  const actualFinish = changes.actualFinish !== undefined ? toIsoDateString(changes.actualFinish) : toIsoDateString(activity.actualFinish);
  if (actualStart && actualFinish && actualStart > actualFinish) {
    return "Actual start must be on or before actual finish";
  }
  return null;
}

/**
 * Compares a proposed project-meta change against the current project row. Returns
 * true when every provided change equals the current value (no-op).
 */
function isProjectMetaNoop(
  current: Record<string, unknown>,
  changes: Record<string, unknown>
): boolean {
  return Object.keys(changes).every((key) => {
    const currentVal = current[key];
    const nextVal = changes[key];
    return normalizeComparableDate(currentVal) === normalizeComparableDate(nextVal);
  });
}

function mapDependencyRow(dependency: typeof ganttActivityDependencies.$inferSelect) {
  return {
    id: dependency.id,
    projectId: dependency.projectId,
    predecessorActivityId: dependency.predecessorActivityId,
    successorActivityId: dependency.successorActivityId,
    dependencyType: dependency.dependencyType as "FS" | "SS" | "FF" | "SF",
    lagDays: dependency.lagDays,
    revision: dependency.revision,
    updatedByName: dependency.updatedByName,
    archivedAt: dependency.archivedAt,
    createdAt: dependency.createdAt,
    updatedAt: dependency.updatedAt,
  };
}

async function requireDependencyActivities(
  tx: PgTransaction<any, any, any>, projectId: number, predecessorActivityId: number, successorActivityId: number
) {
  if (predecessorActivityId === successorActivityId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "An activity cannot depend on itself" });
  }
  const rows = await tx.select({ id: ganttActivities.id, archivedAt: ganttActivities.archivedAt })
    .from(ganttActivities)
    .where(and(eq(ganttActivities.projectId, projectId), inArray(ganttActivities.id, [predecessorActivityId, successorActivityId])));
  if (rows.length !== 2) throw new TRPCError({ code: "NOT_FOUND", message: "Dependency activities must belong to this project" });
  if (rows.some((row) => row.archivedAt)) throw new TRPCError({ code: "BAD_REQUEST", message: "Archived activities cannot have active dependencies" });
}

async function requireNoDependencyCycle(
  tx: PgTransaction<any, any, any>, projectId: number, predecessorActivityId: number, successorActivityId: number, excludeId?: number
) {
  const rows = await tx.select({ id: ganttActivityDependencies.id, predecessorActivityId: ganttActivityDependencies.predecessorActivityId, successorActivityId: ganttActivityDependencies.successorActivityId })
    .from(ganttActivityDependencies)
    .where(and(eq(ganttActivityDependencies.projectId, projectId), isNull(ganttActivityDependencies.archivedAt)));
  const graph = new Map<number, number[]>();
  for (const row of rows) {
    if (row.id === excludeId) continue;
    graph.set(row.predecessorActivityId, [...(graph.get(row.predecessorActivityId) ?? []), row.successorActivityId]);
  }
  graph.set(predecessorActivityId, [...(graph.get(predecessorActivityId) ?? []), successorActivityId]);
  const stack = [successorActivityId];
  const seen = new Set<number>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === predecessorActivityId) throw new TRPCError({ code: "BAD_REQUEST", message: "Dependency would create a circular relationship" });
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(graph.get(current) ?? []));
  }
}

async function requireNoDuplicateDependency(
  tx: PgTransaction<any, any, any>, projectId: number, values: { predecessorActivityId: number; successorActivityId: number; dependencyType: string; lagDays: number }, excludeId?: number
) {
  const conditions = [
    eq(ganttActivityDependencies.projectId, projectId),
    eq(ganttActivityDependencies.predecessorActivityId, values.predecessorActivityId),
    eq(ganttActivityDependencies.successorActivityId, values.successorActivityId),
    eq(ganttActivityDependencies.dependencyType, values.dependencyType),
    isNull(ganttActivityDependencies.archivedAt),
  ];
  if (excludeId !== undefined) conditions.push(ne(ganttActivityDependencies.id, excludeId));
  const duplicate = await tx.select({ id: ganttActivityDependencies.id }).from(ganttActivityDependencies).where(and(...conditions));
  if (duplicate.length) throw new TRPCError({ code: "CONFLICT", message: "Duplicate active dependency" });
}

async function requireActiveLeafWbs(
  tx: PgTransaction<any, any, any>,
  projectId: number,
  wbsNodeId: number
) {
  const [node] = await tx
    .select()
    .from(ganttWbsNodes)
    .where(and(
      eq(ganttWbsNodes.id, wbsNodeId),
      eq(ganttWbsNodes.projectId, projectId),
      isNull(ganttWbsNodes.archivedAt)
    ));
  if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "WBS node not found" });
  if (!node.isLeaf) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Activities can only be assigned to leaf WBS nodes" });
  }
  return node;
}

async function requireProjectCalendar(
  tx: PgTransaction<any, any, any>,
  projectId: number,
  calendarId: number
) {
  const [calendar] = await tx
    .select()
    .from(ganttCalendars)
    .where(and(eq(ganttCalendars.id, calendarId), eq(ganttCalendars.projectId, projectId)));
  if (!calendar) throw new TRPCError({ code: "NOT_FOUND", message: "Calendar not found" });
  return calendar;
}

async function normalizeActivityOrder(
  tx: PgTransaction<any, any, any>,
  projectId: number,
  wbsNodeId: number,
  orderedIds?: number[]
) {
  const rows = await tx
    .select({ id: ganttActivities.id })
    .from(ganttActivities)
    .where(and(
      eq(ganttActivities.projectId, projectId),
      eq(ganttActivities.wbsNodeId, wbsNodeId),
      isNull(ganttActivities.archivedAt)
    ))
    .orderBy(asc(ganttActivities.sortOrder), asc(ganttActivities.id));
  const ids = orderedIds ?? rows.map((row) => row.id);
  const now = new Date();
  for (let index = 0; index < ids.length; index++) {
    await tx.update(ganttActivities)
      .set({ sortOrder: index, updatedAt: now })
      .where(and(eq(ganttActivities.id, ids[index]), eq(ganttActivities.projectId, projectId)));
  }
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

        const [defaultCalendar] = await tx
          .insert(ganttCalendars)
          .values({
            projectId: project.id,
            name: "Default Calendar",
            workingDays: [1, 2, 3, 4, 5],
            hoursPerDay: "8.00",
            timezone: "Asia/Manila",
          })
          .returning();

        const [updatedProject] = await tx
          .update(ganttProjects)
          .set({ defaultCalendarId: defaultCalendar.id })
          .where(eq(ganttProjects.id, project.id))
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
          afterData: { name: project.name, slug: project.slug, defaultCalendarId: defaultCalendar.id },
          projectRevision: 1,
        });

        return { project: updatedProject, rootNode };
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
        .orderBy(asc(ganttActivities.wbsNodeId), asc(ganttActivities.sortOrder), asc(ganttActivities.id));

      const dependencies = await db
        .select()
        .from(ganttActivityDependencies)
        .where(and(eq(ganttActivityDependencies.projectId, accessCtx.projectId), isNull(ganttActivityDependencies.archivedAt)))
        .orderBy(asc(ganttActivityDependencies.id));

      const calendars = await db
        .select()
        .from(ganttCalendars)
        .where(eq(ganttCalendars.projectId, accessCtx.projectId))
        .orderBy(asc(ganttCalendars.name), asc(ganttCalendars.id));

      const scheduleEvents = await db
        .select({ projectRevision: ganttProjectEvents.projectRevision })
        .from(ganttProjectEvents)
        .where(and(
          eq(ganttProjectEvents.projectId, accessCtx.projectId),
          eq(ganttProjectEvents.entityType, "project"),
          eq(ganttProjectEvents.action, "schedule")
        ))
        .orderBy(sql`${ganttProjectEvents.projectRevision} DESC`)
        .limit(1);
      const lastScheduledRevision = scheduleEvents[0]?.projectRevision ?? null;
      const subsequentEvents = lastScheduledRevision == null ? [] : await db
        .select({
          entityType: ganttProjectEvents.entityType,
          action: ganttProjectEvents.action,
          beforeData: ganttProjectEvents.beforeData,
          afterData: ganttProjectEvents.afterData,
          projectRevision: ganttProjectEvents.projectRevision,
        })
        .from(ganttProjectEvents)
        .where(and(
          eq(ganttProjectEvents.projectId, accessCtx.projectId),
          sql`${ganttProjectEvents.projectRevision} > ${lastScheduledRevision}`
        ));
      const scheduleOutOfDate = isScheduleOutOfDate(lastScheduledRevision, subsequentEvents);

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
        project: projectRow ? { ...mapProjectRow(projectRow), scheduleOutOfDate } : null,
        wbsNodes: wbsNodes.map(mapWbsNodeRow),
        activities: activities.map(mapActivityRow),
        dependencies: dependencies.map(mapDependencyRow),
        calendars,
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

        // No-op guard: identical edits must not create a revision bump or audit event.
        if (isProjectMetaNoop(current as unknown as Record<string, unknown>, input.changes)) {
          return { project: current, revision: current.revision, noop: true };
        }

        const setData: Record<string, unknown> = { updatedAt: new Date() };
        if (input.changes.name !== undefined) {
          setData.name = input.changes.name;
          setData.projectName = input.changes.name;
        }
        if (input.changes.projectName !== undefined) setData.projectName = input.changes.projectName;
        if (input.changes.description !== undefined) setData.description = input.changes.description;
        if (input.changes.status !== undefined) setData.status = input.changes.status;
        if (input.changes.dataDate !== undefined) setData.dataDate = input.changes.dataDate;

        const [updated] = await tx
          .update(ganttProjects)
          .set(setData)
          .where(eq(ganttProjects.id, accessCtx.projectId))
          .returning();

        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "project", "update", accessCtx.projectId, before, mapProjectRow(updated));

        return { project: updated, revision: newRevision, noop: false };
      });

      return { project: mapProjectRow(result.project), revision: result.revision, noop: result.noop };
    }),

  runSchedule: publicQuery
    .input(runScheduleInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-run-schedule:${input.slug}`, 30, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);

        const [projectRow] = await tx
          .select()
          .from(ganttProjects)
          .where(eq(ganttProjects.id, accessCtx.projectId));
        if (!projectRow) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        if (projectRow.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }
        if (projectRow.archivedAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Project is archived" });
        }

        const calendars = await tx
          .select()
          .from(ganttCalendars)
          .where(eq(ganttCalendars.projectId, accessCtx.projectId));

        const calendarIds = calendars.map((c) => c.id);
        const exceptionsRows =
          calendarIds.length > 0
            ? await tx
                .select()
                .from(ganttCalendarExceptions)
                .where(inArray(ganttCalendarExceptions.calendarId, calendarIds))
            : [];

        const calendarsWithExceptions = calendars.map((cal) => ({
          ...cal,
          exceptions: exceptionsRows
            .filter((ex) => ex.calendarId === cal.id)
            .map((ex) => ({
              exceptionDate: String(ex.exceptionDate ?? "").trim().split("T")[0],
              isWorking: ex.isWorking,
            })),
        }));

        const activitiesRow = await tx
          .select()
          .from(ganttActivities)
          .where(and(eq(ganttActivities.projectId, accessCtx.projectId), isNull(ganttActivities.archivedAt)))
          .orderBy(asc(ganttActivities.wbsNodeId), asc(ganttActivities.sortOrder), asc(ganttActivities.id));

        const dependenciesRow = await tx
          .select()
          .from(ganttActivityDependencies)
          .where(and(eq(ganttActivityDependencies.projectId, accessCtx.projectId), isNull(ganttActivityDependencies.archivedAt)))
          .orderBy(asc(ganttActivityDependencies.id));

        const todayStr = new Date().toISOString().split("T")[0];
        let scheduled;
        try {
          scheduled = runScheduleEngine(
            projectRow.dataDate,
            todayStr,
            calendarsWithExceptions,
            projectRow.defaultCalendarId,
            activitiesRow,
            dependenciesRow
          );
        } catch (err: any) {
          if (/circular|cycle/i.test(err?.message || "")) {
            throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
          }
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err?.message || "Failed to schedule project" });
        }

        const now = new Date();
        for (const s of scheduled) {
          await tx
            .update(ganttActivities)
            .set({
              earlyStart: s.earlyStart,
              earlyFinish: s.earlyFinish,
              lateStart: s.lateStart,
              lateFinish: s.lateFinish,
              totalFloatDays: s.totalFloatDays,
              freeFloatDays: s.freeFloatDays,
              updatedAt: now,
              updatedByName: input.actorName ?? "Anonymous",
            })
            .where(
              and(
                eq(ganttActivities.id, s.id),
                eq(ganttActivities.projectId, accessCtx.projectId)
              )
            );
        }

        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;

        const [updatedProject] = await tx
          .update(ganttProjects)
          .set({
            lastScheduledAt: now,
            updatedAt: now,
          })
          .where(eq(ganttProjects.id, accessCtx.projectId))
          .returning();

        await insertEvent(
          tx,
          accessCtx,
          "project",
          "schedule",
          accessCtx.projectId,
          null,
          {
            scheduledCount: scheduled.length,
            criticalCount: scheduled.filter((s) => s.totalFloatDays <= 0).length,
            dataDate: projectRow.dataDate ?? null,
          }
        );

        return {
          project: updatedProject,
          scheduledCount: scheduled.length,
          criticalCount: scheduled.filter((s) => s.totalFloatDays <= 0).length,
        };
      });

      return {
        project: mapProjectRow(result.project),
        revision: accessCtx.projectRevision,
        scheduledCount: result.scheduledCount,
        criticalCount: result.criticalCount,
      };
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
          wbsNodeId = (await requireActiveLeafWbs(tx, accessCtx.projectId, input.wbsNodeId)).id;
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

        if (input.activity.calendarId != null) {
          await requireProjectCalendar(tx, accessCtx.projectId, input.activity.calendarId);
        }

        const [orderRow] = await tx
          .select({ next: sql<number>`COALESCE(MAX(${ganttActivities.sortOrder}), -1)::int + 1` })
          .from(ganttActivities)
          .where(and(
            eq(ganttActivities.projectId, accessCtx.projectId),
            eq(ganttActivities.wbsNodeId, wbsNodeId),
            isNull(ganttActivities.archivedAt)
          ));

        const [activity] = await tx
          .insert(ganttActivities)
          .values({
            projectId: accessCtx.projectId,
            wbsNodeId,
            activityName: input.activity.activityName,
            activityId: (input.activity.activityId ?? null) as any,
            activityType: (input.activity.activityType ?? "task") as any,
            sortOrder: orderRow?.next ?? 0,
            calendarId: input.activity.calendarId ?? null,
            originalDurationDays: (input.activity.originalDurationDays ?? 0) as any,
            remainingDurationDays: (input.activity.remainingDurationDays ?? 0) as any,
            plannedStart: (input.activity.plannedStart ?? null) as any,
            plannedFinish: (input.activity.plannedFinish ?? null) as any,
            actualStart: (input.activity.actualStart ?? null) as any,
            actualFinish: (input.activity.actualFinish ?? null) as any,
            percentComplete: (input.activity.actualFinish != null ? 100 : input.activity.percentComplete ?? 0) as any,
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

        // Server-side date-pair validation: planned start <= planned finish and
        // actual start <= actual finish, merging proposed changes with existing dates.
        const dateRangeError = validateActivityDateRanges(activity, changes);
        if (dateRangeError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: dateRangeError });
        }

        // No-op guard: identical edits must not bump the project revision or create audit events.
        if (isActivityChangeNoop(activity, changes)) {
          return { activity, revision: projectRow.revision };
        }

        const setData: Record<string, unknown> = { updatedAt: new Date(), updatedByName: input.actorName ?? "Anonymous" };
        if (changes.wbsNodeId !== undefined) {
          await requireActiveLeafWbs(tx, accessCtx.projectId, changes.wbsNodeId);
          setData.wbsNodeId = changes.wbsNodeId;
          if (changes.wbsNodeId !== activity.wbsNodeId) {
            const [orderRow] = await tx
              .select({ next: sql<number>`COALESCE(MAX(${ganttActivities.sortOrder}), -1)::int + 1` })
              .from(ganttActivities)
              .where(and(
                eq(ganttActivities.projectId, accessCtx.projectId),
                eq(ganttActivities.wbsNodeId, changes.wbsNodeId),
                isNull(ganttActivities.archivedAt)
              ));
            setData.sortOrder = orderRow?.next ?? 0;
          }
        }
        if (changes.calendarId !== undefined && changes.calendarId !== null) {
          await requireProjectCalendar(tx, accessCtx.projectId, changes.calendarId);
        }
        if (changes.calendarId !== undefined) setData.calendarId = changes.calendarId;
        if (changes.activityName !== undefined) setData.activityName = changes.activityName;
        if (changes.activityId !== undefined) setData.activityId = changes.activityId;
        if (changes.activityType !== undefined) setData.activityType = changes.activityType;
        if (changes.originalDurationDays !== undefined) setData.originalDurationDays = changes.originalDurationDays;
        if (changes.remainingDurationDays !== undefined) setData.remainingDurationDays = changes.remainingDurationDays;
        if (changes.plannedStart !== undefined) setData.plannedStart = changes.plannedStart;
        if (changes.plannedFinish !== undefined) setData.plannedFinish = changes.plannedFinish;
        if (changes.actualStart !== undefined) setData.actualStart = changes.actualStart;
        if (changes.actualFinish !== undefined) setData.actualFinish = changes.actualFinish;
        // A supplied Actual Finish completes the activity in the same revision.
        // Clearing it deliberately leaves existing progress unchanged.
        if (changes.actualFinish != null) setData.percentComplete = 100;
        else if (changes.percentComplete !== undefined) setData.percentComplete = changes.percentComplete;
        if (changes.status !== undefined) setData.status = changes.status;
        if (changes.constraintType !== undefined) setData.constraintType = changes.constraintType;
        if (changes.constraintDate !== undefined) setData.constraintDate = changes.constraintDate;
        if (changes.notes !== undefined) setData.notes = changes.notes;
        setData.revision = sql`${ganttActivities.revision} + 1`;

        const [updated] = await tx
          .update(ganttActivities)
          .set(setData)
          .where(eq(ganttActivities.id, activity.id))
          .returning();

        if (changes.wbsNodeId !== undefined && changes.wbsNodeId !== activity.wbsNodeId) {
          await normalizeActivityOrder(tx, accessCtx.projectId, activity.wbsNodeId);
        }

        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "activity", "update", updated.id, before, mapActivityRow(updated));

        return { activity: updated, revision: newRevision };
      });

      return { activity: mapActivityRow(result.activity), revision: result.revision };
    }),

  reorderActivity: publicQuery
    .input(reorderActivityInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-reorder-activity:${input.slug}`, 60, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);
        const projectRow = await validateProjectNotArchived(tx, accessCtx.projectId);
        if (projectRow.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }
        await requireActiveLeafWbs(tx, accessCtx.projectId, input.targetWbsNodeId);
        const [activity] = await tx.select().from(ganttActivities).where(and(
          eq(ganttActivities.id, input.activityId),
          eq(ganttActivities.projectId, accessCtx.projectId),
          isNull(ganttActivities.archivedAt)
        ));
        if (!activity) throw new TRPCError({ code: "NOT_FOUND", message: "Activity not found" });

        const sourceWbsNodeId = activity.wbsNodeId;
        const targetRows = await tx
          .select({ id: ganttActivities.id })
          .from(ganttActivities)
          .where(and(
            eq(ganttActivities.projectId, accessCtx.projectId),
            eq(ganttActivities.wbsNodeId, input.targetWbsNodeId),
            isNull(ganttActivities.archivedAt)
          ))
          .orderBy(asc(ganttActivities.sortOrder), asc(ganttActivities.id));
        const orderedIds = targetRows.map((row) => row.id).filter((id) => id !== activity.id);
        const targetIndex = Math.min(input.newSortOrder, orderedIds.length);
        orderedIds.splice(targetIndex, 0, activity.id);

        await tx.update(ganttActivities).set({
          wbsNodeId: input.targetWbsNodeId,
          sortOrder: targetIndex,
          revision: sql`${ganttActivities.revision} + 1`,
          updatedAt: new Date(),
          updatedByName: input.actorName ?? "Anonymous",
        }).where(and(eq(ganttActivities.id, activity.id), eq(ganttActivities.projectId, accessCtx.projectId)));
        await normalizeActivityOrder(tx, accessCtx.projectId, input.targetWbsNodeId, orderedIds);
        if (sourceWbsNodeId !== input.targetWbsNodeId) {
          await normalizeActivityOrder(tx, accessCtx.projectId, sourceWbsNodeId);
        }

        const [updated] = await tx.select().from(ganttActivities).where(eq(ganttActivities.id, activity.id));
        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "activity", "reorder", updated.id, mapActivityRow(activity), mapActivityRow(updated));
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

        await tx.update(ganttActivityDependencies).set({
          archivedAt: now, updatedAt: now, revision: sql`${ganttActivityDependencies.revision} + 1`, updatedByName: input.actorName ?? "Anonymous",
        }).where(and(
          eq(ganttActivityDependencies.projectId, accessCtx.projectId),
          isNull(ganttActivityDependencies.archivedAt),
          or(eq(ganttActivityDependencies.predecessorActivityId, activity.id), eq(ganttActivityDependencies.successorActivityId, activity.id))
        ));

        const [updated] = await tx
          .update(ganttActivities)
          .set({ archivedAt: now, updatedAt: now, revision: sql`${ganttActivities.revision} + 1` })
          .where(eq(ganttActivities.id, activity.id))
          .returning();

        await normalizeActivityOrder(tx, accessCtx.projectId, activity.wbsNodeId);

        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "activity", "archive", updated.id, before, mapActivityRow(updated));

        return updated;
      });

      return { activity: mapActivityRow(result), revision: accessCtx.projectRevision };
    }),

  createDependency: publicQuery
    .input(createDependencyInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-create-dependency:${input.slug}`, 60, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);
      const dependency = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);
        const project = await validateProjectNotArchived(tx, accessCtx.projectId);
        if (project.revision !== input.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        const values = input.dependency;
        await requireDependencyActivities(tx, accessCtx.projectId, values.predecessorActivityId, values.successorActivityId);
        await requireNoDuplicateDependency(tx, accessCtx.projectId, values);
        await requireNoDependencyCycle(tx, accessCtx.projectId, values.predecessorActivityId, values.successorActivityId);
        const [created] = await tx.insert(ganttActivityDependencies).values({
          projectId: accessCtx.projectId, ...values, updatedByName: input.actorName ?? "Anonymous",
        }).returning();
        const revision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = revision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "dependency", "create", created.id, null, mapDependencyRow(created));
        return created;
      });
      return { dependency: mapDependencyRow(dependency), revision: accessCtx.projectRevision };
    }),

  listDependencies: publicQuery
    .input(tokenAccessInputSchema)
    .query(async ({ input }) => {
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      const dependencies = await db.select().from(ganttActivityDependencies).where(and(
        eq(ganttActivityDependencies.projectId, accessCtx.projectId), isNull(ganttActivityDependencies.archivedAt)
      )).orderBy(asc(ganttActivityDependencies.id));
      return { dependencies: dependencies.map(mapDependencyRow), revision: accessCtx.projectRevision };
    }),

  updateDependency: publicQuery
    .input(updateDependencyInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-update-dependency:${input.slug}`, 60, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);
      const dependency = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);
        const project = await validateProjectNotArchived(tx, accessCtx.projectId);
        if (project.revision !== input.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        const [current] = await tx.select().from(ganttActivityDependencies).where(and(
          eq(ganttActivityDependencies.id, input.dependencyId), eq(ganttActivityDependencies.projectId, accessCtx.projectId), isNull(ganttActivityDependencies.archivedAt)
        ));
        if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Dependency not found" });
        const values = {
          predecessorActivityId: input.changes.predecessorActivityId ?? current.predecessorActivityId,
          successorActivityId: input.changes.successorActivityId ?? current.successorActivityId,
          dependencyType: input.changes.dependencyType ?? current.dependencyType,
          lagDays: input.changes.lagDays ?? current.lagDays,
        };
        await requireDependencyActivities(tx, accessCtx.projectId, values.predecessorActivityId, values.successorActivityId);
        await requireNoDuplicateDependency(tx, accessCtx.projectId, values, current.id);
        await requireNoDependencyCycle(tx, accessCtx.projectId, values.predecessorActivityId, values.successorActivityId, current.id);
        const [updated] = await tx.update(ganttActivityDependencies).set({
          ...values, revision: sql`${ganttActivityDependencies.revision} + 1`, updatedAt: new Date(), updatedByName: input.actorName ?? "Anonymous",
        }).where(eq(ganttActivityDependencies.id, current.id)).returning();
        const revision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = revision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "dependency", "update", updated.id, mapDependencyRow(current), mapDependencyRow(updated));
        return updated;
      });
      return { dependency: mapDependencyRow(dependency), revision: accessCtx.projectRevision };
    }),

  archiveDependencyDryRun: publicQuery
    .input(dependencyIdInputSchema)
    .mutation(async ({ input }) => {
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);
      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);
        const project = await validateProjectNotArchived(tx, accessCtx.projectId);
        if (project.revision !== input.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        const [dependency] = await tx.select({ id: ganttActivityDependencies.id }).from(ganttActivityDependencies).where(and(
          eq(ganttActivityDependencies.id, input.dependencyId), eq(ganttActivityDependencies.projectId, accessCtx.projectId), isNull(ganttActivityDependencies.archivedAt)
        ));
        if (!dependency) throw new TRPCError({ code: "NOT_FOUND", message: "Dependency not found" });
        return dependency;
      });
      return { dryRun: true, wouldArchive: { dependencies: 1 }, previewToken: await createPreviewToken("archiveDependency", input.slug, input.expectedRevision, result.id) };
    }),

  archiveDependency: publicQuery
    .input(archiveDependencyInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-archive-dependency:${input.slug}`, 30, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);
      try { await verifyPreviewToken(input.previewToken, "archiveDependency", input.slug, input.expectedRevision, input.dependencyId); }
      catch (error) { handlePreviewTokenError(error); }
      const dependency = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);
        const project = await validateProjectNotArchived(tx, accessCtx.projectId);
        if (project.revision !== input.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        const [current] = await tx.select().from(ganttActivityDependencies).where(and(
          eq(ganttActivityDependencies.id, input.dependencyId), eq(ganttActivityDependencies.projectId, accessCtx.projectId), isNull(ganttActivityDependencies.archivedAt)
        ));
        if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Dependency not found" });
        const now = new Date();
        const [updated] = await tx.update(ganttActivityDependencies).set({ archivedAt: now, updatedAt: now, revision: sql`${ganttActivityDependencies.revision} + 1`, updatedByName: input.actorName ?? "Anonymous" })
          .where(eq(ganttActivityDependencies.id, current.id)).returning();
        const revision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = revision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "dependency", "archive", updated.id, mapDependencyRow(current), mapDependencyRow(updated));
        return updated;
      });
      return { dependency: mapDependencyRow(dependency), revision: accessCtx.projectRevision };
    }),

  restoreDependency: publicQuery
    .input(restoreDependencyInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-restore-dependency:${input.slug}`, 30, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);
      const dependency = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);
        const project = await validateProjectNotArchived(tx, accessCtx.projectId);
        if (project.revision !== input.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        const [current] = await tx.select().from(ganttActivityDependencies).where(and(
          eq(ganttActivityDependencies.id, input.dependencyId), eq(ganttActivityDependencies.projectId, accessCtx.projectId)
        ));
        if (!current || !current.archivedAt) throw new TRPCError({ code: "NOT_FOUND", message: "Archived dependency not found" });
        const values = mapDependencyRow(current);
        await requireDependencyActivities(tx, accessCtx.projectId, current.predecessorActivityId, current.successorActivityId);
        await requireNoDuplicateDependency(tx, accessCtx.projectId, values, current.id);
        await requireNoDependencyCycle(tx, accessCtx.projectId, current.predecessorActivityId, current.successorActivityId, current.id);
        const [updated] = await tx.update(ganttActivityDependencies).set({ archivedAt: null, updatedAt: new Date(), revision: sql`${ganttActivityDependencies.revision} + 1`, updatedByName: input.actorName ?? "Anonymous" })
          .where(eq(ganttActivityDependencies.id, current.id)).returning();
        const revision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = revision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "dependency", "restore", updated.id, mapDependencyRow(current), mapDependencyRow(updated));
        return updated;
      });
      return { dependency: mapDependencyRow(dependency), revision: accessCtx.projectRevision };
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
