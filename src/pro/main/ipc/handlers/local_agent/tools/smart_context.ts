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

/**
 * Scan an app directory for code files so smart_context works even when the
 * caller did not pre-populate ctx.codebaseFiles. Mirrors the project's
 * exclusion rules (node_modules, build output, dotfiles).
 */
async function scanCodebaseFiles(appPath: string): Promise<CodebaseFile[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const EXCLUDED = new Set([
    "node_modules",
    ".git",
    ".next",
    ".dyad",
    "dist",
    "build",
    "out",
    ".turbo",
    "coverage",
    ".expo",
  ]);
  const MAX_FILE_BYTES = 200_000;
  const files: CodebaseFile[] = [];

  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env") continue;
      if (EXCLUDED.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (
        !/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|css|scss|html|json|md)$/.test(
          entry.name,
        )
      )
        continue;
      try {
        const stat = await fs.stat(fullPath);
        if (stat.size > MAX_FILE_BYTES) continue;
        const content = await fs.readFile(fullPath, "utf-8");
        if (content.includes("\u0000")) continue; // skip binary
        files.push({ path: path.relative(appPath, fullPath), content });
      } catch {
        /* skip unreadable */
      }
    }
  };

  await walk(appPath);
  return files;
}

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
      // Get codebase files from context (fall back to a live scan when the
      // caller did not pre-populate ctx.codebaseFiles).
      let files: CodebaseFile[] = (ctx as any).codebaseFiles || [];
      if (files.length === 0) {
        files = await scanCodebaseFiles(ctx.appPath);
      }

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
