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
import { resolveDirectoryWithinAppPath } from "./path_safety";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import log from "electron-log";

const logger = log.scope("smart_fix");

const smartFixSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions) to analyze instead of the current app.",
    ),
  file_path: z
    .string()
    .optional()
    .describe("Specific file to suggest fixes for."),
});

const DESCRIPTION = `Suggest fixes for detected code issues.

- accessibility: Add missing alt, lang, aria attributes
- performance: Optimize patterns
- layout: Fix layout issues
- cleanup: Remove dead code
- Returns suggested fixes (does not modify files)`;

function buildAttributes(
  args: Partial<z.infer<typeof smartFixSchema>>,
  stats?: { fixes: number; files: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) {
    attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  }
  if (args.file_path) {
    attrs.push(`file_path="${escapeXmlAttr(args.file_path)}"`);
  }
  if (stats) {
    attrs.push(`fixes="${stats.fixes}"`);
    attrs.push(`files="${stats.files}"`);
  }
  return attrs.join(" ");
}

export const smartFixTool: ToolDefinition<z.infer<typeof smartFixSchema>> = {
  name: "smart_fix",
  description: DESCRIPTION,
  inputSchema: smartFixSchema,
  defaultConsent: "ask",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Suggest fixes";
    if (args.app_name) {
      preview += ` in app: ${args.app_name}`;
    }
    if (args.file_path) {
      preview += ` in ${args.file_path}`;
    }
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-smart-fix ${buildAttributes(args)}>Generating fixes...</dyad-smart-fix>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
    logger.log(`Smart fix requested for ${args.app_name ?? "current app"}`);
    ctx.onXmlStream(
      `<dyad-smart-fix ${buildAttributes(args)}>Analyzing code...</dyad-smart-fix>`,
    );

    try {
      const issues = await analyzeForFixes(targetAppPath, args.file_path);
      const attrs = buildAttributes(args, {
        fixes: issues.length,
        files: new Set(issues.map((i) => i.file)).size,
      });

      let resultText: string;
      if (issues.length === 0) {
        resultText = "No fixable issues found in the analyzed scope.";
      } else {
        resultText = `Found ${issues.length} fixable issue(s):\n\n`;
        resultText += issues
          .map(
            (i) =>
              `• [${i.severity.toUpperCase()}] ${i.file}:${i.line}\n  ${i.issue}\n  ✏️  Fix: ${i.fix}`,
          )
          .join("\n\n");
        resultText += `\n\n💡 These are static-analysis suggestions — review each before applying. Use apply_patch to implement them.`;
      }

      ctx.onXmlComplete(
        `<dyad-smart-fix ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-smart-fix>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Smart fix failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};

interface FixSuggestion {
  file: string;
  line: number;
  severity: "high" | "medium" | "low";
  issue: string;
  fix: string;
}

/**
 * Line-oriented static analysis that produces concrete, actionable fixes.
 * Each check is deliberately conservative to avoid noisy suggestions.
 */
async function analyzeForFixes(
  appPath: string,
  filePathArg?: string,
): Promise<FixSuggestion[]> {
  const issues: FixSuggestion[] = [];

  const analyzeFile = (filePath: string, content: string) => {
    const lines = content.split("\n");
    const push = (
      line: number,
      severity: FixSuggestion["severity"],
      issue: string,
      fix: string,
    ) => issues.push({ file: filePath, line, severity, issue, fix });

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/console\.(log|debug)\s*\(/.test(line)) {
        push(
          i + 1,
          "low",
          "Debug console statement left in code",
          "Remove it, or replace with a structured logger (electron-log / pino) using log.debug()",
        );
      }
      if (/<img\b(?![^>]*\balt=)/.test(line)) {
        push(
          i + 1,
          "medium",
          "<img> without an alt attribute — screen readers cannot describe it",
          'Add alt="..." describing the image, or alt="" for decorative images',
        );
      }
      if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
        push(
          i + 1,
          "medium",
          "Empty catch block — errors are silently swallowed",
          "Log the error (log.error(err)) or rethrow after handling",
        );
      }
      if (/:\s*any\b/.test(line) && !/^\s*\/\//.test(line)) {
        push(
          i + 1,
          "medium",
          "`any` type used — bypasses type checking",
          "Replace with a precise type or `unknown` + narrowing",
        );
      }
      if (/\bvar\s+[a-zA-Z_$]/.test(line)) {
        push(
          i + 1,
          "low",
          "`var` declaration",
          "Use `const` (preferred) or `let`",
        );
      }
      if (/Math\.random\s*\(/.test(line)) {
        push(
          i + 1,
          "medium",
          "Math.random() used where an ID/token may be generated",
          "Use crypto.randomUUID() or crypto.randomBytes() for security-sensitive randomness",
        );
      }
      if (
        /fetch\s*\([^)]*\)\s*(?:\.then|;)\s*$/.test(line) &&
        !/AbortSignal/.test(line)
      ) {
        push(
          i + 1,
          "medium",
          "fetch() without timeout or AbortSignal — may hang indefinitely",
          "Add signal: AbortSignal.timeout(N) or a timeout wrapper",
        );
      }
      if (
        /new\s+Promise\s*\(\s*\(\s*resolve\s*,\s*reject\s*\)\s*=>/.test(line)
      ) {
        push(
          i + 1,
          "low",
          "Manual Promise constructor — prefer async/await",
          "Refactor to async/await for readability and error handling",
        );
      }
      if (
        /\.\.\.(?:args|props|rest)\b/.test(line) &&
        /function|=>/.test(line)
      ) {
        push(
          i + 1,
          "low",
          "Rest/spread in function params — consider explicit parameters",
          "Explicit parameters improve IDE support and documentation",
        );
      }
      if (/TODO|FIXME|HACK|XXX/.test(line)) {
        push(
          i + 1,
          "low",
          "TODO/FIXME marker",
          "Complete the task or track it in an issue tracker",
        );
      }
      if (/dangerouslySetInnerHTML/.test(line)) {
        push(
          i + 1,
          "high",
          "dangerouslySetInnerHTML — potential XSS if content is not sanitized",
          "Sanitize with DOMPurify before passing, or render via components",
        );
      }
      if (/onClick\s*=\{\s*\(\s*\)\s*=>/.test(line)) {
        push(
          i + 1,
          "low",
          "Inline arrow function in onClick — new reference each render",
          "Extract to a useCallback'd handler or component method",
        );
      }
      if (/fetch\s*\(/.test(line) && !/signal\s*:/.test(line)) {
        push(
          i + 1,
          "medium",
          "fetch() without a timeout/abort signal — can hang indefinitely",
          "Add an AbortController with a timeout and clear it in finally",
        );
      }
    }
  };

  if (filePathArg) {
    const safeRelative = await resolveDirectoryWithinAppPath({
      appPath,
      directory: filePathArg,
    });
    const fullPath = path.join(appPath, safeRelative);
    const content = await fs.readFile(fullPath, "utf-8");
    analyzeFile(filePathArg, content);
  } else {
    const scanDir = async (dir: string, depth = 0): Promise<void> => {
      if (depth > 8) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (
          entry.name.startsWith(".") ||
          entry.name === "node_modules" ||
          entry.name === ".dyad" ||
          entry.name === "dist" ||
          entry.name === ".next"
        )
          continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scanDir(fullPath, depth + 1);
          continue;
        }
        if (!/\.(tsx?|jsx?)$/.test(entry.name)) continue;
        try {
          const content = await fs.readFile(fullPath, "utf-8");
          analyzeFile(path.relative(appPath, fullPath), content);
        } catch {
          /* skip */
        }
      }
    };
    await scanDir(appPath);
  }

  // Rank: high first, then by line; cap at 25 so the reply stays focused.
  return issues
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 } as const;
      return rank[a.severity] - rank[b.severity] || a.line - b.line;
    })
    .slice(0, 25);
}
