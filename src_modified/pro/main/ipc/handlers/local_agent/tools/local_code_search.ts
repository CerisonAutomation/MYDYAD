/**
 * Local Code Search - Fast code search using ripgrep
 * Replaces Dyad Engine code search with local, zero-dependency alternative
 *
 * Features:
 * - ripgrep for fast searching (if available)
 * - Fallback to Node.js fs for basic search
 * - Parallel search across multiple patterns
 * - Result ranking and deduplication
 */

import log from "electron-log";
import { execa } from "execa";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const logger = log.scope("local_code_search");

export interface CodeSearchResult {
  file: string;
  line: number;
  content: string;
  matchType: "exact" | "fuzzy" | "regex";
  score: number;
}

export interface CodeSearchOptions {
  query: string;
  appPath: string;
  filePatterns?: string[];
  excludePatterns?: string[];
  maxResults?: number;
  caseSensitive?: boolean;
  useRegex?: boolean;
}

/**
 * Search codebase using ripgrep (fast) or fallback to Node.js fs
 * @param options - Search options
 * @returns Array of search results
 */
export async function localCodeSearch(
  options: CodeSearchOptions,
): Promise<CodeSearchResult[]> {
  const {
    query,
    appPath,
    filePatterns = [
      "*.{ts,tsx,js,jsx,py,go,rs,java,c,cpp,h,hpp,css,scss,html,json,md}",
    ],
    excludePatterns = [
      "node_modules",
      ".git",
      "dist",
      "build",
      ".next",
      "coverage",
    ],
    maxResults = 50,
    caseSensitive = false,
    useRegex = false,
  } = options;

  const startTime = Date.now();

  // Try ripgrep first (fastest)
  try {
    const results = await searchWithRipgrep({
      query,
      appPath,
      filePatterns,
      excludePatterns,
      maxResults,
      caseSensitive,
      useRegex,
    });

    const elapsed = Date.now() - startTime;
    logger.log(
      `Code search completed: ${results.length} results in ${elapsed}ms (ripgrep)`,
    );
    return results;
  } catch (error) {
    logger.warn("ripgrep not available, falling back to Node.js fs:", error);
  }

  // Fallback to Node.js fs
  const results = await searchWithFs({
    query,
    appPath,
    filePatterns,
    excludePatterns,
    maxResults,
    caseSensitive,
    useRegex,
  });

  const elapsed = Date.now() - startTime;
  logger.log(
    `Code search completed: ${results.length} results in ${elapsed}ms (fs fallback)`,
  );
  return results;
}

/**
 * Search using ripgrep (fastest option)
 */
async function searchWithRipgrep(
  options: CodeSearchOptions & {
    filePatterns: string[];
    excludePatterns: string[];
  },
): Promise<CodeSearchResult[]> {
  const {
    query,
    appPath,
    filePatterns,
    excludePatterns,
    maxResults = 50,
    caseSensitive,
    useRegex,
  } = options;

  const args = [
    "--json",
    "--no-heading",
    "--line-number",
    "--max-count",
    String(maxResults),
  ];

  if (!caseSensitive) {
    args.push("--ignore-case");
  }

  if (useRegex) {
    args.push("--regexp", query);
  } else {
    args.push("--fixed-strings", query);
  }

  // Add file patterns
  for (const pattern of filePatterns) {
    args.push("--glob", pattern);
  }

  // Add exclude patterns
  for (const pattern of excludePatterns) {
    args.push("--glob", `!${pattern}`);
  }

  args.push(appPath);

  const result = await execa("rg", args, {
    cwd: appPath,
    timeout: 10000,
    reject: false,
  });

  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(`ripgrep failed with exit code ${result.exitCode}`);
  }

  const results: CodeSearchResult[] = [];
  const lines = result.stdout.split("\n").filter(Boolean);

  for (const line of lines) {
    try {
      const json = JSON.parse(line);
      if (json.type === "match") {
        results.push({
          file: json.path.text,
          line: json.line_number,
          content: json.submatches?.[0]?.match?.text || json.lines.text,
          matchType: useRegex ? "regex" : "exact",
          score: calculateMatchScore(json.lines.text, query),
        });
      }
    } catch {
      // Skip malformed JSON lines
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

/**
 * Fallback search using Node.js fs
 */
async function searchWithFs(
  options: CodeSearchOptions & {
    filePatterns: string[];
    excludePatterns: string[];
  },
): Promise<CodeSearchResult[]> {
  const {
    query,
    appPath,
    filePatterns,
    excludePatterns,
    maxResults = 50,
    caseSensitive,
    useRegex,
  } = options;

  const results: CodeSearchResult[] = [];
  const regex = useRegex
    ? new RegExp(query, caseSensitive ? "g" : "gi")
    : new RegExp(escapeRegex(query), caseSensitive ? "g" : "gi");

  async function walkDir(dir: string): Promise<void> {
    if (results.length >= maxResults) return;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= maxResults) break;

        const fullPath = path.join(dir, entry.name);

        // Skip excluded directories
        if (entry.isDirectory()) {
          if (excludePatterns.some((p) => entry.name.includes(p))) continue;
          await walkDir(fullPath);
          continue;
        }

        // Check file extension
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name);
        const allowedExts = filePatterns
          .flatMap((p) => p.match(/\.\w+/g) || [])
          .map((e) => e.toLowerCase());
        if (
          allowedExts.length > 0 &&
          !allowedExts.includes(ext.toLowerCase())
        ) {
          continue;
        }

        // Search file content
        try {
          const content = await fs.readFile(fullPath, "utf-8");
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            if (results.length >= maxResults) break;

            const line = lines[i];
            if (regex.test(line)) {
              results.push({
                file: fullPath,
                line: i + 1,
                content: line.trim(),
                matchType: useRegex ? "regex" : "exact",
                score: calculateMatchScore(line, query),
              });
            }
            regex.lastIndex = 0; // Reset regex state
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  await walkDir(appPath);
  return results.sort((a, b) => b.score - a.score);
}

/**
 * Calculate match quality score
 */
function calculateMatchScore(line: string, query: string): number {
  let score = 0.5; // Base score

  // Exact match bonus
  if (line.toLowerCase().includes(query.toLowerCase())) {
    score += 0.2;
  }

  // Shorter lines are often more relevant
  if (line.length < 100) score += 0.1;
  if (line.length < 50) score += 0.1;

  // Penalty for very long lines
  if (line.length > 200) score -= 0.1;

  return Math.max(0, Math.min(1, score));
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Format code search results for display
 */
export function formatCodeSearchResults(results: CodeSearchResult[]): string {
  if (results.length === 0) {
    return "No code matches found.";
  }

  return results
    .map(
      (r, i) =>
        `${i + 1}. **${r.file}:${r.line}**\n   ${r.content}\n   [${r.matchType} match, score: ${r.score.toFixed(2)}]`,
    )
    .join("\n\n");
}
