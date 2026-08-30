import { randomUUID } from "node:crypto";
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
  ganttBaselines,
  ganttBaselineActivities,
} from "@db/schema";
import { eq, and, or, sql, asc, isNull, isNotNull, inArray, ne } from "drizzle-orm";
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
import {
  runScheduleEngine,
  addWorkingDays,
  countWorkingDays,
  dateToCalendarDay,
  calendarDayToDate,
  type ScheduleCalendarInput,
} from "@/modules/gantt/primavera-lite/schedulingEngine";
import { isScheduleOutOfDate } from "@/modules/gantt/primavera-lite/scheduleStaleness";
import {
  calendarAffectsActiveSchedule,
  validateWorkingDays,
  workingDaysEqual,
} from "@/modules/gantt/primavera-lite/calendarModel";
import {
  resolveProgress,
  type ProgressFields,
} from "@/modules/gantt/primavera-lite/progressModel";

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
  includeArchived: z.boolean().optional(),
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

/**
 * Canonical Activity ID normalization (F-03):
 * 1. input string; 2. trim surrounding whitespace; 3. empty -> NULL;
 * 4. otherwise preserve exact case and content. Active non-null IDs are unique
 * per project (DB partial unique index is the concurrency-safe authority).
 */
function canonicalizeActivityId(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/** Unsaved constraints are rejected rather than persisted-and-ignored (F-02). */
function rejectUnsupportedConstraint(value: unknown): boolean {
  const v = value == null ? null : String(value).trim();
  return v == null || v === "";
}

// No .transform() on optional fields: zod v4 materializes absent keys through
// transforms, which would defeat the empty-changes refine and the no-op guard.
const unsupportedConstraintTypeSchema = z
  .string()
  .max(20)
  .optional()
  .nullable()
  .refine((v) => rejectUnsupportedConstraint(v), {
    message: "Constraints are not supported yet; remove constraintType",
  });

const unsupportedConstraintDateSchema = dateStringSchema
  .optional()
  .nullable()
  .refine((v) => rejectUnsupportedConstraint(v), {
    message: "Constraints are not supported yet; remove constraintDate",
  });

const activityInputSchema = z.object({
  activityName: z.string().trim().min(1).max(500),
  // Canonical Activity ID normalization (F-03) happens in the router write path
  // (canonicalizeActivityId): trim -> empty -> NULL -> preserve case otherwise.
  activityId: z.string().trim().max(100).optional().nullable(),
  activityType: z.string().max(20).optional().nullable(),
  originalDurationDays: z.number().int().min(0).optional().nullable(),
  remainingDurationDays: z.number().int().min(0).optional().nullable(),
  plannedStart: dateStringSchema.optional().nullable(),
  plannedFinish: dateStringSchema.optional().nullable(),
  actualStart: dateStringSchema.optional().nullable(),
  actualFinish: dateStringSchema.optional().nullable(),
  percentComplete: z.number().int().min(0).max(100).optional().nullable(),
  status: z.string().max(50).optional().nullable(),
  constraintType: unsupportedConstraintTypeSchema,
  constraintDate: unsupportedConstraintDateSchema,
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

const restoreActivityInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  activityId: z.number().int().positive(),
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

const baselineNameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);
const baselineDescriptionSchema = z.string().trim().max(MAX_DESCRIPTION_LENGTH).optional();

const captureBaselineInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  name: baselineNameSchema,
  description: baselineDescriptionSchema,
  actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
});

const listBaselinesInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
});

const compareBaselineInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  baselineId: z.number().int().positive(),
});

const workingDaysInputSchema = z.array(z.number().int()).min(1);

const createCalendarInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  calendar: z.object({
    name: z.string().min(1).max(MAX_NAME_LENGTH),
    workingDays: workingDaysInputSchema,
  }),
  actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
});

const updateCalendarInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  calendarId: z.number().int().positive(),
  changes: z.object({
    name: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
    workingDays: workingDaysInputSchema.optional(),
  }).refine((changes) => Object.keys(changes).length > 0, {
    message: "At least one calendar change is required",
  }),
  actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
});

const setProjectDefaultCalendarInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  calendarId: z.number().int().positive(),
  actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
});

const calendarExceptionFieldsSchema = z.object({
  exceptionDate: dateStringSchema,
  isWorking: z.boolean(),
  description: z.string().max(500).optional().nullable(),
});

const createCalendarExceptionInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  calendarId: z.number().int().positive(),
  exception: calendarExceptionFieldsSchema,
  actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
});

const updateCalendarExceptionInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  exceptionId: z.number().int().positive(),
  changes: calendarExceptionFieldsSchema.partial().refine((changes) => Object.keys(changes).length > 0, {
    message: "At least one exception change is required",
  }),
  actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
});

const deleteCalendarExceptionInputSchema = z.object({
  slug: slugSchema,
  access: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  exceptionId: z.number().int().positive(),
  actorName: z.string().max(MAX_ACTOR_NAME_LENGTH).optional(),
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

function mapBaselineRow(baseline: typeof ganttBaselines.$inferSelect) {
  return {
    id: baseline.id,
    projectId: baseline.projectId,
    publicId: baseline.publicId,
    name: baseline.name,
    description: baseline.description,
    activityCount: baseline.activityCount,
    projectRevision: baseline.projectRevision,
    capturedAt: baseline.capturedAt,
    capturedByName: baseline.capturedByName,
    createdAt: baseline.createdAt,
  } as any;
}

function calendarDayVariance(
  currentDate: string | null | undefined,
  baselineDate: string | null | undefined
): number | null {
  if (!currentDate || !baselineDate) return null;
  return dateToCalendarDay(currentDate) - dateToCalendarDay(baselineDate);
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

function parseWorkingDays(days: unknown): number[] {
  try {
    return validateWorkingDays(days);
  } catch (err) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "Invalid workingDays" });
  }
}

function mapCalendarRow(calendar: typeof ganttCalendars.$inferSelect, exceptions: typeof ganttCalendarExceptions.$inferSelect[] = []) {
  return {
    id: calendar.id,
    projectId: calendar.projectId,
    name: calendar.name,
    workingDays: calendar.workingDays,
    hoursPerDay: calendar.hoursPerDay,
    timezone: calendar.timezone,
    createdAt: calendar.createdAt,
    updatedAt: calendar.updatedAt,
    exceptions: exceptions.map(mapCalendarExceptionRow),
  };
}

function mapCalendarExceptionRow(exception: typeof ganttCalendarExceptions.$inferSelect) {
  return {
    id: exception.id,
    calendarId: exception.calendarId,
    exceptionDate: toIsoDateString(exception.exceptionDate),
    isWorking: exception.isWorking,
    workingHours: exception.workingHours,
    description: exception.description,
    createdAt: exception.createdAt,
    updatedAt: exception.updatedAt,
  };
}

async function requireUniqueCalendarName(
  tx: PgTransaction<any, any, any>,
  projectId: number,
  name: string,
  excludeId?: number
) {
  const conditions = [eq(ganttCalendars.projectId, projectId), eq(ganttCalendars.name, name)];
  if (excludeId !== undefined) conditions.push(ne(ganttCalendars.id, excludeId));
  const existing = await tx.select({ id: ganttCalendars.id }).from(ganttCalendars).where(and(...conditions));
  if (existing.length) {
    throw new TRPCError({ code: "CONFLICT", message: "A calendar with this name already exists in the project" });
  }
}

async function loadActiveActivityCalendarIds(
  tx: PgTransaction<any, any, any>,
  projectId: number
): Promise<Array<number | null>> {
  const rows = await tx
    .select({ calendarId: ganttActivities.calendarId })
    .from(ganttActivities)
    .where(and(eq(ganttActivities.projectId, projectId), isNull(ganttActivities.archivedAt)));
  return rows.map((row) => row.calendarId);
}

/**
 * F-08: a baseline is a snapshot of one successfully calculated schedule
 * version. Returns whether the project has ever been scheduled and whether the
 * current schedule is out of date (reuses the audit-event staleness rule).
 */
async function projectScheduleFreshness(
  q: import("drizzle-orm/pg-core").PgDatabase<any, any, any>,
  projectId: number
): Promise<{ everScheduled: boolean; outOfDate: boolean }> {
  const scheduleEvents = await q
    .select({ projectRevision: ganttProjectEvents.projectRevision })
    .from(ganttProjectEvents)
    .where(
      and(
        eq(ganttProjectEvents.projectId, projectId),
        eq(ganttProjectEvents.entityType, "project"),
        eq(ganttProjectEvents.action, "schedule")
      )
    )
    .orderBy(sql`${ganttProjectEvents.projectRevision} DESC`)
    .limit(1);
  const lastScheduledRevision = scheduleEvents[0]?.projectRevision ?? null;
  if (lastScheduledRevision == null) return { everScheduled: false, outOfDate: false };
  const subsequentEvents = await q
    .select({
      entityType: ganttProjectEvents.entityType,
      action: ganttProjectEvents.action,
      beforeData: ganttProjectEvents.beforeData,
      afterData: ganttProjectEvents.afterData,
      projectRevision: ganttProjectEvents.projectRevision,
    })
    .from(ganttProjectEvents)
    .where(
      and(
        eq(ganttProjectEvents.projectId, projectId),
        sql`${ganttProjectEvents.projectRevision} > ${lastScheduledRevision}`
      )
    );
  return { everScheduled: true, outOfDate: isScheduleOutOfDate(lastScheduledRevision, subsequentEvents) };
}

async function calendarIsScheduleRelevant(
  tx: PgTransaction<any, any, any>,
  projectId: number,
  defaultCalendarId: number | null | undefined,
  calendarId: number
): Promise<boolean> {
  const ids = await loadActiveActivityCalendarIds(tx, projectId);
  return calendarAffectsActiveSchedule(defaultCalendarId, calendarId, ids);
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

async function resolveActivityCalendar(
  tx: PgTransaction<any, any, any>,
  projectId: number,
  calendarId: number | null | undefined,
  defaultCalendarId: number | null | undefined
): Promise<ScheduleCalendarInput> {
  const targetId = calendarId ?? defaultCalendarId;
  if (targetId != null) {
    const [calRow] = await tx
      .select()
      .from(ganttCalendars)
      .where(and(eq(ganttCalendars.id, targetId), eq(ganttCalendars.projectId, projectId)));
    if (calRow) {
      const exRows = await tx
        .select()
        .from(ganttCalendarExceptions)
        .where(eq(ganttCalendarExceptions.calendarId, calRow.id));
      return {
        id: calRow.id,
        name: calRow.name,
        workingDays: calRow.workingDays,
        hoursPerDay: calRow.hoursPerDay,
        timezone: calRow.timezone,
        exceptions: exRows.map((ex) => ({
          exceptionDate: String(ex.exceptionDate ?? "").trim().split("T")[0],
          isWorking: ex.isWorking,
        })),
      };
    }
  }
  return {
    id: 0,
    name: "Default Calendar",
    workingDays: [1, 2, 3, 4, 5],
    hoursPerDay: "8.00",
    timezone: "Asia/Manila",
  };
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

      const activities = input.includeArchived
        ? await db
            .select()
            .from(ganttActivities)
            .where(eq(ganttActivities.projectId, accessCtx.projectId))
            .orderBy(asc(ganttActivities.wbsNodeId), asc(ganttActivities.sortOrder), asc(ganttActivities.id))
        : await db
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

      const calendarIds = calendars.map((c) => c.id);
      const calendarExceptions = calendarIds.length
        ? await db
            .select()
            .from(ganttCalendarExceptions)
            .where(inArray(ganttCalendarExceptions.calendarId, calendarIds))
            .orderBy(asc(ganttCalendarExceptions.exceptionDate), asc(ganttCalendarExceptions.id))
        : [];
      const exceptionsByCalendar = new Map<number, typeof calendarExceptions>();
      for (const ex of calendarExceptions) {
        const list = exceptionsByCalendar.get(ex.calendarId) ?? [];
        list.push(ex);
        exceptionsByCalendar.set(ex.calendarId, list);
      }

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
        calendars: calendars.map((calendar) => mapCalendarRow(calendar, exceptionsByCalendar.get(calendar.id) ?? [])),
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
              freeFloatDays: s.freeFloatDays,              updatedAt: now,
              updatedByName: input.actorName ?? "Anonymous",
            })
            .where(
              and(
                eq(ganttActivities.id, s.id),
                eq(ganttActivities.projectId, accessCtx.projectId)
              )
            );
        }

        // F-04: critical count covers the CURRENT remaining-work critical path
        // only; completed activities (percentComplete === 100) are excluded
        // while retaining their (legitimately zero) float.
        const completedActivityIds = new Set(
          activitiesRow.filter((a) => a.percentComplete === 100).map((a) => a.id)
        );
        const criticalCount = scheduled.filter(
          (s) => s.totalFloatDays <= 0 && !completedActivityIds.has(s.id)
        ).length;

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
            criticalCount,
            dataDate: projectRow.dataDate ?? null,
          }
        );

        return {
          project: updatedProject,
          scheduledCount: scheduled.length,
          criticalCount,
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
          .select({
            revision: ganttProjects.revision,
            archivedAt: ganttProjects.archivedAt,
            dataDate: ganttProjects.dataDate,
            defaultCalendarId: ganttProjects.defaultCalendarId,
          })
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

        const cal = await resolveActivityCalendar(
          tx,
          accessCtx.projectId,
          input.activity.calendarId,
          projectRow.defaultCalendarId
        );

        const isMilestone = input.activity.activityType === "milestone";
        let plannedStart = input.activity.plannedStart ? toIsoDateString(input.activity.plannedStart) : null;
        let plannedFinish = input.activity.plannedFinish ? toIsoDateString(input.activity.plannedFinish) : null;
        let originalDurationDays = input.activity.originalDurationDays ?? 0;

        if (isMilestone) {
          originalDurationDays = 0;
          if (plannedStart && !plannedFinish) plannedFinish = plannedStart;
          else if (plannedFinish && !plannedStart) plannedStart = plannedFinish;
        } else {
          if (plannedStart && originalDurationDays > 0 && !plannedFinish) {
            const startDay = dateToCalendarDay(plannedStart);
            const finishDay = addWorkingDays(startDay, originalDurationDays, cal);
            plannedFinish = calendarDayToDate(finishDay);
          } else if (plannedStart && plannedFinish && input.activity.originalDurationDays === undefined) {
            const startDay = dateToCalendarDay(plannedStart);
            const finishDay = dateToCalendarDay(plannedFinish);
            if (finishDay >= startDay) {
              originalDurationDays = countWorkingDays(startDay, finishDay, cal);
            }
          }
        }

        // Canonical completion/progress resolution (F-10). The create flow
        // sanctions recording an explicit Actual Finish as completion; every
        // explicit contradiction is rejected by the shared progress model.
        const progressCurrent: ProgressFields = {
          percentComplete: 0,
          actualStart: null,
          actualFinish: null,
          status: null,
          remainingDurationDays: 0,
          originalDurationDays,
        };
        // Only explicitly provided fields are passed as changes so the
        // create-mode completion sanction can see "no explicit % supplied".
        const progressChanges: Partial<ProgressFields> = {};
        if (input.activity.percentComplete !== undefined) progressChanges.percentComplete = input.activity.percentComplete;
        if (input.activity.actualStart !== undefined) progressChanges.actualStart = toIsoDateString(input.activity.actualStart);
        if (input.activity.actualFinish !== undefined) progressChanges.actualFinish = toIsoDateString(input.activity.actualFinish);
        if (input.activity.status !== undefined) progressChanges.status = input.activity.status;
        if (input.activity.remainingDurationDays !== undefined) progressChanges.remainingDurationDays = input.activity.remainingDurationDays;
        const progressResult = resolveProgress({
          current: progressCurrent,
          changes: progressChanges,
          dataDate: projectRow.dataDate,
          mode: "create",
        });
        if (!progressResult.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: progressResult.error });
        }
        const resolved = {
          percentComplete: progressResult.values?.percentComplete ?? progressChanges.percentComplete ?? 0,
          actualStart: progressResult.values?.actualStart !== undefined
            ? progressResult.values.actualStart
            : (progressChanges.actualStart ?? null),
          actualFinish: progressResult.values?.actualFinish !== undefined
            ? progressResult.values.actualFinish
            : (progressChanges.actualFinish ?? null),
          status: progressResult.values?.status !== undefined ? progressResult.values.status : null,
          remainingDurationDays: progressResult.values?.remainingDurationDays !== undefined
            ? progressResult.values.remainingDurationDays
            : (progressChanges.remainingDurationDays ?? 0),
        };

        if (plannedStart && plannedFinish && plannedStart > plannedFinish) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Planned start must be on or before planned finish" });
        }
        if (resolved.actualStart && resolved.actualFinish && resolved.actualStart > resolved.actualFinish) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Actual start must be on or before actual finish" });
        }

        // F-03: active non-null Activity IDs are unique per project. Pre-check
        // for a friendly CONFLICT; the partial unique index remains the final
        // concurrency-safe authority (violation mapped to the same CONFLICT).
        const canonicalActivityId = canonicalizeActivityId(input.activity.activityId);
        if (canonicalActivityId != null) {
          const [duplicate] = await tx
            .select({ id: ganttActivities.id })
            .from(ganttActivities)
            .where(
              and(
                eq(ganttActivities.projectId, accessCtx.projectId),
                eq(ganttActivities.activityId, canonicalActivityId),
                isNull(ganttActivities.archivedAt)
              )
            );
          if (duplicate) {
            throw new TRPCError({ code: "CONFLICT", message: "An active activity with the same Activity ID already exists" });
          }
        }

        const [orderRow] = await tx
          .select({ next: sql<number>`COALESCE(MAX(${ganttActivities.sortOrder}), -1)::int + 1` })
          .from(ganttActivities)
          .where(and(
            eq(ganttActivities.projectId, accessCtx.projectId),
            eq(ganttActivities.wbsNodeId, wbsNodeId),
            isNull(ganttActivities.archivedAt)
          ));

        let createdActivity;
        try {
          [createdActivity] = await tx
            .insert(ganttActivities)
            .values({
              projectId: accessCtx.projectId,
              wbsNodeId,
              activityName: input.activity.activityName,
              activityId: (canonicalActivityId ?? null) as any,
              activityType: (input.activity.activityType ?? "task") as any,
              sortOrder: orderRow?.next ?? 0,
              calendarId: input.activity.calendarId ?? null,
              originalDurationDays: originalDurationDays as any,
              remainingDurationDays: resolved.remainingDurationDays as any,
              plannedStart: (plannedStart ?? null) as any,
              plannedFinish: (plannedFinish ?? null) as any,
              actualStart: (resolved.actualStart ?? null) as any,
              actualFinish: (resolved.actualFinish ?? null) as any,
              percentComplete: resolved.percentComplete as any,
              status: (resolved.status ?? null) as any,
              constraintType: null,
              constraintDate: null,
              notes: (input.activity.notes ?? null) as any,
              updatedByName: input.actorName ?? "Anonymous",
            } as any)
            .returning();
        } catch (err: any) {
          if (err?.code === "23505" || err?.cause?.code === "23505") {
            throw new TRPCError({ code: "CONFLICT", message: "An active activity with the same Activity ID already exists" });
          }
          throw err;
        }
        const activity = createdActivity;

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
          .select({
            revision: ganttProjects.revision,
            archivedAt: ganttProjects.archivedAt,
            dataDate: ganttProjects.dataDate,
            defaultCalendarId: ganttProjects.defaultCalendarId,
          })
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

        // No-op guard: identical edits must not bump the project revision or create audit events.
        if (isActivityChangeNoop(activity, changes)) {
          return { activity, revision: projectRow.revision };
        }

        if (changes.wbsNodeId !== undefined) {
          await requireActiveLeafWbs(tx, accessCtx.projectId, changes.wbsNodeId);
        }
        if (changes.calendarId !== undefined && changes.calendarId !== null) {
          await requireProjectCalendar(tx, accessCtx.projectId, changes.calendarId);
        }

        const cal = await resolveActivityCalendar(
          tx,
          accessCtx.projectId,
          changes.calendarId !== undefined ? changes.calendarId : activity.calendarId,
          projectRow.defaultCalendarId
        );

        const setData: Record<string, unknown> = {
          updatedAt: new Date(),
          updatedByName: input.actorName ?? "Anonymous",
        };

        if (changes.wbsNodeId !== undefined) {
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
        if (changes.calendarId !== undefined) setData.calendarId = changes.calendarId;
        if (changes.activityName !== undefined) setData.activityName = changes.activityName;
        if (changes.activityId !== undefined) setData.activityId = changes.activityId;
        if (changes.activityType !== undefined) setData.activityType = changes.activityType;
        if (changes.status !== undefined) setData.status = changes.status;
        if (changes.constraintType !== undefined) setData.constraintType = changes.constraintType;
        if (changes.constraintDate !== undefined) setData.constraintDate = changes.constraintDate;
        if (changes.notes !== undefined) setData.notes = changes.notes;
        if (changes.remainingDurationDays !== undefined) setData.remainingDurationDays = changes.remainingDurationDays;

        // Synchronize Planned Dates and Duration
        const effType = changes.activityType !== undefined ? changes.activityType : activity.activityType;
        const isMilestone = effType === "milestone";

        if (isMilestone) {
          setData.originalDurationDays = 0;
          if (changes.plannedStart !== undefined && changes.plannedFinish !== undefined) {
            setData.plannedStart = toIsoDateString(changes.plannedStart);
            setData.plannedFinish = toIsoDateString(changes.plannedFinish);
          } else if (changes.plannedStart !== undefined) {
            const s = toIsoDateString(changes.plannedStart);
            setData.plannedStart = s;
            setData.plannedFinish = s;
          } else if (changes.plannedFinish !== undefined) {
            const f = toIsoDateString(changes.plannedFinish);
            setData.plannedStart = f;
            setData.plannedFinish = f;
          }
        } else {
          const hasStart = changes.plannedStart !== undefined;
          const hasFinish = changes.plannedFinish !== undefined;
          const hasDuration = changes.originalDurationDays !== undefined;

          if (hasStart && hasFinish) {
            const s = toIsoDateString(changes.plannedStart);
            const f = toIsoDateString(changes.plannedFinish);
            setData.plannedStart = s;
            setData.plannedFinish = f;
            if (hasDuration && changes.originalDurationDays !== null) {
              setData.originalDurationDays = changes.originalDurationDays;
            } else if (s && f && s <= f) {
              const startDay = dateToCalendarDay(s);
              const finishDay = dateToCalendarDay(f);
              setData.originalDurationDays = countWorkingDays(startDay, finishDay, cal);
            }
          } else if (hasDuration && !hasStart && !hasFinish) {
            const newDur = changes.originalDurationDays ?? 0;
            setData.originalDurationDays = newDur;
            const currentStart = toIsoDateString(activity.plannedStart);
            if (currentStart) {
              if (newDur === 0) {
                setData.plannedFinish = currentStart;
              } else {
                const startDay = dateToCalendarDay(currentStart);
                const finishDay = addWorkingDays(startDay, newDur, cal);
                setData.plannedFinish = calendarDayToDate(finishDay);
              }
            }
          } else if (hasFinish && !hasStart && !hasDuration) {
            const f = toIsoDateString(changes.plannedFinish);
            setData.plannedFinish = f;
            const currentStart = toIsoDateString(activity.plannedStart);
            if (currentStart && f && f >= currentStart) {
              const startDay = dateToCalendarDay(currentStart);
              const finishDay = dateToCalendarDay(f);
              setData.originalDurationDays = countWorkingDays(startDay, finishDay, cal);
            }
          } else if (hasStart && !hasFinish && !hasDuration) {
            const s = toIsoDateString(changes.plannedStart);
            setData.plannedStart = s;
            const curDur = activity.originalDurationDays;
            if (s && curDur != null && curDur > 0) {
              const startDay = dateToCalendarDay(s);
              const finishDay = addWorkingDays(startDay, curDur, cal);
              setData.plannedFinish = calendarDayToDate(finishDay);
            }
          } else if (hasStart && hasDuration && !hasFinish) {
            const s = toIsoDateString(changes.plannedStart);
            const newDur = changes.originalDurationDays ?? 0;
            setData.plannedStart = s;
            setData.originalDurationDays = newDur;
            if (s) {
              if (newDur === 0) {
                setData.plannedFinish = s;
              } else {
                const startDay = dateToCalendarDay(s);
                const finishDay = addWorkingDays(startDay, newDur, cal);
                setData.plannedFinish = calendarDayToDate(finishDay);
              }
            }
          } else if (hasFinish && hasDuration && !hasStart) {
            setData.plannedFinish = toIsoDateString(changes.plannedFinish);
            setData.originalDurationDays = changes.originalDurationDays ?? 0;
          } else {
            if (hasStart) setData.plannedStart = toIsoDateString(changes.plannedStart);
            if (hasFinish) setData.plannedFinish = toIsoDateString(changes.plannedFinish);
            if (hasDuration) setData.originalDurationDays = changes.originalDurationDays;
          }
        }

        // Validate date ranges after date/duration synchronization
        const effPlannedStart = setData.plannedStart !== undefined ? toIsoDateString(setData.plannedStart) : toIsoDateString(activity.plannedStart);
        const effPlannedFinish = setData.plannedFinish !== undefined ? toIsoDateString(setData.plannedFinish) : toIsoDateString(activity.plannedFinish);
        if (effPlannedStart && effPlannedFinish && effPlannedStart > effPlannedFinish) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Planned start must be on or before planned finish" });
        }

        // Actual Start / Actual Finish / % Complete / status / remaining
        // synchronization — canonical shared progress model (F-10). Explicit
        // contradictions are rejected; only T1/T2 deliberate transitions and
        // derived status/remaining values are applied.
        const effOriginalDuration =
          setData.originalDurationDays !== undefined
            ? (setData.originalDurationDays as number)
            : activity.originalDurationDays ?? 0;
        const progressCurrent: ProgressFields = {
          percentComplete: activity.percentComplete ?? 0,
          actualStart: toIsoDateString(activity.actualStart),
          actualFinish: toIsoDateString(activity.actualFinish),
          status: activity.status,
          remainingDurationDays: activity.remainingDurationDays,
          originalDurationDays: effOriginalDuration,
        };
        const progressChanges: Partial<ProgressFields> = {};
        if (changes.actualStart !== undefined) progressChanges.actualStart = toIsoDateString(changes.actualStart);
        if (changes.actualFinish !== undefined) progressChanges.actualFinish = toIsoDateString(changes.actualFinish);
        if (changes.percentComplete !== undefined) progressChanges.percentComplete = changes.percentComplete;
        if (changes.status !== undefined) progressChanges.status = changes.status;
        if (changes.remainingDurationDays !== undefined) progressChanges.remainingDurationDays = changes.remainingDurationDays;

        const progressResult = resolveProgress({
          current: progressCurrent,
          changes: progressChanges,
          dataDate: projectRow.dataDate,
          mode: "update",
        });
        if (!progressResult.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: progressResult.error });
        }
        if (!progressResult.noop && progressResult.values) {
          if (progressResult.values.percentComplete !== undefined) setData.percentComplete = progressResult.values.percentComplete;
          if (progressResult.values.actualStart !== undefined) setData.actualStart = progressResult.values.actualStart;
          if (progressResult.values.actualFinish !== undefined) setData.actualFinish = progressResult.values.actualFinish;
          if (progressResult.values.status !== undefined) setData.status = progressResult.values.status;
          if (progressResult.values.remainingDurationDays !== undefined) {
            setData.remainingDurationDays = progressResult.values.remainingDurationDays;
          }
        }

        // F-03: update collision check (excluding self) + unique-index backstop.
        if (changes.activityId !== undefined) {
          const canonicalActivityId = canonicalizeActivityId(changes.activityId);
          setData.activityId = canonicalActivityId;
          if (canonicalActivityId != null) {
            const [duplicate] = await tx
              .select({ id: ganttActivities.id })
              .from(ganttActivities)
              .where(
                and(
                  eq(ganttActivities.projectId, accessCtx.projectId),
                  eq(ganttActivities.activityId, canonicalActivityId),
                  isNull(ganttActivities.archivedAt),
                  ne(ganttActivities.id, activity.id)
                )
              );
            if (duplicate) {
              throw new TRPCError({ code: "CONFLICT", message: "An active activity with the same Activity ID already exists" });
            }
          }
        }

        setData.revision = sql`${ganttActivities.revision} + 1`;

        let updated;
        try {
          [updated] = await tx
            .update(ganttActivities)
            .set(setData)
            .where(eq(ganttActivities.id, activity.id))
            .returning();
        } catch (err: any) {
          if (err?.code === "23505" || err?.cause?.code === "23505") {
            throw new TRPCError({ code: "CONFLICT", message: "An active activity with the same Activity ID already exists" });
          }
          throw err;
        }

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

  restoreActivity: publicQuery
    .input(restoreActivityInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-restore-activity:${input.slug}`, 30, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);

        const projectRow = await validateProjectNotArchived(tx, accessCtx.projectId);
        if (projectRow.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }

        const [activity] = await tx
          .select()
          .from(ganttActivities)
          .where(
            and(
              eq(ganttActivities.id, input.activityId),
              eq(ganttActivities.projectId, accessCtx.projectId)
            )
          );
        if (!activity) throw new TRPCError({ code: "NOT_FOUND", message: "Activity not found" });
        if (!activity.archivedAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Activity is not archived" });
        }

        // Original WBS node must exist and be active.
        const [wbsNode] = await tx
          .select()
          .from(ganttWbsNodes)
          .where(
            and(
              eq(ganttWbsNodes.id, activity.wbsNodeId),
              eq(ganttWbsNodes.projectId, accessCtx.projectId)
            )
          );
        if (!wbsNode) throw new TRPCError({ code: "NOT_FOUND", message: "WBS node not found" });
        if (wbsNode.archivedAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot restore activity while its WBS node is archived" });
        }

        // Reject if restoring would create a duplicate user-visible activityId
        // within the project (F-03 canonical comparison; the partial unique
        // index is the backstop).
        const canonicalRestoredId = canonicalizeActivityId(activity.activityId);
        if (canonicalRestoredId != null) {
          const [duplicate] = await tx
            .select({ id: ganttActivities.id })
            .from(ganttActivities)
            .where(
              and(
                eq(ganttActivities.projectId, accessCtx.projectId),
                eq(ganttActivities.activityId, canonicalRestoredId),
                isNull(ganttActivities.archivedAt)
              )
            );
          if (duplicate) {
            throw new TRPCError({ code: "CONFLICT", message: "Active activity with the same Activity ID already exists" });
          }
        }

        const before = mapActivityRow(activity);
        const now = new Date();

        const [updated] = await tx
          .update(ganttActivities)
          .set({ archivedAt: null, updatedAt: now, revision: sql`${ganttActivities.revision} + 1`, updatedByName: input.actorName ?? "Anonymous" })
          .where(eq(ganttActivities.id, activity.id))
          .returning();

        await normalizeActivityOrder(tx, accessCtx.projectId, activity.wbsNodeId);

        const archivedDependencies = await tx
          .select({ id: ganttActivityDependencies.id })
          .from(ganttActivityDependencies)
          .where(
            and(
              eq(ganttActivityDependencies.projectId, accessCtx.projectId),
              isNotNull(ganttActivityDependencies.archivedAt),
              or(
                eq(ganttActivityDependencies.predecessorActivityId, activity.id),
                eq(ganttActivityDependencies.successorActivityId, activity.id)
              )
            )
          );

        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "activity", "restore", updated.id, before, mapActivityRow(updated));

        return { updated, hasArchivedDependencies: archivedDependencies.length > 0 };
      });

      return { activity: mapActivityRow(result.updated), revision: accessCtx.projectRevision, hasArchivedDependencies: result.hasArchivedDependencies };
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
      // Default behavior is unchanged: active dependencies only. includeArchived
      // additionally returns archived rows for the same project so the UI can
      // offer explicit dependency restore (mirrors load's archived activities,
      // which are visible to every token role). Run Schedule does not use this
      // read path; the engine never consumes archived dependencies.
      const dependencies = await db.select().from(ganttActivityDependencies).where(
        input.includeArchived
          ? eq(ganttActivityDependencies.projectId, accessCtx.projectId)
          : and(
              eq(ganttActivityDependencies.projectId, accessCtx.projectId), isNull(ganttActivityDependencies.archivedAt)
            )
      ).orderBy(asc(ganttActivityDependencies.id));
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

  createCalendar: publicQuery
    .input(createCalendarInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-create-calendar:${input.slug}`, 30, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);
        const project = await validateProjectNotArchived(tx, accessCtx.projectId);
        if (project.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }

        const name = input.calendar.name.trim();
        if (!name) throw new TRPCError({ code: "BAD_REQUEST", message: "Calendar name is required" });
        const workingDays = parseWorkingDays(input.calendar.workingDays);
        await requireUniqueCalendarName(tx, accessCtx.projectId, name);

        const [calendar] = await tx.insert(ganttCalendars).values({
          projectId: accessCtx.projectId,
          name,
          workingDays,
        }).returning();

        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "calendar", "create", calendar.id, null, {
          ...mapCalendarRow(calendar),
          affectsActiveSchedule: false,
        });
        return calendar;
      });

      return { calendar: mapCalendarRow(result), revision: accessCtx.projectRevision };
    }),

  updateCalendar: publicQuery
    .input(updateCalendarInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-update-calendar:${input.slug}`, 30, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);
        const [project] = await tx.select().from(ganttProjects).where(eq(ganttProjects.id, accessCtx.projectId));
        if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        if (project.archivedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Project is archived" });
        if (project.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }

        const calendar = await requireProjectCalendar(tx, accessCtx.projectId, input.calendarId);
        const nextName = input.changes.name !== undefined ? input.changes.name.trim() : calendar.name;
        if (!nextName) throw new TRPCError({ code: "BAD_REQUEST", message: "Calendar name is required" });
        const nextWorkingDays = input.changes.workingDays !== undefined
          ? parseWorkingDays(input.changes.workingDays)
          : calendar.workingDays;

        const nameUnchanged = nextName === calendar.name;
        const daysUnchanged = workingDaysEqual(nextWorkingDays, calendar.workingDays);
        if (nameUnchanged && daysUnchanged) {
          return { calendar, revision: project.revision, noop: true };
        }

        if (!nameUnchanged) {
          await requireUniqueCalendarName(tx, accessCtx.projectId, nextName, calendar.id);
        }

        const [updated] = await tx.update(ganttCalendars).set({
          name: nextName,
          workingDays: nextWorkingDays,
          updatedAt: new Date(),
        }).where(eq(ganttCalendars.id, calendar.id)).returning();

        const relevant = await calendarIsScheduleRelevant(tx, accessCtx.projectId, project.defaultCalendarId, calendar.id);
        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "calendar", "update", updated.id, mapCalendarRow(calendar), {
          ...mapCalendarRow(updated),
          affectsActiveSchedule: relevant,
        });
        return { calendar: updated, revision: newRevision, noop: false };
      });

      return { calendar: mapCalendarRow(result.calendar), revision: result.revision, noop: result.noop };
    }),

  setProjectDefaultCalendar: publicQuery
    .input(setProjectDefaultCalendarInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-set-default-calendar:${input.slug}`, 20, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireAdmin(accessCtx);

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);
        const [current] = await tx.select().from(ganttProjects).where(eq(ganttProjects.id, accessCtx.projectId));
        if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        if (current.archivedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Project is archived" });
        if (current.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }

        await requireProjectCalendar(tx, accessCtx.projectId, input.calendarId);
        if (current.defaultCalendarId === input.calendarId) {
          return { project: current, revision: current.revision, noop: true };
        }

        const before = mapProjectRow(current);
        const [updated] = await tx.update(ganttProjects).set({
          defaultCalendarId: input.calendarId,
          updatedAt: new Date(),
        }).where(eq(ganttProjects.id, accessCtx.projectId)).returning();

        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "project", "update", accessCtx.projectId, before, mapProjectRow(updated));
        return { project: updated, revision: newRevision, noop: false };
      });

      return { project: mapProjectRow(result.project), revision: result.revision, noop: result.noop };
    }),

  createCalendarException: publicQuery
    .input(createCalendarExceptionInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-create-cal-ex:${input.slug}`, 30, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);
        const [project] = await tx.select().from(ganttProjects).where(eq(ganttProjects.id, accessCtx.projectId));
        if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        if (project.archivedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Project is archived" });
        if (project.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }

        const calendar = await requireProjectCalendar(tx, accessCtx.projectId, input.calendarId);
        const exceptionDate = toIsoDateString(input.exception.exceptionDate);
        if (!exceptionDate) throw new TRPCError({ code: "BAD_REQUEST", message: "exceptionDate is required" });

        const [dup] = await tx.select({ id: ganttCalendarExceptions.id }).from(ganttCalendarExceptions).where(and(
          eq(ganttCalendarExceptions.calendarId, calendar.id),
          eq(ganttCalendarExceptions.exceptionDate, exceptionDate)
        ));
        if (dup) throw new TRPCError({ code: "CONFLICT", message: "An exception already exists for this date" });

        const [created] = await tx.insert(ganttCalendarExceptions).values({
          calendarId: calendar.id,
          exceptionDate,
          isWorking: input.exception.isWorking,
          description: input.exception.description ?? null,
          workingHours: null,
        }).returning();

        const relevant = await calendarIsScheduleRelevant(tx, accessCtx.projectId, project.defaultCalendarId, calendar.id);
        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "calendarException", "create", created.id, null, {
          ...mapCalendarExceptionRow(created),
          affectsActiveSchedule: relevant,
        });
        return created;
      });

      return { exception: mapCalendarExceptionRow(result), revision: accessCtx.projectRevision };
    }),

  updateCalendarException: publicQuery
    .input(updateCalendarExceptionInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-update-cal-ex:${input.slug}`, 30, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);
        const [project] = await tx.select().from(ganttProjects).where(eq(ganttProjects.id, accessCtx.projectId));
        if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        if (project.archivedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Project is archived" });
        if (project.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }

        const [current] = await tx.select().from(ganttCalendarExceptions).where(eq(ganttCalendarExceptions.id, input.exceptionId));
        if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Calendar exception not found" });
        const calendar = await requireProjectCalendar(tx, accessCtx.projectId, current.calendarId);

        const nextDate = input.changes.exceptionDate !== undefined
          ? toIsoDateString(input.changes.exceptionDate)
          : toIsoDateString(current.exceptionDate);
        if (!nextDate) throw new TRPCError({ code: "BAD_REQUEST", message: "exceptionDate is required" });
        const nextWorking = input.changes.isWorking !== undefined ? input.changes.isWorking : current.isWorking;
        const nextDescription = input.changes.description !== undefined ? input.changes.description : current.description;

        const dateUnchanged = nextDate === toIsoDateString(current.exceptionDate);
        const workingUnchanged = nextWorking === current.isWorking;
        const descUnchanged = (nextDescription ?? null) === (current.description ?? null);
        if (dateUnchanged && workingUnchanged && descUnchanged) {
          return { exception: current, revision: project.revision, noop: true };
        }

        if (!dateUnchanged) {
          const [dup] = await tx.select({ id: ganttCalendarExceptions.id }).from(ganttCalendarExceptions).where(and(
            eq(ganttCalendarExceptions.calendarId, calendar.id),
            eq(ganttCalendarExceptions.exceptionDate, nextDate),
            ne(ganttCalendarExceptions.id, current.id)
          ));
          if (dup) throw new TRPCError({ code: "CONFLICT", message: "An exception already exists for this date" });
        }

        const [updated] = await tx.update(ganttCalendarExceptions).set({
          exceptionDate: nextDate,
          isWorking: nextWorking,
          description: nextDescription ?? null,
          updatedAt: new Date(),
        }).where(eq(ganttCalendarExceptions.id, current.id)).returning();

        const relevant = await calendarIsScheduleRelevant(tx, accessCtx.projectId, project.defaultCalendarId, calendar.id);
        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "calendarException", "update", updated.id, mapCalendarExceptionRow(current), {
          ...mapCalendarExceptionRow(updated),
          affectsActiveSchedule: relevant,
        });
        return { exception: updated, revision: newRevision, noop: false };
      });

      return { exception: mapCalendarExceptionRow(result.exception), revision: result.revision, noop: result.noop };
    }),

  deleteCalendarException: publicQuery
    .input(deleteCalendarExceptionInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-delete-cal-ex:${input.slug}`, 30, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireEditorOrAdmin(accessCtx);

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);
        const [project] = await tx.select().from(ganttProjects).where(eq(ganttProjects.id, accessCtx.projectId));
        if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        if (project.archivedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Project is archived" });
        if (project.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }

        const [current] = await tx.select().from(ganttCalendarExceptions).where(eq(ganttCalendarExceptions.id, input.exceptionId));
        if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Calendar exception not found" });
        const calendar = await requireProjectCalendar(tx, accessCtx.projectId, current.calendarId);

        await tx.delete(ganttCalendarExceptions).where(eq(ganttCalendarExceptions.id, current.id));

        const relevant = await calendarIsScheduleRelevant(tx, accessCtx.projectId, project.defaultCalendarId, calendar.id);
        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;
        await insertEvent(tx, accessCtx, "calendarException", "delete", current.id, {
          ...mapCalendarExceptionRow(current),
          affectsActiveSchedule: relevant,
        }, null);
        return current;
      });

      return { exception: mapCalendarExceptionRow(result), revision: accessCtx.projectRevision };
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

        // A node with existing activities may still gain children: activities
        // stay attached to the parent (activity.wbsNodeId is unchanged), the
        // parent's isLeaf flips to false (child-based), and the scheduling
        // engine schedules every activity independently, so a parent activity
        // alongside child activities is fully supported. New activity
        // assignment remains leaf-only via requireActiveLeafWbs.

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

  captureBaseline: publicQuery
    .input(captureBaselineInputSchema)
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(ctx.req, `primavera-capture-baseline:${input.slug}`, 30, 60_000);
      const accessCtx = await resolveProjectAccess(input.slug, input.access);
      requireAdmin(accessCtx);

      const result = await db.transaction(async (tx) => {
        await lockProject(tx, accessCtx.projectId);

        const [projectRow] = await tx
          .select()
          .from(ganttProjects)
          .where(eq(ganttProjects.id, accessCtx.projectId));
        if (!projectRow) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        if (projectRow.archivedAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Project is archived" });
        }
        if (projectRow.revision !== input.expectedRevision) {
          throw new TRPCError({ code: "CONFLICT", message: "Project was updated by another user" });
        }

        // F-08: no baseline without a fresh successful schedule.
        const freshness = await projectScheduleFreshness(tx, accessCtx.projectId);
        if (!freshness.everScheduled) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Run the schedule before capturing a baseline.",
          });
        }
        if (freshness.outOfDate) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Schedule is out of date; run the schedule before capturing a baseline.",
          });
        }

        const activities = await tx
          .select()
          .from(ganttActivities)
          .where(and(eq(ganttActivities.projectId, accessCtx.projectId), isNull(ganttActivities.archivedAt)))
          .orderBy(asc(ganttActivities.wbsNodeId), asc(ganttActivities.sortOrder), asc(ganttActivities.id));

        const wbsNodeIds = Array.from(new Set(activities.map((a) => a.wbsNodeId)));
        const wbsNodes =
          wbsNodeIds.length > 0
            ? await tx.select().from(ganttWbsNodes).where(inArray(ganttWbsNodes.id, wbsNodeIds))
            : [];

        const calendarIds = Array.from(new Set(activities.map((a) => a.calendarId).filter(Boolean))) as number[];
        const calendars =
          calendarIds.length > 0
            ? await tx.select().from(ganttCalendars).where(inArray(ganttCalendars.id, calendarIds))
            : [];

        const wbsById = new Map(wbsNodes.map((n) => [n.id, n]));
        const calById = new Map(calendars.map((c) => [c.id, c]));

        const activityCount = activities.length;

        const newRevision = await bumpProjectRevision(tx, accessCtx.projectId);
        accessCtx.projectRevision = newRevision;
        accessCtx.actorName = input.actorName;

        const [baseline] = await tx
          .insert(ganttBaselines)
          .values({
            projectId: accessCtx.projectId,
            publicId: randomUUID(),
            name: input.name,
            description: input.description ?? null,
            activityCount,
            projectRevision: newRevision,
            capturedByName: input.actorName ?? "Anonymous",
          })
          .returning();

        if (activities.length > 0) {
          const snapshotValues = activities.map((a) => {
            const wbs = wbsById.get(a.wbsNodeId);
            const cal = a.calendarId ? calById.get(a.calendarId) : undefined;
            return {
              baselineId: baseline.id,
              activityId: a.id,
              activityCode: a.activityId ?? null,
              activityName: a.activityName,
              wbsNodeId: a.wbsNodeId,
              wbsCode: wbs?.code ?? null,
              wbsName: wbs?.name ?? null,
              calendarId: a.calendarId ?? null,
              calendarName: cal?.name ?? null,
              originalDurationDays: a.originalDurationDays,
              scheduledStart: a.earlyStart ?? null,
              scheduledFinish: a.earlyFinish ?? null,
              sortOrder: a.sortOrder,
            };
          });
          await tx.insert(ganttBaselineActivities).values(snapshotValues);
        }

        await insertEvent(
          tx,
          accessCtx,
          "baseline",
          "capture",
          baseline.id,
          null,
          { baselineId: baseline.id, name: baseline.name, activityCount, projectRevision: newRevision }
        );

        return { baseline, activityCount };
      });

      return {
        baseline: mapBaselineRow(result.baseline),
        activityCount: result.activityCount,
        revision: accessCtx.projectRevision,
      };
    }),

  listBaselines: publicQuery
    .input(listBaselinesInputSchema)
    .query(async ({ input }) => {
      const accessCtx = await resolveProjectAccess(input.slug, input.access);

      const baselines = await db
        .select()
        .from(ganttBaselines)
        .where(eq(ganttBaselines.projectId, accessCtx.projectId))
        .orderBy(asc(ganttBaselines.createdAt));

      return { baselines: baselines.map(mapBaselineRow) };
    }),

  compareBaseline: publicQuery
    .input(compareBaselineInputSchema)
    .query(async ({ input }) => {
      const accessCtx = await resolveProjectAccess(input.slug, input.access);

      const [baseline] = await db
        .select()
        .from(ganttBaselines)
        .where(and(eq(ganttBaselines.id, input.baselineId), eq(ganttBaselines.projectId, accessCtx.projectId)));
      if (!baseline) throw new TRPCError({ code: "NOT_FOUND", message: "Baseline not found" });

      // F-08: never present variances computed against a stale (or never
      // scheduled) current schedule.
      const freshness = await projectScheduleFreshness(db, accessCtx.projectId);
      if (!freshness.everScheduled) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Run the schedule before comparing baseline variances.",
        });
      }
      if (freshness.outOfDate) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Schedule is out of date; run the schedule before comparing baseline variances.",
        });
      }

      const snapshots = await db
        .select()
        .from(ganttBaselineActivities)
        .where(eq(ganttBaselineActivities.baselineId, baseline.id))
        .orderBy(asc(ganttBaselineActivities.sortOrder), asc(ganttBaselineActivities.id));

      const activityIds = snapshots.map((s) => s.activityId);
      const currentActivities =
        activityIds.length > 0
          ? await db.select().from(ganttActivities).where(inArray(ganttActivities.id, activityIds))
          : [];

      const currentById = new Map(currentActivities.map((a) => [a.id, a]));

      const comparisons = snapshots.map((snapshot) => {
        const current = currentById.get(snapshot.activityId);
        const currentStart = current ? toIsoDateString(current.earlyStart) : null;
        const currentFinish = current ? toIsoDateString(current.earlyFinish) : null;
        const baselineStart = toIsoDateString(snapshot.scheduledStart);
        const baselineFinish = toIsoDateString(snapshot.scheduledFinish);

        return {
          snapshotId: snapshot.id,
          activityId: snapshot.activityId,
          activityCode: snapshot.activityCode,
          activityName: snapshot.activityName,
          wbsNodeId: snapshot.wbsNodeId,
          wbsCode: snapshot.wbsCode,
          wbsName: snapshot.wbsName,
          calendarId: snapshot.calendarId,
          calendarName: snapshot.calendarName,
          originalDurationDays: snapshot.originalDurationDays,
          baselineScheduledStart: baselineStart,
          baselineScheduledFinish: baselineFinish,
          currentScheduledStart: currentStart,
          currentScheduledFinish: currentFinish,
          startVariance: calendarDayVariance(currentStart, baselineStart),
          finishVariance: calendarDayVariance(currentFinish, baselineFinish),
          currentArchivedAt: current?.archivedAt ?? null,
          currentMissing: current === undefined,
        };
      });

      return {
        baseline: mapBaselineRow(baseline),
        comparisons,
      };
    }),
});
