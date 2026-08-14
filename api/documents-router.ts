import { z } from "zod";
import { eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { readFile, stat } from "node:fs/promises";
import { db } from "./queries/connection";
import { docFolders, docFiles } from "@db/schema";
import { authedQuery, publicQuery } from "./middleware";
import { getSupabaseStorageAdmin } from "./supabase-storage";
import { TRPCError } from "@trpc/server";
import {
  MAX_UPLOAD_ERROR_MESSAGE,
  MAX_UPLOAD_FILE_SIZE_BYTES,
  isBase64UploadSizeAllowed,
  isUploadFileSizeAllowed,
} from "@contracts/upload-limits";
import {
  cleanupDocumentMultipartUpload,
  DocumentMultipartUploadError,
  parseDocumentMultipartUpload,
  type ParsedDocumentMultipartUpload,
} from "./document-multipart-upload";

// ── Multipart upload router for O&M Manuals Library ──
// The shared guard in api/boot.ts applies the multipart transport cap before this router.

export const documentsUploadRouter = new Hono();

const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "png", "jpg", "jpeg", "gif", "svg", "webp",
  "txt", "csv", "json", "zip",
  "html", "htm", "xhtml",
]);

const DOC_FILE_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  zip: "application/zip",
  html: "text/html",
  htm: "text/html",
  xhtml: "application/xhtml+xml",
};

function inferDocumentMimeType(fileName: string, declaredMimeType?: string | null): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const typeFromExtension = ext ? DOC_FILE_MIME_TYPES[ext] : undefined;
  const typeFromFile = declaredMimeType?.trim();
  if (typeFromExtension === "application/pdf") return typeFromExtension;
  return typeFromFile && typeFromFile !== "application/octet-stream"
    ? typeFromFile
    : typeFromExtension || "application/octet-stream";
}

function sanitizeDocumentFileName(value: string): string {
  return value.replace(/[\r\n"]/g, "_").replace(/\\/g, "/");
}

documentsUploadRouter.post("/upload", async (c) => {
  const uploadId = Math.random().toString(36).slice(2, 10);
  const contentLength = c.req.header("content-length") || "unknown";
  let upload: ParsedDocumentMultipartUpload | undefined;

  console.log(`[documents/upload:${uploadId}] start content-length=${contentLength}`);

  try {
    // Anonymous uploads supported - no authentication required
    upload = await parseDocumentMultipartUpload(c.req.raw);

    if (c.req.raw.signal.aborted) {
      throw new DocumentMultipartUploadError("Upload cancelled.", 400);
    }

    console.log(
      `[documents/upload:${uploadId}] streamed file name="${upload.fileName}" type="${upload.fileType}" size=${upload.fileSize}`
    );

    if (!isUploadFileSizeAllowed(upload.fileSize)) {
      console.warn(
        `[documents/upload:${uploadId}] rejected oversized file: ${upload.fileSize} bytes exceeds ${MAX_UPLOAD_FILE_SIZE_BYTES} bytes`
      );
      return c.json({ error: MAX_UPLOAD_ERROR_MESSAGE }, 413);
    }

    const fileName = sanitizeDocumentFileName(upload.fileName);
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (!ext || !ALLOWED_DOCUMENT_EXTENSIONS.has(ext)) {
      return c.json(
        { error: `Unsupported file type: ${ext ? `.${ext}` : "none"}. Allowed: PDF, Word, Excel, PowerPoint, images, text/CSV/JSON, ZIP, HTML, HTM, XHTML.` },
        400
      );
    }

    const folderIdRaw = upload.fields.folderId;
    const folderId = Number(folderIdRaw);
    if (!Number.isInteger(folderId) || folderId <= 0) {
      return c.json({ error: "A valid target folder is required." }, 400);
    }

    const folderRows = await db
      .select({ id: docFolders.id })
      .from(docFolders)
      .where(eq(docFolders.id, folderId))
      .limit(1);
    if (!folderRows.length) {
      return c.json({ error: "Target folder not found." }, 404);
    }

    const fileStat = await stat(upload.tempFilePath);
    if (
      fileStat.size !== upload.fileSize
      || !isUploadFileSizeAllowed(fileStat.size)
    ) {
      return c.json({ error: MAX_UPLOAD_ERROR_MESSAGE }, 413);
    }

    let buffer: Buffer | undefined = await readFile(upload.tempFilePath);
    if (!isUploadFileSizeAllowed(buffer.byteLength)) {
      return c.json({ error: MAX_UPLOAD_ERROR_MESSAGE }, 413);
    }
    let base64: string | undefined = buffer.toString("base64");
    buffer = undefined;

    if (c.req.raw.signal.aborted) {
      throw new DocumentMultipartUploadError("Upload cancelled.", 400);
    }

    const title = String(upload.fields.title || fileName.replace(/\.[^.]+$/, "")).trim();
    const uploadedBy = String(upload.fields.uploadedBy || "User").trim() || "User";
    const description = String(upload.fields.description || "").trim() || null;
    const revision = String(upload.fields.revision || "").trim() || null;
    const tags = String(upload.fields.tags || "").trim() || null;
    const fileType = inferDocumentMimeType(fileName, upload.fileType);
    const now = new Date();

    const inserted = await db.insert(docFiles).values({
      folderId,
      title,
      fileName,
      fileType,
      fileSize: upload.fileSize,
      fileData: base64,
      fileUrl: null,
      description,
      revision,
      tags,
      uploadedBy,
      uploadedAt: now,
      updatedAt: now,
    }).returning({
      id: docFiles.id,
      folderId: docFiles.folderId,
      title: docFiles.title,
      fileName: docFiles.fileName,
      fileType: docFiles.fileType,
      fileSize: docFiles.fileSize,
      fileUrl: docFiles.fileUrl,
      description: docFiles.description,
      revision: docFiles.revision,
      tags: docFiles.tags,
      uploadedBy: docFiles.uploadedBy,
      uploadedAt: docFiles.uploadedAt,
      updatedAt: docFiles.updatedAt,
    });
    base64 = undefined;

    console.log(`[documents/upload:${uploadId}] success id=${inserted[0].id} size=${upload.fileSize}`);
    return c.json({ file: { ...inserted[0], hasFileData: true } }, 201);
  } catch (error: unknown) {
    if (error instanceof DocumentMultipartUploadError) {
      console.warn(`[documents/upload:${uploadId}] rejected:`, error.message);
      return c.json({ error: error.message }, error.status);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[documents/upload:${uploadId}] failed:`, message);
    return c.json({ error: "Failed to upload file." }, 500);
  } finally {
    await cleanupDocumentMultipartUpload(upload).catch((cleanupError) => {
      console.error(`[documents/upload:${uploadId}] temporary file cleanup failed:`, cleanupError);
    });
  }
});

// ── Types ──
interface TreeFolder {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder: number;
  childFolderCount: number;
  fileCount: number;
  hasChildren: boolean;
  children: TreeFolder[];
  files: TreeFileSummary[];
}

interface TreeFolderSummary {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder: number;
  childFolderCount: number;
  fileCount: number;
  hasChildren: boolean;
  children: TreeFolder[];
  files: TreeFileSummary[];
}

interface TreeFileSummary {
  id: number;
  title: string;
  fileName: string;
  fileType: string | null;
  fileSize: number | null;
  revision: string | null;
  uploadedAt: Date | null;
  hasFileData: boolean;
  storageBacked: boolean;
  fileUrl: string | null;
}
function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type TreeFileRow = Pick<typeof docFiles.$inferSelect, "id" | "folderId" | "title" | "fileName" | "fileType" | "fileSize" | "revision" | "uploadedAt" | "fileUrl"> & { hasFileData: boolean; storageBacked: boolean };

// ── Helpers: hierarchy validation and recursive tree safety ──
function normalizeFolderName(name: string): string {
  return name.trim();
}

function getFolderById(allFolders: typeof docFolders.$inferSelect[], folderId: number) {
  return allFolders.find((folder) => folder.id === folderId) ?? null;
}

function getSafeParentId(
  folder: typeof docFolders.$inferSelect,
  folderById: Map<number, typeof docFolders.$inferSelect>
): number | null {
  if (folder.parentId === null) return null;
  if (folder.parentId === folder.id) return null;
  if (!folderById.has(folder.parentId)) return null;

  const seen = new Set<number>([folder.id]);
  let currentParentId: number | null = folder.parentId;
  while (currentParentId !== null) {
    if (seen.has(currentParentId)) return null;
    seen.add(currentParentId);
    const parent = folderById.get(currentParentId);
    if (!parent) return null;
    currentParentId = parent.parentId;
  }

  return folder.parentId;
}

// ── Helper: build recursive tree ──
function buildTree(
  allFolders: typeof docFolders.$inferSelect[],
  allFiles: TreeFileRow[],
  parentId: number | null = null
): TreeFolder[] {
  const folderById = new Map(allFolders.map((folder) => [folder.id, folder] as const));
  const safeParentByFolderId = new Map<number, number | null>();
  for (const folder of allFolders) {
    safeParentByFolderId.set(folder.id, getSafeParentId(folder, folderById));
  }

  const folderChildrenByParentId = new Map<number | null, typeof docFolders.$inferSelect[]>();
  for (const folder of allFolders) {
    const safeParentId = safeParentByFolderId.get(folder.id) ?? null;
    if (!folderChildrenByParentId.has(safeParentId)) folderChildrenByParentId.set(safeParentId, []);
    folderChildrenByParentId.get(safeParentId)!.push(folder);
  }

  const filesByFolderId = new Map<number, TreeFileRow[]>();
  for (const file of allFiles) {
    if (!folderById.has(file.folderId)) {
      console.warn(`[docTree] Skipping orphan file id=${file.id}; missing folderId=${file.folderId}`);
      continue;
    }
    if (!filesByFolderId.has(file.folderId)) filesByFolderId.set(file.folderId, []);
    filesByFolderId.get(file.folderId)!.push(file);
  }

  function walk(currentParentId: number | null, visited: Set<number>): TreeFolder[] {
    const folders = folderChildrenByParentId.get(currentParentId) ?? [];
    folders.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
    return folders.flatMap((folder) => {
      if (visited.has(folder.id)) {
        console.warn(`[docTree] Skipping cyclic folder id=${folder.id}`);
        return [];
      }

      const nextVisited = new Set(visited);
      nextVisited.add(folder.id);
      return [{
        id: folder.id,
        name: folder.name,
        parentId: safeParentByFolderId.get(folder.id) ?? null,
        sortOrder: folder.sortOrder ?? 0,
        childFolderCount: folderChildrenByParentId.get(folder.id)?.length ?? 0,
        fileCount: filesByFolderId.get(folder.id)?.length ?? 0,
        hasChildren: (folderChildrenByParentId.get(folder.id)?.length ?? 0) > 0 || (filesByFolderId.get(folder.id)?.length ?? 0) > 0,
        children: walk(folder.id, nextVisited),
        files: (filesByFolderId.get(folder.id) ?? []).map((file) => ({
          id: file.id,
          title: file.title,
          fileName: file.fileName,
          fileType: file.fileType,
          fileSize: file.fileSize,
          revision: file.revision,
          uploadedAt: file.uploadedAt,
          hasFileData: file.hasFileData,
          storageBacked: file.storageBacked,
          fileUrl: file.fileUrl,
        })),
      }];
    });
  }

  return walk(parentId, new Set<number>());
}

async function getDocumentStats() {
  const [folderCountRows, fileCountRows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(docFolders),
    db.select({ count: sql<number>`count(*)::int` }).from(docFiles),
  ]);

  return {
    folders: Number(folderCountRows[0]?.count ?? 0),
    files: Number(fileCountRows[0]?.count ?? 0),
  };
}

async function getDirectFolderContents(parentId: number | null) {
  const folderWhere = parentId === null ? isNull(docFolders.parentId) : eq(docFolders.parentId, parentId);

  const folders = await db
    .select({
      id: docFolders.id,
      name: docFolders.name,
      parentId: docFolders.parentId,
      sortOrder: docFolders.sortOrder,
    })
    .from(docFolders)
    .where(folderWhere)
    .orderBy(docFolders.sortOrder, docFolders.name);

  const folderIds = folders.map((folder) => folder.id);

  const [childFolderCounts, fileCounts, files] = await Promise.all([
    folderIds.length > 0
      ? db
          .select({ parentId: docFolders.parentId, count: sql<number>`count(*)::int` })
          .from(docFolders)
          .where(inArray(docFolders.parentId, folderIds))
          .groupBy(docFolders.parentId)
      : Promise.resolve([]),
    folderIds.length > 0
      ? db
          .select({ folderId: docFiles.folderId, count: sql<number>`count(*)::int` })
          .from(docFiles)
          .where(inArray(docFiles.folderId, folderIds))
          .groupBy(docFiles.folderId)
      : Promise.resolve([]),
    parentId !== null
      ? db
          .select({
            id: docFiles.id,
            folderId: docFiles.folderId,
            title: docFiles.title,
            fileName: docFiles.fileName,
            fileType: docFiles.fileType,
            fileSize: docFiles.fileSize,
            revision: docFiles.revision,
            uploadedAt: docFiles.uploadedAt,
            hasFileData: sql<boolean>`COALESCE(length(${docFiles.fileData}), 0) > 0 OR ${docFiles.storagePath} IS NOT NULL`,
            storageBacked: sql<boolean>`${docFiles.storagePath} IS NOT NULL`,
            fileUrl: docFiles.fileUrl,
          })
          .from(docFiles)
          .where(eq(docFiles.folderId, parentId))
      : Promise.resolve([]),
  ]);

  const childFolderCountByParentId = new Map(childFolderCounts.map((row) => [row.parentId, Number(row.count)] as const));
  const fileCountByFolderId = new Map(fileCounts.map((row) => [row.folderId, Number(row.count)] as const));

  const folderSummaries: TreeFolderSummary[] = folders.map((folder) => {
    const childFolderCount = childFolderCountByParentId.get(folder.id) ?? 0;
    const fileCount = fileCountByFolderId.get(folder.id) ?? 0;
    return {
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      sortOrder: folder.sortOrder ?? 0,
      childFolderCount,
      fileCount,
      hasChildren: childFolderCount > 0 || fileCount > 0,
      children: [],
      files: [],
    };
  });

  const fileSummaries: TreeFileSummary[] = files.map((file) => ({
    id: file.id,
    title: file.title,
    fileName: file.fileName,
    fileType: file.fileType,
    fileSize: file.fileSize,
    revision: file.revision,
    uploadedAt: file.uploadedAt,
    hasFileData: file.hasFileData,
    storageBacked: file.storageBacked,
    fileUrl: file.fileUrl,
  }));

  return { parentId, folders: folderSummaries, files: fileSummaries };
}

// ── Helper: collect all descendant IDs safely (for move/delete validation) ──
function getDescendantIds(allFolders: typeof docFolders.$inferSelect[], folderId: number): number[] {
  const childrenByParentId = new Map<number, number[]>();
  for (const folder of allFolders) {
    if (folder.parentId === null) continue;
    if (!childrenByParentId.has(folder.parentId)) childrenByParentId.set(folder.parentId, []);
    childrenByParentId.get(folder.parentId)!.push(folder.id);
  }

  const descendants: number[] = [];
  const visited = new Set<number>([folderId]);
  const stack = [...(childrenByParentId.get(folderId) ?? [])];

  while (stack.length > 0) {
    const childId = stack.pop()!;
    if (visited.has(childId)) continue;
    visited.add(childId);
    descendants.push(childId);
    stack.push(...(childrenByParentId.get(childId) ?? []));
  }

  return descendants;
}

async function loadFoldersForValidation() {
  return db.select().from(docFolders);
}

async function assertFolderExists(folderId: number, message = "Folder not found") {
  const rows = await db.select({ id: docFolders.id }).from(docFolders).where(eq(docFolders.id, folderId));
  if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message });
}

async function assertFileExists(fileId: number, message = "File not found") {
  const rows = await db.select({ id: docFiles.id }).from(docFiles).where(eq(docFiles.id, fileId));
  if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message });
}

function validateFolderParent(
  allFolders: typeof docFolders.$inferSelect[],
  folderId: number | null,
  parentId: number | null
) {
  if (parentId === null) return;
  const parent = getFolderById(allFolders, parentId);
  if (!parent) throw new TRPCError({ code: "BAD_REQUEST", message: "Parent folder not found" });
  if (folderId !== null && parentId === folderId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot make a folder its own parent" });
  }
  if (folderId !== null && getDescendantIds(allFolders, folderId).includes(parentId)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot move a folder into its own descendant" });
  }
}

// ═══════════════════════════════════════════════════════════
// FOLDER ROUTER
// ═══════════════════════════════════════════════════════════

export const documentsRouter = {
  getAiContext: publicQuery
    .input(z.object({
      facilityType: z.enum(["WTP", "WWTP", "WPS", "WWLS"]).optional(),
      includeSample: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      const [allFolders, allFiles] = await Promise.all([
        db.select().from(docFolders),
        db.select({
          id: docFiles.id,
          folderId: docFiles.folderId,
          title: docFiles.title,
          fileName: docFiles.fileName,
          fileType: docFiles.fileType,
          revision: docFiles.revision,
          uploadedBy: docFiles.uploadedBy,
          uploadedAt: docFiles.uploadedAt,
          description: docFiles.description,
          tags: docFiles.tags,
        }).from(docFiles),
      ]);

      const folderById = new Map(allFolders.map((f) => [f.id, f] as const));
      const safeParentByFolderId = new Map(allFolders.map((f) => [f.id, getSafeParentId(f, folderById)] as const));
      const buildPath = (folderId: number) => {
        const parts: string[] = [];
        let curr = folderById.get(folderId) || null;
        const visited = new Set<number>();
        while (curr) {
          if (visited.has(curr.id)) break;
          visited.add(curr.id);
          parts.unshift(curr.name);
          const safeParentId = safeParentByFolderId.get(curr.id) ?? null;
          curr = safeParentId !== null ? (folderById.get(safeParentId) || null) : null;
        }
        return parts;
      };

      const withPath = allFiles.map((f) => {
        const path = buildPath(f.folderId);
        const fullPath = path.join(" / ");
        const searchable = `${fullPath} ${f.title} ${f.fileName} ${f.tags || ""} ${f.description || ""}`.toLowerCase();
        const inferredFacilityType = (["WWTP", "WWLS", "WTP", "WPS"] as const).find((t) => searchable.includes(t.toLowerCase())) || null;
        return { ...f, path, fullPath, inferredFacilityType };
      });

      const filtered = input?.facilityType
        ? withPath.filter((f) => f.inferredFacilityType === input.facilityType)
        : withPath;

      const now = Date.now();
      const byFacility = new Map<string, number>();
      const byCategory = new Map<string, number>();
      const byUploader = new Map<string, number>();
      const byStatus = new Map<string, number>();
      const revisionByGroup = new Map<string, string[]>();

      for (const f of filtered) {
        const facility = f.path.find((p) => /wtp|wwtp|wps|wwls|facility|plant|station/i.test(p)) || "Uncategorized";
        byFacility.set(facility, (byFacility.get(facility) || 0) + 1);
        const category = f.path.length > 1 ? f.path[1] : "General";
        byCategory.set(category, (byCategory.get(category) || 0) + 1);
        byUploader.set(f.uploadedBy || "Unknown", (byUploader.get(f.uploadedBy || "Unknown") || 0) + 1);

        const statusFromMeta = `${f.tags || ""} ${f.description || ""}`.toLowerCase();
        const status =
          statusFromMeta.includes("approved") ? "Approved" :
          statusFromMeta.includes("pending") ? "Pending" :
          statusFromMeta.includes("obsolete") ? "Obsolete" :
          "Unspecified";
        byStatus.set(status, (byStatus.get(status) || 0) + 1);

        const relGroup = `${facility}::${f.title.toLowerCase().trim()}`;
        revisionByGroup.set(relGroup, [...(revisionByGroup.get(relGroup) || []), f.revision || ""]);
      }

      const obsoleteOrOverdue = filtered.filter((f) => {
        const txt = `${f.tags || ""} ${f.description || ""}`.toLowerCase();
        const oldUpload = f.uploadedAt ? now - new Date(f.uploadedAt).getTime() > 1000 * 60 * 60 * 24 * 365 * 2 : false;
        return txt.includes("obsolete") || txt.includes("overdue") || oldUpload;
      }).length;

      const duplicateByTitle = new Map<string, number>();
      for (const f of filtered) {
        const key = `${f.path.join("/")}|${f.title.toLowerCase().trim()}`;
        duplicateByTitle.set(key, (duplicateByTitle.get(key) || 0) + 1);
      }
      const latestRevisionHints = [...duplicateByTitle.entries()]
        .filter(([, count]) => count > 1)
        .slice(0, 10)
        .map(([key]) => key);
      const missingIndicators = filtered.filter((f) => {
        const txt = `${f.tags || ""} ${f.description || ""}`.toLowerCase();
        return txt.includes("missing") || txt.includes("not submitted") || txt.includes("to follow");
      }).length;
      const obsoleteIndicators = filtered.filter((f) => `${f.tags || ""} ${f.description || ""}`.toLowerCase().includes("obsolete")).length;
      const overdueIndicators = filtered.filter((f) => {
        const txt = `${f.tags || ""} ${f.description || ""}`.toLowerCase();
        const oldUpload = f.uploadedAt ? now - new Date(f.uploadedAt).getTime() > 1000 * 60 * 60 * 24 * 365 * 2 : false;
        return txt.includes("overdue") || oldUpload;
      }).length;

      return {
        totals: {
          folders: allFolders.length,
          files: filtered.length,
          pdfCount: filtered.filter((f) => (f.fileType || "").toLowerCase().includes("pdf") || f.fileName.toLowerCase().endsWith(".pdf")).length,
          obsoleteOrOverdue,
          missingIndicators,
          obsoleteIndicators,
          overdueIndicators,
        },
        distribution: {
          facility: Object.fromEntries(byFacility),
          category: Object.fromEntries(byCategory),
          approvalStatus: Object.fromEntries(byStatus),
          uploader: Object.fromEntries(byUploader),
        },
        latestRevisionHints,
        sampleRecords: input?.includeSample ? filtered.slice(0, 5).map((f) => ({
          title: f.title,
          fileName: f.fileName,
          revision: f.revision,
          uploadedBy: f.uploadedBy,
          uploadedAt: f.uploadedAt,
          facilityPath: f.fullPath,
          fileType: f.fileType,
        })) : [],
      };
    }),
  // ── Get aggregate document counts without loading the tree ──
  getStats: publicQuery.query(async () => {
    try {
      return await getDocumentStats();
    } catch (err: unknown) {
      console.error("[docStats] Error:", getErrorMessage(err));
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to load document statistics" });
    }
  }),

  // ── Get the lightweight folder-only hierarchy used by move dialogs ──
  getFolderTree: publicQuery.query(async () => {
    try {
      const folders = await db
        .select({
          id: docFolders.id,
          name: docFolders.name,
          parentId: docFolders.parentId,
          sortOrder: docFolders.sortOrder,
        })
        .from(docFolders)
        .orderBy(docFolders.sortOrder, docFolders.name);
      return { folders };
    } catch (err: unknown) {
      console.error("[docFolderTree] Error:", getErrorMessage(err));
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to load folder tree" });
    }
  }),

  // ── Get one folder level for lazy tree loading ──
  getFolderContents: publicQuery
    .input(z.object({ parentId: z.number().nullable() }))
    .query(async ({ input }) => {
      try {
        return await getDirectFolderContents(input.parentId);
      } catch (err: unknown) {
        console.error("[docFolderContents] Error:", getErrorMessage(err));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to load folder contents" });
      }
    }),

  // ── Get full folder tree with files (used for search/expand-all compatibility, not initial load) ──
  getTree: publicQuery.query(async () => {
    try {
      const [allFolders, allFiles] = await Promise.all([
        db.select().from(docFolders),
        db.select({
          id: docFiles.id,
          folderId: docFiles.folderId,
          title: docFiles.title,
          fileName: docFiles.fileName,
          fileType: docFiles.fileType,
          fileSize: docFiles.fileSize,
          revision: docFiles.revision,
          uploadedAt: docFiles.uploadedAt,
          hasFileData: sql<boolean>`COALESCE(length(${docFiles.fileData}), 0) > 0 OR ${docFiles.storagePath} IS NOT NULL`,
          storageBacked: sql<boolean>`${docFiles.storagePath} IS NOT NULL`,
          fileUrl: docFiles.fileUrl,
        }).from(docFiles),
      ]);
      const stats = await getDocumentStats();
      return { tree: buildTree(allFolders, allFiles), count: stats.folders + stats.files, stats };
    } catch (err: unknown) {
      console.error("[docTree] Error:", getErrorMessage(err));
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to load document tree" });
    }
  }),

  // ── Create folder ──
  createFolder: publicQuery
    .input(
      z.object({
        name: z.string().min(1).max(255),
        parentId: z.number().nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const name = normalizeFolderName(input.name);
      const parentId = input.parentId ?? null;
      try {
        if (!name) throw new TRPCError({ code: "BAD_REQUEST", message: "Folder name is required" });
        validateFolderParent(await loadFoldersForValidation(), null, parentId);
        const result = await db.insert(docFolders).values({
          name,
          parentId,
          sortOrder: 0,
        }).returning();
        return result[0];
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        console.error("[api/createFolder] Error:", getErrorMessage(err), (err as { code?: unknown }).code, (err as { detail?: unknown }).detail);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to create folder: ${getErrorMessage(err)}` });
      }
    }),

  // ── Rename folder ──
  renameFolder: publicQuery
    .input(z.object({ id: z.number(), name: z.string().min(1).max(255) }))
    .mutation(async ({ input }) => {
      try {
        const name = normalizeFolderName(input.name);
        if (!name) throw new TRPCError({ code: "BAD_REQUEST", message: "Folder name is required" });
        const result = await db
          .update(docFolders)
          .set({ name, updatedAt: new Date() })
          .where(eq(docFolders.id, input.id))
          .returning();
        if (!result.length) throw new TRPCError({ code: "NOT_FOUND", message: "Folder not found" });
        return { success: true, folder: result[0] };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        console.error("[renameFolder] Error:", getErrorMessage(err));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to rename folder" });
      }
    }),

  // ── Delete folder (and all descendants + files) ──
  deleteFolder: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const allFolders = await loadFoldersForValidation();
        if (!allFolders.some((f) => f.id === input.id)) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Folder not found" });
        }
        const descendants = getDescendantIds(allFolders, input.id);
        const allIds = [input.id, ...descendants];

        const storedFiles = await db.select({ bucket: docFiles.storageBucket, path: docFiles.storagePath })
          .from(docFiles).where(inArray(docFiles.folderId, allIds));
        const pathsByBucket = new Map<string, string[]>();
        for (const file of storedFiles) {
          if (!file.bucket || !file.path) continue;
          pathsByBucket.set(file.bucket, [...(pathsByBucket.get(file.bucket) || []), file.path]);
        }
        for (const [bucket, paths] of pathsByBucket) {
          for (let offset = 0; offset < paths.length; offset += 1000) {
            const { error } = await getSupabaseStorageAdmin().storage.from(bucket).remove(paths.slice(offset, offset + 1000));
            if (error) throw new Error(`Storage deletion failed: ${error.message}`);
          }
        }

        const deletedFiles = await db.transaction(async (tx) => {
          // Break folder-to-folder references inside the delete set first so a
          // previously corrupted cycle cannot leave a partially deleted tree.
          await tx.update(docFolders).set({ parentId: null, updatedAt: new Date() }).where(inArray(docFolders.id, allIds));
          const files = await tx
            .delete(docFiles)
            .where(inArray(docFiles.folderId, allIds))
            .returning({ id: docFiles.id });
          await tx.delete(docFolders).where(inArray(docFolders.id, allIds));
          return files;
        });
        return { success: true, deletedFolderIds: allIds, deletedFileIds: deletedFiles.map((f) => f.id), deletedCount: allIds.length };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        console.error("[deleteFolder] Error:", getErrorMessage(err));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to delete folder" });
      }
    }),

  // ── Move folder ──
  moveFolder: publicQuery
    .input(z.object({ id: z.number(), parentId: z.number().nullable() }))
    .mutation(async ({ input }) => {
      try {
        const allFolders = await loadFoldersForValidation();
        if (!getFolderById(allFolders, input.id)) throw new TRPCError({ code: "NOT_FOUND", message: "Folder not found" });
        validateFolderParent(allFolders, input.id, input.parentId);
        const result = await db.update(docFolders).set({ parentId: input.parentId, updatedAt: new Date() }).where(eq(docFolders.id, input.id)).returning();
        if (!result.length) throw new TRPCError({ code: "NOT_FOUND", message: "Folder not found" });
        return { success: true, folder: result[0] };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        console.error("[moveFolder] Error:", getErrorMessage(err));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to move folder" });
      }
    }),

  // ── Upload file ──
  uploadFile: publicQuery
    .input(
      z.object({
        folderId: z.number(),
        title: z.string().min(1).max(500),
        fileName: z.string().min(1).max(255),
        fileType: z.string().optional(),
        fileSize: z.number().refine(isUploadFileSizeAllowed, MAX_UPLOAD_ERROR_MESSAGE).optional(),
        fileData: z.string().refine(isBase64UploadSizeAllowed, MAX_UPLOAD_ERROR_MESSAGE).optional(), // base64
        fileUrl: z.string().optional(),
        description: z.string().optional(),
        revision: z.string().optional(),
        tags: z.string().optional(),
        uploadedBy: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await assertFolderExists(input.folderId, "Upload target folder not found");
        const result = await db.insert(docFiles).values({
          folderId: input.folderId,
          title: input.title,
          fileName: input.fileName,
          fileType: input.fileType ?? null,
          fileSize: input.fileSize ?? null,
          fileData: input.fileData ?? null,
          fileUrl: input.fileUrl ?? null,
          description: input.description ?? null,
          revision: input.revision ?? null,
          tags: input.tags ?? null,
          uploadedBy: input.uploadedBy ?? null,
        }).returning();
        return result[0];
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        console.error("[uploadFile] Error:", getErrorMessage(err));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to upload file" });
      }
    }),

  // ── Get single file (with data for viewing) ──
  getFile: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const rows = await db.select().from(docFiles).where(eq(docFiles.id, input.id));
        if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });
        return rows[0];
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        console.error("[getFile] Error:", getErrorMessage(err));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to load file" });
      }
    }),

  // ── Delete file ──
  deleteFile: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const stored = await db.select({ bucket: docFiles.storageBucket, path: docFiles.storagePath })
          .from(docFiles).where(eq(docFiles.id, input.id)).limit(1);
        if (stored[0]?.bucket && stored[0]?.path) {
          const { error } = await getSupabaseStorageAdmin().storage.from(stored[0].bucket).remove([stored[0].path]);
          if (error) throw new Error(`Storage deletion failed: ${error.message}`);
        }
        const result = await db.delete(docFiles).where(eq(docFiles.id, input.id)).returning({ id: docFiles.id });
        if (!result.length) throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });
        return { success: true, deletedFileId: result[0].id };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        console.error("[deleteFile] Error:", getErrorMessage(err));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to delete file" });
      }
    }),

  // ── Rename file ──
  renameFile: publicQuery
    .input(z.object({ id: z.number(), title: z.string().min(1).max(500) }))
    .mutation(async ({ input }) => {
      try {
        const title = input.title.trim();
        if (!title) throw new TRPCError({ code: "BAD_REQUEST", message: "Document title is required" });
        const result = await db.update(docFiles).set({ title, updatedAt: new Date() }).where(eq(docFiles.id, input.id)).returning();
        if (!result.length) throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });
        return { success: true, file: result[0] };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        console.error("[renameFile] Error:", getErrorMessage(err));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to rename file" });
      }
    }),

  // ── Move file to another folder ──
  moveFile: publicQuery
    .input(z.object({ id: z.number(), folderId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        await assertFolderExists(input.folderId, "Destination folder not found");
        await assertFileExists(input.id);
        const result = await db.update(docFiles).set({ folderId: input.folderId, updatedAt: new Date() }).where(eq(docFiles.id, input.id)).returning();
        if (!result.length) throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });
        return { success: true, file: result[0] };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        console.error("[moveFile] Error:", getErrorMessage(err));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to move file" });
      }
    }),
};
