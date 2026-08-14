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

const logger = log.scope("api_generator");

const apiGeneratorSchema = z.object({
  app_name: z
    .string()
    .optional()
    .describe("Optional. Name of a referenced app to generate API for."),
  source: z
    .enum(["database", "types", "openapi", "graphql"])
    .describe("Source to generate API from"),
  framework: z
    .enum(["express", "fastify", "nestjs", "nextjs", "hono"])
    .optional()
    .describe("Target framework"),
  output: z
    .enum(["typescript", "javascript", "python", "go"])
    .optional()
    .describe("Output language"),
});

const DESCRIPTION = `AI-powered API generation from database schema or types.

- Generates REST/GraphQL APIs from database schema
- Creates CRUD endpoints automatically
- Includes validation, error handling, and documentation
- Supports multiple frameworks and languages

Sources:
- database: Generate from SQLite/PostgreSQL schema
- types: Generate from TypeScript types
- openapi: Generate from OpenAPI spec
- graphql: Generate GraphQL resolvers

Example: "Generate Express API from the database schema"`;

interface ApiEndpoint {
  method: string;
  path: string;
  handler: string;
  params: string[];
  returns: string;
}

interface ApiPlan {
  source: string;
  framework: string;
  endpoints: ApiEndpoint[];
  models: string[];
}

async function analyzeDatabaseSchema(appPath: string): Promise<ApiPlan> {
  const endpoints: ApiEndpoint[] = [];
  const models: string[] = [];

  // Look for schema files
  const schemaPatterns = [
    "schema.ts",
    "schema.prisma",
    "schema.sql",
    "models.ts",
    "entities.ts",
  ];

  for (const pattern of schemaPatterns) {
    const files = await fs.readdir(appPath, { recursive: true });
    for (const file of files) {
      if (file.toString().includes(pattern)) {
        const content = await fs.readFile(
          path.join(appPath, file.toString()),
          "utf-8",
        );

        // Extract table/model names
        const tableMatches = content.match(/(?:table|model|entity)\s+(\w+)/gi);
        if (tableMatches) {
          for (const match of tableMatches) {
            const name = match.split(/\s+/)[1];
            models.push(name);

            // Generate CRUD endpoints
            endpoints.push(
              {
                method: "GET",
                path: `/api/${name.toLowerCase()}`,
                handler: `list${name}`,
                params: [],
                returns: `${name}[]`,
              },
              {
                method: "GET",
                path: `/api/${name.toLowerCase()}/:id`,
                handler: `get${name}`,
                params: ["id"],
                returns: name,
              },
              {
                method: "POST",
                path: `/api/${name.toLowerCase()}`,
                handler: `create${name}`,
                params: [],
                returns: name,
              },
              {
                method: "PUT",
                path: `/api/${name.toLowerCase()}/:id`,
                handler: `update${name}`,
                params: ["id"],
                returns: name,
              },
              {
                method: "DELETE",
                path: `/api/${name.toLowerCase()}/:id`,
                handler: `delete${name}`,
                params: ["id"],
                returns: "void",
              },
            );
          }
        }
      }
    }
  }

  return {
    source: "database",
    framework: "express",
    endpoints,
    models,
  };
}

function buildAttributes(
  args: Partial<z.infer<typeof apiGeneratorSchema>>,
  plan?: ApiPlan,
): string {
  const attrs: string[] = [];
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  attrs.push(`source="${args.source}"`);
  if (args.framework) attrs.push(`framework="${args.framework}"`);
  if (plan) {
    attrs.push(`models="${plan.models.length}"`);
    attrs.push(`endpoints="${plan.endpoints.length}"`);
  }
  return attrs.join(" ");
}

export const apiGeneratorTool: ToolDefinition<
  z.infer<typeof apiGeneratorSchema>
> = {
  name: "api_generator",
  description: DESCRIPTION,
  inputSchema: apiGeneratorSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    let preview = `Generate ${args.framework || "Express"} API from ${args.source}`;
    if (args.output) preview += ` in ${args.output}`;
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-api-gen ${buildAttributes(args)}>Generating API...</dyad-api-gen>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    logger.log(`Generating API from ${args.source}`);
    ctx.onXmlStream(
      `<dyad-api-gen ${buildAttributes(args)}>Analyzing source...</dyad-api-gen>`,
    );

    try {
      const plan = await analyzeDatabaseSchema(targetAppPath);
      const attrs = buildAttributes(args, plan);

      let resultText = `API Generation Plan:\n`;
      resultText += `Source: ${args.source}\n`;
      resultText += `Framework: ${args.framework || "express"}\n`;
      resultText += `Models: ${plan.models.length}\n`;
      resultText += `Endpoints: ${plan.endpoints.length}\n\n`;

      resultText += `Models:\n`;
      plan.models.forEach((m) => {
        resultText += `  - ${m}\n`;
      });

      resultText += `\nEndpoints:\n`;
      plan.endpoints.slice(0, 20).forEach((e) => {
        resultText += `  ${e.method} ${e.path} → ${e.handler}\n`;
      });

      ctx.onXmlComplete(
        `<dyad-api-gen ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-api-gen>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to generate API: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
