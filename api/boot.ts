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

// Serve O&M Governance Dashboard at /governance
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

// ═══ Governance File CRUD (for standalone HTML multi-user sync) ═══

// GET /api/governance/files/:facilitySlug - list files for a facility
app.get("/api/governance/files/:facilitySlug", async (c) => {
  try {
    const facilitySlug = c.req.param("facilitySlug").toLowerCase();
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    const rows = await db
      .select()
      .from(sql.raw('"governance_uploads"'))
      .where(sql.raw(`LOWER("facilitySlug") = '${facilitySlug}'`))
      .orderBy(sql.raw('"id" DESC'));
    return c.json({ files: rows });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/governance/files - create a file record
app.post("/api/governance/files", async (c) => {
  try {
    const body = await c.req.json();
    const { facilitySlug, milestoneId, filename, fileUrl, fileSize, uploadedAt } = body;
    if (!facilitySlug || !milestoneId || !filename) {
      return c.json({ error: "facilitySlug, milestoneId, filename required" }, 400);
    }
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    // Check if file already exists (dedup by filename + milestone)
    const existing = await db
      .select()
      .from(sql.raw('"governance_uploads"'))
      .where(sql.raw(`LOWER("facilitySlug") = '${facilitySlug.toLowerCase()}' AND "milestoneId" = '${milestoneId}' AND "filename" = '${filename.replace(/'/g, "''")}'`))
      .limit(1);
    if (existing.length > 0) {
      return c.json({ file: existing[0], existing: true });
    }
    const result = await db
      .insert(sql.raw('"governance_uploads"'))
      .values({
        facilitySlug: facilitySlug.toLowerCase(),
        milestoneId,
        filename,
        fileUrl: fileUrl || filename,
        fileSize: fileSize || 0,
        uploadedAt: uploadedAt ? new Date(uploadedAt) : new Date(),
      })
      .returning();
    return c.json({ file: result[0] });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// DELETE /api/governance/files/:id - delete a file
app.delete("/api/governance/files/:id", async (c) => {
  try {
    const id = parseInt(c.req.param("id"));
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    await db.delete(sql.raw('"governance_uploads"')).where(sql.raw(`"id" = ${id}`));
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ═══ Governance Milestone State CRUD (DB-only, no localStorage) ═══

// GET /api/governance/state/:facilitySlug — returns all milestone states
app.get("/api/governance/state/:facilitySlug", async (c) => {
  try {
    const facilitySlug = c.req.param("facilitySlug").toLowerCase();
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    // Get milestone states
    const states = await db
      .select()
      .from(sql.raw('"governance_milestone_state"'))
      .where(sql.raw(`LOWER("facilitySlug") = '${facilitySlug}'`));
    // Get files
    const files = await db
      .select()
      .from(sql.raw('"governance_uploads"'))
      .where(sql.raw(`LOWER("facilitySlug") = '${facilitySlug}'`))
      .orderBy(sql.raw('"id" DESC'));
    // Get upload counts per milestone
    const counts = await db
      .select({ milestoneId: sql.raw('"milestoneId"'), count: sql<number>`count(*)::int` })
      .from(sql.raw('"governance_uploads"'))
      .where(sql.raw(`LOWER("facilitySlug") = '${facilitySlug}'`))
      .groupBy(sql.raw('"milestoneId"'));
    return c.json({ states, files, counts });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/governance/state/:facilitySlug — save a milestone state
app.post("/api/governance/state/:facilitySlug", async (c) => {
  try {
    const facilitySlug = c.req.param("facilitySlug").toLowerCase();
    const body = await c.req.json();
    const { milestoneId, compDate, customPct, pppDate, readyStatus, remarks } = body;
    if (!milestoneId) return c.json({ error: "milestoneId required" }, 400);
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    const now = new Date().toISOString();
    // Upsert: insert or update
    await db
      .insert(sql.raw('"governance_milestone_state"'))
      .values({
        facilitySlug,
        milestoneId,
        compDate: compDate || null,
        customPct: customPct != null ? customPct : null,
        pppDate: pppDate || null,
        readyStatus: readyStatus || null,
        remarks: remarks || null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [sql.raw('"facilitySlug"'), sql.raw('"milestoneId"')],
        set: {
          compDate: compDate != null ? compDate : sql.raw('"governance_milestone_state"."compDate"'),
          customPct: customPct != null ? customPct : sql.raw('"governance_milestone_state"."customPct"'),
          pppDate: pppDate != null ? pppDate : sql.raw('"governance_milestone_state"."pppDate"'),
          readyStatus: readyStatus != null ? readyStatus : sql.raw('"governance_milestone_state"."readyStatus"'),
          remarks: remarks != null ? remarks : sql.raw('"governance_milestone_state"."remarks"'),
          updatedAt: now,
        },
      });
    return c.json({ success: true, milestoneId });
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
