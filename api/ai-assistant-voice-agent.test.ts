import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  describeSpeechRecognitionError,
  getSpeechRecognitionConstructor,
  VOICE_UNSUPPORTED_MESSAGE,
} from "../src/lib/voiceAgent";

describe("AI assistant voice agent helpers", () => {
  it("returns undefined without browser speech recognition so fallback can render without crashing", () => {
    expect(getSpeechRecognitionConstructor()).toBeUndefined();
    expect(VOICE_UNSUPPORTED_MESSAGE).toBe(
      "Voice input is not supported on this browser. Please use text chat."
    );
  });

  it("maps microphone permission errors to a clear user message", () => {
    expect(describeSpeechRecognitionError({ error: "not-allowed" })).toContain(
      "Microphone permission was denied"
    );
    expect(
      describeSpeechRecognitionError({ error: "service-not-allowed" })
    ).toContain("Microphone permission was denied");
  });

  it("keeps text chat and voice controls in the assistant UI source", () => {
    const source = readFileSync("src/components/AIAssistant.tsx", "utf8");
    expect(source).toContain("Ask about this dashboard's data");
    expect(source).toContain("Start voice listening");
    expect(source).toContain("Voice reply ON");
    expect(source).toContain("Voice captured. Review then tap Send.");
    expect(source).toContain(
      "No voice captured. Please try again or use text chat."
    );
    expect(source).toContain(
      "Module data is not loaded. Open the relevant dashboard module first so I can analyze its data."
    );
    expect(source).toContain("VOICE_UNSUPPORTED_MESSAGE");
    expect(source).toContain("ODM Talk Bridge");
  });

  it("does not auto-send the captured final transcript when recognition ends", () => {
    const source = readFileSync("src/components/AIAssistant.tsx", "utf8");
    const onEndHandler =
      source.match(/recognition\.onend = \(\) => \{[\s\S]*?\n    \};/)?.[0] ||
      "";

    expect(onEndHandler).toContain("finalTranscript.trim()");
    expect(onEndHandler).toContain("setInput(finalTranscript)");
    expect(onEndHandler).toContain("VOICE_CAPTURED_REVIEW_MESSAGE");
    expect(onEndHandler).not.toContain("send(finalTranscript)");
  });

  it("keeps unloaded assistants on general navigation prompts", () => {
    const source = readFileSync("src/components/AIAssistant.tsx", "utf8");

    expect(source).toContain("GENERAL_HELP_PROMPTS");
    expect(source).toContain("What can this dashboard do?");
    expect(source).toContain("Which module should I open?");
    expect(source).toContain("How do I use Maintenance Planning?");
    expect(source).toContain("How do I use ODM Talk?");
    expect(source).toMatch(/hasModuleData\s*\?/);
  });

  it("does not expose module-analysis prompt copy in the unloaded general prompt list", () => {
    const source = readFileSync("src/components/AIAssistant.tsx", "utf8");
    const generalPromptsBlock =
      source.match(/const GENERAL_HELP_PROMPTS = \[([\s\S]*?)\];/)?.[0] || "";

    expect(generalPromptsBlock).toContain("What can this dashboard do?");
    expect(generalPromptsBlock).toContain("Which module should I open?");
    expect(generalPromptsBlock).toContain("How do I use Maintenance Planning?");
    expect(generalPromptsBlock).toContain("How do I use ODM Talk?");
    expect(generalPromptsBlock).not.toContain("Analyze PM compliance trends");
    expect(generalPromptsBlock).not.toContain("Identify high-risk equipment");
    expect(generalPromptsBlock).not.toContain("Which KPIs are below benchmark?");
    expect(generalPromptsBlock).not.toContain("Analyze schedule delays");
  });

  it("requires usable module data before module-specific quick questions are shown", () => {
    const source = readFileSync("src/components/AIAssistant.tsx", "utf8");

    expect(source).toContain("function hasUsableModuleData");
    expect(source).toContain("return false;");
    expect(source).toContain(
      "const prompts = hasModuleData\n    ? quickQuestions || CONTEXT_PROMPTS[contextType] || CONTEXT_PROMPTS.help\n    : GENERAL_HELP_PROMPTS;"
    );
  });

  it("does not include forbidden route files in the working diff", () => {
    const changedFiles = execSync("git diff --name-only HEAD", {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);

    expect(changedFiles).not.toContain("api/boot.ts");
    expect(changedFiles.some(file => file.includes("mw-dashboard"))).toBe(
      false
    );
    expect(changedFiles.some(file => file.includes("governance"))).toBe(false);
  });
});
