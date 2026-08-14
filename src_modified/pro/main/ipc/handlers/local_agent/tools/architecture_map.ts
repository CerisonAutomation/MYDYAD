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
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import log from "electron-log";

const logger = log.scope("architecture_map");

const architectureMapSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
  max_depth: z
    .number()
    .min(1)
    .max(10)
    .optional()
    .describe("Maximum import depth to analyze (default: 5)"),
});

const DESCRIPTION = `Generate module-level architecture map with import relationships.

- Returns Mermaid diagram of module dependencies
- Identifies circular dependencies and core modules
- Use for architecture review and onboarding`;

interface Module {
  path: string;
  imports: string[];
  exports: string[];
  isCore: boolean;
}

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  ".next",
  "coverage",
]);

const CORE_DIRS = new Set([
  "src",
  "lib",
  "app",
  "pages",
  "components",
  "hooks",
  "utils",
  "services",
  "api",
]);

function extractImports(content: string): string[] {
  const imports: string[] = [];
  const importRegex = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    if (importPath.startsWith(".")) {
      imports.push(importPath);
    }
  }
  return imports;
}

function extractExports(content: string): string[] {
  const exports: string[] = [];
  const exportRegex =
    /export\s+(?:const|let|var|function|class|interface|type)\s+(\w+)/g;
  let match;
  while ((match = exportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }
  return exports;
}

async function analyzeModule(
  filePath: string,
  content: string,
): Promise<Module> {
  const imports = extractImports(content);
  const exports = extractExports(content);
  const isCore = CORE_DIRS.has(path.basename(path.dirname(filePath)));

  return { path: filePath, imports, exports, isCore };
}

function detectCircularDeps(modules: Module[]): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(modulePath: string, path: string[]): boolean {
    visited.add(modulePath);
    recursionStack.add(modulePath);

    const module = modules.find((m) => m.path === modulePath);
    if (module) {
      for (const imp of module.imports) {
        if (!visited.has(imp)) {
          if (dfs(imp, [...path, imp])) return true;
        } else if (recursionStack.has(imp)) {
          cycles.push([...path, imp]);
          return true;
        }
      }
    }

    recursionStack.delete(modulePath);
    return false;
  }

  for (const module of modules) {
    if (!visited.has(module.path)) {
      dfs(module.path, [module.path]);
    }
  }

  return cycles;
}

function generateMermaid(modules: Module[], cycles: string[][]): string {
  const lines = ["graph TD"];

  for (const module of modules) {
    const shortPath = module.path.replace(/\//g, "_").replace(/\./g, "_");
    const label = path.basename(module.path, path.extname(module.path));
    const shape = module.isCore ? "[" : "(";
    const shapeClose = module.isCore ? "]" : ")";
    lines.push(`  ${shortPath}${shape}${label}${shapeClose}`);
  }

  lines.push("");

  for (const module of modules) {
    const shortPath = module.path.replace(/\//g, "_").replace(/\./g, "_");
    for (const imp of module.imports) {
      const impShortPath = imp.replace(/\//g, "_").replace(/\./g, "_");
      const isCycle = cycles.some(
        (c) => c.includes(module.path) && c.includes(imp),
      );
      if (isCycle) {
        lines.push(`  ${shortPath} -->|CYCLE| ${impShortPath}`);
      } else {
        lines.push(`  ${shortPath} --> ${impShortPath}`);
      }
    }
  }

  return lines.join("\n");
}

async function walkDirectory(
  dir: string,
  exclude: Set<string>,
  files: string[] = [],
): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (exclude.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkDirectory(fullPath, exclude, files);
      } else if (entry.name.match(/\.(ts|tsx|js|jsx)$/)) {
        files.push(fullPath);
      }
    }
  } catch {
    // Skip inaccessible directories
  }
  return files;
}

function buildAttributes(
  args: Partial<z.infer<typeof architectureMapSchema>>,
  stats?: { modules: number; dependencies: number; cycles: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (stats) {
    attrs.push(`modules="${stats.modules}"`);
    attrs.push(`dependencies="${stats.dependencies}"`);
    attrs.push(`cycles="${stats.cycles}"`);
  }
  return attrs.join(" ");
}

export const architectureMapTool: ToolDefinition<
  z.infer<typeof architectureMapSchema>
> = {
  name: "architecture_map",
  description: DESCRIPTION,
  inputSchema: architectureMapSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Generate architecture map";
    if (args.app_name) preview += ` in app: ${args.app_name}`;
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-architecture-map ${buildAttributes(args)}>Generating map...</dyad-architecture-map>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Generating architecture map for ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-architecture-map ${buildAttributes(args)}>Analyzing modules...</dyad-architecture-map>`,
    );

    try {
      const files = await walkDirectory(targetAppPath, EXCLUDE_DIRS);
      const modules: Module[] = [];

      for (const file of files) {
        try {
          const content = await fs.readFile(file, "utf-8");
          const relativePath = path.relative(targetAppPath, file);
          const module = await analyzeModule(relativePath, content);
          modules.push(module);
        } catch {
          // Skip unreadable files
        }
      }

      const cycles = detectCircularDeps(modules);
      const totalDeps = modules.reduce((sum, m) => sum + m.imports.length, 0);

      const attrs = buildAttributes(args, {
        modules: modules.length,
        dependencies: totalDeps,
        cycles: cycles.length,
      });

      const mermaid = generateMermaid(modules, cycles);

      let resultText = `Modules: ${modules.length}\nTotal Dependencies: ${totalDeps}\nCircular Dependencies: ${cycles.length}\n\n`;

      if (cycles.length > 0) {
        resultText += `⚠️ Circular Dependencies Found:\n${cycles.map((c) => `  - ${c.join(" → ")}`).join("\n")}\n\n`;
      }

      resultText += `Architecture Diagram (Mermaid):\n\`\`\`mermaid\n${mermaid}\n\`\`\``;

      ctx.onXmlComplete(
        `<dyad-architecture-map ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-architecture-map>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to generate architecture map: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
