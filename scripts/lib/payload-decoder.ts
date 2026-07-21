/**
 * Streaming Payload Decoder for Legacy Migration
 */

import { createHash } from "crypto";
import { unlink } from "fs/promises";
import { createWriteStream } from "fs";

export const MAX_DECODED_BYTES = 157286400;

export interface StreamDecodeResult {
  success: boolean;
  tempPath?: string;
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
  tempPath: string;
}

const DATA_URL_REGEX = /^data:([^;,]+);base64,(.*)$/is;
const URL_REGEX = /^https?:\/\//i;
const STORAGE_URL_REGEX = /^storage:/i;

const SIGNATURES: Record<string, { sig: Buffer; mime: string }> = {
  pdf: { sig: Buffer.from([0x25, 0x50, 0x44, 0x46]), mime: "application/pdf" },
  png: { sig: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), mime: "image/png" },
  jpeg: { sig: Buffer.from([0xff, 0xd8, 0xff]), mime: "image/jpeg" },
  gif: { sig: Buffer.from([0x47, 0x49, 0x46, 0x38]), mime: "image/gif" },
  zip: { sig: Buffer.from([0x50, 0x4b, 0x03, 0x04]), mime: "application/zip" },
  msCompound: { sig: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), mime: "application/msword" },
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
  ".doc": "application/msword",
  ".xls": "application/vnd.ms-excel",
  ".ppt": "application/vnd.ms-powerpoint",
  ".txt": "text/plain",
};

let testMaxBytes: number | null = null;
export function setTestMaxBytes(bytes: number | null) { testMaxBytes = bytes; }
function getMaxBytes(): number { return testMaxBytes ?? MAX_DECODED_BYTES; }

export async function decodePayloadStream(payload: string, options: DecoderOptions): Promise<StreamDecodeResult> {
  if (!payload || payload.length === 0) {
    return { success: false, error: "Empty payload", classification: "invalid" };
  }

  const trimmed = payload.trim();
  if (URL_REGEX.test(trimmed) || STORAGE_URL_REGEX.test(trimmed) || trimmed.includes("supabase.co")) {
    return { success: false, error: "URL/reference detected", classification: "reference" };
  }

  const dataMatch = payload.match(DATA_URL_REGEX);
  if (dataMatch) {
    return decodeDataUrlStream(dataMatch, options);
  }

  return decodeRawBase64Stream(payload, options);
}

async function decodeDataUrlStream(match: RegExpMatchArray, options: DecoderOptions): Promise<StreamDecodeResult> {
  const mime = match[1].trim();
  const b64Content = match[2];

  if (!b64Content || b64Content.length === 0) {
    return { success: false, error: "Empty Base64 in data URL", classification: "invalid" };
  }

  if (!isValidMime(mime)) {
    return { success: false, error: "Invalid MIME", classification: "invalid" };
  }

  return streamDecodeBase64(b64Content, options, mime, "data_url");
}

async function decodeRawBase64Stream(payload: string, options: DecoderOptions): Promise<StreamDecodeResult> {
  const cleaned = payload.replace(/[\s\r\n]+/g, "");
  if (cleaned.length === 0) {
    return { success: false, error: "Empty after cleaning", classification: "invalid" };
  }

  const mime = resolveMime(options.sourceMimeType, options.filename);
  if (!mime) {
    return { success: false, error: "Cannot resolve MIME", classification: "invalid" };
  }

  return streamDecodeBase64(cleaned, options, mime, "raw_base64");
}

async function streamDecodeBase64(base64: string, options: DecoderOptions, declaredMime: string, classification: "data_url" | "raw_base64"): Promise<StreamDecodeResult> {
  const maxBytes = getMaxBytes();
  const writeStream = createWriteStream(options.tempPath);
  const hash = createHash("sha256");
  let decodedSize = 0;
  let carryOver = "";
  let firstChunk: Buffer | null = null;
  let cleanupNeeded = true;

  try {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
      throw new Error("Invalid Base64 characters");
    }
    if (base64.length % 4 !== 0) {
      throw new Error("Invalid Base64 length (not multiple of 4)");
    }
    const padIdx = base64.indexOf("=");
    if (padIdx !== -1 && !/^=+$/.test(base64.slice(padIdx))) {
      throw new Error("Invalid Base64 padding");
    }

    const CHUNK_SIZE = 4096;
    for (let i = 0; i < base64.length; i += CHUNK_SIZE) {
      const chunk = base64.slice(i, i + CHUNK_SIZE);
      const combined = carryOver + chunk;
      const remainder = combined.length % 4;
      const processable = remainder === 0 ? combined : combined.slice(0, -remainder);
      carryOver = remainder === 0 ? "" : combined.slice(-remainder);

      if (processable.length > 0) {
        const buffer = Buffer.from(processable, "base64");
        decodedSize += buffer.length;
        if (decodedSize > maxBytes) {
          throw new Error("Size exceeds maximum");
        }
        if (!firstChunk && buffer.length > 0) {
          firstChunk = buffer.slice(0, Math.min(16, buffer.length));
        }
        writeStream.write(buffer);
        hash.update(buffer);
      }
    }

    if (carryOver) {
      const buffer = Buffer.from(carryOver, "base64");
      decodedSize += buffer.length;
      if (decodedSize > maxBytes) {
        throw new Error("Size exceeds maximum");
      }
      writeStream.write(buffer);
      hash.update(buffer);
      if (!firstChunk) {
        firstChunk = buffer.slice(0, Math.min(16, buffer.length));
      }
    }

    await new Promise<void>((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on("error", reject);
    });

    const detectedSig = firstChunk ? detectSignature(firstChunk) : undefined;
    if (!validateMimeSig(declaredMime, detectedSig, options.filename)) {
      throw new Error("MIME/signature mismatch");
    }

    cleanupNeeded = false;
    return {
      success: true,
      tempPath: options.tempPath,
      size: decodedSize,
      sha256: hash.digest("hex"),
      mimeType: declaredMime,
      detectedSignature: detectedSig,
      classification,
    };
  } catch (error) {
    if (cleanupNeeded) {
      try {
        writeStream.destroy();
        await unlink(options.tempPath);
      } catch {}
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      classification: "invalid",
    };
  }
}

function resolveMime(sourceMime?: string, filename?: string): string | null {
  if (sourceMime && isValidMime(sourceMime)) return sourceMime;
  if (filename) {
    const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
    if (EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];
  }
  return null;
}

function isValidMime(mime: string): boolean {
  return /^[a-zA-Z0-9][-a-zA-Z0-9.+]*\/[a-zA-Z0-9][-a-zA-Z0-9.+]*$/.test(mime);
}

function detectSignature(bytes: Buffer): string | undefined {
  for (const [name, { sig }] of Object.entries(SIGNATURES)) {
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
    msCompound: ["application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint"],
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
  if (sig === "msCompound" && filename) {
    const ext = filename.toLowerCase();
    if (ext.endsWith(".doc") && mime === "application/msword") return true;
    if (ext.endsWith(".xls") && mime === "application/vnd.ms-excel") return true;
    if (ext.endsWith(".ppt") && mime === "application/vnd.ms-powerpoint") return true;
  }
  return false;
}
