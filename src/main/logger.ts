/**
 * Main Process Logger — Full file logging for main process
 *
 * This version includes file system operations for main process only.
 * Renderer should use the browser-compatible structured_logger.ts
 */

import fs from "node:fs/promises";
import path from "node:path";
import log from "electron-log";

// ── Configuration ────────────────────────────────────────────────────────────

const CONFIG = {
  // Local error log directory
  logDir: path.join(process.cwd(), "logs"),

  // Max local log size (10MB)
  maxLogSize: 10 * 1024 * 1024,
};

// ── Local Error Log ──────────────────────────────────────────────────────────

interface ErrorLogEntry {
  timestamp: string;
  level: "error" | "warn" | "info" | "debug";
  message: string;
  context?: Record<string, unknown>;
  stack?: string;
  component?: string;
}

class LocalErrorLog {
  private logFile: string;
  private initialized = false;

  constructor(private logDir: string) {
    this.logFile = path.join(logDir, "errors.jsonl");
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      await fs.mkdir(this.logDir, { recursive: true });

      // Rotate if too large
      try {
        const stat = await fs.stat(this.logFile);
        if (stat.size > CONFIG.maxLogSize) {
          await fs.rename(this.logFile, `${this.logFile}.${Date.now()}`);
        }
      } catch {
        // File doesn't exist yet — fine
      }

      this.initialized = true;
    } catch (error) {
      log.warn("Failed to initialize local error log:", error);
    }
  }

  async append(entry: ErrorLogEntry): Promise<void> {
    if (!this.initialized) await this.init();

    try {
      const line = JSON.stringify(entry) + "\n";
      await fs.appendFile(this.logFile, line, "utf-8");
    } catch {
      // Silently fail — don't crash on logging failure
    }
  }

  async readRecent(count = 100): Promise<ErrorLogEntry[]> {
    try {
      const content = await fs.readFile(this.logFile, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      return lines
        .slice(-count)
        .map((line) => {
          try {
            return JSON.parse(line) as ErrorLogEntry;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is ErrorLogEntry => entry !== null);
    } catch {
      return [];
    }
  }
}

const localLog = new LocalErrorLog(CONFIG.logDir);

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function serializeError(error: unknown): {
  message: string;
  stack?: string;
  name?: string;
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      name: error.name,
    };
  }
  return {
    message: String(error),
  };
}

function formatMessage(msg: string, context?: LogContext): string {
  if (!context || Object.keys(context).length === 0) return msg;
  const ctxStr = JSON.stringify(context);
  return `${msg} ${ctxStr}`;
}

// ── Main Process Logger ─────────────────────────────────────────────────────

const mainLogger = {
  /**
   * Log error with full context
   * Writes to local JSONL file for debugging
   */
  error(message: string, context?: ErrorContext): void {
    const serialized = context?.error
      ? serializeError(context.error)
      : undefined;
    const fullContext = {
      ...context,
      ...(serialized && { error: serialized }),
      timestamp: Date.now(),
      level: "error",
    };

    // Log to electron-log
    log.error(formatMessage(message, fullContext));

    // Write to local error log
    void localLog.append({
      timestamp: new Date().toISOString(),
      level: "error",
      message,
      context: fullContext,
      stack: serialized?.stack,
      component: context?.component,
    });
  },

  /**
   * Log warning with context
   */
  warn(message: string, context?: LogContext): void {
    const fullContext = {
      ...context,
      timestamp: Date.now(),
      level: "warn",
    };
    log.warn(formatMessage(message, fullContext));

    void localLog.append({
      timestamp: new Date().toISOString(),
      level: "warn",
      message,
      context: fullContext,
    });
  },

  /**
   * Log info with context
   */
  info(message: string, context?: LogContext): void {
    const fullContext = {
      ...context,
      timestamp: Date.now(),
      level: "info",
    };
    log.info(formatMessage(message, fullContext));
  },

  /**
   * Log debug (only in development)
   */
  debug(message: string, context?: LogContext): void {
    if (process.env.NODE_ENV !== "production") {
      const fullContext = {
        ...context,
        timestamp: Date.now(),
        level: "debug",
      };
      log.debug(formatMessage(message, fullContext));
    }
  },

  /**
   * Capture exception without logging (for already-logged errors)
   */
  captureException(error: Error, context?: LogContext): void {
    void localLog.append({
      timestamp: new Date().toISOString(),
      level: "error",
      message: error.message,
      context,
      stack: error.stack,
    });
  },

  /**
   * Get recent errors (for debugging)
   */
  async getRecentErrors(count?: number): Promise<ErrorLogEntry[]> {
    return localLog.readRecent(count);
  },

  /**
   * Start a performance span (no-op without external service)
   */
  startSpan(_name: string, _operation: string): { finish: () => void } | null {
    return null;
  },
};

export default mainLogger;

// ── Convenience Exports ─────────────────────────────────────────────────────

export const logger = mainLogger;

export function logError(error: unknown, context?: ErrorContext): void {
  const err = error instanceof Error ? error : new Error(String(error));
  mainLogger.error(err.message, { ...context, error: err });
}

export function logWarning(message: string, context?: LogContext): void {
  mainLogger.warn(message, context);
}

export function logInfo(message: string, context?: LogContext): void {
  mainLogger.info(message, context);
}
