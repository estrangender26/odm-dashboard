import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import { getRequestTimeoutMs, REQUEST_TIMEOUT_MESSAGE } from "@/lib/requestTimeout";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";

export const trpc = createTRPCReact<AppRouter>();

const API_URL = import.meta.env.VITE_API_URL || "/api/trpc";

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
        const controller = new AbortController();
        const originalSignal = init?.signal;
        const startedAt = performance.now();
        const payloadBytes = estimateBodyBytes(init?.body);
        const { timeoutMs, timeoutDisabled, payloadRows } = getRequestTimeoutMs({
          requestUrl,
          body: init?.body,
        });
        const isImportRequest = requestUrl.includes("tasks.import");
        const isAiChatRequest = requestUrl.includes("ai.maintenanceChat");
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
              } else if (isAiChatRequest) {
                console.error("[ai/chat] tRPC fetch timeout abort fired", {
                  timeoutSource: "AbortController.abort() via setTimeout",
                  configuredTimeoutMs: timeoutMs,
                  elapsedMs,
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
        } else if (isAiChatRequest) {
          console.info("[ai/chat] tRPC fetch started", {
            timeoutSource: timeoutDisabled ? "disabled" : "AbortController.abort() via setTimeout",
            configuredTimeoutMs: timeoutDisabled ? null : timeoutMs,
            elapsedMs: Math.round(performance.now() - startedAt),
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
          } else if (isAiChatRequest) {
            console.info("[ai/chat] tRPC fetch response received", {
              status: response.status,
              ok: response.ok,
              configuredTimeoutMs: timeoutDisabled ? null : timeoutMs,
              elapsedMs: Math.round(performance.now() - startedAt),
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
          } else if (isAiChatRequest) {
            console.error("[ai/chat] tRPC fetch failed", {
              timeoutSource: timeoutDisabled ? "disabled" : "AbortController.abort() via setTimeout",
              configuredTimeoutMs: timeoutDisabled ? null : timeoutMs,
              elapsedMs,
              timedOut,
              aborted: controller.signal.aborted,
              abortReason: controller.signal.reason,
              payloadBytes,
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
