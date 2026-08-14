import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlContent } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import log from "electron-log";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const logger = log.scope("format_code");

const formatCodeSchema = z.object({
  format: z.boolean().optional().describe("Run code formatter (default: true)"),
  lint_fix: z
    .boolean()
    .optional()
    .describe("Run linter with auto-fix (default: true)"),
});

const DESCRIPTION = `Run code formatter and linter with auto-fix.

- Runs the project's configured formatter (oxfmt/prettier) and linter (oxlint/eslint)
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

    getConsentPreview: () => "Format and lint code",

    buildXml: (_args, isComplete) => {
      if (isComplete) return undefined;
      return `<dyad-format-code>Running formatter and linter...</dyad-format-code>`;
    },

    execute: async (args, ctx: AgentContext) => {
      const appPath = ctx.appPath;
      const results: string[] = [];

      try {
        // Run formatter
        if (args.format !== false) {
          try {
            const { stdout, stderr } = await execFileAsync("npx", ["oxfmt"], {
              cwd: appPath,
              timeout: 60000,
            });
            const output = stdout || stderr || "Formatter completed";
            results.push(
              `Format: ${output.trim().split("\n").pop() || "done"}`,
            );
            logger.log("Formatter completed");
          } catch (err) {
            results.push(
              `Format: ${err instanceof Error ? err.message : "failed"}`,
            );
          }
        }

        // Run linter with fix
        if (args.lint_fix !== false) {
          try {
            const { stdout, stderr } = await execFileAsync(
              "npx",
              ["oxlint", "--fix"],
              { cwd: appPath, timeout: 60000 },
            );
            const output = stdout || stderr || "Linter completed";
            results.push(`Lint: ${output.trim().split("\n").pop() || "done"}`);
            logger.log("Linter completed");
          } catch (err) {
            results.push(
              `Lint: ${err instanceof Error ? err.message : "failed"}`,
            );
          }
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
