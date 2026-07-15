import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  VOICE_UNSUPPORTED_MESSAGE,
  buildSpeechFriendlyAssistantReply,
  describeSpeechRecognitionError,
  getSpeechRecognitionConstructor,
} from "../src/lib/voiceAgent";

describe("AI assistant voice agent helpers", () => {
  it("cleans web sources and URLs before voice playback", () => {
    const speech = buildSpeechFriendlyAssistantReply(
      "Answer:\nElon Musk is listed first in this result.\n\nSources:\n- Forbes Billionaires List — forbes.com\n- https://www.forbes.com/billionaires/\nSources: None"
    );

    expect(speech).toContain("Elon Musk is listed first");
    expect(speech).not.toContain("https://");
    expect(speech).not.toContain("Sources:");
    expect(speech).not.toContain("Sources: None");
    expect(speech).not.toContain("forbes.com");
  });

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
    expect(generalPromptsBlock).not.toContain(
      "Which KPIs are below benchmark?"
    );
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

  it("keeps voice-agent source independent of standalone dashboard routes", () => {
    const source = [
      readFileSync("src/components/AIAssistant.tsx", "utf8"),
      readFileSync("src/lib/voiceAgent.ts", "utf8"),
    ].join("\n");

    expect(source).not.toContain("mw-dashboard.html");
    expect(source).not.toContain("governance.html");
  });
  it("speaks assistant replies from every response path when voice reply is enabled", () => {
    const source = readFileSync("src/components/AIAssistant.tsx", "utf8");

    expect(source).toContain("const speakAssistantReply = (reply: string)");
    expect(source).toContain(
      "const appendAssistantMessage = (content: string)"
    );
    expect(source).toContain("appendAssistantMessage(res.reply)");
    expect(source).toContain(
      "appendAssistantMessage(MODULE_DATA_NOT_LOADED_MESSAGE)"
    );
    expect(source).toContain("window.speechSynthesis.cancel()");
    expect(source).toContain("window.speechSynthesis.speak(utterance)");
    expect(source).not.toContain(
      'setMessages(prev => [...prev, { role: "assistant", content: res.reply }])'
    );
  });

  it("shows unsupported voice-reply copy and exposes a compact manual replay button", () => {
    const source = readFileSync("src/components/AIAssistant.tsx", "utf8");

    expect(source).toContain("Voice reply is not supported on this browser.");
    expect(source).toContain("Speak last reply");
    expect(source).toContain("VOICE_REPLY_UNSUPPORTED_MESSAGE");
  });
});
