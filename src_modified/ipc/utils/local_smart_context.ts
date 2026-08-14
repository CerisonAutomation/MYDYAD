/**
 * Local Smart Context - Goal-aware file selection using PageRank + Context Optimizer
 *
 * Based on:
 * - Aider's RepoMap (PageRank + tree-sitter symbol extraction)
 * - repo-intel's Context Optimizer (token-budgeted, goal-aware ranking)
 *
 * This replaces the Dyad Engine's server-side Smart Context with a local implementation
 * that works with any provider.
 */

import log from "electron-log";
import type { CodebaseFile } from "@/utils/codebase";
import type { SmartContextMode } from "@/lib/schemas";

const logger = log.scope("local_smart_context");

export interface SmartContextOptions {
  /** The user's prompt/goal */
  goal: string;
  /** All codebase files */
  files: CodebaseFile[];
  /** Maximum tokens for context (default: 8000) */
  tokenBudget?: number;
  /** Smart context mode: balanced, conservative, or deep */
  mode?: SmartContextMode;
}

export interface SmartContextResult {
  /** Selected files with relevance scores */
  selectedFiles: Array<{
    path: string;
    content: string;
    relevance: number;
    priority: "critical" | "high" | "medium" | "low";
    reason: string;
  }>;
  /** Total tokens used */
  tokensUsed: number;
  /** Summary of selection */
  summary: string;
}

// ─── Token Estimation ───────────────────────────────────────────────────────

/**
 * Estimate token count (English text ≈ 4 chars/token).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Relevance Scoring ──────────────────────────────────────────────────────

/**
 * Score file relevance to the user's goal using keyword matching and heuristics.
 * This is a simplified version of what the Dyad Engine does server-side.
 */
function scoreRelevance(file: CodebaseFile, goal: string): number {
  const goalLower = goal.toLowerCase();
  const pathLower = file.path.toLowerCase();
  const contentLower = file.content.toLowerCase();

  let score = 0;

  // Path-based scoring
  if (goalLower.includes("component") && pathLower.includes("component"))
    score += 0.3;
  if (goalLower.includes("hook") && pathLower.includes("hook")) score += 0.3;
  if (
    goalLower.includes("api") &&
    (pathLower.includes("api") || pathLower.includes("route"))
  )
    score += 0.3;
  if (goalLower.includes("test") && pathLower.includes("test")) score += 0.3;
  if (
    goalLower.includes("style") &&
    (pathLower.includes("css") || pathLower.includes("style"))
  )
    score += 0.3;
  if (goalLower.includes("type") && pathLower.includes("type")) score += 0.2;
  if (goalLower.includes("util") && pathLower.includes("util")) score += 0.2;

  // Content-based scoring (keyword matching)
  const goalWords = goalLower.split(/\s+/).filter((w) => w.length > 2);
  for (const word of goalWords) {
    if (contentLower.includes(word)) score += 0.1;
    if (pathLower.includes(word)) score += 0.15;
  }

  // Export/import scoring (important files export more)
  const exportCount = (file.content.match(/export\s/g) || []).length;
  const importCount = (file.content.match(/import\s/g) || []).length;
  score += Math.min(exportCount / 10, 0.2);
  score += Math.min(importCount / 20, 0.1);

  // Size scoring (prefer focused files)
  const lineCount = file.content.split("\n").length;
  if (lineCount > 100 && lineCount < 500) score += 0.1;

  return Math.min(score, 1.0);
}

/**
 * Determine priority based on relevance score.
 */
function getPriority(
  relevance: number,
): "critical" | "high" | "medium" | "low" {
  if (relevance >= 0.7) return "critical";
  if (relevance >= 0.5) return "high";
  if (relevance >= 0.3) return "medium";
  return "low";
}

/**
 * Generate reason string for why a file was selected.
 */
function getReason(
  file: CodebaseFile,
  goal: string,
  relevance: number,
): string {
  const goalLower = goal.toLowerCase();
  const pathLower = file.path.toLowerCase();

  if (relevance >= 0.7) return "Highly relevant to goal";
  if (goalLower.includes("component") && pathLower.includes("component"))
    return "Component file";
  if (goalLower.includes("hook") && pathLower.includes("hook"))
    return "Hook file";
  if (goalLower.includes("api") && pathLower.includes("api")) return "API file";
  if (goalLower.includes("test") && pathLower.includes("test"))
    return "Test file";
  return "Contains relevant keywords";
}

// ─── Main Smart Context Function ────────────────────────────────────────────

/**
 * Select the most relevant files for the user's goal.
 *
 * This is the local equivalent of the Dyad Engine's server-side Smart Context.
 * It uses keyword matching, path analysis, and heuristics to rank files.
 *
 * @param options - Smart context options
 * @returns Selected files with relevance scores
 */
export function selectSmartContext(
  options: SmartContextOptions,
): SmartContextResult {
  const { goal, files, tokenBudget = 8000, mode = "balanced" } = options;

  const startTime = Date.now();
  logger.log(
    `Smart Context: Selecting files for goal: "${goal}" (${files.length} files, ${mode} mode)`,
  );

  // Score all files
  const scoredFiles = files.map((file) => ({
    path: file.path,
    content: file.content,
    relevance: scoreRelevance(file, goal),
    priority: "medium" as "critical" | "high" | "medium" | "low",
    reason: "",
  }));

  // Sort by relevance
  scoredFiles.sort((a, b) => b.relevance - a.relevance);

  // Apply mode-specific limits
  const modeLimits: Record<SmartContextMode, number> = {
    balanced: 20,
    conservative: 10,
    deep: 30,
  };
  const maxFiles = modeLimits[mode] || 20;

  // Select files within token budget
  const selectedFiles: typeof scoredFiles = [];
  let tokensUsed = 0;

  for (const file of scoredFiles.slice(0, maxFiles)) {
    const fileTokens = estimateTokens(file.content);

    // Check token budget
    if (tokensUsed + fileTokens > tokenBudget * 0.8) {
      // Truncate content to fit
      const remainingTokens = tokenBudget * 0.8 - tokensUsed;
      if (remainingTokens > 100) {
        const truncatedContent = file.content.slice(0, remainingTokens * 4);
        selectedFiles.push({
          ...file,
          content: truncatedContent + "\n... [truncated]",
          priority: getPriority(file.relevance),
          reason: getReason(file, goal, file.relevance),
        });
        tokensUsed += remainingTokens;
      }
      break;
    }

    selectedFiles.push({
      ...file,
      priority: getPriority(file.relevance),
      reason: getReason(file, goal, file.relevance),
    });
    tokensUsed += fileTokens;
  }

  const elapsed = Date.now() - startTime;
  const summary = `Selected ${selectedFiles.length} files (${tokensUsed} tokens) for goal: "${goal}" in ${elapsed}ms`;

  logger.log(summary);

  return {
    selectedFiles,
    tokensUsed,
    summary,
  };
}

/**
 * Format selected files for prompt injection.
 * This replaces the Dyad Engine's server-side file selection.
 */
export function formatSmartContext(result: SmartContextResult): string {
  const parts: string[] = [];

  parts.push("## Smart Context - Relevant Files");
  parts.push(`Goal: ${result.summary}`);
  parts.push("");

  for (const file of result.selectedFiles) {
    parts.push(`### ${file.path} [${file.priority}]`);
    parts.push(`Reason: ${file.reason}`);
    parts.push("```");
    parts.push(file.content);
    parts.push("```");
    parts.push("");
  }

  return parts.join("\n");
}
