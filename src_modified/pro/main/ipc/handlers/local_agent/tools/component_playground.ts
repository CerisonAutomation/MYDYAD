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

const logger = log.scope("component_playground");

const componentPlaygroundSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions) to analyze instead of the current app.",
    ),
  file_path: z
    .string()
    .optional()
    .describe("Specific file to analyze for components."),
});

const DESCRIPTION = `Analyze React component structure.

- Detects component definitions
- Finds props and state patterns
- Identifies component hierarchy
- Returns component analysis`;

function buildAttributes(
  args: Partial<z.infer<typeof componentPlaygroundSchema>>,
  stats?: { components: number; files: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) {
    attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  }
  if (args.file_path) {
    attrs.push(`file_path="${escapeXmlAttr(args.file_path)}"`);
  }
  if (stats) {
    attrs.push(`components="${stats.components}"`);
    attrs.push(`files="${stats.files}"`);
  }
  return attrs.join(" ");
}

export const componentPlaygroundTool: ToolDefinition<
  z.infer<typeof componentPlaygroundSchema>
> = {
  name: "component_playground",
  description: DESCRIPTION,
  inputSchema: componentPlaygroundSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Analyze components";
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
    return `<dyad-playground ${buildAttributes(args)}>Analyzing components...</dyad-playground>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Analyzing components in ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-playground ${buildAttributes(args)}>Reading components...</dyad-playground>`,
    );

    try {
      const components: string[] = [];

      const analyzeFile = (filePath: string, content: string) => {
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(
            /(?:export\s+)?(?:const|function)\s+(\w+)\s*(?::\s*React\.FC)?.*=/,
          );
          if (match && match[1][0] === match[1][0].toUpperCase()) {
            const hooks: string[] = [];
            if (content.includes("useState")) hooks.push("useState");
            if (content.includes("useEffect")) hooks.push("useEffect");
            if (content.includes("useContext")) hooks.push("useContext");
            if (content.includes("useReducer")) hooks.push("useReducer");
            components.push(
              `${filePath}:${i + 1} - ${match[1]} (${hooks.length > 0 ? hooks.join(", ") : "no hooks"})`,
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
        components: components.length,
        files: 1,
      });

      if (components.length === 0) {
        ctx.onXmlComplete(
          `<dyad-playground ${attrs}>No components found.</dyad-playground>`,
        );
        return "No components found.";
      }

      const resultText = `Found ${components.length} component(s):\n${components.map((c) => `• ${c}`).join("\n")}`;

      ctx.onXmlComplete(
        `<dyad-playground ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-playground>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Component analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
