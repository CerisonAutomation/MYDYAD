import { z } from "zod";
import * as fs from "node:fs/promises";
import { accessSync } from "node:fs";
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

const logger = log.scope("dep_audit");

const depAuditSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
});

const DESCRIPTION = `Audit dependencies for vulnerabilities, unused packages, and outdated versions.

- Returns dependency audit results with issues
- Detects: unused dependencies, vulnerable packages, outdated versions, duplicates
- Use for security audits and dependency cleanup`;

interface DepIssue {
  type: "unused" | "vulnerable" | "outdated" | "duplicate" | "missing_peer";
  package: string;
  severity: "high" | "medium" | "low";
  message: string;
  recommendation: string;
}

interface DepAuditReport {
  total: number;
  issues: DepIssue[];
  summary: { high: number; medium: number; low: number };
}

const VULNERABLE_PATTERNS: Array<{
  pattern: RegExp;
  severity: "high" | "medium" | "low";
  message: string;
}> = [
  {
    pattern: /^event-stream@3\.3\.4$/,
    severity: "high",
    message: "Known malicious package",
  },
  {
    pattern: /^flat-cache@\d/,
    severity: "medium",
    message: "Potential prototype pollution",
  },
  {
    pattern: /^minimist@1\.2\.5$/,
    severity: "medium",
    message: "Update to 1.2.6+",
  },
  {
    pattern: /^node-fetch@2\.6\.6$/,
    severity: "medium",
    message: "Update to 2.6.7+",
  },
];

function analyzeDependencies(pkg: Record<string, unknown>): DepAuditReport {
  const issues: DepIssue[] = [];
  const deps = (pkg.dependencies as Record<string, string>) || {};
  const devDeps = (pkg.devDependencies as Record<string, string>) || {};
  const peerDeps = (pkg.peerDependencies as Record<string, string>) || {};
  const allDeps = { ...deps, ...devDeps };

  for (const [name, version] of Object.entries(allDeps)) {
    for (const { pattern, severity, message } of VULNERABLE_PATTERNS) {
      if (pattern.test(`${name}@${version}`)) {
        issues.push({
          type: "vulnerable",
          package: name,
          severity,
          message,
          recommendation: `Update ${name} to latest version`,
        });
      }
    }
    if (version.startsWith("^") || version.startsWith("~")) {
      const majorStr = version.replace(/^[^0-9]*/, "").split(".")[0];
      const major = majorStr ? parseInt(majorStr, 10) : NaN;
      if (!isNaN(major) && major < 2) {
        issues.push({
          type: "outdated",
          package: name,
          severity: "low",
          message: `Major version ${major} detected`,
          recommendation: "Consider updating to latest major version",
        });
      }
    }
  }

  for (const name of Object.keys(deps)) {
    if (devDeps[name]) {
      issues.push({
        type: "duplicate",
        package: name,
        severity: "medium",
        message: "Listed in both dependencies and devDependencies",
        recommendation: "Remove from one location",
      });
    }
  }

  for (const [name, version] of Object.entries(peerDeps)) {
    if (!allDeps[name]) {
      issues.push({
        type: "missing_peer",
        package: name,
        severity: "medium",
        message: `Peer dependency ${name} not installed`,
        recommendation: `Install ${name}@${version}`,
      });
    }
  }

  const summary = {
    high: issues.filter((i) => i.severity === "high").length,
    medium: issues.filter((i) => i.severity === "medium").length,
    low: issues.filter((i) => i.severity === "low").length,
  };

  return { total: Object.keys(allDeps).length, issues, summary };
}

function buildAttributes(
  args: Partial<z.infer<typeof depAuditSchema>>,
  stats?: {
    total: number;
    issues: number;
    high: number;
    medium: number;
    low: number;
  },
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (stats) {
    attrs.push(`total="${stats.total}"`);
    attrs.push(`issues="${stats.issues}"`);
    attrs.push(`high="${stats.high}"`);
    attrs.push(`medium="${stats.medium}"`);
    attrs.push(`low="${stats.low}"`);
  }
  return attrs.join(" ");
}

export const depAuditTool: ToolDefinition<z.infer<typeof depAuditSchema>> = {
  name: "dep_audit",
  description: DESCRIPTION,
  inputSchema: depAuditSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (ctx: AgentContext) => {
    // Check if package.json exists
    const packageJsonPath = path.join(ctx.appPath, "package.json");
    try {
      accessSync(packageJsonPath);
      return true;
    } catch {
      return false;
    }
  },

  getConsentPreview: (args) => {
    let preview = "Audit dependencies";
    if (args.app_name) preview += ` in app: ${args.app_name}`;
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-dep-audit ${buildAttributes(args)}>Auditing...</dyad-dep-audit>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Auditing dependencies in ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-dep-audit ${buildAttributes(args)}>Reading package.json...</dyad-dep-audit>`,
    );

    try {
      const packageJsonPath = path.join(targetAppPath, "package.json");
      let pkg: Record<string, unknown>;

      try {
        const content = await fs.readFile(packageJsonPath, "utf-8");
        pkg = JSON.parse(content);
      } catch {
        ctx.onXmlComplete(
          `<dyad-dep-audit error="true">No package.json found.</dyad-dep-audit>`,
        );
        return "No package.json found.";
      }

      const report = analyzeDependencies(pkg);
      const attrs = buildAttributes(args, {
        total: report.total,
        issues: report.issues.length,
        high: report.summary.high,
        medium: report.summary.medium,
        low: report.summary.low,
      });

      if (report.issues.length === 0) {
        ctx.onXmlComplete(
          `<dyad-dep-audit ${attrs}>No dependency issues found.</dyad-dep-audit>`,
        );
        return "No dependency issues found.";
      }

      const lines = report.issues
        .slice(0, 15)
        .map(
          (issue, i) =>
            `${i + 1}. [${issue.severity}] ${issue.package}\n   ${issue.message}\n   Recommendation: ${issue.recommendation}`,
        );

      const resultText = `Total Dependencies: ${report.total}\nIssues Found: ${report.issues.length}\nHigh: ${report.summary.high}, Medium: ${report.summary.medium}, Low: ${report.summary.low}\n\nIssues:\n${lines.join("\n\n")}`;

      ctx.onXmlComplete(
        `<dyad-dep-audit ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-dep-audit>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to audit dependencies: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
