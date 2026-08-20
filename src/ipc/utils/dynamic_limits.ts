/**
 * Dynamic limits for Dyad tools and features.
 * These can be adjusted at runtime without rebuilding.
 */

import { performance } from "node:perf_hooks";

// ─── File & Content Limits ──────────────────────────────────────────────────

/** Maximum bytes read_file can return (maximized for mimo-v2.5 capability) */
export let READ_FILE_LIMIT_BYTES = 10 * 1024 * 1024;
export const READ_FILE_LIMIT_MAX = 10 * 1024 * 1024;
export const READ_FILE_LIMIT_MIN = 64 * 1024;

/** Maximum bytes web_fetch can return (maximized for mimo-v2.5 capability) */
export let WEB_FETCH_LIMIT_BYTES = 5 * 1024 * 1024;
export const WEB_FETCH_LIMIT_MAX = 5 * 1024 * 1024;
export const WEB_FETCH_LIMIT_MIN = 10 * 1024;

/** Maximum JSON body size for multifetch (maximized) */
export let MULTIFETCH_JSON_LIMIT = 2 * 1024 * 1024;
export const MULTIFETCH_JSON_LIMIT_MAX = 2 * 1024 * 1024;

/** Maximum per-URL content in multifetch (maximized) */
export let MULTIFETCH_URL_LIMIT = 500 * 1024;
export const MULTIFETCH_URL_LIMIT_MAX = 500 * 1024;

/** Maximum tool error message length (maximized) */
export let TOOL_ERROR_LIMIT_CHARS = 100_000;
export const TOOL_ERROR_LIMIT_MAX = 100_000;

/** Maximum message history length (maximized) */
export let MESSAGE_HISTORY_LIMIT = 10_000;
export const MESSAGE_HISTORY_LIMIT_MAX = 10_000;

// ─── API Limits ─────────────────────────────────────────────────────────────

/** Default maxOutputTokens — mimo-v2.5 outputs up to 128K tokens */
export let DEFAULT_MAX_OUTPUT_TOKENS = 128_000;
export const MAX_OUTPUT_TOKENS_MAX = 128_000;

/** Default maxRetries for API calls (maximized) */
export let DEFAULT_MAX_RETRIES = 10;
export const MAX_RETRIES_MAX = 10;

/** Sandbox script timeout in ms (maximized to 5 minutes) */
export let SANDBOX_TIMEOUT_MS = 5 * 60 * 1000;
export const SANDBOX_TIMEOUT_MAX = 5 * 60 * 1000;

// ─── Dynamic Adjustment ─────────────────────────────────────────────────────

interface LimitUpdate {
  key: string;
  value: number;
  timestamp: number;
}

const limitHistory: LimitUpdate[] = [];

/**
 * Dynamically adjust a limit. Validates bounds and logs the change.
 * Returns the new value, or the old value if the adjustment was rejected.
 */
export function adjustLimit(
  name: string,
  newValue: number,
): number {
  const limits: Record<string, { current: () => number; set: (v: number) => void; min: number; max: number }> = {
    read_file_limit: {
      get current() { return READ_FILE_LIMIT_BYTES; },
      set: (v) => { READ_FILE_LIMIT_BYTES = v; },
      min: READ_FILE_LIMIT_MIN, max: READ_FILE_LIMIT_MAX,
    },
    web_fetch_limit: {
      get current() { return WEB_FETCH_LIMIT_BYTES; },
      set: (v) => { WEB_FETCH_LIMIT_BYTES = v; },
      min: WEB_FETCH_LIMIT_MIN, max: WEB_FETCH_LIMIT_MAX,
    },
    multifetch_json_limit: {
      get current() { return MULTIFETCH_JSON_LIMIT; },
      set: (v) => { MULTIFETCH_JSON_LIMIT = v; },
      min: 10_000, max: MULTIFETCH_JSON_LIMIT_MAX,
    },
    multifetch_url_limit: {
      get current() { return MULTIFETCH_URL_LIMIT; },
      set: (v) => { MULTIFETCH_URL_LIMIT = v; },
      min: 5_000, max: MULTIFETCH_URL_LIMIT_MAX,
    },
    tool_error_limit: {
      get current() { return TOOL_ERROR_LIMIT_CHARS; },
      set: (v) => { TOOL_ERROR_LIMIT_CHARS = v; },
      min: 4_000, max: TOOL_ERROR_LIMIT_MAX,
    },
    message_history_limit: {
      get current() { return MESSAGE_HISTORY_LIMIT; },
      set: (v) => { MESSAGE_HISTORY_LIMIT = v; },
      min: 100, max: MESSAGE_HISTORY_LIMIT_MAX,
    },
    max_output_tokens: {
      get current() { return DEFAULT_MAX_OUTPUT_TOKENS; },
      set: (v) => { DEFAULT_MAX_OUTPUT_TOKENS = v; },
      min: 4_096, max: MAX_OUTPUT_TOKENS_MAX,
    },
    max_retries: {
      get current() { return DEFAULT_MAX_RETRIES; },
      set: (v) => { DEFAULT_MAX_RETRIES = v; },
      min: 1, max: MAX_RETRIES_MAX,
    },
    sandbox_timeout: {
      get current() { return SANDBOX_TIMEOUT_MS; },
      set: (v) => { SANDBOX_TIMEOUT_MS = v; },
      min: 5_000, max: SANDBOX_TIMEOUT_MAX,
    },
  };

  const limit = limits[name];
  if (!limit) {
    throw new Error(`Unknown limit: ${name}. Available: ${Object.keys(limits).join(", ")}`);
  }

  const clamped = Math.max(limit.min, Math.min(limit.max, Math.round(newValue)));
  const oldValue = limit.current;

  if (clamped === oldValue) return oldValue;

  limit.set(clamped);
  limitHistory.push({ key: name, value: clamped, timestamp: Date.now() });

  // Keep last 100 updates
  if (limitHistory.length > 100) limitHistory.shift();

  return clamped;
}

/**
 * Get current value of a named limit.
 */
export function getLimit(name: string): number {
  const limits: Record<string, number> = {
    read_file_limit: READ_FILE_LIMIT_BYTES,
    web_fetch_limit: WEB_FETCH_LIMIT_BYTES,
    multifetch_json_limit: MULTIFETCH_JSON_LIMIT,
    multifetch_url_limit: MULTIFETCH_URL_LIMIT,
    tool_error_limit: TOOL_ERROR_LIMIT_CHARS,
    message_history_limit: MESSAGE_HISTORY_LIMIT,
    max_output_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
    max_retries: DEFAULT_MAX_RETRIES,
    sandbox_timeout: SANDBOX_TIMEOUT_MS,
  };
  if (!(name in limits)) throw new Error(`Unknown limit: ${name}`);
  return limits[name];
}

/**
 * Get all current limits as a snapshot.
 */
export function getAllLimits(): Record<string, number> {
  return {
    read_file_limit: READ_FILE_LIMIT_BYTES,
    web_fetch_limit: WEB_FETCH_LIMIT_BYTES,
    multifetch_json_limit: MULTIFETCH_JSON_LIMIT,
    multifetch_url_limit: MULTIFETCH_URL_LIMIT,
    tool_error_limit: TOOL_ERROR_LIMIT_CHARS,
    message_history_limit: MESSAGE_HISTORY_LIMIT,
    max_output_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
    max_retries: DEFAULT_MAX_RETRIES,
    sandbox_timeout: SANDBOX_TIMEOUT_MS,
  };
}

/**
 * Get recent limit change history.
 */
export function getLimitHistory(): LimitUpdate[] {
  return [...limitHistory];
}

/**
 * Auto-scale limits based on available system memory.
 * Called periodically by the performance monitor.
 * Currently disabled — all limits are at maximum for mimo-v2.5 capability.
 */
export function autoScaleLimits(): void {
  // All limits are already at maximum. No auto-scaling needed.
  // Re-enable if memory pressure becomes an issue.
}
