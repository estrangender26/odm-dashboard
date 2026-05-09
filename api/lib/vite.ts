import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

export function serveStaticFiles(app: App) {
  // import.meta.dirname resolves to dist/ after build (next to boot.js)
  // So ../dist/public from dist/ = dist/public (correct!)
  const distPath = path.resolve(import.meta.dirname, "../dist/public");

  console.log("[VITE] import.meta.dirname:", import.meta.dirname);
  console.log("[VITE] distPath:", distPath);
  console.log("[VITE] cwd:", process.cwd());
  console.log("[VITE] exists:", fs.existsSync(path.join(distPath, "index.html")));

  if (!fs.existsSync(path.join(distPath, "index.html"))) {
    console.error("[VITE] CRITICAL: index.html not found at", distPath);
    app.get("/", (c) => c.json({ error: "Frontend build not found", distPath }, 500));
    return;
  }

  // serveStatic needs a relative path from cwd
  const staticRoot = path.relative(process.cwd(), distPath) || ".";
  console.log("[VITE] staticRoot:", staticRoot);

  app.use("*", serveStatic({ root: staticRoot }));

  // SPA fallback for React Router
  app.notFound((c) => {
    const pathname = new URL(c.req.url).pathname;
    if (pathname.startsWith("/api/") || pathname.startsWith("/trpc")) {
      return c.json({ error: "Not Found" }, 404);
    }
    const content = fs.readFileSync(path.join(distPath, "index.html"), "utf-8");
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");
    return c.html(content);
  });
}
