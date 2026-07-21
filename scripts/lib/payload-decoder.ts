/**
 * Shared Payload Decoder for Legacy Migration
 */
import { createHash } from "crypto";

export const MAX_DECODED_BYTES = 157286400;

export interface DecodeResult {
  success: boolean;
  bytes?: Buffer;
  size?: number;
  sha256?: string;
  mimeType?: string;
  detectedSignature?: string;
  error?: string;
  classification: "data_url" | "raw_base64" | "reference" | "invalid";
}

export interface DecoderOptions {
  filename?: string;
  sourceMimeType?: string;
}

const DATA_URL_REGEX = /^data:([^;,]+);base64,(.*)$/i;
const URL_REGEX = /^(https?:|storage:)/i;

const SIGNATURES: Record<string, Buffer> = {
  pdf: Buffer.from([0x25, 0x50, 0x44, 0x46]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff]),
  gif: Buffer.from([0x47, 0x49, 0x46, 0x38]),
  zip: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
};

const EXT_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function decodePayload(payload: string, options: DecoderOptions = {}): DecodeResult {
  if (!payload || payload.length === 0) {
    return { success: false, error: "Empty payload", classification: "invalid" };
  }

  if (URL_REGEX.test(payload.trim())) {
    return { success: false, error: "URL reference", classification: "reference" };
  }

  const dataMatch = payload.match(DATA_URL_REGEX);
  if (dataMatch) {
    return decodeDataUrl(dataMatch, options);
  }

  return decodeRawBase64(payload, options);
}

function decodeDataUrl(match: RegExpMatchArray, options: DecoderOptions): DecodeResult {
  const mime = match[1].trim();
  const b64 = match[2];

  if (!b64 || b64.length === 0) {
    return { success: false, error: "Empty Base64", classification: "invalid" };
  }

  if (!isValidMime(mime)) {
    return { success: false, error: "Invalid MIME", classification: "invalid" };
  }

  const result = strictBase64Decode(b64);
  if (!result.success) {
    return { success: false, error: result.error, classification: "invalid" };
  }

  const bytes = result.bytes!;
  if (bytes.length > MAX_DECODED_BYTES) {
    return { success: false, error: "Size exceeded", classification: "invalid" };
  }

  const sig = detectSignature(bytes);
  if (!validateMimeSig(mime, sig, options.filename)) {
    return { success: false, error: "MIME mismatch", classification: "invalid" };
  }

  return {
    success: true,
    bytes,
    size: bytes.length,
    sha256: sha256(bytes),
    mimeType: mime,
    detectedSignature: sig,
    classification: "data_url",
  };
}

function decodeRawBase64(payload: string, options: DecoderOptions): DecodeResult {
  const cleaned = payload.replace(/[\s\r\n]+/g, "");
  if (cleaned.length === 0) {
    return { success: false, error: "Empty after cleaning", classification: "invalid" };
  }

  const result = strictBase64Decode(cleaned);
  if (!result.success) {
    return { success: false, error: result.error, classification: "invalid" };
  }

  const bytes = result.bytes!;
  if (bytes.length > MAX_DECODED_BYTES) {
    return { success: false, error: "Size exceeded", classification: "invalid" };
  }

  const sig = detectSignature(bytes);
  const mime = resolveMime(options.sourceMimeType, options.filename, sig);
  if (!mime) {
    return { success: false, error: "Cannot resolve MIME", classification: "invalid" };
  }

  if (!validateMimeSig(mime, sig, options.filename)) {
    return { success: false, error: "MIME mismatch", classification: "invalid" };
  }

  return {
    success: true,
    bytes,
    size: bytes.length,
    sha256: sha256(bytes),
    mimeType: mime,
    detectedSignature: sig,
    classification: "raw_base64",
  };
}

interface B64Result {
  success: boolean;
  bytes?: Buffer;
  error?: string;
}

function strictBase64Decode(b64: string): B64Result {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
    return { success: false, error: "Invalid characters" };
  }
  if (b64.length % 4 !== 0) {
    return { success: false, error: "Invalid length" };
  }
  const padIdx = b64.indexOf("=");
  if (padIdx !== -1 && !/^=+$/.test(b64.slice(padIdx))) {
    return { success: false, error: "Invalid padding" };
  }
  try {
    const bytes = Buffer.from(b64, "base64");
    const expected = Math.floor((b64.length * 3) / 4) - (b64.match(/=/g)?.length || 0);
    if (bytes.length !== expected) {
      return { success: false, error: "Length mismatch" };
    }
    return { success: true, bytes };
  } catch (e) {
    return { success: false, error: "Decode failed" };
  }
}

function resolveMime(sourceMime?: string, filename?: string, sig?: string): string | null {
  if (sourceMime && isValidMime(sourceMime)) return sourceMime;
  if (filename) {
    const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
    if (EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];
  }
  if (sig) {
    const map: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpeg: "image/jpeg", gif: "image/gif" };
    if (map[sig]) return map[sig];
  }
  return null;
}

function isValidMime(mime: string): boolean {
  return /^[a-zA-Z0-9][-a-zA-Z0-9.+]*\/[a-zA-Z0-9][-a-zA-Z0-9.+]*$/.test(mime);
}

function detectSignature(bytes: Buffer): string | undefined {
  for (const [name, sig] of Object.entries(SIGNATURES)) {
    if (bytes.length >= sig.length) {
      let match = true;
      for (let i = 0; i < sig.length; i++) {
        if (bytes[i] !== sig[i]) { match = false; break; }
      }
      if (match) return name;
    }
  }
  return undefined;
}

function validateMimeSig(mime: string, sig?: string, filename?: string): boolean {
  if (!sig) return true;
  const expected: Record<string, string[]> = {
    pdf: ["application/pdf"],
    png: ["image/png"],
    jpeg: ["image/jpeg"],
    gif: ["image/gif"],
    zip: ["application/zip", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  };
  const valid = expected[sig];
  if (!valid) return true;
  if (valid.includes(mime)) return true;
  if (sig === "zip" && filename) {
    const ext = filename.toLowerCase();
    if (ext.endsWith(".docx") && mime.includes("wordprocessingml")) return true;
    if (ext.endsWith(".xlsx") && mime.includes("spreadsheetml")) return true;
    if (ext.endsWith(".pptx") && mime.includes("presentationml")) return true;
  }
  return false;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
