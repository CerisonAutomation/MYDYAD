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

const logger = log.scope("semgrep_scan");

const semgrepScanSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app.",
    ),
  path: z
    .string()
    .optional()
    .describe("Specific path to scan (default: entire repo)"),
  rules: z
    .string()
    .optional()
    .describe(
      "Rule pack or custom rules (e.g., 'p/security-audit', 'p/owasp-top-ten')",
    ),
  severity: z
    .enum(["ERROR", "WARNING", "INFO"])
    .optional()
    .describe("Minimum severity to report (default: WARNING)"),
  config: z
    .string()
    .optional()
    .describe("Custom rule file or config (e.g., '.semgrep.yml')"),
});

const DESCRIPTION = `Static analysis using Semgrep rules for security and code quality.

- Scans code with 2000+ community rules
- Supports custom rules and rule packs
- Detects: security vulnerabilities, code smells, bugs
- Use for security audits and code quality checks

Rule Packs:
- p/security-audit - Security-focused rules
- p/owasp-top-ten - OWASP Top 10 vulnerabilities
- p/javascript - JavaScript best practices
- p/typescript - TypeScript best practices
- p/python - Python best practices

Example: "Scan src/payments with security rules. Show only ERROR."`;

interface SemgrepFinding {
  ruleId: string;
  message: string;
  severity: string;
  file: string;
  line: number;
  column: number;
  fix?: string;
}

interface SemgrepResult {
  findings: SemgrepFinding[];
  errors: string[];
  stats: {
    filesScanned: number;
    findingsCount: number;
    errorsCount: number;
  };
}

function runSemgrep(
  root: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn("semgrep", args, { cwd: root });
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
      resolve({ stdout: "", stderr: "semgrep not found", exitCode: 1 });
    });
  });
}

async function scanWithSemgrep(
  root: string,
  path: string | undefined,
  rules: string | undefined,
  severity: string,
  config: string | undefined,
): Promise<SemgrepResult> {
  const args = ["--json", "--severity", severity];

  if (path) {
    args.push(path);
  } else {
    args.push(".");
  }

  if (rules) {
    args.push("--config", rules);
  }

  if (config) {
    args.push("--config", config);
  }

  const result = await runSemgrep(root, args);

  if (result.exitCode === 127) {
    return {
      findings: [],
      errors: ["Semgrep not installed. Install with: pip install semgrep"],
      stats: { filesScanned: 0, findingsCount: 0, errorsCount: 1 },
    };
  }

  try {
    const output = JSON.parse(result.stdout);
    const findings: SemgrepFinding[] = [];

    for (const r of output.results || []) {
      findings.push({
        ruleId: r.check_id || "unknown",
        message: r.extra?.message || "No message",
        severity: r.extra?.severity || "WARNING",
        file: r.path || "unknown",
        line: r.start?.line || 0,
        column: r.start?.col || 0,
        fix: r.extra?.fix,
      });
    }

    return {
      findings,
      errors: result.stderr ? [result.stderr] : [],
      stats: {
        filesScanned: output.stats?.files_scanned || 0,
        findingsCount: findings.length,
        errorsCount: result.stderr ? 1 : 0,
      },
    };
  } catch {
    return {
      findings: [],
      errors: [`Failed to parse semgrep output: ${result.stderr}`],
      stats: { filesScanned: 0, findingsCount: 0, errorsCount: 1 },
    };
  }
}

function buildAttributes(
  args: Partial<z.infer<typeof semgrepScanSchema>>,
  result?: SemgrepResult,
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (args.path) attrs.push(`path="${escapeXmlAttr(args.path)}"`);
  if (args.rules) attrs.push(`rules="${escapeXmlAttr(args.rules)}"`);
  if (args.severity) attrs.push(`severity="${args.severity}"`);
  if (result) {
    attrs.push(`files="${result.stats.filesScanned}"`);
    attrs.push(`findings="${result.stats.findingsCount}"`);
    attrs.push(`errors="${result.stats.errorsCount}"`);
  }
  return attrs.join(" ");
}

export const semgrepScanTool: ToolDefinition<
  z.infer<typeof semgrepScanSchema>
> = {
  name: "semgrep_scan",
  description: DESCRIPTION,
  inputSchema: semgrepScanSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Scan with Semgrep";
    if (args.path) preview += ` in ${args.path}`;
    if (args.rules) preview += ` using ${args.rules}`;
    if (args.severity) preview += ` (severity: ${args.severity})`;
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-semgrep ${buildAttributes(args)}>Scanning...</dyad-semgrep>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
    const severity = args.severity || "WARNING";

    logger.log(`Scanning with Semgrep: ${args.path || "entire repo"}`);
    ctx.onXmlStream(
      `<dyad-semgrep ${buildAttributes(args)}>Running Semgrep...</dyad-semgrep>`,
    );

    try {
      const result = await scanWithSemgrep(
        targetAppPath,
        args.path,
        args.rules,
        severity,
        args.config,
      );

      const attrs = buildAttributes(args, result);

      if (result.errors.length > 0) {
        const errorText = `Semgrep Errors:\n${result.errors.map((e) => `- ${e}`).join("\n")}`;
        ctx.onXmlComplete(
          `<dyad-semgrep ${attrs} error="true">\n${escapeXmlContent(errorText)}\n</dyad-semgrep>`,
        );
        return errorText;
      }

      if (result.findings.length === 0) {
        const resultText = `✅ No issues found (scanned ${result.stats.filesScanned} files)`;
        ctx.onXmlComplete(
          `<dyad-semgrep ${attrs}>${resultText}</dyad-semgrep>`,
        );
        return resultText;
      }

      // Group by severity
      const bySeverity = {
        ERROR: result.findings.filter((f) => f.severity === "ERROR"),
        WARNING: result.findings.filter((f) => f.severity === "WARNING"),
        INFO: result.findings.filter((f) => f.severity === "INFO"),
      };

      let resultText = `Semgrep Results:\n`;
      resultText += `Files scanned: ${result.stats.filesScanned}\n`;
      resultText += `Findings: ${result.stats.findingsCount}\n\n`;

      if (bySeverity.ERROR.length > 0) {
        resultText += `🔴 ERRORS (${bySeverity.ERROR.length}):\n`;
        bySeverity.ERROR.slice(0, 10).forEach((f) => {
          resultText += `  - ${f.file}:${f.line} - ${f.ruleId}\n    ${f.message}\n`;
        });
      }

      if (bySeverity.WARNING.length > 0) {
        resultText += `\n🟡 WARNINGS (${bySeverity.WARNING.length}):\n`;
        bySeverity.WARNING.slice(0, 10).forEach((f) => {
          resultText += `  - ${f.file}:${f.line} - ${f.ruleId}\n    ${f.message}\n`;
        });
      }

      if (bySeverity.INFO.length > 0) {
        resultText += `\nℹ️ INFO (${bySeverity.INFO.length}):\n`;
        bySeverity.INFO.slice(0, 5).forEach((f) => {
          resultText += `  - ${f.file}:${f.line} - ${f.ruleId}\n    ${f.message}\n`;
        });
      }

      ctx.onXmlComplete(
        `<dyad-semgrep ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-semgrep>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to run Semgrep scan: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
