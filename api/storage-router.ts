import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm"
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  docFiles,
  docFolders,
  governanceFacilities,
  governanceUploads,
  projectWithoutPPPFiles,
  projectsWithoutPPP,
  smpDocuments,
  storageUploadIntents,
  users,
  type User,
} from "@db/schema";
import {
  STORAGE_BUCKET_BY_MODULE,
  STORAGE_MODULES,
  STORAGE_SIGNED_URL_TTL_SECONDS,
  STORAGE_UPLOAD_INTENT_TTL_MS,
  TUS_CHUNK_SIZE_BYTES,
  type StorageFileSource,
  type StorageModule,
} from "@contracts/storage";
import {
  MAX_UPLOAD_ERROR_MESSAGE,
  isUploadFileSizeAllowed,
} from "@contracts/upload-limits";
import { authenticateRequest } from "./auth/authenticate";
import { env } from "./lib/env";
import { deepEqualJson } from "./lib/json-equality";
import { db } from "./queries/connection";
import { getStorageFeatureFlags, isStorageUploadEnabled } from "./storage-feature-flags";
import { deleteStoredFileRecord, getStoredFileRecord } from "./storage-files";
import { getSupabaseStorageAdmin, getSupabaseStorageConfig } from "./supabase-storage";
import { getFinalizedStorageSizeError, normalizeGovernanceMilestoneId, validateUploadDescriptor } from "./storage-validation";
import { generateCapabilityClaims, generateDeleteCapabilityClaims, signCapabilityClaims, signDeleteCapability, verifyCapabilityToken, hashCapabilityToken } from "./upload-capability";
import { getClientIdentifier, getRateLimitForClient } from "./lib/client-ip";

const SUPABASE_SIGNED_TUS_PATH = "/storage/v1/upload/resumable/sign";

// System-owned submitter label persisted for public (anonymous) masterdata
// submissions, which have no users-table row.
const PUBLIC_SUBMITTER_LABEL = "Public Project Submission";

export const storageRouter = new Hono();

const sourceSchema = z.enum(["doc_files", "governance_uploads", "governance_files", "smp_documents", "project_without_ppp_files"]);
const authorizeSchema = z.object({
  module: z.enum(STORAGE_MODULES),
  originalFilename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  fileSize: z.number().int().nonnegative(),
  target: z.record(z.string(), z.unknown()),
});
const intentSchema = z.object({ intentId: z.string().uuid() });
const capabilitySchema = z.object({ 
  intentId: z.string().uuid(),
  capabilityToken: z.string().optional(),
});

function sanitizeHeaderFilename(value: string) {
  return value.replace(/[\r\n"\\]/g, "_");
}

function inferMimeType(fileName: string, stored: string | null) {
  if (stored?.trim()) return stored.trim();
  const ext = fileName.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", txt: "text/plain",
    csv: "text/csv", json: "application/json", zip: "application/zip",
    doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return ext ? map[ext] || "application/octet-stream" : "application/octet-stream";
}

function decodeLegacyData(value: string, fallbackMime: string) {
  let mimeType = fallbackMime;
  let encoded = value.trim();
  if (encoded.startsWith("data:")) {
    const comma = encoded.indexOf(",");
    const header = comma >= 0 ? encoded.slice(5, comma) : "";
    const declared = header.split(";")[0];
    if (declared) mimeType = declared;
    encoded = comma >= 0 ? encoded.slice(comma + 1) : "";
  }
  return { mimeType, buffer: Buffer.from(encoded, "base64") };
}

async function requireUser(headers: Headers): Promise<User> {
  return authenticateRequest(headers);
}

async function optionalUser(headers: Headers): Promise<User | null> {
  try {
    return await authenticateRequest(headers);
  } catch {
    return null;
  }
}

function normalizedSegment(value: unknown, label: string, maxLength = 80) {
  const segment = String(value ?? "").trim().toLowerCase();
  if (!segment || segment.length > maxLength || !/^[a-z0-9_-]+$/.test(segment)) {
    throw new Error(`Invalid ${label}.`);
  }
  return segment;
}

async function validateTarget(module: StorageModule, target: Record<string, unknown>) {
  if (module === "om") {
    const folderId = Number(target.folderId);
    if (!Number.isInteger(folderId) || folderId <= 0) throw new Error("A valid target folder is required.");
    const rows = await db.select({ id: docFolders.id }).from(docFolders).where(eq(docFolders.id, folderId)).limit(1);
    if (!rows.length) throw new Error("Target folder not found.");
    return { folderId };
  }
  if (module === "smp") {
    const documentId = Number(target.documentId);
    if (!Number.isInteger(documentId) || documentId <= 0) throw new Error("A valid SMP document is required.");
    const rows = await db.select({ id: smpDocuments.id }).from(smpDocuments).where(eq(smpDocuments.id, documentId)).limit(1);
    if (!rows.length) throw new Error("SMP document not found.");
    return { documentId };
  }
  if (module === "projects_without_ppp") {
    const projectId = Number(target.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) throw new Error("A valid project is required.");
    const rows = await db.select({ id: projectsWithoutPPP.id }).from(projectsWithoutPPP).where(eq(projectsWithoutPPP.id, projectId)).limit(1);
    if (!rows.length) throw new Error("Project not found.");
    return { projectId };
  }

  const facilitySlug = normalizedSegment(target.facilitySlug, "facility", 50);
  const milestoneId = normalizeGovernanceMilestoneId(target.milestoneId);
  const category = String(target.category ?? "other").trim().slice(0, 50) || "other";
  const tocItem = target.tocItem == null ? null : String(target.tocItem).trim().slice(0, 20) || null;
  if (facilitySlug !== "all") {
    const rows = await db.select({ slug: governanceFacilities.slug })
      .from(governanceFacilities).where(eq(governanceFacilities.slug, facilitySlug)).limit(1);
    if (!rows.length) throw new Error("Governance facility not found.");
  }
  return { facilitySlug, milestoneId, category, tocItem };
}

function safeObjectFilename(fileName: string) {
  const base = fileName.split("/").pop() ?? fileName;
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").toLowerCase().slice(0, 255);
}

function buildObjectPath(module: StorageModule, target: Record<string, unknown>, originalFilename: string) {
  const id = randomUUID();
  if (module === "om") return `v1/folder-${target.folderId}/${id}`;
  if (module === "smp") return `v1/document-${target.documentId}/${id}`;
  if (module === "projects_without_ppp") return `v1/project-${target.projectId}/${id}`;
  return `v1/${target.facilitySlug}/${target.milestoneId}/${id}`;
}

function getSourceFromModule(module: StorageModule): StorageFileSource {
  if (module === "om") return "doc_files";
  if (module === "smp") return "smp_documents";
  if (module === "projects_without_ppp") return "project_without_ppp_files";
  return "governance_uploads";
}


// Rate limit check result type
type RateLimitResult = 
  | { allowed: true }
  | { allowed: false; limit: "count" | "bytes" | "unknown"; isSystemError: false }
  | { allowed: false; limit: "system"; isSystemError: true };

// Injectable database executor for testability
export type RateLimitDbExecutor = {
  execute: (query: any) => Promise<any[]>;
};

// Internal implementation with injectable executor for testing
function validateDecimalString(value: number, minValue: number, paramName: string): string {
  // Reject NaN, Infinity, fractional numbers, and unsafe integers
  // Check NaN first (NaN is not equal to itself)
  if (value !== value) { // NaN check
    throw new Error(`Invalid ${paramName}: NaN not allowed`);
  }
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${paramName}: must be a finite number`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid ${paramName}: must be a safe integer`);
  }
  if (value < minValue) {
    throw new Error(`Invalid ${paramName}: below minimum ${minValue}`);
  }
  // Convert to decimal string (no exponential notation)
  return value.toString(10);
}

export async function checkRateLimitWithExecutor(
  deps: {
    clientId: string;
    isTrusted: boolean;
    declaredBytes: number;
    db: RateLimitDbExecutor;
    now?: Date;
  }
): Promise<RateLimitResult> {
  const { clientId, isTrusted, declaredBytes, db, now = new Date() } = deps;

  const windowStart = new Date(now);
  windowStart.setMinutes(0, 0, 0);

  // Convert to wire-safe ISO string for postgres.js
  const windowStartIso = windowStart.toISOString();

  // Compute rate limits once
  const limits = getRateLimitForClient({ isTrusted });

  // Validate and convert numeric parameters to decimal strings for wire safety
  const declaredBytesStr = validateDecimalString(declaredBytes, 0, "declaredBytes");
  const maxIntentsStr = validateDecimalString(limits.maxIntents, 1, "maxIntents");
  const maxBytesStr = validateDecimalString(limits.maxBytes, 1, "maxBytes");

  // Atomic upsert that returns empty on over-limit
  // All parameters are wire-safe strings with explicit PostgreSQL casts
  let result: any[];
  try {
    result = await db.execute(sql`
      INSERT INTO upload_rate_limits
        (client_identifier, window_start, intent_count, total_bytes)
      VALUES (${clientId}, ${windowStartIso}::timestamptz, 1, ${declaredBytesStr}::bigint)
      ON CONFLICT (client_identifier, window_start)
      DO UPDATE SET
        intent_count = upload_rate_limits.intent_count + 1,
        total_bytes = upload_rate_limits.total_bytes + ${declaredBytesStr}::bigint
      WHERE upload_rate_limits.intent_count < ${maxIntentsStr}::integer
        AND upload_rate_limits.total_bytes + ${declaredBytesStr}::bigint <= ${maxBytesStr}::bigint
      RETURNING intent_count, total_bytes
    `);
  } catch (dbError: any) {
    // Log only safe metadata - never SQL text, params, client identifiers, or error messages
    const errorCode = dbError?.cause?.code ?? dbError?.code ?? "UNKNOWN";
    console.error("[RATE_LIMIT] Database upsert failed", {
      errorCode,
      isTrusted,
      declaredBytesRange: declaredBytes > 100 * 1024 * 1024 ? "large" : "small",
    });
    // Fail closed with system error - caller should return 503
    return { allowed: false, limit: "system", isSystemError: true };
  }
  
  if (result.length === 0) {
    // Try to determine if this is actually a rate limit or a system error
    try {
      const existing = await db.execute(sql`
        SELECT intent_count, total_bytes
        FROM upload_rate_limits
        WHERE client_identifier = ${clientId}
        AND window_start = ${windowStartIso}::timestamptz
      `);
      
      if (existing.length > 0) {
        const row = existing[0];
        const count = Number(row.intent_count);
        const bytes = Number(row.total_bytes);
        
        if (count >= limits.maxIntents) {
          return { allowed: false, limit: "count", isSystemError: false };
        }
        if (bytes + declaredBytes > limits.maxBytes) {
          return { allowed: false, limit: "bytes", isSystemError: false };
        }
      }
      return { allowed: false, limit: "unknown", isSystemError: false };
    } catch (selectError: any) {
      // Follow-up SELECT failed - log minimal info and fail closed
      const errorCode = selectError?.cause?.code ?? selectError?.code ?? "UNKNOWN";
      console.error("[RATE_LIMIT] Database select failed", {
        errorCode,
        isTrusted,
      });
      return { allowed: false, limit: "system", isSystemError: true };
    }
  }
  
  return { allowed: true };
}

// Production wrapper that uses the global db
async function checkRateLimit(
  clientId: string, 
  isTrusted: boolean, 
  declaredBytes: number
): Promise<RateLimitResult> {
  return checkRateLimitWithExecutor({
    clientId,
    isTrusted,
    declaredBytes,
    db: { execute: (q) => db.execute(q) },
  });
}
async function verifyCapabilityForIntent(intentId: string, providedToken: string): Promise<boolean> {
  const providedHash = hashCapabilityToken(providedToken);
  
  const intent = await db.query.storageUploadIntents.findFirst({
    where: eq(storageUploadIntents.id, intentId),
  });
  
  if (!intent) return false;
  if (intent.status !== "pending") return false;
  if (intent.capabilityTokenHash === null) return false;
  if (intent.capabilityConsumedAt !== null) return false;
  if (intent.capabilityExpiresAt && intent.capabilityExpiresAt < new Date()) return false;
  
  const expectedHash = intent.capabilityTokenHash;
  if (providedHash.length !== expectedHash.length) return false;
  
  const match = timingSafeEqual(Buffer.from(providedHash), Buffer.from(expectedHash));
  if (!match) return false;
  
  const claims = verifyCapabilityToken(providedToken);
  if (!claims) return false;
  
  const canonicalMatch = 
    claims.intentId === intent.id &&
    claims.mod === intent.module &&
    claims.src === getSourceFromModule(intent.module as StorageModule) &&
    deepEqualJson(claims.tgt, intent.targetContext) &&
    claims.bucket === intent.expectedBucket &&
    claims.path === intent.expectedPath &&
    claims.fn === intent.originalFilename &&
    claims.mime === intent.expectedMimeType &&
    claims.size === intent.expectedSize &&
    claims.jti === intent.capabilityJti;
  
  return canonicalMatch;
}

function signDeletePayload(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", env.appSecret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyDeletePayload(token: string) {
  const [encoded, supplied] = token.split(".");
  if (!encoded || !supplied) return null;
  const expected = createHmac("sha256", env.appSecret).update(encoded).digest();
  const actual = Buffer.from(supplied, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  return payload && Number(payload.exp) >= Date.now() ? payload : null;
}

storageRouter.get("/config", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({ flags: getStorageFeatureFlags() });
});

storageRouter.post("/uploads/authorize", async (c) => {
  try {
    const user = await optionalUser(c.req.raw.headers);
    const input = authorizeSchema.parse(await c.req.json());
    
    if (!isUploadFileSizeAllowed(input.fileSize)) {
      return c.json({ error: MAX_UPLOAD_ERROR_MESSAGE }, 413);
    }

    // Masterdata submittal uploads are PUBLIC: anonymous callers are supported
    // through the repository's existing capability-token architecture (bound
    // to one project + one intent; finalize required for persisted evidence).
    // Anonymous callers are rate-limited below; validation (format/MIME/size)
    // and the existing Supabase RLS/revoke posture remain in force.

    // Rate limiting for anonymous users
    if (!user) {
      const client = getClientIdentifier(c.req.raw.headers);
      const rateCheck = await checkRateLimit(client.id, client.isTrusted, input.fileSize);
      if (!rateCheck.allowed) {
        // System errors return 503, rate limits return 429
        if (rateCheck.isSystemError) {
          return c.json({ error: "Upload authorization is temporarily unavailable." }, 503);
        }
        const message = rateCheck.limit === 'count' 
          ? "Rate limit exceeded: 100 uploads per hour."
          : "Rate limit exceeded: 5 GB per hour.";
        return c.json({ error: message }, 429);
      }
    }
    
    const descriptor = validateUploadDescriptor(input.module, input.originalFilename, input.mimeType);
    if (!isStorageUploadEnabled(input.module)) {
      return c.json({ storageEnabled: false, error: "Supabase Storage upload is disabled for this module." }, 409);
    }
    
    const target = await validateTarget(input.module, input.target);
    const expectedBucket = STORAGE_BUCKET_BY_MODULE[input.module];
    const expectedPath = buildObjectPath(input.module, target, input.originalFilename);
    const intentId = randomUUID();
    const expiresAt = new Date(Date.now() + STORAGE_UPLOAD_INTENT_TTL_MS);
    const source = getSourceFromModule(input.module);
    
    // Generate capability token for anonymous users
    let capabilityToken: string | undefined;
    let capabilityJti: string | undefined;
    let capabilityTokenHash: string | undefined;
    let capabilityExpiresAt: Date | undefined;
    
    if (!user) {
      const claims = generateCapabilityClaims(
        intentId,
        input.module,
        source,
        target,
        expectedPath,
        expectedBucket,
        input.originalFilename,
        descriptor.mimeType,
        input.fileSize
      );
      capabilityToken = signCapabilityClaims(claims);
      capabilityJti = claims.jti;
      capabilityTokenHash = hashCapabilityToken(capabilityToken);
      capabilityExpiresAt = new Date(claims.exp * 1000);
    }
    
    const storage = getSupabaseStorageAdmin();
    const { data, error } = await storage.storage.from(expectedBucket)
      .createSignedUploadUrl(expectedPath, { upsert: false });
    if (error || !data?.token) throw new Error(error?.message || "Unable to create signed upload authorization.");
    
    await db.insert(storageUploadIntents).values({
      id: intentId,
      module: input.module,
      targetContext: target,
      expectedBucket,
      expectedPath,
      originalFilename: input.originalFilename,
      expectedSize: input.fileSize,
      expectedMimeType: descriptor.mimeType,
      requestedBy: user?.id ?? null,
      capabilityJti,
      capabilityTokenHash,
      capabilityExpiresAt,
      status: "pending",
      expiresAt,
    });
    
    return c.json({
      storageEnabled: true,
      intentId,
      capabilityToken, // Only returned for anonymous
      endpoint: `${getSupabaseStorageConfig().directStorageUrl}${SUPABASE_SIGNED_TUS_PATH}`,
      token: data.token,
      bucket: expectedBucket,
      path: expectedPath,
      chunkSize: TUS_CHUNK_SIZE_BYTES,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error: any) {
    const message = error?.issues?.[0]?.message || error?.message || "Upload authorization failed.";
    return c.json({ error: message }, 400);
  }
});
storageRouter.post("/uploads/resume", async (c) => {
  try {
    const body = await c.req.json();
    const { intentId, capabilityToken } = capabilitySchema.parse(body);
    
    const intent = await db.query.storageUploadIntents.findFirst({
      where: eq(storageUploadIntents.id, intentId),
    });
    
    if (!intent) return c.json({ error: "Upload intent not found." }, 404);
    if (intent.status !== "pending" || intent.expiresAt.getTime() < Date.now()) {
      return c.json({ error: "Upload intent is no longer active." }, 409);
    }
    
    // Verify ownership
    if (intent.requestedBy) {
      try {
        const user = await authenticateRequest(c.req.raw.headers);
        if (user.id !== intent.requestedBy) {
          return c.json({ error: "Unauthorized." }, 401);
        }
      } catch {
        return c.json({ error: "Authentication required." }, 401);
      }
    } else {
      if (!capabilityToken) {
        return c.json({ error: "Capability token required for anonymous resume." }, 401);
      }
      const valid = await verifyCapabilityForIntent(intentId, capabilityToken);
      if (!valid) {
        return c.json({ error: "Invalid capability token." }, 403);
      }
    }
    
    const module = z.enum(STORAGE_MODULES).parse(intent.module);
    if (!isStorageUploadEnabled(module)) {
      return c.json({ error: "Supabase Storage upload is disabled for this module." }, 409);
    }
    
    const { data, error } = await getSupabaseStorageAdmin().storage.from(intent.expectedBucket)
      .createSignedUploadUrl(intent.expectedPath, { upsert: false });
    if (error || !data?.token) throw new Error(error?.message || "Unable to resume signed upload authorization.");
    
    return c.json({
      storageEnabled: true,
      intentId: intent.id,
      endpoint: `${getSupabaseStorageConfig().directStorageUrl}${SUPABASE_SIGNED_TUS_PATH}`,
      token: data.token,
      bucket: intent.expectedBucket,
      path: intent.expectedPath,
      chunkSize: TUS_CHUNK_SIZE_BYTES,
      expiresAt: intent.expiresAt.toISOString(),
    });
  } catch (error: any) {
    const message = error?.issues?.[0]?.message || error?.message || "Upload resume authorization failed.";
    return c.json({ error: message }, 400);
  }
});
storageRouter.post("/uploads/finalize", async (c) => {
  try {
    const body = await c.req.json();
    const { intentId, capabilityToken } = capabilitySchema.parse(body);
    
    const intent = await db.query.storageUploadIntents.findFirst({
      where: eq(storageUploadIntents.id, intentId),
    });
    
    if (!intent) return c.json({ error: "Upload intent not found." }, 404);
    if (intent.status === "finalized") return c.json({ success: true, alreadyFinalized: true });
    if (intent.status !== "pending" || intent.expiresAt.getTime() < Date.now()) {
      return c.json({ error: "Upload intent is no longer active." }, 409);
    }
    
    // Verify ownership
    if (intent.requestedBy) {
      try {
        const user = await authenticateRequest(c.req.raw.headers);
        if (user.id !== intent.requestedBy) {
          return c.json({ error: "Unauthorized." }, 401);
        }
      } catch {
        return c.json({ error: "Authentication required." }, 401);
      }
    } else {
      if (!capabilityToken) {
        return c.json({ error: "Capability token required for anonymous finalize." }, 401);
      }
      const valid = await verifyCapabilityForIntent(intentId, capabilityToken);
      if (!valid) {
        return c.json({ error: "Invalid capability token." }, 403);
      }
    }
    
    const storage = getSupabaseStorageAdmin();
    const { data: info, error } = await storage.storage.from(intent.expectedBucket).info(intent.expectedPath);
    if (error || !info) throw new Error(error?.message || "Uploaded object was not found.");
    if (info.bucketId !== intent.expectedBucket || info.name !== intent.expectedPath) {
      await db.update(storageUploadIntents).set({ status: "cleanup_required", failureReason: "Storage object identity mismatch." })
        .where(eq(storageUploadIntents.id, intent.id));
      return c.json({ error: "Uploaded object did not match the authorization." }, 409);
    }
    const actualSize = Number(info.size);
    const sizeError = getFinalizedStorageSizeError(actualSize, intent.expectedSize);
    if (sizeError) {
      await db.update(storageUploadIntents).set({ status: "cleanup_required", failureReason: "Storage object size mismatch." })
        .where(eq(storageUploadIntents.id, intent.id));
      return c.json({ error: sizeError.error }, sizeError.status);
    }
    const expectedMime = intent.expectedMimeType.split(";", 1)[0].trim().toLowerCase();
    const actualMime = info.contentType?.split(";", 1)[0].trim().toLowerCase();
    if (!actualMime || actualMime !== expectedMime) {
      await db.update(storageUploadIntents).set({ status: "cleanup_required", failureReason: "Storage object MIME type mismatch." })
        .where(eq(storageUploadIntents.id, intent.id));
      return c.json({ error: "Uploaded object MIME type did not match the authorization." }, 409);
    }
    
    const target = intent.targetContext as Record<string, any>;
    const now = new Date();
    
    const result = await db.transaction(async (tx) => {
      // Atomic status transition with capability consumption
      const claimed = await tx.update(storageUploadIntents).set({ 
        status: "finalized",
        capabilityConsumedAt: new Date(),
        finalizedAt: new Date(),
      }).where(and(
        eq(storageUploadIntents.id, intent.id),
        eq(storageUploadIntents.status, "pending"),
      )).returning({ id: storageUploadIntents.id });
      
      if (!claimed.length) throw new Error("Upload intent is already being finalized.");
      
      let persistedId: number;
      let persistedSource: StorageFileSource;
      
      if (intent.module === "om") {
        const inserted = await tx.insert(docFiles).values({
          folderId: Number(target.folderId),
          title: intent.originalFilename.replace(/\.[^.]+$/, ""),
          fileName: intent.originalFilename,
          fileType: intent.expectedMimeType,
          fileSize: actualSize,
          fileData: null,
          fileUrl: "",
          uploadedBy: "anonymous",
          storageProvider: "supabase",
          storageBucket: intent.expectedBucket,
          storagePath: intent.expectedPath,
          storageSize: actualSize,
          storageMimeType: actualMime,
          storageEtag: info.etag,
          storageUploadedAt: now,
          uploadedAt: now,
          updatedAt: now,
        }).returning({ id: docFiles.id });
        persistedId = inserted[0].id;
        persistedSource = "doc_files";
      } else if (intent.module === "smp") {
        const inserted = await tx.insert(smpDocuments).values({
          code: target.code || `SMP-${Date.now()}`,
          title: intent.originalFilename.replace(/\.[^.]+$/, ""),
          fileName: intent.originalFilename,
          fileType: intent.expectedMimeType,
          storageProvider: "supabase",
          storageBucket: intent.expectedBucket,
          storagePath: intent.expectedPath,
          storageSize: actualSize,
          storageMimeType: actualMime,
          storageEtag: info.etag,
          storageUploadedAt: now,
          createdAt: now,
          updatedAt: now,
        }).returning({ id: smpDocuments.id });
        persistedId = inserted[0].id;
        persistedSource = "smp_documents";
      } else if (intent.module === "projects_without_ppp") {
        // Public (anonymous) uploads have no users-table row: persist a neutral
        // system-owned submitter label rather than a fabricated personal name.
        const submitter = intent.requestedBy
          ? (await tx.select({ name: users.name }).from(users).where(eq(users.id, intent.requestedBy)).limit(1))[0]?.name ?? null
          : PUBLIC_SUBMITTER_LABEL;
        const inserted = await tx.insert(projectWithoutPPPFiles).values({
          projectId: Number(target.projectId),
          fileName: intent.originalFilename,
          fileType: intent.expectedMimeType,
          fileSize: actualSize,
          fileData: null,
          uploadedBy: submitter,
          uploadedAt: now,
          submittedAt: now,
          storageProvider: "supabase",
          storageBucket: intent.expectedBucket,
          storagePath: intent.expectedPath,
          storageSize: actualSize,
          storageMimeType: actualMime,
          storageEtag: info.etag,
          storageUploadedAt: now,
        }).returning({ id: projectWithoutPPPFiles.id });
        persistedId = inserted[0].id;
        persistedSource = "project_without_ppp_files";
      } else {
        const inserted = await tx.insert(governanceUploads).values({
          facilitySlug: target.facilitySlug,
          milestoneId: target.milestoneId,
          category: target.category || "other",
          tocItem: target.tocItem,
          fileName: intent.originalFilename,
          fileUrl: "",
          uploadedBy: "anonymous",
          storageProvider: "supabase",
          storageBucket: intent.expectedBucket,
          storagePath: intent.expectedPath,
          storageSize: actualSize,
          storageMimeType: actualMime,
          storageEtag: info.etag,
          storageUploadedAt: now,
          uploadedAt: now,
        }).returning({ id: governanceUploads.id });
        persistedId = inserted[0].id;
        persistedSource = "governance_uploads";
      }
      
      return { fileId: persistedId, source: persistedSource };
    });
    
    // Governed deletion capability: issued ONLY to the uploader (their own
    // finalize response). Binds deletion to exactly this file + project.
    const response: Record<string, unknown> = {
      success: true,
      fileId: result.fileId,
      source: result.source,
    };
    if (intent.module === "projects_without_ppp") {
      response.deleteCapability = signDeleteCapability(
        generateDeleteCapabilityClaims(result.fileId, Number(target.projectId)),
      );
    }
    return c.json(response);
  } catch (error: any) {
    const message = error?.message || "Finalize failed.";
    return c.json({ error: message }, 400);
  }
});

storageRouter.post("/uploads/abandon", async (c) => {
  try {
    const body = await c.req.json();
    const { intentId, capabilityToken } = capabilitySchema.parse(body);
    
    const intent = await db.query.storageUploadIntents.findFirst({
      where: eq(storageUploadIntents.id, intentId),
    });
    
    if (!intent) return c.json({ error: "Upload intent not found." }, 404);
    if (intent.status !== "pending") {
      return c.json({ success: true, alreadyProcessed: true });
    }
    
    // Verify ownership
    if (intent.requestedBy) {
      try {
        const user = await authenticateRequest(c.req.raw.headers);
        if (user.id !== intent.requestedBy) {
          return c.json({ error: "Unauthorized." }, 401);
        }
      } catch {
        return c.json({ error: "Authentication required." }, 401);
      }
    } else {
      if (!capabilityToken) {
        return c.json({ error: "Capability token required for anonymous abandon." }, 401);
      }
      const valid = await verifyCapabilityForIntent(intentId, capabilityToken);
      if (!valid) {
        return c.json({ error: "Invalid capability token." }, 403);
      }
    }
    
    // Atomic abandon with capability consumption
    const updated = await db.update(storageUploadIntents)
      .set({ 
        status: "abandoned",
        abandonedAt: new Date(),
        capabilityConsumedAt: new Date(),
      })
      .where(and(
        eq(storageUploadIntents.id, intentId),
        eq(storageUploadIntents.status, "pending"),
      ))
      .returning({ id: storageUploadIntents.id });
    
    return c.json({ success: true, abandoned: updated.length > 0 });
  } catch (error: any) {
    const message = error?.message || "Abandon failed.";
    return c.json({ error: message }, 400);
  }
});

storageRouter.get("/files/:source/:id/:action", async (c) => {
  try {
    const source = sourceSchema.parse(c.req.param("source"));
    const id = Number(c.req.param("id"));
    const action = c.req.param("action");
    if (!Number.isInteger(id) || !["view", "download"].includes(action)) return c.json({ error: "Invalid file request." }, 400);

    const record = await getStoredFileRecord(source, id);
    if (!record) return c.json({ error: "File not found." }, 404);
    if (record.storagePath && record.storageBucket) {
      const { data, error } = await getSupabaseStorageAdmin().storage.from(record.storageBucket)
        .createSignedUrl(record.storagePath, STORAGE_SIGNED_URL_TTL_SECONDS, action === "download" ? { download: sanitizeHeaderFilename(record.fileName) } : undefined);
      if (error || !data?.signedUrl) throw new Error(error?.message || "Unable to sign file URL.");
      return c.redirect(data.signedUrl, 302);
    }
    if (!record.legacyData) return c.json({ error: "File content is unavailable." }, 404);
    const decoded = decodeLegacyData(record.legacyData, inferMimeType(record.fileName, record.mimeType));
    if (!decoded.buffer.length) return c.json({ error: "File content is unavailable." }, 404);
    const fileName = sanitizeHeaderFilename(record.fileName);
    const viewable = decoded.mimeType === "application/pdf" || decoded.mimeType.startsWith("image/") || decoded.mimeType.startsWith("text/");
    c.header("Content-Type", decoded.mimeType);
    c.header("Content-Disposition", `${action === "view" && viewable ? "inline" : "attachment"}; filename="${fileName}"`);
    c.header("Content-Length", String(decoded.buffer.length));
    c.header("Cache-Control", "private, max-age=120");
    c.header("X-Content-Type-Options", "nosniff");
    return c.body(decoded.buffer as any);
  } catch (error: any) {
    // Sanitize internal errors to avoid exposing SQL, paths, credentials, or stack traces
    console.error("[storage/files] Error: file access failed");
    return c.json({ error: "Unable to access file." }, 500);
  }
});

storageRouter.post("/files/delete/prepare", async (c) => {
  try {
    const input = z.object({ source: sourceSchema, id: z.number().int().positive() }).parse(await c.req.json());
    // Project masterdata files are never publicly deletable.
    if (input.source === "project_without_ppp_files") {
      return c.json({ error: "Project masterdata files cannot be deleted through the public endpoint." }, 403);
    }
    const record = await getStoredFileRecord(input.source, input.id);
    if (!record) return c.json({ error: "File not found." }, 404);
    const expiresAt = Date.now() + 5 * 60_000;
    // Use anonymous session ID for public deletion (no user auth required)
    const sessionId = randomUUID();
    const confirmationToken = signDeletePayload({
      source: input.source, id: input.id, sessionId: sessionId,
      bucket: record.storageBucket, path: record.storagePath, exp: expiresAt,
    });
    return c.json({ confirmationToken, expiresAt: new Date(expiresAt).toISOString(), fileName: record.fileName, storageBacked: Boolean(record.storagePath) });
  } catch (error: any) {
    const message = error?.message || "Delete verification failed.";
    return c.json({ error: message }, 400);
  }
});

storageRouter.post("/files/delete/confirm", async (c) => {
  try {
    const { confirmationToken } = z.object({ confirmationToken: z.string().min(1) }).parse(await c.req.json());
    const payload = verifyDeletePayload(confirmationToken);
    if (!payload || !payload.sessionId) return c.json({ error: "Delete confirmation is invalid or expired." }, 409);
    const source = sourceSchema.parse(payload.source);
    // Project masterdata files are never publicly deletable.
    if (source === "project_without_ppp_files") {
      return c.json({ error: "Project masterdata files cannot be deleted through the public endpoint." }, 403);
    }
    const id = Number(payload.id);
    const record = await getStoredFileRecord(source, id);
    if (!record) return c.json({ error: "File not found." }, 404);
    if (record.storageBucket !== payload.bucket || record.storagePath !== payload.path) {
      return c.json({ error: "File changed after delete verification." }, 409);
    }
    if (record.storageBucket && record.storagePath) {
      const { error } = await getSupabaseStorageAdmin().storage.from(record.storageBucket).remove([record.storagePath]);
      if (error) throw new Error(`Storage deletion failed: ${error.message}`);
    }
    await deleteStoredFileRecord(source, id);
    return c.json({ success: true, id, source });
  } catch (error: any) {
    const message = error?.message || "Delete failed.";
    const status = message.includes("authentication") || message.includes("token") ? 401 : 400;
    return c.json({ error: message }, status);
  }
});
