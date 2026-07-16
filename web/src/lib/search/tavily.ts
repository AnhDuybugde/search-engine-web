import { normalizeUrl } from "@/lib/utils";
import type { SearchHit } from "./types";

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string | null;
  score?: number;
};

type TavilyResponse = {
  results?: TavilyResult[];
  error?: string;
};

export async function searchTavily(
  query: string,
  apiKey: string,
  limit = 8,
): Promise<SearchHit[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: limit,
      include_raw_content: true,
      search_depth: "basic",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tavily error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as TavilyResponse;
  if (data.error) throw new Error(data.error);

  const hits: SearchHit[] = [];
  const seen = new Set<string>();

  for (const r of data.results || []) {
    if (!r.url) continue;
    const url = normalizeUrl(r.url);
    if (seen.has(url)) continue;
    seen.add(url);
    hits.push({
      title: r.title || url,
      url,
      snippet: r.content || "",
      content: r.raw_content || r.content || "",
      score: r.score,
    });
  }

  return hits;
}

/** Lightweight Brave Search fallback (web endpoint). */
export async function searchBrave(
  query: string,
  apiKey: string,
  limit = 8,
): Promise<SearchHit[]> {
  const params = new URLSearchParams({
    q: query,
    count: String(limit),
  });
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?${params}`,
    {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Brave error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };

  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const r of data.web?.results || []) {
    if (!r.url) continue;
    const url = normalizeUrl(r.url);
    if (seen.has(url)) continue;
    seen.add(url);
    hits.push({
      title: r.title || url,
      url,
      snippet: r.description || "",
      content: r.description || "",
    });
  }
  return hits;
}

export async function searchWeb(
  query: string,
  opts: { tavilyKey?: string; braveKey?: string; limit?: number },
): Promise<SearchHit[]> {
  const limit = opts.limit ?? 8;
  if (opts.tavilyKey) return searchTavily(query, opts.tavilyKey, limit);
  if (opts.braveKey) return searchBrave(query, opts.braveKey, limit);
  throw new Error(
    "No search provider configured. Set TAVILY_API_KEY or BRAVE_API_KEY.",
  );
}

/** Optional full-page text via Jina Reader when snippets are thin. */
export async function fetchViaJina(url: string, timeoutMs = 8000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/plain" },
      signal: controller.signal,
    });
    if (!res.ok) return "";
    const text = await res.text();
    return text.slice(0, 50_000);
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}
