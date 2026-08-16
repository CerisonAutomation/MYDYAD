import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import log from "electron-log";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const logger = log.scope("git_stash");

const gitStashSchema = z.object({
  operation: z
    .enum(["push", "pop", "list", "drop"])
    .describe(
      "Stash operation: push saves changes, pop restores, list shows, drop discards the most recent stash",
    ),
  message: z.string().optional().describe("Optional message for stash push"),
});

const DESCRIPTION = `Manage Git stash operations.

Operations:
- push: Save uncommitted changes to a new stash
- pop: Apply and remove the most recent stash
- list: Show all stashed changes
- drop: Discard the most recent stash without applying it

Use for: Temporarily saving work, switching context, then restoring later.`;

export const gitStashTool: ToolDefinition<z.infer<typeof gitStashSchema>> = {
  name: "git_stash",
  description: DESCRIPTION,
  inputSchema: gitStashSchema,
  defaultConsent: "always",
  modifiesState: true,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    if (args.operation === "push") return "Stash current changes";
    if (args.operation === "pop") return "Pop most recent stash";
    if (args.operation === "drop") return "Discard most recent stash";
    return "List all stashes";
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-git-stash operation="${escapeXmlAttr(args.operation)}">Processing stash ${args.operation}...</dyad-git-stash>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const appPath = ctx.appPath;

    try {
      let result: string;

      if (args.operation === "push") {
        const gitArgs = ["stash", "push"];
        if (args.message) {
          gitArgs.push("-m", args.message);
        }
        const { stdout } = await execFileAsync("git", gitArgs, {
          cwd: appPath,
        });
        result = stdout.trim() || "No local changes to save.";
        logger.log("Stash push:", result);
      } else if (args.operation === "pop") {
        const { stdout, stderr } = await execFileAsync(
          "git",
          ["stash", "pop"],
          { cwd: appPath },
        );
        result = stdout.trim() || stderr.trim();
        logger.log("Stash pop:", result);
      } else if (args.operation === "list") {
        const { stdout } = await execFileAsync("git", ["stash", "list"], {
          cwd: appPath,
        });
        result = stdout.trim() || "No stashes found.";
        logger.log("Stash list:", result);
      } else if (args.operation === "drop") {
        const { stdout } = await execFileAsync("git", ["stash", "drop"], {
          cwd: appPath,
        });
        result = stdout.trim() || "Stash dropped.";
        logger.log("Stash drop:", result);
      } else {
        throw new DyadError(
          `Unknown stash operation: ${args.operation}`,
          DyadErrorKind.Validation,
        );
      }

      ctx.onXmlComplete(
        `<dyad-git-stash operation="${escapeXmlAttr(args.operation)}">${escapeXmlContent(result)}</dyad-git-stash>`,
      );

      return result;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to ${args.operation} stash: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.External,
      );
    }
  },
};
