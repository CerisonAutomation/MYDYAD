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

const logger = log.scope("visual_test");

const visualTestSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions) to analyze instead of the current app.",
    ),
  file_path: z
    .string()
    .optional()
    .describe("Specific file to analyze for tests."),
});

const DESCRIPTION = `Analyze code for visual testing patterns.

- Detects test files and coverage
- Finds snapshot tests
- Identifies visual regression tests
- Returns test analysis`;

function buildAttributes(
  args: Partial<z.infer<typeof visualTestSchema>>,
  stats?: { tests: number; files: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) {
    attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  }
  if (args.file_path) {
    attrs.push(`file_path="${escapeXmlAttr(args.file_path)}"`);
  }
  if (stats) {
    attrs.push(`tests="${stats.tests}"`);
    attrs.push(`files="${stats.files}"`);
  }
  return attrs.join(" ");
}

export const visualTestTool: ToolDefinition<z.infer<typeof visualTestSchema>> =
  {
    name: "visual_test",
    description: DESCRIPTION,
    inputSchema: visualTestSchema,
    defaultConsent: "always",
    modifiesState: false,

    isEnabled: (_ctx: AgentContext) => true,

    getConsentPreview: (args) => {
      let preview = "Analyze tests";
      if (args.app_name) {
        preview += ` in app: ${args.app_name}`;
      }
      if (args.file_path) {
        preview += ` in ${args.file_path}`;
      }
      return preview;
    },

    buildXml: (args, isComplete) => {
      if (isComplete) return undefined;
      return `<dyad-visual-test ${buildAttributes(args)}>Analyzing tests...</dyad-visual-test>`;
    },

    execute: async (args, ctx: AgentContext) => {
      const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

      logger.log(`Analyzing tests in ${targetAppPath}`);
      ctx.onXmlStream(
        `<dyad-visual-test ${buildAttributes(args)}>Reading tests...</dyad-visual-test>`,
      );

      try {
        const tests: string[] = [];

        const analyzeFile = (filePath: string, content: string) => {
          if (/\.(test|spec)\.(tsx?|jsx?)$/.test(filePath)) {
            const testMatches = content.match(
              /(?:it|test|describe)\s*\(\s*['"`]([^'"]+)['"]/g,
            );
            testMatches?.forEach((match) => {
              const name = match.match(/['"`]([^'"]+)['"]/)?.[1] || "unnamed";
              tests.push(
                `${filePath} [${filePath.includes("spec") ? "spec" : "test"}] ${name}`,
              );
            });
          }
        };

        if (args.file_path) {
          const safeRelative = await resolveDirectoryWithinAppPath({
            appPath: targetAppPath,
            directory: args.file_path,
          });
          const fullPath = path.join(targetAppPath, safeRelative);
          const content = await fs.readFile(fullPath, "utf-8");
          analyzeFile(args.file_path, content);
        } else {
          const scanDir = async (dir: string, depth = 0): Promise<void> => {
            if (depth > 8) return;
            let entries;
            try {
              entries = await fs.readdir(dir, { withFileTypes: true });
            } catch {
              return;
            }
            for (const entry of entries) {
              if (
                entry.name.startsWith(".") ||
                entry.name === "node_modules" ||
                entry.name === "dist"
              )
                continue;
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                await scanDir(fullPath, depth + 1);
                continue;
              }
              try {
                const content = await fs.readFile(fullPath, "utf-8");
                analyzeFile(fullPath, content);
              } catch {
                /* skip */
              }
            }
          };
          await scanDir(targetAppPath);
        }

        const attrs = buildAttributes(args, {
          tests: tests.length,
          files: 1,
        });

        if (tests.length === 0) {
          ctx.onXmlComplete(
            `<dyad-visual-test ${attrs}>No tests found.</dyad-visual-test>`,
          );
          return "No tests found.";
        }

        const resultText = `Found ${tests.length} test(s):\n${tests
          .slice(0, 30)
          .map((t) => `• ${t}`)
          .join("\n")}`;

        ctx.onXmlComplete(
          `<dyad-visual-test ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-visual-test>`,
        );
        return resultText;
      } catch (error) {
        if (error instanceof DyadError) throw error;
        throw new DyadError(
          `Test analysis failed: ${error instanceof Error ? error.message : String(error)}`,
          DyadErrorKind.Unknown,
        );
      }
    },
  };
