/**
 * GitHub PRs Tool
 *
 * Lists and retrieves GitHub pull requests.
 */

import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import type { AgentContext, ToolDefinition } from "./types";
import { escapeXmlAttr, escapeXmlContent } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const execFileAsync = promisify(execFile);

const githubPrsSchema = z.object({
  operation: z
    .enum(["list", "get", "files", "create"])
    .describe("Operation to perform"),
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  pr_number: z.coerce.coerce.number().optional().describe("PR number (for get/files)"),
  state: z.enum(["open", "closed", "all"]).optional().describe("PR state"),
  per_page: z.coerce.coerce.number().optional().describe("Results per page"),
  title: z.string().optional().describe("PR title (for create)"),
  body: z.string().optional().describe("PR body (for create)"),
  base: z
    .string()
    .optional()
    .describe("Base branch (for create, defaults to main)"),
});

type GithubPrsArgs = z.infer<typeof githubPrsSchema>;

export const githubPrsTool: ToolDefinition<GithubPrsArgs> = {
  name: "github_prs",
  description: `List, retrieve, and create GitHub pull requests.

Operations:
- list: List PRs with filters
- get: Get specific PR details
- files: Get files changed in PR
- create: Create a new pull request

Use for: Code review, PR management, change tracking.`,
  inputSchema: githubPrsSchema,
  defaultConsent: "ask",
  modifiesState: true,
  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    if (args.operation === "list")
      return `List PRs for ${args.owner}/${args.repo}`;
    if (args.operation === "create")
      return `Create PR "${args.title}" in ${args.owner}/${args.repo}`;
    if (args.operation === "files")
      return `Get files for PR #${args.pr_number}`;
    return `Get PR #${args.pr_number}`;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-github-prs op="${escapeXmlAttr(args.operation ?? "")}">Loading...</dyad-github-prs>`;
  },

  execute: async (args, ctx: AgentContext) => {
    try {
      let ghArgs: string[];

      if (args.operation === "list") {
        ghArgs = [
          "pr",
          "list",
          "--repo",
          `${args.owner}/${args.repo}`,
          "--json",
          "number,title,state,author,createdAt,mergedAt,additions,deletions",
        ];
        if (args.state) ghArgs.push("--state", args.state);
        if (args.per_page) ghArgs.push("--limit", args.per_page.toString());
      } else if (args.operation === "files") {
        if (!args.pr_number)
          throw new DyadError(
            "pr_number required for files",
            DyadErrorKind.Validation,
          );
        ghArgs = [
          "pr",
          "view",
          args.pr_number.toString(),
          "--repo",
          `${args.owner}/${args.repo}`,
          "--json",
          "files",
        ];
      } else if (args.operation === "get") {
        if (!args.pr_number)
          throw new DyadError(
            "pr_number required for get",
            DyadErrorKind.Validation,
          );
        ghArgs = [
          "pr",
          "view",
          args.pr_number.toString(),
          "--repo",
          `${args.owner}/${args.repo}`,
          "--json",
          "number,title,state,body,author,createdAt,mergedAt,additions,deletions,files",
        ];
      } else if (args.operation === "create") {
        if (!args.title)
          throw new DyadError(
            "title required for create",
            DyadErrorKind.Validation,
          );
        ghArgs = [
          "pr",
          "create",
          "--repo",
          `${args.owner}/${args.repo}`,
          "--title",
          args.title,
        ];
        if (args.body) ghArgs.push("--body", args.body);
        if (args.base) ghArgs.push("--base", args.base);
      } else {
        throw new DyadError(
          `Unknown operation: ${args.operation}`,
          DyadErrorKind.Validation,
        );
      }

      const { stdout } = await execFileAsync("gh", ghArgs, {
        cwd: ctx.appPath,
        maxBuffer: 10 * 1024 * 1024,
      });

      let result: unknown;
      if (args.operation === "create") {
        // gh pr create returns a URL, not JSON
        result = { url: stdout.trim() };
      } else {
        result = JSON.parse(stdout);
      }

      ctx.onXmlComplete(
        `<dyad-github-prs op="${escapeXmlAttr(args.operation)}">${escapeXmlContent(JSON.stringify(result, null, 2))}</dyad-github-prs>`,
      );

      return JSON.stringify(result, null, 2);
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to execute GitHub PRs command: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.External,
      );
    }
  },
};
