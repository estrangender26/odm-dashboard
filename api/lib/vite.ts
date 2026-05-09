import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

type App = Hono<{ Bindings: HttpBindings }>;

// Resolve __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function serveStaticFiles(app: App) {
  // Resolve from this file's location (api/lib/ → ../../dist/public = project-root/dist/public)
  const distPath = path.resolve(__dirname, "../../dist/public");
  const staticRoot = path.relative(process.cwd(), distPath) || ".";

  console.log("[VITE] __dirname:", __dirname);
  console.log("[VITE] distPath:", distPath);
  console.log("[VITE] cwd:", process.cwd());
  console.log("[VITE] staticRoot:", staticRoot);
  console.log("[VITE] dist exists:", fs.existsSync(distPath));
  console.log("[VITE] index.html exists:", fs.existsSync(path.join(distPath, "index.html")));

  // Serve static files with explicit root
  app.use("*", serveStatic({ root: staticRoot }));

  // SPA fallback: serve index.html for all non-API, non-asset routes
  app.notFound((c) => {
    const accept = c.req.header("accept") ?? "";
    const pathname = new URL(c.req.url).pathname;
    // Don't serve HTML for API routes or known asset extensions
    if (pathname.startsWith("/api/") || pathname.startsWith("/trpc")) {
      return c.json({ error: "Not Found" }, 404);
    }
    try {
      const indexPath = path.resolve(distPath, "index.html");
      const content = fs.readFileSync(indexPath, "utf-8");
      c.header("Cache-Control", "no-cache, no-store, must-revalidate");
      return c.html(content);
    } catch (err) {
      console.error("[VITE] Error serving index.html:", err);
      return c.json({ error: "index.html not found", distPath, cwd: process.cwd(), staticRoot }, 500);
    }
  });
}
