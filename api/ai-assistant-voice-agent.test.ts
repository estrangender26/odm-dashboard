import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeSpeechRecognitionError, getSpeechRecognitionConstructor, VOICE_UNSUPPORTED_MESSAGE } from "../src/lib/voiceAgent";

describe("AI assistant voice agent helpers", () => {
  it("returns undefined without browser speech recognition so fallback can render without crashing", () => {
    expect(getSpeechRecognitionConstructor()).toBeUndefined();
    expect(VOICE_UNSUPPORTED_MESSAGE).toBe("Voice input is not supported on this browser. Please use text chat.");
  });

  it("maps microphone permission errors to a clear user message", () => {
    expect(describeSpeechRecognitionError({ error: "not-allowed" })).toContain("Microphone permission was denied");
    expect(describeSpeechRecognitionError({ error: "service-not-allowed" })).toContain("Microphone permission was denied");
  });

  it("keeps text chat and voice controls in the assistant UI source", () => {
    const source = readFileSync("src/components/AIAssistant.tsx", "utf8");
    expect(source).toContain("Ask about maintenance");
    expect(source).toContain("Start voice listening");
    expect(source).toContain("Voice reply ON");
    expect(source).toContain("VOICE_UNSUPPORTED_MESSAGE");
    expect(source).toContain("ODM Talk Bridge");
  });
});
