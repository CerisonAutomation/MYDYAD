import { useEffect, useRef } from "react";
import type { CustomTagState } from "./stateTypes";

/**
 * Auto-collapses a tool card when it transitions from "pending" to any
 * completed state (finished, aborted, error, warning).
 *
 * Usage in a tool card component:
 * ```tsx
 * const state = node?.properties?.state as CustomTagState;
 * const [isContentVisible, setIsContentVisible] = useState(false);
 * useAutoCollapse(state, setIsContentVisible);
 * ```
 */
export function useAutoCollapse(
  state: CustomTagState | undefined,
  setVisible: (v: boolean) => void,
): void {
  const prevStateRef = useRef<CustomTagState | undefined>(undefined);

  useEffect(() => {
    const prev = prevStateRef.current;
    if (prev === "pending" && state !== "pending" && state !== undefined) {
      setVisible(false);
    }
    prevStateRef.current = state;
  }, [state, setVisible]);
}
