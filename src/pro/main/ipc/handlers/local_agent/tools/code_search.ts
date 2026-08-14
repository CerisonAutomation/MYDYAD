import { z } from "zod";
import log from "electron-log";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { localCodeSearch } from "./local_code_search";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings } from "@/main/settings";
import { isCodeExplorerReady } from "@/ipc/processors/code_explorer";
import { resolveTargetAppPath } from "./resolve_app_context";

const logger = log.scope("code_search");

const codeSearchSchema = z.object({
  query: z.string().describe("Search query to find relevant files"),
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional. Name of a referenced app (from `@app:Name` mentions in the user's prompt) to search in instead of the current app. Omit to search the current app.",
    ),
});

type CodeSearchArgs = z.infer<typeof codeSearchSchema>;

function buildCodeSearchAttributes(args: Partial<CodeSearchArgs>) {
  const queryAttr = args.query ? ` query="${escapeXmlAttr(args.query)}"` : "";
  const appNameAttr = args.app_name
    ? ` app_name="${escapeXmlAttr(args.app_name)}"`
    : "";
  return `${queryAttr}${appNameAttr}`;
}

const DESCRIPTION = `Search the codebase semantically to find files relevant to a query. Use this tool when you need to discover which files contain code related to a specific concept, feature, or functionality. Returns a list of file paths that are most relevant to the search query.

### When to Use This Tool

- Explore unfamiliar codebases
- Ask "how / where / what" questions to understand behavior
- Find code by meaning rather than exact text

### When NOT to Use

Skip this tool for:
1. Exact text matches (use \`grep\`)
2. Reading known files (use \`read_file\`)
3. Simple symbol lookups (use \`grep\`)
`;

export const codeSearchTool: ToolDefinition<CodeSearchArgs> = {
  name: "code_search",
  description: DESCRIPTION,
  inputSchema: codeSearchSchema,
  defaultConsent: "always",

  // Local implementation - no engine required
  isEnabled: (ctx) =>
    !(readSettings().enableCodeExplorer && isCodeExplorerReady(ctx.appPath)),

  getConsentPreview: (args) =>
    args.app_name
      ? `Search for "${args.query}" (app: ${args.app_name})`
      : `Search for "${args.query}"`,

  buildXml: (args, isComplete) => {
    if (!args.query) return undefined;
    if (isComplete) return undefined;
    return `<dyad-code-search${buildCodeSearchAttributes(args)}>Searching...</dyad-code-search>`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Executing code search: ${args.query}`);
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    ctx.onXmlStream(
      `<dyad-code-search${buildCodeSearchAttributes({
        query: args.query,
        app_name: args.app_name,
      })}>`,
    );

    try {
      // Use local code search (ripgrep-based)
      const results = await localCodeSearch({
        query: args.query,
        appPath: targetAppPath,
        maxResults: 20,
      });

      // Format results
      const resultText =
        results.length === 0
          ? "No relevant files found."
          : results
              .map(
                (r) =>
                  ` - ${r.file}:${r.line} — ${r.content.substring(0, 100)}`,
              )
              .join("\n");

      // Write final result to UI
      ctx.onXmlComplete(
        `<dyad-code-search${buildCodeSearchAttributes(args)}>${escapeXmlContent(resultText)}</dyad-code-search>`,
      );

      logger.log(`Code search completed for query: ${args.query}`);

      if (results.length === 0) {
        return "No relevant files found for the given query.";
      }

      return `Found ${results.length} relevant match(es):\n${resultText}`;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Code search failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.External,
      );
    }
  },
};
