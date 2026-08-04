import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import {
  formatWebSearchResultsForPrompt,
  getWebSearchProvider,
  synthesizeWebSearchAnswer,
  isWebSearchConfigured,
  webSearch,
  type WebSearchResponse,
} from "./web-search";
import {
  chatWithOllama,
  checkOllamaHealth,
  getOllamaConfig,
  type OllamaClientError,
} from "./ollama-client";

const SYSTEM_PROMPT = `You are ODM Dashboard AI: a real AI assistant with dashboard grounding when relevant. Classify each request as exactly one of: general_knowledge, current_web, dashboard_data, combined_dashboard_web, or runtime_time_date. For general_knowledge questions, answer naturally using the LLM and do not require dashboard data. For current_web questions, use WEB SEARCH CONTEXT and answer naturally first, then a Sources section with source title and domain only. For dashboard_data questions, use active dashboard/module data first and format the answer with "From dashboard data:". For combined_dashboard_web questions, use both and format with "From dashboard data:", "From web search:", and "Sources:" only when the user explicitly asks to compare dashboard data with external/current knowledge. Runtime time/date questions are answered by the runtime before reaching the model. Do not return only raw titles, domains, URLs, snippets, provider names, metadata labels, or source lists as the final answer. Never output "Sources: None". Do not mention a knowledge cutoff when live web search was attempted. If search failed, say exactly "I could not retrieve live web results right now." and do not add dashboard fallback. If module data is empty or unavailable for a dashboard_data question, say exactly "Module data is not loaded. Open the relevant dashboard module first so I can analyze its data." Do not invent missing module values, task counts, KPI values, equipment names, ownership decisions, SMP coverage, document counts, file/folder counts, records, or schedule status. Dashboard/module data is the source of truth for task counts, KPI values, equipment names, document counts, schedule delays, ownership decisions, and Post-PPP recommendations, and web search must not override it. For Post-PPP Planning, Responsible/currentPppDoer is the current PPP execution doer; Operations, AMD, and ARD are future ownership preference fields; Recommended Future Doer is derived from consensus and this ownership logic must not be changed. Give practical, field-oriented, concise recommendations grounded in the supplied module evidence. Ask clarifying questions only when essential.`;

const GITHUB_API = "https://api.github.com";
const REPO_TREE_PROMPT =
  /\b(list|show|display|print)\b[\s\S]*\b(all\s+)?files?\b[\s\S]*\b(repo|repository|file\s*tree|tree)\b/i;
const MAX_TREE_ITEMS = 1200;
const MAX_LOCAL_DEPTH = 8;
const IGNORED_TREE_ENTRIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".cache",
  ".vite",
  "coverage",
]);

interface RepoTreeEntry {
  path: string;
  type: "blob" | "tree" | string;
}

const USER_QUESTION_PATTERN = /USER QUESTION:\s*([\s\S]*)$/i;

const MODULE_DATA_TERMS =
  /\b(active module|dashboard data|module data|this dashboard|these records|this module|work orders?|tasks?|task count|kpis?|equipment|smp|manuals?|documents?|folders?|files?|schedule|critical path|milestones?|governance|inspection|post-ppp|ppp|currentpppdoer|responsible|ownership|coverage|uploads?|records?|my dashboard|our dashboard)\b/i;
const EXPLICIT_DASHBOARD_ANCHOR_TERMS =
  /\b(active module|dashboard data|module data|this dashboard|these records|this module|loaded records|my dashboard|our dashboard|in the dashboard|from the dashboard|our pump|our pumps|our assets?|our equipment)\b/i;
const COMBINED_COMPARE_TERMS =
  /\b(compare|against|versus|vs\.?|benchmark|best practices?|industry|external|web|current guidance|latest guidance|current standards?)\b/i;
const CURRENT_WEB_TERMS =
  /\b(current|currently|live|latest|today|tonight|tomorrow|yesterday|this week|this month|this year|now|right now|recent|newest|breaking|news|price|prices|market|stock|ranking|rankings|richest|wealthiest|billionaire|billionaires|net worth|ceo|chief executive|weather|forecast|time|exchange rate|inflation|interest rate|law|laws|regulation|regulations|standard|standards|version|release|model info|product info|availability)\b/i;
const CURRENT_PPP_ONLY_PATTERN =
  /\bcurrent\s+ppp|currentpppdoer|current\s+doer|current\s+execution\s+doer\b/i;

export type AiQueryClass =
  | "general_knowledge"
  | "current_web"
  | "dashboard_data"
  | "combined_dashboard_web"
  | "runtime_time_date";

export const WEB_SEARCH_FAILURE_REPLY =
  "I could not retrieve live web results right now.";

const SIMPLE_RUNTIME_TIME_PATTERN =
  /^\s*(?:what(?:\s+is|'s)?\s+(?:the\s+)?time(?:\s+is\s+it)?|what\s+time\s+is\s+it|current\s+time|time\s+now)\??\s*$/i;
const SIMPLE_RUNTIME_DATE_PATTERN =
  /^\s*(?:what(?:\s+is|'s)?\s+(?:today(?:'s|’s)?\s+date|the\s+date|today)|what\s+day\s+is\s+it|current\s+date|date\s+today)\??\s*$/i;
const BROWSER_RUNTIME_ISO_PATTERN =
  /Dashboard\/browser runtime ISO:\s*([^\n]+)/i;
const BROWSER_RUNTIME_TIMEZONE_PATTERN =
  /Dashboard\/browser runtime timezone:\s*([^\n]+)/i;

export function extractUserQuestion(message: string): string {
  const match = USER_QUESTION_PATTERN.exec(message);
  return (match?.[1] || message).trim();
}

export function isRuntimeTimeQuestion(message: string): boolean {
  const question = extractUserQuestion(message).trim();
  return (
    SIMPLE_RUNTIME_TIME_PATTERN.test(question) ||
    SIMPLE_RUNTIME_DATE_PATTERN.test(question)
  );
}

function getRuntimeContextValue(
  message: string,
  pattern: RegExp
): string | null {
  const value = pattern.exec(message)?.[1]?.trim();
  if (!value || value.toLowerCase() === "unknown") return null;
  return value;
}

function formatRuntimeDateTime(date: Date, timeZone?: string): string {
  const options = timeZone ? { timeZone } : undefined;
  const time = new Intl.DateTimeFormat("en-US", {
    ...options,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
  const day = new Intl.DateTimeFormat("en-US", {
    ...options,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
  return `${time} on ${day}`;
}

export function buildRuntimeTimeReply(
  message: string,
  now = new Date()
): string {
  const browserIso = getRuntimeContextValue(
    message,
    BROWSER_RUNTIME_ISO_PATTERN
  );
  const browserTimeZone = getRuntimeContextValue(
    message,
    BROWSER_RUNTIME_TIMEZONE_PATTERN
  );

  if (browserIso && browserTimeZone) {
    const browserDate = new Date(browserIso);
    if (!Number.isNaN(browserDate.getTime())) {
      return [
        "Answer:",
        `The current time is ${formatRuntimeDateTime(browserDate, browserTimeZone)}. This is based on the dashboard/browser runtime time.`,
        "",
        "Sources:",
        "- Dashboard/browser runtime time",
      ].join("\n");
    }
  }

  return [
    "Answer:",
    `The current server time is ${formatRuntimeDateTime(now, "UTC")}. Your local timezone was not available to the dashboard AI.`,
    "",
    "Sources:",
    "- Server runtime time",
  ].join("\n");
}

export function classifyAiQuery(message: string): AiQueryClass {
  const question = extractUserQuestion(message);
  if (isRuntimeTimeQuestion(question)) return "runtime_time_date";

  const needsLiveWeb =
    CURRENT_WEB_TERMS.test(question) && !CURRENT_PPP_ONLY_PATTERN.test(question);
  const isDashboardQuestion =
    EXPLICIT_DASHBOARD_ANCHOR_TERMS.test(question) ||
    (/\b(analy[sz]e|trend|trends|risk|high-risk|kpi|kpis|schedule|delay|delays|critical path|resource conflict|compliance|overdue|work order|task count|document count|coverage|underperform|ownership|responsible|corrective action|recommendation|milestone)\b/i.test(
      question
    ) &&
      MODULE_DATA_TERMS.test(question));
  const explicitlyCombinesDashboardAndWeb =
    isDashboardQuestion && (needsLiveWeb || COMBINED_COMPARE_TERMS.test(question));

  if (explicitlyCombinesDashboardAndWeb) return "combined_dashboard_web";
  if (needsLiveWeb) return "current_web";
  if (isDashboardQuestion) return "dashboard_data";
  return "general_knowledge";
}

export function queryNeedsWebSearch(queryClass: AiQueryClass): boolean {
  return queryClass === "current_web" || queryClass === "combined_dashboard_web";
}

function formatSourcesSection(response: WebSearchResponse): string {
  const lines = ["Sources:"];

  for (const result of response.results.slice(0, 4)) {
    lines.push(
      `- ${result.title || "Untitled"} — ${result.domain || "Unknown domain"}`
    );
    // Keep source URLs out of assistant replies; the UI should not read raw URLs.
  }

  return lines.join("\n");
}

function removeKnowledgeCutoffLines(reply: string): string {
  return reply
    .split("\n")
    .filter(line => !/knowledge\s+cutoff/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isSourceMetadataLine(
  line: string,
  sourceTitles: Set<string> = new Set()
): boolean {
  const normalizedLine = line
    .replace(/^[-*]\s*/, "")
    .trim()
    .toLowerCase();

  return (
    sourceTitles.has(normalizedLine) ||
    /^(?:[-*]\s*)?(?:source\s*)?(?:title|domain|url|snippet|provider|web search result|result\s*\d*)\b/i.test(
      line
    ) ||
    /^(?:[-*]\s*)?https?:\/\//i.test(line) ||
    /^[-*]\s*(?:source\s+)?[^:]{3,120}\s+—\s+[^:]{3,120}$/i.test(line)
  );
}

function isOnlySourceMetadata(
  reply: string,
  searchResponse: WebSearchResponse
): boolean {
  const lines = reply
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;

  const sourceTitles = new Set(
    searchResponse.results
      .map(result => result.title?.trim().toLowerCase() || "")
      .filter(title => title.length > 0)
  );
  const metadataLineCount = lines.filter(line =>
    isSourceMetadataLine(line, sourceTitles)
  ).length;
  return metadataLineCount >= Math.max(2, Math.ceil(lines.length * 0.75));
}

export function finalizeAiReplyForWebSearch(
  reply: string,
  queryClass: AiQueryClass,
  searchResponse?: WebSearchResponse | null
): string {
  if (!searchResponse?.results.length || !queryNeedsWebSearch(queryClass)) {
    return sanitizeFinalAiReply(reply, queryClass);
  }

  const sources = formatSourcesSection(searchResponse);
  let finalReply = removeKnowledgeCutoffLines(reply);

  if (isOnlySourceMetadata(finalReply, searchResponse)) {
    finalReply = `Answer:\nI found a relevant source, but the search result did not include enough detail to answer confidently.\n\n${sources}`;
  }

  if (queryClass === "current_web" && !/^\s*Answer:/i.test(finalReply)) {
    finalReply = `Answer:\n${finalReply}`;
  }

  if (
    queryClass === "combined_dashboard_web" &&
    !/^\s*From dashboard data:/i.test(finalReply)
  ) {
    finalReply = `From dashboard data:\n${finalReply}`;
  }

  if (!/\bSources:/i.test(finalReply)) {
    finalReply = `${finalReply.trim()}\n\n${sources}`;
  }

  return sanitizeFinalAiReply(finalReply, queryClass);
}

export function sanitizeFinalAiReply(
  reply: string,
  queryClass: AiQueryClass
): string {
  let cleaned = reply
    .replace(/^\s*Sources:\s*None\s*$/gim, "")
    .replace(/^\s*[-*]?\s*Sources:\s*None\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (queryClass === "current_web" && cleaned === WEB_SEARCH_FAILURE_REPLY) {
    return WEB_SEARCH_FAILURE_REPLY;
  }

  if (queryClass === "general_knowledge") {
    cleaned = cleaned
      .replace(/^\s*From dashboard data:\s*/i, "")
      .replace(
        /^\s*Module data is not loaded\. Open the relevant dashboard module first so I can analyze its data\.\s*$/gim,
        ""
      )
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return cleaned;
}

function moduleDataMissingForDashboardQuestion(message: string): boolean {
  return /Status:\s*No data loaded|Dataset is empty|Total Records:\s*0\b/i.test(
    message
  );
}

function wantsRepositoryFileTree(message: string): boolean {
  return REPO_TREE_PROMPT.test(message);
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function getDefaultGithubBranch(
  owner: string,
  repo: string
): Promise<string> {
  if (process.env.GITHUB_BRANCH) return process.env.GITHUB_BRANCH;

  const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: githubHeaders(),
  });
  if (!response.ok) return "main";

  const data = (await response.json()) as { default_branch?: string };
  return data.default_branch || "main";
}

function formatTreeEntries(
  entries: RepoTreeEntry[],
  rootLabel: string
): string {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const visibleEntries = sorted.slice(0, MAX_TREE_ITEMS);
  const lines = [`${rootLabel}/`];

  for (const entry of visibleEntries) {
    const depth = entry.path.split("/").length;
    const indent = "  ".repeat(depth);
    const marker = entry.type === "tree" ? "/" : "";
    lines.push(`${indent}${path.posix.basename(entry.path)}${marker}`);
  }

  if (sorted.length > visibleEntries.length) {
    lines.push(
      `  ... ${sorted.length - visibleEntries.length} more entries not shown`
    );
  }

  return lines.join("\n");
}

async function getGithubRepositoryTree(): Promise<string | null> {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  if (!owner || !repo) return null;

  const branch = await getDefaultGithubBranch(owner, repo);
  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { headers: githubHeaders() }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `GitHub tree request failed (${response.status}): ${errorText || response.statusText}`
    );
  }

  const data = (await response.json()) as {
    tree?: RepoTreeEntry[];
    truncated?: boolean;
  };
  const entries = (data.tree || []).filter(entry => {
    const firstSegment = entry.path.split("/")[0];
    return !IGNORED_TREE_ENTRIES.has(firstSegment);
  });
  const tree = formatTreeEntries(entries, `${owner}/${repo}`);
  return data.truncated
    ? `${tree}\n\nNote: GitHub marked this recursive tree as truncated, so the listing may be incomplete.`
    : tree;
}

async function walkLocalRepositoryTree(
  dir: string,
  relativeDir = "",
  depth = 0,
  entries: RepoTreeEntry[] = []
): Promise<RepoTreeEntry[]> {
  if (entries.length >= MAX_TREE_ITEMS || depth > MAX_LOCAL_DEPTH)
    return entries;

  const dirents = await fs.readdir(dir, { withFileTypes: true });
  for (const dirent of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entries.length >= MAX_TREE_ITEMS) break;
    if (IGNORED_TREE_ENTRIES.has(dirent.name)) continue;

    const relativePath = relativeDir
      ? `${relativeDir}/${dirent.name}`
      : dirent.name;
    if (dirent.isDirectory()) {
      entries.push({ path: relativePath, type: "tree" });
      await walkLocalRepositoryTree(
        path.join(dir, dirent.name),
        relativePath,
        depth + 1,
        entries
      );
    } else if (dirent.isFile()) {
      entries.push({ path: relativePath, type: "blob" });
    }
  }

  return entries;
}

async function getLocalRepositoryTree(): Promise<string> {
  const cwd = process.cwd();
  const rootLabel = path.basename(cwd) || "repository";
  const entries = await walkLocalRepositoryTree(cwd);
  return formatTreeEntries(entries, rootLabel);
}

async function buildRepositoryTreeReply(): Promise<string> {
  try {
    const githubTree = await getGithubRepositoryTree();
    if (githubTree) {
      return [
        "Here is the repository file tree from GitHub:",
        "",
        "```text",
        githubTree,
        "```",
      ].join("\n");
    }
  } catch (error) {
    console.error("Repository tree GitHub lookup failed:", error);
  }

  const localTree = await getLocalRepositoryTree();
  return [
    "Here is the repository file tree from the local app workspace:",
    "",
    "```text",
    localTree,
    "```",
  ].join("\n");
}

export const aiRouter = createRouter({
  /* ── Passive status: configuration only, no network calls ── */
  status: publicQuery.query(() => {
    const config = getOllamaConfig();
    return {
      configured: config.configured,
      provider: config.provider,
      model: config.model,
      webSearchProvider: getWebSearchProvider(),
      webSearchConfigured: isWebSearchConfigured(),
      message: config.configured
        ? "AI provider is configured."
        : "AI provider is not configured. Set OLLAMA_BASE_URL to enable conversational AI.",
    };
  }),

  /* ── Active health check: bounded timeout, no full inference ── */
  health: publicQuery.query(async () => {
    const result = await checkOllamaHealth();
    return {
      configured: result.configured,
      reachable: result.reachable,
      authenticated: result.authenticated,
      modelAvailable: result.modelAvailable,
      model: result.model,
      message: result.message,
    };
  }),

  /* ── Maintenance Expert Chat (via Ollama OpenAI-compatible API) ── */
  maintenanceChat: publicQuery
    .input(
      z.object({
        message: z.string().min(1).max(4000),
        history: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string(),
            })
          )
          .max(20)
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      if (wantsRepositoryFileTree(input.message)) {
        return {
          reply: await buildRepositoryTreeReply(),
          error: null,
        };
      }

      if (isRuntimeTimeQuestion(input.message)) {
        return {
          reply: buildRuntimeTimeReply(input.message),
          error: null,
        };
      }

      const queryClass = classifyAiQuery(input.message);
      const userQuestion = extractUserQuestion(input.message);

      if (
        queryClass === "dashboard_data" &&
        moduleDataMissingForDashboardQuestion(input.message)
      ) {
        return {
          reply:
            "Module data is not loaded. Open the relevant dashboard module first so I can analyze its data.",
          error: "MODULE_DATA_NOT_LOADED",
        };
      }
      let webContext = "";
      let successfulSearchResponse: WebSearchResponse | null = null;

      if (queryNeedsWebSearch(queryClass)) {
        if (!isWebSearchConfigured()) {
          if (queryClass === "current_web") {
            return {
              reply: WEB_SEARCH_FAILURE_REPLY,
              error: "WEB_SEARCH_NOT_CONFIGURED",
            };
          }
          webContext = `\n\n=== WEB SEARCH CONTEXT ===\nWEB SEARCH STATUS: Live web search is not configured for this deployment. Add this exact sentence after the dashboard-data answer if live context is requested.`;
        } else {
          try {
            const searchResponse = await webSearch(userQuestion, 4);
            successfulSearchResponse =
              searchResponse.results.length > 0 ? searchResponse : null;

            if (queryClass === "current_web") {
              const reply = successfulSearchResponse
                ? synthesizeWebSearchAnswer(successfulSearchResponse)
                : WEB_SEARCH_FAILURE_REPLY;
              return {
                reply,
                error:
                  reply === WEB_SEARCH_FAILURE_REPLY
                    ? "WEB_SEARCH_NO_USABLE_RESULTS"
                    : null,
              };
            }

            webContext = `\n\n=== WEB SEARCH CONTEXT ===\n${formatWebSearchResultsForPrompt(searchResponse)}`;
          } catch (error) {
            console.error("[WEB SEARCH ERROR]", error);
            if (queryClass === "current_web") {
              return {
                reply: WEB_SEARCH_FAILURE_REPLY,
                error: "WEB_SEARCH_FAILED",
              };
            }

            webContext = `\n\n=== WEB SEARCH CONTEXT ===\nWEB SEARCH STATUS: Search failed. Say exactly "${WEB_SEARCH_FAILURE_REPLY}" where live context is requested.`;
          }
        }
      }

      const config = getOllamaConfig();
      if (!config.baseUrl) {
        return {
          reply:
            "⚠️ AI provider is not configured.\n\nTo activate the AI chat:\n\n1. Set OLLAMA_BASE_URL to your Ollama endpoint (e.g., http://localhost:11434 for local development).\n2. Optionally set OLLAMA_API_KEY if your endpoint requires authentication.\n3. Set OLLAMA_MODEL to the model name, or leave it unset to use the default (kimi-k2.7-code:cloud).\n4. Add these environment variables to your Render environment variables for production.",
          error: "MISSING_BASE_URL",
        };
      }

      const messages = [
        { role: "system" as const, content: SYSTEM_PROMPT },
        ...(input.history || []).map(h => ({
          role: h.role as "user" | "assistant",
          content: h.content,
        })),
        {
          role: "user" as const,
          content: `${input.message}${webContext}\n\n=== AI QUERY CLASSIFICATION ===\n${queryClass}`,
        },
      ];

      try {
        const result = await chatWithOllama({
          messages,
          temperature: 0.2,
        });
        const reply = finalizeAiReplyForWebSearch(
          result.reply,
          queryClass,
          successfulSearchResponse
        );
        return { reply, error: null };
      } catch (e: unknown) {
        const error = e as OllamaClientError;
        console.error("[AI CHAT ERROR]", error.category || "UNKNOWN", error.message);
        const category = error.category || "UNKNOWN_ERROR";
        const userMessage = error.message || "Connection error. Please check your network and try again.";
        return {
          reply: `⚠️ ${userMessage}`,
          error: category,
        };
      }
    }),
});
