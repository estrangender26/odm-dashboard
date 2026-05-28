import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";
import { useState } from "react";

export const trpc = createTRPCReact<AppRouter>();

const API_URL = import.meta.env.VITE_API_URL || "/api/trpc";

const REQUEST_TIMEOUT_MS = 15000;

function withTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return globalThis
    .fetch(input, {
      ...(init ?? {}),
      credentials: "include",
      signal: controller.signal,
    })
    .finally(() => clearTimeout(timeoutId));
}
const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: API_URL,
      transformer: superjson,
      fetch(input, init) {
        return withTimeout(input, init);
      },
    }),
  ],
});

export function TRPCProvider({ children }: { children: ReactNode }) {
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [queryClient] = useState(() => new QueryClient({
    queryCache: new QueryCache({
      onError(error) {
        const message = error instanceof Error ? error.message : "Data fetch failed";
        setGlobalError(message);
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 0,
        refetchOnWindowFocus: true,
        refetchIntervalInBackground: true,
        retry: 1,
      },
    },
  }));
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {globalError && (
          <div className="fixed top-0 inset-x-0 z-[100] bg-red-600 text-white text-sm px-4 py-2 text-center">
            Global data fetch failed: {globalError}
          </div>
        )}
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
