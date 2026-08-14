/**
 * TypeScript AST Summary Tool
 *
 * Analyzes TypeScript/JavaScript code structure.
 */

import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { AgentContext, ToolDefinition } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const tsAstSummarySchema = z.object({
  app_name: z.string().optional().describe("App to analyze"),
  file_path: z.string().optional().describe("Specific file to analyze"),
  include_pattern: z.string().optional().describe("File pattern to include"),
});

type TsAstSummaryArgs = z.infer<typeof tsAstSummarySchema>;

interface TsModule {
  name: string;
  imports: string[];
  exports: string[];
  interfaces: Array<{
    name: string;
    properties: string[];
    methods: string[];
  }>;
  types: Array<{
    name: string;
    definition: string;
  }>;
  classes: Array<{
    name: string;
    extends: string;
    implements: string[];
    methods: string[];
    properties: string[];
  }>;
  functions: Array<{
    name: string;
    params: string[];
    returnType: string;
  }>;
}

export const tsAstSummaryTool: ToolDefinition<TsAstSummaryArgs> = {
  name: "ts_ast_summary",
  description: `Analyze TypeScript/JavaScript code structure.

Returns: Interfaces, types, classes, functions, imports, exports.

Use for: Code understanding, architecture review, API surface analysis.`,
  inputSchema: tsAstSummarySchema,
  defaultConsent: "always",
  modifiesState: false,
  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args: TsAstSummaryArgs) =>
    `Analyze TypeScript AST${args.file_path ? ` for ${args.file_path}` : ""}`,

  buildXml: (args: TsAstSummaryArgs, isComplete: boolean) => {
    if (isComplete) return undefined;
    return `<dyad-ts-ast app="${args.app_name || "current"}">Analyzing...</dyad-ts-ast>`;
  },

  execute: async (args: TsAstSummaryArgs, ctx: AgentContext) => {
    try {
      const appPath = args.app_name
        ? path.join(ctx.appPath, args.app_name)
        : ctx.appPath;

      const files: string[] = [];
      if (args.file_path) {
        files.push(path.join(appPath, args.file_path));
      } else {
        async function findTsFiles(dir: string) {
          try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              if (
                entry.isDirectory() &&
                !entry.name.startsWith(".") &&
                entry.name !== "node_modules"
              ) {
                await findTsFiles(fullPath);
              } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
                files.push(fullPath);
              }
            }
          } catch {
            // Skip inaccessible directories
          }
        }
        await findTsFiles(appPath);
      }

      const modules: TsModule[] = [];

      for (const file of files.slice(0, 50)) {
        try {
          const content = await fs.readFile(file, "utf-8");
          const lines = content.split("\n");

          const module: TsModule = {
            name: path.relative(appPath, file),
            imports: [],
            exports: [],
            interfaces: [],
            types: [],
            classes: [],
            functions: [],
          };

          for (const line of lines) {
            const trimmed = line.trim();

            // Import detection
            if (trimmed.startsWith("import ")) {
              module.imports.push(trimmed);
            }

            // Export detection
            if (trimmed.startsWith("export ")) {
              module.exports.push(trimmed);
            }

            // Interface detection
            const ifaceMatch = trimmed.match(/^interface\s+(\w+)/);
            if (ifaceMatch) {
              module.interfaces.push({
                name: ifaceMatch[1],
                properties: [],
                methods: [],
              });
            }

            // Type detection
            const typeMatch = trimmed.match(/^type\s+(\w+)\s*=/);
            if (typeMatch) {
              module.types.push({
                name: typeMatch[1],
                definition: trimmed,
              });
            }

            // Class detection
            const classMatch = trimmed.match(
              /^class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?\s*\{/,
            );
            if (classMatch) {
              module.classes.push({
                name: classMatch[1],
                extends: classMatch[2] || "",
                implements: classMatch[3]
                  ? classMatch[3].split(",").map((i) => i.trim())
                  : [],
                methods: [],
                properties: [],
              });
            }

            // Function detection
            const funcMatch = trimmed.match(
              /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\(([^)]*)\)(?:\s*:\s*(\w+))?/,
            );
            if (funcMatch) {
              module.functions.push({
                name: funcMatch[1],
                params: funcMatch[2]
                  ? funcMatch[2].split(",").map((p) => p.trim())
                  : [],
                returnType: funcMatch[3] || "void",
              });
            }
          }

          modules.push(module);
        } catch {
          // Skip unreadable files
        }
      }

      ctx.onXmlComplete(
        `<dyad-ts-ast files="${modules.length}">${JSON.stringify(modules, null, 2)}</dyad-ts-ast>`,
      );

      return JSON.stringify(modules, null, 2);
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to analyze TypeScript AST: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
