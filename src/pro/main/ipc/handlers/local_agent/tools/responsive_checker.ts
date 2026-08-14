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

const logger = log.scope("responsive_checker");

const responsiveCheckerSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions) to analyze instead of the current app.",
    ),
  file_path: z
    .string()
    .optional()
    .describe("Specific file to analyze for responsive issues."),
});

const DESCRIPTION = `Check CSS media queries, responsive breakpoints, and mobile-first patterns.

- Fixed widths without max-width fallbacks
- Missing media query breakpoints
- Non-responsive layout patterns
- Returns issues with fix suggestions`;

function buildAttributes(
  args: Partial<z.infer<typeof responsiveCheckerSchema>>,
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

export const responsiveCheckerTool: ToolDefinition<
  z.infer<typeof responsiveCheckerSchema>
> = {
  name: "responsive_checker",
  description: DESCRIPTION,
  inputSchema: responsiveCheckerSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Check responsive design patterns";
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
    return `<dyad-responsive-checker ${buildAttributes(args)}>Checking responsive design...</dyad-responsive-checker>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Checking responsive patterns in ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-responsive-checker ${buildAttributes(args)}>Scanning files...</dyad-responsive-checker>`,
    );

    try {
      const issues: string[] = [];
      let filesScanned = 0;

      const analyzeFile = (filePath: string, content: string) => {
        filesScanned++;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (/width:\s*\d+px/.test(line) && !/max-width/.test(line)) {
            issues.push(
              `${filePath}:${i + 1} - Fixed pixel width without max-width fallback`,
            );
          }
          if (/overflow-x:\s*(scroll|auto)/.test(line)) {
            issues.push(`${filePath}:${i + 1} - Horizontal scroll detected`);
          }
          if (/float:\s*(left|right)/.test(line)) {
            issues.push(
              `${filePath}:${i + 1} - Float-based layout (consider flex/grid)`,
            );
          }
        }
        if (
          !/@media/.test(content) &&
          /width|padding|margin/.test(content) &&
          lines.length > 20
        ) {
          issues.push(
            `${filePath}:1 - No media queries found - likely not responsive`,
          );
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
            if (!/\.(css|scss|less|tsx?|jsx?|html)$/.test(entry.name)) continue;
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
          `<dyad-responsive-checker ${attrs}>No responsive issues found.</dyad-responsive-checker>`,
        );
        return "No responsive issues found.";
      }

      const resultText = `Found ${issues.length} responsive issue(s):\n${issues.map((i) => `• ${i}`).join("\n")}`;

      ctx.onXmlComplete(
        `<dyad-responsive-checker ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-responsive-checker>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Responsive check failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
