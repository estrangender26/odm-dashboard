import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";

export const trpc = createTRPCReact<AppRouter>();

const API_URL = import.meta.env.VITE_API_URL || "/api/trpc";

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
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort("Request timed out"), 15000);
        try {
          const response = await globalThis.fetch(input, {
            ...(init ?? {}),
            credentials: "include",
            signal: controller.signal,
          });

          const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
          if (requestUrl.includes("tasks.import")) {
            response.clone().text().then((rawBody) => {
              console.info("[tasks/import] raw network response body", {
                url: requestUrl,
                status: response.status,
                ok: response.ok,
                rawBody,
              });
              try {
                console.info("[tasks/import] parsed network response", JSON.parse(rawBody));
              } catch (parseErr) {
                console.warn("[tasks/import] response JSON parse failed", { rawBody, parseErr });
              }
            }).catch((readErr) => {
              console.warn("[tasks/import] failed to read raw network response body", readErr);
            });
          }

          return response;
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
