import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./router";
import { classifyAiQuery } from "./ai-router";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  for (const key of [
    "AI_PROVIDER",
    "OLLAMA_BASE_URL",
    "OLLAMA_API_KEY",
    "OLLAMA_MODEL",
    "OLLAMA_TIMEOUT_MS",
    "OLLAMA_MAX_TOKENS",
    "GROQ_API_KEY",
    "GROQ_MODEL",
  ]) {
    delete process.env[key];
  }
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

function createCaller() {
  return appRouter.createCaller({
    req: new Request("http://localhost"),
    resHeaders: new Headers(),
    user: undefined,
  });
}

describe("AI status endpoint", () => {
  it("is passive and does not call Ollama", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const caller = createCaller();
    const status = await caller.ai.status();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(status.configured).toBe(true);
    expect(status.provider).toBe("ollama");
    expect(status.model).toBe("kimi-k2.7-code:cloud");
    expect(status.message).toContain("configured");
  });

  it("reports not configured when OLLAMA_BASE_URL is missing", async () => {
    const caller = createCaller();
    const status = await caller.ai.status();

    expect(status.configured).toBe(false);
    expect(status.provider).toBe("ollama");
    expect(status.message).toContain("OLLAMA_BASE_URL");
  });

  it("does not expose environment-variable inventory", async () => {
    process.env.SOME_SECRET_TOKEN = "should-not-appear";
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    const caller = createCaller();
    const status = await caller.ai.status();

    expect(status).not.toHaveProperty("envVarList");
    const json = JSON.stringify(status);
    expect(json).not.toContain("SOME_SECRET_TOKEN");
    expect(json).not.toContain("should-not-appear");
    expect(json).not.toContain("OLLAMA_API_KEY");
  });

  it("does not expose API keys or partial keys", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    process.env.OLLAMA_API_KEY = "super-secret-key-12345";
    const caller = createCaller();
    const status = await caller.ai.status();

    const json = JSON.stringify(status);
    expect(json).not.toContain("super-secret");
    expect(json).not.toContain("key-12345");
  });
});

describe("AI health endpoint", () => {
  it("performs a bounded non-inference health check", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: "kimi-k2.7-code:cloud" }] }), { status: 200 })
    );

    const caller = createCaller();
    const health = await caller.ai.health();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/api/tags");
    expect(String(url)).not.toContain("/v1/chat/completions");
    expect(health.configured).toBe(true);
    expect(health.reachable).toBe(true);
  });

  it("does not leak credentials or endpoint details", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    process.env.OLLAMA_API_KEY = "secret";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: "kimi-k2.7-code:cloud" }] }), { status: 200 })
    );

    const caller = createCaller();
    const health = await caller.ai.health();
    const json = JSON.stringify(health);
    expect(json).not.toContain("secret");
    expect(json).not.toContain("localhost:11434");
    expect(json).not.toContain("Authorization");
  });
});

describe("AI maintenanceChat integration", () => {
  it("bypasses the model for runtime time/date questions", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const caller = createCaller();
    const result = await caller.ai.maintenanceChat({
      message: "What time is it?",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.reply).toMatch(/^Answer:/);
    expect(result.reply.toLowerCase()).toContain("current");
    expect(result.error).toBeNull();
  });

  it("returns web-search failure for pure current-web questions when search is not configured", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const caller = createCaller();
    const result = await caller.ai.maintenanceChat({
      message: "What is the latest water utility news?",
    });

    expect(result.reply).toBe("I could not retrieve live web results right now.");
    expect(result.error).toBe("WEB_SEARCH_NOT_CONFIGURED");
    // Ollama should not have been called.
    expect(
      fetchSpy.mock.calls.filter(([url]) => String(url).includes("/v1/chat/completions"))
    ).toHaveLength(0);
  });

  it("returns module-data-not-loaded for dashboard questions when context says no data", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const caller = createCaller();
    const result = await caller.ai.maintenanceChat({
      message:
        "=== DASHBOARD CONTEXT ===\nStatus: No data loaded\nUSER QUESTION: Analyze overdue work orders in this dashboard",
    });

    expect(result.reply).toBe(
      "Module data is not loaded. Open the relevant dashboard module first so I can analyze its data."
    );
    expect(result.error).toBe("MODULE_DATA_NOT_LOADED");
    expect(
      fetchSpy.mock.calls.filter(([url]) => String(url).includes("/v1/chat/completions"))
    ).toHaveLength(0);
  });

  it("returns provider-neutral setup guidance when OLLAMA_BASE_URL is missing", async () => {
    const caller = createCaller();
    const result = await caller.ai.maintenanceChat({
      message: "What is cavitation?",
    });

    expect(result.error).toBe("MISSING_BASE_URL");
    expect(result.reply).toContain("OLLAMA_BASE_URL");
    expect(result.reply).not.toContain("GROQ_API_KEY");
    expect(result.reply).not.toContain("console.groq.com");
  });

  it("does not silently fall back to Groq after an Ollama failure", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Unauthorized", { status: 401 })
    );

    const caller = createCaller();
    const result = await caller.ai.maintenanceChat({
      message: "What is cavitation?",
    });

    expect(result.error).toBe("UNAUTHORIZED");
    expect(result.reply).toContain("⚠️");
    expect(result.reply).not.toContain("GROQ");
    expect(result.reply).not.toContain("console.groq.com");
  });

  it("returns MISSING_API_KEY for Ollama Cloud without a key", async () => {
    process.env.OLLAMA_BASE_URL = "https://ollama.com";
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const caller = createCaller();
    const result = await caller.ai.maintenanceChat({
      message: "What is cavitation?",
    });

    expect(result.error).toBe("MISSING_API_KEY");
    expect(result.reply).toContain("⚠️");
    expect(result.reply).toContain("OLLAMA_API_KEY");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses the native Cloud chat endpoint and payload", async () => {
    process.env.OLLAMA_BASE_URL = "https://ollama.com";
    process.env.OLLAMA_API_KEY = "cloud-key";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "kimi-k2.7-code:cloud",
          message: { role: "assistant", content: "Cloud cavitation answer" },
          done: true,
        }),
        { status: 200 }
      )
    );

    const caller = createCaller();
    const result = await caller.ai.maintenanceChat({ message: "What is cavitation?" });

    expect(result.reply).toContain("Cloud cavitation answer");
    expect(result.error).toBeNull();

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://ollama.com/api/chat");
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe("kimi-k2.7-code:cloud");
    expect(body.stream).toBe(false);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer cloud-key");
  });

  it("uses the configured model and preserves system prompt", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    process.env.OLLAMA_MODEL = "kimi-k2.7-code:cloud";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "Cavitation is..." } }] }),
        { status: 200 }
      )
    );

    const caller = createCaller();
    await caller.ai.maintenanceChat({ message: "What is cavitation?" });

    const init = fetchSpy.mock.calls[0][1] as { body: string };
    const body = JSON.parse(init.body);
    expect(body.model).toBe("kimi-k2.7-code:cloud");
    expect(body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "system" }),
      ])
    );
    expect(JSON.stringify(body.messages)).toContain("ODM Dashboard AI");
  });
});

describe("classifyAiQuery dashboard-statistic routing", () => {
  it("routes 'how many tasks loaded' to dashboard_data", () => {
    expect(classifyAiQuery("USER QUESTION: How many HTT tasks are loaded?")).toBe("dashboard_data");
  });

  it("routes 'summarize this planner' to dashboard_data", () => {
    expect(classifyAiQuery("USER QUESTION: Summarize this planner")).toBe("dashboard_data");
  });

  it("routes 'summarize this dashboard' to dashboard_data", () => {
    expect(classifyAiQuery("USER QUESTION: Summarize this dashboard")).toBe("dashboard_data");
  });

  it("routes 'who is responsible for monthly inspections' to dashboard_data", () => {
    expect(classifyAiQuery("USER QUESTION: Who is responsible for monthly inspections?")).toBe("dashboard_data");
  });

  it("routes 'which equipment is most susceptible' to dashboard_data", () => {
    expect(classifyAiQuery("USER QUESTION: Which equipment is most susceptible to cavitation?")).toBe("dashboard_data");
  });

  it("routes 'show current Post-PPP ownership' to dashboard_data", () => {
    expect(classifyAiQuery("USER QUESTION: Show current Post-PPP ownership")).toBe("dashboard_data");
  });

  it("routes 'show current planner status' to dashboard_data", () => {
    expect(classifyAiQuery("USER QUESTION: Show current planner status")).toBe("dashboard_data");
  });

  it("still routes web-exclusive questions to current_web", () => {
    expect(classifyAiQuery("USER QUESTION: What is the latest news today?")).toBe("current_web");
  });

  it("still routes general knowledge to general_knowledge", () => {
    expect(classifyAiQuery("USER QUESTION: What is cavitation?")).toBe("general_knowledge");
  });
});

describe("AI maintenanceChat dashboard-statistic integration", () => {
  it("does not short-circuit empty-but-loaded modules as missing data", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "There are 0 tasks loaded." } }] }),
        { status: 200 }
      )
    );

    const caller = createCaller();
    const result = await caller.ai.maintenanceChat({
      message:
        "=== DASHBOARD CONTEXT ===\nDashboard Type: maintenance\nTotal Records: 0\nUSER QUESTION: How many tasks are loaded?",
    });

    expect(result.reply).not.toBe(
      "Module data is not loaded. Open the relevant dashboard module first so I can analyze its data."
    );
    expect(result.error).toBeNull();
    expect(
      fetchSpy.mock.calls.filter(([url]) => String(url).includes("/v1/chat/completions"))
    ).toHaveLength(1);
  });

  it("keeps web-search-only questions on current_web even when web search is not configured", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const caller = createCaller();
    const result = await caller.ai.maintenanceChat({
      message: "USER QUESTION: What is the current weather in Manila?",
    });

    expect(result.reply).toBe("I could not retrieve live web results right now.");
    expect(result.error).toBe("WEB_SEARCH_NOT_CONFIGURED");
    expect(
      fetchSpy.mock.calls.filter(([url]) => String(url).includes("/v1/chat/completions"))
    ).toHaveLength(0);
  });
});

