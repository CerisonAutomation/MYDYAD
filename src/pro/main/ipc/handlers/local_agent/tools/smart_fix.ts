import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import log from "electron-log";

const logger = log.scope("smart_fix");

const smartFixSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions) to analyze instead of the current app.",
    ),
  file_path: z
    .string()
    .optional()
    .describe("Specific file to suggest fixes for."),
});

const DESCRIPTION = `Suggest fixes for detected code issues.

- accessibility: Add missing alt, lang, aria attributes
- performance: Optimize patterns
- layout: Fix layout issues
- cleanup: Remove dead code
- Returns suggested fixes (does not modify files)`;

function buildAttributes(
  args: Partial<z.infer<typeof smartFixSchema>>,
  stats?: { fixes: number; files: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) {
    attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  }
  if (args.file_path) {
    attrs.push(`file_path="${escapeXmlAttr(args.file_path)}"`);
  }
  if (stats) {
    attrs.push(`fixes="${stats.fixes}"`);
    attrs.push(`files="${stats.files}"`);
  }
  return attrs.join(" ");
}

export const smartFixTool: ToolDefinition<z.infer<typeof smartFixSchema>> = {
  name: "smart_fix",
  description: DESCRIPTION,
  inputSchema: smartFixSchema,
  defaultConsent: "ask",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Suggest fixes";
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
    return `<dyad-smart-fix ${buildAttributes(args)}>Generating fixes...</dyad-smart-fix>`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Smart fix requested for ${args.app_name ?? "current app"}`);
    ctx.onXmlStream(
      `<dyad-smart-fix ${buildAttributes(args)}>Analyzing code...</dyad-smart-fix>`,
    );

    try {
      // This tool requires code analysis to produce real suggestions.
      // Currently returns a message indicating it needs integration with
      // actual code scanning (use accessibility_auditor, performance_profiler,
      // etc. for real analysis).
      const attrs = buildAttributes(args, {
        fixes: 0,
        files: 0,
      });

      const resultText =
        "Smart fix requires integration with code analysis tools. Use accessibility_auditor, performance_profiler, or css_analyzer for specific issue detection.";

      ctx.onXmlComplete(
        `<dyad-smart-fix ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-smart-fix>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Smart fix failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
