import { z } from "zod";
import log from "electron-log";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { engineFetch } from "./engine_fetch";
import { localWebSearch, formatSearchResults } from "./local_web_search";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("web_search");

const webSearchSchema = z.object({
  query: z.string().describe("The search query to look up on the web"),
});

const DESCRIPTION = `
Use this tool to access real-time information beyond your training data cutoff.

When to Search:
- Current API documentation, library versions, or breaking changes
- Latest best practices, security advisories, or bug fixes
- Specific error messages or troubleshooting solutions
- Recent framework updates or deprecation notices

Query Tips:
- Be specific: Include version numbers, exact error messages, or technical terms
- Add context: "React 19 useEffect cleanup" not just "React hooks"

Examples:

<example>
OpenAI GPT-5 API model names
</example>

<example>
NextJS 14 app router middleware auth
</example>
`;

/**
 * Parse SSE events from a buffer and extract content deltas.
 * Returns the remaining unparsed buffer.
 * Throws an error if an SSE error event is received.
 */
function parseSSEEvents(
  buffer: string,
  onContent: (content: string) => void,
): string {
  const lines = buffer.split("\n");
  // Keep the last potentially incomplete line
  const remaining = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("data: ")) {
      continue;
    }

    const data = trimmed.slice(6); // Remove "data: " prefix

    // Check for stream end marker
    if (data === "[DONE]") {
      continue;
    }

    try {
      const json = JSON.parse(data);

      // Check for OpenAI-style SSE error: { error: { message: "...", type: "...", code: "..." } }
      if (json.error) {
        const errorMessage =
          json.error.message || json.error.type || "Unknown SSE error";
        throw new DyadError(
          `Web search SSE error: ${errorMessage}`,
          DyadErrorKind.External,
        );
      }

      // OpenAI-style SSE format: { choices: [{ delta: { content: "..." } }] }
      const content = json.choices?.[0]?.delta?.content;
      if (content) {
        onContent(content);
      }
    } catch (e) {
      // Re-throw SSE errors
      if (e instanceof Error && e.message.startsWith("Web search SSE error:")) {
        throw e;
      }
      // Skip malformed JSON lines
      logger.warn("Failed to parse SSE JSON:", data);
    }
  }

  return remaining;
}

/**
 * Call the web search SSE endpoint and stream results (original Dyad Engine pattern)
 */
async function callWebSearchSSE(
  query: string,
  ctx: AgentContext,
): Promise<string> {
  ctx.onXmlStream(`<dyad-web-search query="${escapeXmlAttr(query)}">`);

  const response = await engineFetch(ctx, "/tools/web-search", {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Web search failed: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  if (!response.body) {
    throw new DyadError(
      "Web search response has no body",
      DyadErrorKind.External,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events and accumulate content
      buffer = parseSSEEvents(buffer, (content) => {
        accumulated += content;
        // Stream intermediate results to UI with dyad-web-search prefix
        ctx.onXmlStream(
          `<dyad-web-search query="${escapeXmlAttr(query)}">${escapeXmlContent(accumulated)}`,
        );
      });
    }

    // Handle any remaining buffer content
    if (buffer.trim()) {
      parseSSEEvents(buffer + "\n", (content) => {
        accumulated += content;
      });
    }
  } finally {
    reader.releaseLock();
  }

  return accumulated;
}

/**
 * Call local web search with parallel multi-provider fallback
 */
async function callLocalWebSearch(
  query: string,
  ctx: AgentContext,
): Promise<string> {
  ctx.onXmlStream(`<dyad-web-search query="${escapeXmlAttr(query)}">`);

  // Use local web search with parallel providers
  const results = await localWebSearch(query, 5);

  if (!results || results.length === 0) {
    throw new DyadError(
      "Web search returned no results",
      DyadErrorKind.External,
    );
  }

  const resultText = formatSearchResults(results);

  // Stream intermediate results to UI (matching original SSE pattern)
  ctx.onXmlStream(
    `<dyad-web-search query="${escapeXmlAttr(query)}">${escapeXmlContent(resultText)}`,
  );

  return resultText;
}

export const webSearchTool: ToolDefinition<z.infer<typeof webSearchSchema>> = {
  name: "web_search",
  description: DESCRIPTION,
  inputSchema: webSearchSchema,
  defaultConsent: "ask",
  usesEngineEndpoint: true, // Keep engine endpoint support

  // Available to all users: Dyad Pro uses engine, BYOK uses local
  isEnabled: () => true,

  getConsentPreview: (args) => `Search the web: "${args.query}"`,

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Executing web search: ${args.query}`);

    try {
      let result: string;

      // Use Dyad Engine if available, otherwise use local search
      // Falls back to local if engine auth fails (BYOK users without auto key)
      if (ctx.isDyadPro) {
        try {
          result = await callWebSearchSSE(args.query, ctx);
        } catch (engineError) {
          if (
            engineError instanceof DyadError &&
            engineError.kind === DyadErrorKind.Auth
          ) {
            logger.log("Engine auth failed, falling back to local web search");
            result = await callLocalWebSearch(args.query, ctx);
          } else {
            throw engineError;
          }
        }
      } else {
        result = await callLocalWebSearch(args.query, ctx);
      }

      if (!result) {
        throw new DyadError(
          "Web search returned no results",
          DyadErrorKind.External,
        );
      }

      // Write final result to UI and DB with dyad-web-search wrapper
      ctx.onXmlComplete(
        `<dyad-web-search query="${escapeXmlAttr(args.query)}">${escapeXmlContent(result)}</dyad-web-search>`,
      );

      logger.log(`Web search completed for query: ${args.query}`);
      return result;
    } catch (error) {
      logger.error("Web search failed:", error);
      throw new DyadError(
        `Web search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        DyadErrorKind.External,
      );
    }
  },
};
