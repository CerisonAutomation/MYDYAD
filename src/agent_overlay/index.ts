/**
 * Agent Overlay — Module Exports
 *
 * Floating overlay system for agent status, progress, and controls.
 * Ported from Comet.app overlay patterns with enhanced UX.
 */

// Core component
export { AgentOverlay } from "./AgentOverlay";

// Provider & hook
export { AgentOverlayProvider, useAgentOverlay } from "./AgentOverlayProvider";

// Event blocker
export {
  EventBlocker,
  startEventBlocking,
  stopEventBlocking,
  isEventBlocking,
} from "./eventBlocker";
export type { EventBlockerOptions } from "./eventBlocker";

// Monitor
export { AgentMonitor, getMonitor, createMonitor } from "./monitor";
export type { MonitorEvent, MonitorStats, MonitorConfig } from "./monitor";

// Types
export type {
  AgentStatus,
  AgentStep,
  AgentTask,
  OverlayConfig,
  OverlayPosition,
  OverlayActions,
} from "./types";

export {
  DEFAULT_OVERLAY_CONFIG,
  STATUS_ICONS,
  STATUS_COLORS,
} from "./types";
