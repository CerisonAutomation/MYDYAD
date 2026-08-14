/**
 * Local Web Search - Multi-provider parallel search with deduplication
 * Replaces Dyad Engine web search with free, no-API-key alternatives
 *
 * Providers:
 * - DuckDuckGo HTML scraping (primary)
 * - SearXNG public instances (fallback)
 * - Built-in fetch (zero dependencies)
 */

import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("local_web_search");

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  provider: string;
  score: number; // Relevance score 0-1
}

// SearXNG public instances (free, no auth required)
const SEARXNG_INSTANCES = [
  "https://search.bus-hit.me",
  "https://searx.be",
  "https://searxng.ch",
  "https://search.sapti.me",
];

/**
 * Multi-provider parallel web search with deduplication
 * @param query - The search query
 * @param maxResults - Maximum number of results to return (default: 8)
 * @returns Deduplicated and ranked search results
 */
export async function localWebSearch(
  query: string,
  maxResults: number = 8,
): Promise<SearchResult[]> {
  const startTime = Date.now();

  // Launch parallel searches across providers
  const searchPromises = [
    searchDuckDuckGoHtml(query, maxResults),
    ...SEARXNG_INSTANCES.map((instance) =>
      searchSearXNG(instance, query, maxResults),
    ),
  ];

  // Use Promise.allSettled for fault-tolerant parallel execution
  const results = await Promise.allSettled(searchPromises);

  // Collect all successful results
  const allResults: SearchResult[] = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.length > 0) {
      allResults.push(...result.value);
    }
  }

  if (allResults.length === 0) {
    throw new DyadError(
      "Web search returned no results from any provider",
      DyadErrorKind.External,
    );
  }

  // Deduplicate by URL
  const deduplicated = deduplicateResults(allResults);

  // Sort by relevance score
  const sorted = deduplicated.sort((a, b) => b.score - a.score);

  const elapsed = Date.now() - startTime;
  logger.log(
    `Web search completed: ${sorted.length} results from ${allResults.length} total in ${elapsed}ms`,
  );

  return sorted.slice(0, maxResults);
}

/**
 * Search DuckDuckGo via HTML endpoint (no API key required)
 */
async function searchDuckDuckGoHtml(
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
  try {
    const encodedQuery = encodeURIComponent(query);
    const response = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodedQuery}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      },
    );

    if (!response.ok) {
      logger.warn(`DuckDuckGo returned ${response.status}`);
      return [];
    }

    const html = await response.text();
    return parseDuckDuckGoHtml(html, maxResults);
  } catch (error) {
    logger.error("DuckDuckGo search failed:", error);
    return [];
  }
}

/**
 * Parse DuckDuckGo HTML results
 */
function parseDuckDuckGoHtml(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Extract results using regex (no cheerio dependency)
  const resultRegex =
    /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/g;

  let match;
  while (
    (match = resultRegex.exec(html)) !== null &&
    results.length < maxResults
  ) {
    let url = match[1];
    const title = match[2].replace(/<[^>]*>/g, "").trim();
    const snippet = match[3].replace(/<[^>]*>/g, "").trim();

    // Decode DuckDuckGo redirect URLs
    if (url.includes("uddg=")) {
      const urlMatch = url.match(/uddg=([^&]+)/);
      if (urlMatch) {
        url = decodeURIComponent(urlMatch[1]);
      }
    }

    if (url && title && !url.startsWith("/")) {
      results.push({
        title,
        url,
        snippet: snippet || "",
        provider: "duckduckgo",
        score: calculateRelevanceScore(title, snippet, ""),
      });
    }
  }

  return results;
}

/**
 * Search SearXNG public instance
 */
async function searchSearXNG(
  instance: string,
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
  try {
    const encodedQuery = encodeURIComponent(query);
    const response = await fetch(
      `${instance}/search?q=${encodedQuery}&format=json&categories=general`,
      {
        headers: {
          "User-Agent": "Dyad/1.0 (Local AI App Builder)",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8000), // 8 second timeout
      },
    );

    if (!response.ok) {
      logger.warn(`SearXNG ${instance} returned ${response.status}`);
      return [];
    }

    const data = await response.json();
    return parseSearXNGResults(data, instance, maxResults);
  } catch (error) {
    logger.error(`SearXNG ${instance} search failed:`, error);
    return [];
  }
}

/**
 * Parse SearXNG JSON results
 */
function parseSearXNGResults(
  data: any,
  instance: string,
  maxResults: number,
): SearchResult[] {
  const results: SearchResult[] = [];

  if (!data.results || !Array.isArray(data.results)) {
    return results;
  }

  for (const item of data.results.slice(0, maxResults)) {
    if (item.url && item.title) {
      results.push({
        title: item.title,
        url: item.url,
        snippet: item.content || "",
        provider: `searxng:${new URL(instance).hostname}`,
        score: calculateRelevanceScore(item.title, item.content || "", ""),
      });
    }
  }

  return results;
}

/**
 * Deduplicate results by URL, keeping the highest-scored version
 */
function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Map<string, SearchResult>();

  for (const result of results) {
    const normalizedUrl = normalizeUrl(result.url);
    const existing = seen.get(normalizedUrl);

    if (!existing || result.score > existing.score) {
      seen.set(normalizedUrl, result);
    }
  }

  return Array.from(seen.values());
}

/**
 * Normalize URL for deduplication
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove trailing slash, normalize protocol
    return `${parsed.hostname}${parsed.pathname}`
      .toLowerCase()
      .replace(/\/$/, "");
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Calculate relevance score based on title and snippet matching
 */
function calculateRelevanceScore(
  title: string,
  snippet: string,
  _query: string,
): number {
  let score = 0.5; // Base score

  // Title length bonus (shorter is often more relevant)
  if (title.length < 60) score += 0.1;
  if (title.length < 40) score += 0.1;

  // Snippet length bonus
  if (snippet.length > 50) score += 0.1;
  if (snippet.length > 100) score += 0.1;

  // Penalty for very short content
  if (title.length < 10) score -= 0.2;
  if (snippet.length < 20) score -= 0.1;

  return Math.max(0, Math.min(1, score));
}

/**
 * Format search results for display
 */
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No search results found.";
  }

  return results
    .map(
      (r, i) =>
        `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}\n   [via ${r.provider}]`,
    )
    .join("\n\n");
}
