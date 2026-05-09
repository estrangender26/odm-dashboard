import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

export function serveStaticFiles(app: App) {
  // Resolve dist/public from project root (api/lib → ../../ = project root)
  const distPath = path.resolve(import.meta.dirname, "../../dist/public");
  // Relative path from cwd for serveStatic
  const staticRoot = path.relative(process.cwd(), distPath) || ".";

  app.use("*", serveStatic({ root: staticRoot }));

  app.notFound((c) => {
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) {
      return c.json({ error: "Not Found" }, 404);
    }
    const indexPath = path.resolve(distPath, "index.html");
    const content = fs.readFileSync(indexPath, "utf-8");
    // Prevent browser caching of index.html so new builds load fresh assets
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");
    c.header("Pragma", "no-cache");
    c.header("Expires", "0");
    return c.html(content);
  });
}
