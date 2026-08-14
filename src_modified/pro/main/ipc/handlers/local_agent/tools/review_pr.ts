import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { resolveTargetAppPath } from "./resolve_app_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import log from "electron-log";

const logger = log.scope("review_pr");

const reviewPrSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
  pr_number: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Pull request number (if available)"),
  base_ref: z
    .string()
    .optional()
    .describe("Base ref for diff (default: main or master)"),
  head_ref: z
    .string()
    .optional()
    .describe("Head ref for diff (default: current branch)"),
});

const DESCRIPTION = `Review pull request diff with code quality analysis.

- Analyzes diff for security issues, code smells, and quality problems
- Provides actionable feedback with file:line references
- Use for code review and pre-merge checks`;

interface ReviewFinding {
  severity: "critical" | "warning" | "info";
  file: string;
  line?: number;
  message: string;
  suggestion?: string;
}

interface ReviewResult {
  findings: ReviewFinding[];
  score: number;
  verdict: "approve" | "request_changes" | "comment";
}

function analyzeDiffForIssues(diffContent: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = diffContent.split("\n");

  let currentFile = "";
  let currentLine = 0;

  for (const line of lines) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.substring(6);
      currentLine = 0;
    } else if (line.startsWith("@@")) {
      const match = line.match(/\+(\d+)/);
      if (match) currentLine = parseInt(match[1]);
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      currentLine++;

      // Check for issues in added lines
      if (line.includes("console.log") || line.includes("console.debug")) {
        findings.push({
          severity: "warning",
          file: currentFile,
          line: currentLine,
          message: "Debug statement left in code",
          suggestion: "Remove console.log before merging",
        });
      }

      if (line.includes("eval(") || line.includes("new Function(")) {
        findings.push({
          severity: "critical",
          file: currentFile,
          line: currentLine,
          message: "Unsafe code execution detected",
          suggestion: "Avoid eval() and new Function() for security",
        });
      }

      if (line.includes("innerHTML")) {
        findings.push({
          severity: "warning",
          file: currentFile,
          line: currentLine,
          message: "Direct innerHTML assignment",
          suggestion: "Use textContent or sanitize input to prevent XSS",
        });
      }

      if (line.match(/(?:password|secret|api[_-]?key)\s*[:=]\s*['"]/i)) {
        findings.push({
          severity: "critical",
          file: currentFile,
          line: currentLine,
          message: "Potential hardcoded secret",
          suggestion: "Use environment variables for secrets",
        });
      }

      if (line.includes("TODO") || line.includes("FIXME")) {
        findings.push({
          severity: "info",
          file: currentFile,
          line: currentLine,
          message: "TODO/FIXME comment found",
          suggestion: "Create an issue to track this",
        });
      }
    }
  }

  return findings;
}

function buildAttributes(
  args: Partial<z.infer<typeof reviewPrSchema>>,
  result?: ReviewResult,
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (args.pr_number) attrs.push(`pr="${args.pr_number}"`);
  if (result) {
    attrs.push(`findings="${result.findings.length}"`);
    attrs.push(`score="${result.score}"`);
    attrs.push(`verdict="${result.verdict}"`);
  }
  return attrs.join(" ");
}

export const reviewPrTool: ToolDefinition<z.infer<typeof reviewPrSchema>> = {
  name: "review_pr",
  description: DESCRIPTION,
  inputSchema: reviewPrSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Review pull request";
    if (args.pr_number) preview += ` #${args.pr_number}`;
    if (args.app_name) preview += ` in app: ${args.app_name}`;
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-review-pr ${buildAttributes(args)}>Analyzing diff...</dyad-review-pr>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Reviewing PR in ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-review-pr ${buildAttributes(args)}>Reading diff...</dyad-review-pr>`,
    );

    try {
      // Get diff content
      const { spawn } = await import("node:child_process");
      const baseRef = args.base_ref || "main";
      const headRef = args.head_ref || "HEAD";

      let diffContent = "";
      try {
        const result = spawn("git", ["diff", `${baseRef}...${headRef}`], {
          cwd: targetAppPath,
        });
        result.stdout.on("data", (data) => {
          diffContent += data.toString();
        });
      } catch {
        diffContent = "No diff available";
      }

      const findings = analyzeDiffForIssues(diffContent);
      const criticalCount = findings.filter(
        (f) => f.severity === "critical",
      ).length;
      const warningCount = findings.filter(
        (f) => f.severity === "warning",
      ).length;

      let score = 100;
      score -= criticalCount * 20;
      score -= warningCount * 5;
      score = Math.max(0, score);

      const verdict =
        criticalCount > 0
          ? "request_changes"
          : warningCount > 3
            ? "comment"
            : "approve";

      const result: ReviewResult = {
        findings,
        score,
        verdict,
      };

      const attrs = buildAttributes(args, result);

      let resultText = `PR Review\n\n`;
      resultText += `Score: ${score}/100\n`;
      resultText += `Verdict: ${verdict.toUpperCase()}\n\n`;

      if (findings.length === 0) {
        resultText += `✅ No issues found`;
      } else {
        resultText += `Findings (${findings.length}):\n\n`;
        findings.forEach((f) => {
          const icon =
            f.severity === "critical"
              ? "🔴"
              : f.severity === "warning"
                ? "🟡"
                : "ℹ️";
          resultText += `${icon} ${f.file}:${f.line || "?"}\n`;
          resultText += `   ${f.message}\n`;
          if (f.suggestion) resultText += `   💡 ${f.suggestion}\n`;
          resultText += `\n`;
        });
      }

      ctx.onXmlComplete(
        `<dyad-review-pr ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-review-pr>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to review PR: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
