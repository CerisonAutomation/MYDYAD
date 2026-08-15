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
import { DYAD_SCREENSHOT_DIR_NAME } from "@/ipc/utils/media_path_utils";
import { getPage, resolveTargetUrl, waitForPageReady } from "./browser_session";
import { resolveTargetAppPath } from "./resolve_app_context";
import type { Page, Browser } from "playwright";

const logger = log.scope("browser_control");

// ============================================================================
// Schema
// ============================================================================

const navigateAction = z.object({
  action: z.literal("navigate"),
  url: z
    .string()
    .optional()
    .describe(
      "URL to navigate to (optional — defaults to the running app's preview URL)",
    ),
});

const clickAction = z.object({
  action: z.literal("click"),
  selector: z
    .string()
    .optional()
    .describe(
      "CSS selector for the element to click (e.g. 'button.submit', '#login', 'a[href=\"/about\"]'). Alternative to ref.",
    ),
  ref: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Stable ref number from a prior read_page call (e.g. [3] <button>). Alternative to selector — use when the page was just read.",
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
    .optional()
    .describe(
      "CSS selector for the input element to type into. Alternative to ref.",
    ),
  ref: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Stable ref number from a prior read_page call. Alternative to selector.",
    ),
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
    .optional()
    .describe(
      "CSS selector for the element to read text from. Alternative to ref.",
    ),
  ref: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Stable ref number from a prior read_page call. Alternative to selector.",
    ),
});

const waitForAction = z.object({
  action: z.literal("wait_for"),
  selector: z
    .string()
    .optional()
    .describe("CSS selector for the element to wait for. Alternative to ref."),
  ref: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Stable ref number from a prior read_page call. Alternative to selector.",
    ),
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
        action: z
          .string()
          .describe(
            "Action to perform (navigate, click, type, scroll, screenshot, get_text, wait_for, read_page)",
          ),
        params: z
          .record(z.string(), z.unknown())
          .describe("Parameters for the action"),
      }),
    )
    .min(1)
    .max(20)
    .describe("Ordered list of actions to execute sequentially"),
});

const locatorSchema = z.object({
  text: z
    .string()
    .optional()
    .describe("Visible text content to locate element"),
  role: z
    .string()
    .optional()
    .describe("ARIA role (e.g., button, link, textbox)"),
  label: z.string().optional().describe("Form label text"),
  placeholder: z.string().optional().describe("Input placeholder text"),
  selector: z.string().optional().describe("CSS selector"),
  testId: z.string().optional().describe("data-testid attribute value"),
  nth: z.number().optional().describe("Zero-based index when multiple matches"),
  exact: z.boolean().optional().describe("Exact text match (default: false)"),
});

type Locator = z.infer<typeof locatorSchema>;

const formDataAction = z.object({
  action: z.literal("form_data"),
  selector: z.string().describe("CSS selector for the form"),
});

const fillFormAction = z.object({
  action: z.literal("fill_form"),
  selector: z.string().describe("CSS selector for the form"),
  data: z
    .record(z.string(), z.string())
    .describe("Form field values as name-value pairs"),
});

const submitFormAction = z.object({
  action: z.literal("submit_form"),
  selector: z.string().describe("CSS selector for the form"),
});

const validateFormAction = z.object({
  action: z.literal("validate_form"),
  selector: z.string().describe("CSS selector for the form"),
});

const frameIframeAction = z.object({
  action: z.literal("frame_iframe"),
  selector: z.string().describe("CSS selector for the frame/iframe element"),
  inner_selector: z
    .string()
    .optional()
    .describe("CSS selector for element inside the frame"),
  action_type: z
    .enum(["click", "type", "get_text", "screenshot"])
    .describe("Action to perform inside the frame"),
  text: z.string().optional().describe("Text to type (if action_type is type)"),
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
  formDataAction,
  fillFormAction,
  submitFormAction,
  validateFormAction,
  frameIframeAction,
]);

type BrowserControlArgs = z.infer<typeof browserControlSchema>;

// ============================================================================
// Description
// ============================================================================

const DESCRIPTION = `Control a browser to interact with web pages — click, type, scroll, navigate, take screenshots, read page structure. Use for verifying UI changes, testing web apps, and interacting with live pages.

### Supported Actions

- **navigate** — Go to a URL. Provide \`url\` (optional — defaults to the running app's preview URL).
- **click** — Click an element. Provide \`selector\` (CSS) **or** \`ref\` (a stable ref number from read_page, e.g. \`[3] <button>\`). Optional \`wait_ms\` to pause after click.
- **type** — Type text into an input field. Provide \`selector\` **or** \`ref\` plus \`text\`.
- **scroll** — Scroll the page in a direction. Provide \`direction\` (up/down/left/right). Optional \`amount\` in pixels (default 500).
- **screenshot** — Take a screenshot and save it to the project's .dyad/media directory. Optional \`full_page\` to capture the entire scrollable page.
- **get_text** — Get the visible text content of an element. Provide \`selector\` **or** \`ref\`.
- **wait_for** — Wait for an element to appear in the DOM. Provide \`selector\` **or** \`ref\`. Optional \`timeout_ms\` (default 10000).
- **read_page** — Get a structured representation of the page with interactive elements (forms, links, buttons) labeled with stable refs. Provide \`mode\` (interactive/all/viewport). Optional \`depth\` (default 5).
- **batch** — Execute multiple actions sequentially. Provide \`steps\` array with {action, params} objects. Max 20 steps.

### Canonical Read → Act Loop
1. Call \`read_page\` to get the page structure with refs like \`[3] <button> "Sign in"\`.
2. Act on elements by \`ref\` (\`{action: "click", ref: 3}\`) — no need to guess CSS selectors.
3. If the page changed (navigation, dynamic render), call \`read_page\` again before acting.

### When to Use
- Verifying that a UI change renders correctly in a real browser
- Testing a local dev server or deployed web app interactively
- Taking screenshots of pages for visual documentation
- Automating form filling or navigation flows for testing

### Notes
- A persistent shared headless Chromium session is reused across calls (not launched per invocation). The browser auto-closes after 5 minutes of inactivity and on app quit.
- Screenshots are saved to .dyad/media/ and the file path is returned.
- Actions accept either a CSS \`selector\` or a \`ref\` from a recent \`read_page\` call. Refs are positional — re-read the page after any navigation.
- \`batch\` steps may omit \`url\` for \`navigate\` — it defaults to the running app's preview URL.
`;

// ============================================================================
// ============================================================================
type PlaywrightPage = Awaited<
  ReturnType<import("playwright").Browser["newPage"]>
>;

// Form Workflow Helpers
// ============================================================================

async function executeFormData(
  page: PlaywrightPage,
  args: z.infer<typeof formDataAction>,
): Promise<string> {
  if (!args.selector) {
    throw new DyadError(
      "form_data requires a 'selector' parameter. Provide a CSS selector to identify the form.",
      DyadErrorKind.Validation,
    );
  }
  const form = page.locator(args.selector);
  const fields = await form.locator("input, select, textarea").all();
  const formData: Record<string, string> = {};

  for (const field of fields) {
    const name = await field.getAttribute("name");
    const type = await field.getAttribute("type");
    const value = await field.inputValue().catch(() => "");
    if (name) {
      formData[name] = type === "password" ? "[hidden]" : value;
    }
  }

  return JSON.stringify(formData, null, 2);
}

async function executeFillForm(
  page: PlaywrightPage,
  args: z.infer<typeof fillFormAction>,
): Promise<string> {
  if (!args.selector) {
    throw new DyadError(
      "fill_form requires a 'selector' parameter. Provide a CSS selector to identify the form.",
      DyadErrorKind.Validation,
    );
  }
  const form = page.locator(args.selector);
  const filled: string[] = [];

  for (const [name, value] of Object.entries(args.data)) {
    const field = form.locator(`[name="${name}"]`);
    const count = await field.count();
    if (count === 0) {
      filled.push(`⚠ Field '${name}' not found`);
      continue;
    }

    const tagName = await field.evaluate((el) => el.tagName.toLowerCase());
    if (tagName === "select") {
      await field.selectOption(value);
    } else {
      await field.fill(value);
    }
    filled.push(`✓ ${name} = ${value}`);
  }

  return filled.join("\n");
}

async function executeSubmitForm(
  page: PlaywrightPage,
  args: z.infer<typeof submitFormAction>,
): Promise<string> {
  if (!args.selector) {
    throw new DyadError(
      "submit_form requires a 'selector' parameter. Provide a CSS selector to identify the form.",
      DyadErrorKind.Validation,
    );
  }
  const form = page.locator(args.selector);
  const submitBtn = form.locator("button[type=submit], input[type=submit]");
  const count = await submitBtn.count();

  if (count > 0) {
    await submitBtn.first().click();
    return "Form submitted via submit button";
  }

  await form.evaluate((el) => {
    if (el instanceof HTMLFormElement) {
      el.requestSubmit();
    }
  });
  return "Form submitted via requestSubmit()";
}

async function executeValidateForm(
  page: PlaywrightPage,
  args: z.infer<typeof validateFormAction>,
): Promise<string> {
  if (!args.selector) {
    throw new DyadError(
      "validate_form requires a 'selector' parameter. Provide a CSS selector to identify the form.",
      DyadErrorKind.Validation,
    );
  }
  const form = page.locator(args.selector);
  const fields = await form.locator("input, select, textarea").all();
  const issues: string[] = [];

  for (const field of fields) {
    const name = (await field.getAttribute("name")) || "unknown";
    const required = await field.getAttribute("required");
    const value = await field.inputValue().catch(() => "");
    const type = await field.getAttribute("type");

    if (required !== null && !value.trim()) {
      issues.push(`❌ ${name}: required but empty`);
    }

    if (
      type === "email" &&
      value &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ) {
      issues.push(`❌ ${name}: invalid email format`);
    }

    if (type === "url" && value && !/^https?:\/\//.test(value)) {
      issues.push(`❌ ${name}: invalid URL format`);
    }

    if (type === "number" && value && isNaN(Number(value))) {
      issues.push(`❌ ${name}: not a valid number`);
    }
  }

  if (issues.length === 0) {
    return "✅ All form fields pass validation";
  }

  return `Validation issues:\n${issues.join("\n")}`;
}

// Playwright Helpers
// ============================================================================

async function saveScreenshot(
  screenshotBuffer: Buffer,
  appPath: string,
): Promise<string> {
  const mediaDir = path.join(appPath, DYAD_SCREENSHOT_DIR_NAME);
  await fs.mkdir(mediaDir, { recursive: true });

  const hash = crypto.randomBytes(8).toString("hex");
  const timestamp = Date.now();
  const fileName = `screenshot-${timestamp}-${hash}.png`;
  const filePath = path.join(mediaDir, fileName);
  const relativePath = path.join(DYAD_SCREENSHOT_DIR_NAME, fileName);

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
// Element Resolution (selector | ref)
// ============================================================================

/**
 * Resolve an action target to a CSS selector.
 *
 * If \`ref\` is provided, the interactive elements are stamped in document
 * order with data-dyad-ref attributes using the SAME walk as read_page, so
 * refs from a recent read_page call map 1:1 to elements. Stamping is
 * re-run on every call so refs always reflect the current DOM.
 */
async function resolveTargetSelector(
  page: PlaywrightPage,
  args: { selector?: string; ref?: number; mode?: string },
): Promise<string> {
  if (args.selector) return args.selector;
  if (args.ref !== undefined) {
    const ref = args.ref;
    const visibleOnly = args.mode === "viewport";
    await page.evaluate(
      (opts: { targetRef: number; visibleOnly: boolean }) => {
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
        // Clear previous stamps, then re-stamp in document order using the
        // SAME numbering rules as read_page (interactive-only, optional
        // visibility filter) so refs map 1:1.
        document
          .querySelectorAll("[data-dyad-ref]")
          .forEach((el) => el.removeAttribute("data-dyad-ref"));
        let counter = 0;
        const walk = (el: Element): void => {
          const role = el.getAttribute("role");
          const isInteractive =
            interactiveTags.has(el.tagName) ||
            (role !== null && interactiveRoles.has(role));
          if (isInteractive) {
            const isVisible =
              el instanceof HTMLElement
                ? (() => {
                    const style = getComputedStyle(el);
                    return (
                      style.display !== "none" && style.visibility !== "hidden"
                    );
                  })()
                : true;
            if (!opts.visibleOnly || isVisible) {
              counter += 1;
              el.setAttribute("data-dyad-ref", String(counter));
            }
          }
          for (const child of Array.from(el.children)) walk(child);
        };
        for (const child of Array.from(document.body.children)) walk(child);
      },
      { targetRef: ref, visibleOnly },
    );

    const stamped = await page.$(`[data-dyad-ref="${ref}"]`);
    if (!stamped) {
      throw new DyadError(
        `No element with ref [${ref}] found. The page may have changed since read_page — call read_page again.`,
        DyadErrorKind.NotFound,
      );
    }
    return `[data-dyad-ref="${ref}"]`;
  }
  throw new DyadError(
    "Either 'selector' or 'ref' must be provided",
    DyadErrorKind.Validation,
  );
}

// ============================================================================
// Action Executors
// ============================================================================

async function executeNavigate(
  page: PlaywrightPage,
  url: string,
): Promise<string> {
  validateHttpUrl(url);
  // waitForPageReady performs the navigation and waits for network idle;
  // it returns the HTTP response so we don't navigate twice.
  const response = await waitForPageReady(page, url);
  const status = response?.status() ?? "unknown";
  const title = await page.title();
  return `Navigated to ${url} (status: ${status}, title: "${title}")`;
}

async function executeClick(
  page: PlaywrightPage,
  args: z.infer<typeof clickAction>,
): Promise<string> {
  const selector = await resolveTargetSelector(page, args);
  const element = await page.$(selector);
  if (!element) {
    throw new DyadError(
      `No element found matching selector: ${selector}`,
      DyadErrorKind.NotFound,
    );
  }
  await element.click();
  if (args.wait_ms && args.wait_ms > 0) {
    await page.waitForTimeout(args.wait_ms);
  }
  return `Clicked element matching: ${selector}`;
}

async function executeType(
  page: PlaywrightPage,
  args: z.infer<typeof typeAction>,
): Promise<string> {
  const selector = await resolveTargetSelector(page, args);
  const element = await page.$(selector);
  if (!element) {
    throw new DyadError(
      `No element found matching selector: ${selector}`,
      DyadErrorKind.NotFound,
    );
  }
  await element.fill(args.text);
  return `Typed text into element matching: ${selector}`;
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
  const amount = Number(args.amount ?? 500);
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
    fullPage:
      String(args.full_page ?? "false") === "true" || args.full_page === true,
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
  const selector = await resolveTargetSelector(page, args);
  const element = await page.$(selector);
  if (!element) {
    throw new DyadError(
      `No element found matching selector: ${selector}`,
      DyadErrorKind.NotFound,
    );
  }
  const text = await element.textContent();
  if (text === null) {
    throw new DyadError(
      `Could not read text content from selector: ${selector}`,
      DyadErrorKind.NotFound,
    );
  }
  return text.trim();
}

async function executeWaitFor(
  page: PlaywrightPage,
  args: z.infer<typeof waitForAction>,
): Promise<string> {
  const selector = await resolveTargetSelector(page, args);
  const timeout = Number(args.timeout_ms ?? 10000);
  try {
    await page.waitForSelector(selector, { timeout });
    return `Element matching selector "${selector}" appeared within ${timeout}ms`;
  } catch {
    throw new DyadError(
      `Timed out waiting for element matching selector: ${selector} (timeout: ${timeout}ms)`,
      DyadErrorKind.External,
    );
  }
}

async function executeReadPage(
  page: PlaywrightPage,
  args: z.infer<typeof readPageAction>,
): Promise<string> {
  const mode = args.mode ?? "interactive";
  const depth = Math.min(Number(args.depth ?? 5), 20);

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
        name?: string;
        ariaLabel?: string;
        testId?: string;
        checked?: boolean;
        disabled?: boolean;
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
          el instanceof HTMLElement
            ? (() => {
                const style = getComputedStyle(el);
                return (
                  style.display !== "none" && style.visibility !== "hidden"
                );
              })()
            : true;

        const isInteractive =
          interactiveTags.has(el.tagName) ||
          (role !== null && interactiveRoles.has(role));

        if (mode === "interactive" && !isInteractive) {
          // Still walk children to find nested interactive elements
          const children: RefNode[] = [];
          for (const child of Array.from(el.children)) {
            const childNode = walk(child, currentDepth + 1);
            if (childNode) children.push(childNode);
          }
          return children.length > 0 ? { ref: -1, tag, children } : null;
        }

        // Refs always number interactive elements in document order across
        // ALL modes, so a ref from any read_page call maps 1:1 to the same
        // element via click/type/get_text/wait_for. In viewport mode, hidden
        // interactive elements still consume a ref number (keeps numbering
        // stable) but are omitted from the tree output.
        if (isInteractive && !isVisible && mode === "viewport") {
          refCounter += 1;
          return null;
        }

        const ref = isInteractive ? ++refCounter : -1;
        const node: RefNode = { ref, tag };

        if (role) node.role = role;
        if (el instanceof HTMLElement) {
          const text = el.innerText?.trim().slice(0, 120);
          if (text) node.text = text;
          const aria = el.getAttribute("aria-label");
          if (aria) node.ariaLabel = aria;
        }
        if (el.hasAttribute("href"))
          node.href = el.getAttribute("href") ?? undefined;
        if (el.hasAttribute("type"))
          node.type = el.getAttribute("type") ?? undefined;
        if (el.hasAttribute("placeholder"))
          node.placeholder = el.getAttribute("placeholder") ?? undefined;
        if (el.hasAttribute("name"))
          node.name = el.getAttribute("name") ?? undefined;
        if (el.hasAttribute("data-testid"))
          node.testId = el.getAttribute("data-testid") ?? undefined;
        if (el instanceof HTMLInputElement) {
          node.checked = el.checked;
          node.disabled = el.disabled;
        } else if (
          el instanceof HTMLButtonElement ||
          el instanceof HTMLSelectElement ||
          el instanceof HTMLTextAreaElement
        ) {
          node.disabled = el.disabled;
        }

        const children: RefNode[] = [];
        for (const child of Array.from(el.children)) {
          const childNode = walk(child, currentDepth + 1);
          if (childNode) children.push(childNode);
        }
        if (children.length > 0) node.children = children;

        return node;
      }

      const body = document.body;
      const result: RefNode[] = [];
      for (const child of Array.from(body.children)) {
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
    if (node.ariaLabel) parts.push(`aria="${node.ariaLabel}"`);
    if (node.text) parts.push(`"${node.text.slice(0, 80)}"`);
    if (node.href) parts.push(`href="${node.href}"`);
    if (node.type) parts.push(`type="${node.type}"`);
    if (node.name) parts.push(`name="${node.name}"`);
    if (node.placeholder) parts.push(`placeholder="${node.placeholder}"`);
    if (node.testId) parts.push(`testid="${node.testId}"`);
    if (node.checked !== undefined) parts.push(`checked=${node.checked}`);
    if (node.disabled !== undefined) parts.push(`disabled=${node.disabled}`);

    let result = pad + parts.join(" ");
    if (node.children) {
      for (const child of node.children) {
        result += "\n" + formatNode(child, indent + 1);
      }
    }
    return result;
  };

  const MAX_READ_PAGE_CHARS = 40_000;
  let lines = tree.tree.map((n) => formatNode(n)).join("\n");
  const truncated = lines.length > MAX_READ_PAGE_CHARS;
  if (truncated) {
    lines = lines.slice(0, MAX_READ_PAGE_CHARS) + "\n…[truncated]";
  }

  const interactiveCount = tree.refs;
  return `Page structure (${interactiveCount} interactive elements, mode: ${mode}${truncated ? ", output truncated" : ""}):
Use ref numbers (e.g. [3]) with click/type/get_text/wait_for to act on elements.

${lines}`;
}

/**
 * Normalize batch steps to an array, tolerating the platform serialization
 * quirk where arrays arrive as JSON strings.
 */
function normalizeBatchSteps(steps: unknown): Array<{
  action: string;
  params?: Record<string, unknown>;
}> {
  if (typeof steps === "string") {
    try {
      const parsed = JSON.parse(steps);
      if (Array.isArray(parsed))
        return parsed as Array<{
          action: string;
          params?: Record<string, unknown>;
        }>;
    } catch {
      // fall through to validation error
    }
    throw new DyadError(
      "batch steps must be a valid JSON array",
      DyadErrorKind.Validation,
    );
  }
  if (!Array.isArray(steps)) {
    throw new DyadError(
      "batch steps must be an array",
      DyadErrorKind.Validation,
    );
  }
  return steps as Array<{ action: string; params?: Record<string, unknown> }>;
}

async function executeBatch(
  page: PlaywrightPage,
  args: z.infer<typeof batchAction>,
  ctx: AgentContext,
): Promise<string> {
  // Coerce steps to array if received as string (serialization issue)
  const steps = normalizeBatchSteps(args.steps);

  const results: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as {
      action: string;
      params?: Record<string, unknown>;
    };
    const actionName = step.action;
    const params = step.params ?? {};

    ctx.onXmlStream(
      `<dyad-browser action="batch" step="${i + 1}/${steps.length}" subaction="${escapeXmlAttr(actionName)}">`,
    );

    try {
      let result: string = "";
      switch (actionName) {
        case "navigate":
          // Default to the running app's preview URL when a navigate step
          // omits url (mirrors the single-action behavior).
          result = await executeNavigate(
            page,
            (params.url as string | undefined) ??
              resolveTargetUrl(undefined, ctx.appId),
          );
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
      results.push(`[${i + 1}/${steps.length}] ${actionName}: ${result}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      results.push(`[${i + 1}/${steps.length}] ${actionName}: ERROR - ${msg}`);
      // Continue with remaining steps
    }

    // Random delay between actions (100-200ms) to appear more natural
    if (i < steps.length - 1) {
      await page.waitForTimeout(100 + Math.random() * 100);
    }
  }

  return results.join("\n");
}

async function executeFrameIframe(
  page: PlaywrightPage,
  args: z.infer<typeof frameIframeAction>,
  ctx: AgentContext,
): Promise<string> {
  if (!args.selector) {
    throw new DyadError(
      "frame_iframe requires a 'selector' parameter. Provide a CSS selector to identify the frame/iframe element.",
      DyadErrorKind.Validation,
    );
  }
  const frame = page.frameLocator(args.selector);

  switch (args.action_type) {
    case "click":
      if (!args.inner_selector) {
        throw new DyadError(
          "inner_selector is required for click action",
          DyadErrorKind.Validation,
        );
      }
      await frame.locator(args.inner_selector).click();
      return `Clicked element in frame: ${args.inner_selector}`;

    case "type":
      if (!args.inner_selector || !args.text) {
        throw new DyadError(
          "inner_selector and text are required for type action",
          DyadErrorKind.Validation,
        );
      }
      await frame.locator(args.inner_selector).fill(args.text);
      return `Typed "${args.text}" into element in frame: ${args.inner_selector}`;

    case "get_text":
      if (!args.inner_selector) {
        throw new DyadError(
          "inner_selector is required for get_text action",
          DyadErrorKind.Validation,
        );
      }
      const text = await frame.locator(args.inner_selector).textContent();
      return text || "";

    case "screenshot":
      // Capture the frame element itself (not the whole page) so the
      // screenshot matches the requested frame.
      const frameEl = page.locator(args.selector).first();
      const screenshotBuffer = (await frameEl.screenshot({
        type: "png",
      })) as Buffer;
      const screenshotPath = await saveScreenshot(
        screenshotBuffer,
        resolveTargetAppPath(ctx, undefined),
      );
      return `Frame screenshot saved to: ${screenshotPath}`;

    default:
      throw new DyadError(
        `Unknown action_type: ${args.action_type}`,
        DyadErrorKind.Validation,
      );
  }
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
        return args.url
          ? `Navigate browser to: "${args.url}"`
          : "Navigate to running app";
      case "click":
        return args.ref
          ? `Click element ref [${args.ref}]`
          : `Click element: "${args.selector}"`;
      case "type":
        return args.ref
          ? `Type into ref [${args.ref}]: "${args.text}"`
          : `Type into "${args.selector}": "${args.text}"`;
      case "scroll":
        return `Scroll ${args.direction} by ${args.amount ?? 500}px`;
      case "screenshot":
        return `Take ${args.full_page ? "full-page " : ""}screenshot`;
      case "get_text":
        return args.ref
          ? `Get text from ref [${args.ref}]`
          : `Get text from: "${args.selector}"`;
      case "wait_for":
        return args.ref
          ? `Wait for element ref [${args.ref}]`
          : `Wait for element: "${args.selector}"`;
      case "read_page":
        return `Read page structure (${args.mode ?? "interactive"} mode)`;
      case "batch": {
        const steps = normalizeBatchSteps(args.steps);
        return `Execute ${steps.length} browser actions sequentially`;
      }
      case "form_data":
        return `Extract form data from: "${args.selector}"`;
      case "fill_form":
        return `Fill form at "${args.selector}" with ${Object.keys(args.data).length} fields`;
      case "submit_form":
        return `Submit form at "${args.selector}"`;
      case "validate_form":
        return `Validate form at "${args.selector}"`;
      case "frame_iframe":
        return `Interact with frame/iframe: "${args.selector}"`;
    }
  },

  buildXml: (args, isComplete) => {
    if (!args.action) return undefined;
    if (isComplete) return undefined;

    switch (args.action) {
      case "navigate":
        return `<dyad-browser action="navigate"${args.url ? ` url="${escapeXmlAttr(args.url)}"` : ""}>`;
      case "click":
        if (args.ref) return `<dyad-browser action="click" ref="${args.ref}">`;
        if (!args.selector) return undefined;
        return `<dyad-browser action="click" selector="${escapeXmlAttr(args.selector)}">`;
      case "type":
        if (args.ref) return `<dyad-browser action="type" ref="${args.ref}">`;
        if (!args.selector || !args.text) return undefined;
        return `<dyad-browser action="type" selector="${escapeXmlAttr(args.selector)}">`;
      case "scroll":
        return `<dyad-browser action="scroll" direction="${escapeXmlAttr(args.direction)}">`;
      case "screenshot":
        return `<dyad-browser action="screenshot">`;
      case "get_text":
        if (args.ref)
          return `<dyad-browser action="get_text" ref="${args.ref}">`;
        if (!args.selector) return undefined;
        return `<dyad-browser action="get_text" selector="${escapeXmlAttr(args.selector)}">`;
      case "wait_for":
        if (args.ref)
          return `<dyad-browser action="wait_for" ref="${args.ref}">`;
        if (!args.selector) return undefined;
        return `<dyad-browser action="wait_for" selector="${escapeXmlAttr(args.selector)}">`;
      case "read_page":
        return `<dyad-browser action="read_page" mode="${escapeXmlAttr(args.mode ?? "interactive")}">`;
      case "batch": {
        const steps = normalizeBatchSteps(args.steps);
        return `<dyad-browser action="batch" steps="${steps.length}">`;
      }
      case "form_data":
        return `<dyad-browser action="form_data" selector="${escapeXmlAttr(args.selector)}">`;
      case "fill_form":
        return `<dyad-browser action="fill_form" selector="${escapeXmlAttr(args.selector)}">`;
      case "submit_form":
        return `<dyad-browser action="submit_form" selector="${escapeXmlAttr(args.selector)}">`;
      case "validate_form":
        return `<dyad-browser action="validate_form" selector="${escapeXmlAttr(args.selector)}">`;
    }
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Executing browser_control: ${args.action}`);

    // Build initial XML based on action
    let initialXml: string = "";
    switch (args.action) {
      case "navigate":
        initialXml = `<dyad-browser action="navigate"${args.url ? ` url="${escapeXmlAttr(args.url)}"` : ""}>`;
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
        initialXml = `<dyad-browser action="batch" steps="${normalizeBatchSteps(args.steps).length}">`;
        break;
    }

    ctx.onXmlStream(initialXml);

    try {
      const page = await getPage();
      const targetUrl = resolveTargetUrl(
        "url" in args ? args.url : undefined,
        ctx.appId,
      );

      let result: string = "";

      switch (args.action) {
        case "navigate":
          result = await executeNavigate(page, targetUrl);
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
        case "frame_iframe":
          result = await executeFrameIframe(page, args, ctx);
          break;
        case "form_data":
          result = await executeFormData(page, args);
          break;
        case "fill_form":
          result = await executeFillForm(page, args);
          break;
        case "submit_form":
          result = await executeSubmitForm(page, args);
          break;
        case "validate_form":
          result = await executeValidateForm(page, args);
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
    }
  },
};
