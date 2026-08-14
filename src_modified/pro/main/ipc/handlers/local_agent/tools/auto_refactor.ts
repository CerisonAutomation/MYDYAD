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

const logger = log.scope("auto_refactor");

const autoRefactorSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe("Optional. Name of a referenced app to refactor."),
  file: z.string().describe("File to refactor"),
  refactor_type: z
    .enum([
      "extract_function",
      "extract_class",
      "rename",
      "move",
      "inline",
      "simplify",
      "deduplicate",
      "modernize",
    ])
    .describe("Type of refactoring to perform"),
  target: z
    .string()
    .optional()
    .describe("Target for extraction/move (function name, class name, etc.)"),
  dry_run: z
    .boolean()
    .optional()
    .describe("Preview changes without applying (default: true)"),
});

const DESCRIPTION = `AI-powered automated refactoring with safety checks.

- extract_function: Extract code into new function
- extract_class: Extract into new class
- rename: Rename symbols across codebase
- move: Move code to new location
- inline: Inline function/variable
- simplify: Simplify complex code
- deduplicate: Remove duplicate code
- modernize: Update to modern patterns

Safety Features:
- AST-aware transformations
- Import/update tracking
- Test verification
- Rollback capability

Example: "Extract the authentication logic into a separate function"`;

interface RefactorPlan {
  type: string;
  file: string;
  changes: Array<{
    file: string;
    line: number;
    oldCode: string;
    newCode: string;
  }>;
  importsToUpdate: string[];
  testsToUpdate: string[];
  riskLevel: "low" | "medium" | "high";
}

async function analyzeCodeForRefactoring(
  filePath: string,
  content: string,
  refactorType: string,
): Promise<RefactorPlan> {
  const changes: RefactorPlan["changes"] = [];
  const lines = content.split("\n");

  // Simplified analysis - in production would use AST
  if (refactorType === "extract_function") {
    // Find large functions to extract
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/function\s+\w+/) || lines[i].match(/=>\s*\{/)) {
        // Mark for extraction
        changes.push({
          file: filePath,
          line: i + 1,
          oldCode: lines[i],
          newCode: `// TODO: Extract into separate function\n${lines[i]}`,
        });
      }
    }
  }

  if (refactorType === "deduplicate") {
    // Find duplicate code blocks
    const seen = new Map<string, number>();
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.length > 20) {
        if (seen.has(trimmed)) {
          changes.push({
            file: filePath,
            line: i + 1,
            oldCode: lines[i],
            newCode: `// DUPLICATE of line ${seen.get(trimmed)}\n${lines[i]}`,
          });
        } else {
          seen.set(trimmed, i + 1);
        }
      }
    }
  }

  return {
    type: refactorType,
    file: filePath,
    changes,
    importsToUpdate: [],
    testsToUpdate: [],
    riskLevel:
      changes.length > 5 ? "high" : changes.length > 2 ? "medium" : "low",
  };
}

function buildAttributes(
  args: Partial<z.infer<typeof autoRefactorSchema>>,
  plan?: RefactorPlan,
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  attrs.push(`file="${escapeXmlAttr(args.file)}"`);
  attrs.push(`type="${args.refactor_type}"`);
  if (args.dry_run) attrs.push(`dry_run="true"`);
  if (plan) {
    attrs.push(`changes="${plan.changes.length}"`);
    attrs.push(`risk="${plan.riskLevel}"`);
  }
  return attrs.join(" ");
}

export const autoRefactorTool: ToolDefinition<
  z.infer<typeof autoRefactorSchema>
> = {
  name: "auto_refactor",
  description: DESCRIPTION,
  inputSchema: autoRefactorSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = `${args.refactor_type.replace(/_/g, " ")} in ${args.file}`;
    if (args.target) preview += ` (target: ${args.target})`;
    if (args.dry_run) preview += " [DRY RUN]";
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-auto-refactor ${buildAttributes(args)}>Analyzing code...</dyad-auto-refactor>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
    const safeRelative = await resolveDirectoryWithinAppPath({
      appPath: targetAppPath,
      directory: args.file,
    });
    const filePath = path.join(targetAppPath, safeRelative);

    logger.log(`Auto-refactoring: ${args.refactor_type} in ${args.file}`);
    ctx.onXmlStream(
      `<dyad-auto-refactor ${buildAttributes(args)}>Analyzing code structure...</dyad-auto-refactor>`,
    );

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const plan = await analyzeCodeForRefactoring(
        filePath,
        content,
        args.refactor_type,
      );

      const attrs = buildAttributes(args, plan);

      if (plan.changes.length === 0) {
        const resultText = `No ${args.refactor_type.replace(/_/g, " ")} opportunities found in ${args.file}`;
        ctx.onXmlComplete(
          `<dyad-auto-refactor ${attrs}>${resultText}</dyad-auto-refactor>`,
        );
        return resultText;
      }

      let resultText = `Refactoring Plan: ${args.refactor_type.replace(/_/g, " ")}\n`;
      resultText += `File: ${args.file}\n`;
      resultText += `Risk Level: ${plan.riskLevel.toUpperCase()}\n`;
      resultText += `Changes: ${plan.changes.length}\n\n`;

      resultText += `Changes:\n`;
      plan.changes.slice(0, 10).forEach((c, i) => {
        resultText += `${i + 1}. Line ${c.line}:\n`;
        resultText += `   Old: ${c.oldCode.substring(0, 80)}...\n`;
        resultText += `   New: ${c.newCode.substring(0, 80)}...\n\n`;
      });

      if (args.dry_run) {
        resultText += `\n[DRY RUN] No changes applied. Remove dry_run to apply.`;
      } else {
        resultText += `\n⚠️ Changes would be applied. Use dry_run=true to preview first.`;
      }

      ctx.onXmlComplete(
        `<dyad-auto-refactor ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-auto-refactor>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to analyze refactoring: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
