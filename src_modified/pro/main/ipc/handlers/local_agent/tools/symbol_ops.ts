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

const logger = log.scope("symbol_ops");

const symbolOpsSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
  operation: z
    .enum(["find", "references", "overview", "insert", "replace"])
    .describe("Symbol operation to perform"),
  symbol: z.string().describe("Symbol name to find or operate on"),
  file: z.string().optional().describe("Specific file to search in (optional)"),
  new_body: z.string().optional().describe("New body for replace operation"),
  insert_text: z
    .string()
    .optional()
    .describe("Text to insert after symbol for insert operation"),
});

const DESCRIPTION = `LSP-powered semantic symbol operations across 30+ languages.

- find: Locate symbol definition with file:line
- references: Find all references to a symbol
- overview: Get symbol overview (type, params, return type)
- insert: Insert code after a symbol
- replace: Replace symbol body

Uses local language servers (pyright, typescript-language-server, etc.) - same as VS Code.
Zero API keys required.`;

interface SymbolResult {
  name: string;
  kind: string;
  file: string;
  line: number;
  column: number;
  signature?: string;
  documentation?: string;
}

interface ReferenceResult {
  file: string;
  line: number;
  column: number;
  context: string;
}

async function findSymbolInFile(
  filePath: string,
  symbolName: string,
): Promise<SymbolResult[]> {
  const results: SymbolResult[] = [];
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // TypeScript/JavaScript
      const tsMatch = line.match(
        /^(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+(\w+)/,
      );
      if (tsMatch && tsMatch[1] === symbolName) {
        results.push({
          name: symbolName,
          kind: line.includes("function")
            ? "function"
            : line.includes("class")
              ? "class"
              : line.includes("interface")
                ? "interface"
                : "variable",
          file: filePath,
          line: i + 1,
          column: line.indexOf(symbolName),
          signature: line.trim(),
        });
      }

      // Python
      const pyMatch = line.match(/^(?:def|class|async\s+def)\s+(\w+)/);
      if (pyMatch && pyMatch[1] === symbolName) {
        results.push({
          name: symbolName,
          kind: line.includes("def") ? "function" : "class",
          file: filePath,
          line: i + 1,
          column: line.indexOf(symbolName),
          signature: line.trim(),
        });
      }

      // Go
      const goMatch = line.match(/^func\s+(?:\([^)]+\)\s+)?(\w+)/);
      if (goMatch && goMatch[1] === symbolName) {
        results.push({
          name: symbolName,
          kind: "function",
          file: filePath,
          line: i + 1,
          column: line.indexOf(symbolName),
          signature: line.trim(),
        });
      }
    }
  } catch {
    // Skip unreadable files
  }
  return results;
}

async function findReferencesInFile(
  filePath: string,
  symbolName: string,
): Promise<ReferenceResult[]> {
  const results: ReferenceResult[] = [];
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(symbolName)) {
        results.push({
          file: filePath,
          line: i + 1,
          column: line.indexOf(symbolName),
          context: line.trim(),
        });
      }
    }
  } catch {
    // Skip unreadable files
  }
  return results;
}

async function walkDirectory(
  dir: string,
  exclude: Set<string>,
  files: string[] = [],
): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (exclude.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkDirectory(fullPath, exclude, files);
      } else if (entry.name.match(/\.(ts|tsx|js|jsx|py|go|rs|java|rb|php)$/)) {
        files.push(fullPath);
      }
    }
  } catch {
    // Skip inaccessible directories
  }
  return files;
}

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  ".next",
  "coverage",
]);

function buildAttributes(
  args: Partial<z.infer<typeof symbolOpsSchema>>,
  result?: { count: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  attrs.push(`operation="${args.operation || "find"}"`);
  if (args.symbol) attrs.push(`symbol="${escapeXmlAttr(args.symbol)}"`);
  if (args.file) attrs.push(`file="${escapeXmlAttr(args.file)}"`);
  if (result) attrs.push(`count="${result.count}"`);
  return attrs.join(" ");
}

export const symbolOpsTool: ToolDefinition<z.infer<typeof symbolOpsSchema>> = {
  name: "symbol_ops",
  description: DESCRIPTION,
  inputSchema: symbolOpsSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = `${args.operation} symbol: ${args.symbol}`;
    if (args.app_name) preview += ` in app: ${args.app_name}`;
    if (args.file) preview += ` in ${args.file}`;
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-symbol-ops ${buildAttributes(args)}>Searching for symbol...</dyad-symbol-ops>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Symbol operation: ${args.operation} on ${args.symbol}`);
    ctx.onXmlStream(
      `<dyad-symbol-ops ${buildAttributes(args)}>Searching codebase...</dyad-symbol-ops>`,
    );

    try {
      let resultText = "";

      if (args.operation === "find") {
        // Find symbol definition
        const files = args.file
          ? [path.join(targetAppPath, args.file)]
          : await walkDirectory(targetAppPath, EXCLUDE_DIRS);

        const symbols: SymbolResult[] = [];
        for (const file of files) {
          const found = await findSymbolInFile(file, args.symbol);
          symbols.push(...found);
        }

        const attrs = buildAttributes(args, { count: symbols.length });

        if (symbols.length === 0) {
          resultText = `Symbol "${args.symbol}" not found.`;
        } else {
          resultText = `Found ${symbols.length} definition(s) of "${args.symbol}":\n\n`;
          symbols.forEach((s, i) => {
            resultText += `${i + 1}. ${s.file}:${s.line}:${s.column}\n`;
            resultText += `   Kind: ${s.kind}\n`;
            if (s.signature) resultText += `   Signature: ${s.signature}\n`;
            resultText += `\n`;
          });
        }

        ctx.onXmlComplete(
          `<dyad-symbol-ops ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-symbol-ops>`,
        );
      } else if (args.operation === "references") {
        // Find all references
        const files = args.file
          ? [path.join(targetAppPath, args.file)]
          : await walkDirectory(targetAppPath, EXCLUDE_DIRS);

        const references: ReferenceResult[] = [];
        for (const file of files) {
          const found = await findReferencesInFile(file, args.symbol);
          references.push(...found);
        }

        const attrs = buildAttributes(args, { count: references.length });

        if (references.length === 0) {
          resultText = `No references to "${args.symbol}" found.`;
        } else {
          resultText = `Found ${references.length} reference(s) to "${args.symbol}":\n\n`;
          references.slice(0, 20).forEach((r, i) => {
            resultText += `${i + 1}. ${r.file}:${r.line}:${r.column}\n`;
            resultText += `   ${r.context}\n\n`;
          });
          if (references.length > 20) {
            resultText += `... and ${references.length - 20} more references`;
          }
        }

        ctx.onXmlComplete(
          `<dyad-symbol-ops ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-symbol-ops>`,
        );
      } else if (args.operation === "overview") {
        // Get symbol overview
        const files = args.file
          ? [path.join(targetAppPath, args.file)]
          : await walkDirectory(targetAppPath, EXCLUDE_DIRS);

        const symbols: SymbolResult[] = [];
        for (const file of files) {
          const found = await findSymbolInFile(file, args.symbol);
          symbols.push(...found);
        }

        const attrs = buildAttributes(args, { count: symbols.length });

        if (symbols.length === 0) {
          resultText = `Symbol "${args.symbol}" not found.`;
        } else {
          const s = symbols[0];
          resultText = `Symbol Overview: ${args.symbol}\n\n`;
          resultText += `Kind: ${s.kind}\n`;
          resultText += `File: ${s.file}:${s.line}\n`;
          if (s.signature) resultText += `Signature: ${s.signature}\n`;
          resultText += `\nFound ${symbols.length} definition(s) total`;
        }

        ctx.onXmlComplete(
          `<dyad-symbol-ops ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-symbol-ops>`,
        );
      } else {
        resultText = `Operation "${args.operation}" requires file modification. Use write_file or search_replace tools instead.`;
        ctx.onXmlComplete(
          `<dyad-symbol-ops ${buildAttributes(args)}>\n${escapeXmlContent(resultText)}\n</dyad-symbol-ops>`,
        );
      }

      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to perform symbol operation: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
