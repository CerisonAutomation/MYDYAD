import { createTypedHandler } from "./base";
import { z } from "zod";
import { db } from "../../db";
import log from "electron-log";

const logger = log.scope("health_check");

// =============================================================================
// Health Check Contracts
// =============================================================================

const healthCheckContract = {
  channel: "health:check" as const,
  input: z.object({}),
  output: z.object({
    status: z.enum(["healthy", "degraded", "critical"]),
    checks: z.object({
      database: z.enum(["ok", "error"]),
      memory: z.enum(["ok", "warning", "critical"]),
      eventLoop: z.enum(["ok", "lagging"]),
    }),
    timestamp: z.number(),
  }),
};

// =============================================================================
// Health Check Logic (exported for use by performance monitor)
// =============================================================================

export type HealthCheckResult = z.infer<typeof healthCheckContract.output>;
export type HealthStatus = HealthCheckResult["status"];

/**
 * Run health checks and return the current status.
 * Can be called from both IPC handlers and the performance monitor.
 */
export async function runHealthCheck(): Promise<HealthCheckResult> {
  const checks: HealthCheckResult["checks"] = {
    database: "ok",
    memory: "ok",
    eventLoop: "ok",
  };

  // Check database connectivity
  try {
    db.$client.prepare("SELECT 1").get();
  } catch {
    checks.database = "error";
  }

  // Check memory usage
  const mem = process.memoryUsage();
  const heapUsedMB = mem.heapUsed / 1024 / 1024;
  if (heapUsedMB > 1000) {
    checks.memory = "critical";
  } else if (heapUsedMB > 500) {
    checks.memory = "warning";
  }

  // Check event loop responsiveness
  const start = Date.now();
  await new Promise((resolve) => setImmediate(resolve));
  const lag = Date.now() - start;
  if (lag > 500) {
    checks.eventLoop = "lagging";
  }

  // Determine overall status
  const status: HealthStatus =
    checks.database === "error" || checks.memory === "critical"
      ? "critical"
      : checks.eventLoop === "lagging" || checks.memory === "warning"
        ? "degraded"
        : "healthy";

  return { status, checks, timestamp: Date.now() };
}

// =============================================================================
// Handler Registration
// =============================================================================

export function registerHealthCheckHandlers() {
  createTypedHandler(healthCheckContract, async () => {
    const result = await runHealthCheck();
    logger.info(`Health check: ${result.status}`, result.checks);
    return result;
  });
}
