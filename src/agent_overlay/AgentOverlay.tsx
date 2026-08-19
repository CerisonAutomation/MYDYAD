/**
 * AgentOverlay — React Component
 *
 * Floating overlay that shows agent status, progress, and controls
 * during autonomous browser/app operations.
 *
 * Ported from Comet.app overlay patterns with enhanced UX.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentStatus,
  AgentStep,
  AgentTask,
  OverlayConfig,
  OverlayPosition,
} from "./types";
import {
  DEFAULT_OVERLAY_CONFIG,
  STATUS_COLORS,
  STATUS_ICONS,
} from "./types";
import "./overlay.css";

interface AgentOverlayProps {
  task: AgentTask | null;
  visible: boolean;
  config?: Partial<OverlayConfig>;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onDismiss?: () => void;
}

function getStatusIcon(status: AgentStatus): string {
  return STATUS_ICONS[status] || "○";
}

function getStatusColor(status: AgentStatus): string {
  return STATUS_COLORS[status] || "#6b7280";
}

function getStepIcon(step: AgentStep): string {
  switch (step.status) {
    case "completed":
      return "✓";
    case "active":
      return "▶";
    case "failed":
      return "✕";
    case "skipped":
      return "—";
    default:
      return "○";
  }
}

function getStepIconClass(step: AgentStep): string {
  switch (step.status) {
    case "completed":
      return "agent-overlay__step-icon--completed";
    case "active":
      return "agent-overlay__step-icon--active";
    case "failed":
      return "agent-overlay__step-icon--failed";
    default:
      return "agent-overlay__step-icon--pending";
  }
}

function getStatusIconClass(status: AgentStatus): string {
  const map: Record<AgentStatus, string> = {
    idle: "",
    thinking: "agent-overlay__status-icon--thinking",
    executing: "agent-overlay__status-icon--executing",
    browsing: "agent-overlay__status-icon--browsing",
    typing: "",
    clicking: "",
    waiting: "",
    error: "agent-overlay__status-icon--error",
    completed: "agent-overlay__status-icon--completed",
    paused: "agent-overlay__status-icon--paused",
  };
  return map[status] || "";
}

export function AgentOverlay({
  task,
  visible,
  config: configOverride,
  onPause,
  onResume,
  onCancel,
  onDismiss,
}: AgentOverlayProps) {
  const config = { ...DEFAULT_OVERLAY_CONFIG, ...configOverride };
  const [hiding, setHiding] = useState(false);
  const stepsRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to active step
  useEffect(() => {
    if (stepsRef.current && task?.steps) {
      const activeStep = stepsRef.current.querySelector(
        ".agent-overlay__step-icon--active"
      );
      if (activeStep) {
        activeStep.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [task?.steps]);

  // Auto-hide after completion
  useEffect(() => {
    if (task?.status === "completed" && config.autoHide) {
      const timer = setTimeout(() => {
        setHiding(true);
        setTimeout(() => onDismiss?.(), 300);
      }, config.autoHideDelay);
      return () => clearTimeout(timer);
    }
  }, [task?.status, config.autoHide, config.autoHideDelay, onDismiss]);

  if (!visible || !task) return null;

  const positionClass = `agent-overlay--${config.position}`;
  const isActive =
    task.status === "thinking" ||
    task.status === "executing" ||
    task.status === "browsing" ||
    task.status === "typing" ||
    task.status === "clicking" ||
    task.status === "waiting";
  const isPaused = task.status === "paused";

  const activeSteps = config.showSteps ? task.steps.filter(
    (s) => s.status === "active" || s.status === "completed" || s.status === "failed"
  ) : [];

  return (
    <div
      className={`agent-overlay ${positionClass} ${isActive ? "agent-overlay--active" : ""} ${hiding ? "agent-overlay--hiding" : ""}`}
      data-agent-overlay
      style={{ opacity: config.opacity }}
    >
      <div className="agent-overlay__card">
        {/* Header */}
        <div className="agent-overlay__header">
          <div className={`agent-overlay__status-icon ${getStatusIconClass(task.status)}`}>
            {getStatusIcon(task.status)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="agent-overlay__title">{task.title}</div>
            {task.currentStep && (
              <div className="agent-overlay__subtitle">{task.currentStep}</div>
            )}
          </div>
          {task.error && (
            <div
              style={{
                fontSize: "11px",
                color: "#f87171",
                maxWidth: "120px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={task.error}
            >
              {task.error}
            </div>
          )}
        </div>

        {/* Progress Bar */}
        {config.showProgressBar && (
          <div className="agent-overlay__progress">
            <div className="agent-overlay__progress-bar">
              <div
                className="agent-overlay__progress-fill"
                style={{ width: `${task.progress}%` }}
              />
            </div>
            <div className="agent-overlay__progress-text">
              {task.progress}% • {task.steps.filter((s) => s.status === "completed").length}/
              {task.steps.length} steps
            </div>
          </div>
        )}

        {/* Steps */}
        {activeSteps.length > 0 && (
          <div className="agent-overlay__steps" ref={stepsRef}>
            {activeSteps.map((step) => (
              <div key={step.id} className="agent-overlay__step">
                <div className={`agent-overlay__step-icon ${getStepIconClass(step)}`}>
                  {getStepIcon(step)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className={`agent-overlay__step-label ${
                      step.status === "active"
                        ? "agent-overlay__step-label--active"
                        : ""
                    }`}
                  >
                    {step.label}
                  </div>
                  {step.detail && (
                    <div className="agent-overlay__step-detail">{step.detail}</div>
                  )}
                  {step.error && (
                    <div className="agent-overlay__step-detail" style={{ color: "#f87171" }}>
                      {step.error}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Controls */}
        {config.showControls && isActive && (
          <div className="agent-overlay__controls">
            {isPaused ? (
              <button
                className="agent-overlay__btn"
                onClick={onResume}
                data-agent-overlay
              >
                ▶ Resume
              </button>
            ) : (
              <button
                className="agent-overlay__btn"
                onClick={onPause}
                data-agent-overlay
              >
                ⏸ Pause
              </button>
            )}
            <button
              className="agent-overlay__btn agent-overlay__btn--danger"
              onClick={onCancel}
              data-agent-overlay
            >
              ✕ Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default AgentOverlay;
