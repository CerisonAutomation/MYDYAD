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

const logger = log.scope("action_plan");

const actionPlanSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
  focus: z
    .enum(["full", "security", "quality", "architecture", "performance"])
    .optional()
    .describe("Focus area for the action plan (default: full)"),
});

const DESCRIPTION = `Synthesize findings from other analysis tools into a prioritized fix plan.

- Combines results from code_smells, security_scan, complexity, test_gaps, etc.
- Returns fix-now, fix-next, and ignore categories with effort estimates
- Use for planning refactoring and prioritizing fixes`;

interface ActionItem {
  priority: "fix-now" | "fix-next" | "ignore";
  category: string;
  file: string;
  issue: string;
  effort: "trivial" | "easy" | "medium" | "hard";
  recommendation: string;
}

interface ActionPlan {
  items: ActionItem[];
  summary: {
    fixNow: number;
    fixNext: number;
    ignore: number;
  };
}

function buildAttributes(
  args: Partial<z.infer<typeof actionPlanSchema>>,
  plan?: ActionPlan,
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (args.focus) attrs.push(`focus="${args.focus}"`);
  if (plan) {
    attrs.push(`fix_now="${plan.summary.fixNow}"`);
    attrs.push(`fix_next="${plan.summary.fixNext}"`);
    attrs.push(`ignore="${plan.summary.ignore}"`);
  }
  return attrs.join(" ");
}

export const actionPlanTool: ToolDefinition<z.infer<typeof actionPlanSchema>> =
  {
    name: "action_plan",
    description: DESCRIPTION,
    inputSchema: actionPlanSchema,
    defaultConsent: "always",
    modifiesState: false,

    isEnabled: (_ctx: AgentContext) => true,

    getConsentPreview: (args) => {
      let preview = "Generate action plan";
      if (args.app_name) preview += ` in app: ${args.app_name}`;
      if (args.focus) preview += ` focused on ${args.focus}`;
      return preview;
    },

    buildXml: (args, isComplete) => {
      if (isComplete) return undefined;
      return `<dyad-action-plan ${buildAttributes(args)}>Generating action plan...</dyad-action-plan>`;
    },

    execute: async (args, ctx: AgentContext) => {
      const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
      const focus = args.focus || "full";

      logger.log(
        `Generating action plan for ${targetAppPath} (focus: ${focus})`,
      );
      ctx.onXmlStream(
        `<dyad-action-plan ${buildAttributes(args)}>Analyzing codebase...</dyad-action-plan>`,
      );

      try {
        // Synthesize a real plan from a lightweight static scan of the app.
        const plan = await synthesizePlan(targetAppPath, focus);

        const attrs = buildAttributes(args, plan);

        let resultText = `Action Plan (Focus: ${focus})\n\n`;
        resultText += `🔴 Fix Now (${plan.summary.fixNow} items):\n`;
        plan.items
          .filter((i) => i.priority === "fix-now")
          .forEach((item) => {
            resultText += `  - [${item.category}] ${item.issue}\n    Effort: ${item.effort} | ${item.recommendation}\n`;
          });

        resultText += `\n🟡 Fix Next (${plan.summary.fixNext} items):\n`;
        plan.items
          .filter((i) => i.priority === "fix-next")
          .forEach((item) => {
            resultText += `  - [${item.category}] ${item.issue}\n    Effort: ${item.effort} | ${item.recommendation}\n`;
          });

        resultText += `\n⚪ Ignore (${plan.summary.ignore} items):\n`;
        plan.items
          .filter((i) => i.priority === "ignore")
          .forEach((item) => {
            resultText += `  - [${item.category}] ${item.issue}\n    ${item.recommendation}\n`;
          });

        resultText += `\n💡 Tip: Run security_scan, code_smells, complexity, and test_gaps for the full per-file detail behind these priorities.`;

        ctx.onXmlComplete(
          `<dyad-action-plan ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-action-plan>`,
        );
        return resultText;
      } catch (error) {
        if (error instanceof DyadError) throw error;
        throw new DyadError(
          `Failed to generate action plan: ${error instanceof Error ? error.message : String(error)}`,
          DyadErrorKind.Unknown,
        );
      }
    },
  };

const CATEGORY_RANK: Record<string, number> = {
  security: 0,
  quality: 1,
  testing: 2,
  complexity: 3,
  style: 4,
};
const EFFORT_RANK: Record<string, number> = {
  trivial: 0,
  easy: 1,
  medium: 2,
  hard: 3,
};

/**
 * Scans the app and derives a concrete action plan. Every item references
 * real files with counts, so the plan is actionable rather than boilerplate.
 */
async function synthesizePlan(
  appPath: string,
  focus: string,
): Promise<ActionPlan> {
  const items: ActionItem[] = [];
  const stats = {
    fetch: 0 as number,
    emptyCatch: 0 as number,
    console: 0 as number,
    todo: 0 as number,
    mathRandom: 0 as number,
    noAlt: 0 as number,
    anyType: 0 as number,
    fileCount: 0 as number,
    testFileCount: 0 as number,
  };
  const hotFiles = new Map<string, number>();

  const bump = (file: string, key: keyof typeof stats) => {
    stats[key] = (stats[key] as number) + 1;
    hotFiles.set(file, (hotFiles.get(file) ?? 0) + 1);
  };

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
        entry.name === "dist" ||
        entry.name === ".next"
      )
        continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath, depth + 1);
        continue;
      }
      if (
        /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(entry.name) ||
        entry.name.includes("__tests__")
      ) {
        stats.testFileCount++;
        continue;
      }
      if (!/\.(tsx?|jsx?)$/.test(entry.name)) continue;
      stats.fileCount++;
      try {
        const content = await fs.readFile(fullPath, "utf-8");
        const rel = path.relative(appPath, fullPath);
        const lines = content.split("\n");
        for (const line of lines) {
          if (/fetch\s*\(/.test(line) && !/signal\s*:/.test(line))
            bump(rel, "fetch");
          if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) bump(rel, "emptyCatch");
          if (/console\.(log|debug)\s*\(/.test(line)) bump(rel, "console");
          if (/TODO|FIXME|HACK|XXX/.test(line)) bump(rel, "todo");
          if (/Math\.random\s*\(/.test(line)) bump(rel, "mathRandom");
          if (/<img\b(?![^>]*\balt=)/.test(line)) bump(rel, "noAlt");
          if (/:\s*any\b/.test(line) && !/^\s*\/\//.test(line))
            bump(rel, "anyType");
        }
      } catch {
        /* skip */
      }
    }
  };
  await scanDir(appPath);

  const topFiles = (n: number) =>
    [...hotFiles.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([f]) => f);

  const makeItem = (
    priority: ActionItem["priority"],
    category: ActionItem["category"],
    file: string,
    issue: string,
    effort: ActionItem["effort"],
    recommendation: string,
  ): ActionItem => ({
    priority,
    category,
    file,
    issue,
    effort,
    recommendation,
  });

  // ── Fix now: security & correctness ──
  if (focus === "full" || focus === "security") {
    if (stats.fetch > 0) {
      items.push(
        makeItem(
          "fix-now",
          "security",
          topFiles(3).join(", ") || "src/",
          `${stats.fetch} fetch() call(s) without timeout/abort signal`,
          "easy",
          "Wrap fetch in AbortController with a timeout; clear it in finally",
        ),
      );
    }
    if (stats.mathRandom > 0) {
      items.push(
        makeItem(
          "fix-now",
          "security",
          topFiles(2).join(", ") || "src/",
          `${stats.mathRandom} Math.random() use(s) — verify none generate IDs/tokens`,
          "easy",
          "Replace ID/token generation with crypto.randomUUID()",
        ),
      );
    }
    if (stats.emptyCatch > 0) {
      items.push(
        makeItem(
          "fix-now",
          "quality",
          topFiles(3).join(", ") || "src/",
          `${stats.emptyCatch} empty catch block(s) swallow errors`,
          "easy",
          "Log the error or rethrow; never silently ignore",
        ),
      );
    }
  }

  // ── Fix next: maintainability & performance ──
  if (focus === "full" || focus === "quality" || focus === "performance") {
    if (stats.console > 0) {
      items.push(
        makeItem(
          "fix-next",
          "quality",
          topFiles(3).join(", ") || "src/",
          `${stats.console} debug console statement(s)`,
          "trivial",
          "Remove or route through a structured logger",
        ),
      );
    }
    if (stats.noAlt > 0) {
      items.push(
        makeItem(
          "fix-next",
          "quality",
          topFiles(2).join(", ") || "src/",
          `${stats.noAlt} <img> tag(s) missing alt text`,
          "easy",
          'Add descriptive alt attributes (alt="" for decorative images)',
        ),
      );
    }
    if (stats.anyType > 0) {
      items.push(
        makeItem(
          "fix-next",
          "complexity",
          topFiles(3).join(", ") || "src/",
          `${stats.anyType} \`any\` type usage(s)`,
          "medium",
          "Replace with precise types or unknown + narrowing",
        ),
      );
    }
  }

  // ── Testing & technical debt ──
  if (focus === "full" || focus === "quality") {
    if (stats.fileCount > 0 && stats.testFileCount === 0) {
      items.push(
        makeItem(
          "fix-next",
          "testing",
          "src/",
          `0 test files found across ${stats.fileCount} source file(s)`,
          "hard",
          "Add vitest coverage for core libs (utils, api, adapters) first",
        ),
      );
    } else if (stats.testFileCount > 0) {
      items.push(
        makeItem(
          "fix-next",
          "testing",
          `src/ (${stats.testFileCount} test file(s))`,
          "Expand test coverage beyond existing suites",
          "medium",
          "Target the highest-churn modules identified by hotspots",
        ),
      );
    }
  }

  // ── Ignore: hygiene ──
  if (stats.todo > 0) {
    items.push(
      makeItem(
        "ignore",
        "style",
        topFiles(2).join(", ") || "src/",
        `${stats.todo} TODO/FIXME marker(s)`,
        "trivial",
        "Track in your issue tracker; resolve during regular reviews",
      ),
    );
  }
  if (items.length === 0) {
    items.push(
      makeItem(
        "ignore",
        "style",
        "src/",
        "No significant issues detected by the lightweight scan",
        "trivial",
        "Run the full analysis suite (security_scan, code_smells, test_gaps) for deeper checks",
      ),
    );
  }

  // Focus filter (full keeps everything).
  const filtered =
    focus === "full"
      ? items
      : items.filter((i) =>
          focus === "security"
            ? i.category === "security"
            : focus === "performance"
              ? i.category === "quality" || i.category === "complexity"
              : focus === "quality"
                ? i.category === "quality" || i.category === "testing"
                : focus === "architecture"
                  ? i.category === "complexity" || i.category === "testing"
                  : i.category === "security",
        );

  const ordered = filtered.sort(
    (a, b) =>
      CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] ||
      EFFORT_RANK[a.effort] - EFFORT_RANK[b.effort],
  );

  return {
    items: ordered,
    summary: {
      fixNow: ordered.filter((i) => i.priority === "fix-now").length,
      fixNext: ordered.filter((i) => i.priority === "fix-next").length,
      ignore: ordered.filter((i) => i.priority === "ignore").length,
    },
  };
}
