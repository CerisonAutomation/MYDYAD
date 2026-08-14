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

const logger = log.scope("codeql_scan");

const codeqlScanSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app.",
    ),
  language: z
    .enum([
      "javascript",
      "typescript",
      "python",
      "java",
      "go",
      "ruby",
      "cpp",
      "csharp",
    ])
    .optional()
    .describe("Programming language to analyze (default: auto-detect)"),
  queries: z
    .string()
    .optional()
    .describe(
      "Query suite to run (e.g., 'security-and-quality', 'security-extended')",
    ),
  threads: z
    .number()
    .int()
    .min(1)
    .max(16)
    .optional()
    .describe("Number of threads (default: 4)"),
});

const DESCRIPTION = `Deep semantic code analysis using GitHub CodeQL.

- Creates database of code structure and runs semantic queries
- Detects: complex security vulnerabilities, data flow issues, injection attacks
- More thorough than pattern-based tools (Semgrep)
- Use for deep security audits and compliance checks

Query Suites:
- security-and-quality - Comprehensive security + quality (default)
- security-extended - Extended security rules
- security-experimental - Experimental security rules

Example: "Scan JavaScript code with security queries."`;

interface CodeQLFinding {
  ruleId: string;
  message: string;
  severity: string;
  file: string;
  line: number;
  column: number;
  url?: string;
}

interface CodeQLResult {
  findings: CodeQLFinding[];
  errors: string[];
  stats: {
    language: string;
    filesAnalyzed: number;
    findingsCount: number;
  };
}

function runCodeQL(
  root: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn("codeql", args, { cwd: root });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code || 0 });
    });

    proc.on("error", () => {
      resolve({ stdout: "", stderr: "codeql not found", exitCode: 1 });
    });
  });
}

async function analyzeWithCodeQL(
  root: string,
  language: string | undefined,
  queries: string | undefined,
  threads: number,
): Promise<CodeQLResult> {
  const lang = language || "javascript";
  const querySuite = queries || "security-and-quality";

  // Step 1: Create database
  logger.log("Creating CodeQL database...");
  const dbResult = await runCodeQL(root, [
    "database",
    "create",
    "codeql-db",
    "--language",
    lang,
    "--overwrite",
    "--threads",
    String(threads),
  ]);

  if (dbResult.exitCode !== 0) {
    return {
      findings: [],
      errors: [`Failed to create database: ${dbResult.stderr}`],
      stats: { language: lang, filesAnalyzed: 0, findingsCount: 0 },
    };
  }

  // Step 2: Analyze database
  logger.log("Analyzing CodeQL database...");
  const analyzeResult = await runCodeQL(root, [
    "database",
    "analyze",
    "codeql-db",
    "codeql-results",
    "--format=sarif-latest",
    "--query-suite",
    querySuite,
    "--threads",
    String(threads),
  ]);

  if (analyzeResult.exitCode !== 0) {
    return {
      findings: [],
      errors: [`Failed to analyze: ${analyzeResult.stderr}`],
      stats: { language: lang, filesAnalyzed: 0, findingsCount: 0 },
    };
  }

  // Parse SARIF output
  try {
    const sarif = JSON.parse(analyzeResult.stdout);
    const findings: CodeQLFinding[] = [];

    for (const run of sarif.runs || []) {
      for (const result of run.results || []) {
        const loc = result.locations?.[0]?.physicalLocation;
        findings.push({
          ruleId: result.ruleId || "unknown",
          message: result.message?.text || "No message",
          severity: result.level || "warning",
          file: loc?.artifactLocation?.uri || "unknown",
          line: loc?.region?.startLine || 0,
          column: loc?.region?.startColumn || 0,
          url: result.ruleIndex?.helpUri,
        });
      }
    }

    return {
      findings,
      errors: [],
      stats: {
        language: lang,
        filesAnalyzed: sarif.runs?.[0]?.tool?.driver?.rules?.length || 0,
        findingsCount: findings.length,
      },
    };
  } catch {
    return {
      findings: [],
      errors: ["Failed to parse SARIF output"],
      stats: { language: lang, filesAnalyzed: 0, findingsCount: 0 },
    };
  }
}

function buildAttributes(
  args: Partial<z.infer<typeof codeqlScanSchema>>,
  result?: CodeQLResult,
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (args.language) attrs.push(`language="${args.language}"`);
  if (args.queries) attrs.push(`queries="${escapeXmlAttr(args.queries)}"`);
  if (result) {
    attrs.push(`language="${result.stats.language}"`);
    attrs.push(`findings="${result.stats.findingsCount}"`);
  }
  return attrs.join(" ");
}

export const codeqlScanTool: ToolDefinition<z.infer<typeof codeqlScanSchema>> =
  {
    name: "codeql_scan",
    description: DESCRIPTION,
    inputSchema: codeqlScanSchema,
    defaultConsent: "always",
    modifiesState: false,

    isEnabled: (_ctx: AgentContext) => true,

    getConsentPreview: (args) => {
      let preview = "Scan with CodeQL";
      if (args.language) preview += ` (${args.language})`;
      if (args.queries) preview += ` using ${args.queries}`;
      return preview;
    },

    buildXml: (args, isComplete) => {
      if (isComplete) return undefined;
      return `<dyad-codeql ${buildAttributes(args)}>Analyzing...</dyad-codeql>`;
    },

    execute: async (args, ctx: AgentContext) => {
      const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
      const threads = args.threads || 4;

      logger.log(`Scanning with CodeQL: ${args.language || "auto-detect"}`);
      ctx.onXmlStream(
        `<dyad-codeql ${buildAttributes(args)}>Creating database...</dyad-codeql>`,
      );

      try {
        const result = await analyzeWithCodeQL(
          targetAppPath,
          args.language,
          args.queries,
          threads,
        );

        const attrs = buildAttributes(args, result);

        if (result.errors.length > 0) {
          const errorText = `CodeQL Errors:\n${result.errors.map((e) => `- ${e}`).join("\n")}`;
          ctx.onXmlComplete(
            `<dyad-codeql ${attrs} error="true">\n${escapeXmlContent(errorText)}\n</dyad-codeql>`,
          );
          return errorText;
        }

        if (result.findings.length === 0) {
          const resultText = `✅ No issues found (${result.stats.language} analysis)`;
          ctx.onXmlComplete(
            `<dyad-codeql ${attrs}>${resultText}</dyad-codeql>`,
          );
          return resultText;
        }

        // Group by severity
        const bySeverity = {
          error: result.findings.filter((f) => f.severity === "error"),
          warning: result.findings.filter((f) => f.severity === "warning"),
          note: result.findings.filter((f) => f.severity === "note"),
        };

        let resultText = `CodeQL Results (${result.stats.language}):\n`;
        resultText += `Findings: ${result.stats.findingsCount}\n\n`;

        if (bySeverity.error.length > 0) {
          resultText += `🔴 ERRORS (${bySeverity.error.length}):\n`;
          bySeverity.error.slice(0, 10).forEach((f) => {
            resultText += `  - ${f.file}:${f.line} - ${f.ruleId}\n    ${f.message}\n`;
          });
        }

        if (bySeverity.warning.length > 0) {
          resultText += `\n🟡 WARNINGS (${bySeverity.warning.length}):\n`;
          bySeverity.warning.slice(0, 10).forEach((f) => {
            resultText += `  - ${f.file}:${f.line} - ${f.ruleId}\n    ${f.message}\n`;
          });
        }

        if (bySeverity.note.length > 0) {
          resultText += `\nℹ️ NOTES (${bySeverity.note.length}):\n`;
          bySeverity.note.slice(0, 5).forEach((f) => {
            resultText += `  - ${f.file}:${f.line} - ${f.ruleId}\n    ${f.message}\n`;
          });
        }

        ctx.onXmlComplete(
          `<dyad-codeql ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-codeql>`,
        );
        return resultText;
      } catch (error) {
        if (error instanceof DyadError) throw error;
        throw new DyadError(
          `Failed to run CodeQL scan: ${error instanceof Error ? error.message : String(error)}`,
          DyadErrorKind.Unknown,
        );
      }
    },
  };
