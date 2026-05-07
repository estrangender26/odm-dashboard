import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { createOAuthCallbackHandler } from "./kimi/auth";
import { Paths } from "@contracts/constants";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.get(Paths.oauthCallback, createOAuthCallbackHandler());

// OAuth authorize — redirects to Kimi login
app.get("/api/oauth/authorize", (c) => {
  const redirectUri = `${new URL(c.req.url).origin}${Paths.oauthCallback}`;
  const state = btoa(redirectUri);
  const params = new URLSearchParams({
    client_id: env.appId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "profile",
    state,
  });
  return c.redirect(`${env.kimiAuthUrl}/api/oauth/authorize?${params.toString()}`, 302);
});

// Serve original OM Governance Dashboard at /governance
app.get("/governance", async (c) => {
  const fs = await import("fs");
  const path = await import("path");
  const governancePath = path.resolve(import.meta.dirname, "../dist/public/governance.html");
  if (fs.existsSync(governancePath)) {
    const content = fs.readFileSync(governancePath, "utf-8");
    return c.html(content);
  }
  return c.json({ error: "Governance dashboard not found" }, 404);
});

// Serve Manila Water Operator-Driven Maintenance Dashboard at /mw-dashboard
app.get("/mw-dashboard", async (c) => {
  const fs = await import("fs");
  const path = await import("path");
  const mwPath = path.resolve(import.meta.dirname, "../dist/public/mw-dashboard.html");
  if (fs.existsSync(mwPath)) {
    const content = fs.readFileSync(mwPath, "utf-8");
    return c.html(content);
  }
  return c.json({ error: "MW dashboard not found" }, 404);
});

// Health check — shows deployed version and DB connection status
app.get("/_health", async (c) => {
  const { getDb } = await import("./queries/connection");
  try {
    const db = getDb();
    return c.json({ 
      status: "ok", 
      commit: "0931b41-session-pooler-fix",
      dbConnected: !!db 
    });
  } catch (e: any) {
    return c.json({ status: "error", message: e.message }, 500);
  }
});

app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
