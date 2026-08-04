import { z } from "zod";
import { Hono } from "hono";
import { and, eq, like, sql, or, isNull } from "drizzle-orm";
import { db } from "./queries/connection";
import {
  lihokCorporateDocumentCategories,
  lihokCorporateDocuments,
  lihokCorporateDocumentVersions,
  lihokCorporateDocumentAudit,
  lihokCorporateDocumentClassificationValues,
  lihokCorporateDocumentStatusValues,
  type LihokCorporateDocument,
  type LihokCorporateDocumentVersion,
  type User,
} from "@db/schema";
import { authenticateRequest } from "./kimi/auth";
import { Errors, type AppError } from "../contracts/errors";
import { TRPCError } from "@trpc/server";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

type LihokStatus = (typeof lihokCorporateDocumentStatusValues)[number];
type LihokClassification = (typeof lihokCorporateDocumentClassificationValues)[number];

// Version-level status machine.
// Supersession is never triggered manually; it happens automatically when a new
// version is approved.
const VALID_STATUS_TRANSITIONS: Record<LihokStatus, LihokStatus[]> = {
  draft: ["for_review", "archived"],
  for_review: ["draft", "approved", "archived"],
  approved: ["archived"],
  superseded: ["archived"],
  archived: [],
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function isValidStatusTransition(from: LihokStatus, to: LihokStatus): boolean {
  return from === to || VALID_STATUS_TRANSITIONS[from].includes(to);
}

async function requireUser(headers: Headers): Promise<User> {
  return authenticateRequest(headers);
}

function requireAdmin(user: User): void {
  if (user.role !== "admin") {
    throw Errors.forbidden("This action requires administrator privileges.");
  }
}

function hasCompletedStorage(version: Partial<LihokCorporateDocumentVersion>): boolean {
  return (
    version.fileName != null &&
    version.fileSize != null &&
    version.mimeType != null &&
    version.storageProvider != null &&
    version.storageBucket != null &&
    version.storagePath != null &&
    version.storageUploadedAt != null
  );
}

function parseClassification(value: string): LihokClassification {
  if (!lihokCorporateDocumentClassificationValues.includes(value as LihokClassification)) {
    throw Errors.badRequest("Invalid classification.");
  }
  return value as LihokClassification;
}

function parseStatus(value: string): LihokStatus {
  if (!lihokCorporateDocumentStatusValues.includes(value as LihokStatus)) {
    throw Errors.badRequest("Invalid status.");
  }
  return value as LihokStatus;
}

async function logAudit(
  tx: any,
  options: {
    documentId: number;
    versionId?: number | null;
    action: string;
    actor: User;
    requestId?: string;
    oldValue?: Record<string, unknown>;
    newValue?: Record<string, unknown>;
  },
) {
  await tx.insert(lihokCorporateDocumentAudit).values({
    documentId: options.documentId,
    versionId: options.versionId ?? null,
    action: options.action,
    actorUserId: options.actor.id,
    actorName: options.actor.name,
    oldValue: options.oldValue ?? null,
    newValue: options.newValue ?? null,
    requestId: options.requestId ?? null,
  });
}

async function getCurrentVersionId(documentId: number): Promise<number | null> {
  const rows = await db
    .select({ id: lihokCorporateDocumentVersions.id })
    .from(lihokCorporateDocumentVersions)
    .where(
      and(
        eq(lihokCorporateDocumentVersions.documentId, documentId),
        sql`${lihokCorporateDocumentVersions.status} = 'approved'`,
      ),
    )
    .orderBy(sql`${lihokCorporateDocumentVersions.approvedAt} DESC NULLS LAST`)
    .limit(1);

  if (rows[0]) return rows[0].id;

  const fallback = await db
    .select({ id: lihokCorporateDocumentVersions.id })
    .from(lihokCorporateDocumentVersions)
    .where(eq(lihokCorporateDocumentVersions.documentId, documentId))
    .orderBy(sql`${lihokCorporateDocumentVersions.createdAt} DESC`)
    .limit(1);

  return fallback[0]?.id ?? null;
}

// ----------------------------------------------------------------------------
// Validation helpers
// ----------------------------------------------------------------------------

const documentNumberSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[A-Z0-9._-]+$/i, "Document number must be alphanumeric with dots, dashes, or underscores.");

const versionNumberSchema = z
  .string()
  .min(1)
  .max(20)
  .regex(/^[0-9]+(\.[0-9]+)*$/, "Version number must use dotted numeric notation.");

const createDocumentSchema = z.object({
  documentNumber: documentNumberSchema,
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  categoryId: z.number().int().positive(),
  defaultClassification: z.enum(lihokCorporateDocumentClassificationValues).default("internal"),
  ownerName: z.string().max(255).optional(),
});

const updateDocumentSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  categoryId: z.number().int().positive().optional(),
  defaultClassification: z.enum(lihokCorporateDocumentClassificationValues).optional(),
  ownerName: z.string().max(255).optional().nullable(),
});

const createVersionSchema = z.object({
  documentId: z.number().int().positive(),
  versionNumber: versionNumberSchema,
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  classification: z.enum(lihokCorporateDocumentClassificationValues).default("internal"),
  ownerName: z.string().max(255).optional(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  changeNotes: z.string().max(5000).optional(),
});

const updateVersionSchema = z.object({
  id: z.number().int().positive(),
  documentId: z.number().int().positive(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional().nullable(),
  classification: z.enum(lihokCorporateDocumentClassificationValues).optional(),
  ownerName: z.string().max(255).optional().nullable(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  changeNotes: z.string().max(5000).optional().nullable(),
});

const transitionStatusSchema = z.object({
  versionId: z.number().int().positive(),
  documentId: z.number().int().positive(),
  status: z.enum(lihokCorporateDocumentStatusValues),
  changeNotes: z.string().max(5000).optional(),
});

const searchSchema = z.object({
  q: z.string().max(255).optional(),
  documentNumber: z.string().max(50).optional(),
  title: z.string().max(500).optional(),
  ownerName: z.string().max(255).optional(),
  classification: z.enum(lihokCorporateDocumentClassificationValues).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  archived: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ----------------------------------------------------------------------------
// Router
// ----------------------------------------------------------------------------

export const lihokCorporateRouter = new Hono();

function handleError(error: unknown): { status: 200 | 201 | 400 | 401 | 403 | 404 | 409 | 500; body: { error: string } } {
  if (error instanceof z.ZodError) {
    return { status: 400 as const, body: { error: error.issues[0]?.message ?? "Invalid input." } };
  }
  const appErr = error as AppError | undefined;
  if (appErr && appErr.tag === "app_error") {
    return { status: appErr.status as 200 | 201 | 400 | 401 | 403 | 404 | 409 | 500, body: { error: appErr.message } };
  }
  if (error instanceof TRPCError) {
    return { status: trpcCodeToStatus(error.code) as 200 | 201 | 400 | 401 | 403 | 404 | 409 | 500, body: { error: error.message } };
  }
  console.error("[lihok-corporate] unexpected error", error);
  return { status: 500 as const, body: { error: "Internal server error." } };
}

function trpcCodeToStatus(code: string): number {
  switch (code) {
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "BAD_REQUEST":
      return 400;
    default:
      return 400;
  }
}

// ----------------------------------------------------------------------------
// Categories
// ----------------------------------------------------------------------------

lihokCorporateRouter.get("/categories", async (c) => {
  try {
    await requireUser(c.req.raw.headers);

    const rows = await db.execute(sql<{ id: number; code: string; name: string; sortOrder: number; activeDocumentCount: number }>`
      SELECT
        c.id,
        c.code,
        c.name,
        c.sort_order AS "sortOrder",
        COALESCE(count(d.id), 0)::int AS "activeDocumentCount"
      FROM lihok_corporate_document_categories c
      LEFT JOIN lihok_corporate_documents d
        ON d.category_id = c.id AND d.archived_at IS NULL
      GROUP BY c.id, c.code, c.name, c.sort_order
      ORDER BY c.sort_order, c.name
    `);

    return c.json({ categories: rows });
  } catch (error) {
    const { status, body } = handleError(error);
    return c.json(body, status);
  }
});

// ----------------------------------------------------------------------------
// Documents
// ----------------------------------------------------------------------------

lihokCorporateRouter.get("/documents", async (c) => {
  try {
    await requireUser(c.req.raw.headers);

    const query = searchSchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));

    const conditions = [];

    if (query.q) {
      const pattern = `%${query.q}%`;
      conditions.push(
        or(
          like(lihokCorporateDocuments.documentNumber, pattern),
          like(lihokCorporateDocuments.title, pattern),
        ),
      );
    }
    if (query.documentNumber) {
      conditions.push(like(lihokCorporateDocuments.documentNumber, `%${query.documentNumber}%`));
    }
    if (query.title) {
      conditions.push(like(lihokCorporateDocuments.title, `%${query.title}%`));
    }
    if (query.ownerName) {
      conditions.push(like(lihokCorporateDocuments.ownerName, `%${query.ownerName}%`));
    }
    if (query.classification) {
      conditions.push(eq(lihokCorporateDocuments.defaultClassification, query.classification));
    }
    if (query.categoryId) {
      conditions.push(eq(lihokCorporateDocuments.categoryId, query.categoryId));
    }
    if (query.archived === "false") {
      conditions.push(isNull(lihokCorporateDocuments.archivedAt));
    } else if (query.archived === "true") {
      conditions.push(sql`${lihokCorporateDocuments.archivedAt} IS NOT NULL`);
    }

    const whereClause = conditions.length ? and(...conditions) : undefined;

    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(lihokCorporateDocuments)
      .where(whereClause)
      .limit(1);
    const total = totalRows[0]?.count ?? 0;

    const rows = await db
      .select({
        id: lihokCorporateDocuments.id,
        documentNumber: lihokCorporateDocuments.documentNumber,
        title: lihokCorporateDocuments.title,
        description: lihokCorporateDocuments.description,
        categoryId: lihokCorporateDocuments.categoryId,
        defaultClassification: lihokCorporateDocuments.defaultClassification,
        ownerName: lihokCorporateDocuments.ownerName,
        createdBy: lihokCorporateDocuments.createdBy,
        updatedBy: lihokCorporateDocuments.updatedBy,
        createdAt: lihokCorporateDocuments.createdAt,
        updatedAt: lihokCorporateDocuments.updatedAt,
        archivedAt: lihokCorporateDocuments.archivedAt,
      })
      .from(lihokCorporateDocuments)
      .where(whereClause)
      .orderBy(lihokCorporateDocuments.documentNumber)
      .limit(query.limit)
      .offset(query.offset);

    const documentIds = rows.map((r) => r.id);
    const currentVersionIds = await Promise.all(documentIds.map((id) => getCurrentVersionId(id)));

    return c.json({
      items: rows.map((doc, index) => ({
        ...doc,
        currentVersionId: currentVersionIds[index],
      })),
      pagination: { total, limit: query.limit, offset: query.offset },
    });
  } catch (error) {
    const { status, body } = handleError(error);
    return c.json(body, status);
  }
});

lihokCorporateRouter.get("/documents/:id", async (c) => {
  try {
    await requireUser(c.req.raw.headers);

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid document id." }, 400);

    const rows = await db
      .select({
        id: lihokCorporateDocuments.id,
        documentNumber: lihokCorporateDocuments.documentNumber,
        title: lihokCorporateDocuments.title,
        description: lihokCorporateDocuments.description,
        categoryId: lihokCorporateDocuments.categoryId,
        defaultClassification: lihokCorporateDocuments.defaultClassification,
        ownerName: lihokCorporateDocuments.ownerName,
        createdBy: lihokCorporateDocuments.createdBy,
        updatedBy: lihokCorporateDocuments.updatedBy,
        createdAt: lihokCorporateDocuments.createdAt,
        updatedAt: lihokCorporateDocuments.updatedAt,
        archivedAt: lihokCorporateDocuments.archivedAt,
      })
      .from(lihokCorporateDocuments)
      .where(eq(lihokCorporateDocuments.id, id))
      .limit(1);

    if (!rows.length) return c.json({ error: "Document not found." }, 404);

    const currentVersionId = await getCurrentVersionId(id);

    return c.json({ document: { ...rows[0], currentVersionId } });
  } catch (error) {
    const { status, body } = handleError(error);
    return c.json(body, status);
  }
});

lihokCorporateRouter.post("/documents", async (c) => {
  try {
    const user = await requireUser(c.req.raw.headers);

    const input = createDocumentSchema.parse(await c.req.json());

    const categoryRows = await db
      .select({ id: lihokCorporateDocumentCategories.id })
      .from(lihokCorporateDocumentCategories)
      .where(eq(lihokCorporateDocumentCategories.id, input.categoryId))
      .limit(1);
    if (!categoryRows.length) {
      throw Errors.badRequest("Category not found.");
    }

    const existing = await db
      .select({ id: lihokCorporateDocuments.id })
      .from(lihokCorporateDocuments)
      .where(eq(lihokCorporateDocuments.documentNumber, input.documentNumber))
      .limit(1);
    if (existing.length) {
      throw Errors.badRequest("Document number already exists.");
    }

    const now = new Date();
    const documentId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(lihokCorporateDocuments)
        .values({
          documentNumber: input.documentNumber,
          title: input.title,
          description: input.description ?? null,
          categoryId: input.categoryId,
          defaultClassification: input.defaultClassification,
          ownerName: input.ownerName ?? null,
          createdBy: user.id,
          updatedBy: user.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: lihokCorporateDocuments.id });

      const newDocumentId = inserted[0].id;

      await logAudit(tx, {
        documentId: newDocumentId,
        action: "document.created",
        actor: user,
        newValue: { ...input },
      });

      return newDocumentId;
    });

    return c.json({ document: { id: documentId } }, 201);
  } catch (error) {
    const { status, body } = handleError(error);
    return c.json(body, status);
  }
});

lihokCorporateRouter.patch("/documents/:id", async (c) => {
  try {
    const user = await requireUser(c.req.raw.headers);

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid document id." }, 400);

    const input = updateDocumentSchema.parse({ ...(await c.req.json()), id });

    const existingRows = await db
      .select({
        id: lihokCorporateDocuments.id,
        documentNumber: lihokCorporateDocuments.documentNumber,
        title: lihokCorporateDocuments.title,
        description: lihokCorporateDocuments.description,
        categoryId: lihokCorporateDocuments.categoryId,
        defaultClassification: lihokCorporateDocuments.defaultClassification,
        ownerName: lihokCorporateDocuments.ownerName,
        archivedAt: lihokCorporateDocuments.archivedAt,
      })
      .from(lihokCorporateDocuments)
      .where(eq(lihokCorporateDocuments.id, id))
      .limit(1);

    if (!existingRows.length) return c.json({ error: "Document not found." }, 404);
    const existing = existingRows[0];

    if (existing.archivedAt) {
      throw Errors.conflict("Archived documents cannot be edited until restored.");
    }

    if (input.categoryId) {
      const categoryRows = await db
        .select({ id: lihokCorporateDocumentCategories.id })
        .from(lihokCorporateDocumentCategories)
        .where(eq(lihokCorporateDocumentCategories.id, input.categoryId))
        .limit(1);
      if (!categoryRows.length) {
        throw Errors.badRequest("Category not found.");
      }
    }

    const documentId = await db.transaction(async (tx) => {
      const updateData: Partial<typeof lihokCorporateDocuments.$inferInsert> = {
        updatedBy: user.id,
        updatedAt: new Date(),
      };
      if (input.title !== undefined) updateData.title = input.title;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.categoryId !== undefined) updateData.categoryId = input.categoryId;
      if (input.defaultClassification !== undefined) updateData.defaultClassification = input.defaultClassification;
      if (input.ownerName !== undefined) updateData.ownerName = input.ownerName;

      const updated = await tx
        .update(lihokCorporateDocuments)
        .set(updateData)
        .where(eq(lihokCorporateDocuments.id, id))
        .returning({ id: lihokCorporateDocuments.id });

      if (!updated.length) {
        throw Errors.notFound("Document not found.");
      }

      await logAudit(tx, {
        documentId: id,
        action: "document.updated",
        actor: user,
        oldValue: { ...existing },
        newValue: { ...updateData },
      });

      return updated[0].id;
    });

    return c.json({ document: { id: documentId } });
  } catch (error) {
    const { status, body } = handleError(error);
    return c.json(body, status);
  }
});

lihokCorporateRouter.post("/documents/:id/archive", async (c) => {
  try {
    const user = await requireUser(c.req.raw.headers);

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid document id." }, 400);

    const documentId = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: lihokCorporateDocuments.id, archivedAt: lihokCorporateDocuments.archivedAt })
        .from(lihokCorporateDocuments)
        .where(eq(lihokCorporateDocuments.id, id))
        .limit(1);

      if (!existing.length) throw Errors.notFound("Document not found.");
      if (existing[0].archivedAt) return { id, archivedAt: existing[0].archivedAt };

      const now = new Date();
      const updated = await tx
        .update(lihokCorporateDocuments)
        .set({ archivedAt: now, updatedBy: user.id, updatedAt: now })
        .where(eq(lihokCorporateDocuments.id, id))
        .returning({ id: lihokCorporateDocuments.id, archivedAt: lihokCorporateDocuments.archivedAt });

      await logAudit(tx, {
        documentId: id,
        action: "document.archived",
        actor: user,
        oldValue: { archivedAt: null },
        newValue: { archivedAt: now.toISOString() },
      });

      return updated[0];
    });

    return c.json({ document: documentId });
  } catch (error) {
    const { status, body } = handleError(error);
    return c.json(body, status);
  }
});

lihokCorporateRouter.post("/documents/:id/restore", async (c) => {
  try {
    const user = await requireUser(c.req.raw.headers);

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid document id." }, 400);

    const documentId = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: lihokCorporateDocuments.id, archivedAt: lihokCorporateDocuments.archivedAt })
        .from(lihokCorporateDocuments)
        .where(eq(lihokCorporateDocuments.id, id))
        .limit(1);

      if (!existing.length) throw Errors.notFound("Document not found.");
      if (!existing[0].archivedAt) return { id, archivedAt: null };

      const now = new Date();
      const updated = await tx
        .update(lihokCorporateDocuments)
        .set({ archivedAt: null, updatedBy: user.id, updatedAt: now })
        .where(eq(lihokCorporateDocuments.id, id))
        .returning({ id: lihokCorporateDocuments.id, archivedAt: lihokCorporateDocuments.archivedAt });

      await logAudit(tx, {
        documentId: id,
        action: "document.restored",
        actor: user,
        oldValue: { archivedAt: existing[0].archivedAt?.toISOString() ?? null },
        newValue: { archivedAt: null },
      });

      return updated[0];
    });

    return c.json({ document: documentId });
  } catch (error) {
    const { status, body } = handleError(error);
    return c.json(body, status);
  }
});

// ----------------------------------------------------------------------------
// Versions
// ----------------------------------------------------------------------------

lihokCorporateRouter.get("/documents/:id/versions", async (c) => {
  try {
    await requireUser(c.req.raw.headers);

    const documentId = Number(c.req.param("id"));
    if (!Number.isInteger(documentId) || documentId <= 0) return c.json({ error: "Invalid document id." }, 400);

    const documentRows = await db
      .select({ id: lihokCorporateDocuments.id })
      .from(lihokCorporateDocuments)
      .where(eq(lihokCorporateDocuments.id, documentId))
      .limit(1);
    if (!documentRows.length) return c.json({ error: "Document not found." }, 404);

    const rows = await db
      .select({
        id: lihokCorporateDocumentVersions.id,
        documentId: lihokCorporateDocumentVersions.documentId,
        versionNumber: lihokCorporateDocumentVersions.versionNumber,
        title: lihokCorporateDocumentVersions.title,
        description: lihokCorporateDocumentVersions.description,
        status: lihokCorporateDocumentVersions.status,
        classification: lihokCorporateDocumentVersions.classification,
        ownerName: lihokCorporateDocumentVersions.ownerName,
        effectiveDate: lihokCorporateDocumentVersions.effectiveDate,
        changeNotes: lihokCorporateDocumentVersions.changeNotes,
        fileName: lihokCorporateDocumentVersions.fileName,
        fileSize: lihokCorporateDocumentVersions.fileSize,
        mimeType: lihokCorporateDocumentVersions.mimeType,
        storageProvider: lihokCorporateDocumentVersions.storageProvider,
        storageBucket: lihokCorporateDocumentVersions.storageBucket,
        storagePath: lihokCorporateDocumentVersions.storagePath,
        storageEtag: lihokCorporateDocumentVersions.storageEtag,
        storageUploadedAt: lihokCorporateDocumentVersions.storageUploadedAt,
        uploadedBy: lihokCorporateDocumentVersions.uploadedBy,
        reviewedBy: lihokCorporateDocumentVersions.reviewedBy,
        reviewedAt: lihokCorporateDocumentVersions.reviewedAt,
        approvedBy: lihokCorporateDocumentVersions.approvedBy,
        approvedAt: lihokCorporateDocumentVersions.approvedAt,
        supersededByVersionId: lihokCorporateDocumentVersions.supersededByVersionId,
        createdAt: lihokCorporateDocumentVersions.createdAt,
        updatedAt: lihokCorporateDocumentVersions.updatedAt,
      })
      .from(lihokCorporateDocumentVersions)
      .where(eq(lihokCorporateDocumentVersions.documentId, documentId))
      .orderBy(sql`string_to_array(${lihokCorporateDocumentVersions.versionNumber}, '.')::int[] DESC`);

    return c.json({ items: rows });
  } catch (error) {
    const { status, body } = handleError(error);
    return c.json(body, status);
  }
});

lihokCorporateRouter.get("/versions/:id", async (c) => {
  try {
    await requireUser(c.req.raw.headers);

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid version id." }, 400);

    const rows = await db
      .select({
        id: lihokCorporateDocumentVersions.id,
        documentId: lihokCorporateDocumentVersions.documentId,
        versionNumber: lihokCorporateDocumentVersions.versionNumber,
        title: lihokCorporateDocumentVersions.title,
        description: lihokCorporateDocumentVersions.description,
        status: lihokCorporateDocumentVersions.status,
        classification: lihokCorporateDocumentVersions.classification,
        ownerName: lihokCorporateDocumentVersions.ownerName,
        effectiveDate: lihokCorporateDocumentVersions.effectiveDate,
        changeNotes: lihokCorporateDocumentVersions.changeNotes,
        fileName: lihokCorporateDocumentVersions.fileName,
        fileSize: lihokCorporateDocumentVersions.fileSize,
        mimeType: lihokCorporateDocumentVersions.mimeType,
        storageProvider: lihokCorporateDocumentVersions.storageProvider,
        storageBucket: lihokCorporateDocumentVersions.storageBucket,
        storagePath: lihokCorporateDocumentVersions.storagePath,
        storageEtag: lihokCorporateDocumentVersions.storageEtag,
        storageUploadedAt: lihokCorporateDocumentVersions.storageUploadedAt,
        uploadedBy: lihokCorporateDocumentVersions.uploadedBy,
        reviewedBy: lihokCorporateDocumentVersions.reviewedBy,
        reviewedAt: lihokCorporateDocumentVersions.reviewedAt,
        approvedBy: lihokCorporateDocumentVersions.approvedBy,
        approvedAt: lihokCorporateDocumentVersions.approvedAt,
        supersededByVersionId: lihokCorporateDocumentVersions.supersededByVersionId,
        createdAt: lihokCorporateDocumentVersions.createdAt,
        updatedAt: lihokCorporateDocumentVersions.updatedAt,
      })
      .from(lihokCorporateDocumentVersions)
      .where(eq(lihokCorporateDocumentVersions.id, id))
      .limit(1);

    if (!rows.length) return c.json({ error: "Version not found." }, 404);

    return c.json({ version: rows[0] });
  } catch (error) {
    const { status, body } = handleError(error);
    return c.json(body, status);
  }
});

lihokCorporateRouter.post("/versions", async (c) => {
  try {
    const user = await requireUser(c.req.raw.headers);

    const input = createVersionSchema.parse(await c.req.json());

    const docRows = await db
      .select({ id: lihokCorporateDocuments.id, archivedAt: lihokCorporateDocuments.archivedAt })
      .from(lihokCorporateDocuments)
      .where(eq(lihokCorporateDocuments.id, input.documentId))
      .limit(1);
    if (!docRows.length) {
      throw Errors.notFound("Document not found.");
    }
    if (docRows[0].archivedAt) {
      throw Errors.conflict("Archived documents cannot receive new versions until restored.");
    }

    const duplicate = await db
      .select({ id: lihokCorporateDocumentVersions.id })
      .from(lihokCorporateDocumentVersions)
      .where(
        and(
          eq(lihokCorporateDocumentVersions.documentId, input.documentId),
          eq(lihokCorporateDocumentVersions.versionNumber, input.versionNumber),
        ),
      )
      .limit(1);
    if (duplicate.length) {
      throw Errors.badRequest("Version number already exists for this document.");
    }

    const now = new Date();
    const versionId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(lihokCorporateDocumentVersions)
        .values({
          documentId: input.documentId,
          versionNumber: input.versionNumber,
          title: input.title,
          description: input.description ?? null,
          classification: input.classification,
          ownerName: input.ownerName ?? null,
          effectiveDate: input.effectiveDate ?? null,
          changeNotes: input.changeNotes ?? null,
          uploadedBy: user.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: lihokCorporateDocumentVersions.id });

      const newVersionId = inserted[0].id;

      await logAudit(tx, {
        documentId: input.documentId,
        versionId: newVersionId,
        action: "version.created",
        actor: user,
        newValue: { ...input },
      });

      return newVersionId;
    });

    return c.json({ version: { id: versionId } }, 201);
  } catch (error) {
    const { status, body } = handleError(error);
    return c.json(body, status);
  }
});

lihokCorporateRouter.patch("/versions/:id", async (c) => {
  try {
    const user = await requireUser(c.req.raw.headers);

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid version id." }, 400);

    const body = await c.req.json();
    const input = updateVersionSchema.parse({ ...body, id });

    const existingRows = await db
      .select({
        id: lihokCorporateDocumentVersions.id,
        documentId: lihokCorporateDocumentVersions.documentId,
        versionNumber: lihokCorporateDocumentVersions.versionNumber,
        title: lihokCorporateDocumentVersions.title,
        description: lihokCorporateDocumentVersions.description,
        status: lihokCorporateDocumentVersions.status,
        classification: lihokCorporateDocumentVersions.classification,
        ownerName: lihokCorporateDocumentVersions.ownerName,
        effectiveDate: lihokCorporateDocumentVersions.effectiveDate,
        changeNotes: lihokCorporateDocumentVersions.changeNotes,
      })
      .from(lihokCorporateDocumentVersions)
      .where(eq(lihokCorporateDocumentVersions.id, id))
      .limit(1);

    if (!existingRows.length) return c.json({ error: "Version not found." }, 404);
    const existing = existingRows[0];

    if (existing.documentId !== input.documentId) {
      throw Errors.badRequest("Version does not belong to the specified document.");
    }

    // Approved, superseded and archived versions are immutable.
    if (existing.status === "approved" || existing.status === "superseded" || existing.status === "archived") {
      throw Errors.forbidden(
        "Approved, superseded or archived versions cannot be edited directly. Create a new version or use status transition.",
      );
    }

    const versionId = await db.transaction(async (tx) => {
      const updateData: Partial<typeof lihokCorporateDocumentVersions.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (input.title !== undefined) updateData.title = input.title;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.classification !== undefined) updateData.classification = input.classification;
      if (input.ownerName !== undefined) updateData.ownerName = input.ownerName;
      if (input.effectiveDate !== undefined) updateData.effectiveDate = input.effectiveDate;
      if (input.changeNotes !== undefined) updateData.changeNotes = input.changeNotes;

      const updated = await tx
        .update(lihokCorporateDocumentVersions)
        .set(updateData)
        .where(eq(lihokCorporateDocumentVersions.id, id))
        .returning({ id: lihokCorporateDocumentVersions.id });

      if (!updated.length) {
        throw Errors.notFound("Version not found.");
      }

      await logAudit(tx, {
        documentId: existing.documentId,
        versionId: id,
        action: "version.updated",
        actor: user,
        oldValue: { ...existing },
        newValue: { ...updateData },
      });

      return updated[0].id;
    });

    return c.json({ version: { id: versionId } });
  } catch (error) {
    const { status, body } = handleError(error);
    return c.json(body, status);
  }
});

// ----------------------------------------------------------------------------
// Status transitions
// ----------------------------------------------------------------------------

lihokCorporateRouter.post("/versions/transition", async (c) => {
  try {
    const user = await requireUser(c.req.raw.headers);

    const input = transitionStatusSchema.parse(await c.req.json());

    const versionRows = await db
      .select({
        id: lihokCorporateDocumentVersions.id,
        documentId: lihokCorporateDocumentVersions.documentId,
        versionNumber: lihokCorporateDocumentVersions.versionNumber,
        status: lihokCorporateDocumentVersions.status,
        fileName: lihokCorporateDocumentVersions.fileName,
        fileSize: lihokCorporateDocumentVersions.fileSize,
        mimeType: lihokCorporateDocumentVersions.mimeType,
        storageProvider: lihokCorporateDocumentVersions.storageProvider,
        storageBucket: lihokCorporateDocumentVersions.storageBucket,
        storagePath: lihokCorporateDocumentVersions.storagePath,
        storageUploadedAt: lihokCorporateDocumentVersions.storageUploadedAt,
        uploadedBy: lihokCorporateDocumentVersions.uploadedBy,
        approvedAt: lihokCorporateDocumentVersions.approvedAt,
        approvedBy: lihokCorporateDocumentVersions.approvedBy,
      })
      .from(lihokCorporateDocumentVersions)
      .where(
        and(
          eq(lihokCorporateDocumentVersions.id, input.versionId),
          eq(lihokCorporateDocumentVersions.documentId, input.documentId),
        ),
      )
      .limit(1);

    if (!versionRows.length) {
      throw Errors.notFound("Version not found.");
    }

    const version = versionRows[0];
    const fromStatus = parseStatus(version.status);
    const toStatus = parseStatus(input.status);

    if (toStatus === "superseded") {
      throw Errors.badRequest("Supersession occurs automatically when a new version is approved.");
    }

    if (fromStatus === toStatus) {
      return c.json({ version: { id: version.id, status: version.status } });
    }

    if (!isValidStatusTransition(fromStatus, toStatus)) {
      throw Errors.badRequest(`Invalid status transition from ${fromStatus} to ${toStatus}.`);
    }

    if ((toStatus === "for_review" || toStatus === "approved") && !hasCompletedStorage(version)) {
      throw Errors.badRequest("A completed file upload is required before review or approval.");
    }

    if (toStatus === "approved") {
      requireAdmin(user);
      if (version.uploadedBy === user.id) {
        throw Errors.forbidden("Uploaders cannot approve their own versions.");
      }
    }

    const now = new Date();

    const updatedVersion = await db.transaction(async (tx) => {
      const updateData: Partial<typeof lihokCorporateDocumentVersions.$inferInsert> = {
        status: toStatus,
        updatedAt: now,
      };

      if (toStatus === "approved") {
        updateData.approvedBy = user.id;
        updateData.approvedAt = now;

        // Supersede any previously approved version for this document.
        const previousApproved = await tx
          .select({ id: lihokCorporateDocumentVersions.id })
          .from(lihokCorporateDocumentVersions)
          .where(
            and(
              eq(lihokCorporateDocumentVersions.documentId, input.documentId),
              eq(lihokCorporateDocumentVersions.status, "approved"),
              sql`${lihokCorporateDocumentVersions.id} <> ${input.versionId}`,
            ),
          )
          .limit(1);

        if (previousApproved.length) {
          await tx
            .update(lihokCorporateDocumentVersions)
            .set({
              status: "superseded",
              supersededByVersionId: input.versionId,
              updatedAt: now,
            })
            .where(eq(lihokCorporateDocumentVersions.id, previousApproved[0].id));

          await logAudit(tx, {
            documentId: input.documentId,
            versionId: previousApproved[0].id,
            action: "version.superseded",
            actor: user,
            newValue: { supersededByVersionId: input.versionId },
          });
        }
      }

      const updated = await tx
        .update(lihokCorporateDocumentVersions)
        .set(updateData)
        .where(eq(lihokCorporateDocumentVersions.id, input.versionId))
        .returning({ id: lihokCorporateDocumentVersions.id, status: lihokCorporateDocumentVersions.status });

      if (!updated.length) {
        throw Errors.notFound("Version not found.");
      }

      await logAudit(tx, {
        documentId: input.documentId,
        versionId: input.versionId,
        action: "version.status_changed",
        actor: user,
        oldValue: { status: fromStatus },
        newValue: { status: toStatus, changeNotes: input.changeNotes ?? null },
      });

      return updated[0];
    });

    return c.json({ version: updatedVersion });
  } catch (error) {
    const { status, body } = handleError(error);
    return c.json(body, status);
  }
});

// ----------------------------------------------------------------------------
// Audit
// ----------------------------------------------------------------------------

lihokCorporateRouter.get("/documents/:id/audit", async (c) => {
  try {
    await requireUser(c.req.raw.headers);

    const documentId = Number(c.req.param("id"));
    if (!Number.isInteger(documentId) || documentId <= 0) return c.json({ error: "Invalid document id." }, 400);

    const versionId = c.req.query("versionId");
    const limit = Math.min(Number(c.req.query("limit") || "50"), 100);
    const offset = Math.max(Number(c.req.query("offset") || "0"), 0);

    const conditions = [eq(lihokCorporateDocumentAudit.documentId, documentId)];
    if (versionId) {
      conditions.push(eq(lihokCorporateDocumentAudit.versionId, Number(versionId)));
    }

    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(lihokCorporateDocumentAudit)
      .where(and(...conditions))
      .limit(1);
    const total = totalRows[0]?.count ?? 0;

    const rows = await db
      .select({
        id: lihokCorporateDocumentAudit.id,
        documentId: lihokCorporateDocumentAudit.documentId,
        versionId: lihokCorporateDocumentAudit.versionId,
        action: lihokCorporateDocumentAudit.action,
        actorUserId: lihokCorporateDocumentAudit.actorUserId,
        actorName: lihokCorporateDocumentAudit.actorName,
        oldValue: lihokCorporateDocumentAudit.oldValue,
        newValue: lihokCorporateDocumentAudit.newValue,
        requestId: lihokCorporateDocumentAudit.requestId,
        createdAt: lihokCorporateDocumentAudit.createdAt,
      })
      .from(lihokCorporateDocumentAudit)
      .where(and(...conditions))
      .orderBy(sql`${lihokCorporateDocumentAudit.createdAt} DESC`)
      .limit(limit)
      .offset(offset);

    return c.json({ items: rows, pagination: { total, limit, offset } });
  } catch (error) {
    const { status, body } = handleError(error);
    return c.json(body, status);
  }
});

// ----------------------------------------------------------------------------
// Mount helpers for boot.ts
// ----------------------------------------------------------------------------

export default lihokCorporateRouter;
