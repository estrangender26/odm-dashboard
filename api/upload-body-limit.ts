import {
  DEFAULT_API_BODY_LIMIT_BYTES,
  MAX_BASE64_UPLOAD_BODY_SIZE_BYTES,
  MAX_MULTIPART_UPLOAD_BODY_SIZE_BYTES,
  MAX_UPLOAD_ERROR_MESSAGE,
} from "@contracts/upload-limits";

const LARGE_MULTIPART_UPLOAD_PATHS = new Set([
  "/api/documents/upload",
]);

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

const SHARED_GANTT_TRPC_PROCEDURES = new Set([
  "sharedGantt.createShared",
  "sharedGantt.createTask",
  "sharedGantt.updateTask",
  "sharedGantt.deleteTask",
  "sharedGantt.createDependency",
  "sharedGantt.deleteDependency",
  "sharedGantt.share",
  "sharedGantt.updateProject",
]);

export const SHARED_GANTT_BODY_LIMIT_BYTES = 256 * 1024;

export function isSharedGanttRequestPath(path: string): boolean {
  const trpcPrefix = "/api/trpc/";
  if (!path.startsWith(trpcPrefix)) return false;
  return path
    .slice(trpcPrefix.length)
    .split(",")
    .some((procedure) => SHARED_GANTT_TRPC_PROCEDURES.has(procedure));
}

export function isAffectedUploadRequestPath(path: string): boolean {
  return LARGE_MULTIPART_UPLOAD_PATHS.has(path)
    || isLargeUploadRequestPath(path);
}

export function getRequestBodyLimitBytes(path: string): number {
  if (LARGE_MULTIPART_UPLOAD_PATHS.has(path)) {
    return MAX_MULTIPART_UPLOAD_BODY_SIZE_BYTES;
  }
  if (isSharedGanttRequestPath(path)) {
    return SHARED_GANTT_BODY_LIMIT_BYTES;
  }

  return isLargeUploadRequestPath(path)
    ? MAX_BASE64_UPLOAD_BODY_SIZE_BYTES
    : DEFAULT_API_BODY_LIMIT_BYTES;
}

export type RequestBodyLimitConfig = {
  maxSizeBytes: number;
  errorMessage: string;
  isAffectedUpload: boolean;
};

export function getRequestBodyLimitConfig(path: string): RequestBodyLimitConfig {
  const isAffectedUpload = isAffectedUploadRequestPath(path);
  return {
    maxSizeBytes: getRequestBodyLimitBytes(path),
    errorMessage: isAffectedUpload
      ? MAX_UPLOAD_ERROR_MESSAGE
      : "Payload Too Large",
    isAffectedUpload,
  };
}
