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

const logger = log.scope("onboarding_brief");

const onboardingBriefSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
  task: z
    .string()
    .optional()
    .describe("What the user is about to do (tailors the reading list)"),
});

const DESCRIPTION = `Generate an onboarding brief explaining architecture, data flow, and conventions.

- Explains project structure, key modules, and data flow
- Provides an ordered reading list for onboarding
- Tailors recommendations based on the user's intended task
- Use for onboarding new developers or understanding unfamiliar codebases`;

interface OnboardingInfo {
  name: string;
  framework: string;
  structure: string[];
  keyModules: string[];
  conventions: string[];
  readingList: string[];
}

async function detectFramework(appPath: string): Promise<string> {
  try {
    const packageJson = await fs.readFile(
      path.join(appPath, "package.json"),
      "utf-8",
    );
    const pkg = JSON.parse(packageJson);

    if (pkg.dependencies?.next || pkg.devDependencies?.next) return "Next.js";
    if (pkg.dependencies?.react || pkg.devDependencies?.react) return "React";
    if (pkg.dependencies?.vue || pkg.devDependencies?.vue) return "Vue";
    if (pkg.dependencies?.angular || pkg.devDependencies?.["@angular/core"])
      return "Angular";
    if (pkg.dependencies?.express || pkg.devDependencies?.express)
      return "Express";
    if (pkg.dependencies?.fastify || pkg.devDependencies?.fastify)
      return "Fastify";
    if (pkg.dependencies?.nuxt || pkg.devDependencies?.nuxt) return "Nuxt";
    if (pkg.dependencies?.svelte || pkg.devDependencies?.svelte)
      return "Svelte";

    return "Unknown";
  } catch {
    return "Unknown";
  }
}

async function analyzeStructure(appPath: string): Promise<string[]> {
  const structure: string[] = [];
  try {
    const entries = await fs.readdir(appPath, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        entry.name !== "node_modules"
      ) {
        structure.push(entry.name);
      }
    }
  } catch {
    // Skip
  }
  return structure;
}

function buildAttributes(
  args: Partial<z.infer<typeof onboardingBriefSchema>>,
  info?: OnboardingInfo,
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (args.task) attrs.push(`task="${escapeXmlAttr(args.task)}"`);
  if (info) {
    attrs.push(`framework="${info.framework}"`);
    attrs.push(`modules="${info.keyModules.length}"`);
  }
  return attrs.join(" ");
}

export const onboardingBriefTool: ToolDefinition<
  z.infer<typeof onboardingBriefSchema>
> = {
  name: "onboarding_brief",
  description: DESCRIPTION,
  inputSchema: onboardingBriefSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = "Generate onboarding brief";
    if (args.app_name) preview += ` for app: ${args.app_name}`;
    if (args.task) preview += ` for task: ${args.task}`;
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-onboarding-brief ${buildAttributes(args)}>Analyzing project...</dyad-onboarding-brief>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Generating onboarding brief for ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-onboarding-brief ${buildAttributes(args)}>Reading project structure...</dyad-onboarding-brief>`,
    );

    try {
      const framework = await detectFramework(targetAppPath);
      const structure = await analyzeStructure(targetAppPath);

      const info: OnboardingInfo = {
        name: path.basename(targetAppPath),
        framework,
        structure,
        keyModules: structure.slice(0, 5),
        conventions: [
          "Follow existing code patterns",
          "Use TypeScript for type safety",
          "Write tests for new features",
        ],
        readingList: [
          "package.json - Project dependencies and scripts",
          "README.md - Project documentation",
          "src/ - Main source code",
          ...structure.slice(0, 3).map((s) => `${s}/ - ${s} directory`),
        ],
      };

      const attrs = buildAttributes(args, info);

      let resultText = `# Onboarding Brief: ${info.name}\n\n`;
      resultText += `## Framework: ${info.framework}\n\n`;
      resultText += `## Project Structure\n${info.structure.map((s) => `- ${s}/`).join("\n")}\n\n`;
      resultText += `## Key Modules\n${info.keyModules.map((m) => `- ${m}`).join("\n")}\n\n`;
      resultText += `## Conventions\n${info.conventions.map((c) => `- ${c}`).join("\n")}\n\n`;
      resultText += `## Recommended Reading List\n${info.readingList.map((r, i) => `${i + 1}. ${r}`).join("\n")}`;

      if (args.task) {
        resultText += `\n\n## Task-Specific Guidance\nFor "${args.task}", focus on:\n`;
        resultText += `- Review relevant modules in ${info.structure[0] || "src/"}/\n`;
        resultText += `- Understand data flow and dependencies\n`;
        resultText += `- Check existing patterns for similar features`;
      }

      ctx.onXmlComplete(
        `<dyad-onboarding-brief ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-onboarding-brief>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to generate onboarding brief: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
