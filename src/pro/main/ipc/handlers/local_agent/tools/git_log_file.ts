/**
 * Git Log File Tool
 *
 * Shows commit history for a specific file.
 */

import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import type { AgentContext, ToolDefinition } from "./types";
import { escapeXmlAttr, escapeXmlContent } from "./types";
import { resolveTargetAppPath } from "./resolve_app_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const execFileAsync = promisify(execFile);

const gitLogFileSchema = z.object({
  file_path: z.string().describe("File to show history for"),
  app_name: z.string().optional().describe("App to analyze"),
  max_commits: z.coerce.coerce.number().optional().describe("Maximum commits to return"),
});

type GitLogFileArgs = z.infer<typeof gitLogFileSchema>;

export const gitLogFileTool: ToolDefinition<GitLogFileArgs> = {
  name: "git_log_file",
  description: `Show commit history for a specific file.

Use for: Understanding file evolution, finding when changes were made.`,
  inputSchema: gitLogFileSchema,
  defaultConsent: "always",
  modifiesState: false,
  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => `Show history for ${args.file_path}`,

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-git-log-file file="${escapeXmlAttr(args.file_path ?? "")}">Reading...</dyad-git-log-file>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const appPath = resolveTargetAppPath(ctx, args.app_name);

    const MAX_OUTPUT = 64 * 1024;

    try {
      const maxCommits = args.max_commits || 20;

      const { stdout } = await execFileAsync(
        "git",
        [
          "log",
          `--max-count=${maxCommits}`,
          "--format=%H|%an|%ae|%ai|%s",
          "--",
          args.file_path,
        ],
        { cwd: appPath, maxBuffer: 10 * 1024 * 1024 },
      );

      const commits = stdout
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          const parts = line.split("|");
          return {
            hash: parts[0].slice(0, 8),
            author: parts[1],
            email: parts[2],
            date: parts[3],
            message: parts[4],
          };
        });

      let output = JSON.stringify(commits, null, 2);
      if (output.length > MAX_OUTPUT) {
        output =
          output.slice(0, MAX_OUTPUT) +
          `\n\n... (truncated at ${MAX_OUTPUT} bytes)`;
      }

      ctx.onXmlComplete(
        `<dyad-git-log-file file="${escapeXmlAttr(args.file_path)}" commits="${commits.length}">${escapeXmlContent(output)}</dyad-git-log-file>`,
      );

      return output;
    } catch (error) {
      throw new DyadError(
        `Failed to get git log for file: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.External,
      );
    }
  },
};
