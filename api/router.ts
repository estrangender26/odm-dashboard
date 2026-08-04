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
import { sharedGanttRouter } from "./shared-gantt-router";
import { primaveraLiteRouter } from "./primavera-lite-router";
import { aiRouter } from "./ai-router";
import { githubRouter } from "./github-router";
import { smpRouter } from "./smp-router";
import { odmTalkRouter } from "./odm-talk-router";
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
  sharedGantt: sharedGanttRouter,
  primaveraLite: primaveraLiteRouter,
  ai: aiRouter,
  github: githubRouter,
  smp: smpRouter,
  odmTalk: odmTalkRouter,
});

export type AppRouter = typeof appRouter;
