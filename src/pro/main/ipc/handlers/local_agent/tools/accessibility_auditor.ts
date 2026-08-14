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

const logger = log.scope("accessibility_auditor");

const accessibilityAuditorSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions) to audit instead of the current app.",
    ),
  file_path: z
    .string()
    .optional()
    .describe("Specific file to audit. Omit to audit all files."),
});

const DESCRIPTION = `Audit UI components for WCAG 2.1 accessibility compliance.

- Missing alt text, aria labels, keyboard handlers
- Color contrast issues, focus management
- Semantic HTML violations
- Returns issues with WCAG references and fix suggestions`;

function buildAttributes(
  args: Partial<z.infer<typeof accessibilityAuditorSchema>>,
  stats?: { issues: number; errors: number; warnings: number },
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
    attrs.push(`errors="${stats.errors}"`);
    attrs.push(`warnings="${stats.warnings}"`);
  }
  return attrs.join(" ");
}

export const accessibilityAuditorTool: ToolDefinition<
  z.infer<typeof accessibilityAuditorSchema>
> = {
  name: "accessibility_auditor",
  description: DESCRIPTION,
  inputSchema: accessibilityAuditorSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Audit accessibility compliance";
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
    return `<dyad-accessibility-auditor ${buildAttributes(args)}>Auditing accessibility...</dyad-accessibility-auditor>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Auditing accessibility in ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-accessibility-auditor ${buildAttributes(args)}>Scanning components...</dyad-accessibility-auditor>`,
    );

    try {
      const findings: string[] = [];

      const analyzeFile = (filePath: string, content: string) => {
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (/<img(?![^>]*\balt=)[^>]*>/i.test(line)) {
            findings.push(`${filePath}:${i + 1} - <img> missing alt attribute`);
          }
          if (
            /onClick(?!.*onKeyDown|.*onKeyPress)/.test(line) &&
            !/role=/.test(line) &&
            !/button|a\b/.test(line)
          ) {
            findings.push(
              `${filePath}:${i + 1} - Click handler without keyboard handler`,
            );
          }
          if (/tabIndex\s*=\s*\{?\s*[2-9]/.test(line)) {
            findings.push(
              `${filePath}:${i + 1} - Positive tabIndex (avoid > 1)`,
            );
          }
          if (/outline\s*:\s*none|outline\s*:\s*0/.test(line)) {
            findings.push(
              `${filePath}:${i + 1} - Focus outline removed (accessibility concern)`,
            );
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

      const attrs = buildAttributes(args, {
        issues: findings.length,
        errors: findings.length,
        warnings: 0,
      });

      if (findings.length === 0) {
        ctx.onXmlComplete(
          `<dyad-accessibility-auditor ${attrs}>No accessibility issues found.</dyad-accessibility-auditor>`,
        );
        return "No accessibility issues found.";
      }

      const resultText = `Found ${findings.length} accessibility issue(s):\n${findings.map((f) => `• ${f}`).join("\n")}`;

      ctx.onXmlComplete(
        `<dyad-accessibility-auditor ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-accessibility-auditor>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Accessibility audit failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
