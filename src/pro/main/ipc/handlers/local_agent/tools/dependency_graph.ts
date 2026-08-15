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

const logger = log.scope("dependency_graph");

const dependencyGraphSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions) to analyze instead of the current app.",
    ),
  file_path: z
    .string()
    .optional()
    .describe("Specific file to analyze for dependencies."),
});

const DESCRIPTION = `Analyze import dependencies and detect issues.

- Map import relationships between files
- Detect circular dependencies
- Find unused imports
- Returns dependency statistics`;

function buildAttributes(
  args: Partial<z.infer<typeof dependencyGraphSchema>>,
  stats?: { imports: number; files: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) {
    attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  }
  if (args.file_path) {
    attrs.push(`file_path="${escapeXmlAttr(args.file_path)}"`);
  }
  if (stats) {
    attrs.push(`imports="${stats.imports}"`);
    attrs.push(`files="${stats.files}"`);
  }
  return attrs.join(" ");
}

export const dependencyGraphTool: ToolDefinition<
  z.infer<typeof dependencyGraphSchema>
> = {
  name: "dependency_graph",
  description: DESCRIPTION,
  inputSchema: dependencyGraphSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Analyze dependencies";
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
    return `<dyad-dep-graph ${buildAttributes(args)}>Analyzing dependencies...</dyad-dep-graph>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Analyzing dependencies in ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-dep-graph ${buildAttributes(args)}>Reading imports...</dyad-dep-graph>`,
    );

    try {
      // Track per-file local imports so we can detect circular dependencies.
      const fileImports = new Map<
        string,
        Array<{ line: number; spec: string; isTypeOnly: boolean }>
      >();
      let filesScanned = 0;

      const analyzeFile = (filePath: string, content: string) => {
        filesScanned++;
        const lines = content.split("\n");
        const local: Array<{
          line: number;
          spec: string;
          isTypeOnly: boolean;
        }> = [];
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const trimmed = line.trimStart();
          // Skip comment/doc lines — they are not real import edges.
          if (
            trimmed.startsWith("//") ||
            trimmed.startsWith("/*") ||
            trimmed.startsWith("*") ||
            trimmed.startsWith("<!--")
          )
            continue;
          // import x from "..." / import "..." / export { x } from "..." / dynamic import("...")
          const matches = line.matchAll(
            /(?:import|export)\s+[^'"]*?from\s+['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/g,
          );
          for (const m of matches) {
            const spec = m[1] ?? m[2] ?? m[3];
            if (!spec) continue;
            if (
              spec.startsWith("./") ||
              spec.startsWith("../") ||
              spec.startsWith("@/") ||
              spec.startsWith("~/")
            ) {
              const importClause = line.split("from")[0] ?? "";
              const isTypeOnly =
                /^\s*(?:import|export)\s+type\b/.test(line) ||
                /\bimport\s*\(\s*type\s/.test(line) ||
                // mixed imports: `import { type Foo, bar }` — only bar is runtime
                /\btype\s+[A-Za-z_$][\w$]*\b/.test(importClause) ||
                /\btype\s*\{[^}]*\}/.test(importClause);
              local.push({ line: i + 1, spec, isTypeOnly });
            }
          }
        }
        fileImports.set(filePath, local);
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
            if (!/\.(tsx?|jsx?)$/.test(entry.name)) continue;
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

      // Resolve local specifiers to concrete relative paths (handles @/ → src/).
      const specToTarget = (spec: string, fromFile: string): string | null => {
        if (spec.startsWith("@/") || spec.startsWith("~/")) {
          const rel = spec.slice(2).replace(/\.(ts|tsx|js|jsx)$/, "");
          return `src/${rel}`;
        }
        const base = path.posix.dirname(fromFile.replace(/\\/g, "/"));
        const joined = path.posix.normalize(path.posix.join(base, spec));
        const noExt = joined.replace(/\.(ts|tsx|js|jsx)$/, "");
        for (const candidate of [
          `${noExt}.ts`,
          `${noExt}.tsx`,
          `${noExt}.js`,
          `${noExt}.jsx`,
          noExt,
        ]) {
          if (fileImports.has(candidate)) return candidate;
        }
        return noExt;
      };

      // Build adjacency and detect circular dependency chains (DFS).
      // Only runtime edges can form a real cycle: `import type` edges are
      // erased at compile time, so a loop of type-only imports is benign.
      const adjacency = new Map<string, string[]>();
      const typeOnlyEdges: string[] = [];
      for (const [file, localImports] of fileImports) {
        for (const l of localImports) {
          const target = specToTarget(l.spec, file);
          if (target === null) continue;
          if (l.isTypeOnly) {
            typeOnlyEdges.push(`${file}:${l.line} → ${target} (type-only)`);
            continue;
          }
          adjacency.set(file, [...(adjacency.get(file) ?? []), target]);
        }
      }
      const cycles: string[][] = [];
      const visiting = new Set<string>();
      const visited = new Set<string>();
      const stack: string[] = [];
      const findCycles = (node: string) => {
        if (visiting.has(node)) {
          const start = stack.indexOf(node);
          if (start >= 0) {
            const cycle = [...stack.slice(start), node];
            if (
              !cycles.some(
                (c) => c.length === cycle.length && c[0] === cycle[0],
              )
            ) {
              cycles.push(cycle);
            }
          }
          return;
        }
        if (visited.has(node)) return;
        visiting.add(node);
        stack.push(node);
        for (const next of adjacency.get(node) ?? []) {
          findCycles(next);
        }
        stack.pop();
        visiting.delete(node);
        visited.add(node);
      };
      for (const file of adjacency.keys()) findCycles(file);

      // Stats + flat listing.
      const allImports: string[] = [];
      for (const [file, localImports] of fileImports) {
        for (const l of localImports) {
          allImports.push(`${file}:${l.line} → ${l.spec}`);
        }
      }
      const uniqueTargets = new Set<string>();
      for (const targets of adjacency.values()) {
        targets.forEach((t) => uniqueTargets.add(t));
      }

      const attrs = buildAttributes(args, {
        imports: allImports.length,
        files: filesScanned,
      });

      if (allImports.length === 0) {
        ctx.onXmlComplete(
          `<dyad-dep-graph ${attrs}>No local imports found.</dyad-dep-graph>`,
        );
        return "No local imports found.";
      }

      let resultText = `Found ${allImports.length} local import(s) across ${filesScanned} file(s) (${uniqueTargets.size} unique targets):\n`;
      resultText += allImports
        .slice(0, 40)
        .map((i) => `• ${i}`)
        .join("\n");
      if (allImports.length > 40) {
        resultText += `\n... and ${allImports.length - 40} more`;
      }
      resultText += `\n\n📊 Top dependencies:\n`;
      const topTargets = [...uniqueTargets]
        .map((t) => ({
          target: t,
          count: [...adjacency.values()].filter((a) => a.includes(t)).length,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      resultText +=
        topTargets
          .map((t) => `• ${t.target} (${t.count} importer(s))`)
          .join("\n") || "(none)";
      resultText += `\n\n🔁 Runtime circular dependencies: ${cycles.length}`;
      if (cycles.length > 0) {
        resultText += `\n${cycles
          .slice(0, 5)
          .map((c) => `• ${c.join(" → ")}`)
          .join("\n")}`;
        if (cycles.length > 5)
          resultText += `\n... and ${cycles.length - 5} more cycle(s)`;
      } else {
        resultText += " (none detected)";
      }
      if (typeOnlyEdges.length > 0) {
        resultText += `\nℹ️ ${typeOnlyEdges.length} type-only edge(s) (erased at compile time — benign):\n`;
        resultText += typeOnlyEdges
          .slice(0, 5)
          .map((e) => `• ${e}`)
          .join("\n");
        if (typeOnlyEdges.length > 5) {
          resultText += `\n... and ${typeOnlyEdges.length - 5} more`;
        }
      }

      ctx.onXmlComplete(
        `<dyad-dep-graph ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-dep-graph>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Dependency analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
