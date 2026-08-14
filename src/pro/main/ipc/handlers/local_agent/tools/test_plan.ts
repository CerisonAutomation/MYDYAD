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

const logger = log.scope("test_plan");

const testPlanSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
  file: z
    .string()
    .optional()
    .describe("Specific source file to generate tests for"),
});

const DESCRIPTION = `Generate test plan for untested code.

- Identifies riskiest untested files
- Generates test stubs in the repo's testing framework
- Provides test cases for critical functions
- Use for improving test coverage`;

interface TestPlan {
  file: string;
  framework: string;
  testCases: string[];
  coverage: number;
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

async function detectTestFramework(appPath: string): Promise<string> {
  try {
    const packageJson = await fs.readFile(
      path.join(appPath, "package.json"),
      "utf-8",
    );
    const pkg = JSON.parse(packageJson);

    if (pkg.devDependencies?.jest || pkg.dependencies?.jest) return "jest";
    if (pkg.devDependencies?.vitest || pkg.dependencies?.vitest)
      return "vitest";
    if (pkg.devDependencies?.mocha || pkg.dependencies?.mocha) return "mocha";
    if (pkg.devDependencies?.playwright || pkg.dependencies?.playwright)
      return "playwright";

    return "vitest"; // Default
  } catch {
    return "vitest";
  }
}

function extractTestableFunctions(content: string): string[] {
  const functions: string[] = [];
  const functionRegex =
    /^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>)/;
  const lines = content.split("\n");

  for (const line of lines) {
    const match = line.match(functionRegex);
    if (match) {
      const name = match[1] || match[2];
      if (name && name !== "constructor" && !name.startsWith("_")) {
        functions.push(name);
      }
    }
  }
  return functions;
}

function generateTestStub(functionName: string, framework: string): string {
  if (framework === "jest" || framework === "vitest") {
    return `describe('${functionName}', () => {
  it('should handle normal case', () => {
    // TODO: Add test implementation
    expect(true).toBe(true);
  });

  it('should handle edge cases', () => {
    // TODO: Add edge case tests
    expect(true).toBe(true);
  });

  it('should handle error cases', () => {
    // TODO: Add error case tests
    expect(true).toBe(true);
  });
});`;
  }

  if (framework === "playwright") {
    return `test('${functionName}', async ({ page }) => {
  // TODO: Add test implementation
  await expect(page).toHaveTitle(/./);
});`;
  }

  return `describe('${functionName}', () => {
  it('should work', () => {
    // TODO: Add test
  });
});`;
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
      } else if (
        entry.name.match(/\.(ts|tsx|js|jsx)$/) &&
        !entry.name.includes(".test.") &&
        !entry.name.includes(".spec.")
      ) {
        files.push(fullPath);
      }
    }
  } catch {
    // Skip inaccessible directories
  }
  return files;
}

function buildAttributes(
  args: Partial<z.infer<typeof testPlanSchema>>,
  plan?: TestPlan,
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (args.file) attrs.push(`file="${escapeXmlAttr(args.file)}"`);
  if (plan) {
    attrs.push(`framework="${plan.framework}"`);
    attrs.push(`test_cases="${plan.testCases.length}"`);
    attrs.push(`coverage="${plan.coverage}"`);
  }
  return attrs.join(" ");
}

export const testPlanTool: ToolDefinition<z.infer<typeof testPlanSchema>> = {
  name: "test_plan",
  description: DESCRIPTION,
  inputSchema: testPlanSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Generate test plan";
    if (args.app_name) preview += ` for app: ${args.app_name}`;
    if (args.file) preview += ` for ${args.file}`;
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-test-plan ${buildAttributes(args)}>Generating test plan...</dyad-test-plan>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Generating test plan for ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-test-plan ${buildAttributes(args)}>Analyzing test coverage...</dyad-test-plan>`,
    );

    try {
      const framework = await detectTestFramework(targetAppPath);
      let targetFile = args.file;

      if (!targetFile) {
        // Find file with most functions (riskiest untested)
        const files = await walkDirectory(targetAppPath, EXCLUDE_DIRS);
        let maxFunctions = 0;

        for (const file of files) {
          try {
            const content = await fs.readFile(file, "utf-8");
            const functions = extractTestableFunctions(content);
            if (functions.length > maxFunctions) {
              maxFunctions = functions.length;
              targetFile = path.relative(targetAppPath, file);
            }
          } catch {
            // Skip
          }
        }
      }

      if (!targetFile) {
        ctx.onXmlComplete(
          `<dyad-test-plan ${buildAttributes(args)}>No source files found.</dyad-test-plan>`,
        );
        return "No source files found.";
      }

      const filePath = path.join(targetAppPath, targetFile);
      const content = await fs.readFile(filePath, "utf-8");
      const functions = extractTestableFunctions(content);

      const testCases = functions.map((f) => generateTestStub(f, framework));
      const coverage = 0; // Would need to check existing tests

      const plan: TestPlan = {
        file: targetFile,
        framework,
        testCases,
        coverage,
      };

      const attrs = buildAttributes(args, plan);

      let resultText = `Test Plan for: ${targetFile}\n`;
      resultText += `Framework: ${framework}\n`;
      resultText += `Functions to test: ${functions.length}\n\n`;

      resultText += `Generated Test Stubs:\n\n`;
      testCases.forEach((test, i) => {
        resultText += `// ${functions[i]}\n${test}\n\n`;
      });

      resultText += `\n💡 Tip: Run the tests with: npm test -- ${targetFile.replace(/\.(ts|tsx|js|jsx)$/, ".test.$1")}`;

      ctx.onXmlComplete(
        `<dyad-test-plan ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-test-plan>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to generate test plan: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
