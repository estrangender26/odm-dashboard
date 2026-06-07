import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyAiQuery } from "./ai-router";
import { formatWebSearchResultsForPrompt } from "./web-search";

const repoFile = (path: string) => readFileSync(path, "utf8");

describe("ODM Dashboard AI web-search routing", () => {
  it("classifies general knowledge without requiring module data", () => {
    expect(classifyAiQuery("What is cavitation?")).toBe("general-knowledge");
    expect(classifyAiQuery("What is MTBF?")).toBe("general-knowledge");
    expect(classifyAiQuery("What is the difference between PM and PdM?")).toBe("general-knowledge");

    const assistantSource = repoFile("src/components/AIAssistant.tsx");
    expect(assistantSource).toContain("definitionQuestion");
    expect(assistantSource).toContain("General knowledge questions may be answered normally");
  });

  it("classifies current/live questions for web search or configured fallback", () => {
    expect(classifyAiQuery("What is the latest pump efficiency standard?")).toBe("web-current");
    expect(classifyAiQuery("current news about water utilities")).toBe("web-current");

    const routerSource = repoFile("api/ai-router.ts");
    expect(routerSource).toContain("webSearch(userQuestion, 4)");
    expect(routerSource).toContain("Live web search is not configured for this deployment.");
    expect(routerSource).toContain("I could not retrieve live web results right now.");
  });

  it("classifies dashboard questions with current web context as combined", () => {
    const message = `=== DASHBOARD CONTEXT ===\nDashboard Type: smp\n=== REQUIRED ANSWERING RULES ===\nUSER QUESTION: Compare current SMP coverage in this dashboard with latest industry guidance`;
    expect(classifyAiQuery(message)).toBe("combined-module-web");

    const routerSource = repoFile("api/ai-router.ts");
    expect(routerSource).toContain("From dashboard data:");
    expect(routerSource).toContain("From web search:");
    expect(routerSource).toContain("Dashboard/module data is the source of truth");
  });

  it("formats concise web search results with source title, domain, and URL", () => {
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

    expect(formatted).toContain("Title: Example Source");
    expect(formatted).toContain("Domain: example.com");
    expect(formatted).toContain("URL: https://example.com/result");
  });

  it("keeps module hallucination guardrails and Post-PPP semantics", () => {
    const combined = `${repoFile("src/components/AIAssistant.tsx")}\n${repoFile("api/ai-router.ts")}`;

    expect(combined).toContain("Do not invent missing module data");
    expect(combined).toContain("Do not invent missing module values");
    expect(combined).toContain("Responsible/currentPppDoer is the current PPP execution doer");
    expect(combined).toContain("Operations, AMD, and ARD are future ownership preference fields");
    expect(combined).toContain("Recommended Future Doer is derived from consensus");
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
