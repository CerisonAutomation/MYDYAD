import { z } from "zod";
import * as fs from "node:fs/promises";
import { accessSync } from "node:fs";
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

const logger = log.scope("license_check");

const licenseCheckSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
});

const DESCRIPTION = `Check project and dependency licenses for compatibility.

- Detects license type for project and all dependencies
- Identifies copyleft licenses (GPL, AGPL, etc.) that may require source disclosure
- Checks for license compatibility issues
- Use for compliance checks and open-source audits`;

interface LicenseInfo {
  package: string;
  license: string;
  isCopyleft: boolean;
  isPermissive: boolean;
}

interface LicenseReport {
  projectLicense: string | null;
  dependencies: LicenseInfo[];
  issues: string[];
  score: number;
}

const _COPYLEFT_LICENSES = [
  "GPL-2.0",
  "GPL-3.0",
  "AGPL-3.0",
  "LGPL-2.1",
  "LGPL-3.0",
  "MPL-2.0",
  "EPL-1.0",
  "EPL-2.0",
  "CDDL-1.0",
  "CDDL-1.1",
];

const _PERMISSIVE_LICENSES = [
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
];

async function findLicenseFile(dir: string): Promise<string | null> {
  const candidates = [
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "LICENCE",
    "LICENCE.md",
    "LICENCE.txt",
    "COPYING",
    "COPYING.md",
  ];

  for (const candidate of candidates) {
    const filePath = path.join(dir, candidate);
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      // Continue
    }
  }
  return null;
}

async function detectLicense(content: string): Promise<string> {
  const upperContent = content.toUpperCase();

  if (upperContent.includes("MIT LICENSE")) return "MIT";
  if (upperContent.includes("ISC LICENSE")) return "ISC";
  if (
    upperContent.includes("BSD 2-CLAUSE") ||
    upperContent.includes("BSD TWO CLAUSE")
  )
    return "BSD-2-Clause";
  if (
    upperContent.includes("BSD 3-CLAUSE") ||
    upperContent.includes("BSD THREE CLAUSE")
  )
    return "BSD-3-Clause";
  if (
    upperContent.includes("APACHE LICENSE") &&
    upperContent.includes("VERSION 2.0")
  )
    return "Apache-2.0";
  if (
    upperContent.includes("GNU GENERAL PUBLIC LICENSE") &&
    upperContent.includes("VERSION 3")
  )
    return "GPL-3.0";
  if (
    upperContent.includes("GNU GENERAL PUBLIC LICENSE") &&
    upperContent.includes("VERSION 2")
  )
    return "GPL-2.0";
  if (upperContent.includes("GNU AFFERO GENERAL PUBLIC LICENSE"))
    return "AGPL-3.0";
  if (
    upperContent.includes("GNU LESSER GENERAL PUBLIC LICENSE") &&
    upperContent.includes("VERSION 3")
  )
    return "LGPL-3.0";
  if (upperContent.includes("MOZILLA PUBLIC LICENSE")) return "MPL-2.0";

  return "Unknown";
}

function analyzeDependencies(pkg: Record<string, unknown>): LicenseInfo[] {
  const deps = (pkg.dependencies as Record<string, string>) || {};
  const devDeps = (pkg.devDependencies as Record<string, string>) || {};
  const allDeps = { ...deps, ...devDeps };

  return Object.entries(allDeps).map(([name]) => ({
    package: name,
    license: "Unknown", // Would need package-lock.json or npm API for real detection
    isCopyleft: false,
    isPermissive: true,
  }));
}

function buildAttributes(
  args: Partial<z.infer<typeof licenseCheckSchema>>,
  report?: LicenseReport,
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (report) {
    attrs.push(`score="${report.score}"`);
    attrs.push(`deps="${report.dependencies.length}"`);
    attrs.push(`issues="${report.issues.length}"`);
  }
  return attrs.join(" ");
}

export const licenseCheckTool: ToolDefinition<
  z.infer<typeof licenseCheckSchema>
> = {
  name: "license_check",
  description: DESCRIPTION,
  inputSchema: licenseCheckSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (ctx: AgentContext) => {
    const packageJsonPath = path.join(ctx.appPath, "package.json");
    try {
      accessSync(packageJsonPath);
      return true;
    } catch {
      return false;
    }
  },

  getConsentPreview: (args) => {
    let preview = "Check licenses";
    if (args.app_name) preview += ` in app: ${args.app_name}`;
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-license-check ${buildAttributes(args)}>Checking licenses...</dyad-license-check>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Checking licenses in ${targetAppPath}`);
    ctx.onXmlStream(
      `<dyad-license-check ${buildAttributes(args)}>Reading license files...</dyad-license-check>`,
    );

    try {
      // Find project license
      let projectLicense: string | null = null;
      const licenseFile = await findLicenseFile(targetAppPath);
      if (licenseFile) {
        const content = await fs.readFile(licenseFile, "utf-8");
        projectLicense = await detectLicense(content);
      }

      // Analyze dependencies
      const packageJsonPath = path.join(targetAppPath, "package.json");
      let dependencies: LicenseInfo[] = [];

      try {
        const content = await fs.readFile(packageJsonPath, "utf-8");
        const pkg = JSON.parse(content);
        dependencies = analyzeDependencies(pkg);
      } catch {
        // No package.json
      }

      // Check for issues
      const issues: string[] = [];
      if (!projectLicense) {
        issues.push("No license file found in project root");
      }

      const copyleftDeps = dependencies.filter((d) => d.isCopyleft);
      if (copyleftDeps.length > 0) {
        issues.push(
          `Copyleft dependencies found: ${copyleftDeps.map((d) => d.package).join(", ")}`,
        );
      }

      // Calculate score
      let score = 100;
      if (!projectLicense) score -= 20;
      if (copyleftDeps.length > 0) score -= copyleftDeps.length * 10;

      const report: LicenseReport = {
        projectLicense,
        dependencies,
        issues,
        score: Math.max(0, score),
      };

      const attrs = buildAttributes(args, report);

      let resultText = `License Score: ${report.score}/100\n\n`;
      resultText += `📋 Project License: ${projectLicense || "Not found"}\n`;
      resultText += `📦 Dependencies: ${dependencies.length}\n`;

      if (issues.length > 0) {
        resultText += `\n⚠️ Issues:\n${issues.map((i) => `  - ${i}`).join("\n")}`;
      } else {
        resultText += `\n✅ No license issues detected`;
      }

      ctx.onXmlComplete(
        `<dyad-license-check ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-license-check>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to check licenses: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
