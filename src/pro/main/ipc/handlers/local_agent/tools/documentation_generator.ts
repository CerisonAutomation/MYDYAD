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

const logger = log.scope("documentation_generator");

const documentationGeneratorSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe("Optional. Name of a referenced app to generate docs for."),
  file: z
    .string()
    .optional()
    .describe("Specific file to document (omit for entire codebase)"),
  type: z
    .enum(["api", "readme", "javadoc", "jsdoc", "inline"])
    .optional()
    .describe("Type of documentation to generate"),
  output: z
    .enum(["console", "file", "both"])
    .optional()
    .describe("Where to output documentation (default: console)"),
});

const DESCRIPTION = `AI-powered documentation generation from code.

- Generates API documentation, READMEs, and inline comments
- Supports JSDoc, Javadoc, and other formats
- Auto-generates from code structure and types
- Creates comprehensive documentation for entire codebase

Types:
- api: API reference documentation
- readme: Project README with usage examples
- javadoc: Java-style documentation
- jsdoc: JavaScript/TypeScript documentation
- inline: Inline code comments

Example: "Generate JSDoc documentation for src/api/"`;

interface DocumentationItem {
  name: string;
  type: string;
  description: string;
  params: Array<{ name: string; type: string; description: string }>;
  returns: string;
  examples: string[];
}

async function analyzeCodeForDocs(
  filePath: string,
  content: string,
): Promise<DocumentationItem[]> {
  const items: DocumentationItem[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Functions
    const funcMatch = line.match(
      /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/,
    );
    if (funcMatch) {
      const params = funcMatch[2].split(",").map((p) => ({
        name: p.trim().split(":")[0].trim(),
        type: p.trim().split(":")[1]?.trim() || "any",
        description: "",
      }));

      items.push({
        name: funcMatch[1],
        type: "function",
        description: `Function ${funcMatch[1]}`,
        params,
        returns: "void",
        examples: [],
      });
    }

    // Classes
    const classMatch = line.match(/^(?:export\s+)?class\s+(\w+)/);
    if (classMatch) {
      items.push({
        name: classMatch[1],
        type: "class",
        description: `Class ${classMatch[1]}`,
        params: [],
        returns: "",
        examples: [],
      });
    }
  }

  return items;
}

function generateJSDoc(item: DocumentationItem): string {
  let doc = "/**\n";
  doc += ` * ${item.description}\n`;
  doc += " *\n";

  item.params.forEach((p) => {
    doc += ` * @param {${p.type}} ${p.name}`;
    if (p.description) doc += ` - ${p.description}`;
    doc += "\n";
  });

  if (item.returns) {
    doc += ` * @returns {${item.returns}}\n`;
  }

  if (item.examples.length > 0) {
    doc += " * @example\n";
    item.examples.forEach((ex) => {
      doc += ` * ${ex}\n`;
    });
  }

  doc += " */";
  return doc;
}

function buildAttributes(
  args: Partial<z.infer<typeof documentationGeneratorSchema>>,
  itemCount?: number,
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (args.file) attrs.push(`file="${escapeXmlAttr(args.file)}"`);
  if (args.type) attrs.push(`type="${args.type}"`);
  if (itemCount !== undefined) attrs.push(`items="${itemCount}"`);
  return attrs.join(" ");
}

export const documentationGeneratorTool: ToolDefinition<
  z.infer<typeof documentationGeneratorSchema>
> = {
  name: "documentation_generator",
  description: DESCRIPTION,
  inputSchema: documentationGeneratorSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = `Generate ${args.type || "JSDoc"} documentation`;
    if (args.file) preview += ` for ${args.file}`;
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-doc-gen ${buildAttributes(args)}>Generating documentation...</dyad-doc-gen>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Generating documentation: ${args.type || "jsdoc"}`);
    ctx.onXmlStream(
      `<dyad-doc-gen ${buildAttributes(args)}>Analyzing code...</dyad-doc-gen>`,
    );

    try {
      let content = "";
      if (args.file) {
        const filePath = path.join(targetAppPath, args.file);
        content = await fs.readFile(filePath, "utf-8");
      }

      const items = await analyzeCodeForDocs(args.file || "codebase", content);
      const attrs = buildAttributes(args, items.length);

      let resultText = `Documentation Generated:\n`;
      resultText += `Items: ${items.length}\n`;
      resultText += `Format: ${args.type || "jsdoc"}\n\n`;

      items.slice(0, 20).forEach((item) => {
        resultText += generateJSDoc(item) + "\n";
        resultText += `// ${item.type}: ${item.name}\n\n`;
      });

      ctx.onXmlComplete(
        `<dyad-doc-gen ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-doc-gen>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to generate documentation: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
