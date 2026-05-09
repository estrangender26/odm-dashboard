import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

type App = Hono<{ Bindings: HttpBindings }>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try multiple possible locations for dist/public
function findDistPublic(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "dist/public"),      // cwd/dist/public
    path.resolve(__dirname, "../public"),             // dist/public (boot.js in dist/)
    path.resolve(__dirname, "../../dist/public"),     // project-root/dist/public
    path.resolve(__dirname, "../dist/public"),        // fallback
  ];
  for (const p of candidates) {
    if (fs.existsSync(path.join(p, "index.html"))) {
      console.log("[VITE] Found dist/public at:", p);
      return p;
    }
  }
  // Log what we checked
  console.error("[VITE] Could not find dist/public. Checked:");
  for (const p of candidates) {
    console.error("  -", p, "(exists:", fs.existsSync(p), ")");
  }
  return null;
}

export function serveStaticFiles(app: App) {
  const distPath = findDistPublic();

  if (!distPath) {
    console.error("[VITE] CRITICAL: dist/public not found. Static files will not be served.");
    app.get("/", (c) => c.json({ error: "Frontend build not found. Run npm run build." }, 500));
    return;
  }

  const staticRoot = path.relative(process.cwd(), distPath) || ".";
  console.log("[VITE] staticRoot:", staticRoot);
  console.log("[VITE] cwd:", process.cwd());

  app.use("*", serveStatic({ root: staticRoot }));

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
