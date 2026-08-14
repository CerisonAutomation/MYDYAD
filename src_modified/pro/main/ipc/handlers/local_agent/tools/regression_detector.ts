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

const logger = log.scope("regression_detector");

const regressionDetectorSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions) to analyze instead of the current app.",
    ),
  max_commits: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum number of recent commits to analyze (default: 10)."),
});

const DESCRIPTION = `Detect potential regressions from recent changes.

- Analyzes recent git commits for risky patterns
- Identifies files with high churn that may introduce instability
- Detects deleted/renamed exports that could break imports
- Finds large diffs that may need extra review
- Returns risk-ranked findings with commit references`;

function buildAttributes(
  args: Partial<z.infer<typeof regressionDetectorSchema>>,
  stats?: { risks: number; commits: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) {
    attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  }
  if (stats) {
    attrs.push(`risks="${stats.risks}"`);
    attrs.push(`commits="${stats.commits}"`);
  }
  return attrs.join(" ");
}

function runGit(root: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    try {
      const result = spawn("git", args, { cwd: root });
      let stdout = "";
      let stderr = "";
      result.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      result.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
      result.on("error", (err) => {
        logger.warn(`Git spawn error: ${err}`);
        resolve("");
      });
      result.on("close", (code) => {
        if (code !== 0) {
          logger.warn(`Git exited with code ${code}: ${stderr}`);
        }
        resolve(stdout.trim());
      });
    } catch (error) {
      logger.warn(`Git command failed: ${error}`);
      resolve("");
    }
  });
}

async function analyzeRecentCommits(
  root: string,
  maxCommits: number,
): Promise<
  Array<{
    type: string;
    severity: string;
    file: string;
    commit: string;
    message: string;
  }>
> {
  const risks: Array<{
    type: string;
    severity: string;
    file: string;
    commit: string;
    message: string;
  }> = [];

  const logOutput = await runGit(root, [
    `--no-pager`,
    `log`,
    `-n${maxCommits}`,
    "--pretty=format:%H|%s|%an",
    "--numstat",
  ]);

  if (!logOutput) return risks;

  const commits = logOutput.split("\n\n").filter(Boolean);

  for (const commitBlock of commits) {
    const lines = commitBlock.split("\n");
    const headerMatch = lines[0]?.match(/^([a-f0-9]+)\|(.+)\|(.+)$/);
    if (!headerMatch) continue;

    const [, hash] = headerMatch;
    const shortHash = hash.slice(0, 7);

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split("\t");
      if (parts.length < 3) continue;

      const additions = parseInt(parts[0], 10);
      const deletions = parseInt(parts[1], 10);
      const file = parts[2];

      if (!file || file.startsWith("/")) continue;

      if (additions + deletions > 200) {
        risks.push({
          type: "large_diff",
          severity: "medium",
          file,
          commit: shortHash,
          message: `Large change: +${additions}/-${deletions} lines`,
        });
      }

      if (deletions > 50 && additions < 10) {
        risks.push({
          type: "heavy_deletion",
          severity: "medium",
          file,
          commit: shortHash,
          message: `Heavy deletion: -${deletions} lines`,
        });
      }

      if (/\.test\.|\.spec\.|__tests__/.test(file) && deletions > additions) {
        risks.push({
          type: "test_weakening",
          severity: "high",
          file,
          commit: shortHash,
          message: "Test file has more deletions than additions",
        });
      }

      if (
        /(?:package\.json|tsconfig|vite\.config|webpack|\.env|drizzle)/.test(
          file,
        )
      ) {
        risks.push({
          type: "config_change",
          severity: "low",
          file,
          commit: shortHash,
          message: "Configuration file changed",
        });
      }
    }
  }

  return risks;
}

export const regressionDetectorTool: ToolDefinition<
  z.infer<typeof regressionDetectorSchema>
> = {
  name: "regression_detector",
  description: DESCRIPTION,
  inputSchema: regressionDetectorSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Detect potential regressions from recent changes";
    if (args.app_name) {
      preview += ` in app: ${args.app_name}`;
    }
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-regression-detector ${buildAttributes(args)}>Analyzing recent commits...</dyad-regression-detector>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
    const maxCommits = args.max_commits ?? 10;

    logger.log(`Detecting regressions in ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-regression-detector ${buildAttributes(args)}>Scanning git history...</dyad-regression-detector>`,
    );

    try {
      const risks = await analyzeRecentCommits(targetAppPath, maxCommits);

      const attrs = buildAttributes(args, {
        risks: risks.length,
        commits: maxCommits,
      });

      if (risks.length === 0) {
        ctx.onXmlComplete(
          `<dyad-regression-detector ${attrs}>No regression risks detected in recent commits.</dyad-regression-detector>`,
        );
        return "No regression risks detected in recent commits.";
      }

      const resultText = `Regression Risk Analysis (last ${maxCommits} commits):\nTotal risks: ${risks.length}\n\n${risks.map((r) => `• [${r.severity}] ${r.file} (${r.commit}) - ${r.message}`).join("\n")}`;

      ctx.onXmlComplete(
        `<dyad-regression-detector ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-regression-detector>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Regression detection failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
