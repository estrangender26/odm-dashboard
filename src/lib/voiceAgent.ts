export const VOICE_UNSUPPORTED_MESSAGE = "Voice input is not supported on this browser. Please use text chat.";

const MICROPHONE_PERMISSION_DENIED_MESSAGE = "Microphone permission was denied. Please allow microphone access and try again.";

type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

type SpeechRecognitionErrorLike = {
  error?: string;
  message?: string;
};

type SpeechRecognitionGlobal = typeof globalThis & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  const speechGlobal = globalThis as SpeechRecognitionGlobal;
  return speechGlobal.SpeechRecognition || speechGlobal.webkitSpeechRecognition;
}

export function describeSpeechRecognitionError(event?: SpeechRecognitionErrorLike): string {
  if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
    return MICROPHONE_PERMISSION_DENIED_MESSAGE;
  }

  if (event?.error === "no-speech") {
    return "No speech was detected. Please try again or use text chat.";
  }

  if (event?.error === "audio-capture") {
    return "No microphone was detected. Please connect a microphone and try again.";
  }

  return event?.message || "Voice input stopped. Please try again or use text chat.";
}

export function buildSpeechFriendlyAssistantReply(reply: string): string {
  return reply
    .replace(/^\s*Sources:\s*None\s*$/gim, "")
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .replace(/^\s*[-*]\s*[^\n]*\s+—\s+[^\n]*$/gim, "")
    .replace(/^\s*Sources:\s*\n(?:\s*[-*].*\n?)*/gim, "")
    .replace(/^\s*(?:Source title|Source domain|Source URL|Provider|Snippet):.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
