import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { resolveTargetAppPath } from "./resolve_app_context";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const logger = log.scope("code_complexity");

const codeComplexitySchema = z.object({
  file_path: z.string().describe("Path to the file to analyze"),
  deep: z.coerce.boolean().optional().default(false).describe("If true, analyze all functions in detail"),
});

type CodeComplexityArgs = z.infer<typeof codeComplexitySchema>;

interface FunctionMetrics {
  name: string;
  lines: number;
  complexity: number; // cyclomatic complexity
  params: number;
  nesting: number;
  issues: string[];
}

function calculateCyclomaticComplexity(code: string): number {
  let complexity = 1;
  // Count branching keywords
  const patterns = [/\bif\b/g, /\belse\b/g, /\bfor\b/g, /\bwhile\b/g, /\bswitch\b/g, /\bcase\b/g, /\b\?/g, /&&/g, /\|\|/g, /\?\?/g];
  for (const pattern of patterns) {
    complexity += (code.match(pattern) || []).length;
  }
  return complexity;
}

function calculateNesting(code: string): number {
  let maxNesting = 0;
  let current = 0;
  for (const char of code) {
    if (char === "{") current++;
    if (char === "}") current--;
    maxNesting = Math.max(maxNesting, current);
  }
  return maxNesting;
}

function findFunctions(content: string): Array<{ name: string; start: number; end: number }> {
  const functions: Array<{ name: string; start: number; end: number }> = [];
  // Match function declarations, arrow functions, and method definitions
  const patterns = [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g,
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/g,
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>/g,
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      functions.push({
        name: match[1],
        start: match.index,
        end: content.indexOf("}", match.index) + 1,
      });
    }
  }
  return functions;
}

function analyzeFunction(code: string, name: string): FunctionMetrics {
  const lines = code.split("\n").length;
  const complexity = calculateCyclomaticComplexity(code);
  const paramMatch = code.match(/\(([^)]*)\)/);
  const params = paramMatch ? paramMatch[1].split(",").filter(p => p.trim()).length : 0;
  const nesting = calculateNesting(code);
  const issues: string[] = [];

  if (complexity > 10) issues.push(`High complexity (${complexity})`);
  if (lines > 50) issues.push(`Long function (${lines} lines)`);
  if (params > 5) issues.push(`Too many parameters (${params})`);
  if (nesting > 4) issues.push(`Deep nesting (${nesting} levels)`);

  return { name, lines, complexity, params, nesting, issues };
}

export const codeComplexityTool: ToolDefinition<CodeComplexityArgs> = {
  name: "code_complexity",
  description:
    "Analyze code complexity metrics for a file. Reports cyclomatic complexity, nesting depth, function lengths, and identifies problematic patterns. Use this to find code that needs refactoring.",
  inputSchema: codeComplexitySchema,
  defaultConsent: "always",
  modifiesState: () => false,
  isEnabled: () => true,
  getConsentPreview: (args) => `Analyze complexity of ${args.file_path}`,

  execute: async (args, ctx: AgentContext) => {
    logger.log("Analyzing code complexity:", args.file_path);
    const appPath = resolveTargetAppPath(ctx);
    const filePath = join(appPath, args.file_path);
    
    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      throw new DyadError(`File not found: ${args.file_path}`, DyadErrorKind.NotFound);
    }

    const lines = content.split("\n");
    const totalLines = lines.length;
    const functions = findFunctions(content);
    const metrics: FunctionMetrics[] = [];

    for (const fn of functions.slice(0, args.deep ? 100 : 20)) {
      const fnCode = content.slice(fn.start, fn.end);
      metrics.push(analyzeFunction(fnCode, fn.name));
    }

    const totalComplexity = metrics.reduce((sum, m) => sum + m.complexity, 0);
    const avgComplexity = metrics.length > 0 ? (totalComplexity / metrics.length).toFixed(1) : "0";
    const highComplexityFunctions = metrics.filter(m => m.complexity > 10);
    const longFunctions = metrics.filter(m => m.lines > 50);
    const allIssues = metrics.flatMap(m => m.issues.map(i => `${m.name}: ${i}`));

    const result = {
      file: args.file_path,
      totalLines,
      totalFunctions: functions.length,
      analyzedFunctions: metrics.length,
      avgComplexity: parseFloat(avgComplexity),
      totalComplexity,
      highComplexityFunctions: highComplexityFunctions.length,
      longFunctions: longFunctions.length,
      issues: allIssues,
      topIssues: allIssues.slice(0, 10),
      rating: totalComplexity > 50 ? "POOR" : totalComplexity > 20 ? "FAIR" : "GOOD",
    };

    return JSON.stringify(result, null, 2);
  },
};
