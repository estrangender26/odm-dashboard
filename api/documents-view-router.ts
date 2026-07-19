import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { docFiles } from "../db/schema";
import { sanitizeFilename } from "./lib/filename-sanitizer";

// Dependencies interface for testability
export interface DocumentsViewDependencies {
  getDb: () => {
    select: any;
    execute: any;
  };
  getParsedDocumentFile: (id: number) => Promise<{
    fileName: string;
    parsed: {
      buffer: Buffer;
      mimeType: string;
    } | null;
  } | null>;
  parseRangeHeader: (range: string | undefined, totalSize: number) =>
    | { start: number; end: number }
    | "invalid"
    | null;
  consoleError: (message: string) => void;
}

// Default implementations
function defaultParseRangeHeader(
  range: string | undefined,
  totalSize: number
): { start: number; end: number } | "invalid" | null {
  if (!range) return null;
  const match = range.match(/^bytes=(\d+)-(\d*)$/);
  if (!match) return "invalid";
  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
  if (start > end || start >= totalSize || end >= totalSize) return "invalid";
  return { start, end };
}

export function createDocumentsViewRouter(deps: DocumentsViewDependencies) {
  const router = new Hono();

  // GET /:id/view - stream O&M Manual Library files inline for same-origin previews (public access)
  router.get("/:id/view", async (c) => {
    try {
      const id = Number.parseInt(c.req.param("id"), 10);
      if (Number.isNaN(id)) return c.json({ error: "Invalid file ID" }, 400);

      const storageRows = await deps.getDb()
        .select({ storagePath: docFiles.storagePath })
        .from(docFiles)
        .where(eq(docFiles.id, id))
        .limit(1);

      // Redirect to storage if file is stored in Supabase
      if (storageRows[0]?.storagePath) {
        return c.redirect(`/api/storage/files/doc_files/${id}/view`, 302);
      }

      const loaded = await deps.getParsedDocumentFile(id);
      if (!loaded) return c.json({ error: "File not found" }, 404);

      const { fileName, parsed } = loaded;
      if (!parsed) return c.json({ error: "No previewable file data" }, 404);

      const totalSize = parsed.buffer.length;
      const range = c.req.header("range");
      c.header("Content-Type", parsed.mimeType);
      c.header("Content-Disposition", `inline; filename="${sanitizeFilename(fileName)}"`);
      c.header("Cache-Control", "private, max-age=300");
      c.header("X-Content-Type-Options", "nosniff");
      c.header("Accept-Ranges", "bytes");

      if (parsed.mimeType.startsWith("text/html") || parsed.mimeType === "application/xhtml+xml") {
        c.header("Content-Security-Policy", "sandbox");
      }

      const parsedRange = deps.parseRangeHeader(range, totalSize);
      if (parsedRange === "invalid") {
        c.status(416);
        c.header("Content-Range", `bytes */${totalSize}`);
        c.header("Content-Length", "0");
        return c.body("");
      }

      if (parsedRange) {
        const { start, end } = parsedRange;
        const chunk = parsed.buffer.subarray(start, end + 1);
        c.status(206);
        c.header("Content-Range", `bytes ${start}-${end}/${totalSize}`);
        c.header("Content-Length", String(chunk.length));
        return c.body(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer);
      }

      c.header("Content-Length", String(totalSize));
      return c.body(parsed.buffer.buffer.slice(parsed.buffer.byteOffset, parsed.buffer.byteOffset + parsed.buffer.byteLength) as ArrayBuffer);
    } catch (e: any) {
      deps.consoleError("[documents/view] Error: file access failed");
      return c.json({ error: "Unable to access file." }, 500);
    }
  });

  // GET /:id/download - download O&M Manual Library files only when requested (public access)
  router.get("/:id/download", async (c) => {
    try {
      const id = Number.parseInt(c.req.param("id"), 10);
      if (Number.isNaN(id)) return c.json({ error: "Invalid file ID" }, 400);

      const storageRows = await deps.getDb()
        .select({ storagePath: docFiles.storagePath })
        .from(docFiles)
        .where(eq(docFiles.id, id))
        .limit(1);

      // Redirect to storage if file is stored in Supabase
      if (storageRows[0]?.storagePath) {
        return c.redirect(`/api/storage/files/doc_files/${id}/download`, 302);
      }

      const loaded = await deps.getParsedDocumentFile(id);
      if (!loaded) return c.json({ error: "File not found" }, 404);

      const { fileName, parsed } = loaded;
      if (!parsed) return c.json({ error: "No file data" }, 404);

      c.header("Content-Type", parsed.mimeType);
      c.header("Content-Disposition", `attachment; filename="${sanitizeFilename(fileName)}"`);
      c.header("Content-Length", String(parsed.buffer.length));
      c.header("Cache-Control", "private, max-age=300");
      c.header("X-Content-Type-Options", "nosniff");

      return c.body(parsed.buffer.buffer.slice(parsed.buffer.byteOffset, parsed.buffer.byteOffset + parsed.buffer.byteLength) as ArrayBuffer);
    } catch (e: any) {
      deps.consoleError("[documents/download] Error: file access failed");
      return c.json({ error: "Unable to access file." }, 500);
    }
  });

  return router;
}

// Default router instance with production dependencies
export function createDefaultDocumentsViewRouter(
  getDb: DocumentsViewDependencies["getDb"],
  getParsedDocumentFile: DocumentsViewDependencies["getParsedDocumentFile"]
) {
  return createDocumentsViewRouter({
    getDb,
    getParsedDocumentFile,
    parseRangeHeader: defaultParseRangeHeader,
    consoleError: console.error.bind(console),
  });
}
