import { authRouter } from "./auth-router";
import { tasksRouter } from "./tasks-router";
import { governanceRouter } from "./governance-router";
import { governanceFilesRouter } from "./governance-files-router";
import { seedRouter } from "./seed-router";
import { mwRouter } from "./mw-router";
import { ganttRouter } from "./gantt-router";
import { efmRouter } from "./efm-router";
import { documentsRouter } from "./documents-router";
import { ganttProjectsRouter } from "./gantt-projects-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  tasks: tasksRouter,
  governance: governanceRouter,
  govFiles: governanceFilesRouter,
  seed: seedRouter,
  mw: mwRouter,
  gantt: ganttRouter,
  efm: efmRouter,
  documents: documentsRouter,
  ganttProjects: ganttProjectsRouter,
});

export type AppRouter = typeof appRouter;
