import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { resolveTargetAppPath } from "./resolve_app_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import log from "electron-log";
import { walkDirectory } from "./file_utils";

const logger = log.scope("security_scan");

const DEFAULT_MAX_FILES = 500;
const MAX_MAX_FILES = 5000;

const securityScanSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
  max_files: z
    .number()
    .min(1)
    .max(MAX_MAX_FILES)
    .optional()
    .describe(
      `Maximum number of files to scan (default: ${DEFAULT_MAX_FILES}, max: ${MAX_MAX_FILES}).`,
    ),
});

const DESCRIPTION = `Scan for security vulnerabilities in code.

- Returns overall score (0-100) and list of findings
- Detects: SQL Injection, XSS, Command Injection, Path Traversal, Hardcoded Secrets, Weak Crypto, Unsafe Eval
- Use for security audits and pre-deployment checks`;

interface SecurityFinding {
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  line: number;
  message: string;
  recommendation: string;
}

interface SecurityReport {
  file: string;
  findings: SecurityFinding[];
  score: number;
}

export const VULNERABILITY_PATTERNS: Array<{
  pattern: RegExp;
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  recommendation: string;
}> = [
  {
    pattern: /(?:query|execute|sql)`[^`]*\$\{[^}]+\}/gi,
    type: "sql_injection",
    severity: "critical",
    message: "Template literal in SQL query",
    recommendation: "Use parameterized queries",
  },
  {
    pattern: /(?:query|execute)\s*\(\s*['"][^'"]*\+/gi,
    type: "sql_injection",
    severity: "critical",
    message: "String concatenation in SQL query",
    recommendation: "Use parameterized queries",
  },
  {
    pattern: /innerHTML\s*=/gi,
    type: "xss",
    severity: "high",
    message: "Direct innerHTML assignment",
    recommendation: "Use textContent or sanitize input",
  },
  {
    pattern: /dangerouslySetInnerHTML/gi,
    type: "xss",
    severity: "high",
    message: "dangerouslySetInnerHTML usage",
    recommendation: "Sanitize HTML before rendering",
  },
  {
    pattern: /document\.write\s*\(/gi,
    type: "xss",
    severity: "high",
    message: "document.write usage",
    recommendation: "Use DOM manipulation methods",
  },
  {
    pattern: /exec\s*\(\s*[^)]*\$/gi,
    type: "command_injection",
    severity: "critical",
    message: "Variable in exec command",
    recommendation: "Use execFile with argument array",
  },
  {
    pattern: /child_process\.exec/gi,
    type: "command_injection",
    severity: "medium",
    message: "exec usage",
    recommendation: "Prefer execFile for safety",
  },
  {
    pattern: /readFile\s*\(\s*[^)]*\+/gi,
    type: "path_traversal",
    severity: "high",
    message: "Dynamic file path",
    recommendation: "Validate and sanitize file paths",
  },
  {
    pattern: /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}/gi,
    type: "hardcoded_secret",
    severity: "critical",
    message: "Potential hardcoded secret",
    recommendation: "Use environment variables",
  },
  {
    pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/g,
    type: "hardcoded_secret",
    severity: "critical",
    message: "AWS access key detected",
    recommendation: "Rotate key and use IAM roles",
  },
  {
    pattern: /ghp_[A-Za-z0-9]{36}/g,
    type: "hardcoded_secret",
    severity: "critical",
    message: "GitHub token detected",
    recommendation: "Use environment variables",
  },
  {
    pattern: /(?:md5|sha1)\s*\(/gi,
    type: "weak_crypto",
    severity: "medium",
    message: "Weak hash algorithm",
    recommendation: "Use SHA-256 or stronger",
  },
  {
    pattern: /Math\.random\s*\(/gi,
    type: "insecure_random",
    severity: "medium",
    message: "Math.random() for security",
    recommendation: "Use crypto.randomBytes()",
  },
  {
    pattern: /eval\s*\(\s*[^)]*\)/gi,
    type: "unsafe_eval",
    severity: "high",
    message: "eval() usage",
    recommendation: "Avoid eval, use safer alternatives",
  },
];

function analyzeFile(filePath: string, content: string): SecurityReport {
  const findings: SecurityFinding[] = [];
  const lines = content.split("\n");

  for (const {
    pattern,
    type,
    severity,
    message,
    recommendation,
  } of VULNERABILITY_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split("\n").length;
      if (lineNum <= lines.length) {
        findings.push({
          type,
          severity,
          line: lineNum,
          message,
          recommendation,
        });
      }
    }
  }

  let score = 100;
  for (const f of findings) {
    switch (f.severity) {
      case "critical":
        score -= 20;
        break;
      case "high":
        score -= 10;
        break;
      case "medium":
        score -= 5;
        break;
      case "low":
        score -= 2;
        break;
    }
  }

  return { file: filePath, findings, score: Math.max(0, score) };
}

function buildAttributes(
  args: Partial<z.infer<typeof securityScanSchema>>,
  stats?: { score: number; findings: number; critical: number; high: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (stats) {
    attrs.push(`score="${stats.score}"`);
    attrs.push(`findings="${stats.findings}"`);
    attrs.push(`critical="${stats.critical}"`);
    attrs.push(`high="${stats.high}"`);
  }
  return attrs.join(" ");
}

export const securityScanTool: ToolDefinition<
  z.infer<typeof securityScanSchema>
> = {
  name: "security_scan",
  description: DESCRIPTION,
  inputSchema: securityScanSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Scan for security vulnerabilities";
    if (args.app_name) preview += ` in app: ${args.app_name}`;
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-security-scan ${buildAttributes(args)}>Scanning for vulnerabilities...</dyad-security-scan>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
    const maxFiles = Math.min(
      args.max_files ?? DEFAULT_MAX_FILES,
      MAX_MAX_FILES,
    );

    logger.log(`Security scanning ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-security-scan ${buildAttributes(args)}>Scanning ${maxFiles} files...</dyad-security-scan>`,
    );

    try {
      const files = await walkDirectory(targetAppPath, {
        maxFiles,
        filePattern: /\.(ts|tsx|js|jsx|py|go|rs|java|rb|php)$/,
      });
      const reports: SecurityReport[] = [];

      for (const file of files) {
        try {
          // Skip files larger than 1MB to prevent memory issues
          try {
            const stat = await fs.stat(file);
            if (stat.size > 1024 * 1024) continue;
          } catch {
            continue;
          }
          const content = await fs.readFile(file, "utf-8");
          const relativePath = path.relative(targetAppPath, file);
          const report = analyzeFile(relativePath, content);
          if (report.findings.length > 0) reports.push(report);
        } catch {
          // Skip unreadable files
        }
      }

      reports.sort((a, b) => a.score - b.score);
      const totalFindings = reports.reduce(
        (sum, r) => sum + r.findings.length,
        0,
      );
      const critical = reports.reduce(
        (sum, r) =>
          sum + r.findings.filter((f) => f.severity === "critical").length,
        0,
      );
      const high = reports.reduce(
        (sum, r) =>
          sum + r.findings.filter((f) => f.severity === "high").length,
        0,
      );
      const avgScore =
        reports.length > 0
          ? Math.round(
              reports.reduce((sum, r) => sum + r.score, 0) / reports.length,
            )
          : 100;

      const attrs = buildAttributes(args, {
        score: avgScore,
        findings: totalFindings,
        critical,
        high,
      });

      if (reports.length === 0) {
        ctx.onXmlComplete(
          `<dyad-security-scan ${attrs}>No security vulnerabilities detected.</dyad-security-scan>`,
        );
        return "No security vulnerabilities detected.";
      }

      const lines = reports.slice(0, 10).map(
        (r, i) =>
          `${i + 1}. ${r.file} (score: ${r.score})\n   ${r.findings
            .slice(0, 3)
            .map((f) => `- [${f.severity}] ${f.type}: ${f.message}`)
            .join("\n   ")}`,
      );

      const resultText = `Security Score: ${avgScore}/100\nCritical: ${critical}\nHigh: ${high}\nTotal Findings: ${totalFindings}\n\nVulnerable Files:\n${lines.join("\n\n")}`;

      ctx.onXmlComplete(
        `<dyad-security-scan ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-security-scan>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to scan for security vulnerabilities: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
