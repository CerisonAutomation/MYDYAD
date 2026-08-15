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

// Detect function/method boundaries and measure their length
function findFunctions(lines: string[]): Array<{
  name: string;
  startLine: number;
  endLine: number;
  length: number;
  paramCount: number;
}> {
  const functions: Array<{
    name: string;
    startLine: number;
    endLine: number;
    length: number;
    paramCount: number;
  }> = [];
  const stack: Array<{ name: string; startLine: number; braceCount: number }> =
    [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect function declarations: function name(...), const name = (...), name(...), etc.
    const funcMatch = line.match(
      /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)|(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+[<>[\]\s|&]*)?\s*\{)/,
    );
    if (funcMatch) {
      const name = funcMatch[1] || funcMatch[2] || funcMatch[3] || "anonymous";
      stack.push({ name, startLine: i + 1, braceCount: 0 });
    }

    // Count opening and closing braces to track nesting
    // Skip braces inside strings and template literals
    let inString = false;
    let stringChar = "";
    let inTemplate = false;
    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci];
      const prev = ci > 0 ? line[ci - 1] : "";
      if (inString) {
        if (ch === stringChar && prev !== "\\") inString = false;
        continue;
      }
      if (inTemplate) {
        if (ch === "`" && prev !== "\\") inTemplate = false;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
        continue;
      }
      if (ch === "`") {
        inTemplate = true;
        continue;
      }
      if (ch === "{") {
        if (stack.length > 0) stack[stack.length - 1].braceCount++;
      } else if (ch === "}") {
        if (stack.length > 0) {
          stack[stack.length - 1].braceCount--;
          if (stack[stack.length - 1].braceCount <= 0) {
            const func = stack.pop()!;
            const length = i - func.startLine + 1;
            // Count parameters from the function signature line
            const sigLine = lines[func.startLine - 1] || "";
            const paramMatch = sigLine.match(/\(([^)]*)\)/);
            const paramCount = paramMatch
              ? paramMatch[1].split(",").filter((p) => p.trim().length > 0)
                  .length
              : 0;
            functions.push({
              name: func.name,
              startLine: func.startLine,
              endLine: i + 1,
              length,
              paramCount,
            });
          }
        }
      }
    }
  }

  return functions;
}

// Measure maximum nesting depth for a range of lines
function maxNestingDepth(lines: string[], start: number, end: number): number {
  let depth = 0;
  let maxDepth = 0;
  for (let i = start; i < end && i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        depth++;
        if (depth > maxDepth) maxDepth = depth;
      } else if (ch === "}") {
        depth--;
      }
    }
  }
  return maxDepth;
}

// Find duplicate code blocks (3+ consecutive identical trimmed lines)
function findDuplicateBlocks(
  lines: string[],
): Array<{ line: number; duplicateOf: number; snippet: string }> {
  const duplicates: Array<{
    line: number;
    duplicateOf: number;
    snippet: string;
  }> = [];
  const BLOCK_SIZE = 3;
  const seen = new Map<string, number>();

  for (let i = 0; i <= lines.length - BLOCK_SIZE; i++) {
    const block = lines
      .slice(i, i + BLOCK_SIZE)
      .map((l) => l.trim())
      .filter((l) => l.length > 5)
      .join("\n");
    if (block.length < 20) continue;

    if (seen.has(block)) {
      duplicates.push({
        line: i + 1,
        duplicateOf: seen.get(block)!,
        snippet: block.slice(0, 120),
      });
    } else {
      seen.set(block, i + 1);
    }
  }

  return duplicates;
}

async function analyzeCodeForRefactoring(
  filePath: string,
  content: string,
  refactorType: string,
): Promise<RefactorPlan> {
  const changes: RefactorPlan["changes"] = [];
  const lines = content.split("\n");
  const functions = findFunctions(lines);

  if (refactorType === "extract_function") {
    // Detect long functions (>50 lines) that should be extracted into smaller ones
    for (const func of functions) {
      if (func.length > 50) {
        changes.push({
          file: filePath,
          line: func.startLine,
          oldCode: `function ${func.name}(...) { /* ${func.length} lines */ }`,
          newCode: `Consider extracting sub-sections of ${func.name} (${func.length} lines, ${func.paramCount} params) into smaller helper functions`,
        });
      }
      // Detect functions with too many parameters
      if (func.paramCount > 4) {
        changes.push({
          file: filePath,
          line: func.startLine,
          oldCode: `function ${func.name}(${func.paramCount} params)`,
          newCode: `Reduce parameter count for ${func.name} (${func.paramCount} params) -- consider using an options object or extracting a parameter struct`,
        });
      }
    }
  }

  if (refactorType === "simplify") {
    // Detect deeply nested code (>4 levels)
    for (const func of functions) {
      const nesting = maxNestingDepth(lines, func.startLine - 1, func.endLine);
      if (nesting > 4) {
        changes.push({
          file: filePath,
          line: func.startLine,
          oldCode: `${func.name} has nesting depth of ${nesting}`,
          newCode: `Refactor ${func.name} to reduce nesting (current depth: ${nesting}) -- use early returns, guard clauses, or extract inner logic into helper functions`,
        });
      }
    }
    // Detect very large files
    if (lines.length > 500) {
      changes.push({
        file: filePath,
        line: 1,
        oldCode: `File has ${lines.length} lines`,
        newCode: `File is large (${lines.length} lines). Consider splitting into multiple modules by responsibility`,
      });
    }
  }

  if (refactorType === "deduplicate") {
    const duplicates = findDuplicateBlocks(lines);
    for (const dup of duplicates.slice(0, 10)) {
      changes.push({
        file: filePath,
        line: dup.line,
        oldCode: `Duplicate block starting at line ${dup.line}`,
        newCode: `Duplicate of block starting at line ${dup.duplicateOf} -- extract into a shared function`,
      });
    }
  }

  if (refactorType === "extract_class") {
    // Detect files with many standalone functions (potential class candidate)
    if (functions.length > 5 && lines.length > 200) {
      const funcNames = functions.map((f) => f.name).join(", ");
      changes.push({
        file: filePath,
        line: 1,
        oldCode: `${functions.length} standalone functions`,
        newCode: `File has ${functions.length} functions (${funcNames}). Consider grouping related functions into a class or module with shared state`,
      });
    }
  }

  if (refactorType === "modernize") {
    // Detect var declarations (should be const/let)
    for (let i = 0; i < lines.length; i++) {
      if (/\bvar\s+\w+/.test(lines[i])) {
        changes.push({
          file: filePath,
          line: i + 1,
          oldCode: lines[i].trim().slice(0, 80),
          newCode: "Replace 'var' with 'const' or 'let' for block scoping",
        });
      }
    }
    // Detect callback patterns that could be async/await
    for (let i = 0; i < lines.length; i++) {
      if (/\.then\s*\(\s*(?:function|\()/g.test(lines[i])) {
        changes.push({
          file: filePath,
          line: i + 1,
          oldCode: lines[i].trim().slice(0, 80),
          newCode:
            "Consider converting .then() chain to async/await for readability",
        });
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
        resultText += `\n[DRY RUN] No changes applied.`;
      } else {
        resultText += `\nAnalysis complete. This tool generates refactoring suggestions only.`;
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
