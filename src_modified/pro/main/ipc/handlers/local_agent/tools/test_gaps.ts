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

const logger = log.scope("test_gaps");

const testGapsSchema = z.object({
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
      "Specific source file to analyze (relative path). If omitted, scans entire repo.",
    ),
});

const DESCRIPTION = `Find untested functions, missing test files, and skipped tests.

- Returns test coverage gaps with scores
- Detects: untested functions, missing test files, skipped tests
- Use for test coverage improvement and pre-release quality checks`;

interface TestGap {
  function: string;
  line: number;
  type: "no_test" | "skipped_test";
}

interface TestGapReport {
  sourceFile: string;
  testFile: string | null;
  gaps: TestGap[];
  coverageRate: number;
  score: number;
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

function extractFunctionNames(
  content: string,
): Array<{ name: string; line: number }> {
  const functions: Array<{ name: string; line: number }> = [];
  const lines = content.split("\n");
  const functionRegex =
    /^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\()/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(functionRegex);
    if (match) {
      const name = match[1] || match[2];
      if (name && name !== "constructor") {
        functions.push({ name, line: i + 1 });
      }
    }
  }
  return functions;
}

function analyzeTestFile(testContent: string): Set<string> {
  const tested = new Set<string>();
  const testPatterns = [/(?:it|test)\s*\(\s*['"](.+?)['"]/g];

  for (const pattern of testPatterns) {
    let match;
    while ((match = pattern.exec(testContent)) !== null) {
      tested.add(match[1]);
    }
  }

  const functionCalls = testContent.match(/\b(\w+)\s*\(/g);
  if (functionCalls) {
    for (const call of functionCalls) {
      const name = call.replace(/\s*\(/, "");
      if (
        name &&
        ![
          "expect",
          "describe",
          "it",
          "test",
          "beforeEach",
          "afterEach",
          "jest",
          "vi",
        ].includes(name)
      ) {
        tested.add(name);
      }
    }
  }
  return tested;
}

function findTestFile(sourcePath: string, allFiles: string[]): string | null {
  const dir = path.dirname(sourcePath);
  const basename = path.basename(sourcePath, path.extname(sourcePath));
  const testPatterns = [
    `${basename}.test.ts`,
    `${basename}.test.tsx`,
    `${basename}.test.js`,
    `${basename}.spec.ts`,
    `${basename}.spec.tsx`,
    `${basename}.spec.js`,
    `__tests__/${basename}.test.ts`,
    `__tests__/${basename}.test.tsx`,
  ];

  for (const pattern of testPatterns) {
    const testPath = path.join(dir, pattern);
    if (allFiles.includes(testPath)) return testPath;
  }
  return null;
}

function analyzeSourceFile(
  sourceContent: string,
  testContent: string | null,
): { gaps: TestGap[]; coverageRate: number; score: number } {
  const sourceFunctions = extractFunctionNames(sourceContent);
  const tested = testContent ? analyzeTestFile(testContent) : new Set<string>();
  const gaps: TestGap[] = [];

  for (const func of sourceFunctions) {
    const isTested =
      tested.has(func.name) ||
      [...tested].some((t) =>
        t.toLowerCase().includes(func.name.toLowerCase()),
      );
    if (!isTested) {
      gaps.push({ function: func.name, line: func.line, type: "no_test" });
    }
  }

  if (testContent) {
    const skippedMatches = testContent.match(
      /(?:it|test|describe)\.skip\s*\(\s*['"](.+?)['"]/g,
    );
    if (skippedMatches) {
      for (const match of skippedMatches) {
        const nameMatch = match.match(/['"](.+?)['"]/);
        if (nameMatch) {
          gaps.push({ function: nameMatch[1], line: 0, type: "skipped_test" });
        }
      }
    }
  }

  const coverageRate =
    sourceFunctions.length > 0
      ? Math.round(
          ((sourceFunctions.length -
            gaps.filter((g) => g.type === "no_test").length) /
            sourceFunctions.length) *
            100,
        )
      : 100;

  let score = 100;
  score -= gaps.filter((g) => g.type === "no_test").length * 5;
  score -= gaps.filter((g) => g.type === "skipped_test").length * 10;

  return { gaps, coverageRate, score: Math.max(0, score) };
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
      } else if (entry.name.match(/\.(ts|tsx|js|jsx)$/)) {
        files.push(fullPath);
      }
    }
  } catch {
    // Skip inaccessible directories
  }
  return files;
}

function buildAttributes(
  args: Partial<z.infer<typeof testGapsSchema>>,
  stats?: { coverage: number; gaps: number; files: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (args.file) attrs.push(`file="${escapeXmlAttr(args.file)}"`);
  if (stats) {
    attrs.push(`coverage="${stats.coverage}"`);
    attrs.push(`gaps="${stats.gaps}"`);
    attrs.push(`files="${stats.files}"`);
  }
  return attrs.join(" ");
}

export const testGapsTool: ToolDefinition<z.infer<typeof testGapsSchema>> = {
  name: "test_gaps",
  description: DESCRIPTION,
  inputSchema: testGapsSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Analyze test coverage gaps";
    if (args.app_name) preview += ` in app: ${args.app_name}`;
    if (args.file) preview += ` for ${args.file}`;
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-test-gaps ${buildAttributes(args)}>Analyzing test coverage...</dyad-test-gaps>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Analyzing test gaps in ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-test-gaps ${buildAttributes(args)}>Analyzing test coverage...</dyad-test-gaps>`,
    );

    try {
      const allFiles = await walkDirectory(targetAppPath, EXCLUDE_DIRS);
      const reports: TestGapReport[] = [];

      if (args.file) {
        const safeRelative = await resolveDirectoryWithinAppPath({
          appPath: targetAppPath,
          directory: args.file,
        });
        const sourcePath = path.join(targetAppPath, safeRelative);
        const sourceContent = await fs.readFile(sourcePath, "utf-8");
        const testFilePath = findTestFile(args.file, allFiles);
        let testContent = null;
        if (testFilePath) {
          testContent = await fs.readFile(
            path.join(targetAppPath, testFilePath),
            "utf-8",
          );
        }
        const { gaps, coverageRate, score } = analyzeSourceFile(
          sourceContent,
          testContent,
        );
        reports.push({
          sourceFile: args.file,
          testFile: testFilePath,
          gaps,
          coverageRate,
          score,
        });
      } else {
        const sourceFiles = allFiles.filter(
          (f) =>
            f.match(/\.(ts|tsx|js|jsx)$/) &&
            !f.includes(".test.") &&
            !f.includes(".spec."),
        );
        for (const sourceFile of sourceFiles) {
          try {
            const sourceContent = await fs.readFile(sourceFile, "utf-8");
            const relativePath = path.relative(targetAppPath, sourceFile);
            const testFilePath = findTestFile(relativePath, allFiles);
            let testContent = null;
            if (testFilePath) {
              testContent = await fs.readFile(
                path.join(targetAppPath, testFilePath),
                "utf-8",
              );
            }
            const { gaps, coverageRate, score } = analyzeSourceFile(
              sourceContent,
              testContent,
            );
            if (gaps.length > 0) {
              reports.push({
                sourceFile: relativePath,
                testFile: testFilePath,
                gaps,
                coverageRate,
                score,
              });
            }
          } catch {
            // Skip unreadable files
          }
        }
      }

      reports.sort((a, b) => a.score - b.score);
      const totalGaps = reports.reduce((sum, r) => sum + r.gaps.length, 0);
      const avgCoverage =
        reports.length > 0
          ? Math.round(
              reports.reduce((sum, r) => sum + r.coverageRate, 0) /
                reports.length,
            )
          : 100;

      const attrs = buildAttributes(args, {
        coverage: avgCoverage,
        gaps: totalGaps,
        files: reports.length,
      });

      if (reports.length === 0) {
        ctx.onXmlComplete(
          `<dyad-test-gaps ${attrs}>No test gaps detected.</dyad-test-gaps>`,
        );
        return "No test gaps detected.";
      }

      const lines = reports.slice(0, 15).map(
        (r, i) =>
          `${i + 1}. ${r.sourceFile} (coverage: ${r.coverageRate}%, score: ${r.score})\n   Test file: ${r.testFile || "MISSING"}\n   Gaps: ${r.gaps
            .slice(0, 3)
            .map((g) => `- ${g.function} (${g.type})`)
            .join("\n   ")}`,
      );

      const resultText = `Coverage: ${avgCoverage}%\nFiles with Gaps: ${reports.length}\nTotal Gaps: ${totalGaps}\n\nTop Files:\n${lines.join("\n\n")}`;

      ctx.onXmlComplete(
        `<dyad-test-gaps ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-test-gaps>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to analyze test gaps: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
