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
import { escapeXmlAttr, escapeXmlContent } from "./types";
import { resolveTargetAppPath } from "./resolve_app_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const execFileAsync = promisify(execFile);

const gitDiffStagedSchema = z.object({
  app_name: z.string().optional().describe("App to analyze"),
  stat: z.coerce.coerce.boolean().optional().describe("Show stat only"),
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
    return `<dyad-git-diff-staged app="${escapeXmlAttr(args.app_name ?? "current")}">Reading...</dyad-git-diff-staged>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const appPath = resolveTargetAppPath(ctx, args.app_name);

    const MAX_OUTPUT = 64 * 1024;

    try {
      const diffArgs = args.stat
        ? ["diff", "--staged", "--stat"]
        : ["diff", "--staged"];

      const { stdout } = await execFileAsync("git", diffArgs, {
        cwd: appPath,
        maxBuffer: 10 * 1024 * 1024,
      });

      let output = stdout || "No staged changes";
      if (output.length > MAX_OUTPUT) {
        output =
          output.slice(0, MAX_OUTPUT) +
          `\n\n... (truncated at ${MAX_OUTPUT} bytes)`;
      }

      ctx.onXmlComplete(
        `<dyad-git-diff-staged>${escapeXmlContent(output)}</dyad-git-diff-staged>`,
      );

      return output;
    } catch (error) {
      throw new DyadError(
        `Failed to get staged diff: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.External,
      );
    }
  },
};
