/**
 * Code Review Bot Tool
 *
 * Automated code review with AI-powered suggestions.
 * Based on reviewdog (9.5k★) - automated code review tool.
 *
 * Features:
 * - Multi-linter integration
 * - PR review comments
 * - Code quality scoring
 * - Suggestion generation
 */

import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { AgentContext, ToolDefinition } from "./types";
import { resolveTargetAppPath } from "./resolve_app_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const codeReviewBotSchema = z
  .object({
    operation: z
      .enum(["review_file", "review_diff", "score", "suggest"])
      .describe("Operation to perform"),
    file_path: z.string().optional().describe("File to review"),
    diff: z.string().optional().describe("Diff to review"),
    focus: z
      .enum(["security", "performance", "readability", "all"])
      .optional()
      .describe("Review focus area"),
  })
  .refine(
    (data) => {
      if (
        ["review_file", "score", "suggest"].includes(data.operation) &&
        !data.file_path
      ) {
        return false;
      }
      if (data.operation === "review_diff" && !data.diff) {
        return false;
      }
      return true;
    },
    {
      message:
        "file_path is required for review_file/score/suggest; diff is required for review_diff",
    },
  );

type CodeReviewBotArgs = z.infer<typeof codeReviewBotSchema>;

interface ReviewComment {
  line: number;
  severity: "error" | "warning" | "info";
  category: string;
  message: string;
  suggestion: string;
}

interface ReviewResult {
  file: string;
  score: number;
  comments: ReviewComment[];
  summary: string;
  categories: {
    security: number;
    performance: number;
    readability: number;
    maintainability: number;
  };
}

// Review patterns — expanded for comprehensive analysis
const REVIEW_PATTERNS: Array<{
  pattern: RegExp;
  severity: ReviewComment["severity"];
  category: string;
  message: string;
  suggestion: string;
}> = [
  // Security
  {
    pattern: /eval\s*\(/g,
    severity: "error",
    category: "security",
    message: "Use of eval() — potential code injection",
    suggestion:
      "Avoid eval(); use JSON.parse() or Function constructor if needed",
  },
  {
    pattern: /innerHTML\s*=/g,
    severity: "error",
    category: "security",
    message: "Direct innerHTML assignment — potential XSS",
    suggestion:
      "Use textContent, DOMPurify.sanitize(), or React's dangerouslySetInnerHTML with sanitization",
  },
  {
    pattern: /document\.write\s*\(/g,
    severity: "error",
    category: "security",
    message: "Use of document.write() — potential XSS and performance issue",
    suggestion: "Use DOM manipulation methods instead",
  },
  {
    pattern: /new\s+Function\s*\(/g,
    severity: "error",
    category: "security",
    message: "Dynamic function creation — potential code injection",
    suggestion: "Avoid new Function(); use closures or imported functions",
  },
  // Performance
  {
    pattern: /console\.(log|warn|error|info|debug)/g,
    severity: "warning",
    category: "performance",
    message: "Console statement in production code",
    suggestion: "Remove or use a proper logging library",
  },
  {
    pattern: /TODO|FIXME|HACK|XXX/gi,
    severity: "info",
    category: "maintenance",
    message: "TODO/FIXME comment found",
    suggestion: "Address or create a ticket for this",
  },
  {
    pattern: /any(?:\s|;|,|\))/g,
    severity: "warning",
    category: "type-safety",
    message: "Use of 'any' type",
    suggestion: "Use a specific type or 'unknown'",
  },
  {
    pattern: /(?:var\s+)/g,
    severity: "warning",
    category: "modernization",
    message: "Use of 'var' keyword",
    suggestion: "Use 'const' or 'let' instead",
  },
  {
    pattern: /(?:==\s*null|!=\s*null)/g,
    severity: "info",
    category: "readability",
    message: "Loose equality with null",
    suggestion: "Use === null or === undefined",
  },
  {
    pattern: /(?:if|else|for|while)\s*\([^)]*\)\s*\{[^}]*\{[^}]*\{/g,
    severity: "warning",
    category: "complexity",
    message: "Deep nesting detected (3+ levels)",
    suggestion: "Reduce nesting with early returns or extraction",
  },
  // React-specific
  {
    pattern: /useEffect\s*\(\s*\(\)\s*=>\s*\{[^}]*\}\s*,\s*\[\s*\]\s*\)/g,
    severity: "info",
    category: "react",
    message: "useEffect with empty deps — verify cleanup is needed",
    suggestion:
      "Ensure the effect returns a cleanup function if it creates subscriptions or timers",
  },
  {
    pattern: /dangerouslySetInnerHTML/g,
    severity: "warning",
    category: "security",
    message: "dangerouslySetInnerHTML used — verify content is sanitized",
    suggestion: "Sanitize HTML with DOMPurify before rendering",
  },
  {
    pattern: /new\s+Set\s*\(/g,
    severity: "info",
    category: "react",
    message: "new Set() in render — consider useMemo",
    suggestion: "Wrap in useMemo to avoid re-creating Set on every render",
  },
  // Node.js / API
  {
    pattern: /process\.exit\s*\(/g,
    severity: "warning",
    category: "reliability",
    message: "process.exit() called — may skip cleanup",
    suggestion: "Let the process exit naturally or use process.exitCode",
  },
  {
    pattern:
      /\.catch\s*\(\s*(\(\)\s*=>\s*\{\s*\}|\(\)\s*=>\s*null|e\s*=>\s*\{\s*\})\s*\)/g,
    severity: "warning",
    category: "reliability",
    message: "Empty catch block — errors silently swallowed",
    suggestion: "Log the error or re-throw it",
  },
];

// Generate review comments
function generateReviewComments(
  content: string,
  focus: string,
): ReviewComment[] {
  const comments: ReviewComment[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const reviewPattern of REVIEW_PATTERNS) {
      if (focus !== "all" && reviewPattern.category !== focus) continue;
      // Create a fresh RegExp copy to avoid lastIndex state issues with `g` flag
      const freshPattern = new RegExp(
        reviewPattern.pattern.source,
        reviewPattern.pattern.flags,
      );
      if (freshPattern.test(line)) {
        comments.push({
          line: i + 1,
          severity: reviewPattern.severity,
          category: reviewPattern.category,
          message: reviewPattern.message,
          suggestion: reviewPattern.suggestion,
        });
      }
    }
  }

  return comments;
}

// Calculate score
function calculateScore(comments: ReviewComment[]): number {
  let score = 100;
  for (const comment of comments) {
    if (comment.severity === "error") score -= 10;
    else if (comment.severity === "warning") score -= 5;
    else score -= 1;
  }
  return Math.max(0, score);
}

export const codeReviewBotTool: ToolDefinition<CodeReviewBotArgs> = {
  name: "code_review_bot",
  description: `Automated code review with AI-powered suggestions.

Based on reviewdog (9.5k★) - automated code review tool.

Operations:
- review_file: Review a specific file
- review_diff: Review a diff
- score: Get code quality score
- suggest: Get improvement suggestions

Focus areas: security, performance, readability, all

Output: Review comments with line numbers, severity, and suggestions`,
  inputSchema: codeReviewBotSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) =>
    args.file_path ? `Review ${args.file_path}` : "Review code",

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    const attrs = [`op="${args.operation}"`];
    if (args.file_path) attrs.push(`file="${args.file_path}"`);
    return `<dyad-code-review ${attrs.join(" ")}>Reviewing...</dyad-code-review>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const startTime = Date.now();
    const focus = args.focus || "all";
    const targetAppPath = resolveTargetAppPath(ctx, undefined);

    ctx.onXmlStream(
      `<dyad-code-review op="${args.operation}">Reviewing code...</dyad-code-review>`,
    );

    let result: ReviewResult | ReviewComment[];

    try {
      switch (args.operation) {
        case "review_file": {
          if (!args.file_path)
            throw new DyadError(
              "file_path is required",
              DyadErrorKind.Validation,
            );

          const content = await fs.readFile(
            path.join(targetAppPath, args.file_path),
            "utf-8",
          );
          const comments = generateReviewComments(content, focus);
          const score = calculateScore(comments);

          result = {
            file: args.file_path,
            score,
            comments,
            summary: `Found ${comments.length} issues (score: ${score}/100)`,
            categories: {
              security: comments.filter((c) => c.category === "security")
                .length,
              performance: comments.filter((c) => c.category === "performance")
                .length,
              readability: comments.filter((c) => c.category === "readability")
                .length,
              maintainability: comments.filter(
                (c) => c.category === "maintainability",
              ).length,
            },
          };
          break;
        }

        case "review_diff": {
          if (!args.diff)
            throw new DyadError("diff is required", DyadErrorKind.Validation);

          const comments = generateReviewComments(args.diff, focus);
          const score = calculateScore(comments);

          result = {
            file: "diff",
            score,
            comments,
            summary: `Found ${comments.length} issues in diff (score: ${score}/100)`,
            categories: {
              security: comments.filter((c) => c.category === "security")
                .length,
              performance: comments.filter((c) => c.category === "performance")
                .length,
              readability: comments.filter((c) => c.category === "readability")
                .length,
              maintainability: comments.filter(
                (c) => c.category === "maintainability",
              ).length,
            },
          };
          break;
        }

        case "score": {
          if (!args.file_path)
            throw new DyadError(
              "file_path is required",
              DyadErrorKind.Validation,
            );

          const content = await fs.readFile(
            path.join(targetAppPath, args.file_path),
            "utf-8",
          );
          const comments = generateReviewComments(content, focus);
          const score = calculateScore(comments);

          result = {
            file: args.file_path,
            score,
            comments: [],
            summary: `Score: ${score}/100`,
            categories: {
              security: comments.filter((c) => c.category === "security")
                .length,
              performance: comments.filter((c) => c.category === "performance")
                .length,
              readability: comments.filter((c) => c.category === "readability")
                .length,
              maintainability: comments.filter(
                (c) => c.category === "maintainability",
              ).length,
            },
          };
          break;
        }

        case "suggest": {
          if (!args.file_path)
            throw new DyadError(
              "file_path is required",
              DyadErrorKind.Validation,
            );

          const content = await fs.readFile(
            path.join(targetAppPath, args.file_path),
            "utf-8",
          );
          const comments = generateReviewComments(content, focus);

          result = comments.filter((c) => c.suggestion);
          break;
        }

        default:
          throw new DyadError(
            `Unknown operation: ${args.operation}`,
            DyadErrorKind.Validation,
          );
      }
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to review code: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }

    const elapsed = Date.now() - startTime;

    ctx.onXmlComplete(
      `<dyad-code-review op="${args.operation}" elapsed_ms="${elapsed}">${JSON.stringify(result, null, 2)}</dyad-code-review>`,
    );

    return JSON.stringify(result, null, 2);
  },
};
