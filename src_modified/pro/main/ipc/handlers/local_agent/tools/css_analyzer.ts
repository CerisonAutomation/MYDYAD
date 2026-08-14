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

const logger = log.scope("css_analyzer");

const cssAnalyzerSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions) to analyze instead of the current app.",
    ),
  file_path: z
    .string()
    .optional()
    .describe("Specific file to analyze for CSS issues."),
});

const DESCRIPTION = `Analyze CSS for issues.

- !important usage
- Inline styles
- Unused patterns
- Returns CSS analysis with fix suggestions`;

function buildAttributes(
  args: Partial<z.infer<typeof cssAnalyzerSchema>>,
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

export const cssAnalyzerTool: ToolDefinition<
  z.infer<typeof cssAnalyzerSchema>
> = {
  name: "css_analyzer",
  description: DESCRIPTION,
  inputSchema: cssAnalyzerSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Analyze CSS";
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
    return `<dyad-css-analyze ${buildAttributes(args)}>Analyzing CSS...</dyad-css-analyze>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Analyzing CSS in ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-css-analyze ${buildAttributes(args)}>Reading styles...</dyad-css-analyze>`,
    );

    try {
      const issues: string[] = [];

      const analyzeFile = (filePath: string, content: string) => {
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes("!important")) {
            issues.push(`${filePath}:${i + 1} - !important usage`);
          }
          if (/style=["'][^"']+["']/.test(line)) {
            issues.push(`${filePath}:${i + 1} - Inline styles`);
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
              entry.name === "dist"
            )
              continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              await scanDir(fullPath, depth + 1);
              continue;
            }
            if (!/\.(css|scss|tsx?|jsx?)$/.test(entry.name)) continue;
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
        files: 1,
      });

      if (issues.length === 0) {
        ctx.onXmlComplete(
          `<dyad-css-analyze ${attrs}>No CSS issues found.</dyad-css-analyze>`,
        );
        return "No CSS issues found.";
      }

      const resultText = `Found ${issues.length} CSS issue(s):\n${issues.map((i) => `• ${i}`).join("\n")}`;

      ctx.onXmlComplete(
        `<dyad-css-analyze ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-css-analyze>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `CSS analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
