import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";

const SYSTEM_PROMPT = `You are a senior maintenance and reliability engineering advisor for water and wastewater facilities inside the ODM Dashboard. Answer from active dashboard data first and module context first. Answer based only on the dashboard data and module context provided. No stale current-world answers: for current facts, rankings, market prices, news, laws, live internet, or other time-sensitive questions, say exactly "Live web lookup is not enabled in this dashboard AI." Then redirect the user back to ODM Dashboard context. If module data is empty or unavailable, say that the module data is not loaded instead of inventing. Do not invent missing data, task counts, KPI values, equipment names, ownership decisions, document counts, file/folder counts, or schedule delays. For Post-PPP Planning, Responsible/currentPppDoer is the current PPP execution doer; Operations, AMD, and ARD are future ownership preference fields; Recommended Future Doer is derived from consensus and this ownership logic must not be changed. Give practical, field-oriented, concise recommendations grounded in the supplied module evidence. Ask clarifying questions only when essential.`;

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
        { role: "user" as const, content: input.message },
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
        const reply = data.choices?.[0]?.message?.content?.trim() || "No response from AI.";
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
