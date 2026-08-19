/**
 * glob_pattern — Find files matching a glob pattern.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ToolDefinition, AgentContext } from "./types";
import { resolveTargetAppPath } from "./resolve_app_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const globPatternSchema = z.object({
  pattern: z
    .string()
    .describe("Glob pattern to match files, e.g. *.tsx or src/**/*.ts"),
  root: z
    .string()
    .optional()
    .describe("Root directory (defaults to current app)"),
  exclude: z
    .array(z.string())
    .optional()
    .describe("Additional exclude patterns"),
});

function globToRegex(pattern: string): RegExp {
  let s = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp("^" + s + "$");
}

function walkDir(
  dir: string,
  base: string,
  matcher: RegExp,
  excludePatterns: RegExp[],
  results: string[],
  max: number,
): void {
  if (results.length >= max) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (results.length >= max) break;
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full);
    if (e.isDirectory()) {
      if (
        [
          "node_modules",
          ".git",
          ".next",
          "dist",
          "out",
          ".vite",
          "build",
          "coverage",
        ].includes(e.name)
      )
        continue;
      if (excludePatterns.some((p) => p.test(rel + "/"))) continue;
      walkDir(full, base, matcher, excludePatterns, results, max);
    } else if (e.isFile()) {
      if (excludePatterns.some((p) => p.test(rel))) continue;
      if (matcher.test(rel)) results.push(rel);
    }
  }
}

export const globPatternTool: ToolDefinition<
  z.infer<typeof globPatternSchema>
> = {
  name: "glob_pattern",
  description:
    "Find files matching a glob pattern. Returns matching file paths relative to the app root.",
  inputSchema: globPatternSchema,
  defaultConsent: "always",

  getConsentPreview: (args) => {
    return `Find files matching: ${args.pattern}`;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-glob-pattern pattern="${args.pattern}"></dyad-glob-pattern>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const root = args.root || resolveTargetAppPath(ctx, undefined);
    const { pattern, exclude = [] } = args;

    if (!pattern) {
      throw new DyadError("pattern is required", DyadErrorKind.Validation);
    }

    const matcher = globToRegex(pattern);
    const excludePatterns = exclude.map(globToRegex);
    const results: string[] = [];
    walkDir(root, root, matcher, excludePatterns, results, 500);

    if (results.length === 0) {
      return `No files found matching pattern: ${pattern}`;
    }

    return `Found ${results.length} files matching "${pattern}":\n${results.join("\n")}`;
  },
};
