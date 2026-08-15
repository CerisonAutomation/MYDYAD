/**
 * ast-grep Structural Code Search Tool
 *
 * Find code patterns by AST structure, not just text.
 * Uses ast-grep for structural code search and rewriting.
 */

import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "path";
import type { AgentContext, ToolDefinition } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { resolveTargetAppPath } from "./resolve_app_context";

const execFileAsync = promisify(execFile);

const astGrepSchema = z.object({
  pattern: z
    .string()
    .describe(
      "AST pattern to search for (e.g. 'console.log($$$)' or 'function $NAME($$$) { $$$ }')",
    ),
  language: z
    .enum(["js", "ts", "jsx", "tsx", "py", "rust", "go", "java", "c", "cpp"])
    .describe("Programming language"),
  app_name: z.string().optional().describe("Optional app name to search in"),
  directory: z.string().optional().describe("Subdirectory to search in"),
  file_pattern: z
    .string()
    .optional()
    .describe("File glob pattern to filter (e.g. '*.ts')"),
  rewrite: z
    .string()
    .optional()
    .describe("Replacement pattern (if provided, performs rewrite)"),
});

type AstGrepArgs = z.infer<typeof astGrepSchema>;

interface AstGrepMatch {
  file: string;
  line: number;
  column: number;
  text: string;
  replacement?: string;
}

export const astGrepSearchTool: ToolDefinition<AstGrepArgs> = {
  name: "ast_grep_search",
  description: `Search code by AST structure using ast-grep.

Find patterns like:
- All console.log calls: console.log($$$)
- All function declarations: function $NAME($$$) { $$$ }
- All TODO comments: // TODO: $$$
- All unused imports: import $NAME from $SOURCE

Use for: Structural code search, pattern-based refactoring, code auditing.

Languages: JavaScript, TypeScript, Python, Rust, Go, Java, C/C++.`,
  inputSchema: astGrepSchema,
  defaultConsent: "ask",
  modifiesState: false,
  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args: AstGrepArgs) =>
    `Search AST pattern: ${args.pattern}`,

  buildXml: (args: Partial<AstGrepArgs>, isComplete: boolean) => {
    if (isComplete) return undefined;
    return `<dyad-ast-grep pattern="${args.pattern || "unknown"}">Searching...</dyad-ast-grep>`;
  },

  execute: async (args: AstGrepArgs, ctx: AgentContext) => {
    try {
      const appPath = resolveTargetAppPath(ctx, args.app_name);
      const searchDir = args.directory
        ? path.join(appPath, args.directory)
        : appPath;

      // Build ast-grep command
      const cmd = "npx";
      const cmdArgs = [
        "ast-grep",
        "run",
        "--pattern",
        args.pattern,
        "--lang",
        args.language,
        "--json",
        searchDir,
      ];

      if (args.file_pattern) {
        cmdArgs.push("--globs", args.file_pattern);
      }

      if (args.rewrite) {
        cmdArgs.push("--rewrite", args.rewrite);
        cmdArgs.push("--interactive=false");
      }

      const { stdout, stderr } = await execFileAsync(cmd, cmdArgs, {
        cwd: appPath,
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      });

      // Parse results
      let matches: AstGrepMatch[] = [];
      try {
        const parsed = JSON.parse(stdout);
        if (Array.isArray(parsed)) {
          matches = parsed.map((m: any) => ({
            file: m.file || m.path || "",
            line: m.range?.start?.line || m.line || 0,
            column: m.range?.start?.column || m.column || 0,
            text: m.text || m.match || "",
            replacement: m.replacement,
          }));
        }
      } catch {
        // If JSON parsing fails, try line-by-line parsing
        const lines = stdout.trim().split("\n").filter(Boolean);
        matches = lines.map((line) => {
          try {
            const parsed = JSON.parse(line);
            return {
              file: parsed.file || "",
              line: parsed.range?.start?.line || 0,
              column: parsed.range?.start?.column || 0,
              text: parsed.text || "",
              replacement: parsed.replacement,
            };
          } catch {
            return { file: "", line: 0, column: 0, text: line };
          }
        });
      }

      const result = {
        pattern: args.pattern,
        language: args.language,
        matchCount: matches.length,
        matches: matches.slice(0, 100), // Limit to 100 matches
        truncated: matches.length > 100,
        rewriteMode: !!args.rewrite,
        stderr: stderr || undefined,
      };

      return JSON.stringify(result, null, 2);
    } catch (error) {
      if (error instanceof DyadError) throw error;

      // ast-grep exits with code 1 when no matches found
      if ((error as any)?.code === 1) {
        return JSON.stringify({
          pattern: args.pattern,
          language: args.language,
          matchCount: 0,
          matches: [],
          message: "No matches found for this pattern",
        });
      }

      throw new DyadError(
        `ast-grep search failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Internal,
      );
    }
  },
};
