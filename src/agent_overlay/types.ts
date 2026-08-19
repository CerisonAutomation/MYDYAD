/**
 * Agent Overlay System — Types
 *
 * Ported from Comet.app (Perplexity) overlay patterns.
 * Provides real-time agent status, progress, and controls
 * during autonomous browser/app operations.
 */

export type AgentStatus =
  | "idle"
  | "thinking"
  | "executing"
  | "browsing"
  | "typing"
  | "clicking"
  | "waiting"
  | "error"
  | "completed"
  | "paused";

export type OverlayPosition = "top-right" | "top-left" | "bottom-right" | "bottom-left" | "center";

export interface AgentStep {
  id: string;
  label: string;
  status: "pending" | "active" | "completed" | "failed" | "skipped";
  startedAt?: number;
  completedAt?: number;
  detail?: string;
  error?: string;
}

export interface AgentTask {
  id: string;
  title: string;
  description?: string;
  status: AgentStatus;
  steps: AgentStep[];
  startedAt: number;
  completedAt?: number;
  progress: number; // 0-100
  currentStep?: string;
  error?: string;
}

export interface OverlayConfig {
  enabled: boolean;
  position: OverlayPosition;
  opacity: number; // 0-1
  showSteps: boolean;
  showProgressBar: boolean;
  showControls: boolean;
  autoHide: boolean;
  autoHideDelay: number; // ms
  maxHeight: number; // px
  theme: "light" | "dark" | "auto";
}

export interface OverlayState {
  visible: boolean;
  task: AgentTask | null;
  config: OverlayConfig;
  history: AgentTask[];
}

export interface OverlayActions {
  show: () => void;
  hide: () => void;
  toggle: () => void;
  startTask: (title: string, description?: string) => string;
  updateTask: (taskId: string, updates: Partial<AgentTask>) => void;
  addStep: (taskId: string, label: string) => string;
  updateStep: (taskIdId: string, stepId: string, updates: Partial<AgentStep>) => void;
  completeTask: (taskId: string, error?: string) => void;
  pauseTask: (taskId: string) => void;
  resumeTask: (taskId: string) => void;
  cancelTask: (taskId: string) => void;
  clearHistory: () => void;
  setConfig: (config: Partial<OverlayConfig>) => void;
}

export const DEFAULT_OVERLAY_CONFIG: OverlayConfig = {
  enabled: true,
  position: "top-right",
  opacity: 0.95,
  showSteps: true,
  showProgressBar: true,
  showControls: true,
  autoHide: true,
  autoHideDelay: 3000,
  maxHeight: 400,
  theme: "auto",
};

export const STATUS_ICONS: Record<AgentStatus, string> = {
  idle: "○",
  thinking: "◉",
  executing: "▶",
  browsing: "🌐",
  typing: "⌨",
  clicking: "👆",
  waiting: "⏳",
  error: "✕",
  completed: "✓",
  paused: "⏸",
};

export const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: "#6b7280",
  thinking: "#8b5cf6",
  executing: "#3b82f6",
  browsing: "#06b6d4",
  typing: "#10b981",
  clicking: "#f59e0b",
  waiting: "#f97316",
  error: "#ef4444",
  completed: "#22c55e",
  paused: "#6b7280",
};
