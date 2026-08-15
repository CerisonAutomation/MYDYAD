/**
 * Error Handling Utilities — DRY error patterns
 *
 * Provides:
 *   • Consistent error handling across codebase
 *   • Safe execution wrappers
 *   • Error context propagation
 *   • Recovery strategies
 */

import { logger } from "./structured_logger";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

// ── Types ────────────────────────────────────────────────────────────────────

interface ExecuteOptions<T> {
  /** Operation context for logging */
  context?: string;

  /** Called on error (before returning fallback) */
  onError?: (error: Error) => void;

  /** Return this value on failure instead of undefined */
  fallback?: T;

  /** Whether to log the error (default: true) */
  silent?: boolean;

  /** Additional context for error logging */
  metadata?: Record<string, unknown>;
}

interface WithRetryOptions<T> extends ExecuteOptions<T> {
  /** Max retry attempts (default: 3) */
  maxRetries?: number;

  /** Delay between retries in ms (default: 1000) */
  retryDelay?: number;

  /** Function to determine if retry is worthwhile */
  shouldRetry?: (error: Error, attempt: number) => boolean;
}

// ── Safe Execution ───────────────────────────────────────────────────────────

/**
 * Execute an operation safely with error handling
 *
 * @example
 * ```typescript
 * const result = await executeSafely(
 *   () => readFile(path),
 *   { context: "readFile", fallback: null }
 * );
 * ```
 */
export async function executeSafely<T>(
  operation: () => Promise<T>,
  options: ExecuteOptions<T> = {},
): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    if (!options.silent) {
      logger.error(`Operation failed: ${options.context || "unknown"}`, {
        error: err,
        component: "executeSafely",
        ...options.metadata,
      });
    }

    options.onError?.(err);
    return options.fallback;
  }
}

/**
 * Execute with retry logic
 *
 * @example
 * ```typescript
 * const data = await executeWithRetry(
 *   () => fetch(url),
 *   { maxRetries: 3, retryDelay: 1000 }
 * );
 * ```
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  options: WithRetryOptions<T> = {},
): Promise<T | undefined> {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    shouldRetry = () => true,
    ...executeOptions
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxRetries || !shouldRetry(lastError, attempt)) {
        break;
      }

      logger.warn(
        `Retry ${attempt}/${maxRetries} for ${executeOptions.context || "operation"}`,
        {
          error: lastError,
          attempt,
        },
      );

      await new Promise((resolve) => setTimeout(resolve, retryDelay * attempt));
    }
  }

  // All retries failed
  if (!executeOptions.silent) {
    logger.error(
      `Operation failed after ${maxRetries} retries: ${executeOptions.context || "unknown"}`,
      {
        error: lastError,
        component: "executeWithRetry",
        ...executeOptions.metadata,
      },
    );
  }

  executeOptions.onError?.(lastError!);
  return executeOptions.fallback;
}

// ── Error Transformation ─────────────────────────────────────────────────────

/**
 * Wrap unknown error into DyadError
 */
export function toDyadError(
  error: unknown,
  kind: DyadErrorKind = DyadErrorKind.Internal,
  context?: Record<string, unknown>,
): DyadError {
  if (error instanceof DyadError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  return new DyadError(message, kind, context);
}

/**
 * Assert condition or throw DyadError
 */
export function assert(
  condition: boolean,
  message: string,
  kind: DyadErrorKind = DyadErrorKind.Internal,
): asserts condition {
  if (!condition) {
    throw new DyadError(message, kind);
  }
}

/**
 * Assert value is defined or throw
 */
export function assertDefined<T>(
  value: T | null | undefined,
  name: string,
): asserts value is T {
  if (value === null || value === undefined) {
    throw new DyadError(
      `Expected ${name} to be defined`,
      DyadErrorKind.Internal,
      { cause: { name, value } },
    );
  }
}

// ── Error Collection ─────────────────────────────────────────────────────────

/**
 * Collect multiple errors without throwing
 */
export class ErrorCollector {
  private errors: Error[] = [];

  add(error: Error): void {
    this.errors.push(error);
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  getErrors(): readonly Error[] {
    return this.errors;
  }

  getMessages(): string[] {
    return this.errors.map((e) => e.message);
  }

  throwIfErrors(): void {
    if (this.errors.length > 0) {
      const message = `Multiple errors: ${this.errors.map((e) => e.message).join("; ")}`;
      throw new DyadError(message, DyadErrorKind.Internal, {
        cause: { errorCount: this.errors.length, errors: this.errors },
      });
    }
  }
}

// ── Resource Cleanup ─────────────────────────────────────────────────────────

/**
 * Ensure cleanup function runs even on error
 *
 * @example
 * ```typescript
 * const resource = await acquireResource();
 * return withCleanup(
 *   () => useResource(resource),
 *   () => resource.release()
 * );
 * ```
 */
export async function withCleanup<T>(
  operation: () => Promise<T>,
  cleanup: () => Promise<void> | void,
): Promise<T> {
  try {
    return await operation();
  } finally {
    try {
      await cleanup();
    } catch (cleanupError) {
      logger.warn("Cleanup failed", { error: cleanupError });
    }
  }
}

/**
 * Track and dispose multiple resources
 */
export class ResourceTracker {
  private cleanups: Array<() => Promise<void> | void> = [];

  track<T extends { dispose: () => Promise<void> | void }>(resource: T): T {
    this.cleanups.push(() => resource.dispose());
    return resource;
  }

  async disposeAll(): Promise<void> {
    const errors: Error[] = [];

    for (const cleanup of this.cleanups) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    this.cleanups = [];

    if (errors.length > 0) {
      logger.warn("Some cleanup operations failed", {
        errorCount: errors.length,
        errors,
      });
    }
  }
}
