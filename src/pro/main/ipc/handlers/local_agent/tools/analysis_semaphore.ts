/**
 * Concurrency limiter for heavy analysis tools.
 *
 * When the AI model requests multiple file-scanning tools simultaneously,
 * the AI SDK executes them all in parallel. Each tool walks the file tree,
 * reads hundreds of files, and runs regex/AST analysis. Running 10+ of
 * these at once saturates the Node.js event loop with I/O microtasks,
 * causing a CPU spin freeze (main thread stuck in uv_run → microtask loop).
 *
 * This module provides a semaphore that limits how many heavy tools can
 * execute concurrently, plus a result cache so the agent can reference
 * previous analysis results without re-scanning.
 */

import log from "electron-log";

const logger = log.scope("analysis_semaphore");

// ── Concurrency Semaphore ────────────────────────────────────────────

const MAX_CONCURRENT_HEAVY_TOOLS = 2;

let activeCount = 0;
const waitQueue: Array<() => void> = [];

/**
 * Acquire a slot. Returns a release function that MUST be called when done.
 * Heavy tools wrap their execute() body with this:
 *
 * ```ts
 * const release = await acquireAnalysisSlot();
 * try { /* ... *\/ } finally { release(); }
 * ```
 */
export async function acquireAnalysisSlot(): Promise<() => void> {
  if (activeCount < MAX_CONCURRENT_HEAVY_TOOLS) {
    activeCount++;
    logger.debug(
      `Analysis slot acquired (${activeCount}/${MAX_CONCURRENT_HEAVY_TOOLS} active)`,
    );
    return () => {
      activeCount--;
      logger.debug(
        `Analysis slot released (${activeCount}/${MAX_CONCURRENT_HEAVY_TOOLS} active)`,
      );
      flushQueue();
    };
  }

  // Wait for a slot to free up
  return new Promise<() => void>((resolve) => {
    waitQueue.push(() => {
      activeCount++;
      logger.debug(
        `Analysis slot acquired from queue (${activeCount}/${MAX_CONCURRENT_HEAVY_TOOLS} active)`,
      );
      resolve(() => {
        activeCount--;
        logger.debug(
          `Analysis slot released (${activeCount}/${MAX_CONCURRENT_HEAVY_TOOLS} active)`,
        );
        flushQueue();
      });
    });
  });
}

function flushQueue(): void {
  while (waitQueue.length > 0 && activeCount < MAX_CONCURRENT_HEAVY_TOOLS) {
    const next = waitQueue.shift();
    if (next) next();
  }
}

// ── Result Cache ─────────────────────────────────────────────────────

interface CacheEntry {
  result: string;
  timestamp: number;
  appPath: string;
}

const resultCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX = 50;

/**
 * Get a cached analysis result. Returns null if not cached or expired.
 */
export function getCachedResult(
  toolName: string,
  appPath: string,
): string | null {
  const key = `${toolName}:${appPath}`;
  const entry = resultCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    resultCache.delete(key);
    return null;
  }
  return entry.result;
}

/**
 * Store an analysis result in cache.
 */
export function cacheResult(
  toolName: string,
  appPath: string,
  result: string,
): void {
  // Evict oldest if at capacity
  if (resultCache.size >= CACHE_MAX) {
    const oldest = resultCache.keys().next().value;
    if (oldest) resultCache.delete(oldest);
  }
  resultCache.set(`${toolName}:${appPath}`, {
    result,
    timestamp: Date.now(),
    appPath,
  });
}

/**
 * Invalidate all cached results for a given app path (e.g. after files change).
 */
export function invalidateCache(appPath: string): void {
  for (const [key, entry] of resultCache) {
    if (entry.appPath === appPath) {
      resultCache.delete(key);
    }
  }
}

/**
 * Get cache stats for debugging.
 */
export function getCacheStats(): {
  size: number;
  entries: Array<{ key: string; age: number }>;
} {
  const now = Date.now();
  const entries: Array<{ key: string; age: number }> = [];
  for (const [key, entry] of resultCache) {
    entries.push({ key, age: now - entry.timestamp });
  }
  return { size: resultCache.size, entries };
}

// ── Tool Wrapper ─────────────────────────────────────────────────────

import type { ToolDefinition, AgentContext } from "./types";

/**
 * Wraps a heavy analysis tool with concurrency limiting and result caching.
 *
 * - Acquires a semaphore slot before executing (max 2 concurrent heavy tools)
 * - Checks cache before executing; returns cached result if fresh
 * - Stores result in cache after execution
 * - Always releases the semaphore slot, even on error
 *
 * Usage in tool_definitions.ts:
 * ```ts
 * import { withAnalysisGuard } from "./analysis_semaphore";
 * export const codeSmellsTool = withAnalysisGuard(_codeSmellsTool);
 * ```
 */
export function withAnalysisGuard<T>(
  tool: ToolDefinition<T>,
): ToolDefinition<T> {
  const originalExecute = tool.execute;

  return {
    ...tool,
    execute: async (args: T, ctx: AgentContext) => {
      // Resolve the app path for caching
      const appPath = (args as Record<string, unknown>).app_name
        ? (ctx.referencedApps.get(
            String((args as Record<string, unknown>).app_name).toLowerCase(),
          ) ?? ctx.appPath)
        : ctx.appPath;

      // Check cache first
      const cached = getCachedResult(tool.name, appPath);
      if (cached) {
        logger.log(`Cache hit for ${tool.name} on ${appPath}`);
        // Return cached result directly — do NOT call onXmlComplete here
        // because the cached value is the tool's return text, not the full
        // XML the tool emits during execution. The handler will use the
        // return value as the tool result text for the agent.
        return cached;
      }

      // Acquire semaphore slot
      const release = await acquireAnalysisSlot();
      try {
        const result = await originalExecute(args, ctx);
        // Cache successful results
        if (result && typeof result === "string") {
          cacheResult(tool.name, appPath, result);
        }
        return result;
      } finally {
        release();
      }
    },
  };
}
