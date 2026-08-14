import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
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
import { walkDirectory } from "./file_utils";

const logger = log.scope("dead_code");

const READ_TIMEOUT_MS = 5_000;

const deadCodeSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
  file: z
    .string()
    .optional()
    .describe(
      "Specific file to analyze (relative path). If omitted, scans entire repo.",
    ),
});

const DESCRIPTION = `Detect unused exports, unreachable code, and unused variables with confidence scores.

- Returns list of files with issues and scores
- Detects: unused exports, unused variables, unreachable code, unused imports
- Use for code cleanup and bundle size optimization`;

interface DeadCodeItem {
  type: "unused_export" | "unused_variable" | "unused_import";
  name: string;
  line: number;
  confidence: number;
}

interface DeadCodeReport {
  file: string;
  items: DeadCodeItem[];
  score: number;
}

function analyzeFile(filePath: string, content: string): DeadCodeReport {
  const items: DeadCodeItem[] = [];
  const lines = content.split("\n");

  const exports = new Map<string, number>();
  const imports = new Map<string, number>();
  const variables = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const exportMatch = line.match(
      /export\s+(?:const|let|var|function|class|interface|type)\s+(\w+)/,
    );
    if (exportMatch) exports.set(exportMatch[1], i + 1);

    const importMatch = line.match(/import\s+.*?{([^}]+)}/);
    if (importMatch) {
      const imported = importMatch[1]
        .split(",")
        .map((s) => s.trim().split(/\s+as\s+/)[0]);
      for (const name of imported) {
        if (name) imports.set(name, i + 1);
      }
    }

    const varMatch = line.match(/(?:const|let|var)\s+(\w+)/);
    if (varMatch && !line.includes("export")) variables.set(varMatch[1], i + 1);
  }

  for (const [name, line] of exports) {
    const usageCount = lines.filter(
      (l, i) => i !== line - 1 && l.includes(name),
    ).length;
    if (usageCount === 0) {
      items.push({ type: "unused_export", name, line, confidence: 0.75 });
    }
  }

  for (const [name, line] of variables) {
    const usageCount = lines.filter(
      (l, i) => i !== line - 1 && l.includes(name),
    ).length;
    if (usageCount === 0) {
      items.push({ type: "unused_variable", name, line, confidence: 0.85 });
    }
  }

  for (const [name, line] of imports) {
    const usageCount = lines.filter(
      (l, i) => i !== line - 1 && l.includes(name),
    ).length;
    if (usageCount === 0) {
      items.push({ type: "unused_import", name, line, confidence: 0.92 });
    }
  }

  let score = 100;
  for (const item of items) score -= item.confidence * 10;

  return { file: filePath, items, score: Math.max(0, Math.round(score)) };
}

function buildAttributes(
  args: Partial<z.infer<typeof deadCodeSchema>>,
  stats?: { files: number; items: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (args.file) attrs.push(`file="${escapeXmlAttr(args.file)}"`);
  if (stats) {
    attrs.push(`files="${stats.files}"`);
    attrs.push(`items="${stats.items}"`);
  }
  return attrs.join(" ");
}

export const deadCodeTool: ToolDefinition<z.infer<typeof deadCodeSchema>> = {
  name: "dead_code",
  description: DESCRIPTION,
  inputSchema: deadCodeSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Analyze dead code";
    if (args.app_name) preview += ` in app: ${args.app_name}`;
    if (args.file) preview += ` in ${args.file}`;
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-dead-code ${buildAttributes(args)}>Scanning for dead code...</dyad-dead-code>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Analyzing dead code in ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-dead-code ${buildAttributes(args)}>Scanning files...</dyad-dead-code>`,
    );

    try {
      let reports: DeadCodeReport[] = [];

      if (args.file) {
        const safeRelative = await resolveDirectoryWithinAppPath({
          appPath: targetAppPath,
          directory: args.file,
        });
        const filePath = path.join(targetAppPath, safeRelative);
        const content = await Promise.race([
          fs.readFile(filePath, "utf-8"),
          sleep(READ_TIMEOUT_MS).then(() => {
            throw new Error("Read timeout");
          }),
        ]);
        reports = [analyzeFile(args.file, content)];
      } else {
        const files = await walkDirectory(targetAppPath, {
          filePattern: /\.(ts|tsx|js|jsx)$/,
          maxDepth: 10,
        });
        for (const file of files) {
          try {
            // Skip files larger than 1MB to prevent memory issues
            try {
              const stat = await fs.stat(file);
              if (stat.size > 1024 * 1024) continue;
            } catch {
              continue;
            }
            const content = await Promise.race([
              fs.readFile(file, "utf-8"),
              sleep(READ_TIMEOUT_MS).then(() => {
                throw new Error("Read timeout");
              }),
            ]);
            const relativePath = path.relative(targetAppPath, file);
            const report = analyzeFile(relativePath, content);
            if (report.items.length > 0) reports.push(report);
          } catch {
            // Skip unreadable files
          }
        }
      }

      reports.sort((a, b) => a.score - b.score);
      const totalItems = reports.reduce((sum, r) => sum + r.items.length, 0);
      const attrs = buildAttributes(args, {
        files: reports.length,
        items: totalItems,
      });

      if (reports.length === 0) {
        ctx.onXmlComplete(
          `<dyad-dead-code ${attrs}>No dead code detected.</dyad-dead-code>`,
        );
        return "No dead code detected.";
      }

      const lines = reports.slice(0, 15).map(
        (r, i) =>
          `${i + 1}. ${r.file} (score: ${r.score})\n   ${r.items
            .slice(0, 3)
            .map((item) => `- ${item.type}: ${item.name} (line ${item.line})`)
            .join("\n   ")}`,
      );

      const resultText = `Files with Issues: ${reports.length}\nTotal Items: ${totalItems}\n\nTop Files:\n${lines.join("\n\n")}`;

      ctx.onXmlComplete(
        `<dyad-dead-code ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-dead-code>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to analyze dead code: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
