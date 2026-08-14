import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import crypto from "node:crypto";
import log from "electron-log";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { DYAD_MEDIA_DIR_NAME } from "@/ipc/utils/media_path_utils";

const logger = log.scope("browser_control");

// ============================================================================
// Schema
// ============================================================================

const navigateAction = z.object({
  action: z.literal("navigate"),
  url: z.string().describe("URL to navigate to"),
});

const clickAction = z.object({
  action: z.literal("click"),
  selector: z
    .string()
    .describe(
      "CSS selector for the element to click (e.g. 'button.submit', '#login', 'a[href=\"/about\"]')",
    ),
  wait_ms: z
    .number()
    .optional()
    .describe("Milliseconds to wait after clicking before returning"),
});

const typeAction = z.object({
  action: z.literal("type"),
  selector: z
    .string()
    .describe("CSS selector for the input element to type into"),
  text: z.string().describe("Text to type into the input"),
});

const scrollAction = z.object({
  action: z.literal("scroll"),
  direction: z
    .enum(["up", "down", "left", "right"])
    .describe("Direction to scroll"),
  amount: z
    .number()
    .optional()
    .describe("Number of pixels to scroll (default: 500)"),
});

const screenshotAction = z.object({
  action: z.literal("screenshot"),
  full_page: z
    .boolean()
    .optional()
    .describe(
      "If true, capture the full scrollable page (default: viewport only)",
    ),
});

const getTextAction = z.object({
  action: z.literal("get_text"),
  selector: z
    .string()
    .describe("CSS selector for the element to read text from"),
});

const waitForAction = z.object({
  action: z.literal("wait_for"),
  selector: z.string().describe("CSS selector for the element to wait for"),
  timeout_ms: z
    .number()
    .optional()
    .describe("Maximum time to wait in milliseconds (default: 10000)"),
});

const readPageAction = z.object({
  action: z.literal("read_page"),
  mode: z
    .enum(["interactive", "all", "viewport"])
    .optional()
    .describe(
      "Which elements to include: interactive (default, forms+links+buttons), all (full DOM), viewport (visible only)",
    ),
  depth: z
    .number()
    .min(1)
    .max(20)
    .optional()
    .describe("Maximum DOM tree depth (default: 5, max: 20)"),
});

const batchAction = z.object({
  action: z.literal("batch"),
  steps: z
    .array(
      z.object({
        action: z.string().describe("Action to perform (navigate, click, type, scroll, screenshot, get_text, wait_for, read_page)"),
        params: z
          .record(z.string(), z.unknown())
          .describe("Parameters for the action"),
      }),
    )
    .min(1)
    .max(20)
    .describe("Ordered list of actions to execute sequentially"),
});

const browserControlSchema = z.discriminatedUnion("action", [
  navigateAction,
  clickAction,
  typeAction,
  scrollAction,
  screenshotAction,
  getTextAction,
  waitForAction,
  readPageAction,
  batchAction,
]);

type BrowserControlArgs = z.infer<typeof browserControlSchema>;

// ============================================================================
// Description
// ============================================================================

const DESCRIPTION = `Control a browser to interact with web pages — click, type, scroll, navigate, take screenshots, read page structure. Use for verifying UI changes, testing web apps, and interacting with live pages.

### Supported Actions

- **navigate** — Go to a URL. Provide \`url\`.
- **click** — Click an element by CSS selector. Provide \`selector\`. Optional \`wait_ms\` to pause after click.
- **type** — Type text into an input field. Provide \`selector\` and \`text\`.
- **scroll** — Scroll the page in a direction. Provide \`direction\` (up/down/left/right). Optional \`amount\` in pixels (default 500).
- **screenshot** — Take a screenshot and save it to the project's .dyad/media directory. Optional \`full_page\` to capture the entire scrollable page.
- **get_text** — Get the visible text content of an element. Provide \`selector\`.
- **wait_for** — Wait for an element to appear in the DOM. Provide \`selector\`. Optional \`timeout_ms\` (default 10000).
- **read_page** — Get a structured representation of the page with interactive elements (forms, links, buttons) labeled with stable refs. Provide \`mode\` (interactive/all/viewport). Optional \`depth\` (default 5).
- **batch** — Execute multiple actions sequentially. Provide \`steps\` array with {action, params} objects. Max 20 steps.

### When to Use
- Verifying that a UI change renders correctly in a real browser
- Testing a local dev server or deployed web app interactively
- Taking screenshots of pages for visual documentation
- Automating form filling or navigation flows for testing

### Notes
- A fresh headless Chromium browser is launched and closed for each invocation.
- Screenshots are saved to .dyad/media/ and the file path is returned.
- CSS selectors must match exactly one visible element for click/type/get_text actions.
`;

// ============================================================================
// Playwright Helpers
// ============================================================================

type PlaywrightBrowser = Awaited<
  ReturnType<typeof import("playwright").chromium.launch>
>;
type PlaywrightPage = Awaited<ReturnType<PlaywrightBrowser["newPage"]>>;

async function launchBrowser(): Promise<PlaywrightBrowser> {
  const { chromium } = await import("playwright");
  return chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

async function saveScreenshot(
  screenshotBuffer: Buffer,
  appPath: string,
): Promise<string> {
  const mediaDir = path.join(appPath, DYAD_MEDIA_DIR_NAME);
  await fs.mkdir(mediaDir, { recursive: true });

  const hash = crypto.randomBytes(8).toString("hex");
  const timestamp = Date.now();
  const fileName = `screenshot-${timestamp}-${hash}.png`;
  const filePath = path.join(mediaDir, fileName);
  const relativePath = path.join(DYAD_MEDIA_DIR_NAME, fileName);

  await fs.writeFile(filePath, screenshotBuffer);
  return relativePath;
}

function validateHttpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DyadError(`Invalid URL: ${url}`, DyadErrorKind.Validation);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DyadError(
      `Unsupported URL scheme "${parsed.protocol}" — only http and https are allowed`,
      DyadErrorKind.Validation,
    );
  }
}

// ============================================================================
// Action Executors
// ============================================================================

async function executeNavigate(
  page: PlaywrightPage,
  args: z.infer<typeof navigateAction>,
): Promise<string> {
  validateHttpUrl(args.url);
  const response = await page.goto(args.url, { waitUntil: "domcontentloaded" });
  const status = response?.status() ?? "unknown";
  const title = await page.title();
  return `Navigated to ${args.url} (status: ${status}, title: "${title}")`;
}

async function executeClick(
  page: PlaywrightPage,
  args: z.infer<typeof clickAction>,
): Promise<string> {
  const element = await page.$(args.selector);
  if (!element) {
    throw new DyadError(
      `No element found matching selector: ${args.selector}`,
      DyadErrorKind.NotFound,
    );
  }
  await element.click();
  if (args.wait_ms && args.wait_ms > 0) {
    await page.waitForTimeout(args.wait_ms);
  }
  return `Clicked element matching selector: ${args.selector}`;
}

async function executeType(
  page: PlaywrightPage,
  args: z.infer<typeof typeAction>,
): Promise<string> {
  const element = await page.$(args.selector);
  if (!element) {
    throw new DyadError(
      `No element found matching selector: ${args.selector}`,
      DyadErrorKind.NotFound,
    );
  }
  await element.fill(args.text);
  return `Typed text into element matching selector: ${args.selector}`;
}

const SCROLL_PIXELS: Record<string, [number, number]> = {
  up: [0, -500],
  down: [0, 500],
  left: [-500, 0],
  right: [500, 0],
};

async function executeScroll(
  page: PlaywrightPage,
  args: z.infer<typeof scrollAction>,
): Promise<string> {
  const base = SCROLL_PIXELS[args.direction] ?? [0, 0];
  const amount = args.amount ?? 500;
  const scale = amount / 500;
  const deltaX = base[0] * scale;
  const deltaY = base[1] * scale;

  await page.mouse.wheel(deltaX, deltaY);
  // Brief pause so the browser paints the scrolled position
  await page.waitForTimeout(200);
  return `Scrolled ${args.direction} by ${amount}px`;
}

async function executeScreenshot(
  page: PlaywrightPage,
  args: z.infer<typeof screenshotAction>,
  ctx: AgentContext,
): Promise<string> {
  const screenshotBuffer = await page.screenshot({
    fullPage: args.full_page ?? false,
    type: "png",
  });

  const relativePath = await saveScreenshot(screenshotBuffer, ctx.appPath);

  // Append the image as a user message so the model can see it
  ctx.appendUserMessage([
    { type: "text", text: `Screenshot saved to ${relativePath}` },
  ]);

  return `Screenshot saved to: ${relativePath}`;
}

async function executeGetText(
  page: PlaywrightPage,
  args: z.infer<typeof getTextAction>,
): Promise<string> {
  const element = await page.$(args.selector);
  if (!element) {
    throw new DyadError(
      `No element found matching selector: ${args.selector}`,
      DyadErrorKind.NotFound,
    );
  }
  const text = await element.textContent();
  if (text === null) {
    throw new DyadError(
      `Could not read text content from selector: ${args.selector}`,
      DyadErrorKind.NotFound,
    );
  }
  return text.trim();
}

async function executeWaitFor(
  page: PlaywrightPage,
  args: z.infer<typeof waitForAction>,
): Promise<string> {
  const timeout = args.timeout_ms ?? 10000;
  try {
    await page.waitForSelector(args.selector, { timeout });
    return `Element matching selector "${args.selector}" appeared within ${timeout}ms`;
  } catch {
    throw new DyadError(
      `Timed out waiting for element matching selector: ${args.selector} (timeout: ${timeout}ms)`,
      DyadErrorKind.External,
    );
  }
}

async function executeReadPage(
  page: PlaywrightPage,
  args: z.infer<typeof readPageAction>,
): Promise<string> {
  const mode = args.mode ?? "interactive";
  const depth = Math.min(args.depth ?? 5, 20);

  const tree = await page.evaluate(
    ({ mode, depth }: { mode: string; depth: number }) => {
      interface RefNode {
        ref: number;
        tag: string;
        role?: string;
        text?: string;
        href?: string;
        type?: string;
        placeholder?: string;
        checked?: boolean;
        children?: RefNode[];
      }

      let refCounter = 0;
      const interactiveTags = new Set([
        "A",
        "BUTTON",
        "INPUT",
        "SELECT",
        "TEXTAREA",
        "DETAILS",
        "SUMMARY",
      ]);
      const interactiveRoles = new Set([
        "button",
        "link",
        "textbox",
        "combobox",
        "checkbox",
        "radio",
        "tab",
        "menuitem",
        "option",
      ]);

      function walk(el: Element, currentDepth: number): RefNode | null {
        if (currentDepth > depth) return null;

        const tag = el.tagName?.toLowerCase();
        const role = el.getAttribute("role");
        const isVisible =
          el instanceof HTMLElement &&
          el.offsetParent !== null &&
          getComputedStyle(el).display !== "none";

        if (!isVisible && mode === "viewport") return null;

        const isInteractive =
          interactiveTags.has(el.tagName) ||
          (role && interactiveRoles.has(role));

        if (mode === "interactive" && !isInteractive) {
          // Still walk children to find nested interactive elements
          const children: RefNode[] = [];
          for (const child of el.children) {
            const childNode = walk(child, currentDepth + 1);
            if (childNode) children.push(childNode);
          }
          return children.length > 0 ? { ref: -1, tag, children } : null;
        }

        const ref = ++refCounter;
        const node: RefNode = { ref, tag };

        if (role) node.role = role;
        if (el instanceof HTMLElement) {
          const text = el.innerText?.trim().slice(0, 100);
          if (text) node.text = text;
        }
        if (el.hasAttribute("href"))
          node.href = el.getAttribute("href") ?? undefined;
        if (el.hasAttribute("type"))
          node.type = el.getAttribute("type") ?? undefined;
        if (el.hasAttribute("placeholder"))
          node.placeholder = el.getAttribute("placeholder") ?? undefined;
        if (el instanceof HTMLInputElement)
          node.checked = el.checked;

        const children: RefNode[] = [];
        for (const child of el.children) {
          const childNode = walk(child, currentDepth + 1);
          if (childNode) children.push(childNode);
        }
        if (children.length > 0) node.children = children;

        return node;
      }

      const body = document.body;
      const result: RefNode[] = [];
      for (const child of body.children) {
        const node = walk(child, 0);
        if (node) result.push(node);
      }
      return { refs: refCounter, tree: result };
    },
    { mode, depth },
  );

  const formatNode = (node: any, indent = 0): string => {
    const pad = "  ".repeat(indent);
    const parts = [`[${node.ref}] <${node.tag}>`];
    if (node.role) parts.push(`role="${node.role}"`);
    if (node.text) parts.push(`"${node.text.slice(0, 60)}"`);
    if (node.href) parts.push(`href="${node.href}"`);
    if (node.type) parts.push(`type="${node.type}"`);
    if (node.placeholder) parts.push(`placeholder="${node.placeholder}"`);
    if (node.checked !== undefined) parts.push(`checked=${node.checked}`);

    let result = pad + parts.join(" ");
    if (node.children) {
      for (const child of node.children) {
        result += "\n" + formatNode(child, indent + 1);
      }
    }
    return result;
  };

  const lines = tree.tree.map((n) => formatNode(n)).join("\n");
  return `Page structure (${tree.refs} interactive elements, mode: ${mode}):\n\n${lines}`;
}

async function executeBatch(
  page: PlaywrightPage,
  args: z.infer<typeof batchAction>,
  ctx: AgentContext,
): Promise<string> {
  const results: string[] = [];

  for (let i = 0; i < args.steps.length; i++) {
    const step = args.steps[i];
    const actionName = step.action;
    const params = step.params;

    ctx.onXmlStream(
      `<dyad-browser action="batch" step="${i + 1}/${args.steps.length}" subaction="${escapeXmlAttr(actionName)}">`,
    );

    try {
      let result: string;
      switch (actionName) {
        case "navigate":
          result = await executeNavigate(page, params as any);
          break;
        case "click":
          result = await executeClick(page, params as any);
          break;
        case "type":
          result = await executeType(page, params as any);
          break;
        case "scroll":
          result = await executeScroll(page, params as any);
          break;
        case "screenshot":
          result = await executeScreenshot(page, params as any, ctx);
          break;
        case "get_text":
          result = await executeGetText(page, params as any);
          break;
        case "wait_for":
          result = await executeWaitFor(page, params as any);
          break;
        case "read_page":
          result = await executeReadPage(page, params as any);
          break;
        default:
          result = `Unknown action: ${actionName}`;
      }
      results.push(`[${i + 1}/${args.steps.length}] ${actionName}: ${result}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      results.push(`[${i + 1}/${args.steps.length}] ${actionName}: ERROR - ${msg}`);
      // Continue with remaining steps
    }

    // Random delay between actions (100-200ms) to appear more natural
    if (i < args.steps.length - 1) {
      await page.waitForTimeout(100 + Math.random() * 100);
    }
  }

  return results.join("\n");
}

// ============================================================================
// Tool Definition
// ============================================================================

export const browserControlTool: ToolDefinition<BrowserControlArgs> = {
  name: "browser_control",
  description: DESCRIPTION,
  inputSchema: browserControlSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    switch (args.action) {
      case "navigate":
        return `Navigate browser to: "${args.url}"`;
      case "click":
        return `Click element: "${args.selector}"`;
      case "type":
        return `Type into "${args.selector}": "${args.text}"`;
      case "scroll":
        return `Scroll ${args.direction} by ${args.amount ?? 500}px`;
      case "screenshot":
        return `Take ${args.full_page ? "full-page " : ""}screenshot`;
      case "get_text":
        return `Get text from: "${args.selector}"`;
      case "wait_for":
        return `Wait for element: "${args.selector}"`;
      case "read_page":
        return `Read page structure (${args.mode ?? "interactive"} mode)`;
      case "batch":
        return `Execute ${args.steps.length} browser actions sequentially`;
    }
  },

  buildXml: (args, isComplete) => {
    if (!args.action) return undefined;
    if (isComplete) return undefined;

    switch (args.action) {
      case "navigate":
        if (!args.url) return undefined;
        return `<dyad-browser action="navigate" url="${escapeXmlAttr(args.url)}">`;
      case "click":
        if (!args.selector) return undefined;
        return `<dyad-browser action="click" selector="${escapeXmlAttr(args.selector)}">`;
      case "type":
        if (!args.selector || !args.text) return undefined;
        return `<dyad-browser action="type" selector="${escapeXmlAttr(args.selector)}">`;
      case "scroll":
        return `<dyad-browser action="scroll" direction="${escapeXmlAttr(args.direction)}">`;
      case "screenshot":
        return `<dyad-browser action="screenshot">`;
      case "get_text":
        if (!args.selector) return undefined;
        return `<dyad-browser action="get_text" selector="${escapeXmlAttr(args.selector)}">`;
      case "wait_for":
        if (!args.selector) return undefined;
        return `<dyad-browser action="wait_for" selector="${escapeXmlAttr(args.selector)}">`;
      case "read_page":
        return `<dyad-browser action="read_page" mode="${escapeXmlAttr(args.mode ?? "interactive")}">`;
      case "batch":
        return `<dyad-browser action="batch" steps="${args.steps?.length ?? 0}">`;
    }
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Executing browser_control: ${args.action}`);

    // Build initial XML based on action
    let initialXml: string;
    switch (args.action) {
      case "navigate":
        initialXml = `<dyad-browser action="navigate" url="${escapeXmlAttr(args.url)}">`;
        break;
      case "click":
        initialXml = `<dyad-browser action="click" selector="${escapeXmlAttr(args.selector)}">`;
        break;
      case "type":
        initialXml = `<dyad-browser action="type" selector="${escapeXmlAttr(args.selector)}" text="${escapeXmlAttr(args.text)}">`;
        break;
      case "scroll":
        initialXml = `<dyad-browser action="scroll" direction="${escapeXmlAttr(args.direction)}">`;
        break;
      case "screenshot":
        initialXml = `<dyad-browser action="screenshot">`;
        break;
      case "get_text":
        initialXml = `<dyad-browser action="get_text" selector="${escapeXmlAttr(args.selector)}">`;
        break;
      case "wait_for":
        initialXml = `<dyad-browser action="wait_for" selector="${escapeXmlAttr(args.selector)}">`;
        break;
      case "read_page":
        initialXml = `<dyad-browser action="read_page" mode="${escapeXmlAttr(args.mode ?? "interactive")}">`;
        break;
      case "batch":
        initialXml = `<dyad-browser action="batch" steps="${args.steps.length}">`;
        break;
    }

    ctx.onXmlStream(initialXml);

    let browser: PlaywrightBrowser | undefined;
    try {
      browser = await launchBrowser();
      const page = await browser.newPage();

      let result: string;

      switch (args.action) {
        case "navigate":
          result = await executeNavigate(page, args);
          break;
        case "click":
          result = await executeClick(page, args);
          break;
        case "type":
          result = await executeType(page, args);
          break;
        case "scroll":
          result = await executeScroll(page, args);
          break;
        case "screenshot":
          result = await executeScreenshot(page, args, ctx);
          break;
        case "get_text":
          result = await executeGetText(page, args);
          break;
        case "wait_for":
          result = await executeWaitFor(page, args);
          break;
        case "read_page":
          result = await executeReadPage(page, args);
          break;
        case "batch":
          result = await executeBatch(page, args, ctx);
          break;
      }

      logger.log(`browser_control completed: ${args.action}`);

      ctx.onXmlComplete(
        `<dyad-browser action="${escapeXmlAttr(args.action)}">${escapeXmlContent(result)}</dyad-browser>`,
      );

      return result;
    } catch (error) {
      ctx.onXmlComplete(
        `<dyad-browser action="${escapeXmlAttr(args.action)}"></dyad-browser>`,
      );
      throw error;
    } finally {
      if (browser) {
        await browser.close().catch((closeErr) => {
          logger.warn("Failed to close browser:", closeErr);
        });
      }
    }
  },
};
