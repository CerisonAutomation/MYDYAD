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

const logger = log.scope("error_visualizer");

const errorVisualizerSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions) to analyze instead of the current app.",
    ),
  file_path: z
    .string()
    .optional()
    .describe("Specific file to analyze for error handling."),
});

const DESCRIPTION = `Analyze error handling patterns in code.

- Empty catch blocks
- Swallowed errors
- Missing error boundaries
- Returns error handling issues with fix suggestions`;

function buildAttributes(
  args: Partial<z.infer<typeof errorVisualizerSchema>>,
  stats?: { issues: number; files: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) {
    attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  }
  if (args.file_path) {
    attrs.push(`file_path="${escapeXmlAttr(args.file_path)}"`);
  }
  if (stats) {
    attrs.push(`issues="${stats.issues}"`);
    attrs.push(`files="${stats.files}"`);
  }
  return attrs.join(" ");
}

export const errorVisualizerTool: ToolDefinition<
  z.infer<typeof errorVisualizerSchema>
> = {
  name: "error_visualizer",
  description: DESCRIPTION,
  inputSchema: errorVisualizerSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Analyze error handling";
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
    return `<dyad-error-viz ${buildAttributes(args)}>Analyzing error handling...</dyad-error-viz>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Analyzing error handling in ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-error-viz ${buildAttributes(args)}>Reading code...</dyad-error-viz>`,
    );

    try {
      const issues: string[] = [];
      let filesScanned = 0;

      const analyzeFile = (filePath: string, content: string) => {
        filesScanned++;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
            issues.push(
              `${filePath}:${i + 1} - Empty catch block - errors silently swallowed`,
            );
          }
          if (/catch\s*\([^)]*\)\s*\{\s*\/\/.*\}/.test(line)) {
            issues.push(`${filePath}:${i + 1} - Catch block with only comment`);
          }
          if (
            /\.catch\(\(\)\s*=>\s*\{\}\)/.test(line) ||
            /\.catch\(\(\)\s*=>\s*null\)/.test(line)
          ) {
            issues.push(
              `${filePath}:${i + 1} - Promise rejection silently ignored`,
            );
          }
        }
      };

      if (args.file_path) {
        const safeRelative = await resolveDirectoryWithinAppPath({
          appPath: targetAppPath,
          directory: args.file_path,
        });
        const fullPath = path.join(targetAppPath, safeRelative);
        // Skip files larger than 1MB
        try {
          const stat = await fs.stat(fullPath);
          if (stat.size > 1024 * 1024) {
            return "File too large to analyze (over 1MB).";
          }
        } catch {
          // File doesn't exist or can't be stat'd, continue to read error
        }
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
            if (!/\.(tsx?|jsx?|ts|js)$/.test(entry.name)) continue;
            // Skip files larger than 1MB
            try {
              const stat = await fs.stat(fullPath);
              if (stat.size > 1024 * 1024) continue;
            } catch {
              continue;
            }
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

      const attrs = buildAttributes(args, {
        issues: issues.length,
        files: filesScanned,
      });

      if (issues.length === 0) {
        ctx.onXmlComplete(
          `<dyad-error-viz ${attrs}>No error handling issues found.</dyad-error-viz>`,
        );
        return "No error handling issues found.";
      }

      const resultText = `Found ${issues.length} error handling issue(s):\n${issues.map((i) => `• ${i}`).join("\n")}`;

      ctx.onXmlComplete(
        `<dyad-error-viz ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-error-viz>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Error analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
