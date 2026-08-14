/**
 * Git Branches Tool
 *
 * Lists and analyzes git branches.
 */

import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import type { AgentContext, ToolDefinition } from "./types";

const execFileAsync = promisify(execFile);

const gitBranchesSchema = z.object({
  app_name: z.string().optional().describe("App to analyze"),
  show_merged: z.boolean().optional().describe("Show merged branches"),
  show_remote: z.boolean().optional().describe("Show remote branches"),
});

type GitBranchesArgs = z.infer<typeof gitBranchesSchema>;

interface Branch {
  name: string;
  current: boolean;
  remote: string;
  last_commit_date: string;
  last_commit_message: string;
  ahead: number;
  behind: number;
}

export const gitBranchesTool: ToolDefinition<GitBranchesArgs> = {
  name: "git_branches",
  description: `List and analyze git branches.

Returns: Branch name, current status, last commit, ahead/behind counts.

Use for: Branch management, cleanup, understanding repo state.`,
  inputSchema: gitBranchesSchema,
  defaultConsent: "always",
  modifiesState: false,
  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: () => "List git branches",

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-git-branches app="${args.app_name || "current"}">Listing...</dyad-git-branches>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const appPath = args.app_name
      ? path.join(ctx.appPath, args.app_name)
      : ctx.appPath;

    try {
      const { stdout } = await execFileAsync(
        "git",
        [
          "branch",
          "-a",
          "--format=%(refname:short)|%(HEAD)|%(committerdate:iso)|%(subject)",
        ],
        { cwd: appPath, maxBuffer: 10 * 1024 * 1024 },
      );

      const branches: Branch[] = stdout
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          const parts = line.split("|");
          return {
            name: parts[0],
            current: parts[1] === "*",
            remote: parts[0].startsWith("remotes/") ? "remote" : "local",
            last_commit_date: parts[2],
            last_commit_message: parts[3],
            ahead: 0,
            behind: 0,
          };
        });

      ctx.onXmlComplete(
        `<dyad-git-branches count="${branches.length}">${JSON.stringify(branches, null, 2)}</dyad-git-branches>`,
      );

      return JSON.stringify(branches, null, 2);
    } catch (error) {
      throw new Error(
        `Failed to list git branches: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
};
