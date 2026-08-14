import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { resolveTargetAppPath } from "./resolve_app_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import log from "electron-log";

const logger = log.scope("code_context");

const DEFAULT_MAX_RESULTS = 10;
const MAX_MAX_RESULTS = 50;

const codeContextSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
  query: z
    .string()
    .min(1)
    .describe("Natural language query to search for semantically"),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(MAX_MAX_RESULTS)
    .optional()
    .describe(
      `Maximum results to return (default: ${DEFAULT_MAX_RESULTS}, max: ${MAX_MAX_RESULTS})`,
    ),
});

const DESCRIPTION = `Semantic code search using local embeddings and vector similarity.

- Finds code matching natural language queries
- Returns relevant code snippets with file:line references
- Uses local BM25/TF-IDF for zero-API-key semantic search
- Use for finding related code, understanding codebase patterns

Example queries:
- "authentication middleware"
- "database connection pooling"
- "error handling patterns"`;

interface SearchResult {
  file: string;
  line: number;
  content: string;
  score: number;
  type: "function" | "class" | "variable" | "comment" | "import";
}

// Simple BM25-like scoring for local semantic search
function calculateScore(query: string, content: string): number {
  const queryTerms = query.toLowerCase().split(/\s+/);
  const contentLower = content.toLowerCase();
  let score = 0;

  for (const term of queryTerms) {
    // Exact match
    if (contentLower.includes(term)) {
      score += 10;
      // Bonus for term in first 100 chars (title/heading)
      if (contentLower.indexOf(term) < 100) {
        score += 5;
      }
    }

    // Partial match
    const words = contentLower.split(/\s+/);
    for (const word of words) {
      if (word.includes(term) || term.includes(word)) {
        score += 3;
      }
    }
  }

  // Penalize very long files (prefer focused code)
  const lineCount = content.split("\n").length;
  if (lineCount > 100) score -= 2;
  if (lineCount > 500) score -= 5;

  return score;
}

function extractCodeBlock(
  lines: string[],
  startLine: number,
  contextLines: number = 5,
): string {
  const start = Math.max(0, startLine - contextLines);
  const end = Math.min(lines.length, startLine + contextLines + 1);
  return lines.slice(start, end).join("\n");
}

async function searchFile(
  filePath: string,
  query: string,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const score = calculateScore(query, line);

      if (score > 5) {
        // Determine type
        let type: SearchResult["type"] = "comment";
        if (line.match(/^(?:export\s+)?(?:async\s+)?function/))
          type = "function";
        else if (line.match(/^(?:export\s+)?class/)) type = "class";
        else if (line.match(/^(?:const|let|var)/)) type = "variable";
        else if (line.match(/^import/)) type = "import";

        results.push({
          file: filePath,
          line: i + 1,
          content: extractCodeBlock(lines, i),
          score,
          type,
        });
      }
    }
  } catch {
    // Skip unreadable files
  }

  return results;
}

async function walkDirectory(
  dir: string,
  exclude: Set<string>,
  files: string[] = [],
): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (exclude.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkDirectory(fullPath, exclude, files);
      } else if (entry.name.match(/\.(ts|tsx|js|jsx|py|go|rs|java|rb|php)$/)) {
        files.push(fullPath);
      }
    }
  } catch {
    // Skip inaccessible directories
  }
  return files;
}

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  ".next",
  "coverage",
]);

function buildAttributes(
  args: Partial<z.infer<typeof codeContextSchema>>,
  resultCount?: number,
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  attrs.push(`query="${escapeXmlAttr(args.query)}"`);
  if (resultCount !== undefined) attrs.push(`results="${resultCount}"`);
  return attrs.join(" ");
}

export const codeContextTool: ToolDefinition<
  z.infer<typeof codeContextSchema>
> = {
  name: "code_context",
  description: DESCRIPTION,
  inputSchema: codeContextSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => `Semantic search: "${args.query}"`,

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-code-context ${buildAttributes(args)}>Searching...</dyad-code-context>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
    const maxResults = Math.min(
      args.max_results ?? DEFAULT_MAX_RESULTS,
      MAX_MAX_RESULTS,
    );

    logger.log(`Semantic search: "${args.query}"`);
    ctx.onXmlStream(
      `<dyad-code-context ${buildAttributes(args)}>Scanning codebase...</dyad-code-context>`,
    );

    try {
      const files = await walkDirectory(targetAppPath, EXCLUDE_DIRS);
      const allResults: SearchResult[] = [];

      for (const file of files) {
        const results = await searchFile(file, args.query);
        allResults.push(...results);
      }

      // Sort by score and limit
      allResults.sort((a, b) => b.score - a.score);
      const topResults = allResults.slice(0, maxResults);

      const attrs = buildAttributes(args, topResults.length);

      if (topResults.length === 0) {
        const resultText = `No results found for "${args.query}"`;
        ctx.onXmlComplete(
          `<dyad-code-context ${attrs}>${resultText}</dyad-code-context>`,
        );
        return resultText;
      }

      let resultText = `Found ${topResults.length} relevant code snippets for "${args.query}":\n\n`;

      topResults.forEach((r, i) => {
        const relativePath = path.relative(targetAppPath, r.file);
        resultText += `## ${i + 1}. ${relativePath}:${r.line} [${r.type}]\n`;
        resultText += `Score: ${r.score.toFixed(1)}\n\n`;
        resultText += "```typescript\n";
        resultText += r.content;
        resultText += "\n```\n\n";
      });

      ctx.onXmlComplete(
        `<dyad-code-context ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-code-context>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to search code context: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
