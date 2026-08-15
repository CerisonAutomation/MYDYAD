/**
 * fd Fast File Finder Tool
 *
 * Uses fd for fast parallel file finding (10x faster than find/glob).
 */

import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "path";
import type { AgentContext, ToolDefinition } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { resolveTargetAppPath } from "./resolve_app_context";

const execFileAsync = promisify(execFile);

const fdFindSchema = z.object({
  pattern: z
    .string()
    .optional()
    .describe("Filename pattern (regex) to match"),
  extension: z
    .string()
    .optional()
    .describe("File extension filter (e.g. 'ts', 'tsx', 'py')"),
  directory: z
    .string()
    .optional()
    .describe("Subdirectory to search in"),
  app_name: z
    .string()
    .optional()
    .describe("Optional app name to search in"),
  type: z
    .enum(["file", "directory", "symlink", "executable", "empty", "hidden"])
    .optional()
    .describe("Filter by type"),
  max_depth: z
    .number()
    .optional()
    .describe("Maximum search depth"),
  exclude: z
    .string()
    .optional()
    .describe("Glob pattern to exclude (e.g. 'node_modules')"),
  follow_symlinks: z
    .boolean()
    .optional()
    .describe("Follow symbolic links"),
  full_path: z
    .boolean()
    .optional()
    .describe("Print full path instead of relative"),
  limit: z
    .number()
    .optional()
    .describe("Maximum number of results (default: 200)"),
});

type FdFindArgs = z.infer<typeof fdFindSchema>;

export const fdFindTool: ToolDefinition<FdFindArgs> = {
  name: "fd_find",
  description: `Fast parallel file finder using fd (10x faster than find/glob).

Find files by name pattern, extension, type, or depth.

Use for: Quick file discovery, project structure exploration, finding specific file types.

Examples:
- Find all TypeScript files: extension='ts'
- Find test files: pattern='test|spec' extension='ts'
- Find config files: pattern='config' extension='json|yaml|yml'`,
  inputSchema: fdFindSchema,
  defaultConsent: "always",
  modifiesState: false,
  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args: FdFindArgs) =>
    `Find files${args.pattern ? ` matching "${args.pattern}"` : ""}`,

  buildXml: (args: FdFindArgs, isComplete: boolean) => {
    if (isComplete) return undefined;
    return `<dyad-fd-find>Searching...</dyad-fd-find>`;
  },

  execute: async (args: FdFindArgs, ctx: AgentContext) => {
    try {
      const appPath = resolveTargetAppPath(ctx, args.app_name);
      const searchDir = args.directory
        ? path.join(appPath, args.directory)
        : appPath;

      // Build fd command
      const cmdArgs: string[] = [];

      if (args.pattern) {
        cmdArgs.push(args.pattern);
      }

      cmdArgs.push(searchDir);

      if (args.extension) {
        cmdArgs.push("-e", args.extension);
      }

      if (args.type) {
        cmdArgs.push("--type", args.type);
      }

      if (args.max_depth) {
        cmdArgs.push("--max-depth", String(args.max_depth));
      }

      if (args.exclude) {
        cmdArgs.push("--exclude", args.exclude);
      }

      if (args.follow_symlinks) {
        cmdArgs.push("--follow-symlinks");
      }

      if (args.full_path) {
        cmdArgs.push("--full-path");
      }

      cmdArgs.push("--color", "never");

      const { stdout, stderr } = await execFileAsync("fd", cmdArgs, {
        cwd: appPath,
        timeout: 15000,
        maxBuffer: 10 * 1024 * 1024,
      });

      const lines = stdout.trim().split("\n").filter(Boolean);
      const limit = args.limit || 200;
      const results = lines.slice(0, limit).map((line) => {
        const relativePath = path.relative(appPath, line);
        return {
          path: relativePath,
          absolutePath: line,
        };
      });

      const result = {
        matchCount: lines.length,
        results,
        truncated: lines.length > limit,
        searchDir: args.directory || ".",
        pattern: args.pattern || "*",
        extension: args.extension,
        stderr: stderr || undefined,
      };

      return JSON.stringify(result, null, 2);
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `fd search failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Internal,
      );
    }
  },
};
