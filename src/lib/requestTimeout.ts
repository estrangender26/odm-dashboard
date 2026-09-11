// Shared request-timeout configuration for the frontend tRPC fetch wrapper.
// Keep timeouts coherent with backend/provider timeouts:
//   frontend AI timeout > server Ollama timeout (120s) > health-check timeout (5s)

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const REQUEST_TIMEOUT_MESSAGE = "Request timed out";
export const AI_REQUEST_TIMEOUT_MS = 130_000;
export const UPLOAD_REQUEST_TIMEOUT_MS = 600_000;

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

export function getRequestTimeoutMs(input: {
  requestUrl: string;
}): { timeoutMs: number; timeoutDisabled: boolean } {
  const { requestUrl } = input;

  if (isAiChatRequestUrl(requestUrl)) {
    return { timeoutMs: AI_REQUEST_TIMEOUT_MS, timeoutDisabled: false };
  }

  if (isLargeUploadRequestUrl(requestUrl)) {
    return { timeoutMs: UPLOAD_REQUEST_TIMEOUT_MS, timeoutDisabled: false };
  }

  return { timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS, timeoutDisabled: false };
}
