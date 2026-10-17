import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

const ENDPOINT = "https://search.parallel.ai/mcp";
const USER_AGENT =
  "odm-dashboard/0.0.0 (https://github.com/estrangender26/odm-dashboard)";
const TIMEOUT_MS = 15_000;

const searchOutput = z.object({
  results: z.array(
    z.object({
      url: z.url({ protocol: /^https?$/ }),
      title: z.string().nullish(),
      excerpts: z.array(z.string()),
    })
  ),
});

/** Anonymous, bounded MCP search. Never forward credentials for other providers. */
export async function parallelSearch(query: string, signal?: AbortSignal) {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), TIMEOUT_MS);
  timer.unref?.();
  const requestSignal = signal
    ? AbortSignal.any([deadline.signal, signal])
    : deadline.signal;
  const client = new Client({ name: "odm-dashboard", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    // Apply the identity and deadline to every request, including MCP discovery.
    fetch: (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set("User-Agent", USER_AGENT);
      return fetch(url, {
        ...init,
        headers,
        signal: init?.signal
          ? AbortSignal.any([requestSignal, init.signal])
          : requestSignal,
      });
    },
  });

  try {
    requestSignal.throwIfAborted();
    await client.connect(transport, { signal: requestSignal });
    const result = await client.callTool(
      {
        name: "web_search",
        arguments: { objective: query, search_queries: [query] },
      },
      undefined,
      { signal: requestSignal }
    );
    if (result.isError) throw new Error("Parallel search failed.");
    const parsed = searchOutput.safeParse(result.structuredContent);
    if (!parsed.success) throw new Error("Invalid Parallel search response.");
    return parsed.data.results.map(result => ({
      url: result.url,
      title: result.title,
      content: result.excerpts.join(" "),
    }));
  } catch {
    // Remote messages and bodies may contain query text; keep diagnostics bounded.
    if (deadline.signal.aborted) throw new Error("Parallel search timed out.");
    if (signal?.aborted) throw new Error("Parallel search was cancelled.");
    throw new Error("Parallel search failed.");
  } finally {
    clearTimeout(timer);
    await client.close();
  }
}
