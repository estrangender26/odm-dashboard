// Shared request-timeout configuration for the frontend tRPC fetch wrapper.
// Keep timeouts coherent with backend/provider timeouts:
//   frontend AI timeout > server Ollama timeout (120s) > health-check timeout (5s)

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const REQUEST_TIMEOUT_MESSAGE = "Request timed out";
export const AI_REQUEST_TIMEOUT_MS = 130_000;
export const UPLOAD_REQUEST_TIMEOUT_MS = 600_000;
export const IMPORT_REQUEST_BASE_TIMEOUT_MS = 120_000;
export const IMPORT_REQUEST_ROW_INCREMENT_MS = 60_000;
export const IMPORT_REQUEST_ROWS_PER_INCREMENT = 250;
export const IMPORT_REQUEST_MAX_TIMEOUT_MS = 600_000;

export function isAiChatRequestUrl(url: string): boolean {
  return url.includes("ai.maintenanceChat");
}

export function isLargeUploadRequestUrl(url: string): boolean {
  return [
    "documents.uploadFile",
    "governance.addUpload",
    "govFiles.upload",
    "smp.create",
    "smp.update",
  ].some(procedure => url.includes(procedure));
}

export function estimateImportRowsFromBody(body: BodyInit | null | undefined): number | undefined {
  if (typeof body !== "string") return undefined;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const singlePayload = parsed as { json?: { rows?: unknown[] } };
    if (Array.isArray(singlePayload.json?.rows)) return singlePayload.json.rows.length;
    const values = Array.isArray(parsed) ? parsed : Object.values(parsed as Record<string, unknown>);
    const batchedPayload = values as Array<{ json?: { rows?: unknown[] } } | undefined>;
    for (const value of batchedPayload) {
      if (Array.isArray(value?.json?.rows)) return value.json.rows.length;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function getImportRequestTimeoutOverrideMs(): number | undefined {
  const raw = import.meta.env?.VITE_IMPORT_REQUEST_TIMEOUT_MS;
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function getImportRequestTimeoutMs(payloadRows: number | undefined): number {
  const overrideMs = getImportRequestTimeoutOverrideMs();

  if (overrideMs !== undefined && overrideMs <= 0) {
    return overrideMs;
  }

  const rowIncrements = Math.ceil(Math.max(payloadRows ?? 0, 0) / IMPORT_REQUEST_ROWS_PER_INCREMENT);
  const adaptiveTimeoutMs = Math.min(
    IMPORT_REQUEST_BASE_TIMEOUT_MS + rowIncrements * IMPORT_REQUEST_ROW_INCREMENT_MS,
    IMPORT_REQUEST_MAX_TIMEOUT_MS
  );

  if (overrideMs !== undefined) {
    return Math.max(overrideMs, adaptiveTimeoutMs);
  }

  return adaptiveTimeoutMs;
}

export function getRequestTimeoutMs(input: {
  requestUrl: string;
  body?: BodyInit | null;
}): { timeoutMs: number; timeoutDisabled: boolean; payloadRows: number | undefined } {
  const { requestUrl, body } = input;

  if (isAiChatRequestUrl(requestUrl)) {
    return { timeoutMs: AI_REQUEST_TIMEOUT_MS, timeoutDisabled: false, payloadRows: undefined };
  }

  if (requestUrl.includes("tasks.import")) {
    const payloadRows = estimateImportRowsFromBody(body);
    const timeoutMs = getImportRequestTimeoutMs(payloadRows);
    const timeoutDisabled = !Number.isFinite(timeoutMs) || timeoutMs <= 0;
    return { timeoutMs, timeoutDisabled, payloadRows };
  }

  if (isLargeUploadRequestUrl(requestUrl)) {
    return { timeoutMs: UPLOAD_REQUEST_TIMEOUT_MS, timeoutDisabled: false, payloadRows: undefined };
  }

  return { timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS, timeoutDisabled: false, payloadRows: undefined };
}
