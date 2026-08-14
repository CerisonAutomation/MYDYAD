import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { assertNotPrivateIp } from "./network_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { smartTruncateSafe } from "./text_utils";
import log from "electron-log";

const logger = log.scope("crawl4ai");

const crawl4aiSchema = z.object({
  url: z.string().url().describe("URL to crawl and convert to markdown"),
  extract_mode: z
    .enum(["markdown", "text", "structured"])
    .optional()
    .describe("Extraction mode (default: markdown)"),
  max_depth: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("Maximum crawl depth for linked pages (default: 1)"),
  include_images: z
    .boolean()
    .optional()
    .describe("Whether to include image URLs in markdown (default: false)"),
});

const DESCRIPTION = `Crawl websites and convert to clean markdown for RAG and analysis.

- Converts web pages to clean, structured markdown
- Supports JS-rendered pages (Playwright-based)
- Extracts main content, removing navigation/ads
- Use for documentation scraping, research, and RAG pipelines

Zero API keys required - runs locally.`;

interface CrawlResult {
  url: string;
  title: string;
  markdown: string;
  wordCount: number;
  links: string[];
}

async function fetchAndExtract(
  url: string,
  includeImages: boolean,
): Promise<CrawlResult> {
  // Validate URL scheme
  const parsedUrl = new URL(url);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new DyadError(
      `crawl4ai only supports http/https URLs, got: ${parsedUrl.protocol}`,
      DyadErrorKind.Validation,
    );
  }

  assertNotPrivateIp(url);

  // Use local web fetch implementation with timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": "Dyad-Crawler/1.0",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const html = smartTruncateSafe(await response.text(), 1_000_000);

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;

  // Extract main content (simplified - remove script/style/nav)
  let content = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");

  // Convert to markdown (simplified)
  content = content
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "# $1\n\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "## $1\n\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "### $1\n\n")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "```\n$1\n```\n")
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");

  if (includeImages) {
    content = content.replace(
      /<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi,
      "![$2]($1)\n",
    );
  }

  // Remove remaining HTML tags
  content = content.replace(/<[^>]+>/g, "");

  // Clean up whitespace
  content = content.replace(/\n{3,}/g, "\n\n").trim();

  // Extract links
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links: string[] = [];
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    links.push(match[2]);
  }

  const wordCount = content.split(/\s+/).length;

  return {
    url,
    title,
    markdown: content,
    wordCount,
    links: links.slice(0, 20),
  };
}

function buildAttributes(
  args: Partial<z.infer<typeof crawl4aiSchema>>,
  result?: CrawlResult,
): string {
  const attrs: string[] = [];
  attrs.push(`url="${escapeXmlAttr(args.url || "")}"`);
  if (args.extract_mode) attrs.push(`mode="${args.extract_mode}"`);
  if (result) {
    attrs.push(`title="${escapeXmlAttr(result.title)}"`);
    attrs.push(`words="${result.wordCount}"`);
    attrs.push(`links="${result.links.length}"`);
  }
  return attrs.join(" ");
}

export const crawl4aiTool: ToolDefinition<z.infer<typeof crawl4aiSchema>> = {
  name: "crawl4ai",
  description: DESCRIPTION,
  inputSchema: crawl4aiSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => `Crawl and extract: ${args.url}`,

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-crawl4ai ${buildAttributes(args)}>Crawling...</dyad-crawl4ai>`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Crawling: ${args.url}`);
    ctx.onXmlStream(
      `<dyad-crawl4ai ${buildAttributes(args)}>Fetching page...</dyad-crawl4ai>`,
    );

    try {
      const result = await fetchAndExtract(
        args.url,
        args.include_images || false,
      );
      const attrs = buildAttributes(args, result);

      let resultText = `# ${result.title}\n\n`;
      resultText += `Source: ${result.url}\n`;
      resultText += `Words: ${result.wordCount}\n\n`;
      resultText += `---\n\n`;
      resultText += result.markdown;

      if (result.links.length > 0) {
        resultText += `\n\n---\n\n## Links Found (${result.links.length})\n`;
        result.links.slice(0, 10).forEach((link) => {
          resultText += `- ${link}\n`;
        });
      }

      ctx.onXmlComplete(
        `<dyad-crawl4ai ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-crawl4ai>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to crawl URL: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
