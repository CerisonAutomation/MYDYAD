import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { resolveTargetAppPath } from "./resolve_app_context";
import log from "electron-log";

const logger = log.scope("hotspots");

const execFileAsync = promisify(execFile);

async function runGit(root: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000,
    });
    return stdout.trim();
  } catch (error) {
    logger.warn(`Git command failed: ${error}`);
    return "";
  }
}

const hotspotsSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from @app:Name mentions) to analyze instead of the current app.",
    ),
  max_commits: z
    .number()
    .min(10)
    .max(500)
    .optional()
    .describe("Maximum number of commits to analyze (default: 200, max: 500)"),
  limit: z
    .number()
    .min(1)
    .max(50)
    .optional()
    .describe("Maximum number of hotspots to return (default: 10, max: 50)"),
});

const DESCRIPTION = `
Detect code hotspots — files that are both frequently changed (git churn) AND architecturally important (PageRank).

### When to Use
- Identifying files likely to have bugs (high churn = high risk)
- Finding architecturally critical files
- Planning refactoring efforts
- Prioritizing code review

### How It Works
1. Analyzes git history for change frequency (churn)
2. Builds import graph for PageRank importance scoring
3. Combines scores: combined = churn × 0.4 + importance × 0.6
4. Returns files sorted by combined score

### Output Format
Returns ranked list of hotspot files with scores and reasons:
- path: file path
- churnScore: number of commits touching this file
- importanceScore: PageRank importance (0-1)
- combinedScore: final ranking score
- reason: human-readable explanation
`;

interface Hotspot {
  path: string;
  churnScore: number;
  importanceScore: number;
  combinedScore: number;
  reason: string;
}

async function collectGitChurn(
  root: string,
  maxCommits: number,
): Promise<Map<string, number>> {
  const churn = new Map<string, number>();
  const output = await runGit(root, [
    "log",
    `-n${maxCommits}`,
    "--pretty=format:",
    "--numstat",
  ]);

  for (const line of output.split("\n")) {
    const parts = line.split("\t");
    if (parts.length >= 3 && parts[2]) {
      const filepath = parts[2].trim();
      if (filepath && !filepath.startsWith("/")) {
        churn.set(filepath, (churn.get(filepath) || 0) + 1);
      }
    }
  }

  return churn;
}

async function buildImportGraph(root: string): Promise<{
  nodes: string[];
  edges: Array<[string, string]>;
}> {
  const nodes = new Set<string>();
  const edges: Array<[string, string]> = [];

  // Simple import detection for JS/TS files
  const output = await runGit(root, [
    "ls-files",
    "*.ts",
    "*.tsx",
    "*.js",
    "*.jsx",
  ]);
  const files = output.split("\n").filter(Boolean);

  for (const file of files) {
    nodes.add(file);
    const content = await runGit(root, ["show", `HEAD:${file}`]);

    // Extract import statements
    const importRegex = /import\s+.*?from\s+['"](.+?)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      // Resolve relative imports
      if (importPath.startsWith(".")) {
        const dir = file.substring(0, file.lastIndexOf("/"));
        let resolved = `${dir}/${importPath}`;
        // Normalize path
        resolved = resolved.replace(/\/+/g, "/").replace(/\/\.\//g, "/");
        if (nodes.has(resolved)) {
          edges.push([file, resolved]);
        }
      }
    }
  }

  return { nodes: Array.from(nodes), edges };
}

function computePageRank(
  fileIds: string[],
  edges: Array<[string, string]>,
): Map<string, number> {
  const n = fileIds.length;
  if (n === 0) return new Map();
  if (n === 1) return new Map([[fileIds[0], 1.0]]);

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  for (const id of fileIds) {
    outgoing.set(id, []);
    incoming.set(id, []);
  }

  for (const [from, to] of edges) {
    if (outgoing.has(from) && incoming.has(to)) {
      outgoing.get(from)!.push(to);
      incoming.get(to)!.push(from);
    }
  }

  // Initialize scores
  const personalize = 1 / n;
  const scores = new Map<string, number>();
  for (const id of fileIds) scores.set(id, personalize);

  // Iterate (standard PageRank)
  const damping = 0.85;
  const maxIterations = 50;
  const threshold = 0.0001;

  for (let iter = 0; iter < maxIterations; iter++) {
    const newScores = new Map<string, number>();
    let diff = 0;

    for (const id of fileIds) {
      let rankSum = 0;
      for (const linker of incoming.get(id) || []) {
        const linkerOut = outgoing.get(linker) || [];
        if (linkerOut.length > 0) {
          rankSum += (scores.get(linker) || 0) / linkerOut.length;
        }
      }

      const newScore = (1 - damping) / n + damping * rankSum;
      newScores.set(id, newScore);
      diff += Math.abs(newScore - (scores.get(id) || 0));
    }

    for (const [id, score] of newScores) scores.set(id, score);
    if (diff < threshold) break;
  }

  // Normalize
  const total = Array.from(scores.values()).reduce((a, b) => a + b, 0);
  if (total > 0) {
    for (const [id, score] of scores) scores.set(id, score / total);
  }

  return scores;
}

export const hotspotsTool: ToolDefinition<z.infer<typeof hotspotsSchema>> = {
  name: "hotspots",
  description: DESCRIPTION,
  inputSchema: hotspotsSchema,
  defaultConsent: "always",
  modifiesState: false,

  getConsentPreview: (args) => {
    let preview = "Detect code hotspots";
    if (args.app_name) {
      preview += ` in app: ${args.app_name}`;
    }
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;

    const attrs: string[] = [];
    if (args.app_name) {
      attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
    }
    return `<dyad-hotspots ${attrs.join(" ")}>Analyzing...</dyad-hotspots>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
    const maxCommits = Math.min(args.max_commits ?? 200, 500);
    const limit = Math.min(args.limit ?? 10, 50);

    logger.log(`Analyzing hotspots in ${targetAppPath}`);

    ctx.onXmlStream(`<dyad-hotspots>Analyzing git history...</dyad-hotspots>`);

    // Collect git churn
    const churn = await collectGitChurn(targetAppPath, maxCommits);

    ctx.onXmlStream(`<dyad-hotspots>Building import graph...</dyad-hotspots>`);

    // Build import graph and compute PageRank
    const { nodes, edges } = await buildImportGraph(targetAppPath);
    const pageRankScores = computePageRank(nodes, edges);

    // Combine scores
    const maxChurn = Math.max(...Array.from(churn.values()), 1);
    const hotspots: Hotspot[] = [];

    for (const [fileId, importanceScore] of pageRankScores) {
      const churnCount = churn.get(fileId) || 0;
      const normalizedChurn = churnCount / maxChurn;
      const combined = normalizedChurn * 0.4 + importanceScore * 0.6;

      if (combined > 0.01) {
        const reasons: string[] = [];
        if (churnCount > 10) reasons.push(`changed in ${churnCount} commits`);
        if (importanceScore > 0.01)
          reasons.push(
            `high PageRank (${(importanceScore * 100).toFixed(1)}%)`,
          );

        hotspots.push({
          path: fileId,
          churnScore: churnCount,
          importanceScore,
          combinedScore: combined,
          reason: reasons.join(", ") || "moderate activity",
        });
      }
    }

    // Sort by combined score and limit
    hotspots.sort((a, b) => b.combinedScore - a.combinedScore);
    const limitedHotspots = hotspots.slice(0, limit);

    // Format output
    const attrs = [
      `count="${limitedHotspots.length}"`,
      `total="${hotspots.length}"`,
      `commits="${maxCommits}"`,
    ];

    if (args.app_name) {
      attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
    }

    if (limitedHotspots.length === 0) {
      ctx.onXmlComplete(
        `<dyad-hotspots ${attrs.join(" ")}>No hotspots detected.</dyad-hotspots>`,
      );
      return "No hotspots detected.";
    }

    const lines = limitedHotspots.map(
      (h, i) =>
        `${i + 1}. ${h.path}\n   Churn: ${h.churnScore}, Importance: ${(h.importanceScore * 100).toFixed(1)}%, Combined: ${(h.combinedScore * 100).toFixed(1)}%\n   Reason: ${h.reason}`,
    );
    const resultText = lines.join("\n\n");

    ctx.onXmlComplete(
      `<dyad-hotspots ${attrs.join(" ")}>\n${escapeXmlContent(resultText)}\n</dyad-hotspots>`,
    );

    return resultText;
  },
};
