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
import { walkDirectory } from "./file_utils";

const logger = log.scope("complexity");

const complexitySchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
  file: z
    .string()
    .optional()
    .describe(
      "Specific file to analyze (relative path). If omitted, scans entire repo.",
    ),
});

const DESCRIPTION = `Analyze cyclomatic and cognitive complexity per function.

- Returns list of complex functions with scores
- Cyclomatic: independent paths through code (1-10 simple, 11-20 moderate, 21+ high)
- Cognitive: how hard code is to understand
- Use for refactoring prioritization and code review`;

interface FunctionComplexity {
  name: string;
  line: number;
  lines: number;
  cyclomatic: number;
  cognitive: number;
}

interface ComplexityReport {
  file: string;
  functions: FunctionComplexity[];
}

function calculateCyclomaticComplexity(code: string): number {
  let complexity = 1;
  const patterns = [
    /\bif\s*\(/g,
    /\belse\s+if\s*\(/g,
    /\bfor\s*\(/g,
    /\bwhile\s*\(/g,
    /\bdo\s*\{/g,
    /\bswitch\s*\(/g,
    /\bcase\s+/g,
    /\?\s*[^:]+:/g,
    /&&/g,
    /\|\|/g,
    /\?\?/g,
    /\.catch\s*\(/g,
  ];
  for (const pattern of patterns) {
    const matches = code.match(pattern);
    if (matches) complexity += matches.length;
  }
  return complexity;
}

function calculateCognitiveComplexity(code: string): number {
  let complexity = 0;
  let nesting = 0;
  const lines = code.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.match(/\{$/) && !trimmed.match(/else\s*\{$/)) nesting++;
    if (trimmed.match(/\b(if|else if|for|while|do|switch|catch)\s*\(/))
      complexity += nesting;
    if (trimmed.match(/\bif\s*\(/)) complexity++;
    if (trimmed.match(/\bfor\s*\(/)) complexity++;
    if (trimmed.match(/\bwhile\s*\(/)) complexity++;
    if (trimmed.match(/\bcatch\s*\(/)) complexity++;
    const andMatches = trimmed.match(/&&/g);
    if (andMatches) complexity += andMatches.length;
    const orMatches = trimmed.match(/\|\|/g);
    if (orMatches) complexity += orMatches.length;
    if (trimmed.match(/^\}/)) nesting = Math.max(0, nesting - 1);
  }
  return complexity;
}

function countBracesSkippingStrings(line: string): {
  open: number;
  close: number;
} {
  let open = 0;
  let close = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escape = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === "`") inTemplate = false;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      continue;
    }

    if (ch === "{") open++;
    if (ch === "}") close++;
  }

  return { open, close };
}

function extractFunctions(
  content: string,
): Array<{ name: string; line: number; code: string }> {
  const functions: Array<{ name: string; line: number; code: string }> = [];
  const lines = content.split("\n");
  const functionRegex =
    /^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>)/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(functionRegex);
    if (match) {
      const name = match[1] || match[2];
      let braceCount = 0;
      let code = "";
      for (let j = i; j < lines.length; j++) {
        code += lines[j] + "\n";
        const { open, close } = countBracesSkippingStrings(lines[j]);
        braceCount += open - close;
        if (braceCount === 0 && code.trim()) {
          functions.push({ name, line: i + 1, code });
          break;
        }
      }
    }
  }
  return functions;
}

function analyzeFile(filePath: string, content: string): ComplexityReport {
  const functions = extractFunctions(content);
  const results: FunctionComplexity[] = [];

  for (const func of functions) {
    const cyclomatic = calculateCyclomaticComplexity(func.code);
    const cognitive = calculateCognitiveComplexity(func.code);
    const lines = func.code.split("\n").length;
    if (cyclomatic > 5 || cognitive > 5) {
      results.push({
        name: func.name,
        line: func.line,
        lines,
        cyclomatic,
        cognitive,
      });
    }
  }

  results.sort(
    (a, b) => b.cyclomatic + b.cognitive - (a.cyclomatic + a.cognitive),
  );
  return { file: filePath, functions: results };
}

function buildAttributes(
  args: Partial<z.infer<typeof complexitySchema>>,
  stats?: { complex: number; files: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (args.file) attrs.push(`file="${escapeXmlAttr(args.file)}"`);
  if (stats) {
    attrs.push(`complex_functions="${stats.complex}"`);
    attrs.push(`files="${stats.files}"`);
  }
  return attrs.join(" ");
}

export const complexityTool: ToolDefinition<z.infer<typeof complexitySchema>> =
  {
    name: "complexity",
    description: DESCRIPTION,
    inputSchema: complexitySchema,
    defaultConsent: "always",
    modifiesState: false,

    isEnabled: (_ctx: AgentContext) => true,

    getConsentPreview: (args) => {
      let preview = "Analyze code complexity";
      if (args.app_name) preview += ` in app: ${args.app_name}`;
      if (args.file) preview += ` in ${args.file}`;
      return preview;
    },

    buildXml: (args, isComplete) => {
      if (isComplete) return undefined;
      return `<dyad-complexity ${buildAttributes(args)}>Analyzing complexity...</dyad-complexity>`;
    },

    execute: async (args, ctx: AgentContext) => {
      const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

      logger.log(`Analyzing complexity in ${targetAppPath}`);
      ctx.onXmlStream(
        `<dyad-complexity ${buildAttributes(args)}>Analyzing code complexity...</dyad-complexity>`,
      );

      try {
        let reports: ComplexityReport[] = [];

        if (args.file) {
          const safeRelative = await resolveDirectoryWithinAppPath({
            appPath: targetAppPath,
            directory: args.file,
          });
          const filePath = path.join(targetAppPath, safeRelative);
          const { setTimeout: sleep } = await import("node:timers/promises");
          const content = await Promise.race([
            fs.readFile(filePath, "utf-8"),
            sleep(5000).then(() => {
              throw new DyadError("Read timeout", DyadErrorKind.Validation);
            }),
          ]);
          reports = [analyzeFile(args.file, content)];
        } else {
          const files = await walkDirectory(targetAppPath, {
            filePattern: /\.(ts|tsx|js|jsx)$/,
          });
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
              if (report.functions.length > 0) reports.push(report);
            } catch {
              // Skip unreadable files
            }
          }
        }

        const allFunctions = reports.flatMap((r) =>
          r.functions.map((f) => ({ ...f, file: r.file })),
        );
        allFunctions.sort(
          (a, b) => b.cyclomatic + b.cognitive - (a.cyclomatic + a.cognitive),
        );

        const attrs = buildAttributes(args, {
          complex: allFunctions.length,
          files: reports.length,
        });

        if (allFunctions.length === 0) {
          ctx.onXmlComplete(
            `<dyad-complexity ${attrs}>No complex functions detected.</dyad-complexity>`,
          );
          return "No complex functions detected.";
        }

        const lines = allFunctions
          .slice(0, 15)
          .map(
            (f, i) =>
              `${i + 1}. ${f.file}:${f.line} - ${f.name}\n   Cyclomatic: ${f.cyclomatic}, Cognitive: ${f.cognitive}, Lines: ${f.lines}`,
          );

        const resultText = `Complex Functions: ${allFunctions.length}\n\nTop Functions:\n${lines.join("\n\n")}`;

        ctx.onXmlComplete(
          `<dyad-complexity ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-complexity>`,
        );
        return resultText;
      } catch (error) {
        if (error instanceof DyadError) throw error;
        throw new DyadError(
          `Failed to analyze complexity: ${error instanceof Error ? error.message : String(error)}`,
          DyadErrorKind.Unknown,
        );
      }
    },
  };
