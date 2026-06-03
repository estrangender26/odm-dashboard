import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { sql, eq, and } from "drizzle-orm";
import { ensureDbReady, getDb } from "./queries/connection";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { authenticateRequest, createOAuthCallbackHandler } from "./kimi/auth";
import { Paths } from "@contracts/constants";
import fs from "fs";
import path from "path";
import { governanceMilestoneState, governanceUploads } from "../db/schema";

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

app.use("*", async (c, next) => {
  const start = Date.now();
  const path = c.req.path;
  if (path.startsWith("/api/") || path.startsWith("/api/trpc")) {
    console.log(`[API] --> ${c.req.method} ${path}`);
  }
  try {
    await next();
    if (path.startsWith("/api/") || path.startsWith("/api/trpc")) {
      console.log(`[API] <-- ${c.req.method} ${path} ${c.res.status} (${Date.now() - start}ms)`);
    }
  } catch (error: any) {
    if (path.startsWith("/api/") || path.startsWith("/api/trpc")) {
      console.error(`[API] xx ${c.req.method} ${path} (${Date.now() - start}ms): ${error?.message ?? String(error)}`);
    }
    throw error;
  }
});


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
    // Aggressive cache-busting: unique ETag based on file mtime + content length
    const stat = fs.statSync(governancePath);
    const etag = `"gov-${stat.mtime.getTime()}-${content.length}"`;
    c.header("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
    c.header("Pragma", "no-cache");
    c.header("Expires", "0");
    c.header("Vary", "*");
    c.header("ETag", etag);
    // If client sends matching If-None-Match, still return 200 to force refresh
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
    const db = getDb();
    const result = await db.select({ count: sql`count(*)` }).from(sql`mw_inspections`);
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

app.get("/api/health/db", async (c) => {
  try {
    const db = getDb();
    const rows = await db.execute(sql`SELECT current_database() AS current_database, current_schema() AS current_schema, 1 AS ping`);
    const row = (rows as any).rows?.[0] ?? (Array.isArray(rows) ? rows[0] : rows);
    return c.json({ ok: true, ...row });
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500);
  }
});

function isDuplicateCleanupDbUnavailable(error: unknown): boolean {
  const e = error as { code?: string; message?: string; name?: string } | undefined;
  const message = e?.message?.toLowerCase() ?? "";
  const code = e?.code?.toLowerCase() ?? "";

  return [
    "database_url not set",
    "database",
    "connection",
    "connect",
    "dns",
    "enotfound",
    "econnrefused",
    "econnreset",
    "timeout",
    "terminating connection",
  ].some(term => message.includes(term) || code.includes(term));
}

app.post("/api/admin/tasks/duplicate-cleanup/dry-run", async (c) => {
  try {
    const user = await authenticateRequest(c.req.raw.headers);
    if (user.role !== "admin") {
      return c.json({ error: "Admin role required" }, 403);
    }

    const body = await c.req.json().catch(() => ({}));
    const dataset = body?.dataset as "htt" | "aglipay" | undefined;
    if (dataset !== undefined && !["htt", "aglipay"].includes(dataset)) {
      return c.json({ error: "Invalid dataset. Use htt or aglipay." }, 400);
    }

    console.info("[tasks/duplicateCleanup/dry-run] started", {
      requestedBy: user.id,
      dataset: dataset ?? "all",
    });

    const { getDb } = await import("./queries/connection");
    const {
      exportDuplicateCleanupDryRun,
      runMaintenanceDuplicateCleanup,
    } = await import("./tasks-duplicate-cleanup");
    const db = getDb();
    const result = await runMaintenanceDuplicateCleanup(db, {
      dataset,
      dryRun: true,
      apply: false,
    });
    const payload = await exportDuplicateCleanupDryRun(result, {
      dataset,
      csvPath: "reports/task-duplicate-dry-run.csv",
    });

    console.info("[tasks/duplicateCleanup/dry-run] completed", {
      requestedBy: user.id,
      dataset: dataset ?? "all",
      duplicateGroupCount: payload.duplicateGroupCount,
      duplicateRowCount: payload.duplicateRowCount,
      rowsProposedForDeletion: payload.rowsProposedForDeletion.length,
      rowsProposedForRetention: payload.rowsProposedForRetention.length,
      conflictGroups: payload.conflictGroups,
      csvPath: payload.exported.csvPath,
    });

    return c.json(payload);
  } catch (error) {
    const e = error as {
      tag?: string;
      status?: number;
      message?: string;
      stack?: string;
    };
    if (e?.tag === "app_error" && e.status === 403) {
      return c.json({ error: "Authentication required" }, 401);
    }
    if (e?.message === "Missing session" || e?.message === "Invalid session") {
      return c.json({ error: "Authentication required" }, 401);
    }
    if (isDuplicateCleanupDbUnavailable(error)) {
      console.error("[tasks/duplicateCleanup/dry-run] DB error isolated", {
        message: e?.message ?? String(error),
        stack: e?.stack,
      });
      return c.json(
        { error: "Database unavailable. Duplicate cleanup dry-run was not run." },
        503
      );
    }

    console.error("[tasks/duplicateCleanup/dry-run] failed", {
      message: e?.message ?? String(error),
      stack: e?.stack,
    });
    return c.json({ error: e?.message ?? "Duplicate cleanup dry-run failed" }, 500);
  }
});
console.info("[tasks/duplicateCleanup] dry-run endpoint registered");

// Debug: list latest uploads
app.get("/api/debug/uploads", async (c) => {
  try {
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    const rows = await db.execute(sql`
      SELECT id, facility_slug, milestone_id, file_name, file_url, uploaded_at
      FROM governance_uploads
      ORDER BY id DESC
      LIMIT 20
    `);
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
    const rows = await db.execute(sql`
      SELECT id, facility_slug, milestone_id, category, toc_item, file_name, file_url, uploaded_by, uploaded_at
      FROM governance_uploads
      WHERE facility_slug = ${facilitySlug}
      ORDER BY id DESC
    `);
    return c.json({ files: rows.rows || rows });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/governance/files - create a file record
app.post("/api/governance/files", async (c) => {
  try {
    const body = await c.req.json();
    const { facilitySlug, milestoneId, tocItem, filename, fileUrl, fileSize, uploadedAt } = body;
    console.log("[API] POST /api/governance/files body:", JSON.stringify({ facilitySlug, milestoneId, tocItem, filename, fileSize, hasUrl: !!fileUrl }));
    if (!facilitySlug || !filename) {
      console.log("[API] POST files missing fields:", { facilitySlug, milestoneId, filename });
      return c.json({ error: "facilitySlug, filename required" }, 400);
    }
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    const slug = facilitySlug.toLowerCase();
    const mid = milestoneId || "__ref";
    // Single INSERT with RETURNING — replaces 3 round-trips (check + insert + select)
    console.log("[API] POST files inserting:", slug, mid, filename);
    const result = await db.execute(sql`
      INSERT INTO governance_uploads
        (facility_slug, milestone_id, category, toc_item, file_name, file_url, uploaded_at)
      VALUES
        (${slug}, ${mid}, ${tocItem || null}, ${tocItem || null}, ${filename}, ${fileUrl || filename}, ${uploadedAt ? new Date(uploadedAt).toISOString() : new Date().toISOString()})
      RETURNING id, facility_slug, milestone_id, category, toc_item, file_name, file_url, uploaded_at
    `);
    const rows = (result as any).rows || (result as any) || [];
    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    console.log("[API] POST files row:", row ? JSON.stringify(row).substring(0,100) : "none");
    if (!row || !row.id) {
      return c.json({ error: "insert returned no row" }, 500);
    }
    return c.json({ id: row.id, file: row, success: true });
  } catch (e: any) {
    console.error("[API] POST files ERROR:", e.message);
    return c.json({ error: e.message }, 500);
  }
});

// GET /api/governance/references - list reference documents (milestone_id = '__ref')
app.get("/api/governance/references", async (c) => {
  try {
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    const result = await db.execute(sql`
      SELECT id, facility_slug, milestone_id, category, toc_item, file_name, uploaded_by, uploaded_at
      FROM governance_uploads
      WHERE milestone_id = '__ref' OR category = 'references'
      ORDER BY uploaded_at DESC
    `);
    const rows = (result as any).rows || (result as any) || [];
    return c.json({ files: rows });
  } catch (e: any) {
    console.error("[API] /references error:", e.message);
    return c.json({ error: e.message, files: [] }, 500);
  }
});

// DELETE /api/governance/files/:id - delete a file from either table
app.delete("/api/governance/files/:id", async (c) => {
  try {
    const id = parseInt(c.req.param("id"));
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    // Try both tables — one will succeed
    await db.execute(sql`DELETE FROM governance_uploads WHERE id = ${id}`);
    await db.execute(sql`DELETE FROM governance_files WHERE id = ${id}`);
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// GET /api/governance/files/:id/view - stream file inline
// Helper: fetch file from either governance_uploads or governance_files table
async function getFileFromEitherTable(db: any, id: number) {
  // Try governance_uploads first (REST uploads)
  let rows = await db.execute(sql`
    SELECT id, file_name, file_url FROM governance_uploads WHERE id = ${id} LIMIT 1
  `);
  let fileRows = rows.rows || rows;
  if (fileRows.length > 0) return fileRows[0];
  // Fallback to governance_files (tRPC uploads)
  rows = await db.execute(sql`
    SELECT id, file_name, file_data AS file_url FROM governance_files WHERE id = ${id} LIMIT 1
  `);
  fileRows = rows.rows || rows;
  return fileRows.length > 0 ? fileRows[0] : null;
}

app.get("/api/governance/files/:id/view", async (c) => {
  try {
    const id = parseInt(c.req.param("id"));
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    const file = await getFileFromEitherTable(db, id);
    if (!file) return c.json({ error: "File not found" }, 404);
    const fileName = file.file_name || "file";
    const fileUrl = file.file_url || "";
    console.log("[VIEW] id=", id, "name=", fileName, "urlLen=", fileUrl.length, "urlPrefix=", fileUrl.substring(0, 50));
    // Parse data URI: data:<mime>;base64,<data>
    let mimeType = "application/octet-stream";
    let base64Data = "";
    if (fileUrl.startsWith("data:")) {
      const commaIdx = fileUrl.indexOf(",");
      if (commaIdx > -1) {
        const header = fileUrl.slice(0, commaIdx);
        base64Data = fileUrl.slice(commaIdx + 1);
        const semiIdx = header.indexOf(";");
        mimeType = semiIdx > -1 ? header.slice(5, semiIdx) : header.slice(5);
        console.log("[VIEW] data URI header=", header, "mime=", mimeType, "b64len=", base64Data.length);
      } else {
        console.log("[VIEW] data URI has no comma!");
      }
    } else {
      base64Data = fileUrl;
      console.log("[VIEW] not a data URI, raw length=", fileUrl.length);
    }
    // Fallback mime type from file extension
    if (mimeType === "application/octet-stream") {
      const ext = fileName.split(".").pop()?.toLowerCase();
      const mimeMap: Record<string, string> = {
        pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
        gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", txt: "text/plain",
        csv: "text/csv", json: "application/json", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        xls: "application/vnd.ms-excel", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        doc: "application/msword", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ppt: "application/vnd.ms-powerpoint", zip: "application/zip", mp4: "video/mp4", mp3: "audio/mpeg",
      };
      if (ext && mimeMap[ext]) mimeType = mimeMap[ext];
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64Data, "base64");
      console.log("[VIEW] decoded buffer size=", buffer.length);
    } catch (decErr: any) {
      console.error("[VIEW] Base64 decode failed:", decErr.message);
      return c.json({ error: "Invalid file data encoding" }, 500);
    }
    if (buffer.length === 0) {
      console.error("[VIEW] Empty buffer!");
      return c.json({ error: "Empty file data" }, 500);
    }
    // For non-viewable types (docx, xlsx), force download instead
    const isViewable = ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/svg+xml", "image/webp", "text/plain", "text/csv"].includes(mimeType);
    const disposition = isViewable ? "inline" : "attachment";
    c.header("Content-Type", mimeType);
    c.header("Content-Disposition", `${disposition}; filename="${fileName}"`);
    c.header("Content-Length", String(buffer.length));
    c.header("Cache-Control", "public, max-age=3600");
    console.log("[VIEW] serving", disposition, "type=", mimeType, "size=", buffer.length);
    return c.body(buffer);
  } catch (e: any) {
    console.error("[VIEW] Error:", e.message, e.stack);
    return c.json({ error: e.message }, 500);
  }
});

// GET /api/governance/files/:id/download - stream file as attachment
app.get("/api/governance/files/:id/download", async (c) => {
  try {
    const id = parseInt(c.req.param("id"));
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    const file = await getFileFromEitherTable(db, id);
    if (!file) return c.json({ error: "File not found" }, 404);
    const fileName = file.file_name || "file";
    const fileUrl = file.file_url || "";
    console.log("[DL] id=", id, "name=", fileName, "urlLen=", fileUrl.length);
    let mimeType = "application/octet-stream";
    let base64Data = "";
    if (fileUrl.startsWith("data:")) {
      const commaIdx = fileUrl.indexOf(",");
      if (commaIdx > -1) {
        const header = fileUrl.slice(0, commaIdx);
        base64Data = fileUrl.slice(commaIdx + 1);
        const semiIdx = header.indexOf(";");
        mimeType = semiIdx > -1 ? header.slice(5, semiIdx) : header.slice(5);
      }
    } else {
      base64Data = fileUrl;
    }
    if (mimeType === "application/octet-stream") {
      const ext = fileName.split(".").pop()?.toLowerCase();
      const mimeMap: Record<string, string> = {
        pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
        gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", txt: "text/plain",
        csv: "text/csv", json: "application/json", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        xls: "application/vnd.ms-excel", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        doc: "application/msword", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ppt: "application/vnd.ms-powerpoint", zip: "application/zip", mp4: "video/mp4", mp3: "audio/mpeg",
      };
      if (ext && mimeMap[ext]) mimeType = mimeMap[ext];
    }
    const buffer = Buffer.from(base64Data, "base64");
    console.log("[DL] mime=", mimeType, "bufSize=", buffer.length);
    c.header("Content-Type", mimeType);
    c.header("Content-Disposition", `attachment; filename="${fileName}"`);
    c.header("Content-Length", String(buffer.length));
    return c.body(buffer);
  } catch (e: any) {
    console.error("[DL] Error:", e.message, e.stack);
    return c.json({ error: e.message }, 500);
  }
});

// ═══ Governance Milestone State CRUD (DB-only, no localStorage) ═══

// POST /api/governance/repair-ppp — fix corrupted ppp_date values
app.post("/api/governance/repair-ppp", async (c) => {
  try {
    const body = await c.req.json();
    const { facilitySlug, milestoneId, pppDate } = body;
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    // First clear the corrupted value
    await db.execute(sql`
      UPDATE governance_milestone_state
      SET ppp_date = NULL
      WHERE facility_slug = ${facilitySlug.toLowerCase()} AND milestone_id = ${milestoneId}
    `);
    // Then set the correct value
    if (pppDate) {
      await db.execute(sql`
        UPDATE governance_milestone_state
        SET ppp_date = ${pppDate}
        WHERE facility_slug = ${facilitySlug.toLowerCase()} AND milestone_id = ${milestoneId}
      `);
    }
    // Verify
    const rows = await db.execute(sql`
      SELECT ppp_date FROM governance_milestone_state
      WHERE facility_slug = ${facilitySlug.toLowerCase()} AND milestone_id = ${milestoneId}
    `);
    const r = (rows as any).rows || rows;
    return c.json({ success: true, facility: facilitySlug, milestone: milestoneId, pppDate: Array.isArray(r) && r.length > 0 ? r[0].ppp_date : null });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// GET /api/governance/ppp-diag/:facilitySlug/:milestoneId — diagnostic: raw DB row
app.get("/api/governance/ppp-diag/:facilitySlug/:milestoneId", async (c) => {
  try {
    const facilitySlug = c.req.param("facilitySlug").toLowerCase();
    const milestoneId = c.req.param("milestoneId");
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    const rows = await db.execute(sql`
      SELECT * FROM governance_milestone_state
      WHERE facility_slug = ${facilitySlug} AND milestone_id = ${milestoneId}
    `);
    const r = (rows as any).rows || rows;
    return c.json({ facility: facilitySlug, milestone: milestoneId, count: Array.isArray(r) ? r.length : 0, row: Array.isArray(r) && r.length > 0 ? r[0] : null });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// GET /api/governance/state/:facilitySlug — returns all milestone states
app.get("/api/governance/state/:facilitySlug", async (c) => {
  try {
    const facilitySlug = c.req.param("facilitySlug").toLowerCase();
    console.log("[LOAD-BE] GET facility=" + facilitySlug);
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    // Raw SQL matching actual migration columns (avoid schema drift)
    const states = await db.execute(sql`
      SELECT id, facility_slug, milestone_id, ppp_date, comp_date, custom_pct, updated_at, updated_by
      FROM governance_milestone_state
      WHERE facility_slug = ${facilitySlug}
    `);
    const stateRows = (states as any).rows || states;
    console.log("[LOAD-BE] Found", Array.isArray(stateRows) ? stateRows.length : 'N/A', "states");
    if (Array.isArray(stateRows) && stateRows.length > 0) {
      stateRows.forEach((r: any, i: number) => {
        console.log(`[LOAD-BE] Row ${i}: mid=${r.milestone_id} ppp_date=${JSON.stringify(r.ppp_date)} comp_date=${JSON.stringify(r.comp_date)}`);
      });
    }
    // Query uploads table — exclude file_url (base64) to keep response small
    const files1 = await db.execute(sql`
      SELECT id, facility_slug, milestone_id, category, toc_item, file_name, uploaded_by, uploaded_at
      FROM governance_uploads
      WHERE facility_slug = ${facilitySlug} OR facility_slug = 'all'
      ORDER BY id DESC
    `);
    console.log("[API] uploads query raw type:", typeof files1, "isArray:", Array.isArray(files1), "keys:", Object.keys(files1));
    // Handle multiple possible response formats from postgres-js
    let upRows: any[] = [];
    if (Array.isArray(files1)) {
      upRows = files1;
    } else if (files1 && Array.isArray((files1 as any).rows)) {
      upRows = (files1 as any).rows;
    } else if (files1 && typeof files1 === 'object') {
      const f = files1 as any;
      if (f.rows) upRows = f.rows;
      else if (f.length) upRows = f;
    }
    console.log("[API] governance_uploads rows:", upRows.length);
    // ALSO query governance_files — exclude file_data (base64) to keep response small
    const files2 = await db.execute(sql`
      SELECT id, facility_slug, milestone_id, toc_item, file_name, uploaded_by, uploaded_at
      FROM governance_files
      WHERE facility_slug = ${facilitySlug}
      ORDER BY id DESC
    `);
    let gfRows: any[] = [];
    if (Array.isArray(files2)) {
      gfRows = files2;
    } else if (files2 && Array.isArray((files2 as any).rows)) {
      gfRows = (files2 as any).rows;
    } else if (files2 && typeof files2 === 'object') {
      const f2 = files2 as any;
      if (f2.rows) gfRows = f2.rows;
      else if (f2.length) gfRows = f2;
    }
    console.log("[API] governance_files rows:", gfRows.length);
    // Merge both sources
    const allFiles = [...upRows, ...gfRows];
    // Separate reference documents (milestone_id = '__ref')
    const refFiles = allFiles.filter((f: any) => f.milestone_id === '__ref' || f.category === 'references');
    const msFiles = allFiles.filter((f: any) => f.milestone_id !== '__ref' && f.category !== 'references');
    console.log("[API] files=" + allFiles.length + " refs=" + refFiles.length + " ms=" + msFiles.length);
    return c.json({
      states: stateRows,
      files: msFiles,
      referenceFiles: refFiles
    });
  } catch (e: any) {
    console.error("[API] GET state ERROR:", e.message, e.stack);
    return c.json({ error: e.message, stack: e.stack }, 500);
  }
});

// Manual migration endpoint for gantt planned columns
app.get("/api/migrate-gantt", async (c) => {
  try {
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    await db.execute(sql.raw(`
      ALTER TABLE gantt_tasks 
      ADD COLUMN IF NOT EXISTS planned_start VARCHAR(20),
      ADD COLUMN IF NOT EXISTS planned_end VARCHAR(20),
      ADD COLUMN IF NOT EXISTS category VARCHAR(100),
      ADD COLUMN IF NOT EXISTS notes TEXT
    `));
    return c.json({ success: true, message: "Columns added" });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Validate YYYY-MM-DD format
function isValidDate(str: unknown): boolean {
  if (!str || typeof str !== 'string') return false;
  if (str === 'undefined' || str === 'null' || str === 'NaN' || str === '' || str === 'undefined-NaN-NaN') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// ═══ DB Cleanup: remove corrupted date values ═══
app.post("/api/governance/cleanup-dates", async (c) => {
  try {
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    // Clear corrupted ppp_date values (MySQL/TiDB compatible regex)
    const ppResult = await db.execute(sql.raw(`
      UPDATE governance_milestone_state
      SET ppp_date = NULL
      WHERE ppp_date IS NOT NULL
        AND ppp_date NOT REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    `));
    // Clear corrupted comp_date values
    const cdResult = await db.execute(sql.raw(`
      UPDATE governance_milestone_state
      SET comp_date = NULL
      WHERE comp_date IS NOT NULL
        AND comp_date NOT REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    `));
    return c.json({
      success: true,
      pppCleared: (ppResult as any).rowCount || 0,
      compCleared: (cdResult as any).rowCount || 0
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/governance/state/:facilitySlug — save a milestone state
app.post("/api/governance/state/:facilitySlug", async (c) => {
  try {
    const facilitySlug = c.req.param("facilitySlug").toLowerCase();
    const body = await c.req.json();
    console.log('[SAVE-BE] facility='+facilitySlug+' body:',JSON.stringify(body));
    const { milestoneId, compDate, customPct, pppDate, readyStatus, remarks } = body;
    if (!milestoneId) return c.json({ error: "milestoneId required" }, 400);
    // Sanitize date inputs — reject garbage strings like "undefined"
    const sanitizedPP = pppDate !== undefined
      ? (isValidDate(pppDate) ? pppDate : (pppDate === null ? null : undefined))
      : undefined;
    const sanitizedCD = compDate !== undefined
      ? (isValidDate(compDate) ? compDate : (compDate === null ? null : undefined))
      : undefined;
    console.log('[SAVE-BE] sanitizedPP:',sanitizedPP,'sanitizedCD:',sanitizedCD);
    if (pppDate !== undefined && sanitizedPP === undefined && pppDate !== null) {
      console.warn('[SAVE-BE] REJECTED invalid pppDate:', JSON.stringify(pppDate));
    }
    if (compDate !== undefined && sanitizedCD === undefined && compDate !== null) {
      console.warn('[SAVE-BE] REJECTED invalid compDate:', JSON.stringify(compDate));
    }
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    const now = new Date().toISOString();
    // Check for existing
    const existing = await db.execute(sql`
      SELECT id, ppp_date, comp_date FROM governance_milestone_state
      WHERE facility_slug = ${facilitySlug} AND milestone_id = ${milestoneId}
      LIMIT 1
    `);
    const existingRows = existing.rows || existing;
    console.log('[SAVE-BE] existing rows:',existingRows.length);
    if (existingRows.length > 0) {
      console.log('[SAVE-BE] existing row before:',JSON.stringify(existingRows[0]));
      // Update — only touch fields that were explicitly sent
      const setParts: string[] = [`updated_at = '${now}'`];
      if (sanitizedCD !== undefined) setParts.push("comp_date = " + (sanitizedCD === null ? 'NULL' : "'" + sanitizedCD + "'"));
      if (sanitizedPP !== undefined) setParts.push("ppp_date = " + (sanitizedPP === null ? 'NULL' : "'" + sanitizedPP + "'"));
      if (customPct !== undefined) setParts.push("custom_pct = " + customPct);
      if (readyStatus !== undefined) setParts.push("ready_status = " + (readyStatus === null ? 'NULL' : "'" + readyStatus + "'"));
      if (remarks !== undefined) setParts.push("remarks = " + (remarks === null ? 'NULL' : "'" + remarks + "'"));
      const updateSQL = `UPDATE governance_milestone_state SET ${setParts.join(', ')} WHERE facility_slug = '${facilitySlug}' AND milestone_id = '${milestoneId}'`;
      console.log('[SAVE-BE] UPDATE SQL:',updateSQL);
      await db.execute(sql.raw(updateSQL));
      // Verify
      const verify = await db.execute(sql`
        SELECT ppp_date, comp_date FROM governance_milestone_state
        WHERE facility_slug = ${facilitySlug} AND milestone_id = ${milestoneId}
      `);
      const vRows = verify.rows || verify;
      console.log('[SAVE-BE] row after UPDATE:',JSON.stringify(vRows[0]));
    } else {
      // Insert — use provided values or NULL
      console.log('[SAVE-BE] INSERT: pp='+sanitizedPP+' cd='+sanitizedCD);
      await db.execute(sql`
        INSERT INTO governance_milestone_state
          (facility_slug, milestone_id, comp_date, custom_pct, ppp_date, updated_at)
        VALUES
          (${facilitySlug}, ${milestoneId}, ${sanitizedCD !== undefined ? sanitizedCD : null}, ${customPct !== undefined ? customPct : null}, ${sanitizedPP !== undefined ? sanitizedPP : null}, ${now})
      `);
      // Verify
      const verify = await db.execute(sql`
        SELECT ppp_date, comp_date FROM governance_milestone_state
        WHERE facility_slug = ${facilitySlug} AND milestone_id = ${milestoneId}
      `);
      const vRows = verify.rows || verify;
      console.log('[SAVE-BE] row after INSERT:',JSON.stringify(vRows[0]));
    }
    return c.json({ success: true, milestoneId, savedPP: sanitizedPP, savedCD: sanitizedCD });
  } catch (e: any) {
    console.error('[SAVE-BE] ERROR:', e.message);
    return c.json({ error: e.message }, 500);
  }
});

/* CORS for tRPC — allow Kimi static deployment and local dev */
app.use("/api/trpc/*", cors({
  origin: ["https://oduhiajrfyneq.kimi.page", "https://dashboard.onrender.com", "http://localhost:3000", "http://localhost:5173"],
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "x-trpc-source"],
  credentials: true,
}));

app.use("/api/trpc/*", async (c) => {
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });

  if (c.req.path.includes("tasks.import")) {
    const rawBody = await response.clone().text();
    console.info("[tasks/import] backend raw response body", {
      path: c.req.path,
      status: response.status,
      rawBody,
    });
  }

  return response;
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  await ensureDbReady();
  await getDb().execute(sql`SELECT 1 FROM gantt_projects LIMIT 1`);
  
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
  
// ═══ AI INSIGHTS: Analyze governance data for a facility ═══
app.post("/api/governance/ai-insights", async (c) => {
  try {
    const { facilitySlug, allStates } = await c.req.json();
    if (!facilitySlug || !allStates) {
      return c.json({ error: "facilitySlug and allStates required" }, 400);
    }
    const { analyzeGovernance } = await import("./governance-ai");
    const state = allStates[facilitySlug] || { pp: "", ms: {}, up: {} };
    const insights = analyzeGovernance(facilitySlug, state, allStates);
    return c.json({ success: true, insights });
  } catch (e: any) {
    console.error("[AI-INSIGHTS] Error:", e.message);
    return c.json({ error: e.message }, 500);
  }
});

// ═══ AI CHAT: Answer governance questions ═══
app.post("/api/governance/ai-chat", async (c) => {
  try {
    const { question, facilitySlug, allStates } = await c.req.json();
    if (!question) return c.json({ error: "question required" }, 400);

    const { analyzeGovernance, chatWithAI } = await import("./governance-ai");
    const slug = facilitySlug || Object.keys(allStates || {})[0] || "default";
    const state = allStates?.[slug] || { pp: "", ms: {}, up: {} };
    const insights = analyzeGovernance(slug, state, allStates || {});
    const response = chatWithAI(question, insights);
    return c.json({ success: true, response });
  } catch (e: any) {
    console.error("[AI-CHAT] Error:", e.message);
    return c.json({ error: e.message }, 500);
  }
});

// ═══ AI SUMMARY: Quick cross-facility overview ═══
app.post("/api/governance/ai-summary", async (c) => {
  try {
    const { allStates } = await c.req.json();
    if (!allStates) return c.json({ error: "allStates required" }, 400);

    const { analyzeGovernance } = await import("./governance-ai");
    const facilities = Object.keys(allStates);
    const results = facilities.map((slug) => {
      const insights = analyzeGovernance(slug, allStates[slug], allStates);
      return {
        slug,
        readiness: insights.overallReadiness,
        risk: insights.riskLevel,
        completed: insights.milestoneAnalysis.filter((m: any) => m.completed).length,
        total: insights.milestoneAnalysis.length,
        hasPPP: insights.hasPPP,
      };
    });

    const avgReadiness = results.length > 0
      ? Math.round(results.reduce((s, r) => s + r.readiness, 0) / results.length)
      : 0;
    const criticalCount = results.filter((r) => r.risk === "CRITICAL").length;
    const readyCount = results.filter((r) => r.readiness >= 80).length;

    return c.json({
      success: true,
      summary: {
        totalFacilities: facilities.length,
        avgReadiness,
        criticalCount,
        readyCount,
        facilities: results,
      },
    });
  } catch (e: any) {
    console.error("[AI-SUMMARY] Error:", e.message);
    return c.json({ error: e.message }, 500);
  }
});

  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
    console.log(`[BOOT] Static files served from: ${dp}`);
    console.log(`[BOOT] Health check: http://localhost:${port}/_health`);
  });
}
