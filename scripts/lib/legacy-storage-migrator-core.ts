// Legacy Storage Migrator Core Module
// Production-safe migration functions with dependency injection

import { createHash, randomBytes } from "node:crypto";
import type { createWriteStream, createReadStream } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";

// Types
export type StorageFileSource = "doc_files" | "governance_files" | "governance_uploads" | "smp_documents";

export interface MigrationRecord {
  id: number;
  fileName: string | null;
  fileType: string | null;
  legacyDataLength: number;
  legacyDataPrefix: string | null;
}

export interface DecodedPayload {
  size: number;
  sha256: string;
  mimeType: string;
}

export interface LeaseInfo {
  owner: string;
  expiresAt: Date;
  heartbeatAt: Date;
}

export type ObjectInspectionResult =
  | { status: "missing" }
  | { status: "verified_match"; etag: string | null }
  | { status: "verified_mismatch"; reason: string }
  | { status: "indeterminate"; reason: string };

// State machine
export const VALID_STATE_TRANSITIONS: Record<string, string[]> = {
  inventoried: ["uploading", "excluded"],
  uploading: ["uploaded", "failed"],
  uploaded: ["object_verified", "failed"],
  object_verified: ["metadata_committed", "failed"],
  metadata_committed: ["app_verified", "rollback_required", "failed"],
  rollback_required: ["rolled_back", "failed"],
  rolled_back: ["uploading"],
  conflict: [],
  failed: ["uploading", "excluded"],
  app_verified: [],
  excluded: [],
};

// MIME type mapping
export const EXT_TO_MIME: Record<string, string> = {
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
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

// Configuration
export const BASE64_CHUNK_SIZE = 64 * 1024; // Must be multiple of 4
export const LEASE_DURATION_MS = 5 * 60 * 1000;
export const HEARTBEAT_INTERVAL_MS = 30 * 1000;

// Sanitize error messages
export function sanitizeError(error: string | Error | unknown): string {
  if (!error) return "Unknown error";
  let message = error instanceof Error ? error.message : String(error);
  const patterns = [
    { pattern: /[a-zA-Z]+:\/\/[^\s"]+/g, replacement: "[REDACTED_URL]" },
    { pattern: /authorization[:\s=]+[^\s,"]+/gi, replacement: "authorization: [REDACTED]" },
    { pattern: /bearer\s+[a-zA-Z0-9_-]{10,}/gi, replacement: "[REDACTED_BEARER]" },
    { pattern: /[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, replacement: "[REDACTED_JWT]" },
    { pattern: /ey[a-zA-Z0-9_-]{20,}/g, replacement: "[REDACTED_KEY]" },
    { pattern: /data:[^;]+;base64,[a-zA-Z0-9+/]{100,}/gi, replacement: "[REDACTED_BASE64]" },
  ];
  for (const { pattern, replacement } of patterns) {
    message = message.replace(pattern, replacement);
  }
  return message.substring(0, 500).trim();
}

// Infer MIME type
export function inferMimeType(fileName: string, dataUrlMime: string | null, fileType: string | null): string {
  if (dataUrlMime && dataUrlMime !== "application/octet-stream") return dataUrlMime;
  if (fileType?.trim()) return fileType.trim();
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext && EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];
  return "application/octet-stream";
}

// Parse data URL header
export function parseDataUrlHeader(value: string): { mimeType: string | null; headerLength: number } {
  const trimmed = value.trim();
  if (!trimmed.startsWith("data:")) return { mimeType: null, headerLength: 0 };
  const comma = trimmed.indexOf(",");
  if (comma < 0) return { mimeType: null, headerLength: 0 };
  const header = trimmed.slice(5, comma);
  return { mimeType: header.split(";")[0] || null, headerLength: comma + 1 };
}

// Sanitize filename
export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_{2,}/g, "_").substring(0, 200);
}

// Generate storage path
export function generateStoragePath(source: StorageFileSource, recordId: number, filename: string): string {
  return `legacy/${source}/${recordId}/${sanitizeFilename(filename)}`;
}

// Validate state transition
export function isValidStateTransition(from: string, to: string): boolean {
  return VALID_STATE_TRANSITIONS[from]?.includes(to) ?? false;
}

// Validate APP_BASE_URL
export function validateAppBaseUrl(url: string | undefined, isExecute: boolean): { valid: boolean; error?: string } {
  if (!isExecute) return { valid: true };
  if (!url) return { valid: false, error: "APP_BASE_URL required" };
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return { valid: false, error: "localhost not allowed" };
    }
    if (parsed.protocol !== "https:") return { valid: false, error: "HTTPS required" };
    if (parsed.search || parsed.hash) return { valid: false, error: "No query/fragment allowed" };
    if (parsed.username || parsed.password) return { valid: false, error: "No credentials allowed" };
    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL" };
  }
}

// Decode Base64 in chunks to temp file
export async function decodeLegacyDataChunked(
  base64Data: string,
  tempFilePath: string,
  createWriteStream: typeof import("node:fs")["createWriteStream"],
  chunkSize: number = BASE64_CHUNK_SIZE
): Promise<{ size: number; sha256: string }> {
  const hash = createHash("sha256");
  let size = 0;
  let carryOver = "";

  const writeStream = createWriteStream(tempFilePath);

  try {
    for (let i = 0; i < base64Data.length; i += chunkSize) {
      let chunk = carryOver + base64Data.slice(i, i + chunkSize);
      const remainder = chunk.length % 4;
      
      if (remainder !== 0 && i + chunkSize < base64Data.length) {
        carryOver = chunk.slice(-remainder);
        chunk = chunk.slice(0, -remainder);
      } else {
        carryOver = "";
      }

      if (chunk.length === 0) continue;
      if (!/^[A-Za-z0-9+/]*=?=?=?$/.test(chunk)) {
        throw new Error("Invalid Base64 character");
      }

      const buffer = Buffer.from(chunk, "base64");
      await new Promise<void>((resolve, reject) => {
        writeStream.write(buffer, (err) => (err ? reject(err) : resolve()));
      });
      hash.update(buffer);
      size += buffer.length;
    }

    if (carryOver) {
      const buffer = Buffer.from(carryOver, "base64");
      await new Promise<void>((resolve, reject) => {
        writeStream.write(buffer, (err) => (err ? reject(err) : resolve()));
      });
      hash.update(buffer);
      size += buffer.length;
    }

    await new Promise<void>((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on("error", reject);
    });

    return { size, sha256: hash.digest("hex") };
  } catch (error) {
    writeStream.destroy();
    throw error;
  }
}

// Inspect existing Storage object with streaming SHA-256
export async function inspectExistingObjectStreamed(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  expectedSize: number,
  expectedSha256: string,
  expectedMimeType: string
): Promise<ObjectInspectionResult> {
  try {
    // Get metadata
    const { data: objects, error } = await supabase.storage.from(bucket).list(path.split("/").slice(0, -1).join("/"), { limit: 100 });
    if (error) return { status: "indeterminate", reason: "List failed" };

    const obj = objects?.find((o) => o.name === path.split("/").pop());
    if (!obj) return { status: "missing" };

    // Verify size
    if (obj.metadata?.size !== expectedSize) {
      return { status: "verified_mismatch", reason: "Size mismatch" };
    }

    // Verify MIME
    if (obj.metadata?.mimetype && obj.metadata.mimetype !== expectedMimeType) {
      return { status: "verified_mismatch", reason: "MIME mismatch" };
    }

    // Stream download and verify SHA-256
    const { data: downloadData, error: downloadError } = await supabase.storage.from(bucket).download(path);
    if (downloadError || !downloadData) {
      return { status: "indeterminate", reason: "Download failed" };
    }

    const reader = downloadData.stream().getReader();
    const hash = createHash("sha256");
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const buffer = Buffer.from(value);
      hash.update(buffer);
      totalBytes += buffer.length;
      if (totalBytes > expectedSize * 2) {
        return { status: "indeterminate", reason: "Size exceeded expected" };
      }
    }

    if (totalBytes !== expectedSize) {
      return { status: "verified_mismatch", reason: "Downloaded size mismatch" };
    }

    const actualSha256 = hash.digest("hex");
    if (actualSha256 !== expectedSha256) {
      return { status: "verified_mismatch", reason: "SHA-256 mismatch" };
    }

    return { status: "verified_match", etag: obj.metadata?.eTag || null };
  } catch {
    return { status: "indeterminate", reason: "Verification exception" };
  }
}

// Verify application route with streaming
export async function verifyApplicationRouteStreamed(
  baseUrl: string,
  source: StorageFileSource,
  recordId: number,
  expectedSize: number,
  expectedSha256: string,
  fetch: typeof globalThis.fetch
): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `${baseUrl}/api/storage/files/${source}/${recordId}/view`;
    const response = await fetch(url, { redirect: "manual" });

    if (response.status !== 302) {
      return { ok: false, error: `Expected 302, got ${response.status}` };
    }

    const redirectUrl = response.headers.get("location");
    if (!redirectUrl) return { ok: false, error: "No redirect URL" };

    const contentResponse = await fetch(redirectUrl);
    if (!contentResponse.ok) {
      return { ok: false, error: `Content fetch failed: ${contentResponse.status}` };
    }

    const reader = contentResponse.body?.getReader();
    if (!reader) return { ok: false, error: "No response body" };

    const hash = createHash("sha256");
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const buffer = Buffer.from(value);
      hash.update(buffer);
      totalBytes += buffer.length;
      if (totalBytes > expectedSize * 2) {
        return { ok: false, error: "Size exceeded expected" };
      }
    }

    if (totalBytes !== expectedSize) {
      return { ok: false, error: `Size mismatch: expected ${expectedSize}, got ${totalBytes}` };
    }

    const actualSha256 = hash.digest("hex");
    if (actualSha256 !== expectedSha256) {
      return { ok: false, error: "SHA-256 mismatch" };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: sanitizeError(err) };
  }
}
