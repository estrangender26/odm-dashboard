import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "./queries/connection";
import { docFolders, docFiles } from "@db/schema";
import { publicQuery } from "./middleware";
import { TRPCError } from "@trpc/server";

// ── Types ──
interface TreeFolder {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder: number;
  children: TreeFolder[];
  files: { id: number; title: string; fileName: string; fileType: string | null; fileSize: number | null; revision: string | null; uploadedAt: Date | null }[];
}
type TreeFileRow = Pick<typeof docFiles.$inferSelect, "id" | "folderId" | "title" | "fileName" | "fileType" | "fileSize" | "revision" | "uploadedAt">;

// ── Helper: build recursive tree ──
function buildTree(
  allFolders: typeof docFolders.$inferSelect[],
  allFiles: TreeFileRow[],
  parentId: number | null = null
): TreeFolder[] {
  const folderChildrenByParentId = new Map<number | null, typeof docFolders.$inferSelect[]>();
  for (const folder of allFolders) {
    const key = folder.parentId ?? null;
    if (!folderChildrenByParentId.has(key)) folderChildrenByParentId.set(key, []);
    folderChildrenByParentId.get(key)!.push(folder);
  }
  const filesByFolderId = new Map<number, typeof docFiles.$inferSelect[]>();
  for (const file of allFiles) {
    if (!filesByFolderId.has(file.folderId)) filesByFolderId.set(file.folderId, []);
    filesByFolderId.get(file.folderId)!.push(file);
  }
  function walk(currentParentId: number | null): TreeFolder[] {
    const folders = folderChildrenByParentId.get(currentParentId) ?? [];
  folders.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
    return folders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      sortOrder: f.sortOrder ?? 0,
      children: walk(f.id),
      files: (filesByFolderId.get(f.id) ?? []).map((file) => ({
        id: file.id,
        title: file.title,
        fileName: file.fileName,
        fileType: file.fileType,
        fileSize: file.fileSize,
        revision: file.revision,
        uploadedAt: file.uploadedAt,
      })),
    }));
  }
  return walk(parentId);
}

// ── Helper: collect all descendant IDs (for move validation) ──
function getDescendantIds(allFolders: typeof docFolders.$inferSelect[], folderId: number): number[] {
  const children = allFolders.filter((f) => f.parentId === folderId).map((f) => f.id);
  const descendants: number[] = [...children];
  for (const childId of children) {
    descendants.push(...getDescendantIds(allFolders, childId));
  }
  return descendants;
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
      const allFolders = await db.select().from(docFolders);
      const allFiles = await db.select({
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
      }).from(docFiles);

      const folderById = new Map(allFolders.map((f) => [f.id, f] as const));
      const buildPath = (folderId: number) => {
        const parts: string[] = [];
        let curr = folderById.get(folderId) || null;
        while (curr) {
          parts.unshift(curr.name);
          curr = curr.parentId ? (folderById.get(curr.parentId) || null) : null;
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
        .slice(0, 20)
        .map(([key]) => key);

      return {
        totals: {
          folders: allFolders.length,
          files: filtered.length,
          pdfCount: filtered.filter((f) => (f.fileType || "").toLowerCase().includes("pdf") || f.fileName.toLowerCase().endsWith(".pdf")).length,
          obsoleteOrOverdue,
        },
        distribution: {
          facility: Object.fromEntries(byFacility),
          category: Object.fromEntries(byCategory),
          approvalStatus: Object.fromEntries(byStatus),
          uploader: Object.fromEntries(byUploader),
        },
        latestRevisionHints,
        sampleRecords: input?.includeSample ? filtered.slice(0, 50).map((f) => ({
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
  // ── Get full folder tree with files ──
  getTree: publicQuery.query(async () => {
    try {
      const allFolders = await db.select().from(docFolders);
      const allFiles = await db.select({
        id: docFiles.id,
        folderId: docFiles.folderId,
        title: docFiles.title,
        fileName: docFiles.fileName,
        fileType: docFiles.fileType,
        fileSize: docFiles.fileSize,
        revision: docFiles.revision,
        uploadedAt: docFiles.uploadedAt,
      }).from(docFiles);
      return { tree: buildTree(allFolders, allFiles), count: allFolders.length + allFiles.length };
    } catch (err: any) {
      console.error("[docTree] Error:", err.message);
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
      console.log(`[api/createFolder] name="${input.name}", parentId=${input.parentId ?? "null (root)"}`);
      try {
        const result = await db.insert(docFolders).values({
          name: input.name,
          parentId: input.parentId ?? null,
          sortOrder: 0,
        }).returning();
        console.log(`[api/createFolder] Inserted: id=${result[0].id}, name="${result[0].name}", parentId=${result[0].parentId ?? "null"}`);
        return result[0];
      } catch (err: any) {
        console.error("[api/createFolder] Error:", err.message, err.code, err.detail);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to create folder: ${err.message}` });
      }
    }),

  // ── Rename folder ──
  renameFolder: publicQuery
    .input(z.object({ id: z.number(), name: z.string().min(1).max(255) }))
    .mutation(async ({ input }) => {
      try {
        await db.update(docFolders).set({ name: input.name, updatedAt: new Date() }).where(eq(docFolders.id, input.id));
        return { success: true };
      } catch (err: any) {
        console.error("[renameFolder] Error:", err.message);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to rename folder" });
      }
    }),

  // ── Delete folder (and all descendants + files) ──
  deleteFolder: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const allFolders = await db.select().from(docFolders);
        const descendants = getDescendantIds(allFolders, input.id);
        const allIds = [input.id, ...descendants];

        // Delete all files in these folders
        for (const folderId of allIds) {
          await db.delete(docFiles).where(eq(docFiles.folderId, folderId));
        }
        // Delete folders (descendants first)
        for (const folderId of [...descendants].reverse()) {
          await db.delete(docFolders).where(eq(docFolders.id, folderId));
        }
        await db.delete(docFolders).where(eq(docFolders.id, input.id));
        return { success: true, deletedCount: allIds.length };
      } catch (err: any) {
        console.error("[deleteFolder] Error:", err.message);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to delete folder" });
      }
    }),

  // ── Move folder ──
  moveFolder: publicQuery
    .input(z.object({ id: z.number(), parentId: z.number().nullable() }))
    .mutation(async ({ input }) => {
      try {
        // Prevent circular reference
        if (input.parentId !== null) {
          const allFolders = await db.select().from(docFolders);
          const descendants = getDescendantIds(allFolders, input.id);
          if (descendants.includes(input.parentId)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot move a folder into its own descendant" });
          }
        }
        await db.update(docFolders).set({ parentId: input.parentId, updatedAt: new Date() }).where(eq(docFolders.id, input.id));
        return { success: true };
      } catch (err: any) {
        if (err instanceof TRPCError) throw err;
        console.error("[moveFolder] Error:", err.message);
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
        fileSize: z.number().optional(),
        fileData: z.string().optional(), // base64
        fileUrl: z.string().optional(),
        description: z.string().optional(),
        revision: z.string().optional(),
        tags: z.string().optional(),
        uploadedBy: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
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
      } catch (err: any) {
        console.error("[uploadFile] Error:", err.message);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to upload file" });
      }
    }),

  // ── Get single file (with data for viewing) ──
  getFile: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const rows = await db.select().from(docFiles).where(eq(docFiles.id, input.id));
        if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });
        return rows[0];
      } catch (err: any) {
        if (err instanceof TRPCError) throw err;
        console.error("[getFile] Error:", err.message);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to load file" });
      }
    }),

  // ── Delete file ──
  deleteFile: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        await db.delete(docFiles).where(eq(docFiles.id, input.id));
        return { success: true };
      } catch (err: any) {
        console.error("[deleteFile] Error:", err.message);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to delete file" });
      }
    }),

  // ── Rename file ──
  renameFile: publicQuery
    .input(z.object({ id: z.number(), title: z.string().min(1).max(500) }))
    .mutation(async ({ input }) => {
      try {
        await db.update(docFiles).set({ title: input.title, updatedAt: new Date() }).where(eq(docFiles.id, input.id));
        return { success: true };
      } catch (err: any) {
        console.error("[renameFile] Error:", err.message);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to rename file" });
      }
    }),

  // ── Move file to another folder ──
  moveFile: publicQuery
    .input(z.object({ id: z.number(), folderId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        await db.update(docFiles).set({ folderId: input.folderId, updatedAt: new Date() }).where(eq(docFiles.id, input.id));
        return { success: true };
      } catch (err: any) {
        console.error("[moveFile] Error:", err.message);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to move file" });
      }
    }),
};
