import { z } from "zod";
import log from "electron-log";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { resolveTargetAppPath } from "./resolve_app_context";
import { DYAD_SCREENSHOT_DIR_NAME } from "@/ipc/utils/media_path_utils";
import { getPage, resolveTargetUrl, waitForPageReady } from "./browser_session";
import { withRetry } from "./retry_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("take_screenshot");

const takeScreenshotSchema = z.object({
  url: z
    .string()
    .optional()
    .describe(
      "URL to screenshot. If omitted, captures the current preview panel.",
    ),
  full_page: z
    .boolean()
    .optional()
    .describe(
      "Capture the full scrollable page instead of just the viewport. Default: false.",
    ),
  width: z
    .number()
    .optional()
    .describe("Viewport width in pixels. Default: 1280."),
  height: z
    .number()
    .optional()
    .describe("Viewport height in pixels. Default: 720."),
  selector: z
    .string()
    .optional()
    .describe(
      "CSS selector to screenshot a specific element instead of the full page.",
    ),
  app_name: z
    .string()
    .optional()
    .describe(
      "Optional app reference name (via @app:Name mention). Screenshots the referenced app's preview if provided.",
    ),
});

const DESCRIPTION = `Capture a screenshot of a URL or the running app's preview. Saves the image to the app's .dyad/screenshot directory for visual verification.

### When to Use
- Verifying visual appearance of a web page or app preview
- Debugging layout or styling issues
- Capturing a before/after snapshot of changes
- Checking how a page renders at a specific viewport size

### Behavior
- If \`url\` is provided, navigates to that URL
- If \`url\` is omitted, auto-detects the running app's preview URL
- Use \`full_page: true\` to capture the entire scrollable page
- Use \`selector\` to capture a specific element (e.g. ".hero-section", "#app")
- Images are saved to \`<app>/.dyad/screenshot/screenshot-<timestamp>-<random>.png\`

### After Capture
The tool returns the file path in .dyad/screenshot. The screenshot can be referenced or copied elsewhere in the project as needed.
`;

/**
 * Save a screenshot buffer to the app's media directory.
 */
async function saveScreenshot(
  screenshotBuffer: Buffer,
  appPath: string,
): Promise<string> {
  const mediaDir = path.join(appPath, DYAD_SCREENSHOT_DIR_NAME);
  await fs.mkdir(mediaDir, { recursive: true });

  const hash = crypto.randomBytes(4).toString("hex");
  const timestamp = Date.now();
  const fileName = `screenshot-${timestamp}-${hash}.png`;
  const filePath = path.join(mediaDir, fileName);
  const relativePath = path.join(DYAD_SCREENSHOT_DIR_NAME, fileName);

  await fs.writeFile(filePath, screenshotBuffer);

  return relativePath;
}

/**
 * Take a screenshot of a URL using the shared browser session.
 */
async function screenshotUrl(
  url: string,
  options: {
    fullPage?: boolean;
    width?: number;
    height?: number;
    selector?: string;
  },
): Promise<Buffer> {
  return withRetry(
    async () => {
      const page = await getPage();

      // Apply requested viewport size BEFORE navigation so the capture
      // actually reflects the requested dimensions (previously width/height
      // were accepted but silently ignored).
      if (options.width || options.height) {
        const current = page.viewportSize() ?? { width: 1280, height: 720 };
        await page.setViewportSize({
          width: options.width ?? current.width,
          height: options.height ?? current.height,
        });
      }

      await waitForPageReady(page, url, 30_000);

      let screenshotBuffer: Buffer;

      if (options.selector) {
        const element = await page.$(options.selector);
        if (!element) {
          throw new DyadError(
            `Element matching selector "${options.selector}" not found on page`,
            DyadErrorKind.Validation,
          );
        }
        screenshotBuffer = (await element.screenshot({
          type: "png",
        })) as Buffer;
      } else {
        screenshotBuffer = (await page.screenshot({
          fullPage: options.fullPage ?? false,
          type: "png",
        })) as Buffer;
      }

      return screenshotBuffer;
    },
    {
      maxRetries: 2,
      baseDelay: 1000,
      operationName: "screenshot",
    },
  );
}

/**
 * Prune old screenshots in a project's .dyad/screenshot directory so the
 * folder cannot grow without bound. Keeps the newest MAX_SCREENSHOTS files.
 * Non-blocking — failures are logged, never thrown.
 */
const MAX_SCREENSHOTS_PER_PROJECT = 50;

async function pruneOldScreenshots(appPath: string): Promise<void> {
  try {
    const mediaDir = path.join(appPath, DYAD_SCREENSHOT_DIR_NAME);
    const entries = await fs.readdir(mediaDir);
    const screenshots = entries
      .filter((name) => /^screenshot-\d+-[0-9a-f]+\.png$/.test(name))
      .map((name) => ({ name, mtime: 0 }));

    // Sort by embedded timestamp (screenshot-<ts>-<hash>.png)
    screenshots.sort((a, b) => {
      const ta = Number(a.name.split("-")[1] ?? 0);
      const tb = Number(b.name.split("-")[1] ?? 0);
      return tb - ta;
    });

    const excess = screenshots.length - MAX_SCREENSHOTS_PER_PROJECT;
    if (excess <= 0) return;

    for (const old of screenshots.slice(-excess)) {
      await fs.unlink(path.join(mediaDir, old.name)).catch(() => {});
    }
    logger.log(`Pruned ${excess} old screenshot(s) in ${mediaDir}`);
  } catch (error) {
    logger.warn("Screenshot prune skipped:", error);
  }
}

export const takeScreenshotTool: ToolDefinition<
  z.infer<typeof takeScreenshotSchema>
> = {
  name: "take_screenshot",
  description: DESCRIPTION,
  inputSchema: takeScreenshotSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) =>
    args.url
      ? `Screenshot URL: ${args.url}`
      : "Screenshot the current preview panel",

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    const urlAttr = args.url ? ` url="${escapeXmlAttr(args.url)}"` : "";
    return `<dyad-screenshot${urlAttr}>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);

    const urlAttr = args.url ? ` url="${escapeXmlAttr(args.url)}"` : "";
    ctx.onXmlStream(`<dyad-screenshot${urlAttr}>`);

    logger.log(
      `Executing screenshot: url=${args.url ?? "(preview panel)"}, fullPage=${args.full_page ?? false}, width=${args.width ?? 1280}, height=${args.height ?? 720}, selector=${args.selector ?? "(none)"}`,
    );

    try {
      if (args.selector && args.full_page) {
        throw new DyadError(
          "Cannot combine selector with full_page — capture either an element or the full page, not both",
          DyadErrorKind.Validation,
        );
      }

      const targetUrl = resolveTargetUrl(args.url, ctx.appId);

      const screenshotBuffer = await screenshotUrl(targetUrl, {
        fullPage: args.full_page,
        width: args.width,
        height: args.height,
        selector: args.selector,
      });

      const relativePath = await saveScreenshot(
        screenshotBuffer,
        targetAppPath,
      );

      // Keep the project's screenshot folder bounded (fire-and-forget).
      void pruneOldScreenshots(targetAppPath);

      const widthAttr = args.width
        ? ` width="${escapeXmlAttr(String(args.width))}"`
        : "";
      const heightAttr = args.height
        ? ` height="${escapeXmlAttr(String(args.height))}"`
        : "";
      const fullPageAttr = args.full_page ? ` full_page="true"` : "";
      const selectorAttr = args.selector
        ? ` selector="${escapeXmlAttr(args.selector)}"`
        : "";

      ctx.onXmlComplete(
        `<dyad-screenshot path="${escapeXmlAttr(relativePath)}"${urlAttr}${widthAttr}${heightAttr}${fullPageAttr}${selectorAttr}>${escapeXmlContent(relativePath)}</dyad-screenshot>`,
      );

      logger.log(`Screenshot saved to: ${relativePath}`);

      return `Screenshot saved to: ${relativePath}`;
    } catch (error) {
      const urlAttrForError = args.url
        ? ` url="${escapeXmlAttr(args.url)}"`
        : "";
      ctx.onXmlComplete(
        `<dyad-screenshot${urlAttrForError}></dyad-screenshot>`,
      );
      throw error;
    }
  },
};
