import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function getMime(p: string) {
  return MIME[path.extname(p).toLowerCase()] || "application/octet-stream";
}

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

export function serveStaticFiles(app: App) {
  const distPath = findDistPublic();

  console.log("[VITE] Resolved distPath:", distPath);
  console.log("[VITE] cwd:", process.cwd());
  console.log("[VITE] import.meta.dirname:", import.meta.dirname);

  if (!distPath || !fs.existsSync(path.join(distPath, "index.html"))) {
    console.error("[VITE] ERROR: index.html not found in dist/public");
    app.get("/*", (c) =>
      c.json(
        {
          error: "Build not found",
          distPath,
          cwd: process.cwd(),
          dirname: import.meta.dirname,
          hint: "Run 'npm run build' to generate the frontend files",
        },
        500
      )
    );
    return;
  }

  console.log("[VITE] index.html found. Serving static files from:", distPath);

  // Serve assets with exact path match
  app.get("/assets/*", (c) => {
    const pathname = new URL(c.req.url).pathname;
    const filePath = path.join(distPath!, pathname);
    if (!filePath.startsWith(distPath!)) return c.notFound();
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const content = fs.readFileSync(filePath);
        c.header("Content-Type", getMime(filePath));
        c.header("Cache-Control", "public, max-age=31536000");
        return c.body(content);
      }
    } catch { /* */ }
    return c.notFound();
  });

  // Serve other static files (favicon, etc.)
  app.get("/*", (c) => {
    const pathname = new URL(c.req.url).pathname;
    // Don't serve HTML for API routes
    if (pathname.startsWith("/api/") || pathname.startsWith("/trpc") || pathname.startsWith("/_")) {
      return c.notFound();
    }
    // Only serve files with extensions
    if (!path.extname(pathname)) return c.notFound();
    const filePath = path.join(distPath!, pathname);
    if (!filePath.startsWith(distPath!)) return c.notFound();
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const content = fs.readFileSync(filePath);
        c.header("Content-Type", getMime(filePath));
        c.header("Cache-Control", "no-cache");
        return c.body(content);
      }
    } catch { /* */ }
    return c.notFound();
  });

  // SPA fallback - only for non-API, non-file paths
  app.notFound((c) => {
    const pathname = new URL(c.req.url).pathname;
    if (pathname.startsWith("/api/") || pathname.startsWith("/trpc") || pathname.startsWith("/_") || path.extname(pathname)) {
      return c.json({ error: "Not Found" }, 404);
    }
    const content = fs.readFileSync(path.join(distPath!, "index.html"), "utf-8");
    c.header("Cache-Control", "no-cache");
    return c.html(content);
  });
}
