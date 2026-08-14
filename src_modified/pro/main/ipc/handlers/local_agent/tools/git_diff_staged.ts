/**
 * Git Diff Staged Tool
 *
 * Shows staged changes ready for commit.
 */

import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import type { AgentContext, ToolDefinition } from "./types";

const execFileAsync = promisify(execFile);

const gitDiffStagedSchema = z.object({
  app_name: z.string().optional().describe("App to analyze"),
  stat: z.boolean().optional().describe("Show stat only"),
});

type GitDiffStagedArgs = z.infer<typeof gitDiffStagedSchema>;

export const gitDiffStagedTool: ToolDefinition<GitDiffStagedArgs> = {
  name: "git_diff_staged",
  description: `Show staged changes ready for commit (git diff --staged).

Use for: Reviewing what will be committed, pre-commit checks.`,
  inputSchema: gitDiffStagedSchema,
  defaultConsent: "always",
  modifiesState: false,
  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: () => "Show staged changes",

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-git-diff-staged app="${args.app_name || "current"}">Reading...</dyad-git-diff-staged>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const appPath = args.app_name
      ? path.join(ctx.appPath, args.app_name)
      : ctx.appPath;

    try {
      const diffArgs = args.stat
        ? ["diff", "--staged", "--stat"]
        : ["diff", "--staged"];

      const { stdout } = await execFileAsync("git", diffArgs, {
        cwd: appPath,
        maxBuffer: 10 * 1024 * 1024,
      });

      ctx.onXmlComplete(
        `<dyad-git-diff-staged>${stdout || "No staged changes"}</dyad-git-diff-staged>`,
      );

      return stdout || "No staged changes";
    } catch (error) {
      throw new Error(
        `Failed to get staged diff: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
};
