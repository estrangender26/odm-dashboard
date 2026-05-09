import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import fs from "fs";
import path from "path";
import { stream } from "hono/streaming";

type App = Hono<{ Bindings: HttpBindings }>;

const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "application/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff",
};

function getMime(p: string) {
  return MIME[path.extname(p).toLowerCase()] || "application/octet-stream";
}

export function serveStaticFiles(app: App) {
  const distPath = path.resolve(import.meta.dirname, "../dist/public");
  console.log("[VITE] distPath:", distPath);

  if (!fs.existsSync(path.join(distPath, "index.html"))) {
    app.get("/", (c) => c.json({ error: "Build not found", distPath }, 500));
    return;
  }

  // Manual static file serving - more reliable than serveStatic
  app.use("*", async (c, next) => {
    const pathname = new URL(c.req.url).pathname;
    if (pathname.startsWith("/api/") || pathname.startsWith("/trpc")) {
      return next();
    }

    const filePath = path.join(distPath, pathname === "/" ? "index.html" : pathname);
    
    // Security: prevent directory traversal
    if (!filePath.startsWith(distPath)) {
      return next();
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const content = fs.readFileSync(filePath);
      c.header("Content-Type", getMime(filePath));
      if (filePath.endsWith(".html")) {
        c.header("Cache-Control", "no-cache");
      } else {
        c.header("Cache-Control", "public, max-age=31536000, immutable");
      }
      return c.body(content);
    }

    // SPA fallback: serve index.html for unknown paths
    if (!pathname.startsWith("/assets/")) {
      const content = fs.readFileSync(path.join(distPath, "index.html"), "utf-8");
      c.header("Cache-Control", "no-cache");
      return c.html(content);
    }

    return next();
  });
}
