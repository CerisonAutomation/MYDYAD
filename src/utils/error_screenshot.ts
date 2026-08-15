/**
 * Auto-screenshot on errors — attaches preview screenshots to error reports.
 *
 * Uses the main process capturePage() API via IPC. The screenshot is resized
 * to 800px wide to keep the base64 payload under 500 KB for PostHog.
 *
 * All functions are safe to call from the renderer — they gracefully degrade
 * if the IPC bridge is unavailable or the capture fails.
 */

import { ipc } from "@/ipc/types";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ErrorScreenshot {
  /** Base64 PNG data URL */
  dataUrl: string;
  /** Timestamp when the screenshot was captured */
  timestamp: number;
}

// ── Cache ────────────────────────────────────────────────────────────────────

let lastScreenshot: ErrorScreenshot | null = null;
let pendingCapture: Promise<ErrorScreenshot> | null = null;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Capture a screenshot of the current window for error context.
 * Returns cached screenshot if one was captured within the last 5 seconds.
 * Returns empty dataUrl if capture fails (never throws).
 */
export async function captureErrorScreenshot(): Promise<ErrorScreenshot> {
  // Return cached screenshot if recent
  if (lastScreenshot && Date.now() - lastScreenshot.timestamp < 5000) {
    return lastScreenshot;
  }

  // Deduplicate concurrent captures
  if (pendingCapture) {
    return pendingCapture;
  }

  pendingCapture = doCapture();
  try {
    const result = await pendingCapture;
    lastScreenshot = result;
    return result;
  } finally {
    pendingCapture = null;
  }
}

/**
 * Get the last captured error screenshot, if any.
 * Useful for attaching to error reports without triggering a new capture.
 */
export function getLastErrorScreenshot(): ErrorScreenshot | null {
  return lastScreenshot;
}

/**
 * Clear the cached screenshot (e.g., after it's been attached to a report).
 */
export function clearErrorScreenshot(): void {
  lastScreenshot = null;
}

// ── Internal ─────────────────────────────────────────────────────────────────

async function doCapture(): Promise<ErrorScreenshot> {
  try {
    const result = await ipc.instructions.captureErrorScreenshot();
    return result;
  } catch {
    // Never let screenshot failure break error reporting
    return { dataUrl: "", timestamp: Date.now() };
  }
}
