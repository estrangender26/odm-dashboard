import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { sql } from "drizzle-orm";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { createOAuthCallbackHandler } from "./kimi/auth";
import { Paths } from "@contracts/constants";
import fs from "fs";
import path from "path";

const app = new Hono<{ Bindings: HttpBindings }>();

/**
 * Find the dist/public directory that contains index.html.
 * Tries multiple strategies to work in both bundled (production) and
 * dynamic-import (dev) contexts.
 */
function findDistPublic(): string | null {
  const candidates: string[] = [];

  // Strategy 1: process.cwd() — works when server is started from project root
  candidates.push(path.resolve(process.cwd(), "dist/public"));

  // Strategy 2: import.meta.dirname + ../dist/public — when bundled to dist/boot.js
  candidates.push(path.resolve(import.meta.dirname, "../dist/public"));

  // Strategy 3: import.meta.dirname + ../../dist/public — when loaded dynamically from api/lib/
  candidates.push(path.resolve(import.meta.dirname, "../../dist/public"));

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }

  // None found — return the most likely one for error reporting
  return candidates[0];
}

// Resolve dist path once at module load
const distPath = findDistPublic();

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
  const dp = distPath || findDistPublic();
  if (!dp) return c.json({ error: "dist/public not found" }, 500);
  const governancePath = path.join(dp, "governance.html");
  if (fs.existsSync(governancePath)) {
    const content = fs.readFileSync(governancePath, "utf-8");
    return c.html(content);
  }
  return c.json({ error: "Governance dashboard not found", path: governancePath }, 404);
});

// Serve Manila Water Operator-Driven Maintenance Dashboard at /mw-dashboard
app.get("/mw-dashboard", async (c) => {
  const dp = distPath || findDistPublic();
  if (!dp) return c.json({ error: "dist/public not found" }, 500);
  const mwPath = path.join(dp, "mw-dashboard.html");
  if (fs.existsSync(mwPath)) {
    const content = fs.readFileSync(mwPath, "utf-8");
    c.header("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
    c.header("Pragma", "no-cache");
    c.header("Expires", "0");
    return c.html(content);
  }
  return c.json({ error: "MW dashboard not found", path: mwPath }, 404);
});

// Health check — tests database connectivity and shows deployment info
app.get("/_health", async (c) => {
  try {
    // Test actual database query
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    const result = await db.select({ count: sql<number>`count(*)` }).from(sql`mw_inspections`);
    const dbRecords = result[0]?.count || 0;
    
    return c.json({ 
      status: "ok",
      service: "odm-dashboard",
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        records: dbRecords
      }
    });
  } catch (e: any) {
    return c.json({ 
      status: "degraded",
      service: "odm-dashboard",
      timestamp: new Date().toISOString(),
      database: {
        connected: false,
        error: e.message
      }
    }, 500);
  }
});

// Debug: list latest uploads
app.get("/api/debug/uploads", async (c) => {
  try {
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    const rows = await db
      .select()
      .from(sql.raw('"governance_uploads"'))
      .orderBy(sql.raw('"id" DESC'))
      .limit(20);
    return c.json({ count: rows.length, uploads: rows });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
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
  
  // Startup verification — log dist path before serving
  const dp = distPath || findDistPublic();
  console.log("[BOOT] import.meta.dirname:", import.meta.dirname);
  console.log("[BOOT] process.cwd():", process.cwd());
  console.log("[BOOT] Resolved distPath:", dp);
  console.log("[BOOT] index.html exists:", dp ? fs.existsSync(path.join(dp, "index.html")) : false);
  if (dp && fs.existsSync(path.join(dp, "assets"))) {
    console.log("[BOOT] asset files:", fs.readdirSync(path.join(dp, "assets")).join(", "));
  }

  // Debug endpoint - MUST be before serveStaticFiles
  app.get("/_debug/static", (c) => {
    return c.json({
      distPath: dp,
      cwd: process.cwd(),
      dirname: import.meta.dirname,
      indexExists: dp ? fs.existsSync(path.join(dp, "index.html")) : false,
      assetsExists: dp ? fs.existsSync(path.join(dp, "assets")) : false,
      assetsFiles: dp && fs.existsSync(path.join(dp, "assets"))
        ? fs.readdirSync(path.join(dp, "assets")).slice(0, 10)
        : [],
    });
  });
  
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
    console.log(`[BOOT] Static files served from: ${dp}`);
    console.log(`[BOOT] Health check: http://localhost:${port}/_health`);
    console.log(`[BOOT] Debug endpoint: http://localhost:${port}/_debug/static`);
  });
}
