import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatWithOllama,
  checkOllamaHealth,
  DEFAULT_OLLAMA_MAX_TOKENS,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_TIMEOUT_MS,
  getOllamaConfig,
  normalizeOllamaBaseUrl,
  OLLAMA_CHAT_COMPLETIONS_PATH,
  type OllamaClientError,
} from "./ollama-client";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  // Clear Ollama-related env vars before each test.
  for (const key of [
    "AI_PROVIDER",
    "OLLAMA_BASE_URL",
    "OLLAMA_API_KEY",
    "OLLAMA_MODEL",
    "OLLAMA_TIMEOUT_MS",
    "OLLAMA_MAX_TOKENS",
  ]) {
    delete process.env[key];
  }
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

function mockFetch(response: Response) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
}

function successfulCompletionJson(content: string) {
  return {
    choices: [
      {
        message: {
          content,
        },
      },
    ],
  };
}

describe("Ollama client configuration", () => {
  it("defaults model to kimi-k2.7-code:cloud", () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    const config = getOllamaConfig();
    expect(config.model).toBe("kimi-k2.7-code:cloud");
    expect(config.model).toBe(DEFAULT_OLLAMA_MODEL);
  });

  it("honors configured model override", () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    process.env.OLLAMA_MODEL = "custom-model";
    const config = getOllamaConfig();
    expect(config.model).toBe("custom-model");
  });

  it("normalizes base URL by removing trailing slashes", () => {
    expect(normalizeOllamaBaseUrl("http://localhost:11434/")).toBe("http://localhost:11434");
    expect(normalizeOllamaBaseUrl("http://localhost:11434//")).toBe("http://localhost:11434");
    expect(normalizeOllamaBaseUrl("http://localhost:11434")).toBe("http://localhost:11434");
    expect(normalizeOllamaBaseUrl("  http://localhost:11434/  ")).toBe("http://localhost:11434");
  });

  it("treats empty or whitespace base URL as undefined", () => {
    expect(normalizeOllamaBaseUrl("")).toBeUndefined();
    expect(normalizeOllamaBaseUrl("   ")).toBeUndefined();
    expect(normalizeOllamaBaseUrl(undefined)).toBeUndefined();
  });

  it("marks configured false when base URL is missing", () => {
    const config = getOllamaConfig();
    expect(config.configured).toBe(false);
    expect(config.baseUrl).toBeUndefined();
  });

  it("uses default timeout and max tokens when not configured", () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    const config = getOllamaConfig();
    expect(config.timeoutMs).toBe(DEFAULT_OLLAMA_TIMEOUT_MS);
    expect(config.maxTokens).toBe(DEFAULT_OLLAMA_MAX_TOKENS);
  });

  it("honors valid timeout and max token overrides", () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    process.env.OLLAMA_TIMEOUT_MS = "30000";
    process.env.OLLAMA_MAX_TOKENS = "800";
    const config = getOllamaConfig();
    expect(config.timeoutMs).toBe(30000);
    expect(config.maxTokens).toBe(800);
  });

  it("falls back safely for invalid numeric environment values", () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    process.env.OLLAMA_TIMEOUT_MS = "not-a-number";
    process.env.OLLAMA_MAX_TOKENS = "-1";
    const config = getOllamaConfig();
    expect(config.timeoutMs).toBe(DEFAULT_OLLAMA_TIMEOUT_MS);
    expect(config.maxTokens).toBe(DEFAULT_OLLAMA_MAX_TOKENS);
  });

  it("treats OLLAMA_API_KEY as optional and trims it", () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    expect(getOllamaConfig().apiKey).toBeUndefined();

    process.env.OLLAMA_API_KEY = "  secret-key  ";
    expect(getOllamaConfig().apiKey).toBe("secret-key");
  });
});

describe("Ollama client request shape", () => {
  it("sends the correct OpenAI-compatible chat-completions payload", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    const fetchSpy = mockFetch(
      new Response(JSON.stringify(successfulCompletionJson("Hello!")), { status: 200 })
    );

    await chatWithOllama({
      messages: [
        { role: "system", content: "You are ODM Dashboard AI" },
        { role: "user", content: "Hi" },
      ],
      temperature: 0.2,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`http://localhost:11434${OLLAMA_CHAT_COMPLETIONS_PATH}`);
    expect(init?.method).toBe("POST");

    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBeUndefined();

    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe(DEFAULT_OLLAMA_MODEL);
    expect(body.messages).toEqual([
      { role: "system", content: "You are ODM Dashboard AI" },
      { role: "user", content: "Hi" },
    ]);
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(DEFAULT_OLLAMA_MAX_TOKENS);
  });

  it("omits Authorization header when OLLAMA_API_KEY is blank", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    process.env.OLLAMA_API_KEY = "";
    const fetchSpy = mockFetch(
      new Response(JSON.stringify(successfulCompletionJson("ok")), { status: 200 })
    );

    await chatWithOllama({ messages: [{ role: "user", content: "Hi" }] });

    const init = fetchSpy.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("includes Authorization header when OLLAMA_API_KEY is configured", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    process.env.OLLAMA_API_KEY = "my-api-key";
    const fetchSpy = mockFetch(
      new Response(JSON.stringify(successfulCompletionJson("ok")), { status: 200 })
    );

    await chatWithOllama({ messages: [{ role: "user", content: "Hi" }] });

    const init = fetchSpy.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("Bearer my-api-key");
  });

  it("uses per-request timeout override when provided", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    const fetchSpy = mockFetch(
      new Response(JSON.stringify(successfulCompletionJson("ok")), { status: 200 })
    );

    await chatWithOllama({
      messages: [{ role: "user", content: "Hi" }],
      timeoutMs: 5000,
    });

    // We cannot directly assert the timeout value on the fetch call; instead
    // we exercise the timeout path below.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("Ollama client error handling", () => {
  it("throws MISSING_BASE_URL when OLLAMA_BASE_URL is not set", async () => {
    await expect(
      chatWithOllama({ messages: [{ role: "user", content: "Hi" }] })
    ).rejects.toMatchObject({ category: "MISSING_BASE_URL" });
  });

  it("throws TIMEOUT on request abort", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      return new Promise((_, reject) => {
        // Never resolve; the AbortController will reject after timeout.
        setTimeout(() => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        }, 10);
      });
    });

    await expect(
      chatWithOllama({
        messages: [{ role: "user", content: "Hi" }],
        timeoutMs: 5,
      })
    ).rejects.toMatchObject({ category: "TIMEOUT" });

    fetchSpy.mockRestore();
  });

  it("throws UNAUTHORIZED on upstream 401", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    mockFetch(new Response("Unauthorized", { status: 401 }));

    await expect(
      chatWithOllama({ messages: [{ role: "user", content: "Hi" }] })
    ).rejects.toMatchObject({ category: "UNAUTHORIZED" });
  });

  it("throws MODEL_UNAVAILABLE on upstream 404", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    mockFetch(new Response("model not found", { status: 404 }));

    await expect(
      chatWithOllama({ messages: [{ role: "user", content: "Hi" }] })
    ).rejects.toMatchObject({ category: "MODEL_UNAVAILABLE" });
  });

  it("throws UPSTREAM_SERVER_ERROR on upstream 500", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    mockFetch(new Response("Internal server error", { status: 500 }));

    await expect(
      chatWithOllama({ messages: [{ role: "user", content: "Hi" }] })
    ).rejects.toMatchObject({ category: "UPSTREAM_SERVER_ERROR" });
  });

  it("throws MALFORMED_RESPONSE on invalid JSON", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    mockFetch(new Response("not json", { status: 200 }));

    await expect(
      chatWithOllama({ messages: [{ role: "user", content: "Hi" }] })
    ).rejects.toMatchObject({ category: "MALFORMED_RESPONSE" });
  });

  it("throws EMPTY_RESPONSE when choices are missing", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    mockFetch(new Response(JSON.stringify({ choices: [] }), { status: 200 }));

    await expect(
      chatWithOllama({ messages: [{ role: "user", content: "Hi" }] })
    ).rejects.toMatchObject({ category: "EMPTY_RESPONSE" });
  });

  it("throws EMPTY_RESPONSE when assistant content is empty", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    mockFetch(
      new Response(JSON.stringify({ choices: [{ message: { content: "   " } }] }), { status: 200 })
    );

    await expect(
      chatWithOllama({ messages: [{ role: "user", content: "Hi" }] })
    ).rejects.toMatchObject({ category: "EMPTY_RESPONSE" });
  });

  it("does not leak API keys in error messages", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    process.env.OLLAMA_API_KEY = "super-secret-key";
    mockFetch(new Response("Unauthorized", { status: 401 }));

    await expect(
      chatWithOllama({ messages: [{ role: "user", content: "Hi" }] })
    ).rejects.toSatisfy((error: OllamaClientError) => {
      const message = error.message;
      return (
        !message.includes("super-secret-key") &&
        !message.includes("Authorization") &&
        !message.includes("Bearer")
      );
    });
  });

  it("does not log API keys", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    process.env.OLLAMA_API_KEY = "top-secret";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockFetch(new Response("Unauthorized", { status: 401 }));

    await expect(
      chatWithOllama({ messages: [{ role: "user", content: "Hi" }] })
    ).rejects.toBeDefined();

    const allLogs = consoleError.mock.calls.map(c => String(c[0])).join(" ");
    expect(allLogs).not.toContain("top-secret");
    expect(allLogs).not.toContain("Bearer top-secret");
    consoleError.mockRestore();
  });
});

describe("Ollama health check", () => {
  it("reports not configured when base URL is missing", async () => {
    const result = await checkOllamaHealth();
    expect(result.configured).toBe(false);
    expect(result.reachable).toBe(false);
    expect(result.model).toBe(DEFAULT_OLLAMA_MODEL);
  });

  it("reports reachable and model available when /api/tags returns the selected model", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    mockFetch(
      new Response(JSON.stringify({ models: [{ name: DEFAULT_OLLAMA_MODEL }] }), { status: 200 })
    );

    const result = await checkOllamaHealth();
    expect(result.configured).toBe(true);
    expect(result.reachable).toBe(true);
    expect(result.authenticated).toBe(true);
    expect(result.modelAvailable).toBe(true);
    expect(result.message).toContain("reachable");
  });

  it("reports model unavailable when /api/tags omits the selected model", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    process.env.OLLAMA_MODEL = "missing-model";
    mockFetch(
      new Response(JSON.stringify({ models: [{ name: "other-model" }] }), { status: 200 })
    );

    const result = await checkOllamaHealth();
    expect(result.reachable).toBe(true);
    expect(result.modelAvailable).toBe(false);
  });

  it("does not perform a full inference during health check", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    const fetchSpy = mockFetch(
      new Response(JSON.stringify({ models: [{ name: DEFAULT_OLLAMA_MODEL }] }), { status: 200 })
    );

    await checkOllamaHealth();

    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/api/tags");
    expect(String(url)).not.toContain(OLLAMA_CHAT_COMPLETIONS_PATH);
  });
});
