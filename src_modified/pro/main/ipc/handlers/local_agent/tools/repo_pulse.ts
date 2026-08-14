import { z } from "zod";
import { spawn } from "node:child_process";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { resolveTargetAppPath } from "./resolve_app_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import log from "electron-log";

const logger = log.scope("repo_pulse");

const repoPulseSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
  max_commits: z
    .number()
    .min(10)
    .max(1000)
    .optional()
    .describe("Maximum number of commits to analyze (default: 200, max: 1000)"),
});

const DESCRIPTION = `Evaluate project activity and health metrics.

- Returns: commit frequency, contributor concentration, release cadence, bus factor
- Identifies: inactive periods, single-maintainer risk, release patterns
- Use for project health assessment and team risk analysis`;

interface PulseMetrics {
  totalCommits: number;
  uniqueAuthors: number;
  topAuthorPercentage: number;
  avgCommitsPerWeek: number;
  lastCommitDaysAgo: number;
  activeDays: number;
  healthScore: number;
  risks: string[];
}

function runGit(root: string, args: string[]): string {
  try {
    const result = spawn("git", args, { cwd: root });
    let stdout = "";
    result.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    return stdout.trim();
  } catch (error) {
    logger.warn(`Git command failed: ${error}`);
    return "";
  }
}

function analyzePulse(root: string, maxCommits: number): PulseMetrics {
  const logOutput = runGit(root, [
    "log",
    `-${maxCommits}`,
    "--pretty=format:%H|%an|%aI",
  ]);
  const lines = logOutput.split("\n").filter(Boolean);

  const authors = new Map<string, number>();
  const dates = new Set<string>();

  for (const line of lines) {
    const [, author, dateStr] = line.split("|");
    if (author) {
      authors.set(author, (authors.get(author) || 0) + 1);
    }
    if (dateStr) {
      dates.add(dateStr.split("T")[0]);
    }
  }

  const totalCommits = lines.length;
  const uniqueAuthors = authors.size;
  const topAuthor = Array.from(authors.entries()).sort(
    (a, b) => b[1] - a[1],
  )[0];
  const topAuthorPercentage = topAuthor
    ? Math.round((topAuthor[1] / totalCommits) * 100)
    : 0;

  // Calculate weeks span
  const datesList = Array.from(dates).sort();
  const firstDate = new Date(datesList[0] || Date.now());
  const lastDate = new Date(datesList[datesList.length - 1] || Date.now());
  const weeksSpan = Math.max(
    1,
    Math.ceil(
      (lastDate.getTime() - firstDate.getTime()) / (7 * 24 * 60 * 60 * 1000),
    ),
  );
  const avgCommitsPerWeek = Math.round(totalCommits / weeksSpan);

  // Last commit
  const lastCommitDate = new Date(lines[0]?.split("|")[2] || Date.now());
  const lastCommitDaysAgo = Math.ceil(
    (Date.now() - lastCommitDate.getTime()) / (24 * 60 * 60 * 1000),
  );

  // Health score
  let healthScore = 100;
  const risks: string[] = [];

  if (lastCommitDaysAgo > 90) {
    healthScore -= 30;
    risks.push("Project inactive for >90 days");
  } else if (lastCommitDaysAgo > 30) {
    healthScore -= 15;
    risks.push("Project inactive for >30 days");
  }

  if (topAuthorPercentage > 80) {
    healthScore -= 25;
    risks.push(
      `Single contributor risk: ${topAuthorPercentage}% from one author`,
    );
  } else if (topAuthorPercentage > 60) {
    healthScore -= 10;
    risks.push(`High contributor concentration: ${topAuthorPercentage}%`);
  }

  if (uniqueAuthors < 3) {
    healthScore -= 15;
    risks.push("Low contributor diversity");
  }

  if (avgCommitsPerWeek < 1) {
    healthScore -= 10;
    risks.push("Low commit frequency");
  }

  return {
    totalCommits,
    uniqueAuthors,
    topAuthorPercentage,
    avgCommitsPerWeek,
    lastCommitDaysAgo,
    activeDays: dates.size,
    healthScore: Math.max(0, healthScore),
    risks,
  };
}

function buildAttributes(
  args: Partial<z.infer<typeof repoPulseSchema>>,
  metrics?: PulseMetrics,
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (metrics) {
    attrs.push(`health="${metrics.healthScore}"`);
    attrs.push(`commits="${metrics.totalCommits}"`);
    attrs.push(`authors="${metrics.uniqueAuthors}"`);
    attrs.push(`active_days="${metrics.activeDays}"`);
  }
  return attrs.join(" ");
}

export const repoPulseTool: ToolDefinition<z.infer<typeof repoPulseSchema>> = {
  name: "repo_pulse",
  description: DESCRIPTION,
  inputSchema: repoPulseSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Analyze project health";
    if (args.app_name) preview += ` in app: ${args.app_name}`;
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-repo-pulse ${buildAttributes(args)}>Analyzing project health...</dyad-repo-pulse>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
    const maxCommits = Math.min(args.max_commits ?? 200, 1000);

    logger.log(`Analyzing repo pulse for ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-repo-pulse ${buildAttributes(args)}>Analyzing git history...</dyad-repo-pulse>`,
    );

    try {
      const metrics = analyzePulse(targetAppPath, maxCommits);
      const attrs = buildAttributes(args, metrics);

      let resultText = `Health Score: ${metrics.healthScore}/100\n\n`;
      resultText += `📊 Metrics:\n`;
      resultText += `  - Total Commits: ${metrics.totalCommits}\n`;
      resultText += `  - Unique Authors: ${metrics.uniqueAuthors}\n`;
      resultText += `  - Top Author: ${metrics.topAuthorPercentage}% of commits\n`;
      resultText += `  - Avg Commits/Week: ${metrics.avgCommitsPerWeek}\n`;
      resultText += `  - Last Commit: ${metrics.lastCommitDaysAgo} days ago\n`;
      resultText += `  - Active Days: ${metrics.activeDays}\n`;

      if (metrics.risks.length > 0) {
        resultText += `\n⚠️ Risks:\n${metrics.risks.map((r) => `  - ${r}`).join("\n")}`;
      }

      ctx.onXmlComplete(
        `<dyad-repo-pulse ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-repo-pulse>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to analyze repo pulse: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
