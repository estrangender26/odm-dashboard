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

export function serveStaticFiles(app: App) {
  // vite.ts is at api/lib/ — go up two levels to reach dist/public at project root
  const distPath = path.resolve(import.meta.dirname, "../../dist/public");

  console.log("[VITE] distPath:", distPath);
  console.log("[VITE] index exists:", fs.existsSync(path.join(distPath, "index.html")));

  if (!fs.existsSync(path.join(distPath, "index.html"))) {
    app.get("/", (c) => c.json({ error: "Build not found", distPath }, 500));
    return;
  }

  // Serve assets with exact path match
  app.get("/assets/*", (c) => {
    const pathname = new URL(c.req.url).pathname;
    const filePath = path.join(distPath, pathname);
    if (!filePath.startsWith(distPath)) return c.notFound();
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
    const filePath = path.join(distPath, pathname);
    if (!filePath.startsWith(distPath)) return c.notFound();
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
    const content = fs.readFileSync(path.join(distPath, "index.html"), "utf-8");
    c.header("Cache-Control", "no-cache");
    return c.html(content);
  });
}
