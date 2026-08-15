/**
 * Structured Logger — Simple version that works in renderer
 */

interface LogContext {
  [key: string]: unknown;
}

interface ErrorContext extends LogContext {
  error?: Error | string;
  stack?: string;
  component?: string;
  operation?: string;
  userId?: string;
  appId?: number;
}

function formatMessage(msg: string, context?: LogContext): string {
  if (!context || Object.keys(context).length === 0) return msg;
  const ctxStr = JSON.stringify(context);
  return `${msg} ${ctxStr}`;
}

const structuredLogger = {
  error(message: string, context?: ErrorContext): void {
    const fullContext = {
      ...context,
      timestamp: Date.now(),
      level: "error",
    };
    console.error(formatMessage(message, fullContext));
  },

  warn(message: string, context?: LogContext): void {
    const fullContext = {
      ...context,
      timestamp: Date.now(),
      level: "warn",
    };
    console.warn(formatMessage(message, fullContext));
  },

  info(message: string, context?: LogContext): void {
    const fullContext = {
      ...context,
      timestamp: Date.now(),
      level: "info",
    };
    console.info(formatMessage(message, fullContext));
  },

  debug(message: string, context?: LogContext): void {
    if (process.env.NODE_ENV !== "production") {
      const fullContext = {
        ...context,
        timestamp: Date.now(),
        level: "debug",
      };
      console.debug(formatMessage(message, fullContext));
    }
  },

  captureException(error: Error, context?: LogContext): void {
    console.error("Captured exception:", error, context);
  },

  async getRecentErrors(_count?: number): Promise<unknown[]> {
    return [];
  },

  startSpan(_name: string, _operation: string): { finish: () => void } | null {
    return null;
  },
};

export default structuredLogger;
export const logger = structuredLogger;

export function logError(error: unknown, context?: ErrorContext): void {
  const err = error instanceof Error ? error : new Error(String(error));
  structuredLogger.error(err.message, { ...context, error: err });
}

export function logWarning(message: string, context?: LogContext): void {
  structuredLogger.warn(message, context);
}

export function logInfo(message: string, context?: LogContext): void {
  structuredLogger.info(message, context);
}
