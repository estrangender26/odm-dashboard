// Ollama OpenAI-compatible conversational LLM client
// Server-side only. Credentials and endpoint details never leave the backend.

export const DEFAULT_OLLAMA_MODEL = "kimi-k2.7-code:cloud";
export const DEFAULT_OLLAMA_TIMEOUT_MS = 120_000;
export const DEFAULT_OLLAMA_MAX_TOKENS = 1_500;

export const OLLAMA_CHAT_COMPLETIONS_PATH = "/v1/chat/completions";

export type OllamaErrorCategory =
  | "MISSING_BASE_URL"
  | "MISSING_API_KEY"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "UNAUTHORIZED"
  | "MODEL_UNAVAILABLE"
  | "UPSTREAM_CLIENT_ERROR"
  | "UPSTREAM_SERVER_ERROR"
  | "MALFORMED_RESPONSE"
  | "EMPTY_RESPONSE"
  | "UNKNOWN_ERROR";

export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaChatOptions {
  messages: OllamaMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface OllamaChatResult {
  reply: string;
  model: string;
}

export interface OllamaConfig {
  provider: "ollama";
  baseUrl: string | undefined;
  apiKey: string | undefined;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  configured: boolean;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

export class OllamaClientError extends Error {
  category: OllamaErrorCategory;

  constructor(category: OllamaErrorCategory, message: string) {
    super(message);
    this.name = "OllamaClientError";
    this.category = category;
  }
}

export function normalizeOllamaBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, "");
}

function getEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed <= 0 || !Number.isFinite(parsed)) return fallback;
  return Math.min(parsed, Number.MAX_SAFE_INTEGER);
}

export function getOllamaConfig(): OllamaConfig {
  const provider = "ollama";
  const baseUrl = normalizeOllamaBaseUrl(process.env.OLLAMA_BASE_URL);
  const apiKey = process.env.OLLAMA_API_KEY?.trim() || undefined;
  const model = process.env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;
  const timeoutMs = getEnvNumber("OLLAMA_TIMEOUT_MS", DEFAULT_OLLAMA_TIMEOUT_MS);
  const maxTokens = getEnvNumber("OLLAMA_MAX_TOKENS", DEFAULT_OLLAMA_MAX_TOKENS);

  return {
    provider,
    baseUrl,
    apiKey,
    model,
    timeoutMs,
    maxTokens,
    configured: Boolean(baseUrl),
  };
}

function buildChatUrl(baseUrl: string): string {
  return `${baseUrl}${OLLAMA_CHAT_COMPLETIONS_PATH}`;
}

function buildRequestHeaders(apiKey: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function buildRequestBody(options: OllamaChatOptions, config: OllamaConfig): Record<string, unknown> {
  return {
    model: options.model || config.model,
    messages: options.messages,
    temperature: typeof options.temperature === "number" ? options.temperature : 0.2,
    max_tokens: typeof options.maxTokens === "number" ? options.maxTokens : config.maxTokens,
  };
}

export function categorizeUpstreamStatus(status: number, bodyText: string): OllamaErrorCategory {
  if (status === 401 || status === 403) return "UNAUTHORIZED";
  if (status === 404 || /model.*not found|not found/i.test(bodyText)) return "MODEL_UNAVAILABLE";
  if (status >= 500) return "UPSTREAM_SERVER_ERROR";
  if (status >= 400) return "UPSTREAM_CLIENT_ERROR";
  return "UNKNOWN_ERROR";
}

export async function chatWithOllama(options: OllamaChatOptions): Promise<OllamaChatResult> {
  const config = getOllamaConfig();

  if (!config.baseUrl) {
    throw new OllamaClientError(
      "MISSING_BASE_URL",
      "AI provider is not configured. Set OLLAMA_BASE_URL to a reachable Ollama endpoint."
    );
  }

  const model = options.model || config.model;
  const url = buildChatUrl(config.baseUrl);
  const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : config.timeoutMs;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("ollama-timeout"), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: buildRequestHeaders(config.apiKey),
      body: JSON.stringify(buildRequestBody(options, config)),
      signal: controller.signal,
    });

    const bodyText = await resp.text();

    if (!resp.ok) {
      const category = categorizeUpstreamStatus(resp.status, bodyText);
      const publicMessage = upstreamErrorMessage(category, resp.status);
      console.error(`[OLLAMA ERROR] category=${category} status=${resp.status}`);
      throw new OllamaClientError(category, publicMessage);
    }

    let data: ChatCompletionResponse;
    try {
      data = JSON.parse(bodyText) as ChatCompletionResponse;
    } catch {
      console.error("[OLLAMA ERROR] Malformed JSON response from Ollama");
      throw new OllamaClientError(
        "MALFORMED_RESPONSE",
        "The AI provider returned an unparseable response. Please try again."
      );
    }

    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      console.error("[OLLAMA ERROR] Empty assistant content");
      throw new OllamaClientError(
        "EMPTY_RESPONSE",
        "The AI provider returned an empty response. Please try again."
      );
    }

    return { reply: content.trim(), model };
  } catch (error: unknown) {
    if (error instanceof OllamaClientError) throw error;

    if (error instanceof DOMException && error.name === "AbortError") {
      console.error(`[OLLAMA ERROR] Request aborted after ${timeoutMs}ms`);
      throw new OllamaClientError(
        "TIMEOUT",
        "The AI request timed out. Try a shorter question or check the Ollama endpoint."
      );
    }

    const message = error instanceof Error ? error.message : String(error || "Unknown error");
    console.error("[OLLAMA ERROR] Network or unexpected error:", message);
    throw new OllamaClientError(
      "NETWORK_ERROR",
      "Connection error. Please check the AI provider endpoint and network."
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

function upstreamErrorMessage(category: OllamaErrorCategory, status: number): string {
  switch (category) {
    case "UNAUTHORIZED":
      return "AI provider authentication failed. Check OLLAMA_API_KEY or endpoint credentials.";
    case "MODEL_UNAVAILABLE":
      return "The requested AI model is not available on the configured Ollama endpoint.";
    case "UPSTREAM_SERVER_ERROR":
      return `AI provider server error (HTTP ${status}). Please try again later.`;
    case "UPSTREAM_CLIENT_ERROR":
      return `AI provider rejected the request (HTTP ${status}). Please check the model and settings.`;
    default:
      return `AI provider error (HTTP ${status}). Please try again.`;
  }
}

export interface OllamaHealthResult {
  configured: boolean;
  reachable: boolean;
  authenticated: boolean;
  modelAvailable: boolean;
  model: string;
  message: string;
}

const HEALTH_CHECK_TIMEOUT_MS = 5_000;

export async function checkOllamaHealth(): Promise<OllamaHealthResult> {
  const config = getOllamaConfig();
  const model = config.model;

  if (!config.baseUrl) {
    return {
      configured: false,
      reachable: false,
      authenticated: false,
      modelAvailable: false,
      model,
      message: "OLLAMA_BASE_URL is not set.",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("health-timeout"), HEALTH_CHECK_TIMEOUT_MS);

  try {
    // Lightweight /api/tags probe to verify endpoint and list models.
    const url = `${config.baseUrl}/api/tags`;
    const resp = await fetch(url, {
      method: "GET",
      headers: buildRequestHeaders(config.apiKey),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const category = categorizeUpstreamStatus(resp.status, await resp.text().catch(() => ""));
      return {
        configured: true,
        reachable: false,
        authenticated: category !== "UNAUTHORIZED",
        modelAvailable: false,
        model,
        message: upstreamErrorMessage(category, resp.status),
      };
    }

    let data: { models?: Array<{ name?: string }> } = {};
    try {
      data = (await resp.json()) as { models?: Array<{ name?: string }> };
    } catch {
      // Reachable but non-JSON body; treat as reachable and authenticated.
    }

    const modelNames = new Set((data.models || []).map(m => m.name).filter(Boolean));
    const modelAvailable = modelNames.has(model) || modelNames.size === 0;

    return {
      configured: true,
      reachable: true,
      authenticated: true,
      modelAvailable,
      model,
      message: modelAvailable
        ? "Ollama endpoint is reachable and the selected model is listed."
        : "Ollama endpoint is reachable, but the selected model was not found in the local model list.",
    };
  } catch (error: unknown) {
    const isAuth =
      error instanceof OllamaClientError && error.category === "UNAUTHORIZED";
    return {
      configured: true,
      reachable: false,
      authenticated: !isAuth,
      modelAvailable: false,
      model,
      message:
        error instanceof OllamaClientError
          ? error.message
          : "Ollama health check could not reach the endpoint.",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
