import {
  MAX_UPLOAD_ERROR_MESSAGE,
  isUploadFileSizeAllowed,
} from "@contracts/upload-limits";
import type { StorageModule } from "@contracts/storage";

const COMMON_MIME_BY_EXTENSION: Record<string, readonly string[]> = {
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ppt: ["application/vnd.ms-powerpoint"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  gif: ["image/gif"],
  svg: ["image/svg+xml"],
  webp: ["image/webp"],
  txt: ["text/plain"],
  csv: ["text/csv", "application/vnd.ms-excel"],
  json: ["application/json"],
  zip: ["application/zip", "application/x-zip-compressed"],
  rar: ["application/vnd.rar", "application/x-rar-compressed"],
  html: ["text/html"],
  htm: ["text/html"],
  xhtml: ["application/xhtml+xml"],
};

const EXTENSIONS_BY_MODULE: Record<StorageModule, ReadonlySet<string>> = {
  om: new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "png", "jpg", "jpeg", "gif", "svg", "webp", "txt", "csv", "json", "zip", "html", "htm", "xhtml"]),
  governance: new Set(["pdf", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg", "zip", "rar", "txt", "csv", "ppt", "pptx"]),
  smp: new Set(["pdf"]),
  "lihok-corporate": new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "png", "jpg", "jpeg", "gif", "svg", "webp", "txt", "csv", "json", "zip", "html", "htm", "xhtml"]),
};

export function normalizeGovernanceMilestoneId(value: unknown) {
  const milestoneId = String(value ?? "").trim();
  if (!/^(?:M[1-9]|__deliv|__ref)$/.test(milestoneId)) {
    throw new Error("Invalid milestone.");
  }
  return milestoneId;
}

export function validateSupabaseStorageUrls(apiUrl: string, storageUrl: string) {
  const api = new URL(apiUrl);
  const storage = new URL(storageUrl);
  if (api.protocol !== "https:" || storage.protocol !== "https:") {
    throw new Error("Supabase Storage URLs must use HTTPS.");
  }
  if (api.username || api.password || storage.username || storage.password) {
    throw new Error("Supabase Storage URLs must not contain credentials.");
  }
  const projectMatch = api.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
  const expectedStorageHost = projectMatch ? `${projectMatch[1]}.storage.supabase.co` : "";
  if (!projectMatch || storage.hostname.toLowerCase() !== expectedStorageHost.toLowerCase()) {
    throw new Error("SUPABASE_URL and SUPABASE_STORAGE_URL must reference the same Supabase project.");
  }
  if ((api.pathname && api.pathname !== "/") || (storage.pathname && storage.pathname !== "/") || api.search || storage.search || api.hash || storage.hash) {
    throw new Error("Supabase Storage URLs must be project origins without paths, queries, or fragments.");
  }
  return { url: api.origin, directStorageUrl: storage.origin };
}

export function validateUploadDescriptor(module: StorageModule, fileName: string, mimeType: string) {
  if (/[/\\\0\r\n]/.test(fileName) || fileName === "." || fileName === "..") {
    throw new Error("Invalid filename.");
  }
  const extension = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  if (!EXTENSIONS_BY_MODULE[module].has(extension)) {
    throw new Error(`File extension is not allowed for ${module}.`);
  }
  const normalizedMime = mimeType.split(";", 1)[0].trim().toLowerCase();
  const allowedMimes = COMMON_MIME_BY_EXTENSION[extension] || [];
  if (normalizedMime !== "application/octet-stream" && !allowedMimes.includes(normalizedMime)) {
    throw new Error("File MIME type does not match its extension.");
  }
  return { extension, mimeType: normalizedMime };
}

export function getFinalizedStorageSizeError(actualSize: number, expectedSize: number) {
  if (actualSize === expectedSize && isUploadFileSizeAllowed(actualSize)) return null;
  if (!isUploadFileSizeAllowed(actualSize)) {
    return { status: 413 as const, error: MAX_UPLOAD_ERROR_MESSAGE };
  }
  return { status: 409 as const, error: "Uploaded object size did not match the authorization." };
}
