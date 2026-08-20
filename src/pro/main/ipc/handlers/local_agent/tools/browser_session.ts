/**
 * Shared browser session manager for Playwright-based tools.
 *
 * Provides a persistent Chromium browser that's reused across tool calls
 * instead of launching/closing a fresh browser each time.
 *
 * Auto-detects the running app's proxy URL when no URL is provided.
 *
 * Memory-safety contract:
 * - A periodic idle sweep closes the browser after `IDLE_TIMEOUT_MS` of
 *   inactivity, even when no further tool call arrives (previously the
 *   timeout was only checked lazily, so an idle Chromium could live for
 *   the entire app session).
 * - `shutdown()` is wired to the app's will-quit lifecycle so the browser
 *   and its pages are torn down on exit (see main.ts).
 * - Recreated contexts are stored back on `sharedContext` so the singleton
 *   invariants hold; closed/crashed pages are filtered out on reuse.
 */

import type {
  Browser,
  Page,
  BrowserContext,
  Response as PlaywrightResponse,
} from "playwright";
import log from "electron-log";
import {
  PROXY_PORT_BASE,
  PROXY_PORT_RANGE,
} from "../../../../../../../shared/ports";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("browser_session");

// ============================================================================
// Singleton browser session
// ============================================================================

let sharedBrowser: Browser | null = null;
let sharedContext: BrowserContext | null = null;
let lastActivityTime = 0;

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const IDLE_SWEEP_INTERVAL_MS = 60 * 1000; // check once per minute
const MAX_PAGES = 10;

let idleSweepTimer: NodeJS.Timeout | null = null;

// ============================================================================
// Tabs (named pages within the shared context)
// ============================================================================

export interface TabInfo {
  tabId: string;
  url: string;
  title: string;
  isActive: boolean;
}

interface TabEntry {
  id: string;
  page: Page;
}

let tabs: TabEntry[] = [];
let activeTabId: string | null = null;
let nextTabNum = 1;

// ============================================================================
// Per-page console log / network request capture
// ============================================================================

export interface ConsoleLogEntry {
  type: string;
  text: string;
  timestamp: number;
}

export interface NetworkRequestEntry {
  id: string;
  url: string;
  method: string;
  resourceType: string;
  status: number | "failed" | null;
  timestamp: number;
}

interface PageActivityState {
  consoleLogs: ConsoleLogEntry[];
  networkEntries: NetworkRequestEntry[];
  // Store only status codes, not full response objects (prevents memory leak)
  responseStatusById: Map<string, number>;
}

const MAX_CONSOLE_LOGS = 100; // Reduced from 500 to prevent memory leak
const MAX_NETWORK_ENTRIES = 100; // Reduced from 500 to prevent memory leak

const pageState = new WeakMap<Page, PageActivityState>();

/** Attach console/network capture listeners to a freshly created page. */
export function attachPageListeners(page: Page): void {
  const state: PageActivityState = {
    consoleLogs: [],
    networkEntries: [],
    responseStatusById: new Map(),
  };
  pageState.set(page, state);

  page.on("console", (msg) => {
    state.consoleLogs.push({
      type: msg.type(),
      text: msg.text(),
      timestamp: Date.now(),
    });
    if (state.consoleLogs.length > MAX_CONSOLE_LOGS) state.consoleLogs.shift();
  });

  page.on("pageerror", (err) => {
    state.consoleLogs.push({
      type: "error",
      text: `Uncaught exception: ${err.message}`,
      timestamp: Date.now(),
    });
    if (state.consoleLogs.length > MAX_CONSOLE_LOGS) state.consoleLogs.shift();
  });

  const entryIdByRequestUrl = new WeakMap<object, string>();

  page.on("request", (req) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    entryIdByRequestUrl.set(req, id);
    state.networkEntries.push({
      id,
      url: req.url(),
      method: req.method(),
      resourceType: req.resourceType(),
      status: null,
      timestamp: Date.now(),
    });
    if (state.networkEntries.length > MAX_NETWORK_ENTRIES) {
      const removed = state.networkEntries.shift();
      if (removed) state.responseStatusById.delete(removed.id);
    }
  });

  page.on("requestfailed", (req) => {
    const id = entryIdByRequestUrl.get(req);
    const entry = state.networkEntries.find((e) => e.id === id);
    if (entry) entry.status = "failed";
  });

  page.on("response", (res) => {
    const id = entryIdByRequestUrl.get(res.request());
    const entry = state.networkEntries.find((e) => e.id === id);
    if (entry) {
      entry.status = res.status();
      if (id) state.responseStatusById.set(id, res.status());
    }
  });
}

/** Console logs captured for a page (empty if the page has no listeners attached). */
export function getConsoleLogs(page: Page): ConsoleLogEntry[] {
  return pageState.get(page)?.consoleLogs ?? [];
}

/** Clear captured console logs for a page. */
export function clearConsoleLogs(page: Page): void {
  const state = pageState.get(page);
  if (state) state.consoleLogs = [];
}

/** Network requests captured for a page. */
export function getNetworkEntries(page: Page): NetworkRequestEntry[] {
  return pageState.get(page)?.networkEntries ?? [];
}

/** Fetch the response body for a previously captured network request, by entry id. */
export async function getNetworkResponseBody(
  page: Page,
  entryId: string,
): Promise<{ body: string; contentType: string | null } | null> {
  // Find the response by re-fetching through network entries
  const state = pageState.get(page);
  if (!state) return null;
  // Re-fetch the response from the page's network
  const entry = state.networkEntries.find((e) => e.id === entryId);
  if (!entry) return null;
  try {
    // Re-fetch the URL to get the response body
    const response = await page.request.get(entry.url);
    const body = await response.text();
    const contentType = response.headers()["content-type"] ?? null;
    return { body, contentType };
  } catch {
    return null;
  }
}

function touchActivity(): void {
  lastActivityTime = Date.now();
}

/**
 * True if the shared browser is alive and connected.
 */
function isBrowserAlive(): boolean {
  return sharedBrowser !== null && sharedBrowser.isConnected();
}

/**
 * Periodic sweep: close the browser if it has been idle too long.
 * Runs on a timer so an abandoned browser is reclaimed even without
 * further tool calls (previously only checked lazily on the next call).
 */
function sweepIdleBrowser(): void {
  if (!isBrowserAlive()) {
    // Browser died or was closed; stop the sweep until next launch.
    if (sharedBrowser === null && idleSweepTimer) {
      stopIdleSweep();
    }
    return;
  }
  if (Date.now() - lastActivityTime > IDLE_TIMEOUT_MS) {
    logger.log("Browser idle timeout, closing");
    void closeBrowser().catch(() => {});
  }
}

function startIdleSweep(): void {
  if (idleSweepTimer) return;
  idleSweepTimer = setInterval(sweepIdleBrowser, IDLE_SWEEP_INTERVAL_MS);
  // Do not keep the process alive just for the sweep.
  idleSweepTimer.unref?.();
}

function stopIdleSweep(): void {
  if (idleSweepTimer) {
    clearInterval(idleSweepTimer);
    idleSweepTimer = null;
  }
}

/**
 * Get or create the shared browser instance.
 * Reuses the existing browser if it's still alive and within idle timeout.
 */
export async function getBrowser(): Promise<Browser> {
  if (isBrowserAlive()) {
    touchActivity();
    return sharedBrowser as Browser;
  }

  // Launch fresh browser
  logger.log("Launching new browser instance");
  const playwright = await import("playwright");

  let browser;
  try {
    // Try Playwright's bundled Chromium first
    browser = await playwright.chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  } catch (playwrightError) {
    // Fallback to system Chrome if Playwright's Chromium is not installed
    logger.warn(
      "Playwright Chromium not available, falling back to system Chrome:",
      (playwrightError as Error).message?.slice(0, 100),
    );
    const systemChromePaths = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
    ];
    let chromePath: string | undefined;
    for (const p of systemChromePaths) {
      try {
        const fs = await import("node:fs/promises");
        await fs.access(p);
        chromePath = p;
        break;
      } catch {
        // not found
      }
    }
    if (!chromePath) {
      throw new DyadError(
        "No browser available. Install Playwright Chromium: npx playwright install chromium",
        DyadErrorKind.External,
      );
    }
    browser = await playwright.chromium.launch({
      headless: true,
      executablePath: chromePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  }

  sharedBrowser = browser;
  sharedContext = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  touchActivity();
  startIdleSweep();

  // Clean up on browser disconnect (crash, manual close, etc.)
  browser.on("disconnected", () => {
    logger.log("Browser disconnected");
    if (sharedBrowser === browser) {
      sharedBrowser = null;
      sharedContext = null;
      stopIdleSweep();
    }
  });

  return browser;
}

/**
 * Get or create a page in the shared context.
 * Reuses an existing live blank page if available, otherwise creates a new one.
 */
export async function getPage(): Promise<Page> {
  const browser = await getBrowser();

  // If the context is gone (e.g. recreated after a crash) but the browser is
  // alive, create and STORE a fresh context so the singleton stays coherent.
  if (!sharedContext || sharedContext === null) {
    sharedContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
  }
  const ctx = sharedContext;

  // Filter out pages that were closed/crashed since we last looked.
  const livePages = ctx.pages().filter((p) => !p.isClosed());

  // Reuse an existing live blank page
  for (const page of livePages) {
    const url = page.url();
    if (url === "about:blank" || url === "chrome://newtab/") {
      if (!pageState.has(page)) attachPageListeners(page);
      touchActivity();
      return page;
    }
  }

  // Limit total pages — close the oldest live page (pages() is in creation
  // order) and never close about:blank pages that we can reuse.
  if (livePages.length >= MAX_PAGES) {
    const oldest = livePages[0];
    if (oldest && !oldest.isClosed()) {
      await oldest.close().catch(() => {});
    }
  }

  const page = await ctx.newPage();
  attachPageListeners(page);
  touchActivity();
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
    const browser = sharedBrowser;
    sharedBrowser = null;
    await browser.close().catch(() => {});
  }
  stopIdleSweep();
  logger.log("Browser closed");
}

/**
 * Tear down the browser for app shutdown. Fire-and-forget friendly.
 */
export function shutdownBrowser(): void {
  void closeBrowser().catch(() => {});
  // Clear Fuse.js search cache to free memory
  try {
    const { clearFuseCache } = require("@/ipc/utils/fuse_search");
    clearFuseCache();
  } catch {
    // fuse_search may not be loaded yet — safe to ignore
  }
}

/**
 * Check if a browser is currently active.
 */
export function isBrowserActive(): boolean {
  return isBrowserAlive();
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
 * Returns the HTTP response of the navigation, if any.
 *
 * For localhost/preview URLs this first verifies the app's dev server is
 * actually reachable, so visual checks never run against a dead server
 * (which previously produced blank pages / "0 elements" and confused the
 * model into thinking the page was broken).
 */
export async function waitForPageReady(
  page: Page,
  url: string,
  timeoutMs = 15_000,
): Promise<import("playwright").Response | null> {
  if (isPreviewProxyUrl(url)) {
    const ready = await ensurePreviewReady(url, { waitMs: 4_000 });
    if (!ready.ok) {
      throw new DyadError(
        buildNotReadyMessage(url, ready),
        DyadErrorKind.External,
      );
    }
  }

  let response: import("playwright").Response | null = null;
  try {
    response = await page.goto(url, {
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
      return response;
    }
    throw error;
  }

  // Best-effort: wait for the network to settle so SPA content (React, etc.)
  // has actually rendered before reading the DOM. Failures are non-fatal —
  // the caller may still read whatever is present.
  try {
    await page.waitForLoadState("networkidle", { timeout: 5_000 });
  } catch {
    // Ignore — the page may keep long-polling connections open.
  }

  return response;
}

// ============================================================================
// Dev-server readiness (pre-flight for visual checks)
// ============================================================================

const PREVIEW_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/** True if the URL points at a Dyad preview proxy (localhost:421xx). */
function isPreviewProxyUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      PREVIEW_HOST_RE.test(parsed.hostname) &&
      parsed.port !== "" &&
      Number(parsed.port) >= PROXY_PORT_BASE &&
      Number(parsed.port) < PROXY_PORT_BASE + PROXY_PORT_RANGE
    );
  } catch {
    return false;
  }
}

export interface PreviewReadyResult {
  ok: boolean;
  url: string;
  status?: number;
  appProcessRunning: boolean;
  error?: string;
}

// Cache successful probes briefly so batch steps don't hammer the proxy.
const PREVIEW_PROBE_CACHE_TTL_MS = 5_000;
const PREVIEW_PROBE_CACHE_MAX_SIZE = 50;
const previewProbeCache = new Map<string, { at: number; status?: number }>();

/** Clear the probe cache (used by tests between cases). */
export function resetPreviewProbeCache(): void {
  previewProbeCache.clear();
}

/**
 * Single HTTP probe of the preview proxy.
 */
async function probePreview(
  url: string,
  timeoutMs = 5_000,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "manual",
      cache: "no-store",
      headers: { "user-agent": "dyad-preview-probe" },
    });
    return { ok: true, status: res.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const causeMessage =
      error instanceof Error && error.cause instanceof Error
        ? error.cause.message
        : "";
    const fullMessage = `${message} ${causeMessage}`;
    // The proxy server may send both Content-Length and Transfer-Encoding
    // headers, which violates HTTP/1.1 and causes Node's undici parser to
    // throw. The server IS responding — treat this as a successful probe.
    if (
      fullMessage.includes("Content-Length can't be present with Transfer-Encoding") ||
      fullMessage.includes("Response does not match the HTTP/1.1 protocol")
    ) {
      return { ok: true, status: 200 };
    }
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check (and briefly poll) whether the app's preview/dev server is reachable
 * before running visual checks.
 *
 * Failure modes are distinguished so the agent gets an actionable message:
 * - app process not running        → tell the model to start the dev server
 * - process running but not answering → it is still booting
 * - proxy up but error status      → the server responded but is broken
 */
export async function ensurePreviewReady(
  url: string,
  opts: { waitMs?: number; pollIntervalMs?: number } = {},
): Promise<PreviewReadyResult> {
  const waitMs = opts.waitMs ?? 4_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 1_000;
  const deadline = Date.now() + waitMs;

  // Fast path: cached successful probe.
  const cached = previewProbeCache.get(url);
  if (cached && Date.now() - cached.at < PREVIEW_PROBE_CACHE_TTL_MS) {
    return { ok: true, url, status: cached.status, appProcessRunning: true };
  }

  // Is the app's dev-server process tracked as running by Dyad?
  // Lazy import: process_manager pulls in app-runtime modules that must not
  // load in light contexts (e.g. the vitest environment).
  const appId = previewAppIdForUrl(url);
  let appProcessRunning = false;
  if (appId !== null) {
    try {
      const { getRunningAppProcessPids } =
        await import("../../../../../../ipc/utils/process_manager");
      appProcessRunning = getRunningAppProcessPids().some(
        (p) => p.appId === appId,
      );
    } catch {
      appProcessRunning = false;
    }
  }

  let lastProbe: { ok: boolean; status?: number; error?: string } | null = null;
  for (;;) {
    lastProbe = await probePreview(url);
    if (lastProbe.ok) {
      previewProbeCache.set(url, { at: Date.now(), status: lastProbe.status });
      // Evict oldest entries if cache is full
      if (previewProbeCache.size > PREVIEW_PROBE_CACHE_MAX_SIZE) {
        const firstKey = previewProbeCache.keys().next().value;
        if (firstKey) previewProbeCache.delete(firstKey);
      }
      return {
        ok: true,
        url,
        status: lastProbe.status,
        appProcessRunning,
      };
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return {
    ok: false,
    url,
    appProcessRunning,
    error: lastProbe?.error ?? "connection failed",
  };
}

/** Extract the Dyad appId from a preview proxy URL (port - base). */
function previewAppIdForUrl(url: string): number | null {
  try {
    const parsed = new URL(url);
    const port = Number(parsed.port);
    if (port >= PROXY_PORT_BASE && port < PROXY_PORT_BASE + PROXY_PORT_RANGE) {
      return port - PROXY_PORT_BASE;
    }
    return null;
  } catch {
    return null;
  }
}

/** Build a model-actionable error message for a dead preview. */
function buildNotReadyMessage(url: string, ready: PreviewReadyResult): string {
  if (!ready.appProcessRunning) {
    return (
      `The app's dev server is NOT running (preview proxy ${url} is unreachable and ` +
      `no dev-server process is tracked for this app). Before running visual checks, ` +
      `start the dev server (e.g. \`npm run dev\` / \`pnpm dev\`) and wait for it to ` +
      `listen on its port, then retry the visual check.`
    );
  }
  if (
    ready.error?.toLowerCase().includes("abort") ||
    ready.error?.toLowerCase().includes("timed out")
  ) {
    return (
      `The app's dev server process is running but the preview proxy ${url} is not ` +
      `responding yet (probe timed out). It may still be booting — wait a few seconds ` +
      `and retry the visual check.`
    );
  }
  return (
    `The app's preview proxy ${url} is unreachable (${ready.error ?? "connection refused"}). ` +
    `The dev server may have crashed or the proxy worker may not be running. Check the ` +
    `app's dev-server logs, restart it if needed, then retry.`
  );
}

// ============================================================================
// Event Blocking & Visual Overlay
// ============================================================================

/**
 * Block all user input events on a page during agent browser operations.
 * Prevents race conditions and interference when the agent is driving the browser.
 */
export async function blockUserInput(page: Page): Promise<void> {
  await page.evaluate(() => {
    const BLOCKED_EVENTS = [
      "mousedown",
      "mouseup",
      "click",
      "dblclick",
      "contextmenu",
      "keydown",
      "keyup",
      "keypress",
      "touchstart",
      "touchend",
      "touchmove",
      "pointerdown",
      "pointerup",
      "pointermove",
      "dragstart",
      "drag",
      "dragend",
      "focus",
      "blur",
      "input",
      "change",
      "submit",
    ];

    // Store original handlers for cleanup
    (window as any).__dyadBlockedHandlers = new Map();

    for (const eventType of BLOCKED_EVENTS) {
      const handler = (e: Event) => {
        e.stopImmediatePropagation();
        e.preventDefault();
        e.stopPropagation();
      };
      (window as any).__dyadBlockedHandlers.set(eventType, handler);
      document.addEventListener(eventType, handler, {
        capture: true,
        passive: false,
      });
    }

    // Show visual indicator
    document.documentElement.style.cursor = "progress";
    document.documentElement.style.setProperty("--dyad-agent-active", "1");
  });
}

/**
 * Unblock all user input events on a page after agent browser operations complete.
 */
export async function unblockUserInput(page: Page): Promise<void> {
  await page.evaluate(() => {
    const handlers = (window as any).__dyadBlockedHandlers;
    if (handlers) {
      for (const [eventType, handler] of handlers) {
        document.removeEventListener(eventType, handler, {
          capture: true,
        } as any);
      }
      handlers.clear();
      delete (window as any).__dyadBlockedHandlers;
    }

    document.documentElement.style.cursor = "";
    document.documentElement.style.removeProperty("--dyad-agent-active");
  });
}

/**
 * Show a visual overlay on the page indicating agent activity.
 */
export async function showAgentOverlay(
  page: Page,
  status = "Working...",
): Promise<void> {
  await page.evaluate((statusText) => {
    // Remove existing overlay
    const existing = document.getElementById("dyad-agent-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "dyad-agent-overlay";
    overlay.innerHTML = `
      <style>
        #dyad-agent-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          pointer-events: none;
          z-index: 999999;
          animation: dyad-fade-in 300ms ease-out;
        }
        @keyframes dyad-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        #dyad-agent-border {
          position: absolute;
          inset: 0;
          border: 3px solid transparent;
          border-image: conic-gradient(from var(--a, 0deg), #3b82f6, #8b5cf6, #ec4899, #f59e0b, #3b82f6) 1;
          animation: dyad-rotate-border 2s linear infinite;
        }
        @keyframes dyad-rotate-border {
          from { --a: 0deg; }
          to { --a: 360deg; }
        }
        #dyad-agent-status {
          position: fixed;
          bottom: 16px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(15, 23, 42, 0.9);
          color: #f8fafc;
          padding: 8px 16px;
          border-radius: 9999px;
          font-size: 13px;
          font-family: system-ui, sans-serif;
          display: flex;
          align-items: center;
          gap: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          backdrop-filter: blur(8px);
          pointer-events: auto;
        }
        #dyad-agent-dot {
          width: 8px; height: 8px;
          background: #3b82f6;
          border-radius: 50%;
          animation: dyad-pulse 1.5s ease-in-out infinite;
        }
        @keyframes dyad-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.3); }
        }
        @property --a {
          syntax: '<angle>';
          initial-value: 0deg;
          inherits: false;
        }
      </style>
      <div id="dyad-agent-border"></div>
      <div id="dyad-agent-status">
        <div id="dyad-agent-dot"></div>
        <span>${statusText}</span>
      </div>
    `;
    document.body.appendChild(overlay);
  }, status);
}

/**
 * Remove the agent activity overlay.
 */
export async function hideAgentOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    const overlay = document.getElementById("dyad-agent-overlay");
    if (overlay) {
      overlay.style.animation = "dyad-fade-in 300ms ease-out reverse";
      setTimeout(() => overlay.remove(), 300);
    }
  });
}
