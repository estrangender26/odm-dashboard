import { authRouter } from "./auth-router";
import { tasksRouter } from "./tasks-router";
import { governanceRouter } from "./governance-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  tasks: tasksRouter,
  governance: governanceRouter,
});

export type AppRouter = typeof appRouter;
