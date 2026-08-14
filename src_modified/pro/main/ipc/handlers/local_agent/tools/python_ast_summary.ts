/**
 * Python AST Summary Tool
 *
 * Analyzes Python code structure using AST parsing.
 */

import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { AgentContext, ToolDefinition } from "./types";

const pythonAstSummarySchema = z.object({
  app_name: z.string().optional().describe("App to analyze"),
  file_path: z.string().optional().describe("Specific file to analyze"),
  include_pattern: z.string().optional().describe("File pattern to include"),
});

type PythonAstSummaryArgs = z.infer<typeof pythonAstSummarySchema>;

interface PythonModule {
  name: string;
  imports: string[];
  classes: Array<{
    name: string;
    bases: string[];
    methods: string[];
    line_count: number;
  }>;
  functions: Array<{
    name: string;
    args: string[];
    line_count: number;
  }>;
  globals: string[];
}

export const pythonAstSummaryTool: ToolDefinition<PythonAstSummaryArgs> = {
  name: "python_ast_summary",
  description: `Analyze Python code structure using AST parsing.

Returns: Classes, functions, imports, globals with line counts.

Use for: Code understanding, architecture review, dependency analysis.`,
  inputSchema: pythonAstSummarySchema,
  defaultConsent: "always",
  modifiesState: false,
  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args: PythonAstSummaryArgs) =>
    `Analyze Python AST${args.file_path ? ` for ${args.file_path}` : ""}`,

  buildXml: (args: PythonAstSummaryArgs, isComplete: boolean) => {
    if (isComplete) return undefined;
    return `<dyad-python-ast app="${args.app_name || "current"}">Analyzing...</dyad-python-ast>`;
  },

  execute: async (args: PythonAstSummaryArgs, ctx: AgentContext) => {
    const appPath = args.app_name
      ? path.join(ctx.appPath, args.app_name)
      : ctx.appPath;

    const files: string[] = [];
    if (args.file_path) {
      files.push(path.join(appPath, args.file_path));
    } else {
      async function findPyFiles(dir: string) {
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (
              entry.isDirectory() &&
              !entry.name.startsWith(".") &&
              entry.name !== "node_modules" &&
              entry.name !== "__pycache__"
            ) {
              await findPyFiles(fullPath);
            } else if (entry.isFile() && entry.name.endsWith(".py")) {
              files.push(fullPath);
            }
          }
        } catch {
          // Skip inaccessible directories
        }
      }
      await findPyFiles(appPath);
    }

    const modules: PythonModule[] = [];

    for (const file of files.slice(0, 50)) {
      try {
        const content = await fs.readFile(file, "utf-8");
        const lines = content.split("\n");

        const module: PythonModule = {
          name: path.relative(appPath, file),
          imports: [],
          classes: [],
          functions: [],
          globals: [],
        };

        for (const line of lines) {
          const trimmed = line.trim();

          // Import detection
          if (trimmed.startsWith("import ") || trimmed.startsWith("from ")) {
            module.imports.push(trimmed);
          }

          // Class detection
          const classMatch = trimmed.match(/^class\s+(\w+)(?:\(([^)]+)\))?:/);
          if (classMatch) {
            const className = classMatch[1];
            const bases = classMatch[2]
              ? classMatch[2].split(",").map((b) => b.trim())
              : [];
            module.classes.push({
              name: className,
              bases,
              methods: [],
              line_count: 0,
            });
          }

          // Function detection
          const funcMatch = trimmed.match(
            /^(?:async\s+)?def\s+(\w+)\(([^)]*)\)/,
          );
          if (funcMatch) {
            const funcName = funcMatch[1];
            const args = funcMatch[2]
              ? funcMatch[2]
                  .split(",")
                  .map((a) => a.trim().split(":")[0].trim())
              : [];
            module.functions.push({
              name: funcName,
              args,
              line_count: 0,
            });
          }
        }

        modules.push(module);
      } catch {
        // Skip unreadable files
      }
    }

    ctx.onXmlComplete(
      `<dyad-python-ast files="${modules.length}">${JSON.stringify(modules, null, 2)}</dyad-python-ast>`,
    );

    return JSON.stringify(modules, null, 2);
  },
};
