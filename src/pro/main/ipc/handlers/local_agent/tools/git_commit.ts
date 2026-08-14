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
const logger = log.scope("git_commit");

const gitCommitSchema = z.object({
  message: z.string().describe("The commit message"),
  all: z
    .boolean()
    .optional()
    .describe("Stage all changes before committing (git add -A)"),
  files: z
    .array(z.string())
    .optional()
    .describe("Specific files to stage before committing"),
});

const DESCRIPTION = `Commit changes to the git repository.

- Stages and commits file changes with a descriptive message
- Use --all to stage all changes, or --files for specific files
- Returns the commit hash and summary of changes`;

export const gitCommitTool: ToolDefinition<z.infer<typeof gitCommitSchema>> = {
  name: "git_commit",
  description: DESCRIPTION,
  inputSchema: gitCommitSchema,
  defaultConsent: "always",
  modifiesState: true,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => `Commit: "${args.message}"`,

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-git-commit message="${escapeXmlAttr(args.message)}">Committing...</dyad-git-commit>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const appPath = ctx.appPath;

    try {
      // Stage files if requested
      if (args.all) {
        await execFileAsync("git", ["add", "-A"], { cwd: appPath });
        logger.log("Staged all changes");
      } else if (args.files && args.files.length > 0) {
        for (const file of args.files) {
          await execFileAsync("git", ["add", file], { cwd: appPath });
        }
        logger.log(`Staged ${args.files.length} file(s)`);
      }

      // Commit
      const { stdout } = await execFileAsync(
        "git",
        ["commit", "-m", args.message, "--porcelain"],
        { cwd: appPath },
      );

      // Get the commit hash
      const { stdout: hash } = await execFileAsync(
        "git",
        ["rev-parse", "HEAD"],
        { cwd: appPath },
      );

      const commitHash = hash.trim().slice(0, 7);
      const result = `Committed ${commitHash}: ${args.message}`;

      ctx.onXmlComplete(
        `<dyad-git-commit message="${escapeXmlAttr(args.message)}" commit="${commitHash}">\n${escapeXmlContent(result)}\n</dyad-git-commit>`,
      );

      return result;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to commit: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.External,
      );
    }
  },
};
