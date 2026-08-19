/**
 * DOM Snapshot Tool
 *
 * Captures a structured snapshot of a rendered web page's DOM tree using
 * Playwright's headless Chromium. Returns element hierarchy, text content,
 * attributes, and optionally computed styles.
 */

import { z } from "zod";
import log from "electron-log";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { smartTruncateSafe } from "./text_utils";
import { assertNotPrivateIp } from "./network_utils";
import { getPage, resolveTargetUrl, waitForPageReady } from "./browser_session";

const logger = log.scope("dom_snapshot");

// ============================================================================
// Schema
// ============================================================================

const domSnapshotSchema = z.object({
  url: z
    .string()
    .optional()
    .describe(
      "URL to snapshot. If omitted, uses the preview panel URL of the current app.",
    ),
  selector: z
    .string()
    .optional()
    .describe(
      "CSS selector to snapshot a specific element subtree instead of the full page.",
    ),
  include_styles: z
    .boolean()
    .optional()
    .describe(
      "Include computed styles for each element (default: false). Increases output size significantly.",
    ),
  max_depth: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Maximum DOM tree depth to capture (default: 10, max: 50)."),
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional app reference from @app:Name mentions to snapshot a different app's preview.",
    ),
});

type DomSnapshotArgs = z.infer<typeof domSnapshotSchema>;

// ============================================================================
// Types
// ============================================================================

interface DomNode {
  tag: string;
  id?: string;
  classes?: string[];
  text?: string;
  attributes?: Record<string, string>;
  children?: DomNode[];
  computedStyles?: Record<string, string>;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_DEPTH = 10;
const ABSOLUTE_MAX_DEPTH = 50;
const NAVIGATION_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_LENGTH = 80_000;

// ============================================================================
// Serialization
// ============================================================================

function serializeNode(node: DomNode, indent: number): string {
  const pad = "  ".repeat(indent);
  const lines: string[] = [];

  // Opening tag with attributes
  const attrs: string[] = [];
  if (node.id) attrs.push(`id="${escapeXmlAttr(node.id)}"`);
  if (node.classes && node.classes.length > 0) {
    attrs.push(`class="${escapeXmlAttr(node.classes.join(" "))}"`);
  }
  if (node.attributes) {
    for (const [key, val] of Object.entries(node.attributes)) {
      attrs.push(`${escapeXmlAttr(key)}="${escapeXmlAttr(val)}"`);
    }
  }

  const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";

  // Self-closing for leaf nodes with no text
  if (!node.children && !node.text) {
    return `${pad}<${node.tag}${attrStr} />`;
  }

  lines.push(`${pad}<${node.tag}${attrStr}>`);

  // Inline text
  if (node.text) {
    lines.push(`${pad}  ${escapeXmlContent(node.text)}`);
  }

  // Computed styles
  if (node.computedStyles && Object.keys(node.computedStyles).length > 0) {
    lines.push(`${pad}  <computed-styles>`);
    for (const [prop, val] of Object.entries(node.computedStyles)) {
      lines.push(
        `${pad}    <${escapeXmlAttr(prop)}>${escapeXmlContent(val)}</${escapeXmlAttr(prop)}>`,
      );
    }
    lines.push(`${pad}  </computed-styles>`);
  }

  // Children
  if (node.children) {
    for (const child of node.children) {
      lines.push(serializeNode(child, indent + 1));
    }
  }

  lines.push(`${pad}</${node.tag}>`);
  return lines.join("\n");
}

function serializeDomTree(tree: DomNode): string {
  const lines: string[] = [];
  lines.push("<dom-tree>");
  lines.push(serializeNode(tree, 1));
  lines.push("</dom-tree>");
  return lines.join("\n");
}

// ============================================================================
// XML Output Helpers
// ============================================================================

function buildAttributes(
  args: Partial<DomSnapshotArgs>,
  extra?: { url?: string; nodeCount?: number },
): string {
  const attrs: string[] = [];
  if (args.url) attrs.push(`url="${escapeXmlAttr(args.url)}"`);
  if (args.selector) attrs.push(`selector="${escapeXmlAttr(args.selector)}"`);
  if (args.include_styles) attrs.push('include_styles="true"');
  if (args.max_depth != null) attrs.push(`max_depth="${args.max_depth}"`);
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (extra?.url) attrs.push(`final_url="${escapeXmlAttr(extra.url)}"`);
  if (extra?.nodeCount != null) attrs.push(`node_count="${extra.nodeCount}"`);
  return attrs.join(" ");
}

// ============================================================================
// Tool Definition
// ============================================================================

const DESCRIPTION = `Capture a structured snapshot of a rendered web page's DOM — element tree, text content, attributes, and computed styles. Use to read live page state that isn't visible in source code.

### When to Use This Tool
- Inspect the **rendered DOM** of a running dev server or live URL
- Debug **layout/structure** issues by reading the actual element hierarchy
- Verify that dynamic content (JavaScript-rendered) is present in the DOM
- Examine **computed styles** for layout debugging (set include_styles=true)
- Check what elements exist at a specific **CSS selector** subtree

### When NOT to Use This Tool
- You need the raw HTML source → use \`web_fetch\` instead
- You want to take a visual screenshot → use a screenshot tool
- You need to interact with the page (click, type) → use a browser automation tool`;

export const domSnapshotTool: ToolDefinition<DomSnapshotArgs> = {
  name: "dom_snapshot",
  description: DESCRIPTION,
  inputSchema: domSnapshotSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    const parts: string[] = ["Capture DOM snapshot"];
    if (args.url) parts.push(`of ${args.url}`);
    if (args.selector) parts.push(`for selector "${args.selector}"`);
    return parts.join(" ");
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    // Emit a tag even for preview-panel snapshots (no url/app_name) so the
    // streaming UI shows progress instead of nothing.
    return `<dyad-dom-snapshot ${buildAttributes(args)}>Capturing DOM...</dyad-dom-snapshot>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const maxDepth = Math.min(
      args.max_depth ?? DEFAULT_MAX_DEPTH,
      ABSOLUTE_MAX_DEPTH,
    );
    const includeStyles = args.include_styles ?? false;

    // Validate URL if provided
    if (args.url) {
      let parsed: URL;
      try {
        parsed = new URL(args.url);
      } catch {
        throw new DyadError(
          `Invalid URL: ${args.url}`,
          DyadErrorKind.Validation,
        );
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new DyadError(
          `Unsupported URL scheme "${parsed.protocol}" — only http and https are allowed`,
          DyadErrorKind.Validation,
        );
      }
      assertNotPrivateIp(args.url);
    }

    logger.log(
      `DOM snapshot: url=${args.url ?? "(app preview)"}, selector=${args.selector ?? "(full page)"}, maxDepth=${maxDepth}, includeStyles=${includeStyles}`,
    );

    ctx.onXmlStream(
      `<dyad-dom-snapshot ${buildAttributes(args)}>Launching browser...</dyad-dom-snapshot>`,
    );

    let page;

    try {
      page = await getPage();

      // Determine the target URL
      const targetUrl = resolveTargetUrl(args.url, ctx.appId);

      ctx.onXmlStream(
        `<dyad-dom-snapshot ${buildAttributes(args, { url: targetUrl })}>Navigating to ${escapeXmlContent(targetUrl)}...</dyad-dom-snapshot>`,
      );

      // Navigate to the URL
      await waitForPageReady(page, targetUrl, NAVIGATION_TIMEOUT_MS);

      ctx.onXmlStream(
        `<dyad-dom-snapshot ${buildAttributes(args, { url: targetUrl })}>Extracting DOM tree...</dyad-dom-snapshot>`,
      );

      // Extract the DOM tree
      const domTree = await page.evaluate(
        ({ selector, maxDepth, includeStyles }) => {
          let root: Element;
          if (selector) {
            const found = document.querySelector(selector);
            if (!found) {
              throw new DyadError(
                `Selector "${selector}" did not match any element on the page.`,
                DyadErrorKind.Validation,
              );
            }
            root = found;
          } else {
            root = document.documentElement;
          }

          // Inline function for extraction (must be self-contained for page.evaluate)
          function walk(el: Element, depth: number): DomNode {
            const node: DomNode = {
              tag: el.tagName.toLowerCase(),
            };

            const id = el.id;
            if (id) node.id = id;

            const classList = el.classList;
            if (classList.length > 0) {
              node.classes = Array.from(classList);
            }

            const meaningfulAttrs: Record<string, string> = {};
            const skipAttrs = new Set(["id", "class"]);
            for (const attr of Array.from(el.attributes)) {
              if (!skipAttrs.has(attr.name)) {
                meaningfulAttrs[attr.name] = attr.value;
              }
            }
            if (Object.keys(meaningfulAttrs).length > 0) {
              node.attributes = meaningfulAttrs;
            }

            const directText = Array.from(el.childNodes)
              .filter((n): n is Text => n.nodeType === Node.TEXT_NODE)
              .map((n) => n.textContent?.trim() ?? "")
              .filter((t) => t.length > 0)
              .join(" ");
            if (directText) {
              node.text = directText;
            }

            if (includeStyles) {
              try {
                const computed = window.getComputedStyle(el);
                const STYLES = [
                  "display",
                  "position",
                  "top",
                  "right",
                  "bottom",
                  "left",
                  "width",
                  "height",
                  "margin-top",
                  "margin-right",
                  "margin-bottom",
                  "margin-left",
                  "padding-top",
                  "padding-right",
                  "padding-bottom",
                  "padding-left",
                  "border-width",
                  "border-style",
                  "border-color",
                  "background-color",
                  "color",
                  "font-size",
                  "font-weight",
                  "font-family",
                  "text-align",
                  "line-height",
                  "z-index",
                  "overflow",
                  "opacity",
                  "visibility",
                  "flex-direction",
                  "justify-content",
                  "align-items",
                  "gap",
                ];
                const styles: Record<string, string> = {};
                for (const prop of STYLES) {
                  const val = computed.getPropertyValue(prop);
                  if (val && val !== "initial" && val !== "") {
                    styles[prop] = val;
                  }
                }
                if (Object.keys(styles).length > 0) {
                  node.computedStyles = styles;
                }
              } catch {
                // Some elements may throw
              }
            }

            if (depth < maxDepth) {
              const childNodes: DomNode[] = [];
              for (const child of Array.from(el.children)) {
                const childTag = child.tagName.toLowerCase();
                if (childTag === "script" || childTag === "style") continue;
                childNodes.push(walk(child, depth + 1));
              }
              if (childNodes.length > 0) {
                node.children = childNodes;
              }
            } else if (el.children.length > 0) {
              node.children = [
                {
                  tag: "...",
                  text: `(${el.children.length} children omitted — max depth reached)`,
                },
              ];
            }

            return node;
          }

          // Count total nodes
          function countNodes(n: DomNode): number {
            let count = 1;
            if (n.children) {
              for (const c of n.children) count += countNodes(c);
            }
            return count;
          }

          const tree = walk(root, 0);
          const nodeCount = countNodes(tree);

          return { tree, nodeCount, finalUrl: window.location.href };
        },
        {
          selector: args.selector,
          maxDepth,
          includeStyles,
        },
      );

      // Serialize the DOM tree to XML
      const serialized = serializeDomTree(domTree.tree);

      // Truncate if too large
      const truncated = smartTruncateSafe(serialized, MAX_OUTPUT_LENGTH);

      const finalUrl = domTree.finalUrl;
      const nodeCount = domTree.nodeCount;

      logger.log(
        `DOM snapshot complete: ${nodeCount} nodes, ${truncated.length} chars, url=${finalUrl}`,
      );

      const attrs = buildAttributes(args, { url: finalUrl, nodeCount });

      ctx.onXmlComplete(
        `<dyad-dom-snapshot ${attrs}>\n${truncated}\n</dyad-dom-snapshot>`,
      );

      // Return a summary with the full output embedded in the XML
      const summary = [
        `DOM Snapshot captured successfully.`,
        `URL: ${finalUrl}`,
        `Nodes: ${nodeCount}`,
        `Depth: ${maxDepth}`,
        args.selector ? `Selector: ${args.selector}` : "Scope: full page",
        includeStyles ? "Includes computed styles" : "",
      ]
        .filter(Boolean)
        .join("\n");

      return truncated.length < serialized.length
        ? `${summary}\n\n[Output truncated — full tree in XML above]\n\n${truncated}`
        : `${summary}\n\n${truncated}`;
    } catch (error) {
      if (error instanceof DyadError) {
        ctx.onXmlComplete(
          `<dyad-dom-snapshot ${buildAttributes(args)} />\n<dyad-error kind="${error.kind}">${escapeXmlContent(error.message)}</dyad-error>`,
        );
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);

      // Handle specific Playwright / navigation errors
      if (message.includes("Selector") && message.includes("did not match")) {
        ctx.onXmlComplete(
          `<dyad-dom-snapshot ${buildAttributes(args)} />\n<dyad-error kind="not_found">${escapeXmlContent(message)}</dyad-error>`,
        );
        throw new DyadError(message, DyadErrorKind.NotFound);
      }

      if (
        message.includes("net::ERR_") ||
        message.includes("Navigation failed") ||
        message.includes("Timeout")
      ) {
        ctx.onXmlComplete(
          `<dyad-dom-snapshot ${buildAttributes(args)} />\n<dyad-error kind="external">${escapeXmlContent(`Navigation failed: ${message}`)}</dyad-error>`,
        );
        throw new DyadError(
          `Navigation failed: ${message}`,
          DyadErrorKind.External,
        );
      }

      ctx.onXmlComplete(
        `<dyad-dom-snapshot ${buildAttributes(args)} />\n<dyad-error kind="unknown">${escapeXmlContent(`DOM snapshot failed: ${message}`)}</dyad-error>`,
      );
      throw new DyadError(
        `DOM snapshot failed: ${message}`,
        DyadErrorKind.Unknown,
      );
    } finally {
      // Browser is managed by the shared session — no cleanup needed here
    }
  },
};
