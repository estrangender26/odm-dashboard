import { Hono } from "hono";
import { eq, and, isNull, desc } from "drizzle-orm";
import { db } from "./queries/connection";
import { presentationFiles } from "../db/schema";

const router = new Hono();

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

async function sha256Buffer(buffer: Buffer): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(buffer).digest("hex");
}

function sanitizeFileName(value: string): string {
  return value.replace(/[\r\n"]/g, "_");
}

function validateDisplayName(value: string): { valid: boolean; error?: string } {
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, error: "Display name cannot be blank." };
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return { valid: false, error: "Display name cannot contain paths." };
  }
  if (!trimmed.toLowerCase().endsWith(".pptx")) {
    return { valid: false, error: "Display name must keep the .pptx extension." };
  }
  return { valid: true };
}

function isPptxContent(buffer: Buffer, declaredMime?: string, fileName?: string): boolean {
  // PPTX files are ZIP archives and start with "PK"
  if (buffer.length < 2) return false;
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false;

  const name = fileName?.toLowerCase() ?? "";
  if (name && !name.endsWith(".pptx")) return false;

  if (declaredMime && declaredMime !== PPTX_MIME && declaredMime !== "application/octet-stream") {
    return false;
  }
  return true;
}

function rowToMetadata(row: typeof presentationFiles.$inferSelect) {
  return {
    id: row.id,
    fileName: row.fileName,
    displayName: row.displayName,
    title: row.title ?? row.displayName,
    version: row.version ?? "1.0",
    fileType: row.fileType,
    mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes,
    sha256Hash: row.sha256Hash,
    fileCategory: row.fileCategory,
    generatorId: row.generatorId,
    generatorName: row.generatorName,
    template: row.template,
    scopeJson: row.scopeJson,
    originalFileUrl: row.originalFileUrl ?? `/api/presentation-files/${row.id}/download`,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

// GET /api/presentation-files
router.get("/", async (c) => {
  try {
    const query = c.req.query();
    const category = query.file_category;
    const generatorId = query.generator_id;
    const includeDeleted = query.include_deleted === "true";

    const conditions = [];
    if (!includeDeleted) {
      conditions.push(isNull(presentationFiles.deletedAt));
    }
    if (category) {
      conditions.push(eq(presentationFiles.fileCategory, category));
    }
    if (generatorId) {
      conditions.push(eq(presentationFiles.generatorId, generatorId));
    }

    const rows = await db
      .select()
      .from(presentationFiles)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(presentationFiles.createdAt));

    return c.json({ files: rows.map(rowToMetadata) });
  } catch (error) {
    console.error("[PresentationFiles] list failed", error);
    return c.json({ error: "Failed to list presentation files." }, 500);
  }
});

// POST /api/presentation-files/upload
router.post("/upload", async (c) => {
  try {
    const body = await c.req.parseBody({ all: false });
    const file = body.file;
    const fileCategory = String(body.file_category || "uploaded_deck");
    const uploadedBy = String(body.uploaded_by || "ODM User");
    const title = String(body.title || "").trim() || undefined;
    const version = String(body.version || "").trim() || "1.0";

    if (!(file instanceof File)) {
      return c.json({ error: "No file provided." }, 400);
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return c.json(
        { error: "File is too large. Maximum upload size is 50 MB." },
        413
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (!isPptxContent(buffer, file.type, file.name)) {
      return c.json(
        { error: "Unsupported file type. Please upload a .pptx PowerPoint file." },
        400
      );
    }

    const base64 = buffer.toString("base64");
    const hash = await sha256Buffer(buffer);
    const now = new Date();

    const inserted = await db
      .insert(presentationFiles)
      .values({
        fileName: file.name,
        displayName: file.name,
        title,
        version,
        fileType: file.type || PPTX_MIME,
        mimeType: PPTX_MIME,
        fileSizeBytes: file.size,
        fileBlob: base64,
        sha256Hash: hash,
        fileCategory,
        uploadedBy,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const fileId = inserted[0].id;
    const originalFileUrl = `/api/presentation-files/${fileId}/download`;
    await db
      .update(presentationFiles)
      .set({ originalFileUrl })
      .where(eq(presentationFiles.id, fileId));

    return c.json({ file: rowToMetadata({ ...inserted[0], originalFileUrl }) }, 201);
  } catch (error) {
    console.error("[PresentationFiles] upload failed", error);
    const message =
      error instanceof Error ? error.message : "Upload failed.";
    return c.json({ error: message }, 500);
  }
});

// GET /api/presentation-files/:id/download
router.get("/:id/download", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) {
      return c.json({ error: "Invalid file id." }, 400);
    }

    const rows = await db
      .select()
      .from(presentationFiles)
      .where(
        and(
          eq(presentationFiles.id, id),
          isNull(presentationFiles.deletedAt)
        )
      )
      .limit(1);

    if (rows.length === 0) {
      return c.json({ error: "File not found." }, 404);
    }

    const row = rows[0];
    const buffer = Buffer.from(row.fileBlob, "base64");
    const fileName = sanitizeFileName(row.displayName || row.fileName);

    c.header("Content-Type", PPTX_MIME);
    c.header(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );
    return c.body(buffer);
  } catch (error) {
    console.error("[PresentationFiles] download failed", error);
    return c.json({ error: "Failed to download file." }, 500);
  }
});

// GET /api/presentation-files/:id/delete-preview
router.get("/:id/delete-preview", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) {
      return c.json({ error: "Invalid file id." }, 400);
    }

    const rows = await db
      .select()
      .from(presentationFiles)
      .where(
        and(
          eq(presentationFiles.id, id),
          isNull(presentationFiles.deletedAt)
        )
      )
      .limit(1);

    if (rows.length === 0) {
      return c.json({ error: "File not found." }, 404);
    }

    const row = rows[0];
    const linkedCount = await db
      .select({ count: presentationFiles.id })
      .from(presentationFiles)
      .where(
        and(
          eq(presentationFiles.sha256Hash, row.sha256Hash),
          isNull(presentationFiles.deletedAt)
        )
      );

    return c.json({
      id: row.id,
      fileName: row.fileName,
      displayName: row.displayName,
      fileType: row.fileType,
      fileSizeBytes: row.fileSizeBytes,
      fileCategory: row.fileCategory,
      uploadedBy: row.uploadedBy,
      createdAt: row.createdAt,
      linkedRecords: linkedCount.length,
      whatWillBeRemoved: "This file will be soft-deleted and hidden from the library.",
      whatWillNotBeRemoved:
        "Other files, generated presentation history, and any database records are not affected.",
    });
  } catch (error) {
    console.error("[PresentationFiles] delete-preview failed", error);
    return c.json({ error: "Failed to build delete preview." }, 500);
  }
});

// DELETE /api/presentation-files/:id
router.delete("/:id", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) {
      return c.json({ error: "Invalid file id." }, 400);
    }

    const rows = await db
      .select()
      .from(presentationFiles)
      .where(eq(presentationFiles.id, id))
      .limit(1);

    if (rows.length === 0) {
      return c.json({ error: "File not found." }, 404);
    }

    await db
      .update(presentationFiles)
      .set({ deletedAt: new Date() })
      .where(eq(presentationFiles.id, id));

    return c.json({ success: true, id });
  } catch (error) {
    console.error("[PresentationFiles] delete failed", error);
    return c.json({ error: "Failed to delete file." }, 500);
  }
});

// PATCH /api/presentation-files/:id
router.patch("/:id", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) {
      return c.json({ error: "Invalid file id." }, 400);
    }

    const body = await c.req.json();
    const displayName = String(body.display_name ?? "");

    const validation = validateDisplayName(displayName);
    if (!validation.valid) {
      return c.json({ error: validation.error }, 400);
    }

    const rows = await db
      .select()
      .from(presentationFiles)
      .where(
        and(
          eq(presentationFiles.id, id),
          isNull(presentationFiles.deletedAt)
        )
      )
      .limit(1);

    if (rows.length === 0) {
      return c.json({ error: "File not found." }, 404);
    }

    const updated = await db
      .update(presentationFiles)
      .set({ displayName, updatedAt: new Date() })
      .where(eq(presentationFiles.id, id))
      .returning();

    return c.json({ file: rowToMetadata(updated[0]) });
  } catch (error) {
    console.error("[PresentationFiles] rename failed", error);
    return c.json({ error: "Failed to rename file." }, 500);
  }
});

// POST /api/presentation-files/:id/replace
router.post("/:id/replace", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) {
      return c.json({ error: "Invalid file id." }, 400);
    }

    const body = await c.req.parseBody({ all: false });
    const file = body.file;
    const keepDisplayName = body.keep_display_name === "true";

    if (!(file instanceof File)) {
      return c.json({ error: "No file provided." }, 400);
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return c.json(
        { error: "File is too large. Maximum upload size is 50 MB." },
        413
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (!isPptxContent(buffer, file.type, file.name)) {
      return c.json(
        { error: "Unsupported file type. Please upload a .pptx PowerPoint file." },
        400
      );
    }

    const existingRows = await db
      .select()
      .from(presentationFiles)
      .where(
        and(
          eq(presentationFiles.id, id),
          isNull(presentationFiles.deletedAt)
        )
      )
      .limit(1);

    if (existingRows.length === 0) {
      return c.json({ error: "File not found." }, 404);
    }

    const existing = existingRows[0];
    const base64 = buffer.toString("base64");
    const hash = await sha256Buffer(buffer);
    const nextDisplayName = keepDisplayName
      ? existing.displayName
      : file.name;
    const originalFileUrl = `/api/presentation-files/${id}/download`;

    const updated = await db
      .update(presentationFiles)
      .set({
        fileName: file.name,
        displayName: nextDisplayName,
        title: existing.title ?? nextDisplayName,
        version: existing.version ?? "1.0",
        fileType: file.type || PPTX_MIME,
        mimeType: PPTX_MIME,
        fileSizeBytes: file.size,
        fileBlob: base64,
        sha256Hash: hash,
        originalFileUrl,
        updatedAt: new Date(),
      })
      .where(eq(presentationFiles.id, id))
      .returning();

    return c.json({ file: rowToMetadata(updated[0]) });
  } catch (error) {
    console.error("[PresentationFiles] replace failed", error);
    return c.json({ error: "Failed to replace file." }, 500);
  }
});

// POST /api/presentation-files/generated
// Upsert a generated deck, keeping the latest logical copy visible.
router.post("/generated", async (c) => {
  try {
    const body = await c.req.json();
    const fileName = String(body.file_name ?? "");
    const displayName = String(body.display_name ?? fileName);
    const title = String(body.title ?? "").trim() || displayName;
    const version = String(body.version ?? "").trim() || "1.0";
    const fileSizeBytes = Number(body.file_size_bytes ?? 0);
    const fileBlob = String(body.file_blob ?? "");
    const sha256Hash = String(body.sha256_hash ?? "");
    const generatorId = body.generator_id ? String(body.generator_id) : null;
    const generatorName = body.generator_name ? String(body.generator_name) : null;
    const template = body.template ? String(body.template) : null;
    const scopeJson = body.scope_json ? JSON.stringify(body.scope_json) : null;
    const uploadedBy = String(body.uploaded_by || "ODM User");

    if (!fileName || !fileBlob || !sha256Hash) {
      console.error("[PresentationFiles] generated upsert validation failed", { fileName: Boolean(fileName), fileBlob: Boolean(fileBlob), sha256Hash: Boolean(sha256Hash) });
      return c.json({ error: "file_name, file_blob, and sha256_hash are required." }, 400);
    }

    // Look for an existing generated deck with the same logical key
    const existing = await db
      .select()
      .from(presentationFiles)
      .where(
        and(
          eq(presentationFiles.fileCategory, "generated_deck"),
          generatorId ? eq(presentationFiles.generatorId, generatorId) : isNull(presentationFiles.generatorId),
          eq(presentationFiles.fileName, fileName),
          template ? eq(presentationFiles.template, template) : isNull(presentationFiles.template),
          isNull(presentationFiles.deletedAt)
        )
      )
      .limit(1);

    const now = new Date();
    if (existing.length > 0) {
      const updated = await db
        .update(presentationFiles)
        .set({
          displayName,
          title,
          version,
          fileSizeBytes,
          fileBlob,
          sha256Hash,
          scopeJson,
          uploadedBy,
          updatedAt: now,
        })
        .where(eq(presentationFiles.id, existing[0].id))
        .returning();
      return c.json({ file: rowToMetadata(updated[0]) });
    }

    const inserted = await db
      .insert(presentationFiles)
      .values({
        fileName,
        displayName,
        title,
        version,
        fileType: PPTX_MIME,
        mimeType: PPTX_MIME,
        fileSizeBytes,
        fileBlob,
        sha256Hash,
        fileCategory: "generated_deck",
        generatorId,
        generatorName,
        template,
        scopeJson,
        uploadedBy,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const genId = inserted[0].id;
    const genOriginalFileUrl = `/api/presentation-files/${genId}/download`;
    await db
      .update(presentationFiles)
      .set({ originalFileUrl: genOriginalFileUrl })
      .where(eq(presentationFiles.id, genId));

    return c.json({ file: rowToMetadata({ ...inserted[0], originalFileUrl: genOriginalFileUrl }) }, 201);
  } catch (error) {
    console.error("[PresentationFiles] generated upsert failed", error);
    return c.json({ error: "Failed to save generated deck." }, 500);
  }
});

export { router as presentationFilesRouter };
