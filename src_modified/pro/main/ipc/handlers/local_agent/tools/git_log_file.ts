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

const execFileAsync = promisify(execFile);

const gitLogFileSchema = z.object({
  file_path: z.string().describe("File to show history for"),
  app_name: z.string().optional().describe("App to analyze"),
  max_commits: z.number().optional().describe("Maximum commits to return"),
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
    return `<dyad-git-log-file file="${args.file_path}">Reading...</dyad-git-log-file>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const appPath = args.app_name
      ? path.join(ctx.appPath, args.app_name)
      : ctx.appPath;

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

      ctx.onXmlComplete(
        `<dyad-git-log-file file="${args.file_path}" commits="${commits.length}">${JSON.stringify(commits, null, 2)}</dyad-git-log-file>`,
      );

      return JSON.stringify(commits, null, 2);
    } catch (error) {
      throw new Error(
        `Failed to get git log for file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
};
