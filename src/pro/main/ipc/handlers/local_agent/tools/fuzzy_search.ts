/**
 * fuzzy_search — Shared Fuse.js wrapper for fuzzy matching across all tools.
 *
 * Usage:
 *   const results = fuzzySearch(items, "react hook", { keys: ["name", "content"] });
 *   const results = fuzzySearch(files, "*.tsx", { keys: ["path"] });
 */
import Fuse from "fuse.js";

export interface FuzzySearchOptions<T> {
  keys: (keyof T & string)[];
  threshold?: number; // 0.0 = exact, 0.4 = default, 1.0 = match everything
  includeScore?: boolean;
  limit?: number;
}

export interface FuzzyResult<T> {
  item: T;
  score: number; // 0 = perfect match, 1 = worst
}

/**
 * Perform fuzzy search on an array of items.
 * Returns results sorted by relevance (best match first).
 */
export function fuzzySearch<T>(
  items: T[],
  query: string,
  options: FuzzySearchOptions<T>,
): FuzzyResult<T>[] {
  if (!query || !query.trim()) {
    return items.map((item) => ({ item, score: 0 }));
  }

  const fuse = new Fuse(items, {
    keys: options.keys as string[],
    threshold: options.threshold ?? 0.4,
    includeScore: true,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });

  const results = fuse.search(query, { limit: options.limit ?? 50 });

  return results.map((r) => ({
    item: r.item,
    score: r.score ?? 0,
  }));
}

/**
 * Quick fuzzy filter — returns items that match the query, no scoring.
 */
export function fuzzyFilter<T>(
  items: T[],
  query: string,
  keys: (keyof T & string)[],
): T[] {
  if (!query || !query.trim()) return items;

  const fuse = new Fuse(items, {
    keys: keys as string[],
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });

  return fuse.search(query).map((r) => r.item);
}

/**
 * Fuzzy match a single string against a query.
 * Returns a score (0 = perfect, 1 = worst).
 */
export function fuzzyScore(text: string, query: string): number {
  if (!query) return 0;

  const fuse = new Fuse([text], {
    keys: ["value"],
    threshold: 1.0,
    includeScore: true,
    ignoreLocation: true,
  });

  const results = fuse.search(query);
  return results.length > 0 ? (results[0].score ?? 1) : 1;
}
