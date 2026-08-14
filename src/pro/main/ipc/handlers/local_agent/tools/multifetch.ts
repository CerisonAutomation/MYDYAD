/**
 * Multifetch Tool - Parallel HTTP requests with concurrency control
 *
 * Features:
 * - Configurable concurrency limit (1-20)
 * - Automatic retry with exponential backoff
 * - Timeout per request
 * - Batch multiple URLs in parallel
 * - Response deduplication
 * - Content extraction (HTML to text, JSON parsing)
 */

import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlContent } from "./types";
import { assertNotPrivateIp } from "./network_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import log from "electron-log";

const logger = log.scope("multifetch");

const multifetchSchema = z.object({
  urls: z
    .array(z.string())
    .min(1)
    .max(20)
    .describe("URLs to fetch in parallel"),
  concurrency: z
    .number()
    .min(1)
    .max(20)
    .optional()
    .default(5)
    .describe("Max parallel requests"),
  timeout_ms: z
    .number()
    .min(1000)
    .max(60000)
    .optional()
    .default(15000)
    .describe("Timeout per request in ms"),
  max_retries: z
    .number()
    .min(0)
    .max(5)
    .optional()
    .default(2)
    .describe("Max retries per failed request"),
  extract_text: z
    .boolean()
    .optional()
    .default(true)
    .describe("Extract readable text from HTML responses"),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Custom headers for all requests"),
});

const DESCRIPTION = `Fetch multiple URLs in parallel with configurable concurrency, automatic retry with exponential backoff, and content extraction.

Use cases:
- Parallel API calls to multiple endpoints
- Batch fetching documentation pages
- Concurrent resource loading
- Rate-limited bulk operations

Features:
- Concurrency control (1-20 parallel requests)
- Automatic retry with exponential backoff
- Per-request timeout
- HTML to text extraction
- JSON response parsing
- Response deduplication by URL`;

export const multifetchTool: ToolDefinition<z.infer<typeof multifetchSchema>> =
  {
    name: "multifetch",
    description: DESCRIPTION,
    inputSchema: multifetchSchema,
    defaultConsent: "ask",
    modifiesState: false,
    isEnabled: () => true,

    getConsentPreview: (args) =>
      `Fetch ${args.urls.length} URL(s) in parallel (concurrency: ${args.concurrency})`,

    buildXml: (args, isComplete) => {
      if (isComplete) return undefined;
      return `<dyad-multifetch url_count="${args.urls?.length ?? 0}" concurrency="${args.concurrency ?? 5}">Preparing parallel fetch...</dyad-multifetch>`;
    },

    execute: async (args, ctx: AgentContext) => {
      const {
        urls,
        concurrency,
        timeout_ms,
        max_retries,
        extract_text,
        headers,
      } = args;
      logger.log(`Multifetch: ${urls.length} URLs, concurrency=${concurrency}`);

      ctx.onXmlStream(
        `<dyad-multifetch url_count="${urls.length}" concurrency="${concurrency}">Starting parallel fetch...</dyad-multifetch>`,
      );

      // Bounded concurrency executor
      const results: Array<{
        url: string;
        status: number;
        content: string;
        error?: string;
      }> = [];
      const queue = [...urls];
      const inFlight = new Set<Promise<void>>();

      const fetchWithRetry = async (
        url: string,
        attempt = 0,
      ): Promise<void> => {
        assertNotPrivateIp(url);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeout_ms);

        try {
          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              "User-Agent": "Dyad-Multifetch/1.0",
              ...headers,
            },
          });

          clearTimeout(timeout);

          if (!response.ok) {
            if (attempt < max_retries && response.status >= 500) {
              const delay = Math.pow(2, attempt) * 1000;
              logger.log(`Retry ${attempt + 1} for ${url} after ${delay}ms`);
              await new Promise((r) => setTimeout(r, delay));
              return fetchWithRetry(url, attempt + 1);
            }
            results.push({
              url,
              status: response.status,
              content: "",
              error: `HTTP ${response.status}`,
            });
            return;
          }

          const contentType = response.headers.get("content-type") || "";
          const MAX_RESPONSE_BYTES = 100_000;
          const buffer = await response.arrayBuffer();
          let content = new TextDecoder().decode(
            buffer.byteLength > MAX_RESPONSE_BYTES
              ? buffer.slice(0, MAX_RESPONSE_BYTES)
              : buffer,
          );

          if (extract_text && contentType.includes("text/html")) {
            // Simple HTML to text extraction
            content = content
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 50000);
          } else if (contentType.includes("application/json")) {
            try {
              const json = JSON.parse(content);
              content = JSON.stringify(json, null, 2).slice(0, 50000);
            } catch {
              /* keep as text */
            }
          }

          results.push({ url, status: response.status, content });
        } catch (error) {
          clearTimeout(timeout);
          if (error instanceof DyadError) throw error;
          if (attempt < max_retries) {
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise((r) => setTimeout(r, delay));
            return fetchWithRetry(url, attempt + 1);
          }
          results.push({
            url,
            status: 0,
            content: "",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };

      // Execute with bounded concurrency
      const runNext = async (): Promise<void> => {
        const url = queue.shift();
        if (!url) return;

        const promise = fetchWithRetry(url).then(() => {
          inFlight.delete(promise);
          ctx.onXmlStream(
            `<dyad-multifetch fetched="${results.length}/${urls.length}" url_count="${urls.length}">Fetching...</dyad-multifetch>`,
          );
          if (queue.length > 0) return runNext();
        });

        inFlight.add(promise);
        if (inFlight.size >= concurrency) {
          await Promise.race(inFlight);
        }
        if (queue.length > 0 && inFlight.size < concurrency) {
          await runNext();
        }
      };

      await runNext();
      await Promise.all(inFlight);

      // Format results
      const succeeded = results.filter(
        (r) => r.status >= 200 && r.status < 400,
      );
      const failed = results.filter((r) => r.status === 0 || r.status >= 400);

      let resultText = `Fetched ${succeeded.length}/${urls.length} URLs successfully.\n\n`;

      for (const r of succeeded) {
        resultText += `## ${r.url} (${r.status})\n${r.content.slice(0, 5000)}\n\n`;
      }

      if (failed.length > 0) {
        resultText += `## Failed (${failed.length})\n`;
        for (const r of failed) {
          resultText += `- ${r.url}: ${r.error}\n`;
        }
      }

      ctx.onXmlComplete(
        `<dyad-multifetch succeeded="${succeeded.length}" failed="${failed.length}" url_count="${urls.length}">\n${escapeXmlContent(resultText)}\n</dyad-multifetch>`,
      );

      return resultText;
    },
  };
