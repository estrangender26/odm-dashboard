import { z } from "zod";

export const ganttProjectIdSchema = z.number().int().positive();
export const ganttTaskIdSchema = z.number().int().positive();
export const ganttIsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

export const ganttTaskTypeSchema = z.enum(["task", "milestone", "summary", "project"]);
export const ganttDependencyTypeSchema = z.enum(["FS", "SS", "FF", "SF"]);
export const ganttLagUnitSchema = z.enum(["day"]);

export const ganttProjectInputSchema = z.object({
  id: ganttProjectIdSchema.optional(),
  name: z.string().trim().min(1).max(255),
  description: z.string().max(10_000).nullable().optional(),
  status: z.string().trim().max(50).nullable().optional(),
  statusDate: ganttIsoDateSchema.optional(),
  calendarId: z.number().int().positive().nullable().optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
});

export const ganttTaskInputSchema = z.object({
  id: ganttTaskIdSchema.optional(),
  frontendTaskUid: z.string().uuid().optional(),
  parentId: z.number().int().nonnegative().nullable().optional(),
  name: z.string().trim().min(1).max(500),
  taskType: ganttTaskTypeSchema.default("task"),
  category: z.string().trim().max(100).nullable().optional(),
  sortOrder: z.number().int().nonnegative(),
  plannedStart: ganttIsoDateSchema.optional(),
  plannedEnd: ganttIsoDateSchema.optional(),
  actualStart: ganttIsoDateSchema.optional(),
  actualEnd: ganttIsoDateSchema.optional(),
  duration: z.number().int().nonnegative(),
  actualDuration: z.number().int().nonnegative().nullable().optional(),
  progress: z.number().int().min(0).max(100),
  status: z.string().trim().max(50).nullable().optional(),
  owner: z.string().trim().max(255).nullable().optional(),
  notes: z.string().max(50_000).nullable().optional(),
});

export const ganttTaskPatchSchema = ganttTaskInputSchema.partial().extend({
  id: ganttTaskIdSchema,
});

export const ganttDependencyInputSchema = z.object({
  id: z.number().int().positive().optional(),
  predecessorTaskId: ganttTaskIdSchema,
  successorTaskId: ganttTaskIdSchema,
  relationshipType: ganttDependencyTypeSchema.default("FS"),
  lag: z.number().int().default(0),
  lagUnit: ganttLagUnitSchema.default("day"),
});

export const ganttAssignmentInputSchema = z.object({
  id: z.number().int().positive().optional(),
  taskId: ganttTaskIdSchema,
  resourceId: z.string().trim().min(1).max(255),
  units: z.number().min(0).max(10).default(1),
  role: z.string().trim().max(100).nullable().optional(),
});

export const ganttWorkingRangeSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

export const ganttCalendarInputSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(255),
  timezone: z.string().trim().min(1).max(100),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1),
  workingRanges: z.array(ganttWorkingRangeSchema).min(1),
  exceptions: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    name: z.string().trim().max(255).nullable().optional(),
    workingRanges: z.array(ganttWorkingRangeSchema).default([]),
  })).default([]),
});

export const ganttTaskCommandSchema = z.object({
  projectId: ganttProjectIdSchema,
  task: z.union([ganttTaskInputSchema, ganttTaskPatchSchema]),
  incomingDependencies: z.array(ganttDependencyInputSchema.omit({ successorTaskId: true })).optional(),
});

export const ganttProjectPlanSchema = z.object({
  project: ganttProjectInputSchema,
  tasks: z.array(ganttTaskInputSchema),
  dependencies: z.array(ganttDependencyInputSchema),
  assignments: z.array(ganttAssignmentInputSchema).default([]),
});

export type GanttProjectInput = z.infer<typeof ganttProjectInputSchema>;
export type GanttTaskInput = z.infer<typeof ganttTaskInputSchema>;
export type GanttTaskPatch = z.infer<typeof ganttTaskPatchSchema>;
export type GanttDependencyInput = z.infer<typeof ganttDependencyInputSchema>;
export type GanttAssignmentInput = z.infer<typeof ganttAssignmentInputSchema>;
export type GanttCalendarInput = z.infer<typeof ganttCalendarInputSchema>;
export type GanttProjectPlan = z.infer<typeof ganttProjectPlanSchema>;
