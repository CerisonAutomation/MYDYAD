import React from "react";
import { AlertTriangle } from "lucide-react";

interface ToolCardErrorBoundaryProps {
  children: React.ReactNode;
  toolName?: string;
}

interface ToolCardErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

/**
 * Lightweight error boundary for individual tool cards.
 * If a tool card component throws, it shows a compact error message
 * instead of crashing the entire chat view.
 */
export class ToolCardErrorBoundary extends React.Component<
  ToolCardErrorBoundaryProps,
  ToolCardErrorBoundaryState
> {
  constructor(props: ToolCardErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ToolCardErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(
      `Tool card error (${this.props.toolName ?? "unknown"}):`,
      error,
      errorInfo,
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="my-1.5 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2"
          role="alert"
        >
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle size={14} />
            <span className="text-xs font-medium">
              {this.props.toolName
                ? `${this.props.toolName} failed`
                : "Tool card error"}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-red-500 dark:text-red-400/70 line-clamp-2">
            {this.state.error?.message ?? "Rendering failed"}
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
