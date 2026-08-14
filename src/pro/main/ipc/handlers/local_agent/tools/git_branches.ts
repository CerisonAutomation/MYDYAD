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
import { escapeXmlAttr, escapeXmlContent } from "./types";
import { resolveTargetAppPath } from "./resolve_app_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

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
  ahead: number | null;
  behind: number | null;
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
    return `<dyad-git-branches app="${escapeXmlAttr(args.app_name ?? "current")}">Listing...</dyad-git-branches>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const appPath = resolveTargetAppPath(ctx, args.app_name);

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

      const branches: Branch[] = await Promise.all(
        stdout
          .split("\n")
          .filter((line) => line.trim())
          .map(async (line) => {
            const parts = line.split("|");
            const branchName = parts[0];
            const isRemote = branchName.startsWith("remotes/");
            let ahead: number | null = null;
            let behind: number | null = null;

            if (!isRemote) {
              try {
                const { stdout: lrOutput } = await execFileAsync(
                  "git",
                  [
                    "rev-list",
                    "--left-right",
                    "--count",
                    `origin/main...${branchName}`,
                  ],
                  { cwd: appPath, maxBuffer: 1024 },
                );
                const [aheadStr, behindStr] = lrOutput.trim().split(/\s+/);
                ahead = parseInt(aheadStr, 10) || 0;
                behind = parseInt(behindStr, 10) || 0;
              } catch {
                // No remote tracking or branch not found - leave as null
              }
            }

            return {
              name: branchName,
              current: parts[1] === "*",
              remote: isRemote ? "remote" : "local",
              last_commit_date: parts[2],
              last_commit_message: parts[3],
              ahead,
              behind,
            };
          }),
      );

      ctx.onXmlComplete(
        `<dyad-git-branches count="${branches.length}">${escapeXmlContent(JSON.stringify(branches, null, 2))}</dyad-git-branches>`,
      );

      return JSON.stringify(branches, null, 2);
    } catch (error) {
      throw new DyadError(
        `Failed to list git branches: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.External,
      );
    }
  },
};
