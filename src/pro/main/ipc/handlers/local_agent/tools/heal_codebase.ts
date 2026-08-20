import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { resolveTargetAppPath } from "./resolve_app_context";

const logger = log.scope("heal_codebase");

const healCodebaseSchema = z.object({
  action: z.enum(["scan", "fix", "report", "clone"]).describe("Action to perform"),
  pattern: z.string().optional().describe("Pattern name to clone (for clone action)"),
  target_file: z.string().optional().describe("Target file to fix (for fix action)"),
  tool_name: z.string().optional().describe("Tool name for cloned pattern"),
  description: z.string().optional().describe("Description for cloned tool"),
});

type HealCodebaseArgs = z.infer<typeof healCodebaseSchema>;

export const healCodebaseTool: ToolDefinition<HealCodebaseArgs> = {
  name: "heal_codebase",
  description:
    "Scan, fix, and improve the Dyad codebase. Detects gaps, auto-fixes common issues, clones patterns from existing tools, and generates improvement reports.",
  inputSchema: healCodebaseSchema,
  defaultConsent: "always",
  modifiesState: (ctx) => true,
  isEnabled: () => true,
  getConsentPreview: (args) => `Heal codebase: ${args.action}`,

  async execute(args, ctx: AgentContext) {
    logger.log("Executing heal_codebase:", args.action);
    const appPath = resolveTargetAppPath(ctx);

    try {
      // Dynamic import to avoid circular dependencies
      const { detectGaps, autoHeal, clonePattern, generateHealingReport } = await import("./healing_engine");

      switch (args.action) {
        case "scan": {
          const gaps = detectGaps(appPath);
          return {
            value: JSON.stringify({
              total_gaps: gaps.length,
              critical: gaps.filter(g => g.severity === "critical").length,
              high: gaps.filter(g => g.severity === "high").length,
              medium: gaps.filter(g => g.severity === "medium").length,
              low: gaps.filter(g => g.severity === "low").length,
              gaps: gaps.slice(0, 20), // Limit output
            }, null, 2),
            truncated: gaps.length > 20,
          };
        }

        case "fix": {
          const actions = autoHeal(appPath);
          return {
            value: JSON.stringify({
              fixed: actions.length,
              actions: actions.map(a => ({
                file: a.file,
                description: a.description,
                applied: a.applied,
              })),
            }, null, 2),
            truncated: false,
          };
        }

        case "report": {
          const report = generateHealingReport(appPath);
          return {
            value: report,
            truncated: report.length > 100_000,
          };
        }

        case "clone": {
          if (!args.pattern) {
            throw new DyadError(
              "Pattern name required for clone action",
              DyadErrorKind.Validation,
            );
          }
          const template = clonePattern(args.pattern, {
            TOOL_NAME: args.tool_name || "new_tool",
            TOOL_NAME_CAP: (args.tool_name || "new_tool").charAt(0).toUpperCase() + (args.tool_name || "new_tool").slice(1),
            DESCRIPTION: args.description || "A new tool",
            PARAMS: "param: z.string().describe(\"A parameter\")",
          });
          if (!template) {
            throw new DyadError(
              `Pattern "${args.pattern}" not found. Available: basic_tool, file_operation_tool, api_call_tool`,
              DyadErrorKind.NotFound,
            );
          }
          return {
            value: template,
            truncated: false,
          };
        }

        default:
          throw new DyadError(`Unknown action: ${args.action}`, DyadErrorKind.Validation);
      }
    } catch (err: any) {
      if (err instanceof DyadError) throw err;
      logger.error("heal_codebase failed:", err);
      throw new DyadError(
        err?.message || "Unknown error",
        DyadErrorKind.Unknown,
      );
    }
  },
};
