import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiRouter } from "./ai-router";
import {
  formatWebSearchResultsForPrompt,
  getWebSearchApiKey,
  getWebSearchProvider,
  isWebSearchConfigured,
  webSearch,
} from "./web-search";

const ENDPOINT = "https://search.parallel.ai/mcp";
const USER_AGENT =
  "odm-dashboard/0.0.0 (https://github.com/estrangender26/odm-dashboard)";
const source = {
  title: "Pump guidance",
  url: "https://www.example.org/pumps",
  excerpts: ["Maintain pumps regularly.", "Inspect the seals."],
};

type RpcRequest = { id: number; method: string; params?: unknown };
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

// Keep the real SDK and provider path; fake only the remote HTTP server.
function mockMcp(
  onCall: (
    request: RpcRequest,
    init: RequestInit
  ) => Response | Promise<Response>,
  onOther?: (url: string, init?: RequestInit) => Response
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url) !== ENDPOINT && onOther) return onOther(String(url), init);
    expect(String(url)).toBe(ENDPOINT);
    const headers = new Headers(init?.headers);
    expect(headers.get("User-Agent")).toBe(USER_AGENT);
    expect(headers.has("Authorization")).toBe(false);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (init?.method === "GET") return new Response(null, { status: 405 });
    const request = JSON.parse(String(init?.body)) as RpcRequest;
    if (request.method === "initialize") {
      return json({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "fixture", version: "1" },
        },
      });
    }
    if (request.method.startsWith("notifications/"))
      return new Response(null, { status: 202 });
    expect(request.method).toBe("tools/call");
    return onCall(request, init!);
  });
}

const searchResult = (request: RpcRequest, results: unknown[] = [source]) =>
  json({
    jsonrpc: "2.0",
    id: request.id,
    result: { content: [], structuredContent: { results } },
  });

beforeEach(() => {
  vi.stubEnv("WEB_SEARCH_PROVIDER", "parallel");
  vi.stubEnv("WEB_SEARCH_API_KEY", "");
  vi.stubEnv("TAVILY_API_KEY", "");
  vi.stubEnv("SERPER_API_KEY", "");
  vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("optional Parallel MCP provider", () => {
  it("selects keyless search and supplies normalized evidence to the prompt", async () => {
    const fetchMock = mockMcp(request => {
      expect(request.params).toEqual({
        name: "web_search",
        arguments: {
          objective: "latest pump maintenance guidance",
          search_queries: ["latest pump maintenance guidance"],
        },
      });
      return searchResult(request);
    });
    expect(getWebSearchProvider()).toBe("parallel");
    expect(getWebSearchApiKey()).toBeUndefined();
    expect(isWebSearchConfigured()).toBe(true);
    const result = await webSearch(" latest  pump maintenance guidance ", 4);
    expect(result).toEqual({
      provider: "parallel",
      results: [
        {
          title: "Pump guidance",
          url: source.url,
          domain: "example.org",
          snippet: "Maintain pumps regularly. Inspect the seals.",
        },
      ],
    });
    const prompt = formatWebSearchResultsForPrompt(result);
    expect(prompt).toContain("UNTRUSTED EVIDENCE/CONTEXT only");
    expect(prompt).toContain("Relevant content: Maintain pumps regularly.");
    expect(prompt).toContain("Source domain: example.org");
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(
      fetchMock.mock.calls.every(([, init]) => init?.signal?.aborted)
    ).toBe(true);
  });

  it("runs the assistant caller through MCP evidence and sourced model synthesis", async () => {
    vi.stubEnv("AI_PROVIDER", "ollama");
    vi.stubEnv("OLLAMA_BASE_URL", "http://localhost:11434");
    vi.stubEnv("OLLAMA_API_KEY", "");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    let modelCalled = false;
    mockMcp(
      request => {
        expect(JSON.stringify(request.params)).not.toContain(
          "PRIVATE_DASHBOARD_MARKER"
        );
        return searchResult(request);
      },
      (url, init) => {
        expect(url).toBe("http://localhost:11434/v1/chat/completions");
        const body = JSON.parse(String(init?.body));
        expect(body.messages.at(-1).content).toContain(
          "Maintain pumps regularly."
        );
        expect(body.messages.at(-1).content).toContain(
          "UNTRUSTED EVIDENCE/CONTEXT only"
        );
        modelCalled = true;
        return json({
          choices: [
            {
              message: {
                content: "Inspect pump seals as part of regular maintenance.",
              },
            },
          ],
        });
      }
    );
    const caller = aiRouter.createCaller({
      req: new Request("http://localhost"),
      resHeaders: new Headers(),
      user: undefined,
    });
    const response = await caller.maintenanceChat({
      message:
        "=== DASHBOARD CONTEXT ===\nDashboard Type: help\nPRIVATE_DASHBOARD_MARKER\n\nUSER QUESTION: current news about water utilities",
    });
    expect(modelCalled).toBe(true);
    expect(response.error).toBeNull();
    expect(response.reply).toContain("Inspect pump seals");
    expect(response.reply).toContain("Sources:");
    expect(response.reply).toContain("Pump guidance — example.org");
  });

  it("uses the existing assistant failure reply when MCP fails", async () => {
    mockMcp(() => new Response(null, { status: 503 }));
    const caller = aiRouter.createCaller({
      req: new Request("http://localhost"),
      resHeaders: new Headers(),
      user: undefined,
    });
    const response = await caller.maintenanceChat({
      message: "current news about water utilities",
    });
    expect(response).toEqual({
      reply: "I could not retrieve live web results right now.",
      error: "WEB_SEARCH_FAILED",
    });
  });

  it("does not forward saved keys, clamps the query and limits returned results", async () => {
    vi.stubEnv("WEB_SEARCH_API_KEY", "generic-secret");
    vi.stubEnv("TAVILY_API_KEY", "tavily-secret");
    const fetchMock = mockMcp(request => {
      const params = request.params as { arguments: { objective: string } };
      expect(params.arguments.objective).toHaveLength(500);
      return searchResult(
        request,
        Array.from({ length: 8 }, () => source)
      );
    });
    expect((await webSearch("x".repeat(700), 100)).results).toHaveLength(5);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(
      "generic-secret"
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("tavily-secret");
  });

  it("handles empty results through the existing failure context", async () => {
    mockMcp(request => searchResult(request, []));
    const response = await webSearch("latest guidance");
    expect(response.results).toEqual([]);
    expect(formatWebSearchResultsForPrompt(response)).toContain(
      "No results were returned"
    );
  });

  it.each([
    [
      "tool error",
      (request: RpcRequest) =>
        json({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            isError: true,
            content: [{ type: "text", text: "private query details" }],
          },
        }),
    ],
    [
      "malformed output",
      (request: RpcRequest) =>
        json({
          jsonrpc: "2.0",
          id: request.id,
          result: { content: [], structuredContent: { results: "invalid" } },
        }),
    ],
    [
      "unsafe URL",
      (request: RpcRequest) =>
        searchResult(request, [{ ...source, url: "javascript:alert(1)" }]),
    ],
    [
      "HTTP error",
      () => new Response("private query details", { status: 429 }),
    ],
    [
      "network error",
      () => {
        throw new Error("private query details");
      },
    ],
  ])("fails safely for %s", async (_name, reply) => {
    mockMcp(reply);
    await expect(webSearch("latest guidance")).rejects.toThrow(
      "Parallel search failed."
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "private query details"
    );
  });

  it("supports SSE tool responses through the real HTTP transport", async () => {
    mockMcp(
      request =>
        new Response(
          `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [], structuredContent: { results: [source] } } })}\n\n`,
          { headers: { "Content-Type": "text/event-stream" } }
        )
    );
    expect((await webSearch("latest guidance")).results[0].title).toBe(
      source.title
    );
  });

  it("bounds stalled calls and aborts their HTTP requests", async () => {
    vi.useFakeTimers();
    let started!: () => void;
    const called = new Promise<void>(resolve => {
      started = resolve;
    });
    let requestSignal: AbortSignal | null | undefined;
    mockMcp(
      (_request, init) =>
        new Promise<Response>((_resolve, reject) => {
          requestSignal = init.signal;
          init.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true }
          );
          started();
        })
    );
    const pending = webSearch("latest guidance");
    const rejection = expect(pending).rejects.toThrow(
      "Parallel search timed out."
    );
    await called;
    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
    expect(requestSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels an in-flight call without leaving its deadline timer", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const called = new Promise<void>(resolve => {
      started = resolve;
    });
    mockMcp(
      (_request, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true }
          );
          started();
        })
    );
    const pending = webSearch("latest guidance", 4, controller.signal);
    const rejection = expect(pending).rejects.toThrow(
      "Parallel search was cancelled."
    );
    await called;
    controller.abort();
    await rejection;
  });

  it.each(["", "unknown"])(
    "preserves Tavily default and unconfigured behavior for %j",
    async provider => {
      vi.stubEnv("WEB_SEARCH_PROVIDER", provider);
      expect(getWebSearchProvider()).toBe("tavily");
      expect(isWebSearchConfigured()).toBe(false);
      await expect(webSearch("latest guidance")).rejects.toThrow(
        "Live web search is not configured"
      );
    }
  );

  it.each(["tavily", "serper", "brave"])(
    "preserves an explicit %s selection and key",
    async provider => {
      vi.stubEnv("WEB_SEARCH_PROVIDER", provider);
      vi.stubEnv("WEB_SEARCH_API_KEY", "chosen-key");
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          json({ results: [], organic: [], web: { results: [] } })
        );
      expect(getWebSearchProvider()).toBe(provider);
      expect(getWebSearchApiKey()).toBe("chosen-key");
      expect(isWebSearchConfigured()).toBe(true);
      expect((await webSearch("latest guidance")).provider).toBe(provider);
      expect(String(fetchMock.mock.calls[0][0])).not.toContain("parallel.ai");
      const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
      expect(Array.from(headers.values())).toContain(
        provider === "tavily" ? "Bearer chosen-key" : "chosen-key"
      );
    }
  );
});
