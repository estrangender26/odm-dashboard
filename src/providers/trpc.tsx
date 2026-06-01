import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";

export const trpc = createTRPCReact<AppRouter>();

const API_URL = import.meta.env.VITE_API_URL || "/api/trpc";
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const IMPORT_REQUEST_TIMEOUT_MS = 60000;

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
        const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const isImportRequest = requestUrl.includes("tasks.import");
        const controller = new AbortController();
        const timeoutMs = isImportRequest ? IMPORT_REQUEST_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS;
        const timeout = setTimeout(() => controller.abort("Request timed out"), timeoutMs);
        try {
          return await globalThis.fetch(input, {
            ...(init ?? {}),
            credentials: "include",
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
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
