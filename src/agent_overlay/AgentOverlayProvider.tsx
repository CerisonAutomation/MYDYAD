/**
 * AgentOverlayProvider — React Context
 *
 * Manages overlay state across the application.
 * Provides task management, event blocking, and overlay controls.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgentOverlay } from "./AgentOverlay";
import {
  EventBlocker,
  startEventBlocking,
  stopEventBlocking,
} from "./eventBlocker";
import { getMonitor } from "./monitor";
import type {
  AgentStatus,
  AgentStep,
  AgentTask,
  OverlayConfig,
} from "./types";
import { DEFAULT_OVERLAY_CONFIG } from "./types";

interface AgentOverlayContextValue {
  /** Current task */
  task: AgentTask | null;
  /** Whether overlay is visible */
  visible: boolean;
  /** Overlay config */
  config: OverlayConfig;
  /** Start a new task */
  startTask: (title: string, description?: string) => string;
  /** Update task status/progress */
  updateTask: (taskId: string, updates: Partial<AgentTask>) => void;
  /** Add a step to a task */
  addStep: (taskId: string, label: string) => string;
  /** Update a step */
  updateStep: (
    taskId: string,
    stepId: string,
    updates: Partial<AgentStep>
  ) => void;
  /** Complete a task */
  completeTask: (taskId: string, error?: string) => void;
  /** Pause a task */
  pauseTask: (taskId: string) => void;
  /** Resume a task */
  resumeTask: (taskId: string) => void;
  /** Cancel a task */
  cancelTask: (taskId: string) => void;
  /** Show/hide overlay */
  show: () => void;
  hide: () => void;
  toggle: () => void;
  /** Update config */
  setConfig: (config: Partial<OverlayConfig>) => void;
}

const AgentOverlayContext = createContext<AgentOverlayContextValue | null>(null);

export function useAgentOverlay(): AgentOverlayContextValue {
  const ctx = useContext(AgentOverlayContext);
  if (!ctx) {
    throw new Error("useAgentOverlay must be used within AgentOverlayProvider");
  }
  return ctx;
}

interface AgentOverlayProviderProps {
  children: React.ReactNode;
  config?: Partial<OverlayConfig>;
}

export function AgentOverlayProvider({
  children,
  config: configOverride,
}: AgentOverlayProviderProps) {
  const [task, setTask] = useState<AgentTask | null>(null);
  const [visible, setVisible] = useState(false);
  const [config, setConfigState] = useState<OverlayConfig>({
    ...DEFAULT_OVERLAY_CONFIG,
    ...configOverride,
  });
  const eventBlockerRef = useRef<EventBlocker | null>(null);
  const taskIdCounter = useRef(0);
  const stepIdCounter = useRef(0);

  const generateTaskId = useCallback(() => {
    taskIdCounter.current += 1;
    return `task-${Date.now()}-${taskIdCounter.current}`;
  }, []);

  const generateStepId = useCallback(() => {
    stepIdCounter.current += 1;
    return `step-${Date.now()}-${stepIdCounter.current}`;
  }, []);

  const startTask = useCallback(
    (title: string, description?: string): string => {
      const id = generateTaskId();
      const newTask: AgentTask = {
        id,
        title,
        description,
        status: "thinking",
        steps: [],
        startedAt: Date.now(),
        progress: 0,
      };
      setTask(newTask);
      setVisible(true);

      // Track in monitor
      getMonitor().trackTaskStart(newTask);
      getMonitor().trackOverlayShow();

      // Start event blocking if enabled
      if (config.enabled) {
        eventBlockerRef.current = startEventBlocking({
          cursor: "progress",
        });
      }

      return id;
    },
    [config.enabled, generateTaskId]
  );

  const updateTask = useCallback((taskId: string, updates: Partial<AgentTask>) => {
    setTask((prev) => {
      if (!prev || prev.id !== taskId) return prev;
      return { ...prev, ...updates };
    });
  }, []);

  const addStep = useCallback(
    (taskId: string, label: string): string => {
      const stepId = generateStepId();
      setTask((prev) => {
        if (!prev || prev.id !== taskId) return prev;
        const newStep: AgentStep = {
          id: stepId,
          label,
          status: "pending",
          startedAt: Date.now(),
        };
        return {
          ...prev,
          steps: [...prev.steps, newStep],
          currentStep: label,
        };
      });
      return stepId;
    },
    [generateStepId]
  );

  const updateStep = useCallback(
    (taskId: string, stepId: string, updates: Partial<AgentStep>) => {
      setTask((prev) => {
        if (!prev || prev.id !== taskId) return prev;
        return {
          ...prev,
          steps: prev.steps.map((s) =>
            s.id === stepId ? { ...s, ...updates } : s
          ),
        };
      });
    },
    []
  );

  const completeTask = useCallback(
    (taskId: string, error?: string) => {
      setTask((prev) => {
        if (!prev || prev.id !== taskId) return prev;
        return {
          ...prev,
          status: error ? "error" : "completed",
          completedAt: Date.now(),
          progress: 100,
          error,
        };
      });

      // Track completion
      const monitor = getMonitor();
      if (error) {
        monitor.trackTaskError(taskId, error);
      } else {
        monitor.trackTaskComplete({ id: taskId, title: "", steps: [], startedAt: Date.now(), progress: 100, status: "completed" });
      }
      monitor.trackOverlayHide();

      // Stop event blocking
      eventBlockerRef.current?.stop();
      eventBlockerRef.current = null;
    },
    []
  );

  const pauseTask = useCallback(
    (taskId: string) => {
      setTask((prev) => {
        if (!prev || prev.id !== taskId) return prev;
        return { ...prev, status: "paused" as AgentStatus };
      });
      eventBlockerRef.current?.stop();
    },
    []
  );

  const resumeTask = useCallback(
    (taskId: string) => {
      setTask((prev) => {
        if (!prev || prev.id !== taskId) return prev;
        return { ...prev, status: "executing" as AgentStatus };
      });
      if (config.enabled) {
        eventBlockerRef.current = startEventBlocking({ cursor: "progress" });
      }
    },
    [config.enabled]
  );

  const cancelTask = useCallback(
    (taskId: string) => {
      setTask((prev) => {
        if (!prev || prev.id !== taskId) return prev;
        return {
          ...prev,
          status: "error",
          completedAt: Date.now(),
          error: "Cancelled by user",
        };
      });
      eventBlockerRef.current?.stop();
      eventBlockerRef.current = null;
    },
    []
  );

  const show = useCallback(() => setVisible(true), []);
  const hide = useCallback(() => setVisible(false), []);
  const toggle = useCallback(() => setVisible((v) => !v), []);

  const setConfig = useCallback((updates: Partial<OverlayConfig>) => {
    setConfigState((prev) => ({ ...prev, ...updates }));
  }, []);

  const value = useMemo<AgentOverlayContextValue>(
    () => ({
      task,
      visible,
      config,
      startTask,
      updateTask,
      addStep,
      updateStep,
      completeTask,
      pauseTask,
      resumeTask,
      cancelTask,
      show,
      hide,
      toggle,
      setConfig,
    }),
    [
      task,
      visible,
      config,
      startTask,
      updateTask,
      addStep,
      updateStep,
      completeTask,
      pauseTask,
      resumeTask,
      cancelTask,
      show,
      hide,
      toggle,
      setConfig,
    ]
  );

  return (
    <AgentOverlayContext.Provider value={value}>
      {children}
      <AgentOverlay
        task={task}
        visible={visible}
        config={config}
        onPause={() => task && pauseTask(task.id)}
        onResume={() => task && resumeTask(task.id)}
        onCancel={() => task && cancelTask(task.id)}
        onDismiss={hide}
      />
    </AgentOverlayContext.Provider>
  );
}

export default AgentOverlayProvider;
