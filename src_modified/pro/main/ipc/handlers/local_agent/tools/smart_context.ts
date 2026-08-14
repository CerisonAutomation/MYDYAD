import { z } from "zod";
import log from "electron-log";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import {
  selectSmartContext,
  formatSmartContext,
} from "@/ipc/utils/local_smart_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { CodebaseFile } from "@/utils/codebase";

const logger = log.scope("smart_context");

const smartContextSchema = z.object({
  goal: z
    .string()
    .min(1)
    .describe("The user's goal or prompt to select relevant files for"),
  max_tokens: z
    .number()
    .int()
    .min(500)
    .max(32000)
    .optional()
    .describe("Maximum tokens for context (default: 8000)"),
  mode: z
    .enum(["balanced", "conservative", "deep"])
    .optional()
    .describe("Smart context mode"),
});

const DESCRIPTION = `Select the most relevant files for a specific goal using intelligent file ranking.

- Analyzes goal against all codebase files
- Scores files by relevance (path, content, exports, imports)
- Selects top files within token budget
- Returns ranked files with reasons

Modes: balanced (~20 files), conservative (~10 files), deep (~30 files)`;

export const smartContextTool: ToolDefinition<
  z.infer<typeof smartContextSchema>
> = {
  name: "smart_context",
  description: DESCRIPTION,
  inputSchema: smartContextSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => `Select relevant files for: "${args.goal}"`,

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    if (!args.goal) return undefined;
    return `<dyad-smart-context goal="${escapeXmlAttr(args.goal)}">Analyzing...</dyad-smart-context>`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Executing smart context for goal: ${args.goal}`);

    ctx.onXmlStream(
      `<dyad-smart-context goal="${escapeXmlAttr(args.goal)}">Selecting files...</dyad-smart-context>`,
    );

    try {
      // Get codebase files from context
      const files: CodebaseFile[] = (ctx as any).codebaseFiles || [];

      const result = selectSmartContext({
        goal: args.goal,
        files,
        tokenBudget: args.max_tokens || 8000,
        mode: args.mode || "balanced",
      });

      const formatted = formatSmartContext(result);

      ctx.onXmlComplete(
        `<dyad-smart-context goal="${escapeXmlAttr(args.goal)}" files="${result.selectedFiles.length}" tokens="${result.tokensUsed}">\n${escapeXmlContent(formatted)}\n</dyad-smart-context>`,
      );

      return formatted;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to select smart context: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
