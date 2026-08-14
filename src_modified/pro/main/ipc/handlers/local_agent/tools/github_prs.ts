/**
 * GitHub PRs Tool
 *
 * Lists and retrieves GitHub pull requests.
 */

import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import type { AgentContext, ToolDefinition } from "./types";

const execFileAsync = promisify(execFile);

const githubPrsSchema = z.object({
  operation: z.enum(["list", "get", "files"]).describe("Operation to perform"),
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  pr_number: z.number().optional().describe("PR number (for get/files)"),
  state: z.enum(["open", "closed", "all"]).optional().describe("PR state"),
  per_page: z.number().optional().describe("Results per page"),
});

type GithubPrsArgs = z.infer<typeof githubPrsSchema>;

export const githubPrsTool: ToolDefinition<GithubPrsArgs> = {
  name: "github_prs",
  description: `List and retrieve GitHub pull requests.

Operations:
- list: List PRs with filters
- get: Get specific PR details
- files: Get files changed in PR

Use for: Code review, PR management, change tracking.`,
  inputSchema: githubPrsSchema,
  defaultConsent: "ask",
  modifiesState: false,
  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) =>
    args.operation === "list"
      ? `List PRs for ${args.owner}/${args.repo}`
      : args.operation === "files"
        ? `Get files for PR #${args.pr_number}`
        : `Get PR #${args.pr_number}`,

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-github-prs op="${args.operation}">Loading...</dyad-github-prs>`;
  },

  execute: async (args, ctx: AgentContext) => {
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
      if (!args.pr_number) throw new Error("pr_number required for files");
      ghArgs = [
        "pr",
        "view",
        args.pr_number.toString(),
        "--repo",
        `${args.owner}/${args.repo}`,
        "--json",
        "files",
      ];
    } else {
      if (!args.pr_number) throw new Error("pr_number required for get");
      ghArgs = [
        "pr",
        "view",
        args.pr_number.toString(),
        "--repo",
        `${args.owner}/${args.repo}`,
        "--json",
        "number,title,state,body,author,createdAt,mergedAt,additions,deletions,files",
      ];
    }

    const { stdout } = await execFileAsync("gh", ghArgs, {
      cwd: ctx.appPath,
      maxBuffer: 10 * 1024 * 1024,
    });

    const result = JSON.parse(stdout);

    ctx.onXmlComplete(
      `<dyad-github-prs op="${args.operation}">${JSON.stringify(result, null, 2)}</dyad-github-prs>`,
    );

    return JSON.stringify(result, null, 2);
  },
};
