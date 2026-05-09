import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

export function serveStaticFiles(app: App) {
  // Resolve from this file's location: api/lib/ → ../../ = project root
  const distPath = path.resolve(import.meta.dirname, "../../dist/public");
  // Compute relative path from cwd for serveStatic
  const staticRoot = path.relative(process.cwd(), distPath) || ".";

  app.use("*", serveStatic({ root: staticRoot }));

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
      return c.json({ error: "index.html not found", distPath, cwd: process.cwd() }, 500);
    }
  });
}
