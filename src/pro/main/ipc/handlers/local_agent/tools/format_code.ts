import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlContent } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import log from "electron-log";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

const execFileAsync = promisify(execFile);
const logger = log.scope("format_code");

const formatCodeSchema = z.object({
  format: z.boolean().optional().describe("Run code formatter (default: true)"),
  lint_fix: z
    .boolean()
    .optional()
    .describe("Run linter with auto-fix (default: true)"),
  file: z
    .string()
    .optional()
    .describe("Specific file to format/lint (relative to app root)"),
});

type FormatterType = "oxfmt" | "prettier" | "biome" | "none";
type LinterType = "oxlint" | "eslint" | "biome" | "none";

async function detectFormatter(appPath: string): Promise<FormatterType> {
  const checks: Array<{ file: string; type: FormatterType }> = [
    { file: ".oxfmtrc", type: "oxfmt" },
    { file: "oxfmt.config.js", type: "oxfmt" },
    { file: "oxfmt.config.mjs", type: "oxfmt" },
    { file: ".prettierrc", type: "prettier" },
    { file: ".prettierrc.js", type: "prettier" },
    { file: ".prettierrc.json", type: "prettier" },
    { file: ".prettierrc.yaml", type: "prettier" },
    { file: ".prettierrc.yml", type: "prettier" },
    { file: "prettier.config.js", type: "prettier" },
    { file: "prettier.config.mjs", type: "prettier" },
    { file: "prettier.config.cjs", type: "prettier" },
    { file: "biome.json", type: "biome" },
    { file: "biome.jsonc", type: "biome" },
  ];

  for (const check of checks) {
    try {
      await fs.access(path.join(appPath, check.file));
      logger.log(`Detected formatter: ${check.type} (${check.file})`);
      return check.type;
    } catch {
      // Not found, continue
    }
  }

  // Check package.json for prettier config key
  try {
    const pkgRaw = await fs.readFile(
      path.join(appPath, "package.json"),
      "utf-8",
    );
    const pkg = JSON.parse(pkgRaw);
    if (pkg.prettier) {
      logger.log("Detected formatter: prettier (package.json key)");
      return "prettier";
    }
  } catch {
    // ignore
  }

  // Check node_modules/.bin for installed formatter binaries
  const binChecks: Array<{ bin: string; type: FormatterType }> = [
    { bin: "oxfmt", type: "oxfmt" },
    { bin: "prettier", type: "prettier" },
    { bin: "biome", type: "biome" },
  ];
  for (const check of binChecks) {
    try {
      await fs.access(path.join(appPath, "node_modules", ".bin", check.bin));
      logger.log(`Detected formatter binary: ${check.type}`);
      return check.type;
    } catch {
      // not installed
    }
  }

  // No formatter config found
  return "none";
}

async function detectLinter(appPath: string): Promise<LinterType> {
  const checks: Array<{ file: string; type: LinterType }> = [
    { file: ".oxlintrc", type: "oxlint" },
    { file: "oxlint.config.js", type: "oxlint" },
    { file: "oxlint.config.mjs", type: "oxlint" },
    { file: ".eslintrc", type: "eslint" },
    { file: ".eslintrc.js", type: "eslint" },
    { file: ".eslintrc.json", type: "eslint" },
    { file: ".eslintrc.yaml", type: "eslint" },
    { file: ".eslintrc.yml", type: "eslint" },
    { file: "eslint.config.js", type: "eslint" },
    { file: "eslint.config.mjs", type: "eslint" },
    { file: "eslint.config.cjs", type: "eslint" },
    { file: "eslint.config.ts", type: "eslint" },
    { file: "biome.json", type: "biome" },
    { file: "biome.jsonc", type: "biome" },
  ];

  for (const check of checks) {
    try {
      await fs.access(path.join(appPath, check.file));
      logger.log(`Detected linter: ${check.type} (${check.file})`);
      return check.type;
    } catch {
      // Not found, continue
    }
  }

  // Check node_modules/.bin for installed linter binaries
  const binChecks: Array<{ bin: string; type: LinterType }> = [
    { bin: "oxlint", type: "oxlint" },
    { bin: "eslint", type: "eslint" },
    { bin: "biome", type: "biome" },
  ];
  for (const check of binChecks) {
    try {
      await fs.access(path.join(appPath, "node_modules", ".bin", check.bin));
      logger.log(`Detected linter binary: ${check.type}`);
      return check.type;
    } catch {
      // not installed
    }
  }

  // No linter config found
  return "none";
}

const DESCRIPTION = `Run code formatter and linter with auto-detection.

- Auto-detects project formatter (oxfmt, prettier, biome) and linter (oxlint, eslint, biome)
- Use --file to format/lint a specific file instead of the whole project
- Use --format to run formatter, --lint_fix to run linter with fixes
- Returns summary of files changed`;

export const formatCodeTool: ToolDefinition<z.infer<typeof formatCodeSchema>> =
  {
    name: "format_code",
    description: DESCRIPTION,
    inputSchema: formatCodeSchema,
    defaultConsent: "always",
    modifiesState: true,

    isEnabled: (_ctx: AgentContext) => true,

    getConsentPreview: (args) =>
      args.file ? `Format/lint ${args.file}` : "Format and lint code",

    buildXml: (args, isComplete) => {
      if (isComplete) return undefined;
      const target = args.file ? ` ${args.file}` : "";
      return `<dyad-format-code>Running formatter and linter${target}...</dyad-format-code>`;
    },

    execute: async (args, ctx: AgentContext) => {
      const appPath = ctx.appPath;
      const results: string[] = [];

      try {
        const formatter = await detectFormatter(appPath);
        const linter = await detectLinter(appPath);

        // Run formatter
        if (args.format !== false && formatter !== "none") {
          try {
            let formatArgs: string[];
            if (formatter === "oxfmt") {
              formatArgs = args.file ? [args.file] : [];
            } else if (formatter === "prettier") {
              formatArgs = args.file
                ? ["--write", args.file]
                : ["--write", "."];
            } else if (formatter === "biome") {
              formatArgs = args.file ? ["format", args.file] : ["format", "."];
            } else {
              results.push("Format: No formatter detected");
              formatArgs = [];
            }

            if (formatArgs.length > 0) {
              const { stdout, stderr } = await execFileAsync(
                formatter === "biome" ? "biome" : "npx",
                formatter === "biome" ? formatArgs : [formatter, ...formatArgs],
                {
                  cwd: appPath,
                  timeout: 60000,
                },
              );
              const output = stdout || stderr || "Formatter completed";
              results.push(
                `Format (${formatter}): ${output.trim().split("\n").pop() || "done"}`,
              );
              logger.log(`Formatter ${formatter} completed`);
            }
          } catch (err) {
            results.push(
              `Format: ${err instanceof Error ? err.message : "failed"}`,
            );
          }
        } else if (args.format !== false) {
          results.push("Format: No formatter detected, skipping");
        }

        // Run linter with fix
        if (args.lint_fix !== false && linter !== "none") {
          try {
            let lintArgs: string[];
            if (linter === "oxlint") {
              lintArgs = args.file ? ["--fix", args.file] : ["--fix"];
            } else if (linter === "eslint") {
              lintArgs = args.file ? ["--fix", args.file] : ["--fix", "."];
            } else if (linter === "biome") {
              lintArgs = args.file
                ? ["lint", "--write", args.file]
                : ["lint", "--write", "."];
            } else {
              lintArgs = [];
            }

            if (lintArgs.length > 0) {
              const { stdout, stderr } = await execFileAsync(
                linter === "biome" ? "biome" : "npx",
                linter === "biome" ? lintArgs : [linter, ...lintArgs],
                {
                  cwd: appPath,
                  timeout: 60000,
                },
              );
              const output = stdout || stderr || "Linter completed";
              results.push(
                `Lint (${linter}): ${output.trim().split("\n").pop() || "done"}`,
              );
              logger.log(`Linter ${linter} completed`);
            }
          } catch (err) {
            results.push(
              `Lint: ${err instanceof Error ? err.message : "failed"}`,
            );
          }
        } else if (args.lint_fix !== false) {
          results.push("Lint: No linter detected, skipping");
        }

        const result = results.join("\n");

        ctx.onXmlComplete(
          `<dyad-format-code>\n${escapeXmlContent(result)}\n</dyad-format-code>`,
        );

        return result;
      } catch (error) {
        if (error instanceof DyadError) throw error;
        throw new DyadError(
          `Failed to format code: ${error instanceof Error ? error.message : String(error)}`,
          DyadErrorKind.External,
        );
      }
    },
  };
