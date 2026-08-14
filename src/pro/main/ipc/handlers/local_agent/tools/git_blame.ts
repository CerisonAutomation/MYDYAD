/**
 * Git Blame Tool
 *
 * Shows who last modified each line of a file.
 * Useful for understanding code ownership and history.
 */

import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import type { AgentContext, ToolDefinition } from "./types";
import { escapeXmlAttr, escapeXmlContent } from "./types";
import { resolveTargetAppPath } from "./resolve_app_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const execFileAsync = promisify(execFile);

const gitBlameSchema = z.object({
  file_path: z.string().describe("File to blame"),
  app_name: z.string().optional().describe("App to analyze"),
  line_start: z.number().optional().describe("Start line number"),
  line_end: z.number().optional().describe("End line number"),
  max_lines: z.number().optional().describe("Maximum lines to return"),
});

type GitBlameArgs = z.infer<typeof gitBlameSchema>;

interface BlameLine {
  line_number: number;
  author: string;
  date: string;
  commit: string;
  content: string;
}

export const gitBlameTool: ToolDefinition<GitBlameArgs> = {
  name: "git_blame",
  description: `Show who last modified each line of a file (git blame).

Use for: Understanding code ownership, finding who introduced changes, accountability.

Returns: Author, date, commit hash for each line.`,
  inputSchema: gitBlameSchema,
  defaultConsent: "always",
  modifiesState: false,
  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => `Blame ${args.file_path}`,

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-git-blame file="${escapeXmlAttr(args.file_path ?? "")}">Blaming...</dyad-git-blame>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const appPath = resolveTargetAppPath(ctx, args.app_name);

    try {
      const blameArgs = ["blame", "--porcelain", args.file_path];
      if (args.line_start && args.line_end) {
        blameArgs.push(`-L${args.line_start},${args.line_end}`);
      }

      const { stdout } = await execFileAsync("git", blameArgs, {
        cwd: appPath,
        maxBuffer: 10 * 1024 * 1024,
      });

      const lines = stdout.split("\n");
      const blameLines: BlameLine[] = [];
      let currentLine: Partial<BlameLine> = {};

      for (const line of lines) {
        if (/^[0-9a-f]{40}\s/.test(line)) {
          if (currentLine.commit) {
            blameLines.push(currentLine as BlameLine);
          }
          const parts = line.split(" ");
          currentLine = {
            commit: parts[0].slice(0, 8),
            line_number: parseInt(parts[2], 10),
          };
        } else if (line.startsWith("author ")) {
          currentLine.author = line.slice(7);
        } else if (line.startsWith("author-time ")) {
          currentLine.date = new Date(
            parseInt(line.slice(12), 10) * 1000,
          ).toISOString();
        } else if (line.startsWith("\t")) {
          currentLine.content = line.slice(1);
        }
      }

      if (currentLine.commit) {
        blameLines.push(currentLine as BlameLine);
      }

      const maxLines = args.max_lines || 100;
      const result = blameLines.slice(0, maxLines);

      ctx.onXmlComplete(
        `<dyad-git-blame file="${escapeXmlAttr(args.file_path)}" lines="${result.length}">${escapeXmlContent(JSON.stringify(result, null, 2))}</dyad-git-blame>`,
      );

      return JSON.stringify(result, null, 2);
    } catch (error) {
      throw new DyadError(
        `Failed to run git blame: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.External,
      );
    }
  },
};
