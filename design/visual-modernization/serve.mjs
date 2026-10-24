#!/usr/bin/env node
/**
 * Static preview server for the ODM visual modernization mockup.
 *
 * Mockup-only tooling. Not part of the application build and not referenced by
 * any production code path.
 *
 * Usage:
 *   node design/visual-modernization/serve.mjs [port]
 *   PORT=4390 node design/visual-modernization/serve.mjs
 *
 * Then open http://127.0.0.1:<port>/
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 4390);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  const filePath = normalize(join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden");
    return;
  }

  try {
    const info = await stat(filePath);
    const target = info.isDirectory() ? join(filePath, "index.html") : filePath;
    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": TYPES[extname(target)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end(`not found: ${pathname}\n\nTry /index.html`);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mockup] serving ${ROOT}`);
  console.log(`[mockup] http://127.0.0.1:${PORT}/`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[mockup] port ${PORT} is already in use — pass another port:`);
    console.error(`[mockup]   node design/visual-modernization/serve.mjs 4391`);
  } else {
    console.error("[mockup] server error:", err.message);
  }
  process.exit(1);
});
