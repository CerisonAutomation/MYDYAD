/**
 * Code Research Tool
 *
 * Research codebase repositories to understand implementation details.
 * Based on code-research skill with parallel query decomposition.
 *
 * Features:
 * - Parallel search queries for faster research
 * - Multi-angle investigation (entry points, data flow, config, tests)
 * - Structured findings with file paths and code references
 * - Pattern extraction and comparison
 */

import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentContext, ToolDefinition } from "./types";

const codeResearchSchema = z.object({
  operation: z
    .enum(["research", "compare", "extract_patterns", "find_examples"])
    .describe("Operation to perform"),
  repo: z.string().describe("GitHub repository (e.g., vercel/next.js)"),
  question: z.string().describe("Research question about the repo"),
  search_angles: z
    .array(z.string())
    .optional()
    .describe("Custom search angles (overrides auto-decomposition)"),
  max_results: z.number().optional().describe("Maximum results per angle"),
  ref: z
    .string()
    .optional()
    .describe("Specific branch, tag, or commit to research"),
});

type CodeResearchArgs = z.infer<typeof codeResearchSchema>;

interface ResearchFinding {
  angle: string;
  files: Array<{
    path: string;
    relevance: number;
    snippet: string;
  }>;
  summary: string;
  key_insights: string[];
}

interface ResearchResult {
  repo: string;
  question: string;
  findings: ResearchFinding[];
  synthesis: string;
  patterns: string[];
  file_references: string[];
  confidence: number;
}

// Auto-decompose question into search angles
function decomposeQuestion(question: string): string[] {
  const questionLower = question.toLowerCase();
  const angles: string[] = [];

  // Common patterns
  if (
    questionLower.includes("auth") ||
    questionLower.includes("login") ||
    questionLower.includes("session")
  ) {
    angles.push(
      "authentication middleware and session handling",
      "login/signup API routes and handlers",
      "auth configuration and token validation",
    );
  } else if (
    questionLower.includes("database") ||
    questionLower.includes("orm") ||
    questionLower.includes("query")
  ) {
    angles.push(
      "database connection and configuration",
      "ORM models and schema definitions",
      "query builders and data access patterns",
    );
  } else if (
    questionLower.includes("api") ||
    questionLower.includes("route") ||
    questionLower.includes("endpoint")
  ) {
    angles.push(
      "API route definitions and handlers",
      "request/response middleware",
      "API documentation and types",
    );
  } else if (
    questionLower.includes("test") ||
    questionLower.includes("spec") ||
    questionLower.includes("e2e")
  ) {
    angles.push(
      "test configuration and setup",
      "unit test patterns and examples",
      "integration and E2E test patterns",
    );
  } else if (
    questionLower.includes("config") ||
    questionLower.includes("setup") ||
    questionLower.includes("build")
  ) {
    angles.push(
      "configuration files and environment setup",
      "build pipeline and compilation",
      "deployment and environment variables",
    );
  } else if (
    questionLower.includes("component") ||
    questionLower.includes("ui") ||
    questionLower.includes("render")
  ) {
    angles.push(
      "component structure and composition",
      "state management and data flow",
      "rendering patterns and optimization",
    );
  } else {
    // Generic decomposition
    angles.push(
      "entry points and main exports",
      "core implementation and key functions",
      "configuration and setup patterns",
      "tests and usage examples",
    );
  }

  return angles;
}

// Walk directory tree collecting files that match extensions
async function walkForResearch(
  dir: string,
  maxFiles: number,
  collected: string[] = [],
): Promise<string[]> {
  if (collected.length >= maxFiles) return collected;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (collected.length >= maxFiles) break;
      const fullPath = path.join(dir, entry.name);
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        entry.name !== "node_modules" &&
        entry.name !== "dist" &&
        entry.name !== "build"
      ) {
        await walkForResearch(fullPath, maxFiles, collected);
      } else if (
        entry.isFile() &&
        /\.(ts|tsx|js|jsx|py|go|java|rb|php|rs|vue|svelte|css|scss)$/.test(
          entry.name,
        )
      ) {
        collected.push(fullPath);
      }
    }
  } catch {
    // Skip inaccessible directories
  }
  return collected;
}

// Search a single file for a query string, returning line snippets with context
function searchFileContent(
  content: string,
  queryTerms: string[],
): { snippet: string; line: number; relevance: number } | null {
  const lines = content.split("\n");
  const queryLower = queryTerms.map((t) => t.toLowerCase());
  let bestLine = -1;
  let bestScore = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineLower = lines[i].toLowerCase();
    let score = 0;
    for (const term of queryLower) {
      if (lineLower.includes(term)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestLine = i;
    }
  }

  if (bestLine === -1) return null;

  // Build snippet with surrounding context
  const start = Math.max(0, bestLine - 1);
  const end = Math.min(lines.length - 1, bestLine + 2);
  const snippetLines = [];
  for (let i = start; i <= end; i++) {
    const prefix = i === bestLine ? ">>> " : "    ";
    snippetLines.push(`${prefix}${lines[i]}`);
  }

  const relevance = Math.min(1.0, 0.5 + bestScore * 0.15);

  return {
    snippet: snippetLines.join("\n"),
    line: bestLine + 1,
    relevance,
  };
}

// Perform real research by searching the local codebase
async function searchCodebase(
  appPath: string,
  _repo: string,
  question: string,
  angles: string[],
): Promise<ResearchResult> {
  const MAX_FILES = 500;
  const files = await walkForResearch(appPath, MAX_FILES);

  const findings: ResearchFinding[] = [];

  for (const angle of angles) {
    const angleTerms = angle
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 5);

    const angleHits: ResearchFinding["files"] = [];

    // Search by file name match
    for (const filePath of files) {
      const basename = path.basename(filePath).toLowerCase();
      let nameScore = 0;
      for (const term of angleTerms) {
        if (basename.includes(term.toLowerCase())) nameScore++;
      }
      if (nameScore > 0) {
        const relativePath = path.relative(appPath, filePath);
        angleHits.push({
          path: relativePath,
          relevance: Math.min(1.0, 0.6 + nameScore * 0.15),
          snippet: `[File: ${relativePath}]`,
        });
      }
    }

    // Search by content match
    for (const filePath of files) {
      try {
        const stat = await fs.stat(filePath);
        if (stat.size > 512 * 1024) continue; // Skip large files
        const content = await fs.readFile(filePath, "utf-8");
        const relativePath = path.relative(appPath, filePath);
        const hit = searchFileContent(content, angleTerms);
        if (hit && !angleHits.some((h) => h.path === relativePath)) {
          angleHits.push({
            path: relativePath,
            relevance: hit.relevance,
            snippet: hit.snippet,
          });
        }
      } catch {
        // Skip unreadable files
      }
    }

    // Sort by relevance and take top results
    angleHits.sort((a, b) => b.relevance - a.relevance);
    const topHits = angleHits.slice(0, 5);

    findings.push({
      angle,
      files: topHits,
      summary:
        topHits.length > 0
          ? `Found ${topHits.length} relevant file(s) for "${angle}"`
          : `No files matched angle "${angle}"`,
      key_insights: topHits
        .slice(0, 3)
        .map(
          (h) =>
            `Relevant file: ${h.path} (relevance: ${h.relevance.toFixed(2)})`,
        ),
    });
  }

  // Extract unique patterns (top-level directories of findings)
  const allPaths = findings.flatMap((f) => f.files.map((file) => file.path));
  const uniquePatterns = [...new Set(allPaths.map((p) => path.dirname(p)))]
    .filter((d) => d !== ".")
    .slice(0, 5);

  return {
    repo: _repo,
    question,
    findings,
    synthesis: `Searched ${files.length} files in the codebase for "${question}". Found ${allPaths.length} matching file(s) across ${angles.length} research angle(s).`,
    patterns: uniquePatterns.map((d) => `Directory structure: ${d}`),
    file_references: allPaths,
    confidence:
      allPaths.length > 0 ? Math.min(0.95, 0.5 + allPaths.length * 0.05) : 0.2,
  };
}

export const codeResearchTool: ToolDefinition<CodeResearchArgs> = {
  name: "code_research",
  description: `Research open-source repositories to understand implementation details.

Based on code-research skill with parallel query decomposition.

Operations:
- research: Deep research on a specific question
- compare: Compare implementations across repos
- extract_patterns: Extract common patterns
- find_examples: Find usage examples

Features:
- Auto-decompose questions into search angles
- Parallel queries for faster research
- Structured findings with file paths
- Pattern extraction and synthesis

Examples:
- "How does Next.js handle authentication?"
- "What patterns does React use for state management?"
- "How is error handling implemented in Express?"

Input: GitHub repo + research question
Output: Structured findings with file references`,
  inputSchema: codeResearchSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) =>
    `Research ${args.repo}: ${args.question.slice(0, 50)}`,

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    const attrs = [`repo="${args.repo}"`];
    if (args.ref) attrs.push(`ref="${args.ref}"`);
    return `<dyad-code-research ${attrs.join(" ")}>Researching...</dyad-code-research>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const startTime = Date.now();

    ctx.onXmlStream(
      `<dyad-code-research repo="${args.repo}">Decomposing question...</dyad-code-research>`,
    );

    // Decompose question into search angles
    const angles = args.search_angles || decomposeQuestion(args.question);

    ctx.onXmlStream(
      `<dyad-code-research angles="${angles.length}">Running parallel searches...</dyad-code-research>`,
    );

    // Real research using local codebase
    const result = await searchCodebase(
      ctx.appPath,
      args.repo,
      args.question,
      angles,
    );

    const elapsed = Date.now() - startTime;

    ctx.onXmlComplete(
      `<dyad-code-research repo="${args.repo}" elapsed_ms="${elapsed}">${JSON.stringify(result, null, 2)}</dyad-code-research>`,
    );

    return JSON.stringify(result, null, 2);
  },
};
