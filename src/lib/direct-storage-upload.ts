import * as tus from "tus-js-client";
import type { StorageFeatureFlags, StorageModule } from "@contracts/storage";
import { TUS_CHUNK_SIZE_BYTES } from "@contracts/storage";
import { MAX_UPLOAD_ERROR_MESSAGE, MAX_UPLOAD_FILE_SIZE_BYTES } from "@contracts/upload-limits";

type UploadTarget = Record<string, string | number | null | undefined>;

type Authorization = {
  storageEnabled: true;
  intentId: string;
  capabilityToken?: string; // Only present for anonymous uploads
  endpoint: string;
  token: string;
  bucket: string;
  path: string;
  chunkSize: number;
  expiresAt: string;
};

let flagsPromise: Promise<StorageFeatureFlags> | null = null;
const RESUME_AUTHORIZATION_PREFIX = "odm-storage-upload:";

async function parseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

export async function getStorageFeatureFlags(force = false): Promise<StorageFeatureFlags> {
  if (force || !flagsPromise) {
    flagsPromise = fetch("/api/storage/config", { credentials: "same-origin", cache: "no-store" })
      .then(parseJson)
      .then((data) => data.flags as StorageFeatureFlags)
      .catch((error) => {
        flagsPromise = null;
        throw error;
      });
  }
  return flagsPromise;
}

const MODULE_FLAG_KEY: Record<StorageModule, keyof StorageFeatureFlags> = {
  om: "om",
  governance: "governance",
  smp: "smp",
  projects_without_ppp: "projects_without_ppp",
};

export async function shouldUseDirectStorage(module: StorageModule) {
  const flags = await getStorageFeatureFlags(true);
  return flags.global && flags[MODULE_FLAG_KEY[module]];
}

function resumeAuthorizationKey(module: StorageModule, file: File, target: UploadTarget) {
  const normalizedTarget = Object.entries(target)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, value ?? null]);
  return `${RESUME_AUTHORIZATION_PREFIX}${JSON.stringify([
    module,
    normalizedTarget,
    file.name,
    file.type,
    file.size,
    file.lastModified,
  ])}`;
}

// Only store non-sensitive data in localStorage
// capabilityToken is intentionally NOT persisted
function loadResumeAuthorization(key: string): Omit<Authorization, 'capabilityToken'> | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as Omit<Authorization, 'capabilityToken'>;
    if (
      data.storageEnabled !== true ||
      !data.intentId ||
      !data.endpoint ||
      !data.token ||
      !data.bucket ||
      !data.path ||
      new Date(data.expiresAt).getTime() <= Date.now() + 60_000
    ) {
      window.localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function saveResumeAuthorization(key: string, authorization: Omit<Authorization, 'capabilityToken'>) {
  try {
    window.localStorage.setItem(key, JSON.stringify(authorization));
  } catch {
    // TUS still works for the current page when browser storage is unavailable.
  }
}

function clearResumeAuthorization(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing else is required when browser storage is unavailable.
  }
}

// Resume requires capability token for anonymous uploads
// Anonymous cross-refresh resume is intentionally unsupported
async function refreshResumeAuthorization(
  authorization: Authorization
): Promise<Authorization> {
  // For anonymous uploads, capabilityToken is required but not stored
  // This will fail for anonymous users after refresh (intentional)
  const body: { intentId: string; capabilityToken?: string } = {
    intentId: authorization.intentId,
  };
  
  if (authorization.capabilityToken) {
    body.capabilityToken = authorization.capabilityToken;
  }
  
  return fetch("/api/storage/uploads/resume", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(parseJson) as Promise<Authorization>;
}

function abandonAuthorization(intentId: string, capabilityToken?: string) {
  const body: { intentId: string; capabilityToken?: string } = { intentId };
  if (capabilityToken) {
    body.capabilityToken = capabilityToken;
  }
  
  return fetch("/api/storage/uploads/abandon", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

function uploadAbortError(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Upload aborted.", "AbortError");
}

export async function uploadFileDirect(options: {
  module: StorageModule;
  file: File;
  target: UploadTarget;
  onProgress?: (percentage: number, bytesUploaded: number, bytesTotal: number) => void;
  signal?: AbortSignal;
}) {
  const { module, file, target, onProgress, signal } = options;
  if (signal?.aborted) throw uploadAbortError(signal);
  if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) throw new Error(MAX_UPLOAD_ERROR_MESSAGE);
  
  const resumeKey = resumeAuthorizationKey(module, file, target);
  let storedAuth = loadResumeAuthorization(resumeKey);
  
  // Track capability token separately (not in localStorage)
  let capabilityToken: string | undefined;
  
  if (storedAuth) {
    try {
      // Reconstruct full authorization with capability token if we have it
      const fullAuth: Authorization = {
        ...storedAuth,
        capabilityToken, // Will be undefined if not available
      };
      const refreshed = await refreshResumeAuthorization(fullAuth);
      // Store refreshed data (without capability)
      const { capabilityToken: _, ...rest } = refreshed;
      saveResumeAuthorization(resumeKey, rest);
      capabilityToken = refreshed.capabilityToken;
    } catch (err: any) {
      // Anonymous resume after refresh will fail here - clear and restart
      clearResumeAuthorization(resumeKey);
      storedAuth = null;
      
      if (err?.message?.includes("capability")) {
        throw new Error("Anonymous upload session expired after page refresh. Please restart the upload.");
      }
    }
  }
  
  let authorization: Authorization;
  
  if (!storedAuth) {
    const response = await fetch("/api/storage/uploads/authorize", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module,
        originalFilename: file.name,
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size,
        target,
      }),
    });
    
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 429) {
        throw new Error(data.error || "Rate limit exceeded. Please try again later.");
      }
      if (response.status === 413) {
        throw new Error(MAX_UPLOAD_ERROR_MESSAGE);
      }
      throw new Error(data.error || `Request failed (${response.status}).`);
    }
    
    const data = await response.json();
    if (!data.storageEnabled) {
      throw new Error(data.error || "Storage upload is disabled.");
    }
    
    authorization = data as Authorization;
    capabilityToken = authorization.capabilityToken;
    
    // Store without capability token
    const { capabilityToken: _, ...rest } = authorization;
    saveResumeAuthorization(resumeKey, rest);
  } else {
    // Reconstruct from stored data
    authorization = {
      ...storedAuth,
      capabilityToken,
    };
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint: authorization.endpoint,
        retryDelays: [0, 1000, 3000, 5000, 10_000, 20_000],
        chunkSize: authorization.chunkSize || TUS_CHUNK_SIZE_BYTES,
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        fingerprint: () => Promise.resolve(`${resumeKey}:${authorization.intentId}`),
        headers: { "x-signature": authorization.token },
        metadata: {
          bucketName: authorization.bucket,
          objectName: authorization.path,
          contentType: file.type || "application/octet-stream",
          cacheControl: "3600",
          metadata: JSON.stringify({ uploadIntentId: authorization.intentId }),
        },
        onProgress(bytesUploaded, bytesTotal) {
          onProgress?.(bytesTotal ? Math.round((bytesUploaded / bytesTotal) * 100) : 0, bytesUploaded, bytesTotal);
        },
        onError: (error) => settle(reject, error),
        onSuccess: () => settle(resolve),
      });
      let settled = false;
      const settle = (callback: (reason?: any) => void, reason?: any) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        callback(reason);
      };
      const onAbort = () => {
        if (settled || !signal) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        clearResumeAuthorization(resumeKey);
        void abandonAuthorization(authorization.intentId, capabilityToken);
        void upload.abort().catch(() => undefined).finally(() => reject(uploadAbortError(signal)));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      void upload.findPreviousUploads().then((previous) => {
        if (settled) return;
        if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      }).catch((error) => settle(reject, error));
    });

    const result = await fetch("/api/storage/uploads/finalize", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        intentId: authorization.intentId,
        capabilityToken,
      }),
    }).then(parseJson) as { success: true; fileId: number; source: string; deleteCapability?: string };
    
    clearResumeAuthorization(resumeKey);
    return result;
  } catch (error) {
    // Keep the scoped authorization and TUS fingerprint so the next attempt can resume.
    throw error;
  }
}

export async function deleteFileWithVerification(source: string, id: number) {
  const prepared = await fetch("/api/storage/files/delete/prepare", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, id }),
  }).then(parseJson);
  return fetch("/api/storage/files/delete/confirm", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmationToken: prepared.confirmationToken }),
  }).then(parseJson);
}

export function storageFileUrl(source: string, id: number, action: "view" | "download") {
  return `/api/storage/files/${encodeURIComponent(source)}/${id}/${action}`;
}
