/**
 * UX Audit Tool — Analyzes user experience patterns in the codebase
 *
 * Detects:
 * - Missing loading states
 * - Missing error states
 * - Missing empty states
 * - Inconsistent spacing
 * - Poor typography hierarchy
 * - Missing responsive design
 * - Inconsistent color usage
 *
 * Returns structured report with file:line references and improvement suggestions
 */

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
import { resolveDirectoryWithinAppPath } from "./path_safety";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import log from "electron-log";

const logger = log.scope("ux_audit");

const uxAuditSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app to audit instead of the current app.",
    ),
  file_path: z
    .string()
    .optional()
    .describe("Specific file to audit. Omit to audit all files."),
});

const DESCRIPTION = `Audit user experience patterns in the codebase.

Detects:
- Missing loading states
- Missing error states
- Missing empty states
- Inconsistent spacing
- Poor typography hierarchy
- Missing responsive design
- Inconsistent color usage

Returns structured report with file:line references and improvement suggestions`;

function buildAttributes(
  args: Partial<z.infer<typeof uxAuditSchema>>,
  stats?: { issues: number; files: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) {
    attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  }
  if (args.file_path) {
    attrs.push(`file_path="${escapeXmlAttr(args.file_path)}"`);
  }
  if (stats) {
    attrs.push(`issues="${stats.issues}"`);
    attrs.push(`files="${stats.files}"`);
  }
  return attrs.join(" ");
}

function analyzeLoadingStates(
  content: string,
  filePath: string,
): Array<{
  line: number;
  issue: string;
  severity: "error" | "warning" | "info";
  suggestion: string;
}> {
  const issues: Array<{
    line: number;
    issue: string;
    severity: "error" | "warning" | "info";
    suggestion: string;
  }> = [];

  // Check for async operations without loading states
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for fetch without loading state
    if (
      line.includes("fetch(") &&
      !content.includes("loading") &&
      !content.includes("isLoading")
    ) {
      issues.push({
        line: lineNum,
        issue: "Fetch without loading state",
        severity: "warning",
        suggestion: "Add a loading state to indicate data is being fetched",
      });
    }

    // Check for async function without loading indicator
    if (
      line.includes("async function") &&
      !content.includes("loading") &&
      !content.includes("spinner")
    ) {
      issues.push({
        line: lineNum,
        issue: "Async function without loading indicator",
        severity: "info",
        suggestion:
          "Consider adding a loading indicator for long-running operations",
      });
    }
  }

  return issues;
}

function analyzeErrorStates(
  content: string,
  filePath: string,
): Array<{
  line: number;
  issue: string;
  severity: "error" | "warning" | "info";
  suggestion: string;
}> {
  const issues: Array<{
    line: number;
    issue: string;
    severity: "error" | "warning" | "info";
    suggestion: string;
  }> = [];

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for catch blocks without error handling
    if (line.includes("catch") && line.includes("{}")) {
      issues.push({
        line: lineNum,
        issue: "Empty catch block",
        severity: "error",
        suggestion: "Handle errors properly or at least log them",
      });
    }

    // Check for try without catch
    if (line.includes("try") && !content.includes("catch")) {
      issues.push({
        line: lineNum,
        issue: "Try without catch",
        severity: "warning",
        suggestion: "Add error handling for try blocks",
      });
    }
  }

  return issues;
}

function analyzeEmptyStates(
  content: string,
  filePath: string,
): Array<{
  line: number;
  issue: string;
  severity: "error" | "warning" | "info";
  suggestion: string;
}> {
  const issues: Array<{
    line: number;
    issue: string;
    severity: "error" | "warning" | "info";
    suggestion: string;
  }> = [];

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for lists without empty state
    if (
      line.includes(".map(") &&
      !content.includes("length === 0") &&
      !content.includes("isEmpty")
    ) {
      issues.push({
        line: lineNum,
        issue: "List without empty state",
        severity: "warning",
        suggestion: "Add an empty state for when the list has no items",
      });
    }

    // Check for data display without empty state
    if (
      line.includes("data.") &&
      !content.includes("No data") &&
      !content.includes("empty")
    ) {
      issues.push({
        line: lineNum,
        issue: "Data display without empty state",
        severity: "info",
        suggestion:
          "Consider adding an empty state for when data is unavailable",
      });
    }
  }

  return issues;
}

function analyzeSpacing(
  content: string,
  filePath: string,
): Array<{
  line: number;
  issue: string;
  severity: "error" | "warning" | "info";
  suggestion: string;
}> {
  const issues: Array<{
    line: number;
    issue: string;
    severity: "error" | "warning" | "info";
    suggestion: string;
  }> = [];

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for inconsistent spacing
    if (
      line.includes("margin:") &&
      line.match(/margin:\s*\d+px/) &&
      !line.includes("0px")
    ) {
      issues.push({
        line: lineNum,
        issue: "Hardcoded margin value",
        severity: "info",
        suggestion:
          "Consider using consistent spacing values from a design system",
      });
    }

    // Check for padding
    if (
      line.includes("padding:") &&
      line.match(/padding:\s*\d+px/) &&
      !line.includes("0px")
    ) {
      issues.push({
        line: lineNum,
        issue: "Hardcoded padding value",
        severity: "info",
        suggestion:
          "Consider using consistent spacing values from a design system",
      });
    }
  }

  return issues;
}

function analyzeTypography(
  content: string,
  filePath: string,
): Array<{
  line: number;
  issue: string;
  severity: "error" | "warning" | "info";
  suggestion: string;
}> {
  const issues: Array<{
    line: number;
    issue: string;
    severity: "error" | "warning" | "info";
    suggestion: string;
  }> = [];

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for font-size
    if (line.includes("font-size:") && line.match(/font-size:\s*\d+px/)) {
      issues.push({
        line: lineNum,
        issue: "Hardcoded font size",
        severity: "info",
        suggestion:
          "Consider using relative units (rem, em) for better accessibility",
      });
    }

    // Check for font-weight
    if (
      line.includes("font-weight:") &&
      !line.includes("normal") &&
      !line.includes("bold")
    ) {
      issues.push({
        line: lineNum,
        issue: "Unusual font weight",
        severity: "info",
        suggestion: "Use standard font weights (normal, bold, 100-900)",
      });
    }
  }

  return issues;
}

function analyzeResponsiveDesign(
  content: string,
  filePath: string,
): Array<{
  line: number;
  issue: string;
  severity: "error" | "warning" | "info";
  suggestion: string;
}> {
  const issues: Array<{
    line: number;
    issue: string;
    severity: "error" | "warning" | "info";
    suggestion: string;
  }> = [];

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for fixed widths
    if (
      line.includes("width:") &&
      line.match(/width:\s*\d+px/) &&
      !line.includes("min-") &&
      !line.includes("max-")
    ) {
      issues.push({
        line: lineNum,
        issue: "Fixed width without responsive fallback",
        severity: "warning",
        suggestion: "Consider using max-width or responsive breakpoints",
      });
    }

    // Check for fixed heights
    if (
      line.includes("height:") &&
      line.match(/height:\s*\d+px/) &&
      !line.includes("min-") &&
      !line.includes("max-")
    ) {
      issues.push({
        line: lineNum,
        issue: "Fixed height without responsive fallback",
        severity: "warning",
        suggestion: "Consider using min-height or responsive breakpoints",
      });
    }
  }

  return issues;
}

function analyzeColorUsage(
  content: string,
  filePath: string,
): Array<{
  line: number;
  issue: string;
  severity: "error" | "warning" | "info";
  suggestion: string;
}> {
  const issues: Array<{
    line: number;
    issue: string;
    severity: "error" | "warning" | "info";
    suggestion: string;
  }> = [];

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for hardcoded colors
    if (
      line.match(/color:\s*#[0-9a-fA-F]{6}/) ||
      line.match(/background-color:\s*#[0-9a-fA-F]{6}/)
    ) {
      issues.push({
        line: lineNum,
        issue: "Hardcoded color value",
        severity: "info",
        suggestion:
          "Consider using CSS variables or a design system for colors",
      });
    }

    // Check for color without dark mode support
    if (
      line.includes("color:") &&
      !line.includes("dark:") &&
      !content.includes("dark:")
    ) {
      issues.push({
        line: lineNum,
        issue: "Color without dark mode support",
        severity: "info",
        suggestion: "Consider adding dark mode variants with dark: prefix",
      });
    }
  }

  return issues;
}

async function analyzeFile(filePath: string): Promise<{
  file: string;
  loadingIssues: Array<{
    line: number;
    issue: string;
    severity: "error" | "warning" | "info";
    suggestion: string;
  }>;
  errorIssues: Array<{
    line: number;
    issue: string;
    severity: "error" | "warning" | "info";
    suggestion: string;
  }>;
  emptyStateIssues: Array<{
    line: number;
    issue: string;
    severity: "error" | "warning" | "info";
    suggestion: string;
  }>;
  spacingIssues: Array<{
    line: number;
    issue: string;
    severity: "error" | "warning" | "info";
    suggestion: string;
  }>;
  typographyIssues: Array<{
    line: number;
    issue: string;
    severity: "error" | "warning" | "info";
    suggestion: string;
  }>;
  responsiveIssues: Array<{
    line: number;
    issue: string;
    severity: "error" | "warning" | "info";
    suggestion: string;
  }>;
  colorIssues: Array<{
    line: number;
    issue: string;
    severity: "error" | "warning" | "info";
    suggestion: string;
  }>;
}> {
  const content = await fs.readFile(filePath, "utf-8");

  return {
    file: filePath,
    loadingIssues: analyzeLoadingStates(content, filePath),
    errorIssues: analyzeErrorStates(content, filePath),
    emptyStateIssues: analyzeEmptyStates(content, filePath),
    spacingIssues: analyzeSpacing(content, filePath),
    typographyIssues: analyzeTypography(content, filePath),
    responsiveIssues: analyzeResponsiveDesign(content, filePath),
    colorIssues: analyzeColorUsage(content, filePath),
  };
}

export const uxAuditTool: ToolDefinition<z.infer<typeof uxAuditSchema>> = {
  name: "ux_audit",
  description: DESCRIPTION,
  inputSchema: uxAuditSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Audit UX patterns";
    if (args.app_name) {
      preview += ` in app: ${args.app_name}`;
    }
    if (args.file_path) {
      preview += ` in ${args.file_path}`;
    }
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;

    return `<dyad-ux-audit ${buildAttributes(args)}>Auditing UX patterns...</dyad-ux-audit>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    let files: string[] = [];

    if (args.file_path) {
      const resolvedPath = resolveDirectoryWithinAppPath({
        appPath: targetAppPath,
        directory: args.file_path,
      });
      files = [resolvedPath];
    } else {
      // Find all relevant files
      const extensions = [".tsx", ".jsx"];
      const walk = async (dir: string): Promise<string[]> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const results: string[] = [];

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (
            entry.isDirectory() &&
            !entry.name.startsWith(".") &&
            entry.name !== "node_modules"
          ) {
            results.push(...(await walk(fullPath)));
          } else if (
            entry.isFile() &&
            extensions.some((ext) => entry.name.endsWith(ext))
          ) {
            results.push(fullPath);
          }
        }

        return results;
      };

      files = await walk(targetAppPath);
    }

    const allIssues = {
      loading: 0,
      error: 0,
      emptyState: 0,
      spacing: 0,
      typography: 0,
      responsive: 0,
      color: 0,
    };

    const results: string[] = [];

    for (const file of files) {
      try {
        const analysis = await analyzeFile(file);
        const totalIssues =
          analysis.loadingIssues.length +
          analysis.errorIssues.length +
          analysis.emptyStateIssues.length +
          analysis.spacingIssues.length +
          analysis.typographyIssues.length +
          analysis.responsiveIssues.length +
          analysis.colorIssues.length;

        if (totalIssues > 0) {
          allIssues.loading += analysis.loadingIssues.length;
          allIssues.error += analysis.errorIssues.length;
          allIssues.emptyState += analysis.emptyStateIssues.length;
          allIssues.spacing += analysis.spacingIssues.length;
          allIssues.typography += analysis.typographyIssues.length;
          allIssues.responsive += analysis.responsiveIssues.length;
          allIssues.color += analysis.colorIssues.length;

          results.push(`\n📄 ${path.relative(targetAppPath, file)}:`);

          if (analysis.loadingIssues.length > 0) {
            results.push(
              `  Loading Issues (${analysis.loadingIssues.length}):`,
            );
            for (const issue of analysis.loadingIssues.slice(0, 3)) {
              results.push(
                `    L${issue.line}: [${issue.severity}] ${issue.issue}`,
              );
              results.push(`      💡 ${issue.suggestion}`);
            }
          }

          if (analysis.errorIssues.length > 0) {
            results.push(
              `  Error Handling Issues (${analysis.errorIssues.length}):`,
            );
            for (const issue of analysis.errorIssues.slice(0, 3)) {
              results.push(
                `    L${issue.line}: [${issue.severity}] ${issue.issue}`,
              );
              results.push(`      💡 ${issue.suggestion}`);
            }
          }

          if (analysis.emptyStateIssues.length > 0) {
            results.push(
              `  Empty State Issues (${analysis.emptyStateIssues.length}):`,
            );
            for (const issue of analysis.emptyStateIssues.slice(0, 3)) {
              results.push(
                `    L${issue.line}: [${issue.severity}] ${issue.issue}`,
              );
              results.push(`      💡 ${issue.suggestion}`);
            }
          }

          if (analysis.spacingIssues.length > 0) {
            results.push(
              `  Spacing Issues (${analysis.spacingIssues.length}):`,
            );
            for (const issue of analysis.spacingIssues.slice(0, 3)) {
              results.push(
                `    L${issue.line}: [${issue.severity}] ${issue.issue}`,
              );
              results.push(`      💡 ${issue.suggestion}`);
            }
          }

          if (analysis.typographyIssues.length > 0) {
            results.push(
              `  Typography Issues (${analysis.typographyIssues.length}):`,
            );
            for (const issue of analysis.typographyIssues.slice(0, 3)) {
              results.push(
                `    L${issue.line}: [${issue.severity}] ${issue.issue}`,
              );
              results.push(`      💡 ${issue.suggestion}`);
            }
          }

          if (analysis.responsiveIssues.length > 0) {
            results.push(
              `  Responsive Issues (${analysis.responsiveIssues.length}):`,
            );
            for (const issue of analysis.responsiveIssues.slice(0, 3)) {
              results.push(
                `    L${issue.line}: [${issue.severity}] ${issue.issue}`,
              );
              results.push(`      💡 ${issue.suggestion}`);
            }
          }

          if (analysis.colorIssues.length > 0) {
            results.push(`  Color Issues (${analysis.colorIssues.length}):`);
            for (const issue of analysis.colorIssues.slice(0, 3)) {
              results.push(
                `    L${issue.line}: [${issue.severity}] ${issue.issue}`,
              );
              results.push(`      💡 ${issue.suggestion}`);
            }
          }
        }
      } catch (error) {
        logger.warn(`Failed to analyze ${file}:`, error);
      }
    }

    const totalIssues =
      allIssues.loading +
      allIssues.error +
      allIssues.emptyState +
      allIssues.spacing +
      allIssues.typography +
      allIssues.responsive +
      allIssues.color;

    const summary = [
      `\n📊 UX Audit Summary:`,
      `  Loading Issues: ${allIssues.loading}`,
      `  Error Handling Issues: ${allIssues.error}`,
      `  Empty State Issues: ${allIssues.emptyState}`,
      `  Spacing Issues: ${allIssues.spacing}`,
      `  Typography Issues: ${allIssues.typography}`,
      `  Responsive Issues: ${allIssues.responsive}`,
      `  Color Issues: ${allIssues.color}`,
      `  Total Issues: ${totalIssues}`,
      ``,
      `Files Analyzed: ${files.length}`,
    ];

    if (totalIssues === 0) {
      summary.push(`\n✅ No UX issues found!`);
    } else {
      summary.push(
        `\n⚠️ Found ${totalIssues} UX issues that should be addressed.`,
      );
    }

    return [...results, ...summary].join("\n");
  },
};
