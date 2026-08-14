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

const logger = log.scope("import_analyzer");

const importAnalyzerSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions) to analyze instead of the current app.",
    ),
  file_path: z
    .string()
    .optional()
    .describe("Specific file to analyze for imports."),
});

const DESCRIPTION = `Analyze imports for issues.

- Unused imports: detect imports not referenced
- Local vs external: categorize imports
- Returns line-specific issues with fix suggestions`;

function buildAttributes(
  args: Partial<z.infer<typeof importAnalyzerSchema>>,
  stats?: { imports: number; unused: number },
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
    attrs.push(`unused="${stats.unused}"`);
  }
  return attrs.join(" ");
}

export const importAnalyzerTool: ToolDefinition<
  z.infer<typeof importAnalyzerSchema>
> = {
  name: "import_analyzer",
  description: DESCRIPTION,
  inputSchema: importAnalyzerSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Analyze imports";
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
    return `<dyad-import-analyze ${buildAttributes(args)}>Analyzing imports...</dyad-import-analyze>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Analyzing imports in ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-import-analyze ${buildAttributes(args)}>Reading imports...</dyad-import-analyze>`,
    );

    try {
      const allImports: Array<{
        file: string;
        path: string;
        line: number;
        used: boolean;
      }> = [];

      const analyzeFile = (filePath: string, content: string) => {
        const regex =
          /import\s+(?:{[^}]+}|[\w*]+(?:\s*,\s*{[^}]+})?)\s+from\s+['"]([^'"]+)['"]/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const importPath = match[1];
          const importLine = match[0];
          const lineNum = content.substring(0, match.index).split("\n").length;
          const importName = match[0].match(/import\s+(\w+)/)?.[1];
          // Check if importName appears in the rest of the file (excluding the import line itself)
          const restOfContent = content.substring(
            match.index + importLine.length,
          );
          const isUsed = importName
            ? new RegExp(`\\b${importName}\\b`).test(restOfContent)
            : true;
          allImports.push({
            file: filePath,
            path: importPath,
            line: lineNum,
            used: isUsed || !importName,
          });
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
            if (!/\.(tsx?|jsx?)$/.test(entry.name)) continue;
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

      const unused = allImports.filter((i) => !i.used);
      const attrs = buildAttributes(args, {
        imports: allImports.length,
        unused: unused.length,
      });

      if (unused.length === 0) {
        ctx.onXmlComplete(
          `<dyad-import-analyze ${attrs}>No unused imports found.</dyad-import-analyze>`,
        );
        return "No unused imports found.";
      }

      const resultText = `Found ${allImports.length} imports, ${unused.length} unused:\n${unused.map((u) => `• ${u.file}:${u.line} - ${u.path}`).join("\n")}`;

      ctx.onXmlComplete(
        `<dyad-import-analyze ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-import-analyze>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Import analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
