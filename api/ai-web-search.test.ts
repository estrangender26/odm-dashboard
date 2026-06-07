import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
} from "./web-search";

const repoFile = (path: string) => readFileSync(path, "utf8");

describe("ODM Dashboard AI web-search routing", () => {
  it("classifies general knowledge without requiring module data", () => {
    expect(classifyAiQuery("What is cavitation?")).toBe("general-knowledge");
    expect(classifyAiQuery("What is MTBF?")).toBe("general-knowledge");
    expect(classifyAiQuery("What is the difference between PM and PdM?")).toBe(
      "general-knowledge"
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
    expect(classifyAiQuery(message)).toBe("general-knowledge");
    expect(queryNeedsWebSearch(classifyAiQuery(message))).toBe(false);

    const reply = buildRuntimeTimeReply(message);
    expect(reply).toMatch(/^Answer:/);
    expect(reply).toContain("The current time is");
    expect(reply).toContain("on Sunday, June 7, 2026");
    expect(reply).toContain("This is based on the dashboard/browser runtime time.");
    expect(reply).toContain("Sources:\n- Dashboard/browser runtime time");
    expect(reply).not.toContain("I could not retrieve live web results right now.");
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
    expect(reply).toContain("The current server time is 12:00 PM UTC on Sunday, June 7, 2026.");
    expect(reply).toContain("Your local timezone was not available to the dashboard AI.");
    expect(reply).not.toContain("I could not retrieve live web results right now.");
    expect(reply).not.toContain("Sources: None");
  });

  it("classifies current/live questions for web search or configured fallback", () => {
    expect(
      classifyAiQuery("What is the latest pump efficiency standard?")
    ).toBe("web-current");
    expect(classifyAiQuery("current news about water utilities")).toBe(
      "web-current"
    );
    expect(classifyAiQuery("Who is the richest person in the world?")).toBe(
      "web-current"
    );
    expect(classifyAiQuery("Who is the richest man on earth?")).toBe(
      "web-current"
    );
    expect(classifyAiQuery("Who is the current CEO of Microsoft?")).toBe(
      "web-current"
    );
    expect(classifyAiQuery("What is the current price of Bitcoin?")).toBe(
      "web-current"
    );
    expect(
      classifyAiQuery("What is the latest standard/version of ECMAScript?")
    ).toBe("web-current");

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
    expect(classifyAiQuery(message)).toBe("combined-module-web");

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
    expect(answer).toContain("- https://www.forbes.com/billionaires/");
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
      "web-current",
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
    expect(reply).toContain("https://www.forbes.com/billionaires/");
  });

  it("removes knowledge-cutoff disclaimers when web search results exist", () => {
    const reply = finalizeAiReplyForWebSearch(
      "Answer:\nBased on my knowledge cutoff, this may not be up to date.\nForbes lists Elon Musk first.",
      "web-current",
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
      "web-current",
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
    expect(reply).not.toMatch(/^[-*]\s*Forbes Billionaires List\n[-*]\s*Domain:/);
  });

  it("preserves plain answer bullets while adding web answer framing", () => {
    const reply = finalizeAiReplyForWebSearch(
      "- Elon Musk leads the ranking.\n- Larry Ellison follows in the provided source.",
      "web-current",
      {
        provider: "tavily",
        results: [
          {
            title: "Forbes Billionaires List",
            domain: "forbes.com",
            url: "https://www.forbes.com/billionaires/",
            snippet: "Forbes ranks billionaires using real-time net worth estimates.",
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
  });

  it("uses the explicit insufficient-snippet answer when web details are missing", () => {
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

    expect(answer).toContain(
      "I found a relevant source, but the result snippet did not include enough detail to answer confidently."
    );
    expect(answer).toMatch(/^Answer:/);
    expect(answer).toContain("Sources:");
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
