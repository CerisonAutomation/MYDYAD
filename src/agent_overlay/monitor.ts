/**
 * Agent Monitor — Tracks and reports on agent operations
 *
 * Records overlay tasks, toolkit calls, errors, and performance metrics.
 * Provides real-time monitoring and historical analysis.
 */

import type { AgentStatus, AgentTask } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface MonitorEvent {
  id: string;
  timestamp: number;
  type: "task_start" | "task_step" | "task_complete" | "task_error" |
        "tool_call" | "tool_result" | "tool_error" |
        "overlay_show" | "overlay_hide" |
        "diagnostic_run" | "diagnostic_result" |
        "performance" | "error";
  data: Record<string, unknown>;
  duration?: number;
}

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
}

export interface MonitorStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageTaskDuration: number;
  totalToolCalls: number;
  toolCallErrors: number;
  averageToolCallDuration: number;
  diagnosticRuns: number;
  uptime: number;
}

export interface MonitorConfig {
  enabled: boolean;
  maxEvents: number;
  maxMetrics: number;
  logToConsole: boolean;
  reportInterval: number; // ms
}

// ═══════════════════════════════════════════════════════════════════════════
// MONITOR CLASS
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: MonitorConfig = {
  enabled: true,
  maxEvents: 1000,
  maxMetrics: 500,
  logToConsole: false,
  reportInterval: 60000, // 1 minute
};

export class AgentMonitor {
  private events: MonitorEvent[] = [];
  private metrics: PerformanceMetric[] = [];
  private config: MonitorConfig;
  private startTime: number;
  private eventCounter = 0;
  private reportTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Array<(event: MonitorEvent) => void> = [];

  constructor(config: Partial<MonitorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startTime = Date.now();

    if (this.config.reportInterval > 0) {
      this.reportTimer = setInterval(() => {
        this.emitReport();
      }, this.config.reportInterval);
    }
  }

  // ── Event Recording ────────────────────────────────────────────────────

  private generateId(): string {
    this.eventCounter++;
    return `evt-${Date.now()}-${this.eventCounter}`;
  }

  record(type: MonitorEvent["type"], data: Record<string, unknown>, duration?: number): MonitorEvent {
    const event: MonitorEvent = {
      id: this.generateId(),
      timestamp: Date.now(),
      type,
      data,
      duration,
    };

    this.events.push(event);

    // Trim old events
    if (this.events.length > this.config.maxEvents) {
      this.events = this.events.slice(-this.config.maxEvents);
    }

    // Notify listeners
    for (const listener of this.listeners) {
      listener(event);
    }

    // Console logging
    if (this.config.logToConsole) {
      console.log(`[Monitor] ${type}`, data);
    }

    return event;
  }

  recordMetric(name: string, value: number, unit: string): void {
    this.metrics.push({
      name,
      value,
      unit,
      timestamp: Date.now(),
    });

    if (this.metrics.length > this.config.maxMetrics) {
      this.metrics = this.metrics.slice(-this.config.maxMetrics);
    }
  }

  // ── Task Tracking ──────────────────────────────────────────────────────

  trackTaskStart(task: AgentTask): void {
    this.record("task_start", {
      taskId: task.id,
      title: task.title,
      description: task.description,
    });
  }

  trackTaskStep(taskId: string, stepId: string, label: string, status: string): void {
    this.record("task_step", {
      taskId,
      stepId,
      label,
      status,
    });
  }

  trackTaskComplete(task: AgentTask): void {
    const duration = task.completedAt
      ? task.completedAt - task.startedAt
      : undefined;

    this.record("task_complete", {
      taskId: task.id,
      title: task.title,
      stepsCompleted: task.steps.filter((s) => s.status === "completed").length,
      stepsTotal: task.steps.length,
      progress: task.progress,
      error: task.error,
    }, duration);

    if (duration) {
      this.recordMetric("task_duration", duration, "ms");
    }
  }

  trackTaskError(taskId: string, error: string): void {
    this.record("task_error", {
      taskId,
      error,
    });
  }

  // ── Tool Call Tracking ─────────────────────────────────────────────────

  trackToolCall(tool: string, args: Record<string, unknown>): string {
    const eventId = this.generateId();
    this.record("tool_call", {
      eventId,
      tool,
      args,
    });
    return eventId;
  }

  trackToolResult(eventId: string, tool: string, success: boolean, result?: unknown, duration?: number): void {
    this.record("tool_result", {
      eventId,
      tool,
      success,
      result: result ? JSON.stringify(result).substring(0, 500) : undefined,
    }, duration);

    if (duration) {
      this.recordMetric(`tool_${tool}_duration`, duration, "ms");
    }
  }

  trackToolError(tool: string, error: string): void {
    this.record("tool_error", {
      tool,
      error,
    });
  }

  // ── Overlay Tracking ───────────────────────────────────────────────────

  trackOverlayShow(): void {
    this.record("overlay_show", {});
  }

  trackOverlayHide(): void {
    this.record("overlay_hide", {});
  }

  // ── Diagnostic Tracking ────────────────────────────────────────────────

  trackDiagnosticRun(tools: string[]): string {
    const eventId = this.generateId();
    this.record("diagnostic_run", {
      eventId,
      tools,
    });
    return eventId;
  }

  trackDiagnosticResult(eventId: string, results: Record<string, unknown>): void {
    this.record("diagnostic_result", {
      eventId,
      resultKeys: Object.keys(results),
    });
  }

  // ── Error Tracking ─────────────────────────────────────────────────────

  trackError(error: Error, context?: Record<string, unknown>): void {
    this.record("error", {
      message: error.message,
      stack: error.stack?.substring(0, 500),
      context,
    });
  }

  // ── Statistics ─────────────────────────────────────────────────────────

  getStats(): MonitorStats {
    const taskStarts = this.events.filter((e) => e.type === "task_start");
    const taskCompletes = this.events.filter((e) => e.type === "task_complete");
    const taskErrors = this.events.filter((e) => e.type === "task_error");
    const toolCalls = this.events.filter((e) => e.type === "tool_call");
    const toolResults = this.events.filter((e) => e.type === "tool_result");
    const toolErrors = this.events.filter((e) => e.type === "tool_error");
    const diagnosticRuns = this.events.filter((e) => e.type === "diagnostic_run");

    const taskDurations = taskCompletes
      .map((e) => e.duration)
      .filter((d): d is number => d !== undefined);

    const toolDurations = toolResults
      .map((e) => e.duration)
      .filter((d): d is number => d !== undefined);

    return {
      totalTasks: taskStarts.length,
      completedTasks: taskCompletes.length,
      failedTasks: taskErrors.length,
      averageTaskDuration: taskDurations.length > 0
        ? taskDurations.reduce((a, b) => a + b, 0) / taskDurations.length
        : 0,
      totalToolCalls: toolCalls.length,
      toolCallErrors: toolErrors.length,
      averageToolCallDuration: toolDurations.length > 0
        ? toolDurations.reduce((a, b) => a + b, 0) / toolDurations.length
        : 0,
      diagnosticRuns: diagnosticRuns.length,
      uptime: Date.now() - this.startTime,
    };
  }

  // ── Event Access ───────────────────────────────────────────────────────

  getEvents(filter?: { type?: MonitorEvent["type"]; limit?: number }): MonitorEvent[] {
    let events = this.events;
    if (filter?.type) {
      events = events.filter((e) => e.type === filter.type);
    }
    if (filter?.limit) {
      events = events.slice(-filter.limit);
    }
    return events;
  }

  getMetrics(name?: string): PerformanceMetric[] {
    if (name) {
      return this.metrics.filter((m) => m.name === name);
    }
    return this.metrics;
  }

  // ── Listeners ──────────────────────────────────────────────────────────

  onEvent(listener: (event: MonitorEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  // ── Reporting ──────────────────────────────────────────────────────────

  private emitReport(): void {
    const stats = this.getStats();
    this.record("performance", {
      stats,
      eventCount: this.events.length,
      metricCount: this.metrics.length,
    });
  }

  generateReport(): string {
    const stats = this.getStats();
    const uptimeMinutes = Math.round(stats.uptime / 60000);

    return [
      "═══════════════════════════════════════════════",
      "AGENT MONITOR REPORT",
      "═══════════════════════════════════════════════",
      `Uptime: ${uptimeMinutes} minutes`,
      "",
      "Tasks:",
      `  Total: ${stats.totalTasks}`,
      `  Completed: ${stats.completedTasks}`,
      `  Failed: ${stats.failedTasks}`,
      `  Avg Duration: ${Math.round(stats.averageTaskDuration)}ms`,
      "",
      "Tool Calls:",
      `  Total: ${stats.totalToolCalls}`,
      `  Errors: ${stats.toolCallErrors}`,
      `  Avg Duration: ${Math.round(stats.averageToolCallDuration)}ms`,
      "",
      `Diagnostics: ${stats.diagnosticRuns}`,
      `Events recorded: ${this.events.length}`,
      `Metrics recorded: ${this.metrics.length}`,
      "═══════════════════════════════════════════════",
    ].join("\n");
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  destroy(): void {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = null;
    }
    this.listeners = [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL MONITOR
// ═══════════════════════════════════════════════════════════════════════════

let globalMonitor: AgentMonitor | null = null;

export function getMonitor(): AgentMonitor {
  if (!globalMonitor) {
    globalMonitor = new AgentMonitor({
      enabled: true,
      maxEvents: 1000,
      logToConsole: process.env.NODE_ENV === "development",
    });
  }
  return globalMonitor;
}

export function createMonitor(config?: Partial<MonitorConfig>): AgentMonitor {
  return new AgentMonitor(config);
}
