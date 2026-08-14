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

const logger = log.scope("color_contrast");

const colorContrastSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions) to analyze instead of the current app.",
    ),
  file_path: z
    .string()
    .optional()
    .describe("Specific file to analyze for color patterns."),
});

const DESCRIPTION = `Analyze color usage patterns in code.

- Finds hardcoded colors
- Detects inline styles with colors
- Identifies color variable usage
- Returns color analysis`;

function buildAttributes(
  args: Partial<z.infer<typeof colorContrastSchema>>,
  stats?: { colors: number; files: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) {
    attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  }
  if (args.file_path) {
    attrs.push(`file_path="${escapeXmlAttr(args.file_path)}"`);
  }
  if (stats) {
    attrs.push(`colors="${stats.colors}"`);
    attrs.push(`files="${stats.files}"`);
  }
  return attrs.join(" ");
}

export const colorContrastTool: ToolDefinition<
  z.infer<typeof colorContrastSchema>
> = {
  name: "color_contrast",
  description: DESCRIPTION,
  inputSchema: colorContrastSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Analyze colors";
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
    return `<dyad-color-contrast ${buildAttributes(args)}>Analyzing colors...</dyad-color-contrast>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Analyzing colors in ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-color-contrast ${buildAttributes(args)}>Reading styles...</dyad-color-contrast>`,
    );

    try {
      const colors: string[] = [];

      const analyzeFile = (filePath: string, content: string) => {
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const hexMatch = line.match(/#[0-9a-fA-F]{3,8}/g);
          hexMatch?.forEach((hex) => {
            colors.push(`${filePath}:${i + 1} - ${hex} (hex)`);
          });
          const rgbMatch = line.match(/rgb\([^)]+\)/g);
          rgbMatch?.forEach((rgb) => {
            colors.push(`${filePath}:${i + 1} - ${rgb} (rgb)`);
          });
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
        colors: colors.length,
        files: 1,
      });

      if (colors.length === 0) {
        ctx.onXmlComplete(
          `<dyad-color-contrast ${attrs}>No colors found.</dyad-color-contrast>`,
        );
        return "No colors found.";
      }

      const resultText = `Found ${colors.length} color usage(s):\n${colors
        .slice(0, 20)
        .map((c) => `• ${c}`)
        .join("\n")}`;

      ctx.onXmlComplete(
        `<dyad-color-contrast ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-color-contrast>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Color analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
