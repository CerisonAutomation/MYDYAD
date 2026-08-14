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

const logger = log.scope("context_optimize");

const DEFAULT_TOKEN_BUDGET = 4000;
const MAX_TOKEN_BUDGET = 32000;
const CHARS_PER_TOKEN = 4;
const MAX_FILE_SIZE = 50000;

const contextOptimizeSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
  goal: z
    .string()
    .min(1)
    .max(500)
    .describe("What the AI agent is trying to accomplish"),
  token_budget: z
    .number()
    .int()
    .min(500)
    .max(MAX_TOKEN_BUDGET)
    .optional()
    .describe(
      `Maximum tokens for context (default: ${DEFAULT_TOKEN_BUDGET}, max: ${MAX_TOKEN_BUDGET}).`,
    ),
});

const DESCRIPTION = `Generate minimal, high-signal context for AI agents within token budgets.

- Returns token-budgeted context files ordered by relevance to goal
- Scores files by path and content relevance to the goal
- Use for preparing context for LLMs and code review`;

interface ContextFile {
  path: string;
  content: string;
  relevance: number;
  tokens: number;
}

interface ContextResult {
  files: ContextFile[];
  totalTokens: number;
  relevance: number;
}

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  ".next",
  "coverage",
  ".cache",
  "vendor",
  ".venv",
]);

function calculateRelevance(
  filePath: string,
  content: string,
  goal: string,
): number {
  let score = 0;
  const goalLower = goal.toLowerCase();
  const pathLower = filePath.toLowerCase();
  const contentLower = content.toLowerCase();

  // Path relevance
  if (goalLower.includes("test") && pathLower.includes("test")) score += 0.3;
  if (goalLower.includes("api") && pathLower.includes("api")) score += 0.3;
  if (goalLower.includes("auth") && pathLower.includes("auth")) score += 0.3;
  if (goalLower.includes("component") && pathLower.includes("component"))
    score += 0.3;
  if (goalLower.includes("util") && pathLower.includes("util")) score += 0.2;

  // Content relevance (keyword matching)
  const keywords = goalLower.split(/\s+/).filter((w) => w.length > 3);
  for (const keyword of keywords) {
    if (contentLower.includes(keyword)) score += 0.1;
  }

  // File size penalty (prefer smaller, focused files)
  const tokens = content.length / CHARS_PER_TOKEN;
  if (tokens > 1000) score -= 0.1;
  if (tokens > 2000) score -= 0.2;

  // Bonus for exports (public API)
  if (content.includes("export")) score += 0.1;

  return Math.min(1, Math.max(0, score));
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / CHARS_PER_TOKEN);
}

function truncateToTokens(content: string, maxTokens: number): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (content.length <= maxChars) return content;
  return content.substring(0, maxChars) + "\n// ... truncated";
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
      } else if (
        entry.name.match(/\.(ts|tsx|js|jsx|py|go|rs|java|rb|php|md|json)$/)
      ) {
        files.push(fullPath);
      }
    }
  } catch {
    // Skip inaccessible directories
  }
  return files;
}

function buildAttributes(
  args: Partial<z.infer<typeof contextOptimizeSchema>>,
  stats?: { files: number; tokens: number; budget: number; relevance: string },
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (args.goal) attrs.push(`goal="${escapeXmlAttr(args.goal)}"`);
  if (stats) {
    attrs.push(`files="${stats.files}"`);
    attrs.push(`tokens="${stats.tokens}"`);
    attrs.push(`budget="${stats.budget}"`);
    attrs.push(`relevance="${stats.relevance}"`);
  }
  return attrs.join(" ");
}

export const contextOptimizeTool: ToolDefinition<
  z.infer<typeof contextOptimizeSchema>
> = {
  name: "context_optimize",
  description: DESCRIPTION,
  inputSchema: contextOptimizeSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => `Optimize context for: "${args.goal}"`,

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-context-optimize ${buildAttributes(args)}>Optimizing...</dyad-context-optimize>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
    const tokenBudget = Math.min(
      args.token_budget ?? DEFAULT_TOKEN_BUDGET,
      MAX_TOKEN_BUDGET,
    );

    logger.log(`Optimizing context for goal: ${args.goal}`);
    ctx.onXmlStream(
      `<dyad-context-optimize ${buildAttributes(args)}>Analyzing repository...</dyad-context-optimize>`,
    );

    try {
      const files = await walkDirectory(targetAppPath, EXCLUDE_DIRS);
      const candidates: ContextFile[] = [];

      for (const file of files) {
        try {
          const stat = await fs.stat(file);
          if (stat.size > MAX_FILE_SIZE) continue;

          const content = await fs.readFile(file, "utf-8");
          const relativePath = path.relative(targetAppPath, file);
          const relevance = calculateRelevance(
            relativePath,
            content,
            args.goal,
          );
          const tokens = estimateTokens(content);

          if (relevance > 0.1) {
            candidates.push({ path: relativePath, content, relevance, tokens });
          }
        } catch {
          // Skip unreadable files
        }
      }

      candidates.sort((a, b) => b.relevance - a.relevance);

      const selected: ContextFile[] = [];
      let remainingTokens = tokenBudget;
      let totalRelevance = 0;

      for (const candidate of candidates) {
        if (remainingTokens <= 0) break;
        const tokensForFile = Math.min(candidate.tokens, remainingTokens);
        const truncatedContent = truncateToTokens(
          candidate.content,
          tokensForFile,
        );
        selected.push({
          path: candidate.path,
          content: truncatedContent,
          relevance: candidate.relevance,
          tokens: tokensForFile,
        });
        remainingTokens -= tokensForFile;
        totalRelevance += candidate.relevance;
      }

      const avgRelevance =
        selected.length > 0 ? totalRelevance / selected.length : 0;
      const result: ContextResult = {
        files: selected,
        totalTokens: tokenBudget - remainingTokens,
        relevance: avgRelevance,
      };

      const attrs = buildAttributes(args, {
        files: result.files.length,
        tokens: result.totalTokens,
        budget: tokenBudget,
        relevance: `${(result.relevance * 100).toFixed(0)}%`,
      });

      if (result.files.length === 0) {
        ctx.onXmlComplete(
          `<dyad-context-optimize ${attrs}>No relevant files found.</dyad-context-optimize>`,
        );
        return "No relevant files found.";
      }

      const fileLines = result.files.map(
        (f, i) =>
          `## ${i + 1}. ${f.path} (relevance: ${(f.relevance * 100).toFixed(0)}%, tokens: ${f.tokens})\n\n${f.content.substring(0, 500)}${f.content.length > 500 ? "\n..." : ""}`,
      );

      const resultText = `Goal: ${args.goal}\nTokens Used: ${result.totalTokens}/${tokenBudget}\nFiles Selected: ${result.files.length}\nAvg Relevance: ${(result.relevance * 100).toFixed(0)}%\n\n${fileLines.join("\n\n")}`;

      ctx.onXmlComplete(
        `<dyad-context-optimize ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-context-optimize>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to optimize context: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
