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

const logger = log.scope("visual_bug_detector");

const visualBugDetectorSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
  file_path: z
    .string()
    .optional()
    .describe("Specific file to scan. Omit to scan all files."),
});

const DESCRIPTION = `Detect visual bugs in the UI: overflow issues, missing images, broken layouts, text clipping, z-index conflicts.

- overflow: Content overflow and clipping patterns
- images: Broken or missing image references
- layout: Flex/grid layout issues
- Returns issues with file:line references and fix suggestions`;

function buildAttributes(
  args: Partial<z.infer<typeof visualBugDetectorSchema>>,
  stats?: { bugs: number; files: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) {
    attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  }
  if (args.file_path) {
    attrs.push(`file_path="${escapeXmlAttr(args.file_path)}"`);
  }
  if (stats) {
    attrs.push(`bugs="${stats.bugs}"`);
    attrs.push(`files="${stats.files}"`);
  }
  return attrs.join(" ");
}

export const visualBugDetectorTool: ToolDefinition<
  z.infer<typeof visualBugDetectorSchema>
> = {
  name: "visual_bug_detector",
  description: DESCRIPTION,
  inputSchema: visualBugDetectorSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Detect visual bugs";
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
    return `<dyad-visual-bug-detector ${buildAttributes(args)}>Scanning for visual bugs...</dyad-visual-bug-detector>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Scanning for visual bugs in ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-visual-bug-detector ${buildAttributes(args)}>Scanning files...</dyad-visual-bug-detector>`,
    );

    try {
      const bugs: string[] = [];
      let filesScanned = 0;

      const analyzeFile = (filePath: string, content: string) => {
        filesScanned++;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (
            /overflow\s*:\s*hidden/.test(line) &&
            /position\s*:\s*(absolute|fixed)/.test(line)
          ) {
            bugs.push(
              `${filePath}:${i + 1} - Potential overflow with positioned element`,
            );
          }
          if (/z-index\s*:\s*(9{4,}|9999)/.test(line)) {
            bugs.push(`${filePath}:${i + 1} - Extremely high z-index value`);
          }
          if (/<img[^>]+src\s*=\s*["']\s*["']/.test(line)) {
            bugs.push(`${filePath}:${i + 1} - Empty image src attribute`);
          }
          if (
            /width\s*:\s*100vw/.test(line) &&
            !/overflow/.test(lines.slice(Math.max(0, i - 3), i + 4).join(" "))
          ) {
            bugs.push(`${filePath}:${i + 1} - 100vw without overflow handling`);
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
            if (!/\.(tsx?|jsx?|css|scss)$/.test(entry.name)) continue;
            try {
              const content = await fs.readFile(fullPath, "utf-8");
              const rel = path.relative(targetAppPath, fullPath);
              analyzeFile(rel, content);
            } catch {
              /* skip unreadable */
            }
          }
        };
        await scanDir(targetAppPath);
      }

      const attrs = buildAttributes(args, {
        bugs: bugs.length,
        files: filesScanned,
      });

      if (bugs.length === 0) {
        ctx.onXmlComplete(
          `<dyad-visual-bug-detector ${attrs}>No visual bugs detected.</dyad-visual-bug-detector>`,
        );
        return "No visual bugs detected.";
      }

      const resultText = `Found ${bugs.length} potential visual bug(s):\n${bugs.map((b) => `• ${b}`).join("\n")}`;

      ctx.onXmlComplete(
        `<dyad-visual-bug-detector ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-visual-bug-detector>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Visual bug detection failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
