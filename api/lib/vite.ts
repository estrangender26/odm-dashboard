import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

export function serveStaticFiles(app: App) {
  const distPath = path.resolve(import.meta.dirname, "../dist/public");
  // Debug: log paths on first request
  let logged = false;

  app.use("*", (c, next) => {
    if (!logged) {
      console.log("[VITE] import.meta.dirname:", import.meta.dirname);
      console.log("[VITE] distPath:", distPath);
      console.log("[VITE] cwd:", process.cwd());
      console.log("[VITE] dist exists:", fs.existsSync(distPath));
      console.log("[VITE] index exists:", fs.existsSync(path.join(distPath, "index.html")));
      logged = true;
    }
    return next();
  });

  app.use("*", serveStatic({ root: "./dist/public" }));

  app.notFound((c) => {
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) {
      return c.json({ error: "Not Found" }, 404);
    }
    try {
      const indexPath = path.resolve(distPath, "index.html");
      const content = fs.readFileSync(indexPath, "utf-8");
      return c.html(content);
    } catch (err) {
      console.error("[VITE] Error serving index.html:", err);
      return c.json({ error: "Server config error", detail: String(err), distPath }, 500);
    }
  });
}
