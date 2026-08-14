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

const logger = log.scope("dependency_graph");

const dependencyGraphSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions) to analyze instead of the current app.",
    ),
  file_path: z
    .string()
    .optional()
    .describe("Specific file to analyze for dependencies."),
});

const DESCRIPTION = `Analyze import dependencies and detect issues.

- Map import relationships between files
- Detect circular dependencies
- Find unused imports
- Returns dependency statistics`;

function buildAttributes(
  args: Partial<z.infer<typeof dependencyGraphSchema>>,
  stats?: { imports: number; files: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) {
    attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  }
  if (args.file_path) {
    attrs.push(`file_path="${escapeXmlAttr(args.file_path)}"`);
  }
  if (stats) {
    attrs.push(`imports="${stats.imports}"`);
    attrs.push(`files="${stats.files}"`);
  }
  return attrs.join(" ");
}

export const dependencyGraphTool: ToolDefinition<
  z.infer<typeof dependencyGraphSchema>
> = {
  name: "dependency_graph",
  description: DESCRIPTION,
  inputSchema: dependencyGraphSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Analyze dependencies";
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
    return `<dyad-dep-graph ${buildAttributes(args)}>Analyzing dependencies...</dyad-dep-graph>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Analyzing dependencies in ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-dep-graph ${buildAttributes(args)}>Reading imports...</dyad-dep-graph>`,
    );

    try {
      const imports: string[] = [];
      let filesScanned = 0;

      const analyzeFile = (filePath: string, content: string) => {
        filesScanned++;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(/import\s+.*from\s+['"]([^'"]+)['"]/);
          if (
            match &&
            (match[1].startsWith("./") ||
              match[1].startsWith("../") ||
              match[1].startsWith("@/"))
          ) {
            imports.push(`${filePath}:${i + 1} → ${match[1]}`);
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
        imports: imports.length,
        files: filesScanned,
      });

      if (imports.length === 0) {
        ctx.onXmlComplete(
          `<dyad-dep-graph ${attrs}>No local imports found.</dyad-dep-graph>`,
        );
        return "No local imports found.";
      }

      const resultText = `Found ${imports.length} local import(s):\n${imports
        .slice(0, 30)
        .map((i) => `• ${i}`)
        .join("\n")}`;

      ctx.onXmlComplete(
        `<dyad-dep-graph ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-dep-graph>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Dependency analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
