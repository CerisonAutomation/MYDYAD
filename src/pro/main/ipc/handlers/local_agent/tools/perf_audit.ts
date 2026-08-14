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
import { walkDirectory } from "./file_utils";

const logger = log.scope("perf_audit");

const DEFAULT_MAX_FILES = 500;
const MAX_MAX_FILES = 5000;

const perfAuditSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
  max_files: z
    .number()
    .min(1)
    .max(MAX_MAX_FILES)
    .optional()
    .describe(
      `Maximum number of files to scan (default: ${DEFAULT_MAX_FILES}, max: ${MAX_MAX_FILES}).`,
    ),
});

const DESCRIPTION = `Analyze performance issues in code.

- Detects: N+1 queries, synchronous I/O in loops, unbounded queries, missing timeouts, memory leaks
- Returns issues with file, line, severity, and recommendations
- Use for performance optimization and production readiness`;

interface PerfIssue {
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  line: number;
  message: string;
  recommendation: string;
}

interface PerfReport {
  file: string;
  issues: PerfIssue[];
  score: number;
}

const PERF_PATTERNS: Array<{
  pattern: RegExp;
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  recommendation: string;
}> = [
  // N+1 Query Detection
  {
    pattern: /for\s*\([^)]+\)\s*\{[^}]*\.(?:find|query|select|execute)\s*\(/gi,
    type: "n_plus_one_query",
    severity: "critical",
    message: "Database query inside loop (N+1 problem)",
    recommendation: "Use batch query or JOIN instead",
  },
  // Synchronous I/O in loops
  {
    pattern: /for\s*\([^)]+\)\s*\{[^}]*readFileSync|writeFileSync|statSync/gi,
    type: "sync_io_in_loop",
    severity: "high",
    message: "Synchronous file I/O inside loop",
    recommendation: "Use async/await with Promise.all for parallel I/O",
  },
  // Unbounded queries
  {
    pattern: /\.find\s*\(\s*\)\s*(?!.*\.limit)/gi,
    type: "unbounded_query",
    severity: "medium",
    message: "Query without limit - may return unbounded results",
    recommendation: "Add .limit() or pagination",
  },
  // Missing timeouts
  {
    pattern: /fetch\s*\([^)]*\)(?!.*timeout|.*AbortController|.*signal)/gi,
    type: "missing_timeout",
    severity: "medium",
    message: "fetch() without timeout",
    recommendation: "Add AbortController timeout or fetch timeout option",
  },
  // Memory leak patterns
  {
    pattern: /setInterval\s*\([^)]+\)(?!.*clearInterval)/gi,
    type: "potential_memory_leak",
    severity: "high",
    message: "setInterval without cleanup",
    recommendation: "Ensure clearInterval is called on unmount/cleanup",
  },
  // Large object spread
  {
    pattern: /\.\.\.[a-zA-Z]+(?!,)/g,
    type: "large_spread",
    severity: "low",
    message: "Object spread may copy large objects",
    recommendation: "Consider selective copying or structuredClone",
  },
  // Synchronous crypto
  {
    pattern: /crypto\.(?:pbkdf2|scrypt)Sync/gi,
    type: "sync_crypto",
    severity: "high",
    message: "Synchronous crypto operation blocks event loop",
    recommendation: "Use async version with promisify",
  },
  // Missing indexes hint
  {
    pattern: /\.where\s*\([^)]+\)(?!.*\.index)/gi,
    type: "missing_index_hint",
    severity: "low",
    message: "WHERE clause without index hint",
    recommendation: "Ensure proper database indexes exist",
  },
];

function analyzeFile(filePath: string, content: string): PerfReport {
  const issues: PerfIssue[] = [];
  const lines = content.split("\n");

  for (const {
    pattern,
    type,
    severity,
    message,
    recommendation,
  } of PERF_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split("\n").length;
      if (lineNum <= lines.length) {
        issues.push({ type, severity, line: lineNum, message, recommendation });
      }
    }
  }

  let score = 100;
  for (const issue of issues) {
    switch (issue.severity) {
      case "critical":
        score -= 20;
        break;
      case "high":
        score -= 10;
        break;
      case "medium":
        score -= 5;
        break;
      case "low":
        score -= 2;
        break;
    }
  }

  return { file: filePath, issues, score: Math.max(0, score) };
}

function buildAttributes(
  args: Partial<z.infer<typeof perfAuditSchema>>,
  stats?: { score: number; issues: number; files: number; critical: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (stats) {
    attrs.push(`score="${stats.score}"`);
    attrs.push(`issues="${stats.issues}"`);
    attrs.push(`files="${stats.files}"`);
    attrs.push(`critical="${stats.critical}"`);
  }
  return attrs.join(" ");
}

export const perfAuditTool: ToolDefinition<z.infer<typeof perfAuditSchema>> = {
  name: "perf_audit",
  description: DESCRIPTION,
  inputSchema: perfAuditSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Analyze performance issues";
    if (args.app_name) preview += ` in app: ${args.app_name}`;
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-perf-audit ${buildAttributes(args)}>Scanning for performance issues...</dyad-perf-audit>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
    const maxFiles = Math.min(
      args.max_files ?? DEFAULT_MAX_FILES,
      MAX_MAX_FILES,
    );

    logger.log(`Performance auditing ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-perf-audit ${buildAttributes(args)}>Scanning ${maxFiles} files...</dyad-perf-audit>`,
    );

    try {
      const files = await walkDirectory(targetAppPath, {
        maxFiles,
        filePattern: /\.(ts|tsx|js|jsx|py|go|rs|java)$/,
      });
      const reports: PerfReport[] = [];

      for (const file of files) {
        try {
          const content = await fs.readFile(file, "utf-8");
          const relativePath = path.relative(targetAppPath, file);
          const report = analyzeFile(relativePath, content);
          if (report.issues.length > 0) reports.push(report);
        } catch {
          // Skip unreadable files
        }
      }

      reports.sort((a, b) => a.score - b.score);
      const totalIssues = reports.reduce((sum, r) => sum + r.issues.length, 0);
      const critical = reports.reduce(
        (sum, r) =>
          sum + r.issues.filter((i) => i.severity === "critical").length,
        0,
      );
      const avgScore =
        reports.length > 0
          ? Math.round(
              reports.reduce((sum, r) => sum + r.score, 0) / reports.length,
            )
          : 100;

      const attrs = buildAttributes(args, {
        score: avgScore,
        issues: totalIssues,
        files: reports.length,
        critical,
      });

      if (reports.length === 0) {
        ctx.onXmlComplete(
          `<dyad-perf-audit ${attrs}>No performance issues detected.</dyad-perf-audit>`,
        );
        return "No performance issues detected.";
      }

      const lines = reports.slice(0, 10).map(
        (r, i) =>
          `${i + 1}. ${r.file} (score: ${r.score})\n   ${r.issues
            .slice(0, 3)
            .map((i) => `- [${i.severity}] ${i.type}: ${i.message}`)
            .join("\n   ")}`,
      );

      const resultText = `Performance Score: ${avgScore}/100\nCritical: ${critical}\nTotal Issues: ${totalIssues}\nFiles with Issues: ${reports.length}\n\nTop Issues:\n${lines.join("\n\n")}`;

      ctx.onXmlComplete(
        `<dyad-perf-audit ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-perf-audit>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to audit performance: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
