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
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import log from "electron-log";

const logger = log.scope("diff_impact");

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

/** Validate that a ref string looks like a safe git ref (branch, tag, or SHA). */
function isValidGitRef(ref: string): boolean {
  return /^[a-zA-Z0-9._/\-@]+$/.test(ref);
}

const diffImpactSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
  base_ref: z
    .string()
    .optional()
    .describe("Base ref to compare against (default: HEAD~1)"),
  head_ref: z
    .string()
    .optional()
    .describe("Head ref to compare (default: HEAD)"),
});

const DESCRIPTION = `Analyze diff impact by tracing downstream dependencies.

- Shows which files are affected by changes in the diff
- Traces import graph to find blast radius
- Identifies test files that should be run
- Use for pre-merge impact analysis and code review`;

interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted";
  changes: number;
}

interface ImpactResult {
  directChanges: DiffFile[];
  affectedFiles: string[];
  testFiles: string[];
  blastRadius: number;
}

async function analyzeDiff(
  root: string,
  baseRef: string,
  headRef: string,
): Promise<ImpactResult> {
  const diffOutput = await runGit(root, [
    "diff",
    "--name-status",
    `${baseRef}...${headRef}`,
  ]);
  const lines = diffOutput.split("\n").filter(Boolean);

  const directChanges: DiffFile[] = [];
  for (const line of lines) {
    const [status, filePath] = line.split("\t");
    if (filePath) {
      directChanges.push({
        path: filePath,
        status:
          status === "A" ? "added" : status === "D" ? "deleted" : "modified",
        changes: 0,
      });
    }
  }

  // Find affected files through import analysis
  const affectedFiles: string[] = [];
  const testFiles: string[] = [];

  for (const file of directChanges) {
    // Find files that import this file
    const grepOutput = await runGit(root, [
      "grep",
      "-l",
      file.path,
      "--",
      "*.ts",
      "*.tsx",
      "*.js",
      "*.jsx",
    ]);
    const importingFiles = grepOutput.split("\n").filter(Boolean);
    affectedFiles.push(...importingFiles);

    // Find corresponding test files
    const _testPattern = file.path.replace(/\.(ts|tsx|js|jsx)$/, ".test.$1");
    const _specPattern = file.path.replace(/\.(ts|tsx|js|jsx)$/, ".spec.$1");
    if (
      importingFiles.some((f) => f.includes(".test.") || f.includes(".spec."))
    ) {
      testFiles.push(
        ...importingFiles.filter(
          (f) => f.includes(".test.") || f.includes("."),
        ),
      );
    }
  }

  // Deduplicate
  const uniqueAffected = [...new Set(affectedFiles)];
  const uniqueTests = [...new Set(testFiles)];

  return {
    directChanges,
    affectedFiles: uniqueAffected,
    testFiles: uniqueTests,
    blastRadius: uniqueAffected.length,
  };
}

function buildAttributes(
  args: Partial<z.infer<typeof diffImpactSchema>>,
  result?: ImpactResult,
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (args.base_ref) attrs.push(`base="${escapeXmlAttr(args.base_ref)}"`);
  if (args.head_ref) attrs.push(`head="${escapeXmlAttr(args.head_ref)}"`);
  if (result) {
    attrs.push(`changed="${result.directChanges.length}"`);
    attrs.push(`affected="${result.affectedFiles.length}"`);
    attrs.push(`tests="${result.testFiles.length}"`);
    attrs.push(`blast_radius="${result.blastRadius}"`);
  }
  return attrs.join(" ");
}

export const diffImpactTool: ToolDefinition<z.infer<typeof diffImpactSchema>> =
  {
    name: "diff_impact",
    description: DESCRIPTION,
    inputSchema: diffImpactSchema,
    defaultConsent: "always",
    modifiesState: false,

    isEnabled: (ctx: AgentContext) => {
      // Check if git repo
      const gitPath = require("node:path").join(ctx.appPath, ".git");
      try {
        require("node:fs").accessSync(gitPath);
        return true;
      } catch {
        return false;
      }
    },

    getConsentPreview: (args) => {
      let preview = "Analyze diff impact";
      if (args.app_name) preview += ` in app: ${args.app_name}`;
      if (args.base_ref) preview += ` from ${args.base_ref}`;
      return preview;
    },

    buildXml: (args, isComplete) => {
      if (isComplete) return undefined;
      return `<dyad-diff-impact ${buildAttributes(args)}>Analyzing diff...</dyad-diff-impact>`;
    },

    execute: async (args, ctx: AgentContext) => {
      const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
      const baseRef = args.base_ref || "HEAD~1";
      const headRef = args.head_ref || "HEAD";

      // Validate ref strings to prevent git argument injection
      if (!isValidGitRef(baseRef) || !isValidGitRef(headRef)) {
        throw new DyadError(
          "Invalid ref: only alphanumeric, dots, slashes, hyphens, underscores, and @ are allowed",
          DyadErrorKind.Validation,
        );
      }

      logger.log(`Analyzing diff impact from ${baseRef} to ${headRef}`);
      ctx.onXmlStream(
        `<dyad-diff-impact ${buildAttributes(args)}>Tracing dependencies...</dyad-diff-impact>`,
      );

      try {
        const result = await analyzeDiff(targetAppPath, baseRef, headRef);
        const attrs = buildAttributes(args, result);

        let resultText = `Diff Impact Analysis\n`;
        resultText += `Comparing: ${baseRef} → ${headRef}\n\n`;

        resultText += `📁 Direct Changes (${result.directChanges.length}):\n`;
        result.directChanges.forEach((f) => {
          resultText += `  - [${f.status}] ${f.path}\n`;
        });

        resultText += `\n🔗 Affected Files (${result.affectedFiles.length}):\n`;
        result.affectedFiles.slice(0, 10).forEach((f) => {
          resultText += `  - ${f}\n`;
        });
        if (result.affectedFiles.length > 10) {
          resultText += `  ... and ${result.affectedFiles.length - 10} more\n`;
        }

        resultText += `\n🧪 Test Files to Run (${result.testFiles.length}):\n`;
        result.testFiles.slice(0, 5).forEach((f) => {
          resultText += `  - ${f}\n`;
        });

        resultText += `\n💥 Blast Radius: ${result.blastRadius} files affected`;

        ctx.onXmlComplete(
          `<dyad-diff-impact ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-diff-impact>`,
        );
        return resultText;
      } catch (error) {
        if (error instanceof DyadError) throw error;
        throw new DyadError(
          `Failed to analyze diff impact: ${error instanceof Error ? error.message : String(error)}`,
          DyadErrorKind.Unknown,
        );
      }
    },
  };
