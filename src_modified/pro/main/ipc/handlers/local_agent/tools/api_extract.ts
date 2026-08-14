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

const logger = log.scope("api_extract");

const DEFAULT_MAX_FILES = 500;
const MAX_MAX_FILES = 5000;

const apiExtractSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
  max_files: z
    .number()
    .min(1)
    .max(MAX_MAX_FILES)
    .optional()
    .describe(
      `Maximum number of files to scan (default: ${DEFAULT_MAX_FILES}, max: ${MAX_MAX_FILES}).`,
    ),
});

const DESCRIPTION = `Extract REST/GraphQL API endpoints from code.

- Returns list of endpoints with method, path, handler, and framework
- Supports: Express, Fastify, NestJS, Next.js, Koa, Hono, GraphQL
- Use for API documentation and security audit`;

interface ApiEndpoint {
  method: string;
  path: string;
  handler: string;
  framework: string;
  isPublic: boolean;
  line: number;
}

interface ApiExtractReport {
  file: string;
  endpoints: ApiEndpoint[];
  frameworks: string[];
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

const FRAMEWORK_PATTERNS: Array<{
  framework: string;
  routePattern: RegExp;
  methodGroup?: number;
  pathGroup?: number;
}> = [
  {
    framework: "express",
    routePattern:
      /(?:app|router)\.(get|post|put|delete|patch|options|head)\s*\(\s*['"`]([^'"`]+)/gi,
    methodGroup: 1,
    pathGroup: 2,
  },
  {
    framework: "fastify",
    routePattern:
      /fastify\.(route|get|post|put|delete)\s*\(\s*['"`]([^'"`]+)/gi,
    methodGroup: 1,
    pathGroup: 2,
  },
  {
    framework: "nestjs",
    routePattern:
      /@(Get|Post|Put|Delete|Patch|Head|Options)\s*\(\s*['"`]([^'"`]+)/gi,
    methodGroup: 1,
    pathGroup: 2,
  },
  {
    framework: "nextjs",
    routePattern:
      /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/gi,
    methodGroup: 1,
  },
  {
    framework: "koa",
    routePattern: /router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)/gi,
    methodGroup: 1,
    pathGroup: 2,
  },
];

function analyzeFile(filePath: string, content: string): ApiExtractReport {
  const endpoints: ApiEndpoint[] = [];
  const frameworks = new Set<string>();
  const lines = content.split("\n");

  for (const {
    framework,
    routePattern,
    methodGroup,
    pathGroup,
  } of FRAMEWORK_PATTERNS) {
    const regex = new RegExp(routePattern.source, routePattern.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split("\n").length;
      const method = methodGroup
        ? (match[methodGroup] || "GET").toUpperCase()
        : "QUERY";
      const routePath = pathGroup ? match[pathGroup] || "/" : "/";

      const prevLines = lines
        .slice(Math.max(0, lineNum - 5), lineNum)
        .join(" ");
      const isPublic = !prevLines.match(
        /auth|jwt|token|session|protect|guard/i,
      );

      endpoints.push({
        method,
        path: routePath,
        handler: match[0].substring(0, 50),
        framework,
        isPublic,
        line: lineNum,
      });
      frameworks.add(framework);
    }
  }

  return { file: filePath, endpoints, frameworks: Array.from(frameworks) };
}

async function walkDirectory(
  dir: string,
  exclude: Set<string>,
  maxFiles: number,
  files: string[] = [],
): Promise<string[]> {
  if (files.length >= maxFiles) return files;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (exclude.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkDirectory(fullPath, exclude, maxFiles, files);
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
  args: Partial<z.infer<typeof apiExtractSchema>>,
  stats?: {
    endpoints: number;
    public: number;
    files: number;
    frameworks: string;
  },
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (stats) {
    attrs.push(`endpoints="${stats.endpoints}"`);
    attrs.push(`public="${stats.public}"`);
    attrs.push(`files="${stats.files}"`);
    attrs.push(`frameworks="${stats.frameworks}"`);
  }
  return attrs.join(" ");
}

export const apiExtractTool: ToolDefinition<z.infer<typeof apiExtractSchema>> =
  {
    name: "api_extract",
    description: DESCRIPTION,
    inputSchema: apiExtractSchema,
    defaultConsent: "always",
    modifiesState: false,

    isEnabled: (_ctx: AgentContext) => true,

    getConsentPreview: (args) => {
      let preview = "Extract API endpoints";
      if (args.app_name) preview += ` in app: ${args.app_name}`;
      return preview;
    },

    buildXml: (args, isComplete) => {
      if (isComplete) return undefined;
      return `<dyad-api-extract ${buildAttributes(args)}>Extracting...</dyad-api-extract>`;
    },

    execute: async (args, ctx: AgentContext) => {
      const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
      const maxFiles = Math.min(
        args.max_files ?? DEFAULT_MAX_FILES,
        MAX_MAX_FILES,
      );

      logger.log(`Extracting API endpoints from ${targetAppPath}`);
      ctx.onXmlStream(
        `<dyad-api-extract ${buildAttributes(args)}>Scanning ${maxFiles} files...</dyad-api-extract>`,
      );

      try {
        const files = await walkDirectory(
          targetAppPath,
          EXCLUDE_DIRS,
          maxFiles,
        );
        const reports: ApiExtractReport[] = [];
        const allFrameworks = new Set<string>();

        for (const file of files) {
          try {
            const content = await fs.readFile(file, "utf-8");
            const relativePath = path.relative(targetAppPath, file);
            const report = analyzeFile(relativePath, content);
            if (report.endpoints.length > 0) {
              reports.push(report);
              report.frameworks.forEach((f) => allFrameworks.add(f));
            }
          } catch {
            // Skip unreadable files
          }
        }

        const totalEndpoints = reports.reduce(
          (sum, r) => sum + r.endpoints.length,
          0,
        );
        const publicEndpoints = reports.reduce(
          (sum, r) => sum + r.endpoints.filter((e) => e.isPublic).length,
          0,
        );

        const attrs = buildAttributes(args, {
          endpoints: totalEndpoints,
          public: publicEndpoints,
          files: reports.length,
          frameworks: Array.from(allFrameworks).join(","),
        });

        if (reports.length === 0) {
          ctx.onXmlComplete(
            `<dyad-api-extract ${attrs}>No API endpoints found.</dyad-api-extract>`,
          );
          return "No API endpoints found.";
        }

        const lines = reports.slice(0, 15).map(
          (r, i) =>
            `${i + 1}. ${r.file} (${r.frameworks.join(", ")})\n   ${r.endpoints
              .slice(0, 5)
              .map(
                (e) =>
                  `- ${e.method} ${e.path} ${e.isPublic ? "[PUBLIC]" : ""}`,
              )
              .join("\n   ")}`,
        );

        const resultText = `Total Endpoints: ${totalEndpoints}\nPublic Endpoints: ${publicEndpoints}\nFrameworks: ${Array.from(allFrameworks).join(", ")}\n\nFiles:\n${lines.join("\n\n")}`;

        ctx.onXmlComplete(
          `<dyad-api-extract ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-api-extract>`,
        );
        return resultText;
      } catch (error) {
        if (error instanceof DyadError) throw error;
        throw new DyadError(
          `Failed to extract API endpoints: ${error instanceof Error ? error.message : String(error)}`,
          DyadErrorKind.Unknown,
        );
      }
    },
  };
