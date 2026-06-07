export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  domain: string;
}

export interface WebSearchResponse {
  provider: string;
  results: WebSearchResult[];
}

const MAX_QUERY_LENGTH = 500;
const DEFAULT_RESULT_LIMIT = 4;
const SUPPORTED_PROVIDERS = new Set(["tavily", "serper", "brave"]);

function cleanText(value: unknown, maxLength = 450): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function getWebSearchProvider(): string {
  const configuredProvider = (process.env.WEB_SEARCH_PROVIDER || "tavily").trim().toLowerCase();
  return SUPPORTED_PROVIDERS.has(configuredProvider) ? configuredProvider : "tavily";
}

export function getWebSearchApiKey(provider = getWebSearchProvider()): string | undefined {
  const genericKey = process.env.WEB_SEARCH_API_KEY?.trim();
  if (genericKey) return genericKey;

  if (provider === "serper") return process.env.SERPER_API_KEY?.trim();
  if (provider === "brave") return process.env.BRAVE_SEARCH_API_KEY?.trim();
  return process.env.TAVILY_API_KEY?.trim();
}

export function isWebSearchConfigured(): boolean {
  return Boolean(getWebSearchApiKey());
}

export function formatWebSearchResultsForPrompt(response: WebSearchResponse): string {
  if (response.results.length === 0) {
    return "WEB SEARCH STATUS: No results were returned. If live context is needed, say \"I could not retrieve live web results right now.\"";
  }

  const lines = [
    `WEB SEARCH STATUS: ${response.results.length} result(s) from ${response.provider}. Live web search succeeded.`,
    "SYNTHESIS REQUIREMENTS:",
    "- Use the result content below to answer the user's question directly before listing sources.",
    "- Do not merely list raw source metadata such as title, domain, URL, provider, or snippet.",
    "- Do not mention knowledge cutoff because live search results are available.",
    "- For a general/current web question, format the final response as: Answer: then Sources:.",
    "- For a dashboard + web question, format the final response as: From dashboard data: then From web search: then Sources:.",
    "- If these results do not contain enough detail to answer confidently, say: I found a relevant source, but the search result did not include enough detail to answer confidently.",
    "SEARCH RESULT CONTENT TO SYNTHESIZE:",
  ];

  response.results.forEach((result, index) => {
    lines.push(
      [
        `Result ${index + 1}:`,
        `Source title: ${result.title || "Untitled"}`,
        `Source domain: ${result.domain || "Unknown domain"}`,
        `Source URL: ${result.url || "No URL"}`,
        `Relevant content: ${result.snippet || "No result detail was provided."}`,
      ].join("\n")
    );
  });

  return lines.join("\n");
}


function normalizeResult(raw: any): WebSearchResult | null {
  const url = cleanText(raw?.url || raw?.link, 700);
  if (!url) return null;

  return {
    title: cleanText(raw?.title || raw?.name || url, 160),
    url,
    snippet: cleanText(raw?.content || raw?.snippet || raw?.description || raw?.text, 500),
    domain: getDomain(url),
  };
}

async function tavilySearch(query: string, apiKey: string, limit: number): Promise<WebSearchResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: limit,
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
    }),
  });

  if (!response.ok) throw new Error(`Tavily search failed with HTTP ${response.status}`);
  const data = (await response.json()) as { results?: any[] };
  return (data.results || []).map(normalizeResult).filter(Boolean) as WebSearchResult[];
}

async function serperSearch(query: string, apiKey: string, limit: number): Promise<WebSearchResult[]> {
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({ q: query, num: limit }),
  });

  if (!response.ok) throw new Error(`Serper search failed with HTTP ${response.status}`);
  const data = (await response.json()) as { organic?: any[] };
  return (data.organic || []).slice(0, limit).map(normalizeResult).filter(Boolean) as WebSearchResult[];
}

async function braveSearch(query: string, apiKey: string, limit: number): Promise<WebSearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(limit));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!response.ok) throw new Error(`Brave search failed with HTTP ${response.status}`);
  const data = (await response.json()) as { web?: { results?: any[] } };
  return (data.web?.results || []).slice(0, limit).map(normalizeResult).filter(Boolean) as WebSearchResult[];
}

export async function webSearch(query: string, limit = DEFAULT_RESULT_LIMIT): Promise<WebSearchResponse> {
  const provider = getWebSearchProvider();
  const apiKey = getWebSearchApiKey(provider);
  if (!apiKey) throw new Error("Live web search is not configured for this deployment.");

  const safeQuery = cleanText(query, MAX_QUERY_LENGTH);
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || DEFAULT_RESULT_LIMIT, 1), 5);

  let results: WebSearchResult[];
  if (provider === "serper") {
    results = await serperSearch(safeQuery, apiKey, safeLimit);
  } else if (provider === "brave") {
    results = await braveSearch(safeQuery, apiKey, safeLimit);
  } else {
    results = await tavilySearch(safeQuery, apiKey, safeLimit);
  }

  return { provider, results: results.slice(0, safeLimit) };
}
