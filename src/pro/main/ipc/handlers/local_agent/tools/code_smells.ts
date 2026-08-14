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

const logger = log.scope("code_smells");

const DEFAULT_MAX_FILES = 500;
const MAX_MAX_FILES = 5000;

const codeSmellsSchema = z.object({
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

const DESCRIPTION = `Detect 20+ code smells with severity, confidence scores, and auto-fix suggestions.

- Returns health score (0-100) and ranked list of smells
- Detects: God Object, Long Method, Deep Nesting, Magic Numbers, Dead Code, Complex Conditionals, Duplicate Code, Long Parameter Lists
- Use for code quality audits and refactoring prioritization`;

interface CodeSmell {
  smell: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  line: number;
  message: string;
}

interface SmellReport {
  file: string;
  score: number;
  smells: CodeSmell[];
}

const SMELL_PATTERNS: Array<{
  pattern: RegExp;
  smell: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  message: string;
}> = [
  {
    pattern: /.{8000,}/s,
    smell: "god_object",
    severity: "high",
    confidence: 0.85,
    message: "File exceeds 8000 characters - consider splitting into modules",
  },
  {
    pattern: /(?:^|\n)(?:[ \t]{12,}){5,}/gm,
    smell: "deep_nesting",
    severity: "high",
    confidence: 0.8,
    message: "Deep nesting detected (>5 levels) - extract functions",
  },
  {
    pattern: /(?:function|=>)\s*\{[^}]{3000,}/gs,
    smell: "long_method",
    severity: "high",
    confidence: 0.8,
    message: "Function exceeds 3000 characters - split into smaller functions",
  },
  {
    pattern: /[^a-zA-Z0-9_](?:[2-9]\d{2,}|[1-9]\d{3,})(?![a-zA-Z0-9_])/g,
    smell: "magic_number",
    severity: "medium",
    confidence: 0.7,
    message: "Magic number detected - extract to named constant",
  },
  {
    pattern: /function\s+\w+\s*\([^)]{6,},[^)]*\)/g,
    smell: "long_parameter_list",
    severity: "medium",
    confidence: 0.85,
    message: "Function has many parameters - use options object",
  },
  {
    pattern: /console\.(log|debug|info)\s*\(/g,
    smell: "debug_code",
    severity: "low",
    confidence: 0.95,
    message: "Debug statement left in code - remove before production",
  },
  {
    pattern: /\/\/\s*(TODO|FIXME|HACK|XXX)/gi,
    smell: "todo_comment",
    severity: "low",
    confidence: 0.98,
    message: "TODO/FIXME comment found - address or create issue",
  },
  {
    pattern: /catch\s*\([^)]*\)\s*\{\s*\}/g,
    smell: "empty_catch",
    severity: "critical",
    confidence: 0.95,
    message: "Empty catch block - errors silently swallowed",
  },
  {
    pattern: /\bvar\s+/g,
    smell: "var_usage",
    severity: "low",
    confidence: 0.98,
    message: "Use const/let instead of var for block scoping",
  },
  {
    pattern: /[^=!]==(?!=)/g,
    smell: "loose_equality",
    severity: "medium",
    confidence: 0.9,
    message: "Use strict equality (===) instead of loose equality (==)",
  },
];

function analyzeFile(filePath: string, content: string): SmellReport {
  const smells: CodeSmell[] = [];
  const lines = content.split("\n");

  for (const {
    pattern,
    smell,
    severity,
    confidence,
    message,
  } of SMELL_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split("\n").length;
      if (lineNum <= lines.length) {
        smells.push({ smell, severity, confidence, line: lineNum, message });
      }
    }
  }

  let score = 100;
  for (const s of smells) {
    switch (s.severity) {
      case "critical":
        score -= 15;
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

  return { file: filePath, score: Math.max(0, score), smells };
}

function buildAttributes(
  args: Partial<z.infer<typeof codeSmellsSchema>>,
  stats?: { health: number; smells: number; files: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) {
    attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  }
  if (stats) {
    attrs.push(`health="${stats.health}"`);
    attrs.push(`smells="${stats.smells}"`);
    attrs.push(`files="${stats.files}"`);
  }
  return attrs.join(" ");
}

export const codeSmellsTool: ToolDefinition<z.infer<typeof codeSmellsSchema>> =
  {
    name: "code_smells",
    description: DESCRIPTION,
    inputSchema: codeSmellsSchema,
    defaultConsent: "always",
    modifiesState: false,

    isEnabled: (_ctx: AgentContext) => true,

    getConsentPreview: (args) => {
      let preview = "Analyze code smells";
      if (args.app_name) {
        preview += ` in app: ${args.app_name}`;
      }
      return preview;
    },

    buildXml: (args, isComplete) => {
      if (isComplete) return undefined;
      return `<dyad-code-smells ${buildAttributes(args)}>Scanning files...</dyad-code-smells>`;
    },

    execute: async (args, ctx: AgentContext) => {
      const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
      const maxFiles = Math.min(
        args.max_files ?? DEFAULT_MAX_FILES,
        MAX_MAX_FILES,
      );

      logger.log(`Analyzing code smells in ${targetAppPath}`);
      ctx.onXmlStream(
        `<dyad-code-smells ${buildAttributes(args)}>Scanning ${maxFiles} files...</dyad-code-smells>`,
      );

      try {
        const files = await walkDirectory(targetAppPath, {
          maxFiles,
          filePattern: /\.(ts|tsx|js|jsx|py|go|rs|java|rb|php)$/,
        });
        const reports: SmellReport[] = [];

        for (const file of files) {
          try {
            const content = await fs.readFile(file, "utf-8");
            const relativePath = path.relative(targetAppPath, file);
            const report = analyzeFile(relativePath, content);
            if (report.smells.length > 0) {
              reports.push(report);
            }
          } catch {
            // Skip unreadable files
          }
        }

        reports.sort((a, b) => a.score - b.score);
        const totalSmells = reports.reduce(
          (sum, r) => sum + r.smells.length,
          0,
        );
        const avgScore =
          reports.length > 0
            ? Math.round(
                reports.reduce((sum, r) => sum + r.score, 0) / reports.length,
              )
            : 100;

        const attrs = buildAttributes(args, {
          health: avgScore,
          smells: totalSmells,
          files: reports.length,
        });

        if (reports.length === 0) {
          ctx.onXmlComplete(
            `<dyad-code-smells ${attrs}>No code smells detected.</dyad-code-smells>`,
          );
          return "No code smells detected.";
        }

        const lines = reports.slice(0, 15).map(
          (r, i) =>
            `${i + 1}. ${r.file} (score: ${r.score})\n   ${r.smells
              .slice(0, 3)
              .map((s) => `- [${s.severity}] ${s.smell}: ${s.message}`)
              .join("\n   ")}`,
        );

        const resultText = `Health Score: ${avgScore}/100\nTotal Smells: ${totalSmells}\nFiles Analyzed: ${reports.length}\n\nTop Issues:\n${lines.join("\n\n")}`;

        ctx.onXmlComplete(
          `<dyad-code-smells ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-code-smells>`,
        );
        return resultText;
      } catch (error) {
        if (error instanceof DyadError) throw error;
        throw new DyadError(
          `Failed to analyze code smells: ${error instanceof Error ? error.message : String(error)}`,
          DyadErrorKind.Unknown,
        );
      }
    },
  };
