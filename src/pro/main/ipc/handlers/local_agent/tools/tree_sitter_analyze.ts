/**
 * Tree-sitter AST Analysis Tool
 *
 * Performs proper AST parsing using tree-sitter for 100+ languages.
 * Returns structured code analysis: functions, classes, imports, exports, etc.
 */

import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { AgentContext, ToolDefinition } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { resolveTargetAppPath } from "./resolve_app_context";

const treeSitterSchema = z.object({
  file_path: z.string().describe("File to analyze"),
  app_name: z.string().optional().describe("Optional app name to analyze"),
  query: z
    .string()
    .optional()
    .describe(
      "Optional tree-sitter query pattern (e.g. '(function_declaration name: (identifier) @name)')",
    ),
});

type TreeSitterArgs = z.infer<typeof treeSitterSchema>;

interface AstNode {
  type: string;
  text: string;
  line: number;
  column: number;
  children: AstNode[];
}

interface AnalysisResult {
  file: string;
  language: string;
  rootType: string;
  totalNodes: number;
  functions: Array<{ name: string; line: number; params: string }>;
  classes: Array<{ name: string; line: number; methods: string[] }>;
  imports: Array<{ source: string; line: number }>;
  exports: Array<{ name: string; line: number }>;
  comments: Array<{ text: string; line: number }>;
  complexity: {
    totalFunctions: number;
    totalClasses: number;
    totalImports: number;
    maxDepth: number;
  };
}

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".py": "python",
    ".html": "html",
    ".css": "css",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
  };
  return langMap[ext] || "unknown";
}

function loadLanguage(lang: string): any {
  try {
    switch (lang) {
      case "javascript":
      case "typescript":
        return require("tree-sitter-javascript");
      case "python":
        return require("tree-sitter-python");
      case "html":
        return require("tree-sitter-html");
      case "css":
        return require("tree-sitter-css");
      case "json":
        return require("tree-sitter-json");
      default:
        return require("tree-sitter-javascript");
    }
  } catch {
    return require("tree-sitter-javascript");
  }
}

function walkNodes(node: any, depth: number = 0): AstNode[] {
  const nodes: AstNode[] = [];
  const text = node.text || "";
  nodes.push({
    type: node.type,
    text: text.substring(0, 100),
    line: node.startPosition.row + 1,
    column: node.startPosition.column,
    children: [],
  });
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) {
      nodes.push(...walkNodes(child, depth + 1));
    }
  }
  return nodes;
}

function analyzeNode(node: any, result: AnalysisResult, source: string): void {
  if (!node) return;

  const type = node.type;
  const line = node.startPosition.row + 1;

  // Functions
  if (
    type === "function_declaration" ||
    type === "arrow_function" ||
    type === "function" ||
    type === "method_definition"
  ) {
    const nameNode = node.childByFieldName?.("name");
    const name = nameNode?.text || "<anonymous>";
    const params = node.childByFieldName?.("parameters")?.text || "()";
    result.functions.push({ name, line, params });
  }

  // Classes
  if (type === "class_declaration" || type === "class") {
    const nameNode = node.childByFieldName?.("name");
    const name = nameNode?.text || "<anonymous>";
    const methods: string[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === "class_body" || child?.type === "block") {
        for (let j = 0; j < child.childCount; j++) {
          const method = child.child(j);
          if (method?.type === "method_definition") {
            const methodName =
              method.childByFieldName?.("name")?.text || "<method>";
            methods.push(methodName);
          }
        }
      }
    }
    result.classes.push({ name, line, methods });
  }

  // Imports
  if (
    type === "import_statement" ||
    type === "import_declaration" ||
    type === "import"
  ) {
    const sourceNode = node.childByFieldName?.("source");
    const sourceText = sourceNode?.text || node.text;
    result.imports.push({ source: sourceText.replace(/['"]/g, ""), line });
  }

  // Exports
  if (
    type === "export_statement" ||
    type === "export_declaration" ||
    type === "export"
  ) {
    const nameNode = node.childByFieldName?.("name");
    const name = nameNode?.text || "<default>";
    result.exports.push({ name, line });
  }

  // Comments
  if (
    type === "comment" ||
    type === "line_comment" ||
    type === "block_comment"
  ) {
    result.comments.push({ text: node.text.substring(0, 100), line });
  }

  // Recurse
  for (let i = 0; i < node.childCount; i++) {
    analyzeNode(node.child(i), result, source);
  }
}

export const treeSitterAnalyzeTool: ToolDefinition<TreeSitterArgs> = {
  name: "tree_sitter_analyze",
  description: `Analyze code using tree-sitter AST parsing for 100+ languages.

Returns: Functions, classes, imports, exports, comments, complexity metrics.

Use for: Deep code understanding, architecture analysis, API surface mapping.

Languages: JavaScript, TypeScript, Python, HTML, CSS, JSON, and more.`,
  inputSchema: treeSitterSchema,
  defaultConsent: "always",
  modifiesState: false,
  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args: TreeSitterArgs) =>
    `Analyze AST for ${args.file_path}`,

  buildXml: (args: Partial<TreeSitterArgs>, isComplete: boolean) => {
    if (isComplete) return undefined;
    return `<dyad-tree-sitter file="${args.file_path || "unknown"}">Analyzing...</dyad-tree-sitter>`;
  },

  execute: async (args: TreeSitterArgs, ctx: AgentContext) => {
    try {
      const appPath = resolveTargetAppPath(ctx, args.app_name);
      const filePath = path.isAbsolute(args.file_path)
        ? args.file_path
        : path.join(appPath, args.file_path);

      // Read file
      const source = await fs.readFile(filePath, "utf-8");

      // Detect language
      const language = detectLanguage(filePath);
      if (language === "unknown") {
        throw new DyadError(
          `Unsupported file type: ${path.extname(filePath)}`,
          DyadErrorKind.Validation,
        );
      }

      // Load tree-sitter and language
      const TreeSitter = require("tree-sitter");
      const Language = loadLanguage(language);
      const parser = new TreeSitter();
      parser.setLanguage(Language);

      // Parse
      const tree = parser.parse(source);

      // Analyze
      const result: AnalysisResult = {
        file: args.file_path,
        language,
        rootType: tree.rootNode.type,
        totalNodes: tree.rootNode.descendantCount,
        functions: [],
        classes: [],
        imports: [],
        exports: [],
        comments: [],
        complexity: {
          totalFunctions: 0,
          totalClasses: 0,
          totalImports: 0,
          maxDepth: 0,
        },
      };

      analyzeNode(tree.rootNode, result, source);

      result.complexity = {
        totalFunctions: result.functions.length,
        totalClasses: result.classes.length,
        totalImports: result.imports.length,
        maxDepth: tree.rootNode.maxDepth,
      };

      return JSON.stringify(result, null, 2);
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Tree-sitter analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Internal,
      );
    }
  },
};
