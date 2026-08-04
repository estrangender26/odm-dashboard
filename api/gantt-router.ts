import { z } from "zod";
import {
  ganttAssignmentInputSchema,
  ganttDependencyInputSchema,
  ganttProjectIdSchema,
  ganttTaskCommandSchema,
  ganttTaskIdSchema,
  ganttTaskInputSchema,
} from "@contracts/gantt";
import { createRouter, ganttScopedQuery } from "./middleware";
import {
  ganttRepository,
  mapDependencyForClient,
  mapTaskForClient,
} from "./gantt-repository";

const importedTaskSchema = ganttTaskInputSchema.extend({
  sourceId: z.number().int().positive(),
  parentSourceId: z.number().int().positive().nullable(),
});

const importedDependencySchema = ganttDependencyInputSchema
  .omit({ id: true, predecessorTaskId: true, successorTaskId: true })
  .extend({
    predecessorSourceId: z.number().int().positive(),
    successorSourceId: z.number().int().positive(),
  });

const importedAssignmentSchema = ganttAssignmentInputSchema
  .omit({ id: true, taskId: true })
  .extend({ taskSourceId: z.number().int().positive() });

/**
 * Phase 0 Gantt API. Every operation resolves its owner/session scope on the
 * server and requires an explicit projectId. There are intentionally no global
 * list, reset, seed, DDL, or arbitrary-owner procedures in this router.
 */
export const ganttRouter = createRouter({
  tasks: ganttScopedQuery
    .input(z.object({ projectId: ganttProjectIdSchema }))
    .query(async ({ input, ctx }) => {
      const plan = await ganttRepository.loadProject(ctx.ganttScope, input.projectId);
      return plan.tasks.map(mapTaskForClient);
    }),

  links: ganttScopedQuery
    .input(z.object({ projectId: ganttProjectIdSchema }))
    .query(async ({ input, ctx }) => {
      const plan = await ganttRepository.loadProject(ctx.ganttScope, input.projectId);
      return plan.dependencies.map(mapDependencyForClient);
    }),

  assignments: ganttScopedQuery
    .input(z.object({ projectId: ganttProjectIdSchema }))
    .query(async ({ input, ctx }) => {
      const plan = await ganttRepository.loadProject(ctx.ganttScope, input.projectId);
      return plan.assignments.map(assignment => ({
        id: assignment.id,
        projectId: assignment.projectId,
        taskId: assignment.taskId,
        resourceId: assignment.resourceId,
        units: assignment.units,
        role: assignment.role,
      }));
    }),

  saveTask: ganttScopedQuery
    .input(ganttTaskCommandSchema)
    .mutation(async ({ input, ctx }) => {
      const saved = await ganttRepository.saveTask(
        ctx.ganttScope,
        input.projectId,
        input.task,
        input.incomingDependencies,
      );
      return mapTaskForClient(saved);
    }),

  deleteTask: ganttScopedQuery
    .input(z.object({ projectId: ganttProjectIdSchema, taskId: ganttTaskIdSchema }))
    .mutation(({ input, ctx }) => ganttRepository.deleteTask(
      ctx.ganttScope,
      input.projectId,
      input.taskId,
    )),

  replaceTaskDependencies: ganttScopedQuery
    .input(z.object({
      projectId: ganttProjectIdSchema,
      successorTaskId: ganttTaskIdSchema,
      dependencies: z.array(ganttDependencyInputSchema.omit({ successorTaskId: true })),
    }))
    .mutation(({ input, ctx }) => ganttRepository.replaceIncomingDependencies(
      ctx.ganttScope,
      input.projectId,
      input.successorTaskId,
      input.dependencies,
    )),

  saveLink: ganttScopedQuery
    .input(z.object({
      projectId: ganttProjectIdSchema,
      dependency: ganttDependencyInputSchema.omit({ id: true }),
    }))
    .mutation(async ({ input, ctx }) => {
      const saved = await ganttRepository.addDependency(ctx.ganttScope, input.projectId, input.dependency);
      return mapDependencyForClient(saved);
    }),

  deleteLink: ganttScopedQuery
    .input(z.object({ projectId: ganttProjectIdSchema, dependencyId: z.number().int().positive() }))
    .mutation(({ input, ctx }) => ganttRepository.deleteDependency(
      ctx.ganttScope,
      input.projectId,
      input.dependencyId,
    )),

  reorderTasks: ganttScopedQuery
    .input(z.object({
      projectId: ganttProjectIdSchema,
      updates: z.array(z.object({ id: ganttTaskIdSchema, sortOrder: z.number().int().nonnegative() })).max(10_000),
    }))
    .mutation(({ input, ctx }) => ganttRepository.reorderTasks(ctx.ganttScope, input.projectId, input.updates)),

  updateHierarchy: ganttScopedQuery
    .input(z.object({
      projectId: ganttProjectIdSchema,
      updates: z.array(z.object({
        id: ganttTaskIdSchema,
        parentId: z.number().int().positive().nullable(),
        sortOrder: z.number().int().nonnegative(),
      })).max(10_000),
    }))
    .mutation(({ input, ctx }) => ganttRepository.updateHierarchy(ctx.ganttScope, input.projectId, input.updates)),

  clearProject: ganttScopedQuery
    .input(z.object({ projectId: ganttProjectIdSchema }))
    .mutation(({ input, ctx }) => ganttRepository.clearProject(ctx.ganttScope, input.projectId)),

  importProject: ganttScopedQuery
    .input(z.object({
      projectId: ganttProjectIdSchema,
      tasks: z.array(importedTaskSchema).max(100_000),
      dependencies: z.array(importedDependencySchema).max(200_000),
      assignments: z.array(importedAssignmentSchema).max(200_000).default([]),
    }))
    .mutation(({ input, ctx }) => ganttRepository.replaceProjectPlan(
      ctx.ganttScope,
      input.projectId,
      input.tasks,
      input.dependencies,
      input.assignments,
    )),
});
