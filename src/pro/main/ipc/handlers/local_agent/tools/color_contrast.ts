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

const logger = log.scope("color_contrast");

const colorContrastSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions) to analyze instead of the current app.",
    ),
  file_path: z
    .string()
    .optional()
    .describe("Specific file to analyze for color patterns."),
});

const DESCRIPTION = `Analyze color usage patterns in code.

- Finds hardcoded colors
- Detects inline styles with colors
- Identifies color variable usage
- Returns color analysis`;

function buildAttributes(
  args: Partial<z.infer<typeof colorContrastSchema>>,
  stats?: { colors: number; files: number },
): string {
  const attrs: string[] = [];
  if (args.app_name) {
    attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  }
  if (args.file_path) {
    attrs.push(`file_path="${escapeXmlAttr(args.file_path)}"`);
  }
  if (stats) {
    attrs.push(`colors="${stats.colors}"`);
    attrs.push(`files="${stats.files}"`);
  }
  return attrs.join(" ");
}

export const colorContrastTool: ToolDefinition<
  z.infer<typeof colorContrastSchema>
> = {
  name: "color_contrast",
  description: DESCRIPTION,
  inputSchema: colorContrastSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Analyze colors";
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
    return `<dyad-color-contrast ${buildAttributes(args)}>Analyzing colors...</dyad-color-contrast>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Analyzing colors in ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-color-contrast ${buildAttributes(args)}>Reading styles...</dyad-color-contrast>`,
    );

    try {
      const contrastResults: Array<{
        file: string;
        line: number;
        fg: string;
        bg: string;
        ratio: number;
        passesAA: boolean;
        passesAAA: boolean;
        passesLargeAA: boolean;
      }> = [];
      const colors: string[] = [];
      let filesScanned = 0;

      const analyzeFile = (filePath: string, content: string) => {
        filesScanned++;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const hexMatch = line.match(/#[0-9a-fA-F]{3,8}/g);
          hexMatch?.forEach((hex) => {
            colors.push(`${filePath}:${i + 1} - ${hex} (hex)`);
          });
          const rgbMatch = line.match(/rgb\([^)]+\)/g);
          rgbMatch?.forEach((rgb) => {
            colors.push(`${filePath}:${i + 1} - ${rgb} (rgb)`);
          });
        }
        analyzeContrastPairs(filePath, content, contrastResults);
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
            if (!/\.(css|scss|tsx?|jsx?)$/.test(entry.name)) continue;
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
        colors: colors.length,
        files: filesScanned,
      });

      if (colors.length === 0) {
        ctx.onXmlComplete(
          `<dyad-color-contrast ${attrs}>No colors found.</dyad-color-contrast>`,
        );
        return "No colors found.";
      }

      // Group ratios by pass/fail and render the most useful picture first.
      const failing = contrastResults.filter((c) => !c.passesAA);
      const passing = contrastResults.filter((c) => c.passesAA);

      let resultText = `Found ${colors.length} color usage(s) and ${contrastResults.length} foreground/background pair(s).\n`;

      if (contrastResults.length > 0) {
        resultText += `\n❌ Failing WCAG AA (${failing.length}):\n`;
        resultText +=
          failing
            .slice(0, 15)
            .map(
              (c) =>
                `• ${c.file}:${c.line} — ${c.fg} on ${c.bg} → ratio ${c.ratio.toFixed(2)}:1 (AA ${c.passesAA ? "✓" : "✗"}, AAA ${c.passesAAA ? "✓" : "✗"}, large-text AA 3:1 ${c.passesLargeAA ? "✓" : "✗"})`,
            )
            .join("\n") || "(none)";
        if (failing.length > 15) {
          resultText += `\n... and ${failing.length - 15} more failing pair(s)`;
        }
        resultText += `\n\n✅ Passing WCAG AA (${passing.length}):\n`;
        resultText +=
          passing
            .slice(0, 10)
            .map(
              (c) =>
                `• ${c.file}:${c.line} — ${c.fg} on ${c.bg} → ratio ${c.ratio.toFixed(2)}:1`,
            )
            .join("\n") || "(none)";
        if (passing.length > 10) {
          resultText += `\n... and ${passing.length - 10} more passing pair(s)`;
        }
        resultText += `\n\nAll color usage(s):\n`;
      }
      resultText += colors
        .slice(0, 20)
        .map((c) => `• ${c}`)
        .join("\n");

      ctx.onXmlComplete(
        `<dyad-color-contrast ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-color-contrast>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Color analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};

// ─── WCAG contrast helpers (relative luminance per WCAG 2.x) ────────────────

const NAMED_COLORS: Record<string, [number, number, number]> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  yellow: [255, 255, 0],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  pink: [255, 192, 203],
  brown: [165, 42, 42],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  transparent: [0, 0, 0],
  inherit: [0, 0, 0],
  currentcolor: [0, 0, 0],
};

function parseColor(value: string): [number, number, number] | null {
  const v = value.trim().toLowerCase();
  if (v.startsWith("#")) {
    let hex = v.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (![r, g, b].some(Number.isNaN)) return [r, g, b];
    }
    return null;
  }
  const rgb = v.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const named = NAMED_COLORS[v];
  return named ?? null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const chan = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

export function contrastRatio(fg: string, bg: string): number | null {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (!f || !b) return null;
  const l1 = luminance(f);
  const l2 = luminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

interface ContrastPair {
  file: string;
  line: number;
  fg: string;
  bg: string;
  ratio: number;
  passesAA: boolean;
  passesAAA: boolean;
  passesLargeAA: boolean;
}

/** Extract (color, background-color) pairs from CSS rule blocks and TSX style objects. */
function analyzeContrastPairs(
  filePath: string,
  content: string,
  results: ContrastPair[],
): void {
  const pushPair = (line: number, fg: string, bg: string) => {
    const ratio = contrastRatio(fg, bg);
    if (ratio === null) return;
    results.push({
      file: filePath,
      line,
      fg,
      bg,
      ratio,
      passesAA: ratio >= 4.5,
      passesAAA: ratio >= 7,
      passesLargeAA: ratio >= 3,
    });
  };

  // CSS rules: selector { color: X; background(-color): Y }
  const ruleRe = /[^{}]+\{[^{}]*\}/g;
  for (const rule of content.matchAll(ruleRe)) {
    const block = rule[0];
    const brace = block.indexOf("{");
    const decls = block.slice(brace + 1, block.length - 1);
    const colorMatch = decls.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
    const bgMatch = decls.match(
      /(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i,
    );
    if (colorMatch && bgMatch) {
      const lineNumber = content.slice(0, rule.index).split("\n").length || 1;
      pushPair(lineNumber, colorMatch[1].trim(), bgMatch[1].trim());
    }
  }

  // TSX inline styles: style={{ color: "#fff", backgroundColor: "#000" }}
  const styleObjRe = /style=\{\{\s*([\s\S]*?)\s*\}\}/g;
  for (const match of content.matchAll(styleObjRe)) {
    const obj = match[1];
    const colorMatch = obj.match(/(?:^|[,;])\s*color\s*:\s*['"]([^'"]+)['"]/);
    const bgMatch = obj.match(
      /(?:^|[,;])\s*backgroundColor\s*:\s*['"]([^'"]+)['"]/,
    );
    if (colorMatch && bgMatch) {
      const lineNumber = content.slice(0, match.index).split("\n").length || 1;
      pushPair(lineNumber, colorMatch[1], bgMatch[1]);
    }
  }
}
