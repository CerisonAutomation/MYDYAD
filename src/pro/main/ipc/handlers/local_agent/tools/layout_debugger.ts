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

const logger = log.scope("layout_debugger");

const layoutDebuggerSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions) to analyze instead of the current app.",
    ),
  file_path: z
    .string()
    .optional()
    .describe("Specific file to analyze for layout issues."),
});

const DESCRIPTION = `Analyze CSS layout patterns in code.

- box-model: Margin/padding analysis
- flex: Flexbox patterns
- grid: CSS grid patterns
- spacing: Gap and spacing analysis
- all: Everything`;

function buildAttributes(
  args: Partial<z.infer<typeof layoutDebuggerSchema>>,
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

export const layoutDebuggerTool: ToolDefinition<
  z.infer<typeof layoutDebuggerSchema>
> = {
  name: "layout_debugger",
  description: DESCRIPTION,
  inputSchema: layoutDebuggerSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Debug layout patterns";
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
    return `<dyad-layout-debug ${buildAttributes(args)}>Analyzing layout...</dyad-layout-debug>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Analyzing layout in ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-layout-debug ${buildAttributes(args)}>Reading styles...</dyad-layout-debug>`,
    );

    try {
      const issues: string[] = [];
      let filesScanned = 0;

      const analyzeFile = (filePath: string, content: string) => {
        filesScanned++;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (/display:\s*flex/.test(line) && !/flex-direction/.test(line)) {
            issues.push(
              `${filePath}:${i + 1} - Flex container without explicit direction`,
            );
          }
          if (/display:\s*grid/.test(line) && !/grid-template/.test(line)) {
            issues.push(
              `${filePath}:${i + 1} - Grid container without template`,
            );
          }
          if (/margin:\s*\d+px\s+\d+px\s+\d+px\s+\d+px/.test(line)) {
            issues.push(`${filePath}:${i + 1} - Verbose margin shorthand`);
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
        files: filesScanned,
      });

      if (issues.length === 0) {
        ctx.onXmlComplete(
          `<dyad-layout-debug ${attrs}>No layout issues found.</dyad-layout-debug>`,
        );
        return "No layout issues found.";
      }

      const resultText = `Found ${issues.length} layout issue(s):\n${issues.map((i) => `• ${i}`).join("\n")}`;

      ctx.onXmlComplete(
        `<dyad-layout-debug ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-layout-debug>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Layout debug failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
