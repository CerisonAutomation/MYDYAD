/**
 * Retry Utility — Handles transient failures with exponential backoff
 */

import log from "electron-log";

const logger = log.scope("retry");

interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;

  /** Base delay in milliseconds (default: 1000) */
  baseDelay?: number;

  /** Maximum delay in milliseconds (default: 10000) */
  maxDelay?: number;

  /** Function to determine if error is retryable */
  isRetryable?: (error: Error) => boolean;

  /** Operation name for logging */
  operationName?: string;
}

/**
 * Execute a function with retry logic and exponential backoff
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => page.goto(url),
 *   { maxRetries: 3, operationName: "navigate" }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    isRetryable = defaultIsRetryable,
    operationName = "operation",
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      if (attempt === maxRetries || !isRetryable(lastError)) {
        break;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);

      logger.warn(
        `Retry ${attempt}/${maxRetries} for ${operationName} after ${delay}ms`,
        {
          error: lastError.message,
          attempt,
          delay,
        },
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Default retryable error check
 * Retries on network errors, timeouts, and element not found
 */
function defaultIsRetryable(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Network errors
  if (message.includes("net::")) return true;
  if (message.includes("econnreset")) return true;
  if (message.includes("econnrefused")) return true;
  if (message.includes("etimedout")) return true;

  // Timeout errors
  if (message.includes("timeout")) return true;
  if (message.includes("timed out")) return true;

  // Element not found (might appear after navigation)
  if (message.includes("no element found")) return true;
  if (message.includes("element not found")) return true;
  if (message.includes("selector")) return true;

  // Page not ready
  if (message.includes("navigation")) return true;
  if (message.includes("loading")) return true;

  return false;
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: Error): boolean {
  return defaultIsRetryable(error);
}
