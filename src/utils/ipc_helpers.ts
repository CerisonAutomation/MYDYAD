/**
 * IPC Handler Utilities — DRY handler patterns
 *
 * Provides:
 *   • Consistent error handling in IPC handlers
 *   • Auto-validation with Zod
 *   • Structured logging
 *   • Performance tracking
 */

import { z } from "zod";
import { logger } from "./structured_logger";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { registerTrustedIpcHandler } from "@/ipc/handlers/trusted_handle";

// ── Types ────────────────────────────────────────────────────────────────────

type HandlerFunction<TInput, TOutput> = (input: TInput) => Promise<TOutput>;

interface HandlerOptions {
  /** Handler name for logging */
  name?: string;

  /** Whether to log execution time */
  logPerformance?: boolean;

  /** Whether to log errors (default: true) */
  logErrors?: boolean;
}

// ── Handler Factory ──────────────────────────────────────────────────────────

/**
 * Create a typed IPC handler with validation and error handling
 *
 * @example
 * ```typescript
 * const contract = {
 *   input: z.object({ appId: z.number() }),
 *   output: z.object({ status: z.string() }),
 * };
 *
 * createTypedHandler(contract, async (input) => {
 *   const app = getApp(input.appId);
 *   return { status: app.status };
 * });
 * ```
 */
export function createTypedHandler<TInput, TOutput>(
  channel: string,
  schema: z.ZodSchema<TInput>,
  handler: HandlerFunction<TInput, TOutput>,
  options: HandlerOptions = {},
) {
  const name = options.name || channel;

  registerTrustedIpcHandler(channel, async (event, rawInput) => {
    const startTime = Date.now();

    try {
      // Validate input
      const input = schema.parse(rawInput);

      // Execute handler
      const result = await handler(input);

      // Log performance
      if (options.logPerformance) {
        const duration = Date.now() - startTime;
        logger.debug(`IPC handler completed`, {
          handler: name,
          duration,
          success: true,
        });
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Log error
      if (options.logErrors !== false) {
        logger.error(`IPC handler failed`, {
          handler: name,
          error: error instanceof Error ? error : new Error(String(error)),
          duration,
          input: rawInput,
        });
      }

      // Transform to DyadError if needed
      if (error instanceof DyadError) {
        throw error;
      }

      // Handle Zod validation errors
      if (error instanceof z.ZodError) {
        throw new DyadError(
          `Invalid input: ${error.issues.map((e) => e.message).join(", ")}`,
          DyadErrorKind.Internal,
          { cause: { handler: name, validationErrors: error.issues } },
        );
      }

      // Handle unknown errors
      throw new DyadError(
        error instanceof Error ? error.message : String(error),
        DyadErrorKind.Internal,
        { cause: { handler: name } },
      );
    }
  });
}

/**
 * Simple typed handler (no schema validation)
 */
export function createSimpleHandler<TInput, TOutput>(
  channel: string,
  handler: HandlerFunction<TInput, TOutput>,
  options: HandlerOptions = {},
) {
  const name = options.name || channel;

  registerTrustedIpcHandler(channel, async (event, input) => {
    const startTime = Date.now();

    try {
      const result = await handler(input as TInput);

      if (options.logPerformance) {
        const duration = Date.now() - startTime;
        logger.debug(`IPC handler completed`, {
          handler: name,
          duration,
          success: true,
        });
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      if (options.logErrors !== false) {
        logger.error(`IPC handler failed`, {
          handler: name,
          error: error instanceof Error ? error : new Error(String(error)),
          duration,
        });
      }

      if (error instanceof DyadError) {
        throw error;
      }

      throw new DyadError(
        error instanceof Error ? error.message : String(error),
        DyadErrorKind.Internal,
        { cause: { handler: name } },
      );
    }
  });
}

// ── Utility Functions ────────────────────────────────────────────────────────

/**
 * Wrap handler with additional context
 */
export function withContext<TInput, TOutput>(
  handler: HandlerFunction<TInput, TOutput>,
  context: Record<string, unknown>,
): HandlerFunction<TInput, TOutput> {
  return async (input) => {
    logger.info(`Handler started`, { ...context, input });
    try {
      const result = await handler(input);
      logger.info(`Handler completed`, { ...context, success: true });
      return result;
    } catch (error) {
      logger.error(`Handler failed`, {
        ...context,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  };
}

/**
 * Add retry logic to handler
 */
export function withRetry<TInput, TOutput>(
  handler: HandlerFunction<TInput, TOutput>,
  options: { maxRetries?: number; delay?: number } = {},
): HandlerFunction<TInput, TOutput> {
  const { maxRetries = 3, delay = 1000 } = options;

  return async (input) => {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await handler(input);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxRetries) {
          logger.warn(`Handler retry ${attempt}/${maxRetries}`, {
            error: lastError,
            attempt,
          });
          await new Promise((resolve) => setTimeout(resolve, delay * attempt));
        }
      }
    }

    throw lastError;
  };
}

/**
 * Cache handler results
 */
export function withCache<TInput extends string | number, TOutput>(
  handler: HandlerFunction<TInput, TOutput>,
  options: { ttl?: number } = {},
): HandlerFunction<TInput, TOutput> {
  const { ttl = 60000 } = options;
  const cache = new Map<TInput, { value: TOutput; expires: number }>();

  return async (input) => {
    const cached = cache.get(input);
    if (cached && cached.expires > Date.now()) {
      return cached.value;
    }

    const result = await handler(input);
    cache.set(input, { value: result, expires: Date.now() + ttl });
    return result;
  };
}
