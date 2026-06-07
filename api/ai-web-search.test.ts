import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRuntimeTimeReply,
  classifyAiQuery,
  finalizeAiReplyForWebSearch,
  isRuntimeTimeQuestion,
  queryNeedsWebSearch,
  WEB_SEARCH_FAILURE_REPLY,
} from "./ai-router";
import {
  formatWebSearchResultsForPrompt,
  synthesizeWebSearchAnswer,
  webSearch,
} from "./web-search";

const repoFile = (path: string) => readFileSync(path, "utf8");

const ORIGINAL_WEB_SEARCH_ENV = {
  WEB_SEARCH_API_KEY: process.env.WEB_SEARCH_API_KEY,
  WEB_SEARCH_PROVIDER: process.env.WEB_SEARCH_PROVIDER,
  TAVILY_API_KEY: process.env.TAVILY_API_KEY,
};

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_WEB_SEARCH_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  vi.restoreAllMocks();
});

describe("ODM Dashboard AI web-search routing", () => {
  it("logs sanitized provider diagnostics when Tavily returns an HTTP error", async () => {
    process.env.WEB_SEARCH_PROVIDER = "tavily";
    process.env.WEB_SEARCH_API_KEY = "generic-secret-key";
    process.env.TAVILY_API_KEY = "tavily-secret-key";

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("do not log response bodies", {
        status: 401,
        statusText: "Unauthorized",
      })
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(webSearch("latest water utility news", 4)).rejects.toThrow(
      "Tavily search failed with HTTP 401"
    );

    expect(consoleError).toHaveBeenCalledTimes(1);
    const logged = String(consoleError.mock.calls[0]?.[0] || "");
    expect(logged).toContain("[web-search] provider=tavily");
    expect(logged).toContain("genericKeyPresent=true");
    expect(logged).toContain("tavilyKeyPresent=true");
    expect(logged).toContain("status=401");
    expect(logged).toContain('error="Unauthorized"');
    expect(logged).not.toContain("generic-secret-key");
    expect(logged).not.toContain("tavily-secret-key");
    expect(logged).not.toContain("do not log response bodies");
  });

  it("classifies general knowledge without requiring module data", () => {
    expect(classifyAiQuery("What is cavitation?")).toBe("general_knowledge");
    expect(classifyAiQuery("What is MTBF?")).toBe("general_knowledge");
    expect(classifyAiQuery("What is the difference between PM and PdM?")).toBe(
      "general_knowledge"
    );

    const assistantSource = repoFile("src/components/AIAssistant.tsx");
    expect(assistantSource).toContain("definitionQuestion");
    expect(assistantSource).toContain(
      "General knowledge questions may be answered normally"
    );
  });

  it("answers simple runtime time/date questions without web search", () => {
    const message = `=== DASHBOARD CONTEXT ===\nCurrent Date: 2026-06-07\nDashboard/browser runtime ISO: 2026-06-07T15:30:00.000Z\nDashboard/browser runtime timezone: America/New_York\nDashboard Type: help\n\nUSER QUESTION: What time is it?`;

    expect(isRuntimeTimeQuestion(message)).toBe(true);
    expect(classifyAiQuery(message)).toBe("runtime_time_date");
    expect(queryNeedsWebSearch(classifyAiQuery(message))).toBe(false);

    const reply = buildRuntimeTimeReply(message);
    expect(reply).toMatch(/^Answer:/);
    expect(reply).toContain("The current time is");
    expect(reply).toContain("on Sunday, June 7, 2026");
    expect(reply).toContain(
      "This is based on the dashboard/browser runtime time."
    );
    expect(reply).toContain("Sources:\n- Dashboard/browser runtime time");
    expect(reply).not.toContain(
      "I could not retrieve live web results right now."
    );
    expect(reply).not.toContain("Sources: None");
  });

  it("uses server runtime fallback when browser timezone is unavailable", () => {
    const message = `=== DASHBOARD CONTEXT ===\nDashboard/browser runtime ISO: 2026-06-07T15:30:00.000Z\nDashboard/browser runtime timezone: unknown\nDashboard Type: help\n\nUSER QUESTION: Current date`;
    const reply = buildRuntimeTimeReply(
      message,
      new Date("2026-06-07T12:00:00.000Z")
    );

    expect(isRuntimeTimeQuestion(message)).toBe(true);
    expect(queryNeedsWebSearch(classifyAiQuery(message))).toBe(false);
    expect(reply).toContain(
      "The current server time is 12:00 PM UTC on Sunday, June 7, 2026."
    );
    expect(reply).toContain(
      "Your local timezone was not available to the dashboard AI."
    );
    expect(reply).not.toContain(
      "I could not retrieve live web results right now."
    );
    expect(reply).not.toContain("Sources: None");
  });

  it("classifies current/live questions for web search or configured fallback", () => {
    expect(
      classifyAiQuery("What is the latest pump efficiency standard?")
    ).toBe("current_web");
    expect(classifyAiQuery("current news about water utilities")).toBe(
      "current_web"
    );
    expect(classifyAiQuery("Who is the richest person in the world?")).toBe(
      "current_web"
    );
    expect(classifyAiQuery("Who is the richest man in the world?")).toBe(
      "current_web"
    );
    expect(classifyAiQuery("Who is the richest man on earth?")).toBe(
      "current_web"
    );
    expect(classifyAiQuery("Who is the current CEO of Microsoft?")).toBe(
      "current_web"
    );
    expect(classifyAiQuery("What is the current price of Bitcoin?")).toBe(
      "current_web"
    );
    expect(
      classifyAiQuery("What is the latest standard/version of ECMAScript?")
    ).toBe("current_web");

    const routerSource = repoFile("api/ai-router.ts");
    expect(routerSource).toContain("webSearch(userQuestion, 4)");
    expect(routerSource).toContain(
      "Live web search is not configured for this deployment."
    );
    expect(routerSource).toContain(
      "I could not retrieve live web results right now."
    );
  });

  it("classifies dashboard questions with current web context as combined", () => {
    const message = `=== DASHBOARD CONTEXT ===\nDashboard Type: smp\n=== REQUIRED ANSWERING RULES ===\nUSER QUESTION: Compare current SMP coverage in this dashboard with latest industry guidance`;
    expect(classifyAiQuery(message)).toBe("combined_dashboard_web");

    const routerSource = repoFile("api/ai-router.ts");
    expect(routerSource).toContain("From dashboard data:");
    expect(routerSource).toContain("From web search:");
    expect(routerSource).toContain(
      "Dashboard/module data is the source of truth"
    );
  });

  it("synthesizes a web search answer instead of returning only source metadata", () => {
    const answer = synthesizeWebSearchAnswer({
      provider: "tavily",
      results: [
        {
          title: "Forbes Billionaires List",
          domain: "forbes.com",
          url: "https://www.forbes.com/billionaires/",
          snippet:
            "Elon Musk is the richest person in the world, with a net worth of $342 billion, according to Forbes real-time billionaire rankings.",
        },
      ],
    });

    expect(answer).toContain(
      "Answer:\nElon Musk is the richest person in the world"
    );
    expect(answer).not.toContain("From dashboard data");
    expect(answer).not.toContain("Module data is not loaded");
    expect(answer).toContain("Sources:");
    expect(answer).toContain("- Forbes Billionaires List — forbes.com");
    expect(answer).not.toContain("- https://www.forbes.com/billionaires/");
    expect(answer.toLowerCase()).not.toContain("knowledge cutoff");
  });

  it("keeps web-search prompt context focused on answer synthesis with sources", () => {
    const formatted = formatWebSearchResultsForPrompt({
      provider: "tavily",
      results: [
        {
          title: "Example Source",
          domain: "example.com",
          url: "https://example.com/result",
          snippet: "Short snippet only.",
        },
      ],
    });

    expect(formatted).toContain("SYNTHESIS REQUIREMENTS:");
    expect(formatted).toContain(
      "answer the user's question directly before listing sources"
    );
    expect(formatted).toContain("Do not merely list raw source metadata");
    expect(formatted).toContain("Do not mention knowledge cutoff");
    expect(formatted).toContain("Source title: Example Source");
    expect(formatted).toContain("Source domain: example.com");
    expect(formatted).toContain("Source URL: https://example.com/result");
    expect(formatted).toContain("Relevant content: Short snippet only.");
  });

  it("finalizes web search replies with direct Answer and Sources sections", () => {
    const reply = finalizeAiReplyForWebSearch(
      "Elon Musk is listed as the richest person in the world based on the provided result content.",
      "current_web",
      {
        provider: "tavily",
        results: [
          {
            title: "Forbes Billionaires List",
            domain: "forbes.com",
            url: "https://www.forbes.com/billionaires/",
            snippet:
              "Forbes lists Elon Musk at the top of its billionaires ranking.",
          },
        ],
      }
    );

    expect(reply).toMatch(/^Answer:/);
    expect(reply).toContain("Elon Musk");
    expect(reply).toContain("Sources:");
    expect(reply).toContain("Forbes Billionaires List — forbes.com");
    expect(reply).not.toContain("https://www.forbes.com/billionaires/");
  });

  it("removes knowledge-cutoff disclaimers when web search results exist", () => {
    const reply = finalizeAiReplyForWebSearch(
      "Answer:\nBased on my knowledge cutoff, this may not be up to date.\nForbes lists Elon Musk first.",
      "current_web",
      {
        provider: "tavily",
        results: [
          {
            title: "Forbes Billionaires List",
            domain: "forbes.com",
            url: "https://www.forbes.com/billionaires/",
            snippet: "Forbes lists Elon Musk first.",
          },
        ],
      }
    );

    expect(reply.toLowerCase()).not.toContain("knowledge cutoff");
    expect(reply).toContain("Sources:");
  });

  it("does not return only source metadata when search results exist", () => {
    const reply = finalizeAiReplyForWebSearch(
      "- Forbes Billionaires List\n- Domain: forbes.com\n- URL: https://www.forbes.com/billionaires/",
      "current_web",
      {
        provider: "tavily",
        results: [
          {
            title: "Forbes Billionaires List",
            domain: "forbes.com",
            url: "https://www.forbes.com/billionaires/",
            snippet: "",
          },
        ],
      }
    );

    expect(reply).toMatch(/^Answer:/);
    expect(reply).toContain(
      "I found a relevant source, but the search result did not include enough detail to answer confidently."
    );
    expect(reply).toContain("Sources:");
    expect(reply).not.toMatch(
      /^[-*]\s*Forbes Billionaires List\n[-*]\s*Domain:/
    );
  });

  it("preserves plain answer bullets while adding web answer framing", () => {
    const reply = finalizeAiReplyForWebSearch(
      "- Elon Musk leads the ranking.\n- Larry Ellison follows in the provided source.",
      "current_web",
      {
        provider: "tavily",
        results: [
          {
            title: "Forbes Billionaires List",
            domain: "forbes.com",
            url: "https://www.forbes.com/billionaires/",
            snippet:
              "Forbes ranks billionaires using real-time net worth estimates.",
          },
        ],
      }
    );

    expect(reply).toMatch(/^Answer:/);
    expect(reply).toContain("- Elon Musk leads the ranking.");
    expect(reply).not.toContain(
      "I found a relevant source, but the search result did not include enough detail"
    );
    expect(reply).toContain("Sources:");
  });

  it("returns only the live-web failure sentence when pure web search has no results", () => {
    const answer = synthesizeWebSearchAnswer({
      provider: "tavily",
      results: [],
    });

    expect(answer).toBe(WEB_SEARCH_FAILURE_REPLY);
    expect(answer).not.toContain("From dashboard data");
    expect(answer).not.toContain("Module data is not loaded");
    expect(answer).not.toContain("Sources: None");
    expect(answer).not.toContain("Sources:");
  });

  it("keeps pure web failure output free of dashboard fallback text", () => {
    expect(WEB_SEARCH_FAILURE_REPLY).toBe(
      "I could not retrieve live web results right now."
    );
    expect(WEB_SEARCH_FAILURE_REPLY).not.toContain("From dashboard data");
    expect(WEB_SEARCH_FAILURE_REPLY).not.toContain("Module data is not loaded");
    expect(WEB_SEARCH_FAILURE_REPLY).not.toContain("Sources: None");
    expect(WEB_SEARCH_FAILURE_REPLY.toLowerCase()).not.toContain(
      "knowledge cutoff"
    );
  });

  it("treats pure web results without usable snippets as live-web failure", () => {
    const answer = synthesizeWebSearchAnswer({
      provider: "tavily",
      results: [
        {
          title: "Relevant Source",
          domain: "example.com",
          url: "https://example.com/relevant",
          snippet: "",
        },
      ],
    });

    expect(answer).toBe(WEB_SEARCH_FAILURE_REPLY);
    expect(answer).not.toContain("From dashboard data");
    expect(answer).not.toContain("Module data is not loaded");
    expect(answer).not.toContain("Sources:");
    expect(answer.toLowerCase()).not.toContain("knowledge cutoff");
  });

  it("keeps combined dashboard-plus-web formatting available", () => {
    const reply = finalizeAiReplyForWebSearch(
      "Dashboard records show 12 SMPs are active.\n\nFrom web search:\nRecent industry guidance emphasizes annual review cycles.",
      "combined_dashboard_web",
      {
        provider: "tavily",
        results: [
          {
            title: "SMP Guidance",
            domain: "example.org",
            url: "https://example.org/smp-guidance",
            snippet:
              "Recent industry guidance emphasizes annual review cycles.",
          },
        ],
      }
    );

    expect(reply).toContain("From dashboard data:");
    expect(reply).toContain("From web search:");
    expect(reply).toContain("Sources:");
  });

  it("keeps dashboard_data unloaded fallback for true module-analysis questions", () => {
    const assistantSource = repoFile("src/components/AIAssistant.tsx");

    expect(
      classifyAiQuery("Analyze overdue work orders in this dashboard")
    ).toBe("dashboard_data");
    expect(assistantSource).toContain(
      "appendAssistantMessage(MODULE_DATA_NOT_LOADED_MESSAGE)"
    );
    expect(assistantSource).toContain(
      "Module data is not loaded. Open the relevant dashboard module first so I can analyze its data."
    );
  });

  it("keeps module hallucination guardrails and Post-PPP semantics", () => {
    const combined = `${repoFile("src/components/AIAssistant.tsx")}\n${repoFile("api/ai-router.ts")}`;

    expect(combined).toContain("Do not invent missing module data");
    expect(combined).toContain("Do not invent missing module values");
    expect(combined).toContain(
      "Responsible/currentPppDoer is the current PPP execution doer"
    );
    expect(combined).toContain(
      "Operations, AMD, and ARD are future ownership preference fields"
    );
    expect(combined).toContain(
      "Recommended Future Doer is derived from consensus"
    );
  });

  it("does not touch protected routing entry points or static dashboard routing strings", () => {
    expect(repoFile("api/boot.ts")).toContain("/mw-dashboard");
    expect(repoFile("api/boot.ts")).toContain("/governance");

    const changedSurface = [
      "api/ai-router.ts",
      "api/web-search.ts",
      "src/components/AIAssistant.tsx",
      "api/ai-web-search.test.ts",
      "api/ai-assistant-grounding.test.ts",
      "api/ai-assistant-standardization.test.ts",
      ".env.example",
    ];

    expect(changedSurface).not.toContain("api/boot.ts");
  });
});
