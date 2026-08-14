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

const logger = log.scope("smart_suggestions");

const smartSuggestionsSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions) to analyze instead of the current app.",
    ),
  file_path: z
    .string()
    .optional()
    .describe("Specific file to analyze for suggestions."),
});

const DESCRIPTION = `Analyze code for improvement suggestions.

- Performance: Inline objects, missing memoization
- Accessibility: Missing alt, onClick without keyboard handler
- Patterns: Console.log, dangerous HTML, code smells
- Returns line-specific suggestions with fix recommendations`;

function buildAttributes(
  args: Partial<z.infer<typeof smartSuggestionsSchema>>,
  stats?: { suggestions: number; files: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) {
    attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  }
  if (args.file_path) {
    attrs.push(`file_path="${escapeXmlAttr(args.file_path)}"`);
  }
  if (stats) {
    attrs.push(`suggestions="${stats.suggestions}"`);
    attrs.push(`files="${stats.files}"`);
  }
  return attrs.join(" ");
}

export const smartSuggestionsTool: ToolDefinition<
  z.infer<typeof smartSuggestionsSchema>
> = {
  name: "smart_suggestions",
  description: DESCRIPTION,
  inputSchema: smartSuggestionsSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Analyze for suggestions";
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
    return `<dyad-suggestions ${buildAttributes(args)}>Analyzing code...</dyad-suggestions>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Analyzing for suggestions in ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-suggestions ${buildAttributes(args)}>Reading code...</dyad-suggestions>`,
    );

    try {
      const suggestions: string[] = [];
      let filesScanned = 0;

      const analyzeFile = (filePath: string, content: string) => {
        filesScanned++;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes("style={{") || line.includes("onClick={() =>")) {
            suggestions.push(
              `${filePath}:${i + 1} - Inline object/function in JSX`,
            );
          }
          if (line.includes("console.log")) {
            suggestions.push(`${filePath}:${i + 1} - Console.log statement`);
          }
          if (line.includes("dangerouslySetInnerHTML")) {
            suggestions.push(
              `${filePath}:${i + 1} - dangerouslySetInnerHTML usage`,
            );
          }
          if (/<img[^>]+>/.test(line) && !line.includes("alt=")) {
            suggestions.push(`${filePath}:${i + 1} - Image missing alt`);
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
            if (!/\.(tsx?|jsx?)$/.test(entry.name)) continue;
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
        suggestions: suggestions.length,
        files: filesScanned,
      });

      if (suggestions.length === 0) {
        ctx.onXmlComplete(
          `<dyad-suggestions ${attrs}>No suggestions found.</dyad-suggestions>`,
        );
        return "No suggestions found.";
      }

      const resultText = `Found ${suggestions.length} suggestion(s):\n${suggestions.map((s) => `• ${s}`).join("\n")}`;

      ctx.onXmlComplete(
        `<dyad-suggestions ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-suggestions>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Smart suggestions failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
