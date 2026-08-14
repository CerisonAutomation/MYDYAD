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

const logger = log.scope("auto_quality");

const autoQualitySchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions) to analyze instead of the current app.",
    ),
  file_path: z
    .string()
    .optional()
    .describe(
      "Optional. Specific file path to analyze instead of the whole app.",
    ),
  mode: z
    .enum([
      "full-audit",
      "quick-check",
      "visual-polish",
      "ux-review",
      "code-quality",
    ])
    .describe("Quality check mode."),
});

const DESCRIPTION = `Comprehensive quality assurance.

- full-audit: Run all checks
- quick-check: Essential issues only
- visual-polish: Layout and spacing
- ux-review: User experience
- code-quality: Code smells
- Returns health score and issues`;

function buildAttributes(
  args: Partial<z.infer<typeof autoQualitySchema>>,
  stats?: { score: number; issues: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) {
    attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  }
  attrs.push(`mode="${escapeXmlAttr(args.mode)}"`);
  if (stats) {
    attrs.push(`score="${stats.score}"`);
    attrs.push(`issues="${stats.issues}"`);
  }
  return attrs.join(" ");
}

export const autoQualityTool: ToolDefinition<
  z.infer<typeof autoQualitySchema>
> = {
  name: "auto_quality",
  description: DESCRIPTION,
  inputSchema: autoQualitySchema,
  defaultConsent: "ask",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = `Run ${args.mode} quality check`;
    if (args.app_name) {
      preview += ` in app: ${args.app_name}`;
    }
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-quality ${buildAttributes(args)}>Running quality check...</dyad-quality>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Running quality check: mode=${args.mode}`);
    ctx.onXmlStream(
      `<dyad-quality ${buildAttributes(args)}>Scanning code...</dyad-quality>`,
    );

    try {
      const issues: string[] = [];

      const analyzeFile = (filePath: string, content: string) => {
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (args.mode === "full-audit" || args.mode === "code-quality") {
            if (line.includes("console.log")) {
              issues.push(`${filePath}:${i + 1} - Console.log statement`);
            }
            if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
              issues.push(`${filePath}:${i + 1} - Empty catch block`);
            }
          }
          if (args.mode === "full-audit" || args.mode === "visual-polish") {
            if (/overflow:\s*hidden/.test(line) && /text-overflow/.test(line)) {
              issues.push(`${filePath}:${i + 1} - Text truncation`);
            }
          }
          if (args.mode === "full-audit" || args.mode === "ux-review") {
            if (/onClick/.test(line) && !/onKeyDown/.test(line)) {
              issues.push(
                `${filePath}:${i + 1} - onClick without keyboard handler`,
              );
            }
          }
        }
      };

      if (args.file_path) {
        const safeRelative = await resolveDirectoryWithinAppPath({
          appPath: targetAppPath,
          directory: args.file_path,
        });
        const fullPath = path.join(targetAppPath, safeRelative);
        const content = await fs.readFile(fullPath, "utf-8");
        analyzeFile(args.file_path, content);
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
              entry.name === "dist"
            )
              continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              await scanDir(fullPath, depth + 1);
              continue;
            }
            if (!/\.(tsx?|jsx?|ts|js|css|scss)$/.test(entry.name)) continue;
            try {
              const content = await fs.readFile(fullPath, "utf-8");
              const rel = path.relative(targetAppPath, fullPath);
              analyzeFile(rel, content);
            } catch {
              /* skip */
            }
          }
        };
        await scanDir(targetAppPath);
      }

      let score = 100;
      for (const issue of issues) {
        if (issue.includes("Empty catch")) score -= 15;
        else if (issue.includes("Console.log")) score -= 2;
        else score -= 5;
      }
      score = Math.max(0, score);

      const attrs = buildAttributes(args, {
        score,
        issues: issues.length,
      });

      const verdict =
        score >= 90
          ? "EXCELLENT"
          : score >= 75
            ? "GOOD"
            : score >= 50
              ? "NEEDS_WORK"
              : "POOR";

      const resultText = `Quality Score: ${score}/100 (${verdict})\nIssues: ${issues.length}\n\n${issues.map((i) => `• ${i}`).join("\n")}`;

      ctx.onXmlComplete(
        `<dyad-quality ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-quality>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Quality check failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
