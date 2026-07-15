import { z } from "zod";
import { ganttProjectIdSchema, ganttProjectInputSchema } from "@contracts/gantt";
import { adminQuery, createRouter, ganttScopedQuery } from "./middleware";
import { fetchGanttProjectsDiagnostics } from "./gantt-projects-diagnostics";
import { db } from "./queries/connection";
import {
  ganttRepository,
  mapDependencyForClient,
  mapTaskForClient,
} from "./gantt-repository";
import { TRPCError } from "@trpc/server";

export const ganttProjectsRouter = createRouter({
  list: ganttScopedQuery.query(async ({ ctx }) => {
    const projects = await ganttRepository.listProjects(ctx.ganttScope);
    return { projects, count: projects.length };
  }),

  get: ganttScopedQuery
    .input(z.object({ id: ganttProjectIdSchema }))
    .query(async ({ input, ctx }) => {
      const plan = await ganttRepository.loadProject(ctx.ganttScope, input.id);
      return {
        id: plan.project.id,
        name: plan.project.name,
        description: plan.project.description,
        status: plan.project.status,
        statusDate: plan.project.statusDate,
        calendarId: plan.project.calendarId,
        version: plan.project.version,
        createdAt: plan.project.createdAt,
        updatedAt: plan.project.updatedAt,
        tasks: plan.tasks.map(mapTaskForClient),
        dependencies: plan.dependencies.map(mapDependencyForClient),
        assignments: plan.assignments.map(assignment => ({
          id: assignment.id,
          projectId: assignment.projectId,
          taskId: assignment.taskId,
          resourceId: assignment.resourceId,
          units: assignment.units,
          role: assignment.role,
        })),
      };
    }),

  save: ganttScopedQuery
    .input(ganttProjectInputSchema)
    .mutation(async ({ input, ctx }) => {
      const row = input.id
        ? await ganttRepository.updateProject(ctx.ganttScope, input.id, input)
        : await ganttRepository.createProject(ctx.ganttScope, input);
      return { id: row.id, name: row.name, version: row.version };
    }),

  clone: ganttScopedQuery
    .input(z.object({
      sourceProjectId: ganttProjectIdSchema,
      name: z.string().trim().min(1).max(255),
    }))
    .mutation(async ({ input, ctx }) => {
      const row = await ganttRepository.cloneProject(ctx.ganttScope, input.sourceProjectId, input.name);
      return { id: row.id, name: row.name, version: row.version };
    }),

  rename: ganttScopedQuery
    .input(z.object({ id: ganttProjectIdSchema, name: z.string().trim().min(1).max(255) }))
    .mutation(async ({ input, ctx }) => {
      const current = await ganttRepository.loadProject(ctx.ganttScope, input.id);
      const project = await ganttRepository.updateProject(ctx.ganttScope, input.id, {
        name: input.name,
        description: current.project.description,
        status: current.project.status,
        statusDate: current.project.statusDate,
        calendarId: current.project.calendarId,
        expectedVersion: current.project.version,
      });
      return { success: true, project: { id: project.id, name: project.name } };
    }),

  delete: ganttScopedQuery
    .input(z.object({ id: ganttProjectIdSchema }))
    .mutation(async ({ input, ctx }) => {
      const project = await ganttRepository.deleteProject(ctx.ganttScope, input.id);
      return { success: true, project };
    }),

  debug: adminQuery.query(async () => {
    if (process.env.ENABLE_GANTT_DEBUG !== "true") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Debug endpoint disabled" });
    }
    return fetchGanttProjectsDiagnostics(db);
  }),
});
