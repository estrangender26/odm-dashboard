import {
  MAX_UPLOAD_ERROR_MESSAGE,
  MAX_UPLOAD_FILE_SIZE_BYTES,
} from "@contracts/upload-limits";
import {
  MASTERDATA_ALLOWED_EXTENSIONS,
  MASTERDATA_MIME_BY_EXTENSION,
} from "./constants";

export type MasterdataValidationError = { message: string };

export function getMasterdataExtension(fileName: string): string {
  return fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
}

/**
 * Client-side (UX) validation mirroring the server-enforced rules.
 * The server remains authoritative: api/storage-validation.ts enforces the
 * same allowed extensions/MIME and the canonical 150 MB size guard.
 */
export function validateMasterdataFile(file: File): MasterdataValidationError | null {
  if (!file.name) return { message: "Filename is required." };
  const extension = getMasterdataExtension(file.name);
  if (!(MASTERDATA_ALLOWED_EXTENSIONS as readonly string[]).includes(extension)) {
    return {
      message: `Unsupported file type ".${extension}". Only Excel (.xlsx, .xls) and PDF (.pdf) masterdata files are accepted.`,
    };
  }
  const normalizedMime = (file.type || "").split(";", 1)[0].trim().toLowerCase();
  if (normalizedMime && normalizedMime !== "application/octet-stream") {
    const allowed = MASTERDATA_MIME_BY_EXTENSION[extension] ?? [];
    if (!allowed.includes(normalizedMime)) {
      return { message: "File type does not match its extension." };
    }
  }
  if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
    return { message: MAX_UPLOAD_ERROR_MESSAGE };
  }
  return null;
}
