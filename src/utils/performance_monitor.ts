import log from "electron-log";
import { app } from "electron";
import { writeSettings } from "../main/settings";
import os from "node:os";
import v8 from "node:v8";
import {
  isExtractCodebaseActive,
  type ActivitySnapshot,
} from "./memory_activity";
import { getActiveStreamCount } from "../ipc/handlers/chat_stream_handlers";
import { runningApps } from "../ipc/utils/process_manager";
import { typescriptUtilityProcessScheduler } from "../ipc/processors/typescript_utility_process_scheduler";
import { runHealthCheck } from "../ipc/handlers/health_check_handlers";
import { db } from "../db";

const logger = log.scope("performance-monitor");

// Constants
const MONITOR_INTERVAL_MS = 30000; // 30 seconds
const BYTES_PER_MB = 1024 * 1024;

let monitorInterval: NodeJS.Timeout | null = null;
let lastCpuUsage: NodeJS.CpuUsage | null = null;
let lastTimestamp: number | null = null;
let lastSystemCpuInfo: os.CpuInfo[] | null = null;
let lastSystemTimestamp: number | null = null;

// Auto-healing state
let consecutiveCriticalCount = 0;
const CRITICAL_THRESHOLD_FOR_RESTART = 3;

// Session memory highs. peakRssMB comes from the kernel and is exact; the
// others are maxima over sampled values and can miss short spikes.
let peakHeapUsedMB = 0;
let peakHeapPct = 0;
let peakRssMB = 0;
const peakProcessWorkingSetsMB: Record<string, number> = {};
let peakActivity: ActivitySnapshot | null = null;
let peakTimestamp: number | null = null;

/**
 * Get current memory usage in MB
 */
function getMemoryUsageMB(): number {
  const memoryUsage = process.memoryUsage();
  // Use RSS (Resident Set Size) for total memory used by the process
  return Math.round(memoryUsage.rss / BYTES_PER_MB);
}

/**
 * Get main process V8 heap usage and limit in MB
 */
function getHeapStatsMB(): { heapUsedMB: number; heapLimitMB: number } {
  const stats = v8.getHeapStatistics();
  return {
    heapUsedMB: Math.round(stats.used_heap_size / BYTES_PER_MB),
    heapLimitMB: Math.round(stats.heap_size_limit / BYTES_PER_MB),
  };
}

/**
 * Get working set per Electron process type in MB, e.g.
 * { browser: 400, tab: 900, gpu: 120, utility: 300 }.
 * Main process RSS alone dramatically understates real usage.
 * Cheap (no shell-outs); safe for periodic capture.
 */
function getProcessWorkingSetsMB(): Record<string, number> | null {
  try {
    const sets: Record<string, number> = {};
    for (const metric of app.getAppMetrics()) {
      const key = metric.type.toLowerCase();
      sets[key] = (sets[key] ?? 0) + metric.memory.workingSetSize / 1024;
    }
    for (const key of Object.keys(sets)) {
      sets[key] = Math.round(sets[key]);
    }
    return sets;
  } catch {
    return null;
  }
}

/**
 * Get the kernel-tracked peak RSS of the main process in MB.
 * Exact for the whole process lifetime, even between samples.
 */
function getKernelPeakRssMB(): number {
  // maxRSS is reported in kilobytes
  return Math.round(process.resourceUsage().maxRSS / 1024);
}

/**
 * What the main process is doing right now
 */
function snapshotActivity(): ActivitySnapshot {
  return {
    activeStreams: getActiveStreamCount(),
    runningApps: runningApps.size,
    extractCodebase: isExtractCodebaseActive(),
    tsUtilityProcess: typescriptUtilityProcessScheduler.activeOperationKind(),
  };
}

/**
 * Get CPU usage percentage
 * This measures CPU time used by this process relative to wall clock time
 */
function getCpuUsagePercent(): number | null {
  const currentCpuUsage = process.cpuUsage();
  const currentTimestamp = Date.now();

  // On first call, just initialize and return null
  if (lastCpuUsage === null || lastTimestamp === null) {
    lastCpuUsage = currentCpuUsage;
    lastTimestamp = currentTimestamp;
    return null;
  }

  // Calculate elapsed wall clock time in microseconds
  const elapsedTimeMs = currentTimestamp - lastTimestamp;
  const elapsedTimeMicros = elapsedTimeMs * 1000;

  // Calculate CPU time used (user + system) in microseconds
  const cpuTimeMicros =
    currentCpuUsage.user -
    lastCpuUsage.user +
    (currentCpuUsage.system - lastCpuUsage.system);

  // CPU percentage = (CPU time / wall clock time) * 100
  // This gives percentage across all cores (can exceed 100% on multi-core systems)
  const cpuPercent =
    elapsedTimeMicros > 0 ? (cpuTimeMicros / elapsedTimeMicros) * 100 : 0;

  // Update for next calculation
  lastCpuUsage = currentCpuUsage;
  lastTimestamp = currentTimestamp;

  return Math.round(cpuPercent * 100) / 100; // Round to 2 decimal places
}

/**
 * Get system memory usage
 */
function getSystemMemoryUsage(): {
  totalMemoryMB: number;
  usedMemoryMB: number;
  freeMemoryMB: number;
  usagePercent: number;
} {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;

  return {
    totalMemoryMB: Math.round(totalMemory / BYTES_PER_MB),
    usedMemoryMB: Math.round(usedMemory / BYTES_PER_MB),
    freeMemoryMB: Math.round(freeMemory / BYTES_PER_MB),
    usagePercent: Math.round((usedMemory / totalMemory) * 100 * 100) / 100,
  };
}

/**
 * Get system CPU usage percentage
 */
function getSystemCpuUsagePercent(): number | null {
  const cpus = os.cpus();
  const currentTimestamp = Date.now();

  // On first call, just initialize and return null
  if (lastSystemCpuInfo === null || lastSystemTimestamp === null) {
    lastSystemCpuInfo = cpus;
    lastSystemTimestamp = currentTimestamp;
    return null;
  }

  // Calculate total CPU time for all cores
  let totalIdle = 0;
  let totalTick = 0;
  let lastTotalIdle = 0;
  let lastTotalTick = 0;

  // Current CPU times
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type as keyof typeof cpu.times];
    }
    totalIdle += cpu.times.idle;
  }

  // Last CPU times
  for (const cpu of lastSystemCpuInfo) {
    for (const type in cpu.times) {
      lastTotalTick += cpu.times[type as keyof typeof cpu.times];
    }
    lastTotalIdle += cpu.times.idle;
  }

  // Calculate differences
  const totalTickDiff = totalTick - lastTotalTick;
  const idleDiff = totalIdle - lastTotalIdle;

  // Calculate usage percentage (guard against zero diff)
  const usage = totalTickDiff > 0 ? 100 - (100 * idleDiff) / totalTickDiff : 0;

  // Update for next calculation
  lastSystemCpuInfo = cpus;
  lastSystemTimestamp = currentTimestamp;

  return Math.round(usage * 100) / 100;
}

/**
 * Capture and save current performance metrics
 */
function capturePerformanceMetrics() {
  try {
    const memoryUsageMB = getMemoryUsageMB();
    const processWorkingSetsMB = getProcessWorkingSetsMB();
    const allProcessesMemoryMB = processWorkingSetsMB
      ? Object.values(processWorkingSetsMB).reduce((sum, mb) => sum + mb, 0)
      : null;
    const cpuUsagePercent = getCpuUsagePercent();
    const systemMemory = getSystemMemoryUsage();
    const systemCpuPercent = getSystemCpuUsagePercent();

    // Event loop lag detection: if the event loop is starved, this timer
    // fires later than expected. A lag > 500ms indicates the main thread
    // is blocked (CPU spin, sync I/O, or long transaction).
    const loopStart = performance.now();
    setImmediate(() => {
      const lagMs = performance.now() - loopStart;
      if (lagMs > 500) {
        logger.warn(
          `Event loop lag detected: ${lagMs.toFixed(0)}ms — main thread may be blocked`,
        );
      }
    });

    // Skip saving if CPU is null (first call for either metric)
    if (cpuUsagePercent === null || systemCpuPercent === null) {
      logger.debug(
        `Performance: Memory=${memoryUsageMB}MB, All Processes=${allProcessesMemoryMB ?? "?"}MB, CPU=initializing, System Memory=${systemMemory.usagePercent}%, System CPU=initializing`,
      );
      return;
    }

    const { heapUsedMB, heapLimitMB } = getHeapStatsMB();
    const heapPct =
      heapLimitMB > 0
        ? Math.round((heapUsedMB / heapLimitMB) * 10000) / 100
        : 0;
    const kernelPeakRssMB = getKernelPeakRssMB();
    const activity = snapshotActivity();

    logger.debug(
      `Performance: Memory=${memoryUsageMB}MB, Heap=${heapUsedMB}/${heapLimitMB}MB, All Processes=${allProcessesMemoryMB ?? "?"}MB, CPU=${cpuUsagePercent}%, System Memory=${systemMemory.usedMemoryMB}/${systemMemory.totalMemoryMB}MB (${systemMemory.usagePercent}%), System CPU=${systemCpuPercent}%`,
    );

    // Child process working sets drift constantly, so only main process
    // peaks (heap, RSS) stamp peakActivity and peakTimestamp.
    let mainPeakAdvanced = false;
    if (heapUsedMB > peakHeapUsedMB) {
      peakHeapUsedMB = heapUsedMB;
      mainPeakAdvanced = true;
    }
    if (heapPct > peakHeapPct) {
      peakHeapPct = heapPct;
      mainPeakAdvanced = true;
    }
    if (kernelPeakRssMB > peakRssMB) {
      peakRssMB = kernelPeakRssMB;
      mainPeakAdvanced = true;
    }
    if (processWorkingSetsMB) {
      for (const [key, value] of Object.entries(processWorkingSetsMB)) {
        if (value > (peakProcessWorkingSetsMB[key] ?? 0)) {
          peakProcessWorkingSetsMB[key] = value;
        }
      }
    }
    if (mainPeakAdvanced) {
      peakActivity = activity;
      peakTimestamp = Date.now();
    }

    writeSettings({
      lastKnownPerformance: {
        timestamp: Date.now(),
        memoryUsageMB,
        cpuUsagePercent: Number.isFinite(cpuUsagePercent) ? cpuUsagePercent : 0,
        systemMemoryUsageMB: systemMemory.usedMemoryMB,
        systemMemoryTotalMB: systemMemory.totalMemoryMB,
        systemCpuPercent: Number.isFinite(systemCpuPercent)
          ? systemCpuPercent
          : 0,
        heapUsedMB,
        heapLimitMB,
        ...(processWorkingSetsMB && { processWorkingSetsMB }),
        activity,
        peakHeapUsedMB,
        peakHeapPct,
        peakRssMB,
        peakProcessWorkingSetsMB: { ...peakProcessWorkingSetsMB },
        ...(peakActivity && { peakActivity }),
        ...(peakTimestamp !== null && { peakTimestamp }),
      },
    });

    // Run health check and auto-heal if needed
    performHealthCheck().catch((err) => {
      logger.error("Health check failed", err);
    });
  } catch (error) {
    logger.error("Error capturing performance metrics:", error);
  }
}

/**
 * Perform health check and trigger auto-healing if needed.
 * - degraded: run WAL checkpoint, clear non-essential caches, log warning
 * - critical: same as degraded, plus track consecutive count
 * - critical for 3 consecutive checks: trigger app restart
 */
async function performHealthCheck(): Promise<void> {
  try {
    const result = await runHealthCheck();

    if (result.status === "critical") {
      consecutiveCriticalCount++;
      logger.warn(
        `Health check: CRITICAL (consecutive: ${consecutiveCriticalCount}/${CRITICAL_THRESHOLD_FOR_RESTART})`,
        result.checks,
      );

      // Auto-heal: run WAL checkpoint
      try {
        db.$client.pragma("wal_checkpoint(PASSIVE)");
        logger.info("Auto-heal: WAL checkpoint completed");
      } catch (err) {
        logger.error("Auto-heal: WAL checkpoint failed", err);
      }

      // Trigger app restart after 3 consecutive critical checks
      if (consecutiveCriticalCount >= CRITICAL_THRESHOLD_FOR_RESTART) {
        logger.error(
          `Health check: ${consecutiveCriticalCount} consecutive critical checks — triggering app restart`,
        );
        app.relaunch();
        app.exit(0);
      }
    } else if (result.status === "degraded") {
      consecutiveCriticalCount = 0;
      logger.warn("Health check: DEGRADED", result.checks);

      // Auto-heal: run WAL checkpoint
      try {
        db.$client.pragma("wal_checkpoint(PASSIVE)");
        logger.info("Auto-heal: WAL checkpoint completed");
      } catch (err) {
        logger.error("Auto-heal: WAL checkpoint failed", err);
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
        logger.info("Auto-heal: forced garbage collection");
      }
    } else {
      consecutiveCriticalCount = 0;
    }
  } catch (err) {
    logger.error("Health check failed", err);
  }
}

/**
 * Start monitoring performance metrics
 * Captures metrics every 30 seconds
 */
export function startPerformanceMonitoring() {
  if (monitorInterval) {
    logger.warn("Performance monitoring already started");
    return;
  }

  logger.info("Starting performance monitoring");

  // Capture initial metrics
  capturePerformanceMetrics();

  // Capture every 30 seconds
  monitorInterval = setInterval(capturePerformanceMetrics, MONITOR_INTERVAL_MS);
}

/**
 * Stop monitoring performance metrics
 */
export function stopPerformanceMonitoring() {
  if (monitorInterval) {
    logger.info("Stopping performance monitoring");
    clearInterval(monitorInterval);
    monitorInterval = null;

    // Capture final metrics before stopping
    capturePerformanceMetrics();
  }
}
