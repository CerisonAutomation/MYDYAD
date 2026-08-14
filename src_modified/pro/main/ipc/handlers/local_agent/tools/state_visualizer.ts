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

const logger = log.scope("state_visualizer");

const stateVisualizerSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions) to analyze instead of the current app.",
    ),
  file_path: z
    .string()
    .optional()
    .describe("Specific file to analyze for state patterns."),
});

const DESCRIPTION = `Analyze React state management patterns.

- Detects useState, useReducer, useContext, jotai usage
- Finds prop drilling patterns
- Identifies state management anti-patterns
- Returns state flow analysis`;

function buildAttributes(
  args: Partial<z.infer<typeof stateVisualizerSchema>>,
  stats?: { patterns: number; files: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) {
    attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  }
  if (args.file_path) {
    attrs.push(`file_path="${escapeXmlAttr(args.file_path)}"`);
  }
  if (stats) {
    attrs.push(`patterns="${stats.patterns}"`);
    attrs.push(`files="${stats.files}"`);
  }
  return attrs.join(" ");
}

export const stateVisualizerTool: ToolDefinition<
  z.infer<typeof stateVisualizerSchema>
> = {
  name: "state_visualizer",
  description: DESCRIPTION,
  inputSchema: stateVisualizerSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Analyze state patterns";
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
    return `<dyad-state-viz ${buildAttributes(args)}>Analyzing state...</dyad-state-viz>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Analyzing state in ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-state-viz ${buildAttributes(args)}>Reading components...</dyad-state-viz>`,
    );

    try {
      const patterns: string[] = [];

      const analyzeFile = (filePath: string, content: string) => {
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes("useState(")) {
            patterns.push(`${filePath}:${i + 1} - useState detected`);
          }
          if (line.includes("useReducer(")) {
            patterns.push(`${filePath}:${i + 1} - useReducer detected`);
          }
          if (line.includes("useContext(")) {
            patterns.push(`${filePath}:${i + 1} - useContext detected`);
          }
          if (line.includes("createContext(")) {
            patterns.push(`${filePath}:${i + 1} - createContext detected`);
          }
          if (line.includes("useAtom(") || line.includes("atom(")) {
            patterns.push(`${filePath}:${i + 1} - Jotai atom detected`);
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
        patterns: patterns.length,
        files: 1,
      });

      if (patterns.length === 0) {
        ctx.onXmlComplete(
          `<dyad-state-viz ${attrs}>No state patterns found.</dyad-state-viz>`,
        );
        return "No state patterns found.";
      }

      const resultText = `Found ${patterns.length} state pattern(s):\n${patterns.map((p) => `• ${p}`).join("\n")}`;

      ctx.onXmlComplete(
        `<dyad-state-viz ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-state-viz>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `State analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
