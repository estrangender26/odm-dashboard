import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";

export const trpc = createTRPCReact<AppRouter>();

const API_URL = import.meta.env.VITE_API_URL || "/api/trpc";
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const IMPORT_REQUEST_BASE_TIMEOUT_MS = 120000;
const IMPORT_REQUEST_ROW_INCREMENT_MS = 60000;
const IMPORT_REQUEST_ROWS_PER_INCREMENT = 250;
const IMPORT_REQUEST_MAX_TIMEOUT_MS = 600000;
const IMPORT_REQUEST_TIMEOUT_OVERRIDE_MS = Number(import.meta.env.VITE_IMPORT_REQUEST_TIMEOUT_MS);
const REQUEST_TIMEOUT_MESSAGE = "Request timed out";

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function byteLengthFromString(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function estimateBodyBytes(body: BodyInit | null | undefined): number | undefined {
  if (!body) return undefined;
  if (typeof body === "string") return byteLengthFromString(body);
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (body instanceof URLSearchParams) return byteLengthFromString(body.toString());
  if (ArrayBuffer.isView(body)) return body.byteLength;
  return undefined;
}

function estimateImportRowsFromBody(body: BodyInit | null | undefined): number | undefined {
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

function getImportRequestTimeoutMs(payloadRows: number | undefined): number {
  if (Number.isFinite(IMPORT_REQUEST_TIMEOUT_OVERRIDE_MS) && IMPORT_REQUEST_TIMEOUT_OVERRIDE_MS <= 0) {
    return IMPORT_REQUEST_TIMEOUT_OVERRIDE_MS;
  }

  const rowIncrements = Math.ceil(Math.max(payloadRows ?? 0, 0) / IMPORT_REQUEST_ROWS_PER_INCREMENT);
  const adaptiveTimeoutMs = Math.min(
    IMPORT_REQUEST_BASE_TIMEOUT_MS + rowIncrements * IMPORT_REQUEST_ROW_INCREMENT_MS,
    IMPORT_REQUEST_MAX_TIMEOUT_MS
  );

  if (Number.isFinite(IMPORT_REQUEST_TIMEOUT_OVERRIDE_MS)) {
    return Math.max(IMPORT_REQUEST_TIMEOUT_OVERRIDE_MS, adaptiveTimeoutMs);
  }

  return adaptiveTimeoutMs;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: true,
      retry: 1,
      retryDelay: 1000,
    },
  },
});
const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: API_URL,
      transformer: superjson,
      async fetch(input, init) {
        const requestUrl = getRequestUrl(input);
        const isImportRequest = requestUrl.includes("tasks.import");
        const controller = new AbortController();
        const originalSignal = init?.signal;
        const startedAt = performance.now();
        const payloadBytes = estimateBodyBytes(init?.body);
        const payloadRows = isImportRequest ? estimateImportRowsFromBody(init?.body) : undefined;
        const timeoutMs = isImportRequest ? getImportRequestTimeoutMs(payloadRows) : DEFAULT_REQUEST_TIMEOUT_MS;
        const timeoutDisabled = isImportRequest && (!Number.isFinite(timeoutMs) || timeoutMs <= 0);
        let timedOut = false;

        const abortFromOriginalSignal = () => {
          controller.abort(originalSignal?.reason ?? "Request aborted");
        };
        if (originalSignal?.aborted) {
          abortFromOriginalSignal();
        } else {
          originalSignal?.addEventListener("abort", abortFromOriginalSignal, { once: true });
        }

        const timeout = timeoutDisabled
          ? undefined
          : window.setTimeout(() => {
              timedOut = true;
              const elapsedMs = Math.round(performance.now() - startedAt);
              if (isImportRequest) {
                console.error("[tasks/import] tRPC fetch timeout abort fired", {
                  requestUrl,
                  timeoutSource: "AbortController.abort() via setTimeout",
                  configuredTimeoutMs: timeoutMs,
                  timeoutMs,
                  elapsedMs,
                  payloadRows,
                  payloadBytes,
                });
              }
              controller.abort(REQUEST_TIMEOUT_MESSAGE);
            }, timeoutMs);

        if (isImportRequest) {
          console.info("[tasks/import] tRPC fetch started", {
            requestUrl,
            timeoutSource: timeoutDisabled ? "disabled" : "AbortController.abort() via setTimeout",
            configuredTimeoutMs: timeoutDisabled ? null : timeoutMs,
            timeoutMs: timeoutDisabled ? null : timeoutMs,
            elapsedMs: Math.round(performance.now() - startedAt),
            payloadRows,
            payloadBytes,
          });
        }
        try {
          const response = await globalThis.fetch(input, {
            ...(init ?? {}),
            credentials: "include",
            signal: controller.signal,
          });
          if (isImportRequest) {
            console.info("[tasks/import] tRPC fetch response received", {
              requestUrl,
              status: response.status,
              ok: response.ok,
              configuredTimeoutMs: timeoutDisabled ? null : timeoutMs,
              timeoutMs: timeoutDisabled ? null : timeoutMs,
              elapsedMs: Math.round(performance.now() - startedAt),
              payloadRows,
              payloadBytes,
            });
          }
          return response;
        } catch (error) {
          const elapsedMs = Math.round(performance.now() - startedAt);
          if (isImportRequest) {
            console.error("[tasks/import] tRPC fetch failed", {
              requestUrl,
              timeoutSource: timeoutDisabled ? "disabled" : "AbortController.abort() via setTimeout",
              configuredTimeoutMs: timeoutDisabled ? null : timeoutMs,
              timeoutMs: timeoutDisabled ? null : timeoutMs,
              elapsedMs,
              timedOut,
              aborted: controller.signal.aborted,
              abortReason: controller.signal.reason,
              payloadRows,
              payloadBytes,
              error,
            });
          }
          if (timedOut) throw new Error(REQUEST_TIMEOUT_MESSAGE);
          throw error;
        } finally {
          if (timeout !== undefined) window.clearTimeout(timeout);
          originalSignal?.removeEventListener("abort", abortFromOriginalSignal);
        }
      },
    }),
  ],
});

export function TRPCProvider({ children }: { children: ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
