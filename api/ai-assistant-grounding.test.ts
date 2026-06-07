import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AI assistant grounding/system behavior", () => {
  it("keeps strict dashboard grounding rules in the client prompt and server system prompt", () => {
    const assistantSource = readFileSync("src/components/AIAssistant.tsx", "utf8").toLowerCase();
    const routerSource = readFileSync("api/ai-router.ts", "utf8").toLowerCase();
    const combined = `${assistantSource}\n${routerSource}`;

    expect(combined).toContain("dashboard data first");
    expect(combined).toContain("general knowledge questions may be answered normally");
    expect(combined).toContain("web search");
    expect(combined).toContain("do not invent missing");
    expect(combined).not.toContain("live web lookup is not enabled");
  });

  it("preserves Post-PPP ownership semantics in assistant grounding", () => {
    const assistantSource = readFileSync("src/components/AIAssistant.tsx", "utf8");
    const routerSource = readFileSync("api/ai-router.ts", "utf8");

    expect(assistantSource).toContain("Responsible/currentPppDoer means Current PPP execution doer");
    expect(assistantSource).toContain("Operations, AMD, and ARD are preference fields only");
    expect(routerSource).toContain("Recommended Future Doer is derived from consensus");
  });
});
