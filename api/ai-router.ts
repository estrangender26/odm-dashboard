import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import {
  formatWebSearchResultsForPrompt,
  getWebSearchProvider,
  isWebSearchConfigured,
  webSearch,
  type WebSearchResponse,
} from "./web-search";

const SYSTEM_PROMPT = `You are a senior maintenance and reliability engineering advisor for water and wastewater facilities inside the ODM Dashboard. Classify each request as a module-data question, general knowledge question, web/current question, or combined module + web question. Answer from active dashboard data first and module context first for module-specific questions. General knowledge questions may be answered normally from model knowledge. Use provided WEB SEARCH CONTEXT only for current, live, recent, or external information, and synthesize the result content into a natural answer like ChatGPT instead of listing raw search metadata. For general/current web questions, use exactly this structure: "Answer:" followed by a direct answer in 1-3 concise paragraphs, then "Sources:" with source title/domain and URL. For combined module + web questions, use exactly this structure: "From dashboard data:" for module facts, "From web search:" for external context if search was used, then "Sources:" with source title/domain and URL. Do not return only titles, domains, URLs, snippets, search provider names, or other raw source metadata as the final answer. Do not mention a knowledge cutoff when live web search results are provided. If a relevant web source is found but the search result content does not include enough detail to answer confidently, say exactly "I found a relevant source, but the search result did not include enough detail to answer confidently." before listing sources. If search failed, say "I could not retrieve live web results right now." If web search is not configured, say "Live web search is not configured for this deployment." If module data is empty or unavailable for a module-specific question, say exactly "Module data is not loaded. Open the relevant dashboard module first so I can analyze its data." Do not invent missing module values, task counts, KPI values, equipment names, ownership decisions, SMP coverage, document counts, file/folder counts, records, or schedule status. Dashboard/module data is the source of truth for task counts, KPI values, equipment names, document counts, schedule delays, ownership decisions, and Post-PPP recommendations, and web search must not override it. For Post-PPP Planning, Responsible/currentPppDoer is the current PPP execution doer; Operations, AMD, and ARD are future ownership preference fields; Recommended Future Doer is derived from consensus and this ownership logic must not be changed. Give practical, field-oriented, concise recommendations grounded in the supplied module evidence. Ask clarifying questions only when essential.`;

const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";

const GITHUB_API = "https://api.github.com";
const REPO_TREE_PROMPT = /\b(list|show|display|print)\b[\s\S]*\b(all\s+)?files?\b[\s\S]*\b(repo|repository|file\s*tree|tree)\b/i;
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

const MODULE_CONTEXT_PATTERN = /=== DASHBOARD CONTEXT ===|Dashboard Type:|=== REQUIRED ANSWERING RULES ===/i;
const MODULE_DATA_TERMS = /\b(active module|dashboard data|module data|this dashboard|these records|this module|work orders?|tasks?|task count|kpis?|equipment|smp|manuals?|documents?|folders?|files?|schedule|critical path|milestones?|governance|inspection|post-ppp|ppp|currentpppdoer|responsible|ownership|coverage|uploads?|records?)\b/i;
const CURRENT_WEB_TERMS = /\b(current|currently|live|latest|today|tonight|tomorrow|yesterday|this week|this month|this year|now|right now|recent|newest|breaking|news|price|prices|market|stock|ranking|rankings|weather|forecast|time|exchange rate|inflation|interest rate|law|laws|regulation|regulations|standard|standards|version|release|model info|product info|availability|richest|wealthiest|billionaires?)\b/i;
const CURRENT_PPP_ONLY_PATTERN = /\bcurrent\s+ppp|currentpppdoer|current\s+doer|current\s+execution\s+doer\b/i;

export type AiQueryClass = "module-data" | "general-knowledge" | "web-current" | "combined-module-web";

export function extractUserQuestion(message: string): string {
  const match = USER_QUESTION_PATTERN.exec(message);
  return (match?.[1] || message).trim();
}

export function classifyAiQuery(message: string): AiQueryClass {
  const question = extractUserQuestion(message);
  const hasDashboardContext = MODULE_CONTEXT_PATTERN.test(message);
  const isModuleQuestion = MODULE_DATA_TERMS.test(question) || (hasDashboardContext && MODULE_DATA_TERMS.test(message));
  const needsLiveWeb = CURRENT_WEB_TERMS.test(question) && !CURRENT_PPP_ONLY_PATTERN.test(question);

  if (isModuleQuestion && needsLiveWeb) return "combined-module-web";
  if (needsLiveWeb) return "web-current";
  if (isModuleQuestion) return "module-data";
  return "general-knowledge";
}

function queryNeedsWebSearch(queryClass: AiQueryClass): boolean {
  return queryClass === "web-current" || queryClass === "combined-module-web";
}

function formatSourcesSection(response: WebSearchResponse): string {
  const lines = ["Sources:"];
  for (const result of response.results) {
    lines.push(`- ${result.title || "Untitled"} — ${result.domain || "Unknown domain"}`);
    if (result.url) lines.push(`  ${result.url}`);
  }
  return lines.join("\n");
}

function removeKnowledgeCutoffLines(reply: string): string {
  return reply
    .split("\n")
    .filter((line) => !/knowledge\s+cutoff/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isOnlySourceMetadata(reply: string): boolean {
  const lines = reply.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  const metadataLineCount = lines.filter((line) =>
    /^(?:[-*]\s*)?(?:source\s*)?(?:title|domain|url|snippet|provider|web search result|result\s*\d*)\b/i.test(line) ||
    /^[-*]\s*[^:]{3,120}$/i.test(line) ||
    /^[-*]\s*https?:\/\//i.test(line) ||
    /^https?:\/\//i.test(line)
  ).length;
  return metadataLineCount >= Math.max(2, Math.ceil(lines.length * 0.75));
}

export function finalizeAiReplyForWebSearch(
  reply: string,
  queryClass: AiQueryClass,
  searchResponse?: WebSearchResponse | null
): string {
  if (!searchResponse?.results.length || !queryNeedsWebSearch(queryClass)) return reply;

  const sources = formatSourcesSection(searchResponse);
  let finalReply = removeKnowledgeCutoffLines(reply);

  if (isOnlySourceMetadata(finalReply)) {
    finalReply = `Answer:\nI found a relevant source, but the search result did not include enough detail to answer confidently.\n\n${sources}`;
  }

  if (queryClass === "web-current" && !/^\s*Answer:/i.test(finalReply)) {
    finalReply = `Answer:\n${finalReply}`;
  }

  if (queryClass === "combined-module-web" && !/^\s*From dashboard data:/i.test(finalReply)) {
    finalReply = `From dashboard data:\n${finalReply}`;
  }

  if (!/\bSources:/i.test(finalReply)) {
    finalReply = `${finalReply.trim()}\n\n${sources}`;
  }

  return finalReply.trim();
}

interface GroqChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
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

async function getDefaultGithubBranch(owner: string, repo: string): Promise<string> {
  if (process.env.GITHUB_BRANCH) return process.env.GITHUB_BRANCH;

  const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: githubHeaders(),
  });
  if (!response.ok) return "main";

  const data = (await response.json()) as { default_branch?: string };
  return data.default_branch || "main";
}

function formatTreeEntries(entries: RepoTreeEntry[], rootLabel: string): string {
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
    lines.push(`  ... ${sorted.length - visibleEntries.length} more entries not shown`);
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
    throw new Error(`GitHub tree request failed (${response.status}): ${errorText || response.statusText}`);
  }

  const data = (await response.json()) as { tree?: RepoTreeEntry[]; truncated?: boolean };
  const entries = (data.tree || []).filter((entry) => {
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
  if (entries.length >= MAX_TREE_ITEMS || depth > MAX_LOCAL_DEPTH) return entries;

  const dirents = await fs.readdir(dir, { withFileTypes: true });
  for (const dirent of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entries.length >= MAX_TREE_ITEMS) break;
    if (IGNORED_TREE_ENTRIES.has(dirent.name)) continue;

    const relativePath = relativeDir ? `${relativeDir}/${dirent.name}` : dirent.name;
    if (dirent.isDirectory()) {
      entries.push({ path: relativePath, type: "tree" });
      await walkLocalRepositoryTree(path.join(dir, dirent.name), relativePath, depth + 1, entries);
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
      return ["Here is the repository file tree from GitHub:", "", "```text", githubTree, "```"].join("\n");
    }
  } catch (error) {
    console.error("Repository tree GitHub lookup failed:", error);
  }

  const localTree = await getLocalRepositoryTree();
  return ["Here is the repository file tree from the local app workspace:", "", "```text", localTree, "```"].join("\n");
}

export const aiRouter = createRouter({
  /* ── Debug: check AI configuration status ── */
  status: publicQuery.query(() => {
    const key = process.env.GROQ_API_KEY;
    const keySet = !!key;
    const allKeys = Object.keys(process.env).filter(k => !k.includes("SECRET") && !k.includes("PASS") && !k.includes("TOKEN")).sort();
    console.log("[AI DEBUG] GROQ_API_KEY present:", keySet, "| Key starts with:", key ? key.slice(0, 8) : "undefined");
    console.log("[AI DEBUG] Available env vars:", allKeys.join(", "));
    return {
      configured: keySet,
      provider: "groq",
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      webSearchProvider: getWebSearchProvider(),
      webSearchConfigured: isWebSearchConfigured(),
      envVarList: allKeys,
      message: keySet
        ? "AI is configured and ready"
        : `GROQ_API_KEY not set. Available env vars: ${allKeys.join(", ")}`,
    };
  }),

  /* ── Maintenance Expert Chat (via Groq — free, no CC) ── */
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

      const queryClass = classifyAiQuery(input.message);
      const userQuestion = extractUserQuestion(input.message);
      let webContext = "";
      let successfulSearchResponse: WebSearchResponse | null = null;

      if (queryNeedsWebSearch(queryClass)) {
        if (!isWebSearchConfigured()) {
          if (queryClass === "web-current") {
            return {
              reply: "Live web search is not configured for this deployment.",
              error: "WEB_SEARCH_NOT_CONFIGURED",
            };
          }
          webContext = `\n\n=== WEB SEARCH CONTEXT ===\nWEB SEARCH STATUS: Live web search is not configured for this deployment. Add this exact sentence after the dashboard-data answer if live context is requested.`;
        } else {
          try {
            const searchResponse = await webSearch(userQuestion, 4);
            successfulSearchResponse = searchResponse.results.length > 0 ? searchResponse : null;
            webContext = `\n\n=== WEB SEARCH CONTEXT ===\n${formatWebSearchResultsForPrompt(searchResponse)}`;
          } catch (error) {
            console.error("[WEB SEARCH ERROR]", error);
            webContext = `\n\n=== WEB SEARCH CONTEXT ===\nWEB SEARCH STATUS: Search failed. Say exactly "I could not retrieve live web results right now." where live context is requested.`;
          }
        }
      }

      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        return {
          reply: "⚠️ GROQ_API_KEY not set.\n\nTo activate the AI chat:\n\n1. Go to https://console.groq.com\n2. Sign up with your email\n3. Create a free API key\n4. Add GROQ_API_KEY to your Render environment variables\n\nGroq is completely free — no credit card required.",
          error: "MISSING_API_KEY",
        };
      }

      const messages = [
        { role: "system" as const, content: SYSTEM_PROMPT },
        ...(input.history || []).map((h) => ({
          role: h.role as "user" | "assistant",
          content: h.content,
        })),
        {
          role: "user" as const,
          content: `${input.message}${webContext}\n\n=== AI QUERY CLASSIFICATION ===\n${queryClass}`,
        },
      ];

      try {
        const resp = await fetch(GROQ_API, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
            messages,
            temperature: 0.2,
            max_tokens: 1500,
          }),
        });

        if (!resp.ok) {
          const err = await resp.text();
          console.error("[GROQ ERROR] Status:", resp.status, "Body:", err);
          return {
            reply: `AI service error (HTTP ${resp.status}). The API key may be invalid or revoked. Please generate a new key at https://console.groq.com`,
            error: "API_ERROR",
          };
        }

        const data = (await resp.json()) as GroqChatCompletionResponse;
        const rawReply = data.choices?.[0]?.message?.content?.trim() || "No response from AI.";
        const reply = finalizeAiReplyForWebSearch(rawReply, queryClass, successfulSearchResponse);
        return { reply, error: null };
      } catch (e: unknown) {
        console.error("AI chat error:", e);
        return {
          reply: "Connection error. Please check your network and try again.",
          error: "NETWORK_ERROR",
        };
      }
    }),
});
