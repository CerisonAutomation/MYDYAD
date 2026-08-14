/**
 * Shared browser session manager for Playwright-based tools.
 *
 * Provides a persistent Chromium browser that's reused across tool calls
 * instead of launching/closing a fresh browser each time.
 *
 * Auto-detects the running app's proxy URL when no URL is provided.
 */

import type { Browser, Page, BrowserContext } from "playwright";
import log from "electron-log";
import {
  PROXY_PORT_BASE,
  PROXY_PORT_RANGE,
} from "../../../../../../../shared/ports";

const logger = log.scope("browser_session");

// ============================================================================
// Singleton browser session
// ============================================================================

let sharedBrowser: Browser | null = null;
let sharedContext: BrowserContext | null = null;
let lastActivityTime = 0;

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_PAGES = 10;

/**
 * Get or create the shared browser instance.
 * Reuses the existing browser if it's still alive and within idle timeout.
 */
export async function getBrowser(): Promise<Browser> {
  // Clean up idle browser
  if (sharedBrowser && Date.now() - lastActivityTime > IDLE_TIMEOUT_MS) {
    logger.log("Browser idle timeout, closing");
    await closeBrowser().catch(() => {});
  }

  // Check if existing browser is still alive
  if (sharedBrowser && sharedBrowser.isConnected()) {
    lastActivityTime = Date.now();
    return sharedBrowser;
  }

  // Launch fresh browser
  logger.log("Launching new browser instance");
  const playwright = await import("playwright");
  sharedBrowser = await playwright.chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  sharedContext = await sharedBrowser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  lastActivityTime = Date.now();

  // Clean up on browser disconnect
  sharedBrowser.on("disconnected", () => {
    logger.log("Browser disconnected");
    sharedBrowser = null;
    sharedContext = null;
  });

  return sharedBrowser;
}

/**
 * Get or create a page in the shared context.
 * Reuses an existing blank page if available, otherwise creates a new one.
 */
export async function getPage(): Promise<Page> {
  const browser = await getBrowser();
  const ctx = sharedContext ?? (await browser.newContext());

  // Reuse an existing blank page
  const pages = ctx.pages();
  for (const page of pages) {
    const url = page.url();
    if (url === "about:blank" || url === "chrome://newtab/") {
      lastActivityTime = Date.now();
      return page;
    }
  }

  // Limit total pages
  if (pages.length >= MAX_PAGES) {
    // Close oldest non-blank page
    const oldest = pages[0];
    await oldest.close().catch(() => {});
  }

  const page = await ctx.newPage();
  lastActivityTime = Date.now();
  return page;
}

/**
 * Close the shared browser and all its pages.
 */
export async function closeBrowser(): Promise<void> {
  if (sharedContext) {
    await sharedContext.close().catch(() => {});
    sharedContext = null;
  }
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
  logger.log("Browser closed");
}

/**
 * Check if a browser is currently active.
 */
export function isBrowserActive(): boolean {
  return sharedBrowser !== null && sharedBrowser.isConnected();
}

// ============================================================================
// App URL resolution
// ============================================================================

/**
 * Get the proxy URL for a running Dyad app.
 * Returns null if the app doesn't seem to be running.
 *
 * Port scheme: proxy = 42100 + (appId % 10000)
 */
export function getPreviewUrl(appId: number): string {
  const proxyPort = PROXY_PORT_BASE + (appId % PROXY_PORT_RANGE);
  return `http://localhost:${proxyPort}`;
}

/**
 * Resolve the target URL for a browser action.
 * If url is provided, use it directly.
 * If url is omitted, try to use the running app's proxy URL.
 */
export function resolveTargetUrl(
  url: string | undefined,
  appId: number,
): string {
  if (url) return url;
  return getPreviewUrl(appId);
}

/**
 * Wait for a page to be ready (network idle or domcontentloaded).
 */
export async function waitForPageReady(
  page: Page,
  url: string,
  timeoutMs = 15_000,
): Promise<void> {
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    // Give the page a moment to render
    await page.waitForTimeout(500);
  } catch (error) {
    // If navigation fails, the page might already be loaded
    const currentUrl = page.url();
    if (currentUrl !== "about:blank") {
      // Page is already on a URL, just wait for it
      return;
    }
    throw error;
  }
}
