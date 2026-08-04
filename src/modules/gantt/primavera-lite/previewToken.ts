import { webcrypto } from "node:crypto";

const PREVIEW_TOKEN_TTL_MS = 5 * 60 * 1000;

export type PreviewTokenAction = "archiveProject" | "archiveActivity";

export interface PreviewTokenPayload {
  action: PreviewTokenAction;
  slug: string;
  entityId?: number;
  expectedRevision: number;
  exp: number;
  nonce: string;
}

function base64urlEncode(buf: ArrayBuffer): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(str: string): ArrayBuffer {
  const normalized = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const buffer = Buffer.from(padded, "base64");
  const copy = new Uint8Array(buffer.length);
  copy.set(buffer);
  return copy.buffer as ArrayBuffer;
}
function toArrayBuffer(view: ArrayBufferView): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}


function getPreviewSecret(): string {
  const secret = process.env.PRIMAVERA_LITE_PREVIEW_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("PRIMAVERA_LITE_PREVIEW_SECRET is required in production");
    }
    // Deterministic test-only fallback. Never use this in production.
    return "pr1-test-preview-secret-do-not-use-in-production";
  }
  return secret;
}

async function importPreviewSecret() {
  const secret = getPreviewSecret();
  return webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function createPreviewToken(
  action: PreviewTokenAction,
  slug: string,
  expectedRevision: number,
  entityId?: number
): Promise<string> {
  const payload: PreviewTokenPayload = {
    action,
    slug,
    expectedRevision,
    entityId,
    exp: Date.now() + PREVIEW_TOKEN_TTL_MS,
    nonce: Array.from(webcrypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
  };
  const key = await importPreviewSecret();
  const data = toArrayBuffer(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await webcrypto.subtle.sign("HMAC", key, data);
  return `${base64urlEncode(data)}.${base64urlEncode(signature)}`;
}

export async function verifyPreviewToken(
  token: string,
  action: PreviewTokenAction,
  slug: string,
  expectedRevision: number,
  entityId?: number
): Promise<PreviewTokenPayload> {
  const [dataB64, sigB64] = token.split(".");
  if (!dataB64 || !sigB64) {
    throw new Error("Invalid preview token format");
  }

  const key = await importPreviewSecret();
  const data = base64urlDecode(dataB64);
  const signature = base64urlDecode(sigB64);
  const valid = await webcrypto.subtle.verify("HMAC", key, signature, data);
  if (!valid) {
    throw new Error("Preview token signature mismatch");
  }

  let payload: PreviewTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new Error("Preview token payload is not valid JSON");
  }

  if (payload.action !== action) {
    throw new Error(`Preview token action mismatch: expected ${action}, got ${payload.action}`);
  }
  if (payload.slug !== slug) {
    throw new Error("Preview token slug mismatch");
  }
  if (payload.entityId !== entityId) {
    throw new Error("Preview token entity id mismatch");
  }
  if (payload.expectedRevision !== expectedRevision) {
    throw new Error("Preview token revision mismatch");
  }
  if (payload.exp < Date.now()) {
    throw new Error("Preview token expired");
  }

  return payload;
}
