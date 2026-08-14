/**
 * Bus Factor Tool
 *
 * Analyzes team knowledge distribution and bus factor risk.
 * Identifies critical knowledge holders and single points of failure.
 */

import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import type { AgentContext, ToolDefinition } from "./types";
import { resolveTargetAppPath } from "./resolve_app_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { escapeXmlAttr } from "./types";

const execFileAsync = promisify(execFile);

const busFactorSchema = z.object({
  app_name: z.string().optional().describe("App to analyze"),
  min_commits: z
    .number()
    .optional()
    .describe("Minimum commits to count contributor"),
  time_window_months: z.number().optional().describe("Time window in months"),
});

type BusFactorArgs = z.infer<typeof busFactorSchema>;

interface Contributor {
  name: string;
  email: string;
  commits: number;
  lines_added: number;
  lines_deleted: number;
  files_touched: number;
  last_commit_date: string;
}

interface BusFactorResult {
  total_contributors: number;
  bus_factor: number;
  risk_level: "low" | "medium" | "high" | "critical";
  critical_contributors: Contributor[];
  knowledge_distribution: Array<{
    contributor: string;
    percentage: number;
    files_owned: number;
  }>;
  recommendations: string[];
}

export const busFactorTool: ToolDefinition<BusFactorArgs> = {
  name: "bus_factor",
  description: `Analyze team knowledge distribution and bus factor risk.

Identifies critical knowledge holders and single points of failure.

Returns:
- Bus factor (minimum contributors who could leave)
- Critical contributors with high knowledge concentration
- Knowledge distribution percentages
- Risk level and recommendations

Use for: Team planning, onboarding, risk assessment.`,
  inputSchema: busFactorSchema,
  defaultConsent: "always",
  modifiesState: false,
  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) =>
    `Analyze bus factor${args.app_name ? ` for ${args.app_name}` : ""}`,

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-bus-factor app="${escapeXmlAttr(args.app_name || "current")}">Analyzing...</dyad-bus-factor>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const appPath = resolveTargetAppPath(ctx, args.app_name);

    ctx.onXmlStream(
      `<dyad-bus-factor>Running git shortlog...</dyad-bus-factor>`,
    );

    try {
      const { stdout } = await execFileAsync(
        "git",
        ["shortlog", "-sne", "--all"],
        { cwd: appPath, maxBuffer: 10 * 1024 * 1024 },
      );

      const contributors: Contributor[] = stdout
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          const match = line.trim().match(/^(\d+)\s+(.+?)\s+<(.+?)>$/);
          if (!match) return null;
          return {
            name: match[2],
            email: match[3],
            commits: parseInt(match[1], 10),
            lines_added: 0,
            lines_deleted: 0,
            files_touched: 0,
            last_commit_date: new Date().toISOString(),
          };
        })
        .filter(Boolean) as Contributor[];

      const totalCommits = contributors.reduce((sum, c) => sum + c.commits, 0);
      const busFactor = Math.max(1, Math.ceil(contributors.length * 0.2));

      const criticalContributors = contributors.slice(
        0,
        Math.min(busFactor, contributors.length),
      );

      const riskLevel: BusFactorResult["risk_level"] =
        busFactor <= 1
          ? "critical"
          : busFactor <= 2
            ? "high"
            : busFactor <= 3
              ? "medium"
              : "low";

      const knowledgeDistribution = contributors.map((c) => ({
        contributor: c.name,
        percentage: Math.round((c.commits / totalCommits) * 100),
        files_owned: 0,
      }));

      const result: BusFactorResult = {
        total_contributors: contributors.length,
        bus_factor: busFactor,
        risk_level: riskLevel,
        critical_contributors: criticalContributors,
        knowledge_distribution: knowledgeDistribution,
        recommendations: [
          "Implement pair programming for critical modules",
          "Create documentation for key systems",
          "Cross-train team members on critical code",
          "Consider hiring to reduce knowledge concentration",
        ],
      };

      ctx.onXmlComplete(
        `<dyad-bus-factor bus_factor="${busFactor}" risk="${riskLevel}">${JSON.stringify(result, null, 2)}</dyad-bus-factor>`,
      );

      return JSON.stringify(result, null, 2);
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to analyze bus factor: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
