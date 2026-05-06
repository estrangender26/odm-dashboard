import { authRouter } from "./auth-router";
import { tasksRouter } from "./tasks-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  tasks: tasksRouter,
});

export type AppRouter = typeof appRouter;
