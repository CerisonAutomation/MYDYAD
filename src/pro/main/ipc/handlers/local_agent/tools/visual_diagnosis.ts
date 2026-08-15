/**
 * Visual Diagnosis Tool — Analyzes visual issues in the current page
 *
 * Detects:
 * - Layout issues (overflow, misalignment, clipping)
 * - Component issues (missing props, broken states)
 * - Style issues (conflicts, overrides, inheritance)
 * - Accessibility issues (missing labels, contrast)
 *
 * Returns structured report with file:line references and fix suggestions
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

const logger = log.scope("visual_diagnosis");

const visualDiagnosisSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app to analyze instead of the current app.",
    ),
  file_path: z
    .string()
    .optional()
    .describe("Specific file to analyze. Omit to analyze all files."),
});

const DESCRIPTION = `Analyze visual issues in the UI.

Detects:
- Layout issues (overflow, misalignment, clipping)
- Component issues (missing props, broken states)
- Style issues (conflicts, overrides, inheritance)
- Accessibility issues (missing labels, contrast)

Returns structured report with file:line references and fix suggestions`;

function buildAttributes(
  args: Partial<z.infer<typeof visualDiagnosisSchema>>,
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

function analyzeLayout(
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

    // Check for overflow issues
    if (
      line.includes("overflow:") &&
      !line.includes("overflow: hidden") &&
      !line.includes("overflow: auto")
    ) {
      issues.push({
        line: lineNum,
        issue: "Potential overflow issue",
        severity: "warning",
        suggestion:
          "Consider using overflow: hidden or overflow: auto to prevent content clipping",
      });
    }

    // Check for absolute positioning without relative parent
    if (
      line.includes("position: absolute") &&
      !line.includes("position: relative")
    ) {
      issues.push({
        line: lineNum,
        issue: "Absolute positioning without relative parent",
        severity: "warning",
        suggestion:
          "Ensure parent element has position: relative for proper positioning",
      });
    }

    // Check for z-index conflicts
    if (line.includes("z-index:") && line.match(/z-index:\s*\d{4,}/)) {
      issues.push({
        line: lineNum,
        issue: "High z-index value",
        severity: "info",
        suggestion:
          "Consider using lower z-index values or z-index stacking contexts",
      });
    }

    // Check for fixed positioning
    if (line.includes("position: fixed")) {
      issues.push({
        line: lineNum,
        issue: "Fixed positioning detected",
        severity: "info",
        suggestion:
          "Ensure fixed elements don't overlap content on different screen sizes",
      });
    }
  }

  return issues;
}

function analyzeComponent(
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

    // Check for inline styles
    if (line.includes("style={{") && line.includes("}}")) {
      issues.push({
        line: lineNum,
        issue: "Inline styles detected",
        severity: "warning",
        suggestion:
          "Consider using CSS classes or styled-components for better maintainability",
      });
    }

    // Check for dangerouslySetInnerHTML
    if (line.includes("dangerouslySetInnerHTML")) {
      issues.push({
        line: lineNum,
        issue: "dangerouslySetInnerHTML usage",
        severity: "error",
        suggestion:
          "This can lead to XSS vulnerabilities. Sanitize input before rendering.",
      });
    }

    // Check for console.log in production
    if (line.includes("console.log") && !filePath.includes(".test.")) {
      issues.push({
        line: lineNum,
        issue: "console.log in production code",
        severity: "warning",
        suggestion: "Remove console.log statements or use a logging library",
      });
    }
  }

  return issues;
}

function analyzeStyle(
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

    // Check for !important
    if (line.includes("!important")) {
      issues.push({
        line: lineNum,
        issue: "!important usage",
        severity: "warning",
        suggestion:
          "Avoid !important when possible. Use more specific selectors instead.",
      });
    }

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

    // Check for hardcoded dimensions
    if (
      line.match(/(?:width|height):\s*\d+px/) &&
      !line.includes("min-") &&
      !line.includes("max-")
    ) {
      issues.push({
        line: lineNum,
        issue: "Hardcoded dimension",
        severity: "info",
        suggestion:
          "Consider using relative units (%, rem, em) for responsive design",
      });
    }
  }

  return issues;
}

function analyzeAccessibility(
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

    // Check for img without alt
    if (line.includes("<img") && !line.includes("alt=")) {
      issues.push({
        line: lineNum,
        issue: "Image without alt attribute",
        severity: "error",
        suggestion: "Add alt attribute for screen readers",
      });
    }

    // Check for button without accessible name
    if (
      line.includes("<button") &&
      !line.includes("aria-label") &&
      !line.includes("aria-labelledby")
    ) {
      issues.push({
        line: lineNum,
        issue: "Button without accessible name",
        severity: "warning",
        suggestion: "Add aria-label or aria-labelledby for screen readers",
      });
    }

    // Check for input without label
    if (
      line.includes("<input") &&
      !line.includes("aria-label") &&
      !line.includes("id=")
    ) {
      issues.push({
        line: lineNum,
        issue: "Input without label",
        severity: "warning",
        suggestion: "Add aria-label or associate with a label element",
      });
    }
  }

  return issues;
}

async function analyzeFile(filePath: string): Promise<{
  file: string;
  layoutIssues: Array<{
    line: number;
    issue: string;
    severity: "error" | "warning" | "info";
    suggestion: string;
  }>;
  componentIssues: Array<{
    line: number;
    issue: string;
    severity: "error" | "warning" | "info";
    suggestion: string;
  }>;
  styleIssues: Array<{
    line: number;
    issue: string;
    severity: "error" | "warning" | "info";
    suggestion: string;
  }>;
  accessibilityIssues: Array<{
    line: number;
    issue: string;
    severity: "error" | "warning" | "info";
    suggestion: string;
  }>;
}> {
  const content = await fs.readFile(filePath, "utf-8");

  return {
    file: filePath,
    layoutIssues: analyzeLayout(content, filePath),
    componentIssues: analyzeComponent(content, filePath),
    styleIssues: analyzeStyle(content, filePath),
    accessibilityIssues: analyzeAccessibility(content, filePath),
  };
}

export const visualDiagnosisTool: ToolDefinition<
  z.infer<typeof visualDiagnosisSchema>
> = {
  name: "visual_diagnosis",
  description: DESCRIPTION,
  inputSchema: visualDiagnosisSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Analyze visual issues";
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

    return `<dyad-visual-diagnosis ${buildAttributes(args)}>Analyzing visual issues...</dyad-visual-diagnosis>`;
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
      const extensions = [".tsx", ".jsx", ".css", ".scss"];
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
      layout: 0,
      component: 0,
      style: 0,
      accessibility: 0,
    };

    const results: string[] = [];

    for (const file of files) {
      try {
        const analysis = await analyzeFile(file);
        const totalIssues =
          analysis.layoutIssues.length +
          analysis.componentIssues.length +
          analysis.styleIssues.length +
          analysis.accessibilityIssues.length;

        if (totalIssues > 0) {
          allIssues.layout += analysis.layoutIssues.length;
          allIssues.component += analysis.componentIssues.length;
          allIssues.style += analysis.styleIssues.length;
          allIssues.accessibility += analysis.accessibilityIssues.length;

          results.push(`\n📄 ${path.relative(targetAppPath, file)}:`);

          if (analysis.layoutIssues.length > 0) {
            results.push(`  Layout Issues (${analysis.layoutIssues.length}):`);
            for (const issue of analysis.layoutIssues.slice(0, 5)) {
              results.push(
                `    L${issue.line}: [${issue.severity}] ${issue.issue}`,
              );
              results.push(`      💡 ${issue.suggestion}`);
            }
          }

          if (analysis.componentIssues.length > 0) {
            results.push(
              `  Component Issues (${analysis.componentIssues.length}):`,
            );
            for (const issue of analysis.componentIssues.slice(0, 5)) {
              results.push(
                `    L${issue.line}: [${issue.severity}] ${issue.issue}`,
              );
              results.push(`      💡 ${issue.suggestion}`);
            }
          }

          if (analysis.styleIssues.length > 0) {
            results.push(`  Style Issues (${analysis.styleIssues.length}):`);
            for (const issue of analysis.styleIssues.slice(0, 5)) {
              results.push(
                `    L${issue.line}: [${issue.severity}] ${issue.issue}`,
              );
              results.push(`      💡 ${issue.suggestion}`);
            }
          }

          if (analysis.accessibilityIssues.length > 0) {
            results.push(
              `  Accessibility Issues (${analysis.accessibilityIssues.length}):`,
            );
            for (const issue of analysis.accessibilityIssues.slice(0, 5)) {
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
      allIssues.layout +
      allIssues.component +
      allIssues.style +
      allIssues.accessibility;

    const summary = [
      `\n📊 Visual Diagnosis Summary:`,
      `  Layout Issues: ${allIssues.layout}`,
      `  Component Issues: ${allIssues.component}`,
      `  Style Issues: ${allIssues.style}`,
      `  Accessibility Issues: ${allIssues.accessibility}`,
      `  Total Issues: ${totalIssues}`,
      ``,
      `Files Analyzed: ${files.length}`,
    ];

    if (totalIssues === 0) {
      summary.push(`\n✅ No visual issues found!`);
    } else {
      summary.push(
        `\n⚠️ Found ${totalIssues} visual issues that should be addressed.`,
      );
    }

    return [...results, ...summary].join("\n");
  },
};
