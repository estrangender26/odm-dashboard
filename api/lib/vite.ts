import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

// Resolve dist path from project root (works in dev, build, and Render)
const projectRoot = path.resolve(import.meta.dirname, "../../");
const distPath = path.resolve(projectRoot, "dist/public");

export function serveStaticFiles(app: App) {
  // Use absolute path for serveStatic so it works regardless of cwd
  const staticRoot = path.relative(process.cwd(), distPath) || ".";
  app.use("*", serveStatic({ root: staticRoot }));

  app.notFound((c) => {
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) {
      return c.json({ error: "Not Found" }, 404);
    }
    const indexPath = path.resolve(distPath, "index.html");
    const content = fs.readFileSync(indexPath, "utf-8");
    return c.html(content);
  });
}
