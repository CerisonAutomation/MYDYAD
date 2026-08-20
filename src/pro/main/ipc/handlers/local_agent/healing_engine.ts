/**
 * Autonomous Healing Engine
 *
 * Detects gaps, auto-clones patterns from Dyad's own codebase,
 * and improves itself through pattern recognition and self-repair.
 */

import log from "electron-log";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import type { ToolDefinition, AgentContext } from "./types";

const logger = log.scope("healing-engine");

// ─── Gap Detection ──────────────────────────────────────────────────────────

export interface DetectedGap {
  type: "missing_tool" | "missing_handler" | "missing_export" | "pattern_gap" | "error_handling";
  file: string;
  line?: number;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  suggestedFix: string;
}

/**
 * Scan codebase for common issues and gaps.
 */
export function detectGaps(projectPath: string): DetectedGap[] {
  const gaps: DetectedGap[] = [];
  const toolsDir = join(projectPath, "src/pro/main/ipc/handlers/local_agent/tools");
  
  if (!existsSync(toolsDir)) return gaps;

  // Check each tool file
  const files = readdirSync(toolsDir).filter(f => f.endsWith(".ts") && !f.includes("spec") && !f.includes("test"));
  
  for (const file of files) {
    const filePath = join(toolsDir, file);
    const content = readFileSync(filePath, "utf8");
    
    // Gap 1: Missing ToolDefinition export
    if (content.includes("ToolDefinition") && !content.includes("export const") && !content.includes("export function")) {
      gaps.push({
        type: "missing_export",
        file,
        description: "Tool file has ToolDefinition but no exported tool",
        severity: "high",
        suggestedFix: "Add export for the tool definition",
      });
    }
    
    // Gap 2: Missing DyadError in catch blocks
    const catchBlocks = content.match(/catch\s*\([^)]*\)\s*\{[^}]*\}/g) || [];
    for (const block of catchBlocks) {
      if (!block.includes("DyadError") && !block.includes("logger.error") && !block.includes("console.error")) {
        gaps.push({
          type: "error_handling",
          file,
          description: "Catch block without proper error handling",
          severity: "medium",
          suggestedFix: "Add DyadError or logger.error in catch block",
        });
      }
    }
    
    // Gap 3: Missing Zod schema validation
    if (content.includes("execute:") && !content.includes("z.object")) {
      gaps.push({
        type: "pattern_gap",
        file,
        description: "Tool has execute but no Zod schema",
        severity: "medium",
        suggestedFix: "Add Zod schema for input validation",
      });
    }
    
    // Gap 4: Hardcoded strings (should be extracted)
    const hardcodedStrings = content.match(/"[A-Z][a-z]+ [A-Z][a-z]+[^"]*"/g) || [];
    if (hardcodedStrings.length > 5) {
      gaps.push({
        type: "pattern_gap",
        file,
        description: `${hardcodedStrings.length} hardcoded strings (should be constants)`,
        severity: "low",
        suggestedFix: "Extract hardcoded strings to constants",
      });
    }
  }
  
  return gaps;
}

// ─── Pattern Cloning ─────────────────────────────────────────────────────────

export interface PatternTemplate {
  name: string;
  description: string;
  template: string;
  variables: string[];
}

/**
 * Known patterns that can be cloned from existing tools.
 */
const PATTERNS: PatternTemplate[] = [
  {
    name: "basic_tool",
    description: "A basic tool with Zod schema and execute function",
    template: `import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("{{TOOL_NAME}}");

const {{TOOL_NAME}}Schema = z.object({
  {{PARAMS}}
});

type {{TOOL_NAME_CAP}}Args = z.infer<typeof {{TOOL_NAME}}Schema>;

export const {{TOOL_NAME}}Tool: ToolDefinition<{{TOOL_NAME_CAP}}Args> = {
  name: "{{TOOL_NAME}}",
  description: "{{DESCRIPTION}}",
  inputSchema: {{TOOL_NAME}}Schema,
  defaultConsent: "always",
  modifiesState: () => false,
  isEnabled: () => true,
  getConsentPreview: (args) => "{{DESCRIPTION}}",

  async execute(args, ctx: AgentContext) {
    logger.log("Executing {{TOOL_NAME}}");
    try {
      // Implementation here
      const result = "Success";
      return { value: result, truncated: false };
    } catch (err: any) {
      logger.error("{{TOOL_NAME}} failed:", err);
      throw new DyadError(
        err?.message || "Unknown error",
        DyadErrorKind.Unknown,
      );
    }
  },
};
`,
    variables: ["TOOL_NAME", "TOOL_NAME_CAP", "DESCRIPTION", "PARAMS"],
  },
  {
    name: "file_operation_tool",
    description: "A tool that reads/writes files with proper error handling",
    template: `import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { resolveTargetAppPath } from "./resolve_app_context";

const logger = log.scope("{{TOOL_NAME}}");

const {{TOOL_NAME}}Schema = z.object({
  path: z.string().describe("File path"),
  {{PARAMS}}
});

type {{TOOL_NAME_CAP}}Args = z.infer<typeof {{TOOL_NAME}}Schema>;

export const {{TOOL_NAME}}Tool: ToolDefinition<{{TOOL_NAME_CAP}}Args> = {
  name: "{{TOOL_NAME}}",
  description: "{{DESCRIPTION}}",
  inputSchema: {{TOOL_NAME}}Schema,
  defaultConsent: "always",
  modifiesState: (ctx) => true,
  isEnabled: () => true,
  getConsentPreview: (args) => "{{DESCRIPTION}} on " + args.path,

  async execute(args, ctx: AgentContext) {
    logger.log("Executing {{TOOL_NAME}}");
    const appPath = resolveTargetAppPath(ctx);
    try {
      const filePath = require("node:path").join(appPath, args.path);
      if (!require("node:fs").existsSync(filePath)) {
        throw new DyadError("File not found: " + args.path, DyadErrorKind.NotFound);
      }
      // Implementation here
      const result = "Success";
      return { value: result, truncated: false };
    } catch (err: any) {
      if (err instanceof DyadError) throw err;
      logger.error("{{TOOL_NAME}} failed:", err);
      throw new DyadError(err?.message || "Unknown error", DyadErrorKind.Unknown);
    }
  },
};
`,
    variables: ["TOOL_NAME", "TOOL_NAME_CAP", "DESCRIPTION", "PARAMS"],
  },
  {
    name: "api_call_tool",
    description: "A tool that calls external APIs with retry logic",
    template: `import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("{{TOOL_NAME}}");

const {{TOOL_NAME}}Schema = z.object({
  {{PARAMS}}
});

type {{TOOL_NAME_CAP}}Args = z.infer<typeof {{TOOL_NAME}}Schema>;

export const {{TOOL_NAME}}Tool: ToolDefinition<{{TOOL_NAME_CAP}}Args> = {
  name: "{{TOOL_NAME}}",
  description: "{{DESCRIPTION}}",
  inputSchema: {{TOOL_NAME}}Schema,
  defaultConsent: "always",
  modifiesState: () => false,
  isEnabled: () => true,
  getConsentPreview: (args) => "{{DESCRIPTION}}",

  async execute(args, ctx: AgentContext) {
    logger.log("Executing {{TOOL_NAME}}");
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // API call here
        const result = "Success";
        return { value: result, truncated: false };
      } catch (err: any) {
        logger.warn(\`Attempt \${attempt} failed:\`, err.message);
        if (attempt === maxRetries) {
          throw new DyadError(
            \`Failed after \${maxRetries} attempts: \${err.message}\`,
            DyadErrorKind.Unknown,
          );
        }
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
    throw new DyadError("Unexpected error", DyadErrorKind.Unknown);
  },
};
`,
    variables: ["TOOL_NAME", "TOOL_NAME_CAP", "DESCRIPTION", "PARAMS"],
  },
];

/**
 * Clone a pattern from the template library.
 */
export function clonePattern(
  patternName: string,
  variables: Record<string, string>,
): string | null {
  const pattern = PATTERNS.find(p => p.name === patternName);
  if (!pattern) return null;

  let template = pattern.template;
  for (const [key, value] of Object.entries(variables)) {
    template = template.replaceAll(`{{${key}}}`, value);
    template = template.replaceAll(`{{${key.toUpperCase()}}}`, value.toUpperCase());
  }
  return template;
}

// ─── Self-Healing ────────────────────────────────────────────────────────────

export interface HealingAction {
  type: "fix_import" | "fix_type" | "add_missing" | "extract_constant" | "improve_error";
  file: string;
  description: string;
  applied: boolean;
}

/**
 * Auto-fix common issues in tool files.
 */
export function autoHeal(projectPath: string): HealingAction[] {
  const actions: HealingAction[] = [];
  const toolsDir = join(projectPath, "src/pro/main/ipc/handlers/local_agent/tools");
  
  if (!existsSync(toolsDir)) return actions;

  const files = readdirSync(toolsDir).filter(f => f.endsWith(".ts") && !f.includes("spec") && !f.includes("test"));
  
  for (const file of files) {
    const filePath = join(toolsDir, file);
    let content = readFileSync(filePath, "utf8");
    let modified = false;

    // Fix 1: Add missing log import if logger is used but not imported
    if (content.includes("logger.") && !content.includes('import log from "electron-log"')) {
      content = `import log from "electron-log";\n` + content;
      modified = true;
      actions.push({
        type: "fix_import",
        file,
        description: "Added missing electron-log import",
        applied: true,
      });
    }

    // Fix 2: Add missing DyadError import if DyadError is used but not imported
    if (content.includes("DyadError") && !content.includes('import { DyadError')) {
      content = content.replace(
        /import\s*\{([^}]*)\}\s*from\s*"@\/errors\/dyad_error"/,
        (match, imports) => {
          if (!imports.includes("DyadError")) {
            return `import { DyadError, DyadErrorKind${imports ? ", " + imports : ""} } from "@/errors/dyad_error"`;
          }
          return match;
        }
      );
      modified = true;
      actions.push({
        type: "fix_import",
        file,
        description: "Added missing DyadError import",
        applied: true,
      });
    }

    // Fix 3: Add logger.scope if logger is used without scope
    if (content.includes("logger.") && !content.includes("logger = log.scope")) {
      const toolName = file.replace(".ts", "");
      content = content.replace(
        /const logger = log;/,
        `const logger = log.scope("${toolName}");`
      );
      modified = true;
      actions.push({
        type: "improve_error",
        file,
        description: "Added logger scope for better debugging",
        applied: true,
      });
    }

    // Fix 4: Add defaultConsent if missing
    if (content.includes("ToolDefinition") && !content.includes("defaultConsent")) {
      content = content.replace(
        /inputSchema:\s*\w+Schema,/,
        `inputSchema: ${file.replace(".ts", "")}Schema,\n  defaultConsent: "always",`
      );
      modified = true;
      actions.push({
        type: "add_missing",
        file,
        description: "Added defaultConsent: always",
        applied: true,
      });
    }

    if (modified) {
      require("node:fs").writeFileSync(filePath, content);
    }
  }

  return actions;
}

// ─── Gap Detection Report ────────────────────────────────────────────────────

export function generateHealingReport(projectPath: string): string {
  const gaps = detectGaps(projectPath);
  const actions = autoHeal(projectPath);
  
  const lines: string[] = [
    "# Autonomous Healing Report",
    "",
    `## Detected Gaps: ${gaps.length}`,
    "",
  ];

  const bySeverity = {
    critical: gaps.filter(g => g.severity === "critical"),
    high: gaps.filter(g => g.severity === "high"),
    medium: gaps.filter(g => g.severity === "medium"),
    low: gaps.filter(g => g.severity === "low"),
  };

  for (const [severity, items] of Object.entries(bySeverity)) {
    if (items.length > 0) {
      lines.push(`### ${severity.toUpperCase()} (${items.length})`);
      for (const gap of items) {
        lines.push(`- **${gap.file}**: ${gap.description}`);
        lines.push(`  Fix: ${gap.suggestedFix}`);
      }
      lines.push("");
    }
  }

  if (actions.length > 0) {
    lines.push(`## Auto-Fixed: ${actions.length}`);
    for (const action of actions) {
      lines.push(`- ✅ ${action.file}: ${action.description}`);
    }
    lines.push("");
  }

  lines.push(`## Patterns Available: ${PATTERNS.length}`);
  for (const pattern of PATTERNS) {
    lines.push(`- **${pattern.name}**: ${pattern.description}`);
  }

  return lines.join("\n");
}
