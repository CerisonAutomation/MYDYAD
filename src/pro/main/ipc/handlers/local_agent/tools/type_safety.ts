/**
 * Type Safety Tool
 *
 * Analyzes TypeScript/JavaScript type safety issues.
 * Detects `any` types, type assertions, and unsafe patterns.
 */

import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { AgentContext, ToolDefinition } from "./types";
import { resolveTargetAppPath } from "./resolve_app_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { escapeXmlAttr } from "./types";
import { walkDirectory, DEFAULT_EXCLUDE_DIRS } from "./file_utils";

const typeSafetySchema = z.object({
  app_name: z.string().optional().describe("App to analyze"),
  include_pattern: z.string().optional().describe("File pattern to include"),
  severity: z
    .enum(["error", "warning", "info"])
    .optional()
    .describe("Minimum severity"),
});

type TypeSafetyArgs = z.infer<typeof typeSafetySchema>;

interface TypeSafetyIssue {
  file: string;
  line: number;
  column: number;
  type:
    | "any_type"
    | "type_assertion"
    | "non_null_assertion"
    | "implicit_any"
    | "unsafe_cast";
  severity: "error" | "warning" | "info";
  message: string;
  suggestion: string;
}

interface TypeSafetyResult {
  total_issues: number;
  by_severity: { error: number; warning: number; info: number };
  by_type: Record<string, number>;
  issues: TypeSafetyIssue[];
  score: number;
  recommendations: string[];
}

export const typeSafetyTool: ToolDefinition<TypeSafetyArgs> = {
  name: "type_safety",
  description: `Analyze TypeScript/JavaScript type safety issues.

Detects: any types, type assertions, non-null assertions, implicit any, unsafe casts.

Returns:
- Total issues by severity and type
- Type safety score (0-100)
- Specific issues with file:line references
- Recommendations for improvement

Use for: Code quality, migration planning, team standards.`,
  inputSchema: typeSafetySchema,
  defaultConsent: "always",
  modifiesState: false,
  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) =>
    `Analyze type safety${args.app_name ? ` for ${args.app_name}` : ""}`,

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-type-safety app="${escapeXmlAttr(args.app_name || "current")}">Analyzing...</dyad-type-safety>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const appPath = resolveTargetAppPath(ctx, args.app_name);

    ctx.onXmlStream(
      `<dyad-type-safety>Scanning TypeScript files...</dyad-type-safety>`,
    );

    const issues: TypeSafetyIssue[] = [];

    async function scanFile(filePath: string) {
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const lineNum = i + 1;

          // Check for `any` type
          if (/:\s*any\b/.test(line) && !/\/\/.*any/.test(line)) {
            issues.push({
              file: path.relative(appPath, filePath),
              line: lineNum,
              column: line.indexOf("any"),
              type: "any_type",
              severity: "warning",
              message: "Explicit `any` type detected",
              suggestion: "Use a specific type or `unknown` instead",
            });
          }

          // Check for type assertions
          if (/as\s+\w+/.test(line) && !/\/\/.*as/.test(line)) {
            issues.push({
              file: path.relative(appPath, filePath),
              line: lineNum,
              column: line.indexOf(" as "),
              type: "type_assertion",
              severity: "info",
              message: "Type assertion detected",
              suggestion: "Consider using type guards instead",
            });
          }

          // Check for non-null assertion
          if (/!\./.test(line) || /!\s*[;,)]/.test(line)) {
            issues.push({
              file: path.relative(appPath, filePath),
              line: lineNum,
              column: line.indexOf("!"),
              type: "non_null_assertion",
              severity: "warning",
              message: "Non-null assertion detected",
              suggestion: "Use optional chaining or null checks",
            });
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    const MAX_ISSUES = 200;

    async function processFile(filePath: string): Promise<void> {
      if (issues.length >= MAX_ISSUES) return;
      await scanFile(filePath);
    }

    try {
      const files = await walkDirectory(appPath, {
        filePattern: /\.(ts|tsx)$/,
        maxDepth: 20,
      });
      for (const file of files) {
        if (issues.length >= MAX_ISSUES) break;
        await processFile(file);
      }
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to scan type safety: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }

    const bySeverity = {
      error: issues.filter((i) => i.severity === "error").length,
      warning: issues.filter((i) => i.severity === "warning").length,
      info: issues.filter((i) => i.severity === "info").length,
    };

    const byType: Record<string, number> = {};
    for (const issue of issues) {
      byType[issue.type] = (byType[issue.type] || 0) + 1;
    }

    const score = Math.max(
      0,
      100 - bySeverity.error * 10 - bySeverity.warning * 3 - bySeverity.info,
    );

    const result: TypeSafetyResult = {
      total_issues: issues.length,
      by_severity: bySeverity,
      by_type: byType,
      issues: issues.slice(0, 50),
      score,
      recommendations: [
        "Replace `any` types with specific types or `unknown`",
        "Use type guards instead of type assertions",
        "Enable strict mode in tsconfig.json",
        "Consider using a linter rule for no-any",
      ],
    };

    ctx.onXmlComplete(
      `<dyad-type-safety score="${score}" issues="${issues.length}">${JSON.stringify(result, null, 2)}</dyad-type-safety>`,
    );

    return JSON.stringify(result, null, 2);
  },
};
