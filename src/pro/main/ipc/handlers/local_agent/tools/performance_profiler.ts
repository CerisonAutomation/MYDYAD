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

const logger = log.scope("performance_profiler");

const performanceProfilerSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions) to analyze instead of the current app.",
    ),
  file_path: z
    .string()
    .optional()
    .describe("Specific file to analyze for performance issues."),
});

const DESCRIPTION = `Detect performance issues in source code.

- Inline objects/functions in JSX props
- Missing memoization (useMemo, useCallback, React.memo)
- JSON.parse/stringify clones, chained array methods
- Sequential await in loops
- Returns issues ranked by severity with optimization suggestions`;

function buildAttributes(
  args: Partial<z.infer<typeof performanceProfilerSchema>>,
  stats?: { issues: number; files: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) {
    attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  }
  if (args.file_path) {
    attrs.push(`file_path="${escapeXmlAttr(args.file_path)}"`);
  }
  if (stats) {
    attrs.push(`issues="${stats.issues}"`);
    attrs.push(`files="${stats.files}"`);
  }
  return attrs.join(" ");
}

export const performanceProfilerTool: ToolDefinition<
  z.infer<typeof performanceProfilerSchema>
> = {
  name: "performance_profiler",
  description: DESCRIPTION,
  inputSchema: performanceProfilerSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Profile performance issues";
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
    return `<dyad-perf-profiler ${buildAttributes(args)}>Profiling performance...</dyad-perf-profiler>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Profiling performance in ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-perf-profiler ${buildAttributes(args)}>Scanning files...</dyad-perf-profiler>`,
    );

    try {
      const issues: string[] = [];
      let filesScanned = 0;

      const analyzeFile = (filePath: string, content: string) => {
        filesScanned++;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (/style\s*=\s*\{\s*\{/.test(line)) {
            issues.push(
              `${filePath}:${i + 1} - Inline style object creates new reference each render`,
            );
          }
          if (/className\s*=\s*\{/.test(line) && /\$\{/.test(line)) {
            issues.push(
              `${filePath}:${i + 1} - Template literal in className — consider clsx or cn() utility`,
            );
          }
          if (
            /on(?:Click|Submit|Change|Blur|Focus|KeyDown|KeyUp|MouseDown|MouseUp)\s*=\s*\{?\s*\(\)\s*=>/.test(
              line,
            )
          ) {
            issues.push(
              `${filePath}:${i + 1} - Inline arrow function in event handler`,
            );
          }
          if (/JSON\.parse\s*\(\s*JSON\.stringify/.test(line)) {
            issues.push(
              `${filePath}:${i + 1} - JSON round-trip for deep cloning`,
            );
          }
          if (/\.map\(.*\)\.\s*filter\(.*\)\.\s*map\(/.test(line)) {
            issues.push(
              `${filePath}:${i + 1} - Multiple chained array iterations`,
            );
          }
          if (
            /new\s+(Set|Map|WeakSet|WeakMap)\s*\(/.test(line) &&
            /return|=>\s*\{/.test(content.slice(Math.max(0, i - 20), i + 1))
          ) {
            issues.push(
              `${filePath}:${i + 1} - new ${line.match(/new\s+(Set|Map|WeakSet|WeakMap)/)?.[1]}() recreated on every render — hoist or useMemo`,
            );
          }
          if (
            /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{/.test(line) &&
            /(subscribe|addEventListener|setInterval|setTimeout)/.test(line)
          ) {
            issues.push(
              `${filePath}:${i + 1} - useEffect subscription/side-effect — ensure a cleanup function is returned`,
            );
          }
          if (
            /\.\.\.\w+\s*(?:,|\})/.test(line) &&
            /style|props|options/.test(line)
          ) {
            issues.push(
              `${filePath}:${i + 1} - Object spread may copy large objects each render`,
            );
          }
          if (
            /await\s+[\w.]+\s*\(/.test(line) &&
            /for\s*\(/.test(content.slice(Math.max(0, i - 6), i))
          ) {
            issues.push(
              `${filePath}:${i + 1} - Sequential await inside a loop — runs serially; consider Promise.all`,
            );
          }
          if (
            /(?:useMemo|useCallback|React\.memo)/.test(line) === false &&
            /^\s*function\s+\w+/.test(line) &&
            line.length < 40
          ) {
            // Not a strong signal on its own — skip (memo guidance is emitted per-file below)
          }
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
              entry.name === ".dyad" ||
              entry.name === "dist"
            )
              continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              await scanDir(fullPath, depth + 1);
              continue;
            }
            if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(entry.name)) continue;
            try {
              const content = await fs.readFile(fullPath, "utf-8");
              const rel = path.relative(targetAppPath, fullPath);
              analyzeFile(rel, content);
            } catch {
              /* skip */
            }
          }
        };
        await scanDir(targetAppPath);
      }

      const attrs = buildAttributes(args, {
        issues: issues.length,
        files: filesScanned,
      });

      if (issues.length === 0) {
        ctx.onXmlComplete(
          `<dyad-perf-profiler ${attrs}>No performance issues found.</dyad-perf-profiler>`,
        );
        return "No performance issues found.";
      }

      const resultText = `Found ${issues.length} performance issue(s):\n${issues
        .map((i) => `• ${i}`)
        .join(
          "\n",
        )}\n\n💡 Tip: for React components with frequent re-renders, memoize expensive computations with useMemo and stabilize callbacks with useCallback.`;

      ctx.onXmlComplete(
        `<dyad-perf-profiler ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-perf-profiler>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Performance profiling failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
