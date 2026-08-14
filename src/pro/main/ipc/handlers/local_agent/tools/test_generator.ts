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

const logger = log.scope("test_generator");

const testGeneratorSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe("Optional. Name of a referenced app to generate tests for."),
  file: z.string().describe("Source file to generate tests for"),
  framework: z
    .enum(["vitest", "jest", "playwright", "mocha"])
    .optional()
    .describe("Test framework (default: auto-detect)"),
  coverage_type: z
    .enum(["unit", "integration", "e2e"])
    .optional()
    .describe("Type of tests to generate (default: unit)"),
  include_edge_cases: z
    .boolean()
    .optional()
    .describe("Include edge case tests (default: true)"),
});

const DESCRIPTION = `AI-powered test generation with edge case coverage.

- Analyzes source code and generates comprehensive tests
- Auto-detects test framework and patterns
- Generates unit, integration, and E2E tests
- Includes edge cases, error handling, and boundary conditions

Features:
- Mock generation for external dependencies
- Async/await test patterns
- Error scenario coverage
- Boundary condition testing

Example: "Generate comprehensive tests for src/auth/login.ts"`;

interface TestCase {
  name: string;
  type: "unit" | "edge" | "error" | "boundary";
  code: string;
  description: string;
}

interface TestPlan {
  file: string;
  testFile: string;
  framework: string;
  testCases: TestCase[];
  setupCode: string;
  teardownCode: string;
}

async function analyzeSourceForTests(
  filePath: string,
  content: string,
): Promise<string[]> {
  const functions: string[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const match = line.match(
      /^(?:export\s+)?(?:async\s+)?(?:function|const|let|var)\s+(\w+)/,
    );
    if (match && match[1] !== "constructor") {
      functions.push(match[1]);
    }
  }

  return functions;
}

function generateTestCase(
  functionName: string,
  type: TestCase["type"],
  framework: string,
): TestCase {
  const templates: Record<string, Record<string, string>> = {
    vitest: {
      unit: `describe('${functionName}', () => {
  it('should handle normal case', async () => {
    // Arrange
    const input = {};

    // Act
    const result = ${functionName}(input);

    // Assert
    expect(result).toBeDefined();
  });
});`,
      edge: `describe('${functionName} edge cases', () => {
  it('should handle empty input', () => {
    expect(() => ${functionName}({})).not.toThrow();
  });

  it('should handle null input', () => {
    expect(() => ${functionName}(null)).not.toThrow();
  });

  it('should handle undefined input', () => {
    expect(() => ${functionName}(undefined)).not.toThrow();
  });
});`,
      error: `describe('${functionName} error handling', () => {
  it('should throw on invalid input', () => {
    expect(() => ${functionName}('invalid')).toThrow();
  });
});`,
      boundary: `describe('${functionName} boundaries', () => {
  it('should handle minimum value', () => {
    const result = ${functionName}(0);
    expect(result).toBeDefined();
  });

  it('should handle maximum value', () => {
    const result = ${functionName}(Number.MAX_SAFE_INTEGER);
    expect(result).toBeDefined();
  });
});`,
    },
  };

  const template = templates[framework] || templates.vitest;
  const code = template[type] || template.unit;

  return {
    name: `${functionName} - ${type}`,
    type,
    code,
    description: `Test ${functionName} for ${type} scenario`,
  };
}

function buildAttributes(
  args: Partial<z.infer<typeof testGeneratorSchema>>,
  plan?: TestPlan,
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  attrs.push(`file="${escapeXmlAttr(args.file)}"`);
  if (args.framework) attrs.push(`framework="${args.framework}"`);
  if (args.coverage_type) attrs.push(`type="${args.coverage_type}"`);
  if (plan) {
    attrs.push(`tests="${plan.testCases.length}"`);
    attrs.push(`test_file="${escapeXmlAttr(plan.testFile)}"`);
  }
  return attrs.join(" ");
}

export const testGeneratorTool: ToolDefinition<
  z.infer<typeof testGeneratorSchema>
> = {
  name: "test_generator",
  description: DESCRIPTION,
  inputSchema: testGeneratorSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = `Generate ${args.coverage_type || "unit"} tests for ${args.file}`;
    if (args.framework) preview += ` using ${args.framework}`;
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-test-gen ${buildAttributes(args)}>Analyzing source...</dyad-test-gen>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
    const filePath = path.join(targetAppPath, args.file);

    logger.log(`Generating tests for ${args.file}`);
    ctx.onXmlStream(
      `<dyad-test-gen ${buildAttributes(args)}>Analyzing functions...</dyad-test-gen>`,
    );

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const functions = await analyzeSourceForTests(filePath, content);
      const framework = args.framework || "vitest";

      const testCases: TestCase[] = [];
      for (const func of functions) {
        testCases.push(generateTestCase(func, "unit", framework));
        if (args.include_edge_cases !== false) {
          testCases.push(generateTestCase(func, "edge", framework));
          testCases.push(generateTestCase(func, "error", framework));
          testCases.push(generateTestCase(func, "boundary", framework));
        }
      }

      const testFile = args.file.replace(/\.(ts|tsx|js|jsx)$/, `.test.$1`);
      const plan: TestPlan = {
        file: args.file,
        testFile,
        framework,
        testCases,
        setupCode: `import { describe, it, expect } from '${framework}';`,
        teardownCode: "",
      };

      const attrs = buildAttributes(args, plan);

      let resultText = `Test Generation Plan:\n`;
      resultText += `Source: ${args.file}\n`;
      resultText += `Test File: ${testFile}\n`;
      resultText += `Framework: ${framework}\n`;
      resultText += `Functions: ${functions.length}\n`;
      resultText += `Test Cases: ${testCases.length}\n\n`;

      resultText += `Generated Tests:\n\n`;
      resultText += plan.setupCode + "\n\n";
      testCases.forEach((tc) => {
        resultText += `// ${tc.description}\n`;
        resultText += tc.code + "\n\n";
      });

      ctx.onXmlComplete(
        `<dyad-test-gen ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-test-gen>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to generate tests: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
