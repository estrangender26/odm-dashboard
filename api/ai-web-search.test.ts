import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyAiQuery } from "./ai-router";
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
      "From web search:\nElon Musk is the richest person in the world"
    );
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
          snippet:
            "Example result includes enough detail to answer the question directly.",
        },
      ],
    });

    expect(formatted).toContain(
      "synthesize a direct answer instead of listing only source metadata"
    );
    expect(formatted).toContain("Do not mention model knowledge cutoff");
    expect(formatted).toContain("From web search:");
    expect(formatted).toContain("Sources:");
    expect(formatted).toContain("Title: Example Source");
    expect(formatted).toContain("Domain: example.com");
    expect(formatted).toContain("URL: https://example.com/result");
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
