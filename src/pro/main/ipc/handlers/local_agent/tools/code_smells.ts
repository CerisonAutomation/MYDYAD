import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { resolveTargetAppPath } from "./resolve_app_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import log from "electron-log";
import { walkDirectory } from "./file_utils";

const logger = log.scope("code_smells");

const DEFAULT_MAX_FILES = 1000;
const MAX_MAX_FILES = 10000;
const READ_TIMEOUT_MS = 5_000;
const TOTAL_TIMEOUT_MS = 120_000;

const codeSmellsSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
  max_files: z
    .number()
    .min(1)
    .max(MAX_MAX_FILES)
    .optional()
    .describe(
      `Maximum number of files to scan (default: ${DEFAULT_MAX_FILES}, max: ${MAX_MAX_FILES}).`,
    ),
});

const DESCRIPTION = `Detect 20+ code smells with dynamic severity, actionable suggestions, and metrics.

- Returns health score (0-100), ranked files, and per-smell details
- Detects: God Class, Long Method, Deep Nesting, Magic Numbers, Duplicate Code, Missing Error Handling, Long Chains, Star Exports, Any Types, Unused Imports, Debug Code, TODO Comments, Empty Catch, Var Usage, Loose Equality, Commented Code
- Severity scales with magnitude (e.g. 200-line method is critical, 60-line is medium)
- Each smell includes: file, line, column, severity, confidence, message, suggestion, metric
- Use for code quality audits and refactoring prioritization`;

interface CodeSmell {
  smell: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  line: number;
  column: number;
  message: string;
  suggestion: string;
  metric?: number;
}

interface SmellReport {
  file: string;
  score: number;
  smells: CodeSmell[];
  summary: Record<string, number>;
}

// Magic numbers that are NOT smells (common safe values)
const MAGIC_NUMBER_SAFE = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 32, 64, 100, 256, 360, 500,
  1000, 1024, 2048, 4096, 8192, 10000, 60000, 100000,
  // HTTP status codes
  200, 201, 202, 204, 206, 301, 302, 304, 307, 308, 400, 401, 403, 404, 405,
  408, 409, 410, 422, 429, 500, 501, 502, 503, 504,
  // Common web constants (HSTS, cache, etc.)
  86400, 604800, 2592000, 31536000, 63072000,
]);

// Directories to exclude from test-file detection
const TEST_PATTERNS = /\.(test|spec|__tests__|__mocks__)\./;

function isTestFile(filePath: string): boolean {
  return TEST_PATTERNS.test(filePath);
}

// ── Helper: count braces while skipping string/template literals ─────

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

// ── Structural Detectors ─────────────────────────────────────────────

function detectLongMethod(lines: string[], filePath: string): CodeSmell[] {
  const smells: CodeSmell[] = [];
  let braceDepth = 0;
  let funcStart = -1;
  let funcName = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Detect function/method start
    const funcMatch = line.match(
      /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|\w+)\s*=>|(?:public|private|protected|static|async)\s+(\w+)\s*\(|^\s{2,}(\w+)\s*\()/,
    );
    if (funcMatch && braceDepth === 0) {
      funcStart = i;
      funcName =
        funcMatch[1] ||
        funcMatch[2] ||
        funcMatch[3] ||
        funcMatch[4] ||
        "anonymous";
    }
    // Track brace depth (skip braces inside string/template literals)
    const { open, close } = countBracesSkippingStrings(line);
    braceDepth += open - close;
    // Function ended
    if (braceDepth === 0 && funcStart >= 0) {
      const length = i - funcStart + 1;
      if (length > 50) {
        const severity =
          length > 200
            ? "critical"
            : length > 100
              ? "high"
              : length > 75
                ? "medium"
                : "low";
        smells.push({
          smell: "long_method",
          severity,
          confidence: 0.9,
          line: funcStart + 1,
          column: 0,
          message: `Function "${funcName}" is ${length} lines long`,
          suggestion:
            "Extract sub-functions, use early returns, or split into smaller functions",
          metric: length,
        });
      }
      funcStart = -1;
    }
  }
  return smells;
}

function detectGodClass(lines: string[], _filePath: string): CodeSmell[] {
  const smells: CodeSmell[] = [];
  let braceDepth = 0;
  let classStart = -1;
  let className = "";
  let methodCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const classMatch = line.match(
      /(?:class\s+(\w+)|(?:interface|type)\s+(\w+))/,
    );
    if (classMatch && braceDepth === 0) {
      classStart = i;
      className = classMatch[1] || classMatch[2] || "";
      methodCount = 0;
    }
    // Count methods inside class
    if (braceDepth > 0 && classStart >= 0) {
      if (
        /(?:public|private|protected|static|async)\s+\w+\s*\(/.test(line) ||
        /(?:get|set)\s+\w+/.test(line)
      ) {
        methodCount++;
      }
    }
    const { open, close } = countBracesSkippingStrings(line);
    braceDepth += open - close;
    if (braceDepth === 0 && classStart >= 0) {
      const classLines = i - classStart + 1;
      if (methodCount > 20 || classLines > 500) {
        const severity =
          methodCount > 30 || classLines > 1000
            ? "critical"
            : methodCount > 25 || classLines > 700
              ? "high"
              : "medium";
        smells.push({
          smell: "god_class",
          severity,
          confidence: 0.85,
          line: classStart + 1,
          column: 0,
          message: `Class "${className}" has ${methodCount} methods and ${classLines} lines`,
          suggestion:
            "Split into smaller classes with single responsibilities (SRP)",
          metric: methodCount,
        });
      }
      classStart = -1;
    }
  }
  return smells;
}

function detectDeepNesting(lines: string[]): CodeSmell[] {
  const smells: CodeSmell[] = [];
  let maxDepth = 0;
  let maxDepthLine = 0;
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const { open, close } = countBracesSkippingStrings(line);
    depth += open - close;
    if (depth > maxDepth) {
      maxDepth = depth;
      maxDepthLine = i + 1;
    }
  }

  if (maxDepth > 4) {
    const severity =
      maxDepth > 8
        ? "critical"
        : maxDepth > 6
          ? "high"
          : maxDepth > 5
            ? "medium"
            : "low";
    smells.push({
      smell: "deep_nesting",
      severity,
      confidence: 0.85,
      line: maxDepthLine,
      column: 0,
      message: `Maximum nesting depth is ${maxDepth} levels`,
      suggestion:
        "Extract nested logic into helper functions, use early returns, or flatten with guard clauses",
      metric: maxDepth,
    });
  }
  return smells;
}

function detectLongParameterList(lines: string[]): CodeSmell[] {
  const smells: CodeSmell[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(
      /(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|(?:\w+))\s*=>)\s*\(([^)]+)\)/,
    );
    if (match) {
      const params = match[1]
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p && !p.startsWith("_"));
      if (params.length > 4) {
        const severity =
          params.length > 8
            ? "critical"
            : params.length > 6
              ? "high"
              : "medium";
        smells.push({
          smell: "long_parameter_list",
          severity,
          confidence: 0.85,
          line: i + 1,
          column: line.indexOf("function") >= 0 ? line.indexOf("function") : 0,
          message: `Function has ${params.length} parameters`,
          suggestion:
            "Group related parameters into an options object or use a configuration struct",
          metric: params.length,
        });
      }
    }
  }
  return smells;
}

function detectMagicNumbers(lines: string[]): CodeSmell[] {
  const smells: CodeSmell[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comments, imports, type definitions
    if (
      /^\s*\/\//.test(line) ||
      /^\s*import/.test(line) ||
      /^\s*export type/.test(line)
    )
      continue;
    const regex = /(?<=[\s=<>+\-*/(,])(\d{3,})(?![\w\d])/g;
    let match;
    while ((match = regex.exec(line)) !== null) {
      const num = Number(match[1]);
      if (MAGIC_NUMBER_SAFE.has(num)) continue;
      // Skip year-like numbers
      if (num >= 1900 && num <= 2100) continue;
      smells.push({
        smell: "magic_number",
        severity: "medium",
        confidence: 0.7,
        line: i + 1,
        column: match.index ?? 0,
        message: `Magic number ${num} found`,
        suggestion: `Extract to a named constant: const MY_${num}_CONSTANT = ${num}`,
        metric: num,
      });
      if (smells.length >= 20) break; // Cap per detector
    }
    if (smells.length >= 20) break;
  }
  return smells;
}

function detectDuplicateCode(lines: string[]): CodeSmell[] {
  const smells: CodeSmell[] = [];
  const WINDOW = 5;
  const hashes = new Map<string, number[]>();

  for (let i = 0; i <= lines.length - WINDOW; i++) {
    const block = lines
      .slice(i, i + WINDOW)
      .map((l) => l.trim())
      .filter((l) => l.length > 10)
      .join("\n");
    if (block.length < 30) continue;
    // Simple hash
    let hash = 0;
    for (let j = 0; j < block.length; j++) {
      hash = ((hash << 5) - hash + block.charCodeAt(j)) | 0;
    }
    const key = String(hash);
    const existing = hashes.get(key);
    if (existing) {
      // Check it's not just similar indentation
      const prevBlock = lines
        .slice(existing[0], existing[0] + WINDOW)
        .map((l) => l.trim())
        .join("\n");
      if (prevBlock === block && existing[0] !== i) {
        smells.push({
          smell: "duplicate_code",
          severity: "medium",
          confidence: 0.8,
          line: i + 1,
          column: 0,
          message: `Duplicate ${WINDOW}-line block (first at line ${existing[0] + 1})`,
          suggestion:
            "Extract duplicated code into a shared function or utility",
          metric: WINDOW,
        });
        if (smells.length >= 10) break;
      }
    } else {
      hashes.set(key, [i]);
    }
  }
  return smells;
}

function detectMissingErrorHandling(lines: string[]): CodeSmell[] {
  const smells: CodeSmell[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*await\s+/.test(line) || /\bawait\s+/.test(line)) {
      // Check if this await is inside a try block (scan backwards, tracking brace depth
      // to avoid false positives from nested functions)
      let inTry = false;
      let depth = 0;
      for (let j = i - 1; j >= Math.max(0, i - 40); j--) {
        const { open, close } = countBracesSkippingStrings(lines[j]);
        depth += open - close;

        if (/\btry\s*\{/.test(lines[j])) {
          // Only consider this try block if we haven't entered a nested scope
          if (depth <= 0) {
            inTry = true;
            break;
          }
        }
        // If we hit a catch/finally or go above initial depth, stop
        if (/\bcatch\s*\(/.test(lines[j]) || /\bfinally\s*\{/.test(lines[j])) {
          break;
        }
        // If depth goes negative, we've left the enclosing scope
        if (depth < 0) break;
      }
      if (!inTry) {
        smells.push({
          smell: "missing_error_handling",
          severity: "high",
          confidence: 0.75,
          line: i + 1,
          column: line.indexOf("await"),
          message: "Await without try-catch — unhandled rejection risk",
          suggestion:
            "Wrap in try-catch or add .catch() handler to prevent unhandled promise rejection",
        });
        if (smells.length >= 10) break;
      }
    }
  }
  return smells;
}

function detectLongChain(lines: string[]): CodeSmell[] {
  const smells: CodeSmell[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const matches = line.matchAll(/(\w+(?:\.\w+){4,})/g);
    for (const match of matches) {
      const chain = match[1];
      const depth = chain.split(".").length - 1;
      if (depth > 4) {
        smells.push({
          smell: "long_chain",
          severity: depth > 6 ? "high" : "medium",
          confidence: 0.7,
          line: i + 1,
          column: match.index ?? 0,
          message: `Property chain depth ${depth}: ${chain.slice(0, 40)}...`,
          suggestion:
            "Introduce intermediate variables or refactor into methods on the owning object",
          metric: depth,
        });
        if (smells.length >= 10) break;
      }
    }
    if (smells.length >= 3) break;
  }
  return smells;
}

function detectStarExports(lines: string[]): CodeSmell[] {
  const smells: CodeSmell[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/export\s+\*\s+from/.test(lines[i])) {
      smells.push({
        smell: "star_export",
        severity: "medium",
        confidence: 0.8,
        line: i + 1,
        column: lines[i].indexOf("export"),
        message: "Barrel export with wildcard — re-exports everything",
        suggestion:
          "Use named exports to prevent namespace pollution and improve tree-shaking",
      });
      if (smells.length >= 3) break;
    }
  }
  return smells;
}

function detectAnyType(lines: string[]): CodeSmell[] {
  const smells: CodeSmell[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/:\s*any\b|as\s+any\b/.test(line)) {
      smells.push({
        smell: "any_type",
        severity: "medium",
        confidence: 0.85,
        line: i + 1,
        column: line.indexOf("any"),
        message: "TypeScript `any` type used — defeats type safety",
        suggestion:
          "Replace with specific type, use generics, or use `unknown` with type guards",
      });
      if (smells.length >= 3) break;
    }
  }
  return smells;
}

function detectUnusedImports(lines: string[], _filePath: string): CodeSmell[] {
  const smells: CodeSmell[] = [];
  const imports: Array<{ name: string; line: number; column: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip pure type-only imports (they don't appear in runtime code)
    if (/^\s*import\s+type\s+/.test(line)) continue;

    // Match: import { foo, type Bar, baz } from "..."
    const namedMatch = line.match(/import\s*\{([^}]+)\}\s*from/);
    if (namedMatch) {
      const names = namedMatch[1].split(",").map((n) => {
        const trimmed = n.trim();
        // Skip type-only named imports: "type Foo"
        if (/^type\s+/.test(trimmed)) return "";
        const parts = trimmed.split(/\s+as\s+/);
        return parts[parts.length - 1].trim(); // use alias if present
      });
      for (const name of names) {
        if (name) {
          imports.push({
            name,
            line: i + 1,
            column: line.indexOf(name),
          });
        }
      }
    }
    const defaultMatch = line.match(/import\s+(\w+)\s+from/);
    if (defaultMatch) {
      imports.push({
        name: defaultMatch[1],
        line: i + 1,
        column: line.indexOf(defaultMatch[1]),
      });
    }
  }

  // Collect all re-exported names (they are used by downstream consumers)
  const reExportedNames = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // export { foo, bar } from "./..."
    const reExportMatch = line.match(/export\s*\{([^}]+)\}\s*from\s*['"]/);
    if (reExportMatch) {
      for (const name of reExportMatch[1].split(",")) {
        const trimmed = name
          .trim()
          .split(/\s+as\s+/)[0]
          .trim();
        if (trimmed) reExportedNames.add(trimmed);
      }
    }
  }

  // Check usage (exclude import lines themselves)
  const codeLines = lines.filter(
    (l) => !/^\s*import\s/.test(l) && !/^\s*export\s/.test(l),
  );
  const codeContent = codeLines.join("\n");

  for (const imp of imports) {
    // Re-exported names are considered used
    if (reExportedNames.has(imp.name)) continue;
    // Check if the import name appears in the code (not in import statements)
    const regex = new RegExp(`\\b${imp.name}\\b`);
    if (!regex.test(codeContent)) {
      smells.push({
        smell: "unused_import",
        severity: "low",
        confidence: 0.8,
        line: imp.line,
        column: imp.column,
        message: `Import "${imp.name}" is unused`,
        suggestion:
          "Remove the unused import to reduce bundle size and clutter",
      });
    }
  }
  return smells.slice(0, 20); // Cap unused imports per file
}

function detectSimpleSmells(lines: string[], filePath: string): CodeSmell[] {
  const smells: CodeSmell[] = [];
  const isTest = isTestFile(filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Empty catch
    if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
      smells.push({
        smell: "empty_catch",
        severity: "critical",
        confidence: 0.95,
        line: i + 1,
        column: line.indexOf("catch"),
        message: "Empty catch block — errors silently swallowed",
        suggestion:
          "Log the error, re-throw, or add a comment explaining why it's intentionally ignored",
      });
    }

    // Var usage
    if (/\bvar\s+/.test(line) && !/^\s*\/\//.test(line)) {
      smells.push({
        smell: "var_usage",
        severity: "low",
        confidence: 0.98,
        line: i + 1,
        column: line.indexOf("var"),
        message: "Use const/let instead of var for block scoping",
        suggestion: "Replace `var` with `const` (preferred) or `let`",
      });
    }

    // Loose equality
    if (/[^=!]==(?!=)/.test(line) && !/^\s*\/\//.test(line)) {
      smells.push({
        smell: "loose_equality",
        severity: "medium",
        confidence: 0.9,
        line: i + 1,
        column: line.indexOf("=="),
        message: "Loose equality (==) used instead of strict (===)",
        suggestion: "Use === for type-safe comparisons",
      });
    }

    // Console.log (exclude in test files)
    if (!isTest && /console\.(log|debug|info)\s*\(/.test(line)) {
      smells.push({
        smell: "debug_code",
        severity: "low",
        confidence: 0.95,
        line: i + 1,
        column: line.indexOf("console."),
        message: "Debug statement left in code",
        suggestion:
          "Remove console.log or replace with a proper logger (e.g. electron-log)",
      });
    }

    // TODO/FIXME
    const todoMatch = line.match(/\/\/\s*(TODO|FIXME|HACK|XXX)/i);
    if (todoMatch) {
      smells.push({
        smell: "todo_comment",
        severity: "low",
        confidence: 0.98,
        line: i + 1,
        column: line.indexOf(todoMatch[1]),
        message: `${todoMatch[1]} comment found`,
        suggestion: "Address the TODO or create a tracked issue",
      });
    }

    // Commented code (3+ consecutive comment lines that look like code)
    if (
      i >= 2 &&
      /^\s*\/\//.test(line) &&
      /^\s*\/\//.test(lines[i - 1]) &&
      /^\s*\/\//.test(lines[i - 2])
    ) {
      const block = lines.slice(i - 2, i + 1).join("\n");
      if (/[;{}=]/.test(block) && block.length > 40) {
        smells.push({
          smell: "commented_code",
          severity: "low",
          confidence: 0.7,
          line: i - 1,
          column: 0,
          message: "3+ consecutive comment lines that look like code",
          suggestion:
            "Delete commented-out code — use version control to recover old code",
        });
      }
    }
  }
  return smells;
}

// ── Main Analysis ────────────────────────────────────────────────────

function analyzeFile(filePath: string, content: string): SmellReport {
  const lines = content.split("\n");
  const smells: CodeSmell[] = [];

  // Structural detectors (line-by-line parsing)
  smells.push(...detectLongMethod(lines, filePath));
  smells.push(...detectGodClass(lines, filePath));
  smells.push(...detectDeepNesting(lines));
  smells.push(...detectLongParameterList(lines));
  smells.push(...detectMagicNumbers(lines));
  smells.push(...detectDuplicateCode(lines));
  smells.push(...detectMissingErrorHandling(lines));
  smells.push(...detectLongChain(lines));
  smells.push(...detectStarExports(lines));
  smells.push(...detectAnyType(lines));
  smells.push(...detectUnusedImports(lines, filePath));

  // Simple pattern detectors
  smells.push(...detectSimpleSmells(lines, filePath));

  // Build summary
  const summary: Record<string, number> = {};
  for (const s of smells) {
    summary[s.smell] = (summary[s.smell] || 0) + 1;
  }

  // Calculate score
  let score = 100;
  for (const s of smells) {
    switch (s.severity) {
      case "critical":
        score -= 15;
        break;
      case "high":
        score -= 8;
        break;
      case "medium":
        score -= 3;
        break;
      case "low":
        score -= 1;
        break;
    }
  }

  return {
    file: filePath,
    score: Math.max(0, score),
    smells: smells,
    summary,
  };
}

function buildAttributes(
  args: Partial<z.infer<typeof codeSmellsSchema>>,
  stats?: { health: number; smells: number; files: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) {
    attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  }
  if (stats) {
    attrs.push(`health="${stats.health}"`);
    attrs.push(`smells="${stats.smells}"`);
    attrs.push(`files="${stats.files}"`);
  }
  return attrs.join(" ");
}

export const codeSmellsTool: ToolDefinition<z.infer<typeof codeSmellsSchema>> =
  {
    name: "code_smells",
    description: DESCRIPTION,
    inputSchema: codeSmellsSchema,
    defaultConsent: "always",
    modifiesState: false,

    isEnabled: (_ctx: AgentContext) => true,

    getConsentPreview: (args) => {
      let preview = "Analyze code smells";
      if (args.app_name) {
        preview += ` in app: ${args.app_name}`;
      }
      return preview;
    },

    buildXml: (args, isComplete) => {
      if (isComplete) return undefined;
      return `<dyad-code-smells ${buildAttributes(args)}>Scanning files...</dyad-code-smells>`;
    },

    execute: async (args, ctx: AgentContext) => {
      const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
      const maxFiles = Math.min(
        args.max_files ?? DEFAULT_MAX_FILES,
        MAX_MAX_FILES,
      );

      logger.log(`Analyzing code smells in ${targetAppPath}`);
      ctx.onXmlStream(
        `<dyad-code-smells ${buildAttributes(args)}>Scanning ${maxFiles} files...</dyad-code-smells>`,
      );

      try {
        const files = await walkDirectory(targetAppPath, {
          maxFiles,
          filePattern: /\.(ts|tsx|js|jsx|py|go|rs|java|kt|cs|rb|php|swift)$/,
        });
        const reports: SmellReport[] = [];
        const startTime = Date.now();

        for (const file of files) {
          if (Date.now() - startTime > TOTAL_TIMEOUT_MS) break;
          try {
            // Skip files larger than 1MB
            try {
              const stat = await fs.stat(file);
              if (stat.size > 1024 * 1024) continue;
            } catch {
              continue;
            }
            const content = await Promise.race([
              fs.readFile(file, "utf-8"),
              sleep(READ_TIMEOUT_MS).then(() => {
                throw new DyadError("Read timeout", DyadErrorKind.Validation);
              }),
            ]);
            const relativePath = path.relative(targetAppPath, file);
            const report = analyzeFile(relativePath, content);
            if (report.smells.length > 0) {
              reports.push(report);
            }
          } catch {
            // Skip unreadable files
          }
        }

        reports.sort((a, b) => a.score - b.score);
        const totalSmells = reports.reduce(
          (sum, r) => sum + r.smells.length,
          0,
        );
        const avgScore =
          reports.length > 0
            ? Math.round(
                reports.reduce((sum, r) => sum + r.score, 0) / reports.length,
              )
            : 100;

        const attrs = buildAttributes(args, {
          health: avgScore,
          smells: totalSmells,
          files: reports.length,
        });

        if (reports.length === 0) {
          ctx.onXmlComplete(
            `<dyad-code-smells ${attrs}>No code smells detected.</dyad-code-smells>`,
          );
          return "No code smells detected.";
        }

        // Build output with metrics and suggestions
        const fileLines = reports.slice(0, 30).map((r, i) => {
          const smellLines = r.smells
            .slice(0, 10)
            .map(
              (s) =>
                `  - [${s.severity}] ${s.smell} (L${s.line}:${s.column}): ${s.message}${s.metric !== undefined ? ` [${s.metric}]` : ""}\n    → ${s.suggestion}`,
            )
            .join("\n");
          const summaryStr = Object.entries(r.summary)
            .map(([k, v]) => `${k}:${v}`)
            .join(" ");
          return `${i + 1}. ${r.file} (score: ${r.score}/100) [${summaryStr}]\n${smellLines}`;
        });

        // Build smell type totals
        const smellTypeTotals: Record<string, number> = {};
        for (const r of reports) {
          for (const s of r.smells) {
            smellTypeTotals[s.smell] = (smellTypeTotals[s.smell] || 0) + 1;
          }
        }
        const typeBreakdown = Object.entries(smellTypeTotals)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k}:${v}`)
          .join(" ");

        const resultText = `Health Score: ${avgScore}/100
Total Smells: ${totalSmells} (${typeBreakdown})
Files Analyzed: ${reports.length}

Top Issues:
${fileLines.join("\n\n")}`;

        ctx.onXmlComplete(
          `<dyad-code-smells ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-code-smells>`,
        );
        return resultText;
      } catch (error) {
        if (error instanceof DyadError) throw error;
        throw new DyadError(
          `Failed to analyze code smells: ${error instanceof Error ? error.message : String(error)}`,
          DyadErrorKind.Unknown,
        );
      }
    },
  };
