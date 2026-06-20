import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";

const GITHUB_API = "https://api.github.com";

function getHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not configured");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "O&M-Dashboard-Agent",
  };
}

export const githubRouter = createRouter({
  /* ── Check if GitHub is configured ── */
  status: publicQuery.query(async () => {
    const token = process.env.GITHUB_TOKEN;
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    if (!token) return { configured: false, reason: "GITHUB_TOKEN not set" };
    try {
      const resp = await fetch(`${GITHUB_API}/user`, { headers: getHeaders() });
      if (!resp.ok) return { configured: false, reason: "Invalid token" };
      const user = (await resp.json()) as any;
      return { configured: true, login: user.login, owner, repo };
    } catch {
      return { configured: false, reason: "Connection failed" };
    }
  }),

  /* ── List repository contents ── */
  listContents: publicQuery
    .input(z.object({ path: z.string().optional() }))
    .query(async ({ input }) => {
      const owner = process.env.GITHUB_OWNER;
      const repo = process.env.GITHUB_REPO;
      if (!owner || !repo) return { error: "GITHUB_OWNER or GITHUB_REPO not set", items: [] };
      try {
        const resp = await fetch(
          `${GITHUB_API}/repos/${owner}/${repo}/contents/${input.path || ""}`,
          { headers: getHeaders() }
        );
        if (!resp.ok) return { error: `GitHub API ${resp.status}`, items: [] };
        const data = (await resp.json()) as any[];
        return {
          error: null,
          items: data.map((item) => ({
            name: item.name,
            path: item.path,
            type: item.type,
            size: item.size || 0,
            sha: item.sha,
          })),
        };
      } catch (e: any) {
        return { error: e.message, items: [] };
      }
    }),

  /* ── Get file content ── */
  getFile: publicQuery
    .input(z.object({ path: z.string() }))
    .mutation(async ({ input }) => {
      const owner = process.env.GITHUB_OWNER;
      const repo = process.env.GITHUB_REPO;
      if (!owner || !repo) return { error: "GITHUB_OWNER or GITHUB_REPO not set", content: null };
      try {
        const resp = await fetch(
          `${GITHUB_API}/repos/${owner}/${repo}/contents/${input.path}`,
          { headers: getHeaders() }
        );
        if (!resp.ok) return { error: `GitHub API ${resp.status}`, content: null };
        const data = (await resp.json()) as any;
        const content = data.content ? atob(data.content.replace(/\n/g, "")) : null;
        return { error: null, content, sha: data.sha, size: data.size };
      } catch (e: any) {
        return { error: e.message, content: null };
      }
    }),

  /* ── Create or update file ── */
  saveFile: publicQuery
    .input(
      z.object({
        path: z.string(),
        content: z.string(),
        message: z.string(),
        sha: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const owner = process.env.GITHUB_OWNER;
      const repo = process.env.GITHUB_REPO;
      if (!owner || !repo) return { error: "GITHUB_OWNER or GITHUB_REPO not set", success: false };
      try {
        const body: any = {
          message: input.message,
          content: btoa(unescape(encodeURIComponent(input.content))),
        };
        if (input.sha) body.sha = input.sha;

        const resp = await fetch(
          `${GITHUB_API}/repos/${owner}/${repo}/contents/${input.path}`,
          {
            method: "PUT",
            headers: getHeaders(),
            body: JSON.stringify(body),
          }
        );
        if (!resp.ok) return { error: `GitHub API ${resp.status}`, success: false };
        return { error: null, success: true };
      } catch (e: any) {
        return { error: e.message, success: false };
      }
    }),

  /* ── List commits ── */
  listCommits: publicQuery
    .input(z.object({ path: z.string().optional() }))
    .query(async ({ input }) => {
      const owner = process.env.GITHUB_OWNER;
      const repo = process.env.GITHUB_REPO;
      if (!owner || !repo) return { error: "Not configured", commits: [] };
      try {
        const url = input.path
          ? `${GITHUB_API}/repos/${owner}/${repo}/commits?path=${input.path}&per_page=10`
          : `${GITHUB_API}/repos/${owner}/${repo}/commits?per_page=10`;
        const resp = await fetch(url, { headers: getHeaders() });
        if (!resp.ok) return { error: `GitHub API ${resp.status}`, commits: [] };
        const data = (await resp.json()) as any[];
        return {
          error: null,
          commits: data.map((c) => ({
            sha: c.sha?.slice(0, 7),
            message: c.commit?.message?.split("\n")[0],
            author: c.commit?.author?.name,
            date: c.commit?.author?.date,
          })),
        };
      } catch (e: any) {
        return { error: e.message, commits: [] };
      }
    }),
});
