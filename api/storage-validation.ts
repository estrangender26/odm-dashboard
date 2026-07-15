import {
  MAX_UPLOAD_ERROR_MESSAGE,
  isUploadFileSizeAllowed,
} from "@contracts/upload-limits";

export function getFinalizedStorageSizeError(actualSize: number, expectedSize: number) {
  if (actualSize === expectedSize && isUploadFileSizeAllowed(actualSize)) return null;
  if (!isUploadFileSizeAllowed(actualSize)) {
    return { status: 413 as const, error: MAX_UPLOAD_ERROR_MESSAGE };
  }
  return { status: 409 as const, error: "Uploaded object size did not match the authorization." };
}
