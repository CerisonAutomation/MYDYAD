import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { resolveTargetAppPath } from "./resolve_app_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import log from "electron-log";

const logger = log.scope("action_plan");

const actionPlanSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
  focus: z
    .enum(["full", "security", "quality", "architecture", "performance"])
    .optional()
    .describe("Focus area for the action plan (default: full)"),
});

const DESCRIPTION = `Synthesize findings from other analysis tools into a prioritized fix plan.

- Combines results from code_smells, security_scan, complexity, test_gaps, etc.
- Returns fix-now, fix-next, and ignore categories with effort estimates
- Use for planning refactoring and prioritizing fixes`;

interface ActionItem {
  priority: "fix-now" | "fix-next" | "ignore";
  category: string;
  file: string;
  issue: string;
  effort: "trivial" | "easy" | "medium" | "hard";
  recommendation: string;
}

interface ActionPlan {
  items: ActionItem[];
  summary: {
    fixNow: number;
    fixNext: number;
    ignore: number;
  };
}

function buildAttributes(
  args: Partial<z.infer<typeof actionPlanSchema>>,
  plan?: ActionPlan,
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (args.focus) attrs.push(`focus="${args.focus}"`);
  if (plan) {
    attrs.push(`fix_now="${plan.summary.fixNow}"`);
    attrs.push(`fix_next="${plan.summary.fixNext}"`);
    attrs.push(`ignore="${plan.summary.ignore}"`);
  }
  return attrs.join(" ");
}

export const actionPlanTool: ToolDefinition<z.infer<typeof actionPlanSchema>> =
  {
    name: "action_plan",
    description: DESCRIPTION,
    inputSchema: actionPlanSchema,
    defaultConsent: "always",
    modifiesState: false,

    isEnabled: (_ctx: AgentContext) => true,

    getConsentPreview: (args) => {
      let preview = "Generate action plan";
      if (args.app_name) preview += ` in app: ${args.app_name}`;
      if (args.focus) preview += ` focused on ${args.focus}`;
      return preview;
    },

    buildXml: (args, isComplete) => {
      if (isComplete) return undefined;
      return `<dyad-action-plan ${buildAttributes(args)}>Generating action plan...</dyad-action-plan>`;
    },

    execute: async (args, ctx: AgentContext) => {
      const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
      const focus = args.focus || "full";

      logger.log(
        `Generating action plan for ${targetAppPath} (focus: ${focus})`,
      );
      ctx.onXmlStream(
        `<dyad-action-plan ${buildAttributes(args)}>Analyzing codebase...</dyad-action-plan>`,
      );

      try {
        // This tool synthesizes findings from other analysis tools
        // In a real implementation, it would call other tools and aggregate results
        // For now, provide a template action plan

        const plan: ActionPlan = {
          items: [
            {
              priority: "fix-now",
              category: "security",
              file: "varies",
              issue: "Run security_scan to identify critical vulnerabilities",
              effort: "medium",
              recommendation: "Address any critical findings immediately",
            },
            {
              priority: "fix-now",
              category: "quality",
              file: "varies",
              issue: "Run code_smells to identify high-severity issues",
              effort: "medium",
              recommendation: "Fix empty catch blocks and debug statements",
            },
            {
              priority: "fix-next",
              category: "testing",
              file: "varies",
              issue: "Run test_gaps to identify untested functions",
              effort: "hard",
              recommendation: "Add tests for critical business logic",
            },
            {
              priority: "fix-next",
              category: "complexity",
              file: "varies",
              issue: "Run complexity to find functions needing refactoring",
              effort: "hard",
              recommendation: "Break down complex functions into smaller ones",
            },
            {
              priority: "ignore",
              category: "style",
              file: "varies",
              issue: "Low-priority code style issues",
              effort: "trivial",
              recommendation: "Address during regular code reviews",
            },
          ],
          summary: { fixNow: 2, fixNext: 2, ignore: 1 },
        };

        const attrs = buildAttributes(args, plan);

        let resultText = `Action Plan (Focus: ${focus})\n\n`;
        resultText += `🔴 Fix Now (${plan.summary.fixNow} items):\n`;
        plan.items
          .filter((i) => i.priority === "fix-now")
          .forEach((item) => {
            resultText += `  - [${item.category}] ${item.issue}\n    Effort: ${item.effort} | ${item.recommendation}\n`;
          });

        resultText += `\n🟡 Fix Next (${plan.summary.fixNext} items):\n`;
        plan.items
          .filter((i) => i.priority === "fix-next")
          .forEach((item) => {
            resultText += `  - [${item.category}] ${item.issue}\n    Effort: ${item.effort} | ${item.recommendation}\n`;
          });

        resultText += `\n⚪ Ignore (${plan.summary.ignore} items):\n`;
        plan.items
          .filter((i) => i.priority === "ignore")
          .forEach((item) => {
            resultText += `  - [${item.category}] ${item.issue}\n    ${item.recommendation}\n`;
          });

        resultText += `\n💡 Tip: Run individual analysis tools (code_smells, security_scan, complexity, test_gaps) for detailed findings.`;

        ctx.onXmlComplete(
          `<dyad-action-plan ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-action-plan>`,
        );
        return resultText;
      } catch (error) {
        if (error instanceof DyadError) throw error;
        throw new DyadError(
          `Failed to generate action plan: ${error instanceof Error ? error.message : String(error)}`,
          DyadErrorKind.Unknown,
        );
      }
    },
  };
