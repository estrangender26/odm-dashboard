export const MAX_UPLOAD_FILE_SIZE_BYTES = 157_286_400;
export const MAX_UPLOAD_ERROR_MESSAGE = "Maximum file size is 150 MB.";

export const DEFAULT_API_BODY_LIMIT_BYTES = 50 * 1024 * 1024;

const UPLOAD_TRANSPORT_OVERHEAD_BYTES = 1024 * 1024;

export const MAX_MULTIPART_UPLOAD_BODY_SIZE_BYTES =
  MAX_UPLOAD_FILE_SIZE_BYTES + UPLOAD_TRANSPORT_OVERHEAD_BYTES;

export const MAX_BASE64_UPLOAD_LENGTH =
  Math.ceil(MAX_UPLOAD_FILE_SIZE_BYTES / 3) * 4;

export const MAX_BASE64_UPLOAD_BODY_SIZE_BYTES =
  MAX_BASE64_UPLOAD_LENGTH + UPLOAD_TRANSPORT_OVERHEAD_BYTES;

export function isUploadFileSizeAllowed(fileSizeBytes: number): boolean {
  return Number.isFinite(fileSizeBytes)
    && fileSizeBytes >= 0
    && fileSizeBytes <= MAX_UPLOAD_FILE_SIZE_BYTES;
}

export function getDecodedBase64ByteLengthFromEncoding(
  encodedLength: number,
  padding: number,
): number | null {
  if (!Number.isInteger(encodedLength) || encodedLength < 0) return null;
  if (!Number.isInteger(padding) || padding < 0 || padding > 2) return null;
  const decodedLength = Math.floor((encodedLength * 3) / 4) - padding;
  return decodedLength >= 0 ? decodedLength : null;
}

export function getDecodedBase64ByteLength(value: string): number | null {
  const commaIndex = value.startsWith("data:") ? value.indexOf(",") : -1;
  const encoded = commaIndex >= 0 ? value.slice(commaIndex + 1) : value;

  if (encoded.length === 0) return 0;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;
  if (encoded.includes("=") && encoded.length % 4 !== 0) return null;
  if (encoded.length % 4 === 1) return null;

  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return getDecodedBase64ByteLengthFromEncoding(encoded.length, padding);
}

export function isBase64UploadSizeAllowed(value: string): boolean {
  const decodedSize = getDecodedBase64ByteLength(value);
  return decodedSize === null || isUploadFileSizeAllowed(decodedSize);
}
