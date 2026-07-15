import {
  DEFAULT_API_BODY_LIMIT_BYTES,
  MAX_BASE64_UPLOAD_BODY_SIZE_BYTES,
} from "@contracts/upload-limits";

const LARGE_UPLOAD_REST_PATHS = new Set([
  "/api/governance/files",
]);

const LARGE_UPLOAD_TRPC_PROCEDURES = new Set([
  "documents.uploadFile",
  "governance.addUpload",
  "govFiles.upload",
  "smp.create",
  "smp.update",
]);

export function isLargeUploadRequestPath(path: string): boolean {
  if (LARGE_UPLOAD_REST_PATHS.has(path)) return true;

  const trpcPrefix = "/api/trpc/";
  if (!path.startsWith(trpcPrefix)) return false;

  return path
    .slice(trpcPrefix.length)
    .split(",")
    .some((procedure) => LARGE_UPLOAD_TRPC_PROCEDURES.has(procedure));
}

export function getRequestBodyLimitBytes(path: string): number {
  return isLargeUploadRequestPath(path)
    ? MAX_BASE64_UPLOAD_BODY_SIZE_BYTES
    : DEFAULT_API_BODY_LIMIT_BYTES;
}
