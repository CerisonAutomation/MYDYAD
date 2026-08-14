/**
 * GitHub Issues Tool
 *
 * Lists and retrieves GitHub issues.
 */

import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import type { AgentContext, ToolDefinition } from "./types";
import { escapeXmlAttr, escapeXmlContent } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const execFileAsync = promisify(execFile);

const githubIssuesSchema = z.object({
  operation: z.enum(["list", "get"]).describe("Operation to perform"),
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  issue_number: z.number().optional().describe("Issue number (for get)"),
  state: z.enum(["open", "closed", "all"]).optional().describe("Issue state"),
  labels: z.string().optional().describe("Comma-separated labels"),
  per_page: z.number().optional().describe("Results per page"),
});

type GithubIssuesArgs = z.infer<typeof githubIssuesSchema>;

export const githubIssuesTool: ToolDefinition<GithubIssuesArgs> = {
  name: "github_issues",
  description: `List and retrieve GitHub issues.

Operations:
- list: List issues with filters
- get: Get specific issue details

Use for: Project management, bug tracking, feature requests.`,
  inputSchema: githubIssuesSchema,
  defaultConsent: "ask",
  modifiesState: false,
  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) =>
    args.operation === "list"
      ? `List issues for ${args.owner}/${args.repo}`
      : `Get issue #${args.issue_number}`,

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-github-issues op="${escapeXmlAttr(args.operation ?? "")}">Loading...</dyad-github-issues>`;
  },

  execute: async (args, ctx: AgentContext) => {
    try {
      let ghArgs: string[];

      if (args.operation === "list") {
        ghArgs = [
          "issue",
          "list",
          "--repo",
          `${args.owner}/${args.repo}`,
          "--json",
          "number,title,state,labels,createdAt,author",
        ];
        if (args.state) ghArgs.push("--state", args.state);
        if (args.labels) ghArgs.push("--label", args.labels);
        if (args.per_page) ghArgs.push("--limit", args.per_page.toString());
      } else {
        if (!args.issue_number)
          throw new DyadError(
            "issue_number required for get",
            DyadErrorKind.Validation,
          );
        ghArgs = [
          "issue",
          "view",
          args.issue_number.toString(),
          "--repo",
          `${args.owner}/${args.repo}`,
          "--json",
          "number,title,state,body,labels,createdAt,author,assignees",
        ];
      }

      const { stdout } = await execFileAsync("gh", ghArgs, {
        cwd: ctx.appPath,
        maxBuffer: 10 * 1024 * 1024,
      });

      const result = JSON.parse(stdout);

      ctx.onXmlComplete(
        `<dyad-github-issues op="${escapeXmlAttr(args.operation)}">${escapeXmlContent(JSON.stringify(result, null, 2))}</dyad-github-issues>`,
      );

      return JSON.stringify(result, null, 2);
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to execute GitHub issues command: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.External,
      );
    }
  },
};
